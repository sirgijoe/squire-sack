// Squire — phone <-> desktop "home base" sync over home Wi-Fi.
//
// The desktop app runs a small server (see src-tauri/src/home_base.rs, or tools/home-base.mjs for a
// plain-Node version). Phones pair with a 6-digit code (or by scanning its QR code), then sync:
//   1. push every record changed since the last push, pull everything the server got since lastSeq
//      (newest edit wins, record by record)
//   2. upload full-size photos the home base doesn't have yet
//   3. download thumbnails (and, on the desktop, full photos) this device is missing
//   4. "offload": once the home base confirms it has a photo, a phone can drop its full-size copy
//      and keep only the thumbnail. Full photos then load from the home base when it's reachable.
//
// Protocol (JSON over HTTP, token in "Authorization: Bearer …"):
//   GET  /api/hello                     -> { app:'squire', kind:'home-base', name, serverId, version }
//   POST /api/pair    {code, deviceName}-> { token, serverId, name }
//   POST /api/sync    {since, changes:[{store, rec}]} -> { seq, changes:[{store, rec}], missingPhotos:[id] }
//   POST /api/photos/have {ids}         -> { have:[id] }
//   PUT  /api/photo/<id>/full|thumb     (image/jpeg body)
//   GET  /api/photo/<id>/full|thumb[?t=token]

export const SYNC_STORES = ['templates', 'items', 'photos', 'meta'];
const CONFIG_KEY = 'sync:config';
const keyOf = (store, rec) => (store === 'meta' ? rec.key : rec.id);
export const isLocalOnlyMeta = (key) => String(key).startsWith('sync:');

export function createSync({ db, fetchFn = (...a) => fetch(...a), now = () => Date.now() }) {
  let running = null;

  async function getConfig() { return (await db.getMeta(CONFIG_KEY, null)) || null; }
  async function setConfig(cfg) { await db.setMeta(CONFIG_KEY, cfg); return cfg; }

  const clean = (url) => String(url || '').trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'http://');

  async function call(cfg, path, { method = 'GET', body, raw, timeout = 20000 } = {}) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
    try {
      const headers = {};
      if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
      let payload;
      if (raw) { headers['Content-Type'] = 'image/jpeg'; payload = raw; }
      else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      const res = await fetchFn(cfg.url + path, { method, headers, body: payload, signal: ctl?.signal });
      if (res.status === 401) throw Object.assign(new Error('This device is no longer paired with the home base. Pair it again.'), { code: 401 });
      if (!res.ok) throw new Error(`Home base answered ${res.status}`);
      return res;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The home base did not answer in time. Is the desktop app open and on the same Wi-Fi?');
      if (err instanceof TypeError) throw new Error("Can't reach the home base. Is the desktop app open and on the same Wi-Fi?");
      throw err;
    } finally { if (timer) clearTimeout(timer); }
  }

  async function hello(url) {
    const res = await call({ url: clean(url) }, '/api/hello', { timeout: 5000 });
    const j = await res.json();
    if (j.app !== 'squire') throw new Error("That address isn't a Squire home base.");
    return j;
  }

  async function pair(url, code, deviceName = 'My phone', { offload = true } = {}) {
    url = clean(url);
    const res = await call({ url }, '/api/pair', { method: 'POST', body: { code: String(code).replace(/\D/g, ''), deviceName } })
      .catch((e) => { throw /403/.test(e.message) ? new Error('That code is wrong or has expired. Make a new one on the desktop.') : e; });
    const j = await res.json();
    return setConfig({ url, token: j.token, serverId: j.serverId, serverName: j.name, deviceName, offload, lastSeq: 0, lastPush: 0, lastSync: 0 });
  }

  // Desktop app: sync its own window with the home base running on the same computer.
  async function connectLocal(url, token, serverId, serverName) {
    const cur = await getConfig();
    if (cur && cur.url === url && cur.token === token) return cur;
    return setConfig({ url, token, serverId, serverName, deviceName: 'This computer', offload: false, keepFull: true, lastSeq: 0, lastPush: 0, lastSync: 0, local: true });
  }

  async function unpair() { await db.setMeta(CONFIG_KEY, null); }

  // Merge one incoming record into the local database. Returns true if it changed anything.
  async function applyIncoming(store, rec) {
    const key = keyOf(store, rec);
    if (key == null) return false;
    if (store === 'meta' && isLocalOnlyMeta(key)) return false;
    const cur = await db.get(store, key);
    if (store === 'meta' && String(key).startsWith('sku:')) {
      const v = Math.max(Number(cur?.value || 0), Number(rec.value || 0));
      if (cur && Number(cur.value) === v) return false;
      await db.putRaw('meta', { key, value: v, updatedAt: Math.max(cur?.updatedAt || 0, rec.updatedAt || 0) });
      return true;
    }
    if (cur && (cur.updatedAt || 0) >= (rec.updatedAt || 0)) return false;
    if (store === 'photos') {
      const merged = { ...rec, full: cur?.full ?? null, thumb: cur?.thumb ?? null };
      if (rec.deleted) { merged.full = null; merged.thumb = null; }
      await db.putRaw('photos', merged);
    } else {
      await db.putRaw(store, rec);
    }
    return true;
  }

  async function syncNow(onProgress = () => {}) {
    if (running) return running;
    running = (async () => {
      const cfg = await getConfig();
      if (!cfg || !cfg.token) throw new Error('Not paired with a home base yet.');
      const started = now();
      onProgress('Gathering changes…');
      const changes = [];
      for (const store of SYNC_STORES) {
        for (const rec of await db.getAll(store)) {
          if ((rec.updatedAt || 0) < (cfg.lastPush || 0)) continue;
          if (store === 'meta' && isLocalOnlyMeta(rec.key)) continue;
          if (store === 'photos') { const { full, thumb, ...meta } = rec; changes.push({ store, rec: meta }); }
          else changes.push({ store, rec });
        }
      }
      onProgress(`Sending ${changes.length} change${changes.length === 1 ? '' : 's'}…`);
      const res = await (await call(cfg, '/api/sync', { method: 'POST', body: { since: cfg.lastSeq || 0, changes }, timeout: 120000 })).json();

      let received = 0;
      for (const c of res.changes || []) if (await applyIncoming(c.store, c.rec)) received++;

      // upload full-size photos the home base is missing
      let uploaded = 0;
      const missing = res.missingPhotos || [];
      for (let i = 0; i < missing.length; i++) {
        const p = await db.get('photos', missing[i]);
        if (!p || p.deleted || !p.full) continue;
        onProgress(`Uploading photos ${i + 1}/${missing.length}…`);
        await call(cfg, `/api/photo/${encodeURIComponent(p.id)}/full`, { method: 'PUT', raw: p.full, timeout: 120000 });
        if (p.thumb) await call(cfg, `/api/photo/${encodeURIComponent(p.id)}/thumb`, { method: 'PUT', raw: p.thumb });
        uploaded++;
      }

      // download photos this device lacks
      const photos = (await db.getAll('photos')).filter((p) => !p.deleted);
      const needThumb = photos.filter((p) => !p.thumb);
      const needFull = cfg.keepFull ? photos.filter((p) => !p.full) : [];
      let downloaded = 0;
      for (const [list, kind] of [[needThumb, 'thumb'], [needFull, 'full']]) {
        for (let i = 0; i < list.length; i++) {
          onProgress(`Downloading ${kind === 'thumb' ? 'thumbnails' : 'photos'} ${i + 1}/${list.length}…`);
          try {
            const r = await call(cfg, `/api/photo/${encodeURIComponent(list[i].id)}/${kind}`, { timeout: 60000 });
            const blob = new Blob([await r.arrayBuffer()], { type: 'image/jpeg' });
            const cur = await db.get('photos', list[i].id);
            if (!cur) continue;
            cur[kind] = blob;
            if (kind === 'full') cur.offloaded = false;
            await db.putRaw('photos', cur);
            downloaded++;
          } catch (err) { if (err.code === 401) throw err; /* not on the home base yet — try next time */ }
        }
      }

      // offload full-size photos the home base has confirmed it keeps
      let offloaded = 0;
      if (cfg.offload && !cfg.keepFull) {
        const local = (await db.getAll('photos')).filter((p) => !p.deleted && p.full && p.thumb);
        for (let i = 0; i < local.length; i += 200) {
          const ids = local.slice(i, i + 200).map((p) => p.id);
          const have = new Set((await (await call(cfg, '/api/photos/have', { method: 'POST', body: { ids } })).json()).have || []);
          for (const id of ids) {
            if (!have.has(id)) continue;
            const p = await db.get('photos', id);
            if (!p || !p.full) continue;
            p.full = null; p.offloaded = true;
            await db.putRaw('photos', p);
            offloaded++;
          }
        }
      }

      const next = { ...(await getConfig()), lastSeq: res.seq || 0, lastPush: started, lastSync: now() };
      await setConfig(next);
      const summary = { sent: changes.length, received, uploaded, downloaded, offloaded };
      onProgress('Synced');
      return summary;
    })();
    try { return await running; } finally { running = null; }
  }

  // URL to show a full photo that lives only on the home base (null if not paired).
  async function remotePhotoUrl(id, kind = 'full') {
    const cfg = await getConfig();
    if (!cfg?.token) return null;
    return `${cfg.url}/api/photo/${encodeURIComponent(id)}/${kind}?t=${encodeURIComponent(cfg.token)}`;
  }

  // Full-size photo for exports: local copy, else fetch it from the home base, else the thumbnail.
  async function fullBlob(p) {
    if (p.full) return p.full;
    const cfg = await getConfig();
    if (cfg?.token) {
      try {
        const r = await call(cfg, `/api/photo/${encodeURIComponent(p.id)}/full`, { timeout: 60000 });
        return new Blob([await r.arrayBuffer()], { type: 'image/jpeg' });
      } catch { /* fall back */ }
    }
    return p.thumb;
  }

  return { getConfig, setConfig, hello, pair, connectLocal, unpair, syncNow, applyIncoming, remotePhotoUrl, fullBlob, clean };
}
