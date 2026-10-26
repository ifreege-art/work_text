import { calc, yen } from './core.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
const fmtDate = (d) => (d ? d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, dd) => `${y}年${+m}月${+dd}日`) : '');

// 発行時点の内容を固定した、書類の元データ。非表示指定の項目はここで落とす。
export function buildSnapshot(order, master) {
  const p = master.profile;
  const hide = new Set(p.hide || []);
  const client = master.artists.find((a) => a.id === order.artistId) || { name: '', contact: '', honorific: '様' };
  const t = calc(order);
  const terms = master.terms.filter((x) => x.enabled && !(order.termsOff || []).includes(x.id)).map((x) => ({ title: x.title, body: x.body }));
  return {
    v: 2,
    number: order.number || '',
    title: order.title,
    orderDate: order.orderDate, roughDue: order.roughDue, deadline: order.deadline,
    creator: {
      name: p.name,
      email: hide.has('email') ? '' : p.email,
      sns: hide.has('sns') ? '' : p.sns,
      address: hide.has('address') ? '' : p.address,
      phone: hide.has('phone') ? '' : p.phone,
    },
    client: { name: client.name, contact: client.contact, honorific: client.honorific ?? '様' },
    spec: order.spec, description: order.description, references: order.references,
    totals: t,
    tax: { mode: order.tax.mode, rate: Number(order.tax.rate) || 0 },
    withholding: order.withholding.enabled
      ? { rate: order.withholding.mode === 'custom' ? Number(order.withholding.rate) || 0 : null }
      : null,
    payment: order.payment,
    terms, special: order.special, notes: order.notes,
  };
}

const jpDate = (iso) => new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' });
const row = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${nl(v)}</td></tr>` : '');

export function renderDocument(s, agreement, issuedAt) {
  if (s.v !== 2) return '<p class="notice">旧形式の書類のため表示できません。</p>';
  const cr = s.creator, cl = s.client, sp = s.spec, t = s.totals;
  const party = (label, name, lines) => `
    <div class="party"><div class="party-label">${label}</div>
      <div class="party-name">${esc(name) || '&nbsp;'}</div>
      ${lines.filter(Boolean).map((l) => `<div class="party-line">${esc(l)}</div>`).join('')}</div>`;
  const taxLabel = s.tax.mode === 'inclusive' ? `消費税(内税 ${s.tax.rate}%)` : `消費税(${s.tax.rate}%)`;
  const netLabel = s.tax.mode === 'inclusive' ? '税抜金額' : '小計(税抜)';
  const whLabel = s.withholding
    ? `源泉徴収税額(${s.withholding.rate == null ? '10.21%/20.42%' : s.withholding.rate + '%'})` : '';
  return `
  <article class="doc">
    <header class="doc-head">
      <h1>イラスト制作 発注書</h1>
      <div class="doc-meta">
        ${s.number ? `<div>発注番号:${esc(s.number)}</div>` : ''}
        <div>発注日:${esc(fmtDate(s.orderDate))}</div>
      </div>
    </header>
    <div class="parties">
      ${party('発注者', cl.name + (cl.name ? ' ' + cl.honorific : ''), [cl.contact])}
      ${party('制作者', cr.name, [cr.email, cr.sns, cr.phone, cr.address])}
    </div>
    <p class="lead">下記の内容で、発注者は制作者にイラストの制作を依頼し、制作者はこれを受注します。</p>

    <h2>依頼内容</h2>
    <table class="kv">
      ${row('件名', s.title)}${row('用途', sp.purpose)}${row('利用範囲・媒体', sp.usageScope)}
      ${row('サイズ・解像度', sp.size)}${row('納品形式', sp.format)}
      ${row('ラフ提出期限', fmtDate(s.roughDue))}${row('納期', fmtDate(s.deadline))}
      ${row('修正回数', sp.revisions)}
      ${row('依頼の詳細', s.description)}${row('参考資料', s.references)}
    </table>

    <h2>取り決め事項</h2>
    <table class="kv">
      ${row('著作権・利用許諾', sp.copyright)}${row('クレジット表記', sp.credit)}
      ${row('制作者による実績掲載', sp.portfolio)}${row('生成AIの取扱い', sp.aiPolicy)}
    </table>

    <h2>報酬</h2>
    <table class="items">
      <thead><tr><th>品目</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
      <tbody>${t.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${l.qty}</td><td class="num">${yen(l.unit)}</td><td class="num">${yen(l.amount)}</td></tr>`).join('')}</tbody>
    </table>
    <table class="totals">
      <tr><th>${netLabel}</th><td>${yen(t.net)}</td></tr>
      <tr><th>${taxLabel}</th><td>${yen(t.tax)}</td></tr>
      <tr class="strong"><th>合計(税込)</th><td>${yen(t.gross)}</td></tr>
      ${s.withholding ? `<tr><th>${whLabel}</th><td>−${yen(t.withholding)}</td></tr>
      <tr class="strong"><th>お支払い金額</th><td>${yen(t.payable)}</td></tr>` : ''}
    </table>
    <table class="kv">
      ${row('支払い時期', s.payment.timing)}${row('支払い期日', s.payment.due)}${row('支払い方法', s.payment.method)}
    </table>
    ${s.notes ? `<h2>備考</h2><p class="free">${nl(s.notes)}</p>` : ''}
    ${s.special ? `<h2>特約事項</h2><p class="free">${nl(s.special)}</p>` : ''}

    <h2>規約</h2>
    <ol class="terms">
      ${s.terms.map((x, i) => `<li><strong>第${i + 1}条(${esc(x.title)})</strong><br>${nl(x.body)}</li>`).join('')}
    </ol>

    <h2>同意</h2>
    <p class="small">上記の内容および規約に同意します。</p>
    <div class="sign">
      <div><div class="sign-label">発注者 署名</div><div class="sign-line">${agreement ? esc(agreement.name) : ''}</div>
        <div class="sign-label">日付</div><div class="sign-line">${agreement ? esc(jpDate(agreement.at)) : ''}</div></div>
      <div><div class="sign-label">制作者 署名</div><div class="sign-line">${esc(cr.name)}</div>
        <div class="sign-label">日付</div><div class="sign-line">${issuedAt ? esc(jpDate(issuedAt)) : ''}</div></div>
    </div>
    ${agreement ? `<p class="small hash">電子同意記録:${esc(new Date(agreement.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }))} / 文書ハッシュ(SHA-256) ${esc(agreement.hash)}</p>` : ''}
  </article>`;
}

// 印刷ダイアログの「PDFとして保存」で、ファイル名が書類名になるようにする
export function printAs(name) {
  const prev = document.title;
  document.title = name.replace(/[\\/:*?"<>|]/g, '_');
  window.addEventListener('afterprint', () => { document.title = prev; }, { once: true });
  print();
}
