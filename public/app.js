(() => {
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CATS = ['交通','住宿','餐飲','購物','門票/活動','藥妝','通訊','其他'];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { alert('無法儲存（瀏覽器儲存空間已滿或被封鎖）'); } }
};
let expenses = [], journal = [], rate = 0.052;
let editId = null;
const toast = m => { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); } t.textContent = m; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 3000); };
async function api(method, path, body) {
  for (;;) {
    const r = await fetch('/api/' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Trip-Password': store.get('tt_pw', '') }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) {
      const j = await r.json().catch(() => ({}));
      if (j.google) { location.href = '/login.html'; throw new Error('login required'); }
      const pw = prompt('請輸入密碼'); if (pw === null) throw new Error('cancelled'); store.set('tt_pw', pw); continue;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
}
const sync = p => p.catch(e => { console.error(e); toast('儲存失敗，請檢查網絡後重試'); });
const putE = x => sync(api('PUT', 'expenses/' + x.id, x));
const putJ = x => sync(api('PUT', 'journal/' + x.id, x));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const toHKD = e => e.currency === 'HKD' ? e.amount : e.amount * rate;
const fmtMoney = (n, c) => (c === 'JPY' ? '¥' : 'HK$') + Number(n).toLocaleString('en-US', { maximumFractionDigits: c === 'JPY' ? 0 : 2 });
const hk = n => 'HK$' + Math.round(n).toLocaleString('en-US');

// tabs
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
});

// countdown
(() => {
  const d = Math.ceil((new Date(TRIP.start + 'T00:00:00') - new Date()) / 864e5);
  const end = Math.ceil((new Date(TRIP.end + 'T23:59:59') - new Date()) / 864e5);
  $('#countdown').textContent = d > 0 ? `距離出發還有 ${d} 日` : end >= 0 ? '旅程進行中 ✈️' : '旅程已完成，留低美好回憶 ❤️';
})();

// forms setup
const catHtml = CATS.map(c => `<option>${c}</option>`).join('');
$('#expForm [name=category]').innerHTML = catHtml;
$('#filterCat').insertAdjacentHTML('beforeend', catHtml);
const today = new Date().toISOString().slice(0, 10);
const defDate = (today >= TRIP.start && today <= TRIP.end) ? today : TRIP.start;
$('#expForm [name=date]').value = defDate;
$('#jForm [name=date]').value = defDate;
$('#rate').addEventListener('input', e => { const v = parseFloat(e.target.value); if (v > 0) { rate = v; sync(api('PUT', 'settings/rate', { value: v })); renderExp(); } });

function renderExp() {
  const paid = expenses.filter(e => e.status === 'paid'), pend = expenses.filter(e => e.status === 'pending');
  const sum = a => a.reduce((s, e) => s + toHKD(e), 0);
  const days = new Set(paid.map(e => e.date)).size || 1;
  const payers = {}; paid.forEach(e => payers[e.payer] = (payers[e.payer] || 0) + toHKD(e));
  const jpy = paid.filter(e => e.currency === 'JPY').reduce((s, e) => s + e.amount, 0);
  $('#summary').innerHTML = [
    ['已付合計', hk(sum(paid))], ['待付（現地）', hk(sum(pend))], ['預計總支出', hk(sum(expenses))],
    ['已付日圓部分', fmtMoney(jpy, 'JPY')], ['日均（已付）', hk(sum(paid) / days)],
    ...Object.entries(payers).map(([k, v]) => ['付款：' + k, hk(v)])
  ].map(([a, b]) => `<div class="card"><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join('');

  const bars = (map) => { const max = Math.max(1, ...Object.values(map)); return Object.entries(map).map(([k, v]) =>
    `<div class="bar"><span>${esc(k)}</span><div class="fill" style="width:${v / max * 55}%"></div><span>${hk(v)}</span></div>`).join('') || '<p class="rate">未有資料</p>'; };
  const cat = {}, day = {};
  expenses.forEach(e => { cat[e.category] = (cat[e.category] || 0) + toHKD(e); day[e.date] = (day[e.date] || 0) + toHKD(e); });
  $('#byCat').innerHTML = bars(cat);
  $('#byDay').innerHTML = bars(Object.fromEntries(Object.entries(day).sort()));

  const f = $('#filterCat').value;
  const rows = expenses.filter(e => !f || e.category === f).sort((a, b) => a.date.localeCompare(b.date));
  $('#expTable tbody').innerHTML = rows.map(e => `<tr>
    <td>${esc(e.date.slice(5))}</td><td>${esc(e.category)}</td>
    <td>${esc(e.title)}${e.note ? `<small style="display:block;color:var(--muted)">${esc(e.note)}</small>` : ''}</td>
    <td>${fmtMoney(e.amount, e.currency)}${e.currency === 'JPY' ? `<small style="display:block;color:var(--muted)">≈${hk(toHKD(e))}</small>` : ''}</td>
    <td>${esc(e.payer)}</td>
    <td><button class="tag ${e.status}" data-act="toggle" data-id="${e.id}">${e.status === 'paid' ? '已付' : '待付'}</button></td>
    <td><button data-act="edit" data-id="${e.id}">✎</button><button class="del" data-act="del" data-id="${e.id}">✕</button></td></tr>`).join('')
    || '<tr><td colspan="7">未有消費紀錄</td></tr>';
}
$('#filterCat').addEventListener('change', renderExp);
$('#expTable').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const x = expenses.find(v => v.id === b.dataset.id); if (!x) return;
  if (b.dataset.act === 'toggle') { x.status = x.status === 'paid' ? 'pending' : 'paid'; putE(x); renderExp(); }
  if (b.dataset.act === 'del' && confirm('刪除「' + x.title + '」？')) { expenses = expenses.filter(v => v !== x); sync(api('DELETE', 'expenses/' + x.id)); renderExp(); }
  if (b.dataset.act === 'edit') {
    editId = x.id; const f = $('#expForm');
    for (const k of ['date','category','title','amount','currency','payer','status','note']) f.elements[k].value = x[k];
    $('#expForm button.primary').textContent = '更新'; $('#cancelEdit').hidden = false; f.scrollIntoView({ behavior: 'smooth' });
  }
});
function resetExpForm() { editId = null; const f = $('#expForm'); const d = f.elements.date.value; f.reset(); f.elements.date.value = d; $('#expForm button.primary').textContent = '新增'; $('#cancelEdit').hidden = true; }
$('#cancelEdit').addEventListener('click', resetExpForm);
$('#expForm').addEventListener('submit', ev => {
  ev.preventDefault(); const f = ev.target;
  const o = { date: f.date.value, category: f.category.value, title: f.title.value.trim(), amount: parseFloat(f.amount.value), currency: f.currency.value, payer: f.payer.value, status: f.status.value, note: f.note.value.trim() };
  let x;
  if (editId) { x = expenses.find(v => v.id === editId); Object.assign(x, o); } else { x = { id: uid(), ...o }; expenses.push(x); }
  putE(x); resetExpForm(); renderExp();
});

// export / import
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
$('#exportCsv').addEventListener('click', () => {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['日期','類別','項目','金額','貨幣','約HKD','付款人','狀態','備註'];
  const lines = expenses.slice().sort((a, b) => a.date.localeCompare(b.date)).map(e => [e.date, e.category, e.title, e.amount, e.currency, toHKD(e).toFixed(2), e.payer, e.status === 'paid' ? '已付' : '待付', e.note].map(q).join(','));
  download('expenses.csv', '﻿' + [head.map(q).join(','), ...lines].join('\n'), 'text/csv');
});
$('#exportJson').addEventListener('click', () => download('trip-backup.json', JSON.stringify({ expenses, journal, rate }), 'application/json'));
$('#importJson').addEventListener('change', async ev => {
  const file = ev.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.expenses) || !Array.isArray(d.journal)) throw 0;
    if (!confirm('匯入會取代目前所有資料，確定？')) return;
    await api('POST', 'import', d);
    expenses = d.expenses; journal = d.journal; if (d.rate > 0) { rate = d.rate; $('#rate').value = rate; }
    renderExp(); renderJournal();
  } catch { alert('匯入失敗或檔案格式不正確'); }
  ev.target.value = '';
});

// journal
function shrink(file, max = 900) {
  return new Promise(res => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', .7)); };
    img.onerror = () => res(null); img.src = url;
  });
}
function renderJournal() {
  $('#journalList').innerHTML = journal.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).map(j => `
    <div class="card"><div class="j-head"><b>${esc(j.mood)} ${esc(j.date)}${j.place ? ' ｜ ' + esc(j.place) : ''}</b><button class="del" data-id="${j.id}">✕</button></div>
    <div class="j-text">${esc(j.text)}</div>
    <div class="j-photos">${(j.photos || []).map(p => `<img src="${esc(p)}" alt="">`).join('')}</div></div>`).join('') || '<p class="rate">未有旅行紀錄，開始寫第一篇啦！</p>';
}
$('#journalList').addEventListener('click', e => {
  const b = e.target.closest('.del'); if (b && confirm('刪除此紀錄？')) { sync(api('DELETE', 'journal/' + b.dataset.id)); journal = journal.filter(j => j.id !== b.dataset.id); renderJournal(); }
});
$('#jForm').addEventListener('submit', async ev => {
  ev.preventDefault(); const f = ev.target;
  const photos = (await Promise.all([...f.photo.files].map(x => shrink(x)))).filter(Boolean);
  const j = { id: uid(), date: f.date.value, place: f.place.value.trim(), mood: f.mood.value, text: f.text.value.trim(), photos };
  journal.push(j); putJ(j); const d = f.date.value; f.reset(); f.date.value = d; renderJournal();
});

// static sections
$('#itineraryList').innerHTML = ITINERARY.map(d => `<div class="card day"><h3>${esc(d.day)} ｜ ${esc(d.date)} <span class="city">${esc(d.city)}</span></h3>
  ${d.events.map(e => `<div class="ev"><time>${esc(e.time)}</time><div>${esc(e.what)}<small>📍${esc(e.where)}${e.note ? ' ｜ ' + esc(e.note) : ''}</small></div></div>`).join('')}</div>`).join('');
$('#bookingList').innerHTML = BOOKINGS.map(b => `<div class="card"><b>${esc(b.name)}</b> <span class="tag">${esc(b.cat)}</span>
  <div>🗓 ${esc(b.dates)}</div><div>🔖 ${esc(b.id)} ｜ ${esc(b.platform)}</div><div>💳 ${esc(b.amount)}</div>
  <small style="color:var(--muted)">${esc(b.details)}<br>取消條款：${esc(b.cancel)}</small></div>`).join('');
const ul = a => '<ul class="chk">' + a.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>';
$('#tipsList').innerHTML = `<div class="panel"><h2>行前清單</h2>${ul(TIPS.checklist)}</div><div class="panel"><h2>取消期限</h2>${ul(TIPS.cancel)}</div><div class="panel"><h2>緊急聯絡</h2>${ul(TIPS.contacts)}</div>`;

(async () => {
  try {
    let st = await api('GET', 'state');
    if (!st.seeded) { await Promise.all(SEED_EXPENSES.map(x => api('PUT', 'expenses/' + x.id, x))); await api('PUT', 'settings/seeded', { value: true }); st = await api('GET', 'state'); }
    expenses = st.expenses; journal = st.journal; rate = st.rate;
  } catch (e) { console.error(e); toast('無法載入資料'); }
  $('#rate').value = rate; renderExp(); renderJournal();
  try {
    const me = await api('GET', 'me');
    if (me.email) {
      $('#who').hidden = false; $('#whoEmail').textContent = me.email;
      $('#logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; });
    }
  } catch {}
})();
})();
