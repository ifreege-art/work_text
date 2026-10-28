import { calc, yen } from './core.js';
import { party, itemsTable, totalsTable, row, nl, esc, fmtDate } from './render.js';

const clean = (x) => Math.round(x * 1e6) / 1e6;

// 発注額(入力基準の金額。税込入力なら税込、税抜入力なら税抜)
export const orderBase = (snap) => (snap.tax.mode === 'inclusive' ? snap.totals.gross : snap.totals.net);
export const basisOf = (snap) => (snap.tax.mode === 'inclusive' ? '税込' : '税抜');

// 請求書1通ぶんの本体金額(追加明細を除く)
export function invoiceBase(snap, inv) {
  const total = orderBase(snap);
  if (inv.mode === 'percent') return Math.floor(clean((total * (Number(inv.percent) || 0)) / 100));
  if (inv.mode === 'amount') return Number(inv.amount) || 0;
  return total;
}
export const billed = (snap, invoices, exceptId) =>
  (invoices || []).filter((i) => i.id !== exceptId).reduce((a, i) => a + invoiceBase(snap, i), 0);
export const remaining = (snap, invoices, exceptId) => orderBase(snap) - billed(snap, invoices, exceptId);

export function invoiceModel(order, inv) {
  const snap = order.issued.snapshot;
  const title = snap.title || 'イラスト制作';
  let lines;
  if (inv.mode === 'full') lines = snap.totals.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit }));
  else {
    const label = inv.label || (inv.mode === 'percent' ? `制作費(${inv.percent}%分)` : '制作費');
    lines = [{ name: `${title} ${label}`, qty: 1, unit: invoiceBase(snap, inv) }];
  }
  lines = lines.concat((inv.extra || []).filter((x) => x.name || x.unit).map((x) => ({ name: x.name, qty: x.qty, unit: x.unit })));
  const wh = snap.withholding
    ? { enabled: true, mode: snap.withholding.rate == null ? 'auto' : 'custom', rate: snap.withholding.rate }
    : { enabled: false };
  return { snap, totals: calc({ items: lines, tax: snap.tax, withholding: wh }) };
}

export function renderInvoice(order, inv) {
  const { snap, totals: t } = invoiceModel(order, inv);
  const cr = snap.creator, cl = snap.client;
  return `
  <article class="doc">
    <header class="doc-head">
      <h1>請求書</h1>
      <div class="doc-meta">
        ${inv.number ? `<div>請求番号:${esc(inv.number)}</div>` : ''}
        <div>請求日:${esc(fmtDate(inv.date))}</div>
      </div>
    </header>
    <div class="parties">
      ${party('請求先', cl.name + (cl.name ? ' ' + cl.honorific : ''), [cl.contact])}
      ${party('請求元', cr.name, [inv.reg ? `登録番号:${inv.reg}` : '', cr.email, cr.sns, cr.phone, cr.address])}
    </div>
    <p class="lead">下記の通り、ご請求申し上げます。</p>
    <div class="billbox"><span>ご請求金額(税込)</span><strong>${yen(t.gross)}</strong></div>
    <table class="kv">
      ${row('件名', snap.title)}${row('発注書番号', snap.number)}${row('取引年月日', fmtDate(inv.txDate))}
      ${row('支払期日', inv.due ? fmtDate(inv.due) : snap.payment.due)}
    </table>
    <h2>請求内容</h2>
    ${itemsTable(t.lines, basisOf(snap))}
    ${totalsTable(snap.tax, t, snap.withholding)}
    <table class="kv">${row('振込先・支払い方法', snap.payment.method)}</table>
    ${inv.notes ? `<h2>備考</h2><p class="free">${nl(inv.notes)}</p>` : ''}
  </article>`;
}

// 発注書の入金状況を、請求書の入金に連動させる
export function syncPaid(order) {
  const invs = order.invoices || [];
  if (!invs.length) return;
  const done = invs.every((i) => i.paid) && remaining(order.issued.snapshot, invs) <= 0;
  order.paid = done;
  order.paidAt = done ? invs.map((i) => i.paidAt).filter(Boolean).sort().pop() || '' : '';
}
