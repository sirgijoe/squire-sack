// Squire — local database (IndexedDB). No dependencies.
// Stores: templates, items, photos (blobs), meta (settings, counters).
// Every record carries updatedAt so a future desktop<->phone sync can merge by timestamp.

const DB_NAME = 'squire';
const DB_VERSION = 1;
let dbPromise = null;

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('templateId', 'templateId');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('itemId', 'itemId');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function getAll(name) { return wrap((await store(name)).getAll()); }
export async function get(name, id) { return wrap((await store(name)).get(id)); }
export async function put(name, rec) {
  if (name !== 'meta') rec.updatedAt = Date.now();
  await wrap((await store(name, 'readwrite')).put(rec));
  return rec;
}
// Store a record exactly as given (keeps its updatedAt) — used by restore/sync.
export async function putRaw(name, rec) {
  await wrap((await store(name, 'readwrite')).put(rec));
  return rec;
}
export async function del(name, id) { return wrap((await store(name, 'readwrite')).delete(id)); }
export async function byIndex(name, index, value) {
  return wrap((await store(name)).index(index).getAll(value));
}
export async function clearAll() {
  const db = await open();
  const tx = db.transaction(['templates', 'items', 'photos', 'meta'], 'readwrite');
  for (const n of ['templates', 'items', 'photos', 'meta']) tx.objectStore(n).clear();
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

// meta helpers
export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}
export async function setMeta(key, value) { return put('meta', { key, value }); }

// Next SKU number for a template prefix, e.g. MOLD-0001
export async function nextSku(prefix) {
  const key = 'sku:' + prefix;
  const n = (await getMeta(key, 0)) + 1;
  await setMeta(key, n);
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

// Ask the browser not to evict our data (important on phones).
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch { /* ignore */ }
  return null;
}
