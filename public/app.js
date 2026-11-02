(() => {
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CATS = ['交通','住宿','餐飲','購物','門票/活動','藥妝','通訊','其他'];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { alert('無法儲存（瀏覽器儲存空間已滿或被封鎖）'); } }
};
let expenses = [], journal = [], places = [], rate = 0.052;
let editId = null;
let pendingReceipt = null; // { id, items } attached to the form
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
  $('#countdown').innerHTML = d > 0 ? `距離雪國還有 <b>${d}</b> 日` : end >= 0 ? '❄ 旅程進行中' : '旅程已完成，留低雪國回憶';
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
    <td>${e.receiptId ? `<button class="rc" data-act="receipt" data-id="${e.id}" title="睇收據">🧾</button> ` : ''}${esc(e.title)}${e.note ? `<small style="display:block;color:var(--muted)">${esc(e.note)}</small>` : ''}</td>
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
  if (b.dataset.act === 'receipt') return openReceipt(x);
  if (b.dataset.act === 'edit') {
    editId = x.id; const f = $('#expForm');
    for (const k of ['date','category','title','amount','currency','payer','status','note']) f.elements[k].value = x[k];
    setReceipt(x.receiptId ? { id: x.receiptId, items: x.items || [] } : null, '');
    $('#expForm button.primary').textContent = '更新'; $('#cancelEdit').hidden = false; f.scrollIntoView({ behavior: 'smooth' });
  }
});
function resetExpForm() { editId = null; const f = $('#expForm'); const d = f.elements.date.value; f.reset(); f.elements.date.value = d; $('#expForm button.primary').textContent = '新增'; $('#cancelEdit').hidden = true; setReceipt(null); }
$('#cancelEdit').addEventListener('click', resetExpForm);
$('#expForm').addEventListener('submit', ev => {
  ev.preventDefault(); const f = ev.target;
  const o = { date: f.date.value, category: f.category.value, title: f.title.value.trim(), amount: parseFloat(f.amount.value), currency: f.currency.value, payer: f.payer.value, status: f.status.value, note: f.note.value.trim() };
  let x;
  o.receiptId = pendingReceipt?.id || null; o.items = pendingReceipt?.items || [];
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
$('#exportJson').addEventListener('click', () => download('trip-backup.json', JSON.stringify({ expenses, journal, places, rate }), 'application/json'));
$('#importJson').addEventListener('change', async ev => {
  const file = ev.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.expenses) || !Array.isArray(d.journal)) throw 0;
    if (!confirm('匯入會取代目前所有資料，確定？')) return;
    await api('POST', 'import', d);
    expenses = d.expenses; journal = d.journal; if (Array.isArray(d.places)) places = d.places; if (d.rate > 0) { rate = d.rate; $('#rate').value = rate; }
    renderExp(); renderJournal(); renderPlaces();
  } catch { alert('匯入失敗或檔案格式不正確'); }
  ev.target.value = '';
});

// receipts
const itemsHtml = items => (items || []).map(i => `<li><span>${esc(i.name_zh || i.name)}${i.qty > 1 ? ' ×' + i.qty : ''}<small>${i.name_zh && i.name !== i.name_zh ? esc(i.name) : ''}</small></span><b>${Number(i.price).toLocaleString()}</b></li>`).join('');
function setReceipt(r, status) {
  pendingReceipt = r;
  $('#receiptBox').hidden = !r;
  if (!r) return;
  $('#receiptPreview').src = r.preview || '/api/receipts/' + r.id;
  $('#receiptItems').innerHTML = itemsHtml(r.items);
  $('#receiptStatus').textContent = status ?? '';
}
$('#receiptRemove').addEventListener('click', () => setReceipt(null));
$('#receiptInput').addEventListener('change', async ev => {
  const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
  const img = await shrink(file, 1600, 0.82);
  if (!img) return toast('讀唔到呢張相');
  setReceipt({ id: null, items: [], preview: img }, '上載及辨識中…（約 10–20 秒）');
  try {
    const r = await api('POST', 'receipts', { image: img, scan: true });
    const x = r.extracted, f = $('#expForm');
    if (x && x.is_receipt) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(x.date)) f.date.value = x.date;
      if (CATS.includes(x.category)) f.category.value = x.category;
      f.title.value = x.store_zh && x.store_zh !== x.store ? `${x.store_zh}（${x.store}）` : (x.store || x.store_zh);
      if (x.total > 0) f.amount.value = x.total;
      if (x.currency === 'JPY' || x.currency === 'HKD') f.currency.value = x.currency;
      f.status.value = 'paid';
      f.note.value = [x.summary_zh, x.payment && '付款：' + x.payment, x.tax > 0 && '稅 ' + x.tax].filter(Boolean).join('；');
      setReceipt({ id: r.id, items: x.items, preview: img }, '✅ 已自動填好，請核對後撳「新增」');
    } else {
      const msg = r.scanError === 'disabled' ? '收據已上載（自動辨識未啟用），請手動填寫' : x && !x.is_receipt ? '似乎唔係收據，請手動填寫' : '辨識失敗，收據已上載，請手動填寫';
      setReceipt({ id: r.id, items: [], preview: img }, msg);
    }
  } catch (e) { console.error(e); setReceipt(null); toast('上載失敗，請再試'); }
});
function openReceipt(e) {
  $('#rdTitle').textContent = e.title;
  $('#rdItems').innerHTML = itemsHtml(e.items);
  $('#rdImg').src = '/api/receipts/' + e.receiptId;
  $('#receiptDialog').showModal();
}

// places (想去)
const AREAS = ['登別', '札幌', '小樽', '洞爺湖', '新千歲機場', '北海道其他', '大阪', '京都', '神戶', '奈良', '關西其他'];
const KINDS = { food: '🍜 美食', sight: '🏔 景點', shop: '🛍 購物', stay: '🏨 住宿', other: '📌 其他' };
const AREA_CENTER = { 登別: [42.4966, 141.1440], 札幌: [43.0618, 141.3545], 小樽: [43.1907, 140.9947], 洞爺湖: [42.5650, 140.8190], 新千歲機場: [42.7752, 141.6923], 大阪: [34.6937, 135.5023], 京都: [35.0116, 135.7681], 神戶: [34.6901, 135.1955], 奈良: [34.6851, 135.8048] };
$('#placeForm [name=area]').innerHTML = AREAS.map(x => `<option>${x}</option>`).join('');
$('#placeForm [name=kind]').innerHTML = Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
let gEnabled = false; const gCache = new Map();
fetch('/api/config').then(r => r.json()).then(c => { gEnabled = !!c.places; $('#gSearchBtn').hidden = !gEnabled; if (gEnabled) renderPlaces(); }).catch(() => {});
let formPhotos = []; // [{id} existing | {data} new]
const MAX_PHOTOS = 5;
let placeEditId = null, placeFilter = '', kindFilter = '', map = null, markers = null, myPos = null, meMarker = null;
const distM = (a, b) => { const R = 6371e3, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} 米` : m < 100e3 ? `${(m / 1000).toFixed(1)} 公里` : `${Math.round(m / 1000)} 公里`;
const walk = m => m <= 2500 ? `步行約 ${Math.max(1, Math.round(m / 80))} 分鐘` : m <= 30e3 ? '建議搭車' : '';
const placeLL = p => p.lat && p.lng ? [p.lat, p.lng] : AREA_CENTER[p.area] || null;
const mapsUrl = p => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.lat && p.lng && !p.query ? `${p.lat},${p.lng}` : (p.query || `${p.name} ${p.area}`)) + (p.gplaceId ? '&query_place_id=' + encodeURIComponent(p.gplaceId) : '');
const sourceLabel = u => { try { const h = new URL(u).hostname.replace(/^www\./, ''); return h.includes('threads') ? 'Threads' : h.includes('instagram') ? 'Instagram' : h.includes('xiaohongshu') || h.includes('xhslink') ? '小紅書' : h.includes('facebook') ? 'Facebook' : h.includes('youtube') || h.includes('youtu.be') ? 'YouTube' : h; } catch { return '連結'; } };
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
function ensureMap() {
  if (map || !window.L) return;
  map = L.map('placeMap', { scrollWheelZoom: false }).setView([39.5, 138.5], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map);
  markers = L.layerGroup().addTo(map);
}
function renderPlaces() {
  const areasUsed = AREAS.filter(a => places.some(p => p.area === a));
  $('#placeFilters').innerHTML = ['', ...areasUsed].map(a => `<button type="button" class="chip ${a === placeFilter ? 'on' : ''}" data-area="${a}">${a || '全部'} <small>${places.filter(p => !a || p.area === a).length}</small></button>`).join('');
  const kindsUsed = Object.keys(KINDS).filter(k => places.some(p => p.kind === k));
  $('#kindFilters').innerHTML = kindsUsed.length > 1 ? ['', ...kindsUsed].map(k => `<button type="button" class="chip ${k === kindFilter ? 'on' : ''}" data-kind="${k}">${k ? KINDS[k] : '全部類型'}</button>`).join('') : '';
  const list = places.filter(p => (!placeFilter || p.area === placeFilter) && (!kindFilter || p.kind === kindFilter));
  list.forEach(p => { const ll = placeLL(p); p._d = myPos && ll ? distM(myPos, ll) : null; });
  if (myPos) list.sort((x, y) => (x.status === 'done') - (y.status === 'done') || (x._d ?? 1e12) - (y._d ?? 1e12));
  else list.sort((x, y) => (x.status === 'done') - (y.status === 'done') || AREAS.indexOf(x.area) - AREAS.indexOf(y.area));
  $('#placeList').innerHTML = list.map(p => `<div class="card place ${p.status === 'done' ? 'done' : ''} ${['大阪', '京都', '神戶', '奈良', '關西其他'].includes(p.area) ? 'osaka' : ''}">
    <div class="j-head"><div><span class="region">${esc(p.area)}</span> <span class="kind">${KINDS[p.kind] || ''}</span>${p.unsure ? ' <span class="unsure">位置待確認</span>' : ''}</div>
      <span><button data-act="edit" data-id="${p.id}">✎</button><button class="del" data-act="del" data-id="${p.id}">✕</button></span></div>
    <h3>${p.status === 'done' ? '✅ ' : ''}${esc(p.name)}</h3>
    ${p._d != null ? `<p class="dist">📍 ${p.lat && p.lng ? '' : '大約 '}${fmtDist(p._d)}${walk(p._d) ? ' · ' + walk(p._d) : ''}${p.lat && p.lng ? '' : '（只知地區，未有準確位置）'}</p>` : ''}
    ${p.gplaceId && gEnabled ? `<div class="gbox" data-g="${esc(p.gplaceId)}"><p class="rate">載入 Google 食物相…</p></div>` : ''}
    ${(p.photos || []).length ? `<div class="gallery" data-id="${p.id}">${p.photos.map((ph, i) => `<img loading="lazy" src="/api/photos/${esc(ph)}" data-i="${i}" alt="">`).join('')}</div>` : ''}
    ${p.note ? `<p class="j-text">${esc(p.note)}</p>` : ''}
    <div class="actions"><a class="btn primary" href="${esc(mapsUrl(p))}" target="_blank" rel="noopener">🗺 Google Maps</a>
      <a class="btn" href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent((p.query || p.name + ' ' + p.area) + (['food', 'stay'].includes(p.kind) ? ' 料理' : ''))}" target="_blank" rel="noopener">🔍 ${['food', 'stay'].includes(p.kind) ? '食物相' : 'Google 圖片'}</a>
      ${safeUrl(p.url) ? `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">🔗 ${esc(sourceLabel(p.url))}</a>` : ''}
      <button data-act="toggle" data-id="${p.id}">${p.status === 'done' ? '改返想去' : '標記去咗'}</button></div></div>`).join('')
    || '<p class="rate">未有地點。見到想去嘅地方，貼條連結落嚟啦！</p>';
  document.querySelectorAll('.gbox[data-g]').forEach(loadGBox);
  ensureMap();
  if (!map) return;
  markers.clearLayers();
  const pts = [];
  list.forEach(p => {
    const ll = placeLL(p); if (!ll) return;
    pts.push(ll);
    L.circleMarker(ll, { radius: 8, weight: 2, color: '#fff', fillColor: p.status === 'done' ? '#2f8a5b' : p.unsure ? '#c7782c' : '#2d6a96', fillOpacity: .95 })
      .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.area)}${p.unsure ? '（位置待確認）' : ''}<br><a href="${esc(mapsUrl(p))}" target="_blank" rel="noopener">開 Google Maps</a>`).addTo(markers);
  });
  if (meMarker) { meMarker.remove(); meMarker = null; }
  if (myPos) {
    meMarker = L.marker(myPos, { icon: L.divIcon({ className: 'me-dot', iconSize: [18, 18] }), zIndexOffset: 1000 }).bindPopup('你喺度').addTo(map);
    const near = list.filter(p => p._d != null && p._d < 30e3).slice(0, 5).map(placeLL);
    if (near.length) map.fitBounds([myPos, ...near], { padding: [30, 30], maxZoom: 16 }); else map.setView(myPos, 15);
  } else if (pts.length === 1) map.setView(pts[0], 13); else if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
}
$('#kindFilters').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; kindFilter = b.dataset.kind; renderPlaces(); });
$('#nearBtn').addEventListener('click', () => {
  const st = $('#nearStatus');
  if (!navigator.geolocation) { st.textContent = '呢部機唔支援定位。'; return; }
  st.textContent = '定位中…'; $('#nearBtn').disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    $('#nearBtn').disabled = false;
    myPos = [pos.coords.latitude, pos.coords.longitude];
    $('#nearFood').href = `https://www.google.com/maps/search/restaurants/@${myPos[0]},${myPos[1]},16z`;
    placeFilter = ''; renderPlaces();
    const near = places.filter(p => p.status !== 'done' && p._d != null).sort((x, y) => x._d - y._d)[0];
    st.innerHTML = near ? `最近：<b>${esc(near.name)}</b>（${fmtDist(near._d)}）· 定位準確度約 ${Math.round(pos.coords.accuracy)} 米` : '附近未有想去嘅地方，可以撳右邊搵附近餐廳。';
  }, err => {
    $('#nearBtn').disabled = false;
    st.textContent = err.code === 1 ? '你拒絕咗定位權限。請喺瀏覽器設定容許此網站使用位置。' : '定位失敗，請到戶外或者開 GPS 再試。';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
});
$('#placeFilters').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; placeFilter = b.dataset.area; renderPlaces(); });
$('#tabs').addEventListener('click', e => { if (e.target.closest('[data-tab=places]')) setTimeout(() => { ensureMap(); map?.invalidateSize(); renderPlaces(); }, 50); });
function resetPlaceForm() { placeEditId = null; formPhotos = []; renderFormPhotos(); $('#placeForm').reset(); $('#placeForm').gplaceId.value = ''; $('#gResults').innerHTML = ''; $('#placeFormTitle').textContent = '新增想去地點'; $('#placeCancel').hidden = true; }
$('#placeCancel').addEventListener('click', resetPlaceForm);
$('#placeList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const p = places.find(x => x.id === b.dataset.id); if (!p) return;
  if (b.dataset.act === 'toggle') { p.status = p.status === 'done' ? 'want' : 'done'; sync(api('PUT', 'places/' + p.id, p)); renderPlaces(); }
  if (b.dataset.act === 'del' && confirm('刪除「' + p.name + '」？')) { places = places.filter(x => x !== p); sync(api('DELETE', 'places/' + p.id)); renderPlaces(); }
  if (b.dataset.act === 'edit') {
    placeEditId = p.id; const f = $('#placeForm');
    for (const k of ['url', 'name', 'area', 'kind', 'status', 'query', 'lat', 'lng', 'note', 'gplaceId']) f.elements[k].value = p[k] ?? '';
    $('#gResults').innerHTML = p.gplaceId ? '<p class="glinked">✅ 已連結 Google 地點</p>' : '';
    formPhotos = (p.photos || []).map(id => ({ id })); renderFormPhotos();
    $('#placeFormTitle').textContent = '編輯地點'; $('#placeCancel').hidden = false; f.scrollIntoView({ behavior: 'smooth' });
  }
});
function renderFormPhotos() {
  $('#placePhotoPreview').innerHTML = formPhotos.map((ph, i) => `<span class="thumb"><img src="${ph.data || '/api/photos/' + esc(ph.id)}" alt=""><button type="button" data-i="${i}">✕</button></span>`).join('');
  $('#placePhotoInput').disabled = formPhotos.length >= MAX_PHOTOS;
}
$('#placePhotoPreview').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; formPhotos.splice(+b.dataset.i, 1); renderFormPhotos(); });
$('#placePhotoInput').addEventListener('change', async ev => {
  const files = [...ev.target.files].slice(0, MAX_PHOTOS - formPhotos.length); ev.target.value = '';
  for (const f of files) { const d = await shrink(f, 1280, 0.8); if (d) formPhotos.push({ data: d }); }
  renderFormPhotos();
});
$('#placeList').addEventListener('click', e => {
  const img = e.target.closest('.gallery img'); if (!img) return;
  const imgs = [...img.parentElement.querySelectorAll('img')];
  const card = img.closest('.place');
  $('#pdStrip').innerHTML = imgs.map(x => `<img src="${esc(x.dataset.full || x.src)}" alt="">`).join('');
  $('#pdCount').textContent = `${card?.querySelector('h3')?.textContent || ''} · ${imgs.length} 張（左右掃）`;
  $('#photoDialog').showModal();
  const strip = $('#pdStrip'); strip.scrollLeft = strip.clientWidth * imgs.indexOf(img);
});
$('#placeForm').addEventListener('submit', async ev => {
  ev.preventDefault(); const f = ev.target; const btn = f.querySelector('button.primary');
  let photoIds;
  try {
    btn.disabled = true; btn.textContent = formPhotos.some(x => x.data) ? '上載相片中…' : '儲存中…';
    photoIds = [];
    for (const ph of formPhotos) photoIds.push(ph.id || (await api('POST', 'photos', { image: ph.data })).id);
  } catch (e) { console.error(e); toast('相片上載失敗，請再試'); return; }
  finally { btn.disabled = false; btn.textContent = '儲存'; }
  const prev = placeEditId ? (places.find(x => x.id === placeEditId)?.photos || []) : [];
  prev.filter(id => !photoIds.includes(id)).forEach(id => sync(api('DELETE', 'photos/' + id)));
  const o = { url: f.url.value.trim(), name: f.name.value.trim(), area: f.area.value, kind: f.kind.value, status: f.status.value, query: f.query.value.trim(), lat: parseFloat(f.lat.value) || null, lng: parseFloat(f.lng.value) || null, note: f.note.value.trim(), photos: photoIds, gplaceId: f.gplaceId.value || null };
  let p;
  if (placeEditId) { p = places.find(x => x.id === placeEditId); Object.assign(p, o); delete p.unsure; } else { p = { id: uid(), ...o }; places.push(p); }
  sync(api('PUT', 'places/' + p.id, p)); resetPlaceForm(); renderPlaces();
});

// Google Places: food photos + rating
async function loadGBox(box) {
  const id = box.dataset.g; box.removeAttribute('data-g');
  try {
    if (!gCache.has(id)) gCache.set(id, fetch('/api/gplace/' + encodeURIComponent(id)).then(r => { if (!r.ok) throw 0; return r.json(); }));
    const d = await gCache.get(id);
    const by = [...new Set(d.photos.map(p => p.by).filter(Boolean))].slice(0, 3).join('、');
    box.innerHTML = `${d.rating ? `<p class="grating">⭐ <b>${d.rating.toFixed(1)}</b> <small>(${d.ratings.toLocaleString()} 個 Google 評分)</small>${d.foodCount ? ` · 🍜 ${d.foodCount} 張食物相` : ''}</p>` : ''}
      ${d.photos.length ? `<div class="gallery">${d.photos.map(p => `<img loading="lazy" src="/api/gplace/photo?w=600&name=${encodeURIComponent(p.name)}" data-full="/api/gplace/photo?w=1400&name=${encodeURIComponent(p.name)}" alt="">`).join('')}</div>
      <p class="gattr">相片來自 Google Maps${by ? '：' + esc(by) : ''}</p>` : '<p class="rate">Google 未有相片</p>'}`;
  } catch { gCache.delete(id); box.innerHTML = '<p class="rate">暫時載入唔到 Google 相片</p>'; }
}
$('#gSearchBtn').addEventListener('click', async () => {
  const f = $('#placeForm'), q = `${f.name.value.trim()} ${f.area.value}`.trim();
  if (!f.name.value.trim()) { f.name.focus(); return; }
  $('#gResults').innerHTML = '<p class="rate">搜尋中…</p>';
  try {
    const r = await fetch('/api/gplace/search?q=' + encodeURIComponent(q)).then(r => r.json());
    $('#gResults').innerHTML = (r.results || []).map((x, i) => `<button type="button" class="gpick" data-i="${i}"><b>${esc(x.name)}</b>${x.rating ? ` ⭐${x.rating}` : ''}<small>${esc(x.type)} · ${esc(x.address || '')}</small></button>`).join('') || '<p class="rate">搵唔到，試吓用日文名或者加地區</p>';
    $('#gResults').onclick = e => {
      const b = e.target.closest('.gpick'); if (!b) return; const x = r.results[+b.dataset.i];
      f.gplaceId.value = x.id; f.lat.value = x.lat; f.lng.value = x.lng; f.query.value = x.name;
      if (!f.name.value.trim()) f.name.value = x.name;
      $('#gResults').innerHTML = `<p class="glinked">✅ 已連結 Google：<b>${esc(x.name)}</b>（位置同食物相會自動用 Google 嘅）</p>`;
    };
  } catch { $('#gResults').innerHTML = '<p class="rate">搜尋失敗</p>'; }
});

// journal
function shrink(file, max = 900, q = 0.7) {
  return new Promise(res => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', q)); };
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
const region = d => { const n = parseInt(d.day.replace(/\D/g, ''), 10); return n <= 4 ? 'hokkaido' : n === 5 ? 'transit' : 'osaka'; };
const regionTag = { hokkaido: '❄ 北海道', transit: '✈ 北海道 → 大阪', osaka: '🏮 大阪・關西' };
$('#itineraryList').innerHTML = ITINERARY.map(d => `<div class="card day ${region(d)}"><span class="region">${regionTag[region(d)]}</span><h3>${esc(d.day)} ｜ ${esc(d.date)} <span class="city">${esc(d.city)}</span></h3>
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
    expenses = st.expenses; journal = st.journal; places = st.places || []; rate = st.rate;
  } catch (e) { console.error(e); toast('無法載入資料'); }
  $('#rate').value = rate; renderExp(); renderJournal(); renderPlaces();
  try {
    const me = await api('GET', 'me');
    if (me.email) {
      $('#who').hidden = false; $('#whoEmail').textContent = me.email;
      $('#logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; });
    }
  } catch {}
})();
})();
