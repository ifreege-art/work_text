const stores = new Map();
export function getStore({ name }) {
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  return {
    async get(k, o) { const v = m.get(k); return v === undefined ? null : o?.type === 'json' ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, String(v)); },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list() { return { blobs: [...m.keys()].map((key) => ({ key })) }; },
  };
}
