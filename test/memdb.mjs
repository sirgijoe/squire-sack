// In-memory stand-in for src/js/db.js, so sync can be tested in Node.
export function memDb() {
  const stores = { templates: new Map(), items: new Map(), photos: new Map(), meta: new Map() };
  const key = (name, rec) => (name === 'meta' ? rec.key : rec.id);
  const clone = (r) => (r ? { ...r } : r);
  let clock = 1_000_000;
  const api = {
    stores,
    tick: (ms = 1) => (clock += ms),
    now: () => clock,
    async getAll(name) { return [...stores[name].values()].map(clone); },
    async get(name, id) { return clone(stores[name].get(id)); },
    async put(name, rec) { rec.updatedAt = ++clock; stores[name].set(key(name, rec), { ...rec }); return rec; },
    async putRaw(name, rec) { stores[name].set(key(name, rec), { ...rec }); return rec; },
    async getMeta(k, fb = null) { const r = stores.meta.get(k); return r ? r.value : fb; },
    async setMeta(k, value) { return api.put('meta', { key: k, value }); },
  };
  return api;
}
