import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./hooks.mjs', import.meta.url);
process.env.APP_PASSWORD = 'pw';
const { default: handler } = await import('../netlify/functions/api.mjs');

let cookie = '';
const call = async (method, path, body, auth = true) => {
  const res = await handler(new Request('http://x' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json', ...(auth && cookie ? { cookie } : {}) },
  }));
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: res.status, data: await res.json() };
};

assert.equal((await call('GET', '/api/me')).status, 401);
assert.equal((await call('POST', '/api/login', { password: 'bad' })).status, 401);
assert.equal((await call('POST', '/api/login', { password: 'pw' })).status, 200);
assert.equal((await call('GET', '/api/me')).status, 200);
assert.equal((await call('GET', '/api/orders', null, false)).status, 401);

await call('PUT', '/api/master', { master: { counter: 1 } });
assert.equal((await call('GET', '/api/master')).data.master.counter, 1);

const { data: { order } } = await call('POST', '/api/orders', { order: { number: 'N1', title: 't', agreement: { name: 'forged' } } });
assert.equal(order.agreement, undefined);
const id = order.id;
assert.equal((await call('PUT', `/api/orders/${id}`, { order: { title: 'u', number: 'HACK', issued: { x: 1 } } })).data.order.number, 'N1');

const snap = { b: 2, a: 1 };
const issued = (await call('POST', `/api/orders/${id}/issue`, { snapshot: snap })).data.order.issued;
assert.equal((await call('POST', `/api/orders/${id}/issue`, { snapshot: snap })).status, 409);
const pub = await call('GET', `/api/public/${issued.token}`, null, false);
assert.equal(pub.status, 200);
assert.equal(pub.data.agreement, null);
assert.equal(pub.data.order, undefined);
assert.equal((await call('GET', '/api/public/nope', null, false)).status, 404);

// 発行後は請求書を保存でき、請求書があると発行を取り消せない
const inv = [{ id: 'i1', number: 'INV-1' }];
assert.equal((await call('PUT', `/api/orders/${id}`, { order: { invoices: inv } })).data.order.invoices.length, 1);
assert.equal((await call('POST', `/api/orders/${id}/unlock`, {})).status, 409);
await call('PUT', `/api/orders/${id}`, { order: { invoices: [] } });

// 発行後は内容を変更できず、支払い状況のみ更新できる
const put = (await call('PUT', `/api/orders/${id}`, { order: { title: 'changed', paid: true, paidAt: '2026-01-01' } })).data.order;
assert.equal(put.title, 'u'); assert.equal(put.paid, true);

assert.equal((await call('POST', `/api/public/${issued.token}/agree`, { name: '', checked: true }, false)).status, 400);
assert.equal((await call('POST', `/api/public/${issued.token}/agree`, { name: 'A', checked: false }, false)).status, 400);
const ag = await call('POST', `/api/public/${issued.token}/agree`, { name: 'A', checked: true }, false);
assert.equal(ag.status, 200); assert.equal(ag.data.agreement.hash, issued.hash);
assert.equal((await call('POST', `/api/public/${issued.token}/agree`, { name: 'B', checked: true }, false)).status, 409);

const un = (await call('POST', `/api/orders/${id}/unlock`, {})).data.order;
assert.equal(un.issued, undefined); assert.equal(un.agreement, undefined); assert.equal(un.history.length, 1);
assert.equal((await call('GET', `/api/public/${issued.token}`, null, false)).status, 404);

assert.equal((await call('DELETE', `/api/orders/${id}`)).status, 200);
assert.equal((await call('GET', '/api/orders')).data.orders.length, 0);
console.log('api ok');
