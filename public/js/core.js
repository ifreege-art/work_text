// ブラウザとFunctionの両方で使う純粋関数

export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

const ROUND = { floor: Math.floor, round: Math.round, ceil: Math.ceil };
const clean = (x) => Math.round(x * 1e6) / 1e6;

// order: { items, tax:{mode,rate,rounding}, withholding:{enabled,mode,rate} }
export function calc(order) {
  const t = order.tax || {};
  const rate = Number(t.rate) || 0;
  const r = ROUND[t.rounding] || Math.floor;
  const lines = (order.items || []).map((i) => ({
    name: i.name || '',
    qty: Number(i.qty) || 0,
    unit: Number(i.unit) || 0,
    amount: r(clean((Number(i.qty) || 0) * (Number(i.unit) || 0))),
  }));
  const sum = lines.reduce((a, l) => a + l.amount, 0);
  let net, tax, gross;
  if (t.mode === 'inclusive') {
    gross = sum;
    tax = r(clean((gross * rate) / (100 + rate)));
    net = gross - tax;
  } else {
    net = sum;
    tax = r(clean((net * rate) / 100));
    gross = net + tax;
  }
  let withholding = 0;
  const w = order.withholding || {};
  if (w.enabled) {
    if (w.mode === 'custom') {
      withholding = Math.floor((net * Math.round((Number(w.rate) || 0) * 100)) / 10000);
    } else {
      // 100万円以下: 10.21% / 超過分: 20.42%(1円未満切り捨て)
      const base = Math.min(net, 1000000);
      const over = Math.max(net - 1000000, 0);
      withholding = Math.floor((base * 1021 + over * 2042) / 10000);
    }
  }
  return { lines, net, tax, gross, withholding, payable: gross - withholding };
}

export const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
