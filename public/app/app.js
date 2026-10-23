// Mkoba Lite App: home, records (works offline), stock, orders, debts. No framework; text is never inserted as HTML.
'use strict';
const S = {
  sw: {
    tabs: [['home', '🏠', 'Nyumbani'], ['add', '➕', 'Rekodi'], ['stock', '📦', 'Stoo'], ['orders', '🛒', 'Oda'], ['debts', '📒', 'Madeni']],
    login: 'Ingia kwanza: tuma neno "dashibodi" kwa Mkoba kwenye WhatsApp, fungua kiungo utakachopokea, bonyeza Ingia, kisha rudi hapa.',
    openWa: 'Fungua WhatsApp', offlineFirst: 'Huna mtandao. Fungua programu ukiwa na mtandao mara ya kwanza.',
    offline: 'Huna mtandao', periods: [['leo', 'Leo'], ['wiki', 'Wiki hii'], ['mwezi', 'Mwezi huu']],
    profit: 'Faida', loss: 'Hasara', sales: 'Mauzo', purchases: 'Manunuzi', expenses: 'Matumizi',
    waiting: n => `Rekodi ${n} zinasubiri mtandao; zitatumwa zenyewe.`, install: 'Weka Mkoba kwenye skrini ya simu',
    types: [['sale', 'Mauzo'], ['purchase', 'Manunuzi'], ['expense', 'Matumizi']],
    item: 'Bidhaa / kitu (si lazima)', qty: 'Idadi (si lazima)', unit: 'Kipimo', amount: 'Kiasi (TSh)', save: 'Hifadhi',
    units: [['pcs', 'vipande'], ['kg', 'kg'], ['l', 'lita'], ['g', 'gramu']],
    saved: 'Imehifadhiwa: ', queued: 'Hakuna mtandao: imewekwa kwenye foleni, itatumwa ukipata mtandao.',
    badAmount: 'Andika kiasi sahihi.', recent: 'Rekodi za karibuni', del: 'Futa', delAsk: t => `Futa "${t}"?`, none: 'Bado hakuna.',
    stockTitle: 'Stoo yako', setStock: 'Weka kiasi kilichopo', low: 'inakaribia kuisha', daysLeft: d => `siku ~${d}`,
    ordersTitle: 'Oda', accept: 'Kubali', reject: 'Kataa', complete: 'Imekamilika', paid: 'imelipwa',
    st: { new: 'mpya', accepted: 'imekubaliwa', rejected: 'imekataliwa', done: 'imekamilika' }, pickup: 'Atakuja kuchukua',
    debtsTitle: 'Madeni', owesYou: 'Unaowadai', youOwe: 'Wanaokudai', addDebt: 'Weka deni', name: 'Jina',
    kinds: [['credit_given', 'Ninamdai (amechukua kwa mkopo)'], ['credit_received', 'Ananidai (nimechukua kwa mkopo)'], ['repayment_received', 'Amenilipa'], ['repayment_made', 'Nimemlipa']], kindLabel: 'Aina',
    since: d => (d === 0 ? 'leo' : `siku ${d}`),
    err: 'Kuna tatizo. Jaribu tena.', retry: 'Jaribu tena',
  },
  en: {
    tabs: [['home', '🏠', 'Home'], ['add', '➕', 'Records'], ['stock', '📦', 'Stock'], ['orders', '🛒', 'Orders'], ['debts', '📒', 'Debts']],
    login: 'Log in first: send "dashboard" to Mkoba on WhatsApp, open the link you get, tap Ingia, then come back here.',
    openWa: 'Open WhatsApp', offlineFirst: 'No connection. Open the app with a connection the first time.',
    offline: 'Offline', periods: [['leo', 'Today'], ['wiki', 'This week'], ['mwezi', 'This month']],
    profit: 'Profit', loss: 'Loss', sales: 'Sales', purchases: 'Purchases', expenses: 'Expenses',
    waiting: n => `${n} records waiting for a connection; they will be sent automatically.`, install: 'Add Mkoba to your home screen',
    types: [['sale', 'Sale'], ['purchase', 'Purchase'], ['expense', 'Expense']],
    item: 'Item (optional)', qty: 'Quantity (optional)', unit: 'Unit', amount: 'Amount (TSh)', save: 'Save',
    units: [['pcs', 'pieces'], ['kg', 'kg'], ['l', 'litres'], ['g', 'grams']],
    saved: 'Saved: ', queued: 'No connection: saved on the phone, it will be sent when you are online.',
    badAmount: 'Enter a valid amount.', recent: 'Recent records', del: 'Delete', delAsk: t => `Delete "${t}"?`, none: 'Nothing yet.',
    stockTitle: 'Your stock', setStock: 'Set the amount you have', low: 'running low', daysLeft: d => `~${d} days`,
    ordersTitle: 'Orders', accept: 'Accept', reject: 'Reject', complete: 'Completed', paid: 'paid',
    st: { new: 'new', accepted: 'accepted', rejected: 'rejected', done: 'completed' }, pickup: 'Customer will collect',
    debtsTitle: 'Debts', owesYou: 'They owe you', youOwe: 'You owe', addDebt: 'Add a debt', name: 'Name',
    kinds: [['credit_given', 'Owes me (took on credit)'], ['credit_received', 'I owe (I took on credit)'], ['repayment_received', 'Paid me'], ['repayment_made', 'I paid them']], kindLabel: 'Type',
    since: d => (d === 0 ? 'today' : `${d} days`),
    err: 'Something went wrong. Try again.', retry: 'Try again',
  },
};
let L = S.sw, tab = 'home', period = 'leo', type = 'sale', installEvt = null;
const $ = id => document.getElementById(id);
const tsh = n => 'TSh ' + Number(n).toLocaleString('en-US');

// h('div', { class: 'card', onclick: fn }, 'text', child, ...): builds elements; strings become text nodes.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
function show(...nodes) { const m = $('main'); m.replaceChildren(...nodes.flat().filter(n => n != null && n !== false)); window.scrollTo(0, 0); }

async function api(path, body) {
  const res = await fetch('/d/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin' });
  if (res.status === 401) { loginScreen(); throw new Error('login'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'server'); e.status = res.status; throw e; }
  return data;
}

// ---- offline queue of records ----
const QKEY = 'mkoba_queue';
const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } };
const writeQ = q => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* storage full or blocked */ } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
let flushing = false;
async function flush() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    let q = readQ();
    while (q.length) {
      try { await api('records', q[0]); }
      catch (e) { if (e.status === 400) { /* invalid: drop it */ } else break; }
      q = readQ().filter(r => r.client_id !== q[0].client_id); writeQ(q);
    }
  } finally { flushing = false; }
}

function netBadge() { const n = $('net'); n.textContent = L.offline; n.hidden = navigator.onLine; }

// ---- screens ----
function loginScreen() {
  show(h('div', { class: 'card' }, h('p', {}, L.login),
    h('a', { class: 'btn center', href: 'https://wa.me/255788001168?text=dashibodi' }, L.openWa)));
}

function failed(retry) { return h('div', { class: 'msg err' }, L.err, ' ', h('button', { class: 'link', onclick: retry }, L.retry)); }

async function home() {
  const q = readQ().length;
  const seg = h('div', { class: 'seg' }, L.periods.map(([k, t]) => h('button', { 'aria-pressed': String(k === period), onclick: () => { period = k; home(); } }, t)));
  try {
    const s = await api('summary?p=' + period);
    show(seg,
      h('div', { class: 'card' }, h('div', { class: 'muted' }, s.net >= 0 ? L.profit : L.loss),
        h('div', { class: 'big ' + (s.net >= 0 ? 'in' : 'out') }, tsh(Math.abs(s.net))),
        h('div', { class: 'row' }, h('span', {}, L.sales), h('span', { class: 'in' }, tsh(s.sales))),
        h('div', { class: 'row' }, h('span', {}, L.purchases), h('span', { class: 'out' }, tsh(s.purchases))),
        h('div', { class: 'row' }, h('span', {}, L.expenses), h('span', { class: 'out' }, tsh(s.expenses)))),
      q ? h('div', { class: 'msg' }, L.waiting(q)) : null,
      installEvt ? h('button', { class: 'btn ghost', onclick: async () => { installEvt.prompt(); installEvt = null; home(); } }, L.install) : null);
  } catch (e) { if (e.message !== 'login') show(seg, q ? h('div', { class: 'msg' }, L.waiting(q)) : null, failed(home)); }
}

async function add(note) {
  const amount = h('input', { id: 'amt', inputmode: 'numeric', autocomplete: 'off', required: true });
  const item = h('input', { id: 'item', autocomplete: 'off', maxlength: 60 });
  const qty = h('input', { id: 'qty', inputmode: 'decimal', autocomplete: 'off' });
  const unit = h('select', { id: 'unit' }, L.units.map(([v, t]) => h('option', { value: v }, t)));
  const form = h('form', { class: 'card', onsubmit: async ev => {
    ev.preventDefault();
    const n = Number(String(amount.value).replace(/[,\s]/g, ''));
    if (!(n > 0)) return add({ err: true, text: L.badAmount });
    const rec = { client_id: uid(), type, item: item.value.trim(), quantity: qty.value ? Number(qty.value) : null, unit: unit.value, amount: n, at: new Date().toISOString() };
    writeQ([...readQ(), rec]);
    if (!navigator.onLine) return add({ text: L.queued });
    try {
      const r = await api('records', rec);
      writeQ(readQ().filter(x => x.client_id !== rec.client_id));
      add({ text: L.saved + r.text + (r.notes ? '\n' + r.notes : '') });
    } catch (e) { if (e.message !== 'login') add({ text: L.queued }); }
  } },
  h('div', { class: 'seg', role: 'group' }, L.types.map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(k === type), onclick: () => { type = k; add(); } }, t))),
  h('label', { for: 'item' }, L.item), item,
  h('div', { class: 'two' }, h('div', {}, h('label', { for: 'qty' }, L.qty), qty), h('div', {}, h('label', { for: 'unit' }, L.unit), unit)),
  h('label', { for: 'amt' }, L.amount), amount,
  h('button', { class: 'btn', type: 'submit' }, L.save));
  const list = h('div', { class: 'card' }, h('p', { class: 'muted' }, '…'));
  show(note ? h('div', { class: 'msg' + (note.err ? ' err' : '') }, note.text) : null, form, h('h2', {}, L.recent), list);
  try {
    const rows = await api('records');
    list.replaceChildren(...(rows.length ? rows.map(r => h('div', { class: 'row' },
      h('span', {}, r.text, h('small', {}, r.at)),
      h('span', {}, h('span', { class: r.type === 'sale' ? 'in' : ['purchase', 'expense'].includes(r.type) ? 'out' : '' }, tsh(r.amount)), ' ',
        h('button', { class: 'link', onclick: async () => { if (confirm(L.delAsk(r.text))) { await api(`records/${r.id}/delete`, {}); add(); } } }, L.del))))
      : [h('p', { class: 'muted' }, L.none)]));
  } catch (e) { if (e.message !== 'login') list.replaceChildren(failed(() => add())); }
}

async function stock(note) {
  const item = h('input', { id: 'sitem', required: true, maxlength: 60 });
  const qty = h('input', { id: 'sqty', inputmode: 'decimal', required: true });
  const unit = h('select', { id: 'sunit' }, L.units.map(([v, t]) => h('option', { value: v === 'pcs' ? '' : v }, t)));
  const form = h('form', { class: 'card', onsubmit: async ev => {
    ev.preventDefault();
    try { const r = await api('stock', { item: item.value, quantity: Number(qty.value), unit: unit.value }); stock({ text: r.text }); }
    catch (e) { if (e.message !== 'login') stock({ err: true, text: L.err }); }
  } }, h('h2', {}, L.setStock), h('label', { for: 'sitem' }, L.item.replace(/ \(.*\)/, '')), item,
  h('div', { class: 'two' }, h('div', {}, h('label', { for: 'sqty' }, L.qty.replace(/ \(.*\)/, '')), qty), h('div', {}, h('label', { for: 'sunit' }, L.unit), unit)),
  h('button', { class: 'btn', type: 'submit' }, L.save));
  const list = h('div', { class: 'card' }, '…');
  show(note ? h('div', { class: 'msg' + (note.err ? ' err' : '') }, note.text) : null, h('h2', {}, L.stockTitle), list, form);
  try {
    const rows = await api('stock');
    list.replaceChildren(...(rows.length ? rows.map(r => h('div', { class: 'row' },
      h('span', {}, r.item, r.low ? h('small', { class: 'out' }, '⚠️ ' + L.low) : r.days != null ? h('small', {}, L.daysLeft(r.days)) : null),
      h('b', { class: r.low ? 'out' : '' }, r.text))) : [h('p', { class: 'muted' }, L.none)]));
  } catch (e) { if (e.message !== 'login') list.replaceChildren(failed(() => stock())); }
}

async function orders(note) {
  const wrap = h('div', {}, '…');
  show(note ? h('div', { class: 'msg' }, note) : null, h('h2', {}, L.ordersTitle), wrap);
  try {
    const rows = await api('orders');
    const act = (n, a) => async () => { try { const r = await api(`orders/${n}/${a}`, {}); orders(r.text); } catch (e) { if (e.message !== 'login') orders(L.err); } };
    wrap.replaceChildren(...(rows.length ? rows.map(o => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, `#${o.number} ${o.customer_name || o.phone}`), h('span', {}, L.st[o.status] + (o.paid ? ' · ' + L.paid : ''))),
      (o.lines || []).map(l => h('div', { class: 'row' }, h('span', {}, `${l.name} x${l.q}`), h('span', {}, tsh(l.price * l.q)))),
      h('div', { class: 'row' }, h('b', {}, tsh(o.total)), h('small', {}, o.delivery || L.pickup)),
      h('small', { class: 'muted' }, `${o.phone} · ${o.at}`), h('div', {},
        o.status === 'new' ? [h('button', { class: 'btn small', onclick: act(o.number, 'accept') }, L.accept), h('button', { class: 'btn small ghost', onclick: act(o.number, 'reject') }, L.reject)] : null,
        ['new', 'accepted'].includes(o.status) ? h('button', { class: 'btn small ghost', onclick: act(o.number, 'complete') }, L.complete) : null)))
      : [h('p', { class: 'muted card' }, L.none)]));
  } catch (e) { if (e.message !== 'login') wrap.replaceChildren(failed(() => orders())); }
}

async function debts(note) {
  const name = h('input', { id: 'dname', required: true, maxlength: 40 });
  const kind = h('select', { id: 'dkind' }, L.kinds.map(([v, t]) => h('option', { value: v }, t)));
  const amount = h('input', { id: 'damt', inputmode: 'numeric', required: true });
  const form = h('form', { class: 'card', onsubmit: async ev => {
    ev.preventDefault();
    try { await api('debts', { name: name.value, kind: kind.value, amount: Number(String(amount.value).replace(/[,\s]/g, '')) }); debts({ text: L.saved + name.value + ' ' + tsh(amount.value.replace(/[,\s]/g, '')) }); }
    catch (e) { if (e.message !== 'login') debts({ err: true, text: L.err }); }
  } }, h('h2', {}, L.addDebt), h('label', { for: 'dname' }, L.name), name, h('label', { for: 'dkind' }, L.kindLabel), kind,
  h('label', { for: 'damt' }, L.amount), amount, h('button', { class: 'btn', type: 'submit' }, L.save));
  const list = h('div', {}, '…');
  show(note ? h('div', { class: 'msg' + (note.err ? ' err' : '') }, note.text) : null, h('h2', {}, L.debtsTitle), list, form);
  try {
    const rows = await api('debts');
    const group = (title, rs, sign) => rs.length ? h('div', { class: 'card' }, h('div', { class: 'muted' }, title),
      rs.map(r => h('div', { class: 'row' }, h('span', {}, r.name, r.days != null ? h('small', {}, L.since(Number(r.days))) : null), h('b', {}, tsh(sign * r.balance))))) : null;
    const g1 = group(L.owesYou, rows.filter(r => r.balance > 0), 1), g2 = group(L.youOwe, rows.filter(r => r.balance < 0), -1);
    list.replaceChildren(...(g1 || g2 ? [g1, g2].filter(Boolean) : [h('p', { class: 'muted card' }, L.none)]));
  } catch (e) { if (e.message !== 'login') list.replaceChildren(failed(() => debts())); }
}

const SCREENS = { home, add, stock, orders, debts };
function go(t) {
  tab = t;
  $('tabs').replaceChildren(...L.tabs.map(([k, icon, label]) => h('button', { 'aria-current': k === tab ? 'page' : null, onclick: () => go(k) }, h('i', { 'aria-hidden': 'true' }, icon), label)));
  SCREENS[t]();
}

async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/d/app/sw.js', { scope: '/d/app/' }).catch(() => {});
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (tab === 'home') home(); });
  window.addEventListener('online', () => { netBadge(); flush().then(() => SCREENS[tab]()); });
  window.addEventListener('offline', netBadge);
  netBadge();
  try {
    const me = await api('me');
    L = S[me.lang] || S.sw;
    document.documentElement.lang = me.lang || 'sw';
    $('who').textContent = me.name || '';
    netBadge();
    go('home');
    flush();
  } catch (e) {
    if (e.message === 'login') return;
    if (!navigator.onLine && readQ) { show(h('div', { class: 'card' }, L.offlineFirst)); return; }
    show(failed(start));
  }
}
start();
