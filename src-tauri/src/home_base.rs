// Squire — GPL-3.0-only
// Desktop "home base": a small HTTP server on the home network that phones sync with.
// Same protocol and the same on-disk format as tools/home-base.mjs; the protocol is
// documented at the top of src/js/sync.js.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

pub const DEFAULT_PORT: u16 = 7878;
const VERSION: &str = env!("CARGO_PKG_VERSION");
const PAIR_TTL_MS: u64 = 10 * 60 * 1000;
const MAX_BODY: u64 = 64 * 1024 * 1024;
const STORES: [&str; 4] = ["templates", "items", "photos", "meta"];
const CORS: [(&str, &str); 5] = [
    ("Access-Control-Allow-Origin", "*"),
    ("Access-Control-Allow-Headers", "authorization, content-type"),
    ("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS"),
    ("Access-Control-Allow-Private-Network", "true"),
    ("Access-Control-Max-Age", "600"),
];

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::getrandom(&mut b).expect("system random number generator");
    b
}

fn random_hex<const N: usize>() -> String {
    random_bytes::<N>().iter().map(|b| format!("{:02x}", b)).collect()
}

fn random_code() -> String {
    format!("{:06}", u32::from_le_bytes(random_bytes::<4>()) % 1_000_000)
}

fn host_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .or_else(|| fs::read_to_string("/etc/hostname").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Squire home base".to_string())
}

// The address other devices on the Wi-Fi can reach us at. Connecting a UDP socket sends nothing;
// it only asks the OS which local address it would route through.
fn lan_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    let ip = s.local_addr().ok()?.ip();
    if ip.is_loopback() || ip.is_unspecified() { None } else { Some(ip.to_string()) }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Device {
    id: String,
    name: String,
    token: String,
    paired_at: u64,
    last_seen: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct Entry {
    store: String,
    seq: u64,
    rec: Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    server_id: String,
    name: String,
    seq: u64,
    devices: Vec<Device>,
    records: HashMap<String, Entry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    id: String,
    name: String,
    paired_at: u64,
    last_seen: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    running: bool,
    name: String,
    server_id: String,
    port: u16,
    urls: Vec<String>,
    local_url: String,
    local_token: String,
    data_dir: String,
    records: usize,
    devices: Vec<DeviceInfo>,
}

pub struct HomeBase {
    app: AppHandle,
    dir: PathBuf,
    state: Mutex<State>,
    pairing: Mutex<Option<(String, u64)>>,
    server: Arc<Server>,
    port: u16,
    local_token: String,
}

fn upd(v: &Value) -> f64 {
    v.get("updatedAt").and_then(|x| x.as_f64()).unwrap_or(0.0)
}
fn num_value(v: &Value) -> f64 {
    v.get("value").and_then(|x| x.as_f64()).unwrap_or(0.0)
}
fn key_string(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}
fn valid_photo_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(v) = hex {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
fn query_param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let mut it = kv.splitn(2, '=');
        if it.next()? == name { Some(percent_decode(it.next().unwrap_or(""))) } else { None }
    })
}

fn respond(req: Request, status: u16, body: Vec<u8>, content_type: &str) {
    let mut resp = Response::from_data(body).with_status_code(StatusCode(status));
    let extra = [("Content-Type", content_type), ("Cache-Control", "no-store")];
    for (k, v) in CORS.iter().chain(extra.iter()) {
        if let Ok(h) = Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            resp.add_header(h);
        }
    }
    let _ = req.respond(resp);
}
fn respond_json(req: Request, status: u16, v: Value) {
    respond(req, status, serde_json::to_vec(&v).unwrap_or_default(), "application/json");
}
fn read_body(req: &mut Request, limit: u64) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    req.as_reader().take(limit + 1).read_to_end(&mut buf).ok()?;
    if buf.len() as u64 > limit { None } else { Some(buf) }
}
fn header_value(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

impl HomeBase {
    pub fn start(app: AppHandle, port: u16) -> Result<Arc<HomeBase>, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("home-base");
        fs::create_dir_all(dir.join("photos")).map_err(|e| e.to_string())?;
        fs::create_dir_all(dir.join("thumbs")).map_err(|e| e.to_string())?;
        let file = dir.join("home-base.json");
        let mut state: State = fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_else(|| State {
                server_id: random_hex::<16>(),
                name: host_name(),
                seq: 0,
                devices: vec![],
                records: HashMap::new(),
            });
        // This computer's own window syncs like any other device, with a token it never has to pair for.
        let local_token = match state.devices.iter().find(|d| d.id == "local") {
            Some(d) => d.token.clone(),
            None => {
                let token = random_hex::<24>();
                state.devices.push(Device { id: "local".into(), name: "This computer".into(), token: token.clone(), paired_at: now_ms(), last_seen: now_ms() });
                token
            }
        };

        // Use the preferred port, or the next free one.
        let mut bound = None;
        let mut last_err = String::new();
        for p in port..port.saturating_add(10) {
            match Server::http(("0.0.0.0", p)) {
                Ok(s) => { bound = Some((s, p)); break; }
                Err(e) => last_err = e.to_string(),
            }
        }
        let (server, port) = bound.ok_or_else(|| format!("Couldn't open a network port for the home base: {}", last_err))?;

        let hb = Arc::new(HomeBase {
            app,
            dir,
            state: Mutex::new(state),
            pairing: Mutex::new(None),
            server: Arc::new(server),
            port,
            local_token,
        });
        hb.save();

        let worker = hb.clone();
        std::thread::spawn(move || {
            for req in worker.server.incoming_requests() {
                let hb = worker.clone();
                std::thread::spawn(move || hb.handle(req));
            }
        });
        Ok(hb)
    }

    pub fn stop(&self) {
        self.server.unblock();
    }

    fn save(&self) {
        let st = match self.state.lock() { Ok(s) => s, Err(_) => return };
        if let Ok(bytes) = serde_json::to_vec(&*st) {
            let file = self.dir.join("home-base.json");
            let tmp = self.dir.join("home-base.json.tmp");
            if fs::write(&tmp, bytes).is_ok() {
                let _ = fs::rename(&tmp, &file);
            }
        }
    }

    pub fn info(&self) -> Info {
        let st = self.state.lock().expect("home base state");
        let urls = lan_ip().map(|ip| vec![format!("http://{}:{}", ip, self.port)]).unwrap_or_default();
        Info {
            running: true,
            name: st.name.clone(),
            server_id: st.server_id.clone(),
            port: self.port,
            urls,
            local_url: format!("http://127.0.0.1:{}", self.port),
            local_token: self.local_token.clone(),
            data_dir: self.dir.display().to_string(),
            records: st.records.len(),
            devices: st
                .devices
                .iter()
                .filter(|d| d.id != "local")
                .map(|d| DeviceInfo { id: d.id.clone(), name: d.name.clone(), paired_at: d.paired_at, last_seen: d.last_seen })
                .collect(),
        }
    }

    pub fn new_pair_code(&self) -> String {
        let code = random_code();
        *self.pairing.lock().expect("pairing") = Some((code.clone(), now_ms() + PAIR_TTL_MS));
        code
    }

    pub fn forget_device(&self, id: &str) {
        if id == "local" { return; }
        self.state.lock().expect("state").devices.retain(|d| d.id != id);
        self.save();
    }

    pub fn rename(&self, name: &str) {
        let name = name.trim();
        if name.is_empty() { return; }
        self.state.lock().expect("state").name = name.chars().take(60).collect();
        self.save();
    }

    fn photo_path(&self, id: &str, kind: &str) -> Option<PathBuf> {
        if !valid_photo_id(id) { return None; }
        match kind {
            "full" => Some(self.dir.join("photos").join(format!("{}.jpg", id))),
            "thumb" => Some(self.dir.join("thumbs").join(format!("{}.jpg", id))),
            _ => None,
        }
    }

    fn merge(st: &mut State, changes: &[Value]) {
        for c in changes {
            let store = match c.get("store").and_then(|v| v.as_str()) {
                Some(s) if STORES.contains(&s) => s.to_string(),
                _ => continue,
            };
            let mut rec = match c.get("rec") {
                Some(v) if v.is_object() => v.clone(),
                _ => continue,
            };
            let key = match key_string(rec.get(if store == "meta" { "key" } else { "id" })) {
                Some(k) => k,
                None => continue,
            };
            if store == "meta" && key.starts_with("sync:") { continue; }
            if store == "photos" {
                if let Some(o) = rec.as_object_mut() {
                    o.remove("full");
                    o.remove("thumb");
                }
            }
            let k = format!("{}/{}", store, key);
            if store == "meta" && key.starts_with("sku:") {
                let (cur_v, cur_u) = match st.records.get(&k) {
                    Some(e) => (Some(num_value(&e.rec)), upd(&e.rec)),
                    None => (None, 0.0),
                };
                let v = num_value(&rec).max(cur_v.unwrap_or(0.0));
                if cur_v == Some(v) { continue; }
                st.seq += 1;
                let seq = st.seq;
                let u = upd(&rec).max(cur_u);
                st.records.insert(k, Entry { store, seq, rec: json!({ "key": key, "value": v as u64, "updatedAt": u as u64 }) });
                continue;
            }
            if let Some(e) = st.records.get(&k) {
                if upd(&e.rec) >= upd(&rec) { continue; }
            }
            st.seq += 1;
            let seq = st.seq;
            st.records.insert(k, Entry { store, seq, rec });
        }
    }

    fn handle(&self, mut req: Request) {
        let method = req.method().clone();
        let raw_url = req.url().to_string();
        let (path, query) = match raw_url.split_once('?') {
            Some((p, q)) => (p.to_string(), q.to_string()),
            None => (raw_url.clone(), String::new()),
        };

        if method == Method::Options {
            return respond(req, 204, vec![], "text/plain");
        }
        if path == "/api/hello" {
            let st = self.state.lock().expect("state");
            let v = json!({ "app": "squire", "kind": "home-base", "name": st.name, "serverId": st.server_id, "version": VERSION });
            drop(st);
            return respond_json(req, 200, v);
        }
        if path == "/api/pair" && method == Method::Post {
            let body: Value = read_body(&mut req, 65536).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
            let code = key_string(body.get("code")).unwrap_or_default();
            let ok = {
                let mut p = self.pairing.lock().expect("pairing");
                let ok = matches!(&*p, Some((c, until)) if *c == code && now_ms() <= *until);
                if ok { *p = None; }
                ok
            };
            if !ok {
                return respond_json(req, 403, json!({ "error": "bad code" }));
            }
            let name: String = body.get("deviceName").and_then(|v| v.as_str()).unwrap_or("Phone").chars().take(60).collect();
            let dev = Device { id: random_hex::<16>(), name, token: random_hex::<24>(), paired_at: now_ms(), last_seen: now_ms() };
            let (server_id, server_name) = {
                let mut st = self.state.lock().expect("state");
                st.devices.push(dev.clone());
                (st.server_id.clone(), st.name.clone())
            };
            self.save();
            {
                use tauri::Emitter;
                let _ = self.app.emit("home-base-paired", dev.name.clone());
            }
            return respond_json(req, 200, json!({ "token": dev.token, "serverId": server_id, "name": server_name }));
        }

        if path.starts_with("/api/") {
            let token = header_value(&req, "authorization")
                .map(|v| v.trim_start_matches("Bearer ").trim_start_matches("bearer ").trim().to_string())
                .filter(|t| !t.is_empty())
                .or_else(|| query_param(&query, "t"));
            let authorized = {
                let mut st = self.state.lock().expect("state");
                match st.devices.iter_mut().find(|d| Some(&d.token) == token.as_ref()) {
                    Some(d) => { d.last_seen = now_ms(); true }
                    None => false,
                }
            };
            if !authorized {
                return respond_json(req, 401, json!({ "error": "not paired" }));
            }

            if path == "/api/sync" && method == Method::Post {
                let body: Value = match read_body(&mut req, MAX_BODY).and_then(|b| serde_json::from_slice(&b).ok()) {
                    Some(v) => v,
                    None => return respond_json(req, 400, json!({ "error": "bad request" })),
                };
                let since = body.get("since").and_then(|v| v.as_u64()).unwrap_or(0);
                let (seq, changes, photo_ids) = {
                    let mut st = self.state.lock().expect("state");
                    if let Some(list) = body.get("changes").and_then(|v| v.as_array()) {
                        Self::merge(&mut st, list);
                    }
                    let mut out: Vec<&Entry> = st.records.values().filter(|e| e.seq > since).collect();
                    out.sort_by_key(|e| e.seq);
                    let changes: Vec<Value> = out.iter().map(|e| json!({ "store": e.store, "rec": e.rec })).collect();
                    let photo_ids: Vec<String> = st
                        .records
                        .values()
                        .filter(|e| e.store == "photos" && !e.rec.get("deleted").and_then(|v| v.as_bool()).unwrap_or(false))
                        .filter_map(|e| key_string(e.rec.get("id")))
                        .collect();
                    (st.seq, changes, photo_ids)
                };
                self.save();
                let missing: Vec<String> = photo_ids
                    .into_iter()
                    .filter(|id| self.photo_path(id, "full").map(|p| !p.exists()).unwrap_or(false))
                    .collect();
                return respond_json(req, 200, json!({ "seq": seq, "changes": changes, "missingPhotos": missing }));
            }

            if path == "/api/photos/have" && method == Method::Post {
                let body: Value = read_body(&mut req, 4 * 1024 * 1024).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
                let have: Vec<String> = body
                    .get("ids")
                    .and_then(|v| v.as_array())
                    .map(|ids| {
                        ids.iter()
                            .filter_map(|v| v.as_str())
                            .filter(|id| self.photo_path(id, "full").map(|p| p.exists()).unwrap_or(false))
                            .map(|s| s.to_string())
                            .collect()
                    })
                    .unwrap_or_default();
                return respond_json(req, 200, json!({ "have": have }));
            }

            if let Some(rest) = path.strip_prefix("/api/photo/") {
                let mut parts = rest.splitn(2, '/');
                let id = percent_decode(parts.next().unwrap_or(""));
                let kind = parts.next().unwrap_or("");
                let file = match self.photo_path(&id, kind) {
                    Some(f) => f,
                    None => return respond_json(req, 400, json!({ "error": "bad photo id" })),
                };
                if method == Method::Put {
                    let bytes = match read_body(&mut req, MAX_BODY) {
                        Some(b) => b,
                        None => return respond_json(req, 413, json!({ "error": "too big" })),
                    };
                    let tmp = file.with_extension("tmp");
                    let ok = fs::write(&tmp, bytes).is_ok() && fs::rename(&tmp, &file).is_ok();
                    return respond_json(req, if ok { 200 } else { 500 }, json!({ "ok": ok }));
                }
                return match fs::read(&file) {
                    Ok(b) => respond(req, 200, b, "image/jpeg"),
                    Err(_) => respond_json(req, 404, json!({ "error": "missing" })),
                };
            }
            return respond_json(req, 404, json!({ "error": "unknown" }));
        }

        // Anything else: the Squire web app itself, so a phone can just open the address.
        let asset_path = {
            let p = percent_decode(path.trim_start_matches('/'));
            if p.is_empty() { "index.html".to_string() } else { p }
        };
        match self.app.asset_resolver().get(asset_path) {
            Some(asset) => {
                let mime = asset.mime_type().to_string();
                respond(req, 200, asset.bytes().to_vec(), &mime)
            }
            None => respond(req, 404, b"Not found".to_vec(), "text/plain"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st() -> State {
        State { server_id: "s".into(), name: "n".into(), seq: 0, devices: vec![], records: HashMap::new() }
    }

    #[test]
    fn newer_edit_wins_and_sku_takes_max() {
        let mut s = st();
        HomeBase::merge(&mut s, &[json!({ "store": "items", "rec": { "id": "a", "name": "old", "updatedAt": 5 } })]);
        HomeBase::merge(&mut s, &[json!({ "store": "items", "rec": { "id": "a", "name": "older", "updatedAt": 3 } })]);
        assert_eq!(s.records["items/a"].rec["name"], "old");
        HomeBase::merge(&mut s, &[json!({ "store": "items", "rec": { "id": "a", "name": "new", "updatedAt": 9 } })]);
        assert_eq!(s.records["items/a"].rec["name"], "new");
        HomeBase::merge(&mut s, &[json!({ "store": "meta", "rec": { "key": "sku:MOLD", "value": 7, "updatedAt": 1 } })]);
        HomeBase::merge(&mut s, &[json!({ "store": "meta", "rec": { "key": "sku:MOLD", "value": 4, "updatedAt": 99 } })]);
        assert_eq!(s.records["meta/sku:MOLD"].rec["value"], 7);
        HomeBase::merge(&mut s, &[json!({ "store": "meta", "rec": { "key": "sync:config", "value": 1 } })]);
        assert!(!s.records.contains_key("meta/sync:config"));
        HomeBase::merge(&mut s, &[json!({ "store": "photos", "rec": { "id": "p", "full": "x", "updatedAt": 1 } })]);
        assert!(s.records["photos/p"].rec.get("full").is_none());
    }

    #[test]
    fn decoding_and_ids() {
        assert_eq!(percent_decode("a%20b%2Fc"), "a b/c");
        assert_eq!(query_param("x=1&t=abc%3D", "t").as_deref(), Some("abc="));
        assert!(valid_photo_id("1b4e28ba-2fa1-11d2-883f-0016d3cca427"));
        assert!(!valid_photo_id("../etc/passwd"));
    }
}
