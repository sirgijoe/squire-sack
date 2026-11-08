#!/usr/bin/env node
// Squire home base — plain-Node version of the desktop app's sync server (src-tauri/src/home_base.rs).
// Handy for trying phone sync without building the desktop app, and used by the tests.
//
//   node tools/home-base.mjs [--port 7878] [--data ./home-base-data] [--name "Barn PC"]
//
// It serves the Squire web app on your home network too: open the printed address on a phone,
// tap More → Home base → Pair, and type the code shown here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const VERSION = '0.3.0';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Max-Age': '600',
};
const PAIR_TTL = 10 * 60 * 1000;

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

export function createHomeBase({ dataDir, name = os.hostname(), webRoot = null, log = () => {}, onPaired = () => {} }) {
  fs.mkdirSync(path.join(dataDir, 'photos'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'thumbs'), { recursive: true });
  const file = path.join(dataDir, 'home-base.json');
  let st = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (!st) st = { serverId: crypto.randomUUID(), name, seq: 0, devices: [], records: {} };
  st.name = name || st.name;
  let pairing = null; // { code, until }
  const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(st)); fs.renameSync(tmp, file); };
  save();

  const newPairCode = () => { pairing = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), until: Date.now() + PAIR_TTL }; return pairing.code; };
  const deviceFor = (token) => token && st.devices.find((d) => d.token === token);
  const photoPath = (id, kind) => {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !['full', 'thumb'].includes(kind)) return null;
    return path.join(dataDir, kind === 'full' ? 'photos' : 'thumbs', id + '.jpg');
  };

  function merge(changes) {
    for (const { store, rec } of changes || []) {
      if (!['templates', 'items', 'photos', 'meta'].includes(store) || !rec || typeof rec !== 'object') continue;
      const key = store === 'meta' ? rec.key : rec.id;
      if (key == null || (store === 'meta' && String(key).startsWith('sync:'))) continue;
      const k = store + '/' + key;
      const cur = st.records[k];
      if (store === 'photos') { delete rec.full; delete rec.thumb; }
      if (store === 'meta' && String(key).startsWith('sku:')) {
        const v = Math.max(Number(cur?.rec.value || 0), Number(rec.value || 0));
        if (cur && Number(cur.rec.value) === v) continue;
        st.records[k] = { store, seq: ++st.seq, rec: { key, value: v, updatedAt: Math.max(cur?.rec.updatedAt || 0, rec.updatedAt || 0) } };
        continue;
      }
      if (cur && (cur.rec.updatedAt || 0) >= (rec.updatedAt || 0)) continue;
      st.records[k] = { store, seq: ++st.seq, rec };
    }
  }

  async function body(req, limit = 64 * 1024 * 1024) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('too big'), { status: 413 }); chunks.push(c); }
    return Buffer.concat(chunks);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const send = (status, data, type = 'application/json') => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
      res.writeHead(status, { ...CORS, 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      res.end(buf);
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    const p = url.pathname;
    if (p === '/api/hello') return send(200, { app: 'squire', kind: 'home-base', name: st.name, serverId: st.serverId, version: VERSION });
    if (p === '/api/pair' && req.method === 'POST') {
      const j = JSON.parse((await body(req, 65536)).toString() || '{}');
      if (!pairing || Date.now() > pairing.until || String(j.code) !== pairing.code) return send(403, { error: 'bad code' });
      pairing = null;
      const dev = { id: crypto.randomUUID(), name: String(j.deviceName || 'Phone').slice(0, 60), token: crypto.randomBytes(24).toString('hex'), pairedAt: Date.now(), lastSeen: Date.now() };
      st.devices.push(dev); save();
      log(`Paired "${dev.name}"`);
      onPaired(dev);
      return send(200, { token: dev.token, serverId: st.serverId, name: st.name });
    }
    if (p.startsWith('/api/')) {
      const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('t');
      const dev = deviceFor(auth);
      if (!dev) return send(401, { error: 'not paired' });
      dev.lastSeen = Date.now();
      if (p === '/api/sync' && req.method === 'POST') {
        const j = JSON.parse((await body(req)).toString() || '{}');
        merge(j.changes);
        save();
        const since = Number(j.since || 0);
        const changes = Object.values(st.records).filter((e) => e.seq > since).sort((a, b) => a.seq - b.seq).map(({ store, rec }) => ({ store, rec }));
        const missingPhotos = Object.values(st.records).filter((e) => e.store === 'photos' && !e.rec.deleted && !fs.existsSync(photoPath(e.rec.id, 'full') || '/nonexistent')).map((e) => e.rec.id);
        log(`Sync with "${dev.name}": got ${(j.changes || []).length}, sent ${changes.length}`);
        return send(200, { seq: st.seq, changes, missingPhotos });
      }
      if (p === '/api/photos/have' && req.method === 'POST') {
        const j = JSON.parse((await body(req)).toString() || '{}');
        return send(200, { have: (j.ids || []).filter((id) => { const f = photoPath(String(id), 'full'); return f && fs.existsSync(f); }) });
      }
      const m = p.match(/^\/api\/photo\/([^/]+)\/(full|thumb)$/);
      if (m) {
        const f = photoPath(decodeURIComponent(m[1]), m[2]);
        if (!f) return send(400, { error: 'bad id' });
        if (req.method === 'PUT') { const b = await body(req); const tmp = f + '.tmp'; fs.writeFileSync(tmp, b); fs.renameSync(tmp, f); return send(200, { ok: true }); }
        if (!fs.existsSync(f)) return send(404, { error: 'missing' });
        return send(200, fs.readFileSync(f), 'image/jpeg');
      }
      return send(404, { error: 'unknown' });
    }
    // the web app itself
    if (!webRoot) return send(404, 'Not found', 'text/plain');
    let rel = decodeURIComponent(p).replace(/^\/+/, '') || 'index.html';
    const f = path.resolve(webRoot, rel);
    if (!f.startsWith(path.resolve(webRoot)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(404, 'Not found', 'text/plain');
    return send(200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
  }

  const server = http.createServer((req, res) => handle(req, res).catch((err) => {
    try { res.writeHead(err.status || 500, CORS); res.end(String(err.message)); } catch { /* already sent */ }
  }));
  return { server, newPairCode, state: () => st };
}

// ---- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
  const port = Number(arg('port', 7878));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const hb = createHomeBase({ dataDir: path.resolve(arg('data', './home-base-data')), name: arg('name', os.hostname()), webRoot: path.join(here, '..', 'src'), log: (m) => console.log(new Date().toLocaleTimeString(), m),
    onPaired: () => console.log(`   Next pairing code: ${hb.newPairCode()}`) });
  hb.server.listen(port, '0.0.0.0', () => {
    const code = hb.newPairCode();
    console.log(`\n🛡  Squire home base "${hb.state().name}" is running.\n`);
    for (const ip of lanAddresses()) console.log(`   On your phone open:  http://${ip}:${port}/`);
    console.log(`\n   Pairing code: ${code}  (good for 10 minutes; a new one appears after each pairing — restart for a fresh one)\n`);
  });
}
