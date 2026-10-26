import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { stableStringify } from '../../public/js/core.js';

export const config = { path: '/api/*' };

const store = (name) => getStore({ name, consistency: 'strong' });
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const fail = (status, error) => json({ error }, status);

// ---- オーナー認証(環境変数 APP_PASSWORD) ----
const secret = () => process.env.SESSION_SECRET || process.env.APP_PASSWORD || '';
const hmac = (s) => crypto.createHmac('sha256', secret()).update(s).digest('base64url');
const safeEqual = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const makeSession = () => {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + 30 * 864e5 })).toString('base64url');
  return `${body}.${hmac(body)}`;
};
const isOwner = (req) => {
  if (!secret()) return false;
  const m = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.get('cookie') || '');
  if (!m) return false;
  const [body, mac] = m[1].split('.');
  if (!body || !mac || !safeEqual(mac, hmac(body))) return false;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now(); } catch { return false; }
};
const cookie = (req, value, maxAge) =>
  `session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${req.url.startsWith('https') ? '; Secure' : ''}`;

const PROTECTED = ['id', 'number', 'createdAt', 'issued', 'agreement', 'history'];

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  const body = ['POST', 'PUT'].includes(method) ? await req.json().catch(() => ({})) : {};
  const [a, b, c] = parts;

  // ---- 公開(同意ページ) ----
  if (a === 'public' && b) {
    const id = await store('tokens').get(b);
    const order = id && (await store('orders').get(id, { type: 'json' }));
    if (!order?.issued || order.issued.token !== b) return fail(404, '見つかりません');
    if (method === 'GET' && !c) {
      const ag = order.agreement;
      return json({
        snapshot: order.issued.snapshot, hash: order.issued.hash, issuedAt: order.issued.at,
        agreement: ag ? { name: ag.name, at: ag.at, hash: ag.hash } : null,
      });
    }
    if (method === 'POST' && c === 'agree') {
      if (order.agreement) return fail(409, 'すでに同意済みです');
      const name = String(body.name || '').trim().slice(0, 100);
      if (!name || body.checked !== true) return fail(400, '氏名と同意のチェックが必要です');
      order.agreement = { name, at: new Date().toISOString(), hash: order.issued.hash };
      await store('orders').setJSON(order.id, order);
      return json({ agreement: order.agreement });
    }
    return fail(404, '見つかりません');
  }

  // ---- 認証 ----
  if (a === 'login' && method === 'POST') {
    if (!process.env.APP_PASSWORD) return fail(500, '環境変数 APP_PASSWORD が未設定です');
    await new Promise((r) => setTimeout(r, 400));
    if (!safeEqual(String(body.password || ''), process.env.APP_PASSWORD)) return fail(401, 'パスワードが違います');
    return json({ ok: true }, 200, { 'set-cookie': cookie(req, makeSession(), 30 * 86400) });
  }
  if (a === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie(req, '', 0) });
  if (!isOwner(req)) return fail(401, '認証が必要です');
  if (a === 'me') return json({ ok: true });

  // ---- マスタ ----
  if (a === 'master') {
    if (method === 'GET') return json({ master: await store('app').get('master', { type: 'json' }) });
    if (method === 'PUT') { await store('app').setJSON('master', body.master); return json({ ok: true }); }
  }

  // ---- 発注書 ----
  const orders = store('orders');
  if (a === 'orders') {
    if (!b) {
      if (method === 'GET') {
        const { blobs } = await orders.list();
        const all = await Promise.all(blobs.map((x) => orders.get(x.key, { type: 'json' })));
        return json({ orders: all.filter(Boolean).sort((p, q) => (q.createdAt || '').localeCompare(p.createdAt || '')) });
      }
      if (method === 'POST') {
        const order = { ...body.order, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
        delete order.issued; delete order.agreement; delete order.history;
        await orders.setJSON(order.id, order);
        return json({ order });
      }
    } else {
      const cur = await orders.get(b, { type: 'json' });
      if (!cur) return fail(404, '見つかりません');
      if (!c) {
        if (method === 'GET') return json({ order: cur });
        if (method === 'PUT') {
          const next = { ...cur };
          if (cur.issued) {
            // 発行後は支払い状況のみ更新できる
            next.paid = !!body.order.paid;
            next.paidAt = body.order.paidAt || '';
          } else {
            Object.assign(next, body.order);
            for (const k of PROTECTED) next[k] = cur[k];
          }
          await orders.setJSON(b, next);
          return json({ order: next });
        }
        if (method === 'DELETE') {
          if (cur.issued) await store('tokens').delete(cur.issued.token);
          await orders.delete(b);
          return json({ ok: true });
        }
      }
      if (c === 'issue' && method === 'POST') {
        if (cur.issued) return fail(409, 'すでに発行済みです');
        const snapshot = body.snapshot;
        if (!snapshot || typeof snapshot !== 'object') return fail(400, 'snapshot が必要です');
        const token = crypto.randomBytes(24).toString('base64url');
        cur.issued = {
          token, at: new Date().toISOString(), snapshot,
          hash: crypto.createHash('sha256').update(stableStringify(snapshot)).digest('hex'),
        };
        await store('tokens').set(token, cur.id);
        await orders.setJSON(cur.id, cur);
        return json({ order: cur });
      }
      if (c === 'unlock' && method === 'POST') {
        if (!cur.issued) return json({ order: cur });
        if (cur.agreement) cur.history = [...(cur.history || []), { issuedAt: cur.issued.at, hash: cur.issued.hash, agreement: cur.agreement }];
        await store('tokens').delete(cur.issued.token);
        delete cur.issued; delete cur.agreement;
        await orders.setJSON(cur.id, cur);
        return json({ order: cur });
      }
    }
  }
  return fail(404, '見つかりません');
};
