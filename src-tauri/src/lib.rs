// Squire — GPL-3.0-only
// Shared entry point for desktop (Windows/macOS/Linux) and mobile (Android/iOS).
// The web app in ../src talks to these commands through window.__TAURI_INTERNALS__ (see src/js/platform.js).

mod home_base;

use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Default)]
struct HomeBaseSlot(Mutex<Option<Arc<home_base::HomeBase>>>);

fn slot_get(slot: &State<'_, HomeBaseSlot>) -> Result<Arc<home_base::HomeBase>, String> {
    slot.0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "The home base isn't running.".to_string())
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
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Save bytes to a file the user picks. The file's bytes arrive as the raw IPC body and the
/// suggested name in the `x-filename` header. Returns the saved path, or None if cancelled.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let name = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "squire-export".to_string());
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected file contents".into());
    };
    let picked = app.dialog().file().set_file_name(name).blocking_save_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Couldn't save the file: {}", e))?;
    Ok(Some(path.display().to_string()))
}

/// Open a saved file with the system's default app (e.g. a print view in the browser).
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    let r = Command::new("cmd").args(["/C", "start", "", &path]).spawn();
    #[cfg(target_os = "macos")]
    let r = Command::new("open").arg(&path).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let r = Command::new("xdg-open").arg(&path).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_base_start(app: tauri::AppHandle, slot: State<'_, HomeBaseSlot>, port: Option<u16>) -> Result<home_base::Info, String> {
    let mut guard = slot.0.lock().map_err(|e| e.to_string())?;
    if let Some(hb) = guard.as_ref() {
        return Ok(hb.info());
    }
    let hb = home_base::HomeBase::start(app, port.unwrap_or(home_base::DEFAULT_PORT))?;
    let info = hb.info();
    *guard = Some(hb);
    Ok(info)
}

#[tauri::command]
fn home_base_stop(slot: State<'_, HomeBaseSlot>) -> Result<(), String> {
    if let Some(hb) = slot.0.lock().map_err(|e| e.to_string())?.take() {
        hb.stop();
    }
    Ok(())
}

#[tauri::command]
fn home_base_info(slot: State<'_, HomeBaseSlot>) -> Result<Option<home_base::Info>, String> {
    Ok(slot.0.lock().map_err(|e| e.to_string())?.as_ref().map(|hb| hb.info()))
}

#[tauri::command]
fn home_base_pair_code(slot: State<'_, HomeBaseSlot>) -> Result<String, String> {
    Ok(slot_get(&slot)?.new_pair_code())
}

#[tauri::command]
fn home_base_forget(slot: State<'_, HomeBaseSlot>, id: String) -> Result<(), String> {
    slot_get(&slot)?.forget_device(&id);
    Ok(())
}

#[tauri::command]
fn home_base_rename(slot: State<'_, HomeBaseSlot>, name: String) -> Result<(), String> {
    slot_get(&slot)?.rename(&name);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(HomeBaseSlot::default())
        .invoke_handler(tauri::generate_handler![
            save_file,
            open_path,
            home_base_start,
            home_base_stop,
            home_base_info,
            home_base_pair_code,
            home_base_forget,
            home_base_rename
        ])
        .run(tauri::generate_context!())
        .expect("error while running Squire");
}
