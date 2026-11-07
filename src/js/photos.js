// Photo handling: shrink camera photos to a sensible size and make a thumbnail.
import { uid } from './db.js';

const FULL_MAX = 2048;   // long edge for the stored "full" photo (sharp enough for the shop)
const FULL_Q = 0.85;
const THUMB_MAX = 400;   // long edge for album tiles
const THUMB_Q = 0.72;

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function resize(bmp, max, quality) {
  const w = bmp.width, h = bmp.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, cw, ch);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Returns a photo record ready to store: { id, itemId, full, thumb, caption }
export async function processPhoto(file, itemId) {
  const bmp = await loadBitmap(file);
  const [full, thumb] = await Promise.all([resize(bmp, FULL_MAX, FULL_Q), resize(bmp, THUMB_MAX, THUMB_Q)]);
  if (bmp.close) bmp.close();
  return { id: uid(), itemId, full, thumb, caption: '', createdAt: Date.now() };
}

// Object URL cache so tiles don't leak memory
const urlCache = new Map();
export function blobUrl(key, blob) {
  if (!blob) return '';
  if (urlCache.has(key)) return urlCache.get(key);
  const u = URL.createObjectURL(blob);
  urlCache.set(key, u);
  return u;
}
export function forgetUrl(key) {
  const u = urlCache.get(key);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(key); }
}
