import { stableStringify } from './js/core.js';
import { renderDocument, esc } from './js/render.js';

const main = document.getElementById('main');
const token = new URLSearchParams(location.search).get('t');

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function load() {
  const res = token && (await fetch('/api/public/' + encodeURIComponent(token)));
  if (!res || !res.ok) { main.innerHTML = '<p class="notice">この発注書は見つからないか、無効になっています。</p>'; return; }
  const { snapshot, hash, agreement } = await res.json();
  let verified = false;
  try { verified = (await sha256Hex(stableStringify(snapshot))) === hash; } catch { /* 非セキュア環境では検証を省略 */ }

  main.innerHTML = `
    <div class="paper">${renderDocument(snapshot, agreement && { ...agreement, hash })}</div>
    <section class="agree-box no-print">
      ${verified ? '<p class="muted small">文書の改ざんチェック:一致しました</p>' : ''}
      ${agreement ? `<p class="notice ok">${esc(agreement.name)} 様の同意を記録済みです。</p>
        <button id="print">PDFとして保存・印刷</button>` : `
        <p>内容と規約を確認のうえ、氏名を入力して同意してください。</p>
        <label>氏名<input id="name" autocomplete="name" maxlength="100"></label>
        <label class="check"><input id="chk" type="checkbox"> 上記の発注内容および規約に同意します</label>
        <button id="send" disabled>同意して署名</button>
        <p id="err" class="err"></p>`}
    </section>`;

  document.getElementById('print')?.addEventListener('click', () => print());
  const name = document.getElementById('name'), chk = document.getElementById('chk'), send = document.getElementById('send');
  if (!send) return;
  const upd = () => { send.disabled = !(name.value.trim() && chk.checked); };
  name.addEventListener('input', upd); chk.addEventListener('change', upd);
  send.addEventListener('click', async () => {
    send.disabled = true;
    const r = await fetch(`/api/public/${encodeURIComponent(token)}/agree`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.value, checked: chk.checked }),
    });
    if (r.ok) return load();
    document.getElementById('err').textContent = (await r.json().catch(() => ({}))).error || '送信に失敗しました';
    upd();
  });
}
load();
