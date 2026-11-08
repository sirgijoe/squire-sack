// Squire — small layer over "where are we running": browser / installed web app, or the Tauri
// desktop & mobile apps. No dependencies: Tauri's IPC is reached through window.__TAURI_INTERNALS__.
import { download } from './util.js';

export const isTauri = () => !!(globalThis.window && (window.__TAURI_INTERNALS__ || window.__TAURI__));
export const isMobileUA = () => /Android|iPhone|iPad|iPod/i.test(globalThis.navigator?.userAgent || '');
// The desktop app (not the Tauri phone app) can run the home base.
export const isDesktopApp = () => isTauri() && !isMobileUA();

export function invoke(cmd, args, options) {
  const ipc = window.__TAURI_INTERNALS__;
  if (!ipc) return Promise.reject(new Error('Not running in the Squire app'));
  return ipc.invoke(cmd, args, options);
}

// Save a file. In the desktop app this opens a real "Save as…" dialog and writes to disk;
// everywhere else it falls back to a normal browser download.
// Returns the saved path (desktop), true (download started) or null (user cancelled).
export async function saveFile(blob, filename) {
  if (isTauri()) {
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const path = await invoke('save_file', bytes, { headers: { 'x-filename': encodeURIComponent(filename) } });
      return path || null;
    } catch (err) {
      console.warn('Native save failed, falling back to download', err);
    }
  }
  download(blob, filename);
  return true;
}

// Open an HTML blob (print views) — new tab in browsers; in the app, a new window via a blob URL
// can't print, so save it and let the system open it instead.
export async function openHtml(blob, filename) {
  if (isTauri()) {
    const path = await saveFile(blob, filename);
    if (typeof path === 'string') { try { await invoke('open_path', { path }); } catch { /* opener optional */ } }
    return path;
  }
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) download(blob, filename);
  return true;
}
