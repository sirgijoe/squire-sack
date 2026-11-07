// Squire — GPL-3.0-only
// Shared entry point for desktop (Windows/macOS/Linux) and mobile (Android/iOS).
// Phase 2 will add commands here for the desktop "home base": a local sync server
// (QR-code pairing over home Wi-Fi) and full-size photo storage on disk.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Squire");
}
