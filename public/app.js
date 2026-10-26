import { calc, yen } from './js/core.js';
import { buildSnapshot, renderDocument, printAs, esc } from './js/render.js';
import {
  DEFAULT_MASTER, DEFAULT_ORDER, DEFAULT_TERMS, COPYRIGHT_OPTIONS, CREDIT_OPTIONS,
  PORTFOLIO_OPTIONS, AI_OPTIONS, PURPOSE_SUGGESTIONS, PAYMENT_TIMINGS,
} from './js/defaults.js';

const bar = document.getElementById('bar');
const main = document.getElementById('main');
const toastEl = document.getElementById('toast');

let master = null;
let orders = [];
let order = null;      // 編集中の発注書
let isNew = false;
const mq = matchMedia('(max-width: 900px)');
const readonly = () => mq.matches; // スマホ幅は閲覧専用

// ---------- utilities ----------
async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method, headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('auth'); }
  if (!res.ok) throw new Error(data.error || `エラー(${res.status})`);
  return data;
}
function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (toastEl.hidden = true), 2200);
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.'); const last = ks.pop();
  ks.reduce((a, k) => a[k], o)[last] = v;
}
const uid = () => Math.random().toString(36).slice(2, 10);
const run = (fn) => fn().catch((e) => { if (e.message !== 'auth') toast(e.message); });

// ---------- form helpers ----------
function F(obj, label, path, o = {}) {
  const v = getPath(obj, path) ?? '';
  const attrs = `data-bind="${path}" ${o.num ? 'data-num' : ''} ${o.list ? `list="${o.list}"` : ''} placeholder="${esc(o.ph || '')}"`;
  const input = o.rows
    ? `<textarea ${attrs} rows="${o.rows}">${esc(v)}</textarea>`
    : `<input type="${o.type || 'text'}" value="${esc(v)}" ${attrs}>`;
  return `<label>${esc(label)}${input}</label>`;
}
function S(obj, label, path, options) {
  const v = getPath(obj, path);
  return `<label>${esc(label)}<select data-bind="${path}">${options.map((x) => {
    const [val, text] = Array.isArray(x) ? x : [x, x];
    return `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(text)}</option>`;
  }).join('')}</select></label>`;
}
function C(obj, label, path) {
  return `<label class="check"><input type="checkbox" data-bind="${path}" ${getPath(obj, path) ? 'checked' : ''}> ${esc(label)}</label>`;
}
function bind(root, obj, onChange) {
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.bind) {
      const v = el.type === 'checkbox' ? el.checked : el.dataset.num !== undefined ? (el.value === '' ? '' : Number(el.value)) : el.value;
      setPath(obj, el.dataset.bind, v);
      onChange(el.dataset.bind);
    } else if (el.dataset.set) { // 配列に値を出し入れするチェックボックス
      const arr = getPath(obj, el.dataset.set);
      const inList = el.dataset.invert ? !el.checked : el.checked;
      const i = arr.indexOf(el.dataset.val);
      if (inList && i < 0) arr.push(el.dataset.val);
      if (!inList && i >= 0) arr.splice(i, 1);
      onChange(el.dataset.set);
    }
  });
}

// ---------- shell ----------
function renderBar(route) {
  const ro = readonly();
  const link = (h, t, on) => `<a href="${h}" class="${on ? 'on' : ''}">${t}</a>`;
  bar.innerHTML = `${link('#/', '発注書', route === '' || route.startsWith('order'))}${link('#/master/profile', 'マスタ', route.startsWith('master'))}
    <span class="sp"></span>${ro ? '<span class="muted small">閲覧モード</span>' : ''}<button id="logout">ログアウト</button>`;
  document.getElementById('logout').onclick = () => run(async () => { await api('/logout', 'POST'); showLogin(); });
}
function showLogin() {
  bar.innerHTML = '';
  main.innerHTML = `<form class="card login"><h3>ログイン</h3>
    <label>パスワード<input type="password" id="pw" autocomplete="current-password" autofocus></label>
    <button class="primary" style="width:100%">ログイン</button><p class="err" id="lerr"></p></form>`;
  main.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/login', 'POST', { password: document.getElementById('pw').value }); await start(); }
    catch (err) { document.getElementById('lerr').textContent = err.message; }
  };
}

// ---------- 一覧 ----------
function statusTag(o) {
  if (o.agreement) return '<span class="tag ok">同意済み</span>';
  if (o.issued) return '<span class="tag acc">発行済み(同意待ち)</span>';
  return '<span class="tag">下書き</span>';
}
function viewList() {
  const ro = readonly();
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h2 class="page">発注書</h2>
    ${ro ? '' : '<a class="btn primary" href="#/order/new">新規作成</a>'}</div>
    ${orders.length ? `<table class="list"><thead><tr><th>番号</th><th>件名</th><th>発注者</th><th class="hide-sm">発注日</th><th>税込合計</th><th>状態</th><th>支払い</th></tr></thead><tbody>
    ${orders.map((o) => {
      const a = master.artists.find((x) => x.id === o.artistId);
      return `<tr class="click" data-id="${o.id}"><td>${esc(o.number)}</td><td>${esc(o.title) || '(無題)'}</td><td>${esc(a?.name || '')}</td>
      <td class="hide-sm">${esc(o.orderDate)}</td><td>${yen(calc(o).gross)}</td><td>${statusTag(o)}</td>
      <td>${ro ? `<span class="tag ${o.paid ? 'ok' : 'warn'}">${o.paid ? '支払い済み' : '未払い'}</span>`
        : `<button class="paid" data-id="${o.id}">${o.paid ? '✓ 支払い済み' : '未払い'}</button>`}</td></tr>`;
    }).join('')}</tbody></table>` : '<p class="muted">まだ発注書がありません。</p>'}`;
  main.querySelectorAll('tr.click').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('button')) location.hash = '#/order/' + tr.dataset.id; }));
  main.querySelectorAll('button.paid').forEach((b) => (b.onclick = () => run(async () => {
    const o = orders.find((x) => x.id === b.dataset.id);
    const next = { ...o, paid: !o.paid, paidAt: o.paid ? '' : new Date().toISOString().slice(0, 10) };
    Object.assign(o, (await api('/orders/' + o.id, 'PUT', { order: next })).order);
    viewList();
  })));
}

// ---------- 発注書 ----------
const nextNumber = () => {
  const d = new Date();
  return `${master.profile.numberPrefix || 'ORD'}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${String(master.counter + 1).padStart(3, '0')}`;
};
const previewHtml = () => {
  if (order.issued) return renderDocument(order.issued.snapshot, order.agreement, order.issued.at);
  return renderDocument(buildSnapshot(order, master));
};

function orderForm() {
  const o = order;
  const w = o.withholding;
  return `
  <div class="card"><h3>基本</h3>
    ${F(o, '件名', 'title', { ph: '例:キャラクターイラスト制作' })}
    <label>発注者(依頼者)<select data-bind="artistId"><option value="">選択してください</option>
      ${master.artists.map((a) => `<option value="${a.id}" ${a.id === o.artistId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <div class="grid3">${F(o, '発注日', 'orderDate', { type: 'date' })}${F(o, 'ラフ提出期限', 'roughDue', { type: 'date' })}${F(o, '納期', 'deadline', { type: 'date' })}</div>
  </div>
  <div class="card"><h3>依頼内容</h3>
    ${F(o, '用途', 'spec.purpose', { list: 'purposes' })}<datalist id="purposes">${PURPOSE_SUGGESTIONS.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    ${F(o, '利用範囲・媒体', 'spec.usageScope', { ph: '例:SNSアイコン、自サイト、配信サムネ' })}
    <div class="grid2">${F(o, 'サイズ・解像度', 'spec.size', { ph: '例:3000×3000px 350dpi' })}${F(o, '納品形式', 'spec.format', { ph: '例:PNG(透過)・PSD' })}</div>
    ${F(o, '修正回数', 'spec.revisions')}
    ${F(o, '依頼の詳細', 'description', { rows: 6, ph: 'キャラクター、構図、雰囲気、ポーズ、背景など' })}
    ${F(o, '参考資料', 'references', { rows: 3, ph: 'URLや資料の説明' })}
  </div>
  <div class="card"><h3>取り決め事項</h3>
    ${S(o, '著作権・利用許諾', 'spec.copyright', COPYRIGHT_OPTIONS)}
    <div class="grid2">${S(o, 'クレジット表記', 'spec.credit', CREDIT_OPTIONS)}${S(o, '実績掲載', 'spec.portfolio', PORTFOLIO_OPTIONS)}</div>
    ${S(o, '生成AIの取扱い', 'spec.aiPolicy', AI_OPTIONS)}
  </div>
  <div class="card"><h3>報酬</h3>
    ${o.items.map((it, i) => `<div class="item-row">
      <input data-bind="items.${i}.name" value="${esc(it.name)}" placeholder="品目">
      <input type="number" data-num data-bind="items.${i}.qty" value="${it.qty}" min="0" step="any">
      <input type="number" data-num data-bind="items.${i}.unit" value="${it.unit}" min="0" step="any">
      <button class="danger" data-rm="${i}" title="削除">×</button></div>`).join('')}
    <button id="addItem">＋ 明細を追加</button>
    <div class="grid3" style="margin-top:12px">
      ${S(o, '入力金額', 'tax.mode', [['exclusive', '税抜で入力'], ['inclusive', '税込で入力']])}
      ${F(o, '消費税率(%)', 'tax.rate', { type: 'number', num: true })}
      ${S(o, '端数処理', 'tax.rounding', [['floor', '切り捨て'], ['round', '四捨五入'], ['ceil', '切り上げ']])}
    </div>
    ${C(o, '源泉徴収を差し引いて支払われる', 'withholding.enabled')}
    ${w.enabled ? `<div class="grid2">${S(o, '税率', 'withholding.mode', [['auto', '10.21%(100万円超は超過分20.42%)'], ['custom', '任意の税率']])}
      ${w.mode === 'custom' ? F(o, '税率(%)', 'withholding.rate', { type: 'number', num: true }) : ''}</div>` : ''}
    <div style="margin-top:8px">${S(o, '支払い時期', 'payment.timing', PAYMENT_TIMINGS)}</div>
    <div class="grid2">${F(o, '支払い方法', 'payment.method', { rows: 2, ph: '振込先・PayPay・PayPalなど' })}${F(o, '支払い期日', 'payment.due', { ph: '例:ラフ承認後3日以内' })}</div>
    <p id="totalLine" class="small muted"></p>
  </div>
  <div class="card"><h3>規約・特約</h3>
    <p class="small muted">この発注書に含める条文(条文の編集はマスタの「規約」)</p>
    ${master.terms.filter((t) => t.enabled).map((t) => `<label class="check"><input type="checkbox" data-set="termsOff" data-invert="1" data-val="${t.id}" ${o.termsOff.includes(t.id) ? '' : 'checked'}> ${esc(t.title)}</label>`).join('')}
    ${F(o, '特約事項', 'special', { rows: 3 })}${F(o, '備考', 'notes', { rows: 3 })}
  </div>`;
}

function updateTotalLine() {
  const t = calc(order);
  const el = document.getElementById('totalLine');
  if (el) el.textContent = `税抜 ${yen(t.net)} / 消費税 ${yen(t.tax)} / 税込 ${yen(t.gross)}` + (order.withholding.enabled ? ` / 源泉 −${yen(t.withholding)} / 支払額 ${yen(t.payable)}` : '');
}

function viewOrder(id) {
  const open = (o, n) => { order = o; isNew = n; drawOrder(); };
  if (id === 'new') {
    if (readonly()) { location.hash = '#/'; return; }
    const o = DEFAULT_ORDER(master); o.number = nextNumber(); return open(o, true);
  }
  const found = orders.find((x) => x.id === id);
  if (!found) { location.hash = '#/'; return; }
  const o = structuredClone(found);
  if (!o.issued) o.payment.timing ??= PAYMENT_TIMINGS[1];
  open(o, false);
}

function drawOrder() {
  const ro = readonly();
  const locked = !!order.issued;
  const url = locked ? `${location.origin}/agree.html?t=${order.issued.token}` : '';
  main.innerHTML = `
  <div class="row no-print" style="margin-bottom:12px"><a class="btn" href="#/">← 一覧</a>
    <strong>${esc(order.number)}</strong> ${statusTag(order)}
    <span class="sp" style="flex:1"></span>
    ${ro ? '' : `
      ${locked ? '' : '<button id="save" class="primary">保存</button><button id="issue">発行(確定)</button>'}
      <button id="print">PDF保存・印刷</button>
      ${isNew ? '' : '<button id="dup">複製</button><button id="del" class="danger">削除</button>'}`}
    ${ro ? '<button id="print">PDF保存・印刷</button>' : ''}
  </div>
  ${locked ? `<div class="card no-print">
    <h3>同意用URL</h3>
    <div class="urlbox"><input id="shareUrl" readonly value="${esc(url)}"><button id="copy">コピー</button></div>
    <p class="small muted">${order.agreement ? `${esc(order.agreement.name)} さんが ${esc(new Date(order.agreement.at).toLocaleString('ja-JP'))} に同意しました。` : 'このURLを発注者に送ってください。同意が行われるとここに記録されます。'}</p>
    ${ro ? '' : `<div class="row"><label class="check"><input type="checkbox" id="paidChk" ${order.paid ? 'checked' : ''}> 支払い済み</label>
      <button id="unlock" class="danger">発行を取り消して編集に戻す</button></div>`}
  </div>` : ''}
  <div class="editor">
    ${ro ? '' : `<div class="form"><fieldset style="border:0;padding:0;margin:0" ${locked ? 'disabled' : ''}>${orderForm()}</fieldset></div>`}
    <div class="preview"><div class="paper" id="doc"></div></div>
  </div>`;
  const doc = document.getElementById('doc');
  const refresh = () => { doc.innerHTML = previewHtml(); updateTotalLine(); };
  refresh();
  document.getElementById('print')?.addEventListener('click', () => printAs(`発注書_${order.number}_${order.title}`));
  if (ro) return;

  const form = main.querySelector('.form');
  const redraw = () => { const y = form.scrollTop; drawOrder(); main.querySelector('.form').scrollTop = y; };
  bind(form, order, (p) => { if (p.startsWith('withholding.') && ['withholding.enabled', 'withholding.mode'].includes(p)) redraw(); else refresh(); });
  document.getElementById('addItem')?.addEventListener('click', () => { order.items.push({ name: '', qty: 1, unit: 0 }); redraw(); });
  main.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { order.items.splice(+b.dataset.rm, 1); redraw(); }));

  const save = async () => {
    if (isNew) {
      const { order: o } = await api('/orders', 'POST', { order });
      master.counter += 1;
      await api('/master', 'PUT', { master });
      orders.unshift(o); order = o; isNew = false;
      history.replaceState(null, '', '#/order/' + o.id);
    } else {
      const { order: o } = await api('/orders/' + order.id, 'PUT', { order });
      Object.assign(orders.find((x) => x.id === o.id), o); order = structuredClone(o);
    }
  };
  document.getElementById('save')?.addEventListener('click', () => run(async () => { await save(); toast('保存しました'); drawOrder(); }));
  document.getElementById('issue')?.addEventListener('click', () => run(async () => {
    if (!order.title.trim() || !order.artistId || !master.profile.name.trim()) { toast('件名・発注者の選択・マスタの自分の名前を入力してください'); return; }
    const client = master.artists.find((a) => a.id === order.artistId);
    const warns = [
      !order.spec.purpose.trim() && '用途が未入力です(用途外の使用を制限する根拠になります)',
      !order.deadline && '納期が未設定です',
      !(calc(order).gross > 0) && '報酬が0円です',
      !client?.contact.trim() && '発注者の連絡先が未入力です',
      !(master.profile.email.trim() || master.profile.sns.trim()) && '自分の連絡先(メール・SNS)が未入力です',
    ].filter(Boolean);
    if (warns.length && !confirm('次の点を確認してください。\n・' + warns.join('\n・') + '\n\nこのまま発行しますか?')) return;
    await save();
    const { order: o } = await api(`/orders/${order.id}/issue`, 'POST', { snapshot: buildSnapshot(order, master) });
    Object.assign(orders.find((x) => x.id === o.id), o); order = structuredClone(o);
    drawOrder(); toast('発行しました');
  }));
  document.getElementById('copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('コピーしました'); } catch { document.getElementById('shareUrl').select(); }
  });
  document.getElementById('paidChk')?.addEventListener('change', (e) => run(async () => {
    const next = { ...order, paid: e.target.checked, paidAt: e.target.checked ? new Date().toISOString().slice(0, 10) : '' };
    const { order: o } = await api('/orders/' + order.id, 'PUT', { order: next });
    Object.assign(orders.find((x) => x.id === o.id), o); order = structuredClone(o); toast('更新しました');
  }));
  document.getElementById('unlock')?.addEventListener('click', () => run(async () => {
    if (!confirm((order.agreement ? '同意済みの記録は履歴に退避され、新しい版として再発行が必要になります。' : '同意用URLは無効になります。') + '\n取り消しますか?')) return;
    const { order: o } = await api(`/orders/${order.id}/unlock`, 'POST', {});
    Object.assign(orders.find((x) => x.id === o.id), o); order = structuredClone(o); drawOrder();
  }));
  document.getElementById('dup')?.addEventListener('click', () => {
    const copy = structuredClone(order);
    for (const k of ['id', 'createdAt', 'issued', 'agreement', 'history']) delete copy[k];
    Object.assign(copy, { number: nextNumber(), paid: false, paidAt: '', orderDate: new Date().toISOString().slice(0, 10) });
    order = copy; isNew = true; history.replaceState(null, '', '#/order/new'); drawOrder(); toast('複製しました(未保存)');
  });
  document.getElementById('del')?.addEventListener('click', () => run(async () => {
    if (!confirm('この発注書を削除します。元に戻せません。')) return;
    await api('/orders/' + order.id, 'DELETE');
    orders = orders.filter((x) => x.id !== order.id); location.hash = '#/';
  }));
}

// ---------- マスタ ----------
const TABS = [['profile', '自分(制作者)'], ['artists', '依頼者'], ['terms', '規約'], ['defaults', '既定値・バックアップ']];

function viewMaster(tab) {
  tab = TABS.some((t) => t[0] === tab) ? tab : 'profile';
  const ro = readonly();
  const p = master.profile;
  const body = {
    profile: () => `<div class="card"><h3>制作者(自分)の情報</h3>
      ${F(master, '名前・屋号', 'profile.name')}
      <div class="grid2">${F(master, 'メールアドレス', 'profile.email')}${F(master, 'SNS・連絡先', 'profile.sns', { ph: '例:X @example' })}</div>
      <div class="grid2">${F(master, '電話番号', 'profile.phone')}${F(master, '住所', 'profile.address')}</div>
      <p class="small muted">書類に表示しない項目(発行時に除外され、同意ページにも出ません)</p>
      <div class="row">${[['email', 'メール'], ['sns', 'SNS'], ['phone', '電話'], ['address', '住所']].map(([k, t]) =>
        `<label class="check"><input type="checkbox" data-set="profile.hide" data-val="${k}" ${p.hide.includes(k) ? 'checked' : ''}> ${t}を伏せる</label>`).join('')}</div></div>`,
    artists: () => `${master.artists.map((a, i) => `<div class="card"><div class="row" style="justify-content:space-between"><h3>${esc(a.name) || '(未入力)'}</h3>
      <button class="danger" data-rm-artist="${i}">削除</button></div>
      <div class="grid2">${F(master, '名前', `artists.${i}.name`)}${F(master, '敬称', `artists.${i}.honorific`)}</div>
      ${F(master, '連絡先(SNS・メール)', `artists.${i}.contact`)}${F(master, 'メモ(書類には出ません)', `artists.${i}.note`, { rows: 2 })}</div>`).join('') || '<p class="muted">まだ登録がありません。</p>'}
      <button id="addArtist">＋ 依頼者を追加</button>`,
    terms: () => `${master.terms.map((t, i) => `<div class="term"><div class="row">
      <label class="check" style="margin:0"><input type="checkbox" data-bind="terms.${i}.enabled" ${t.enabled ? 'checked' : ''}> 有効</label>
      <input data-bind="terms.${i}.title" value="${esc(t.title)}" style="flex:1;min-width:160px">
      <button data-mv="${i}:-1">↑</button><button data-mv="${i}:1">↓</button><button class="danger" data-rm-term="${i}">削除</button></div>
      <textarea data-bind="terms.${i}.body" rows="4">${esc(t.body)}</textarea></div>`).join('')}
      <div class="row"><button id="addTerm">＋ 条文を追加</button><button id="resetTerms" class="danger">初期の条文に戻す</button></div>
      <p class="small muted">条文は雛形であり、法的な内容を保証するものではありません。必要に応じて専門家に確認してください。</p>`,
    defaults: () => `<div class="card"><h3>新規発注書の既定値</h3>
      <div class="grid3">${S(master, '入力金額', 'profile.tax.mode', [['exclusive', '税抜で入力'], ['inclusive', '税込で入力']])}
      ${F(master, '消費税率(%)', 'profile.tax.rate', { type: 'number', num: true })}${S(master, '端数処理', 'profile.tax.rounding', [['floor', '切り捨て'], ['round', '四捨五入'], ['ceil', '切り上げ']])}</div>
      ${C(master, '源泉徴収を既定でオンにする', 'profile.withholding.enabled')}
      <div class="grid2">${S(master, '源泉徴収の税率', 'profile.withholding.mode', [['auto', '10.21%(100万円超は超過分20.42%)'], ['custom', '任意の税率']])}${F(master, '任意税率(%)', 'profile.withholding.rate', { type: 'number', num: true })}</div>
      ${F(master, '支払い方法の既定値', 'profile.defaultPayment', { rows: 2 })}${F(master, '発注番号の接頭辞', 'profile.numberPrefix')}</div>
      <div class="card"><h3>バックアップ</h3><button id="export">全データをJSONで書き出す</button></div>`,
  }[tab]();
  main.innerHTML = `<h2 class="page">マスタ</h2>
    <div class="tabs">${TABS.map(([k, t]) => `<a href="#/master/${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</div>
    <fieldset style="border:0;padding:0;margin:0" ${ro ? 'disabled' : ''}>${body}</fieldset>
    ${ro ? '' : '<div class="row end"><button id="saveMaster" class="primary">保存</button></div>'}`;
  if (ro) return;
  const root = main.querySelector('fieldset');
  const redraw = () => viewMaster(tab);
  bind(root, master, () => {});
  const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
  on('saveMaster', () => run(async () => { await api('/master', 'PUT', { master }); toast('保存しました'); }));
  on('addArtist', () => { master.artists.push({ id: uid(), name: '', honorific: '様', contact: '', note: '' }); redraw(); });
  main.querySelectorAll('[data-rm-artist]').forEach((b) => (b.onclick = () => { if (confirm('削除しますか?')) { master.artists.splice(+b.dataset.rmArtist, 1); redraw(); } }));
  on('addTerm', () => { master.terms.push({ id: uid(), title: '', body: '', enabled: true }); redraw(); });
  on('resetTerms', () => { if (confirm('条文を初期状態に戻します。編集内容は失われます。')) { master.terms = structuredClone(DEFAULT_TERMS); redraw(); } });
  main.querySelectorAll('[data-rm-term]').forEach((b) => (b.onclick = () => { master.terms.splice(+b.dataset.rmTerm, 1); redraw(); }));
  main.querySelectorAll('[data-mv]').forEach((b) => (b.onclick = () => {
    const [i, d] = b.dataset.mv.split(':').map(Number); const j = i + d;
    if (j < 0 || j >= master.terms.length) return;
    [master.terms[i], master.terms[j]] = [master.terms[j], master.terms[i]]; redraw();
  }));
  on('export', () => {
    const blob = new Blob([JSON.stringify({ master, orders }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `illust-order-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  });
}

// ---------- router ----------
function route() {
  if (!master) return;
  const r = location.hash.replace(/^#\/?/, '');
  renderBar(r);
  const [a, b] = r.split('/');
  if (a === 'order' && b) viewOrder(b);
  else if (a === 'master') viewMaster(b);
  else viewList();
}
async function start() {
  await api('/me');
  const m = (await api('/master')).master;
  master = m || DEFAULT_MASTER();
  master.profile.tax ||= DEFAULT_MASTER().profile.tax;
  if (!m) await api('/master', 'PUT', { master });
  orders = (await api('/orders')).orders;
  route();
}
window.addEventListener('hashchange', route);
mq.addEventListener('change', route);
start().catch((e) => { if (e.message !== 'auth') main.innerHTML = `<p class="err">${esc(e.message)}</p>`; });
