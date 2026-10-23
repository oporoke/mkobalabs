// Vendor catalog and customer orders (roadmap #3).
// Vendor (WhatsApp):  bidhaa | bidhaa ongeza chips 3000 | bidhaa ondoa chips | bidhaa imeisha chips | bidhaa ipo chips
//                     oda | oda 12 | kubali oda 12 | kataa oda 12 | maliza oda 12 (records the sale + receipt points)
// Customer (WhatsApp): "duka 4821" opens the shop; "1x2, 3" adds to the cart; TUMA sends the order; TOKA leaves.
// Customer (web):      https://mkoba.digital/k/4821 — choose quantities, name, phone, pickup or delivery.
// WhatsApp only allows free messages within 24 hours of the person's last message, so a vendor or customer
// outside that window is not messaged; vendors see waiting orders with their next message.
const crypto = require('crypto');
const express = require('express');
const log = require('./log');
const { parseLedgerEntry } = require('./parser');
const { fmtTsh } = require('./format');
const { esc, page } = require('./html');
const { stockNotes } = require('./stock');
const payments = require('./payments');

const SESSION_HOURS = 2;
const WINDOW_HOURS = 23;
const MAX_QTY = 99;
const TZ = 'Africa/Dar_es_Salaam';
const PHONE = /^(?:\+?255|0)([67]\d{8})$/;
const BASE = () => process.env.PUBLIC_URL || 'https://mkoba.digital';
const MKOBA_NUMBER = () => process.env.WHATSAPP_DISPLAY_NUMBER || '255788001168';
const showPhone = p => '0' + String(p).slice(3);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const W = {
  sw: {
    shopTitle: (shop, code) => `🛍️ ${shop} (duka ${code})`,
    noItems: 'Bado hakuna bidhaa. Ongeza kwa mfano: bidhaa ongeza chips 3000',
    vendorLinks: (code, link, wa) => `Wateja wanaagiza hapa:\n• Mtandaoni: ${link}\n• WhatsApp: ${wa}\n  (au watume "duka ${code}" kwa Mkoba)`,
    vendorHelp: 'Kuongeza: bidhaa ongeza chips 3000\nKuondoa: bidhaa ondoa chips\nImeisha / ipo: bidhaa imeisha chips, bidhaa ipo chips',
    out: '(imeisha)',
    added: lines => `Sawa! Bidhaa:\n${lines}`,
    badItems: list => `Sikuelewa: ${list}. Andika mfano: bidhaa ongeza chips 3000`,
    noSuchItem: what => `Sikupata bidhaa "${what}". Andika "bidhaa" kuona orodha.`,
    removed: n => `Sawa, nimeondoa ${n}.`,
    markedOut: n => `Sawa, ${n} imeonyeshwa kuwa imeisha.`,
    markedIn: n => `Sawa, ${n} ipo tena.`,
    ordersNone: 'Hakuna oda zinazosubiri.',
    ordersTitle: '🛒 Oda zinazosubiri:',
    statusWord: { new: 'mpya', accepted: 'imekubaliwa', rejected: 'imekataliwa', done: 'imekamilika' },
    orderLine: o => `#${o.number} ${showPhone(o.customer_phone)}${o.customer_name ? ` (${o.customer_name})` : ''} – ${fmtTsh(o.total)} – ${W.sw.statusWord[o.status]}`,
    orderNotFound: n => `Hakuna oda #${n}.`,
    newOrder: o => `🛒 Oda mpya #${o.number} kutoka ${showPhone(o.customer_phone)}${o.customer_name ? ` (${o.customer_name})` : ''}:`,
    orderDetail: o => `Oda #${o.number} (${W.sw.statusWord[o.status]}) – ${showPhone(o.customer_phone)}${o.customer_name ? ` (${o.customer_name})` : ''}:`,
    delivery: d => (d ? `Kuletewa: ${d}` : 'Atakuja kuchukua mwenyewe'),
    total: a => `Jumla: ${a}`,
    answer: n => `Jibu: kubali oda ${n} au kataa oda ${n}`,
    whenDone: n => `Ikishalipwa na kufika, andika: maliza oda ${n}`,
    alreadyClosed: (n, s) => `Oda #${n} tayari ${s}.`,
    vAccepted: (n, told) => `Sawa! Oda #${n} imekubaliwa.${told ? ' Nimemjulisha mteja.' : ' Mjulishe mteja (hajatuma ujumbe kwa saa 24, siwezi kumtumia).'}`,
    vRejected: (n, told) => `Sawa, oda #${n} imekataliwa.${told ? ' Nimemjulisha mteja.' : ' Mjulishe mteja (siwezi kumtumia ujumbe sasa).'}`,
    vDone: (n, amt, pts, told) => `Sawa! Oda #${n} imekamilika. Nimeongeza mauzo ${amt}; mteja amepata pointi ${pts}.${told ? ' Nimemtumia risiti.' : ' Mtumie mteja risiti inayofuata: bonyeza kwa muda mrefu, kisha "Sambaza".'}`,
    // customer
    welcome: (shop) => `Karibu ${shop}! Agiza kwa kuandika namba ya bidhaa na idadi, mfano: 1x2, 3\nKisha andika TUMA. Kuona kikapu: KIKAPU. Kuondoka: TOKA.`,
    privacy: url => `Ukiagiza, jina, namba na mahali unapotoa vitatumwa kwa muuzaji. Zaidi: ${url}`,
    noShop: code => `Hakuna duka lenye namba ${code}. Hakikisha namba na ujaribu tena.`,
    shopEmpty: shop => `${shop} bado haina bidhaa za kuagiza.`,
    cartEmpty: 'Kikapu ni tupu. Andika namba ya bidhaa na idadi, mfano: 1x2',
    cart: (lines, total) => `🧺 Kikapu:\n${lines}\nJumla: ${total}\nKuagiza, andika TUMA. Kuongeza zaidi, andika namba na idadi.`,
    badPick: n => `Hakuna bidhaa namba ${n}. Andika MENYU kuona orodha.`,
    outPick: name => `${name} imeisha kwa sasa.`,
    askDelivery: 'Andika jina lako na mahali pa kukuletea, mfano: Asha, Sinza Mori karibu na msikiti\nAu tuma location yako (📎 > Location) tukuletee hapo.\nKama utakuja kuchukua mwenyewe, andika: CHUKUA Asha',
    pinned: '📍 location aliyotuma (ramani)',
    sent: (n, shop, total) => `✅ Oda #${n} imetumwa kwa ${shop}. Jumla: ${total}.\nMuuzaji atakujibu hapa. Asante!`,
    custAccepted: (n, shop) => `✅ ${shop} amekubali oda yako #${n}.`,
    custRejected: (n, shop) => `❌ Samahani, ${shop} hawezi kukamilisha oda yako #${n} kwa sasa.`,
    custHelp: 'Andika namba ya bidhaa na idadi (mfano: 1x2), KIKAPU, TUMA, MENYU au TOKA.',
    bye: 'Asante! Umetoka dukani. Kurudi, andika "duka" na namba ya duka.',
    cleared: 'Kikapu kimefutwa.',
    pendingNotice: (lines, n) => `🛒 Una oda mpya:\n${lines}\nAndika "oda ${n}" kuona oda #${n}, kisha kubali au kataa.`,
  },
  en: {
    shopTitle: (shop, code) => `🛍️ ${shop} (shop ${code})`,
    noItems: 'No products yet. Add one, e.g.: catalog add chips 3000',
    vendorLinks: (code, link, wa) => `Customers order here:\n• Online: ${link}\n• WhatsApp: ${wa}\n  (or send "shop ${code}" to Mkoba)`,
    vendorHelp: 'Add: catalog add chips 3000\nRemove: catalog remove chips\nOut / back in stock: catalog out chips, catalog in chips',
    out: '(sold out)',
    added: lines => `Done! Products:\n${lines}`,
    badItems: list => `I didn't understand: ${list}. Send e.g.: catalog add chips 3000`,
    noSuchItem: what => `No product "${what}". Send "catalog" to see the list.`,
    removed: n => `Done, removed ${n}.`,
    markedOut: n => `Done, ${n} shows as sold out.`,
    markedIn: n => `Done, ${n} is available again.`,
    ordersNone: 'No orders waiting.',
    ordersTitle: '🛒 Orders waiting:',
    statusWord: { new: 'new', accepted: 'accepted', rejected: 'rejected', done: 'completed' },
    orderLine: o => `#${o.number} ${showPhone(o.customer_phone)}${o.customer_name ? ` (${o.customer_name})` : ''} – ${fmtTsh(o.total)} – ${W.en.statusWord[o.status]}`,
    orderNotFound: n => `There is no order #${n}.`,
    newOrder: o => `🛒 New order #${o.number} from ${showPhone(o.customer_phone)}${o.customer_name ? ` (${o.customer_name})` : ''}:`,
    orderDetail: o => `Order #${o.number} (${W.en.statusWord[o.status]}) – ${showPhone(o.customer_phone)}${o.customer_name ? ` (${o.customer_name})` : ''}:`,
    delivery: d => (d ? `Deliver to: ${d}` : 'Customer will collect'),
    total: a => `Total: ${a}`,
    answer: n => `Reply: accept order ${n} or reject order ${n}`,
    whenDone: n => `When paid and delivered, send: complete order ${n}`,
    alreadyClosed: (n, s) => `Order #${n} is already ${s}.`,
    vAccepted: (n, told) => `Done! Order #${n} accepted.${told ? ' I told the customer.' : " Tell the customer (they haven't messaged in 24 hours, so I can't)."}`,
    vRejected: (n, told) => `OK, order #${n} rejected.${told ? ' I told the customer.' : " Tell the customer (I can't message them now)."}`,
    vDone: (n, amt, pts, told) => `Done! Order #${n} completed. Added a sale of ${amt}; the customer earned ${pts} points.${told ? ' I sent them a receipt.' : ' Forward the next message to the customer: press and hold it, then "Forward".'}`,
    welcome: (shop) => `Welcome to ${shop}! Order by sending the product number and quantity, e.g.: 1x2, 3\nThen send ORDER. See your cart: CART. Leave: EXIT.`,
    privacy: url => `If you order, your name, number and location are sent to the seller. More: ${url}`,
    noShop: code => `There is no shop number ${code}. Check the number and try again.`,
    shopEmpty: shop => `${shop} has no products to order yet.`,
    cartEmpty: 'Your cart is empty. Send the product number and quantity, e.g.: 1x2',
    cart: (lines, total) => `🧺 Cart:\n${lines}\nTotal: ${total}\nTo order, send ORDER. To add more, send number and quantity.`,
    badPick: n => `There is no product number ${n}. Send MENU to see the list.`,
    outPick: name => `${name} is sold out right now.`,
    askDelivery: 'Send your name and where to deliver, e.g.: Asha, Sinza Mori near the mosque\nOr share your location (📎 > Location) and we deliver there.\nIf you will collect it yourself, send: PICKUP Asha',
    pinned: '📍 shared location (map)',
    sent: (n, shop, total) => `✅ Order #${n} sent to ${shop}. Total: ${total}.\nThe seller will reply here. Thank you!`,
    custAccepted: (n, shop) => `✅ ${shop} accepted your order #${n}.`,
    custRejected: (n, shop) => `❌ Sorry, ${shop} can't complete your order #${n} right now.`,
    custHelp: 'Send a product number and quantity (e.g. 1x2), CART, ORDER, MENU or EXIT.',
    bye: 'Thank you! You left the shop. To come back, send "shop" and the shop number.',
    cleared: 'Cart cleared.',
    pendingNotice: (lines, n) => `🛒 You have new orders:\n${lines}\nSend "order ${n}" to see order #${n}, then accept or reject it.`,
  },
};
const w = lang => W[lang] || W.sw;

// ---------- shared helpers ----------
async function shopCode(pool, vendorId) {
  const { rows: [v] } = await pool.query('SELECT shop_code FROM vendors WHERE id = $1', [vendorId]);
  if (v?.shop_code) return v.shop_code;
  for (let i = 0; i < 50; i++) {
    const code = String(i < 30 ? crypto.randomInt(1000, 10000) : crypto.randomInt(100000, 1000000));
    const { rowCount } = await pool.query(
      `UPDATE vendors SET shop_code = $2 WHERE id = $1 AND shop_code IS NULL
         AND NOT EXISTS (SELECT 1 FROM vendors WHERE shop_code = $2)`, [vendorId, code]);
    if (rowCount) return code;
    const { rows: [again] } = await pool.query('SELECT shop_code FROM vendors WHERE id = $1', [vendorId]);
    if (again?.shop_code) return again.shop_code;
  }
  throw new Error('no free shop code');
}

async function shopName(pool, vendorId) {
  const { rows: [v] } = await pool.query('SELECT name, business_type FROM vendors WHERE id = $1', [vendorId]);
  const name = v?.name && !/^\d+$/.test(v.name) ? v.name : null;
  return [name, v?.business_type].filter(Boolean).join(' – ') || 'Duka';
}

const items = async (pool, vendorId) => (await pool.query(
  'SELECT id, name, price, available FROM catalog_items WHERE vendor_id = $1 ORDER BY id', [vendorId])).rows
  .map((r, i) => ({ ...r, n: i + 1, price: Number(r.price) }));

const menuLines = (list, lang) => list.map(i => `${i.n}. ${cap(i.name)} – ${fmtTsh(i.price)}${i.available ? '' : ' ' + w(lang).out}`).join('\n');

// True if the person sent us a message in the last 23 hours (WhatsApp's free-reply window).
async function inWindow(pool, phone) {
  const { rows: [r] } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM messages_log WHERE phone_number = $1 AND direction = 'inbound'
                     AND created_at > now() - interval '${WINDOW_HOURS} hours') AS ok`, [phone]);
  return r.ok;
}

async function orderWithItems(pool, vendorId, number) {
  const { rows: [o] } = await pool.query('SELECT * FROM orders WHERE vendor_id = $1 AND number = $2', [vendorId, number]);
  if (!o) return null;
  const { rows: lines } = await pool.query('SELECT name, price, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [o.id]);
  return { ...o, total: Number(o.total), lines };
}

const orderText = (o, lang, head) => [head, ...o.lines.map(l => `- ${cap(l.name)} x${l.quantity} ${fmtTsh(Number(l.price) * l.quantity)}`),
  w(lang).total(fmtTsh(o.total)), w(lang).delivery(o.delivery)].join('\n');

// Create an order (WhatsApp or web). cart: [{ itemId, quantity }]. Returns the order with items, or null if nothing valid.
async function createOrder(pool, vendorId, { phone, name, delivery, channel, cart }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, 2)', [vendorId]);
    const { rows: avail } = await client.query(
      'SELECT id, name, price FROM catalog_items WHERE vendor_id = $1 AND available AND id = ANY($2::bigint[])',
      [vendorId, cart.map(c => c.itemId)]);
    const lines = cart.map(c => ({ ...avail.find(a => String(a.id) === String(c.itemId)), quantity: c.quantity }))
      .filter(l => l.id && l.quantity > 0);
    if (!lines.length) { await client.query('ROLLBACK'); return null; }
    const total = lines.reduce((s, l) => s + Number(l.price) * l.quantity, 0);
    const { rows: [o] } = await client.query(
      `INSERT INTO orders (vendor_id, number, customer_phone, customer_name, delivery, channel, total)
       VALUES ($1, (SELECT COALESCE(max(number), 0) + 1 FROM orders WHERE vendor_id = $1), $2, $3, $4, $5, $6) RETURNING *`,
      [vendorId, phone, name || null, delivery || null, channel, total]);
    for (const l of lines) {
      await client.query('INSERT INTO order_items (order_id, item_id, name, price, quantity) VALUES ($1, $2, $3, $4, $5)',
        [o.id, l.id, l.name, l.price, l.quantity]);
    }
    await client.query('COMMIT');
    log.info('order_created', { vendor: vendorId, order: o.number, channel });
    return { ...o, total, lines };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Tell the vendor about a new order now if WhatsApp allows; otherwise it waits for their next message.
async function notifyVendor(pool, wa, vendorId, o) {
  const { rows: [v] } = await pool.query('SELECT phone_number, language FROM vendors WHERE id = $1', [vendorId]);
  if (!(await inWindow(pool, v.phone_number))) return false;
  const L = w(v.language);
  const res = await wa.sendText(v.phone_number, `${orderText(o, v.language, L.newOrder(o))}\n${L.answer(o.number)}`);
  if (res.ok) await pool.query('UPDATE orders SET vendor_notified_at = now() WHERE id = $1', [o.id]);
  return res.ok;
}

// Waiting orders the vendor has not been told about; shown with their next message.
async function pendingOrderNotice(pool, vendorId, lang = 'sw') {
  const { rows } = await pool.query(
    `UPDATE orders SET vendor_notified_at = now() WHERE vendor_id = $1 AND status = 'new' AND vendor_notified_at IS NULL
     RETURNING number, customer_phone, customer_name, total, status`, [vendorId]);
  if (!rows.length) return null;
  rows.sort((a, b) => a.number - b.number);
  return w(lang).pendingNotice(rows.map(o => '- ' + w(lang).orderLine({ ...o, total: Number(o.total) })).join('\n'), rows[0].number);
}

// Payment request for an accepted order: order total plus the delivery fee when it is known.
// A web customer may already have paid the goods; then only the delivery fee is asked for.
async function orderPayment(pool, wa, vendorId, o, lang, tell) {
  if (!payments.enabled()) return '';
  const { rows: [dl] } = await pool.query('SELECT id, fee FROM deliveries WHERE order_id = $1', [o.id]);
  const fee = dl?.fee ? Number(dl.fee) : 0;
  const { rows: [prev] } = await pool.query(`SELECT * FROM payments WHERE order_id = $1 AND status IN ('pending', 'paid') ORDER BY id DESC LIMIT 1`, [o.id]);
  let pay;
  if (prev?.status === 'paid') {
    if (!fee) return '';
    pay = await payments.createPayment(pool, { purpose: 'delivery', amount: fee, phone: o.customer_phone, name: o.customer_name,
      lang: o.customer_lang, order_id: o.id, delivery_id: dl.id, rider_amount: fee });
  } else {
    if (prev) await pool.query(`UPDATE payments SET status = 'cancelled' WHERE id = $1`, [prev.id]);
    pay = await payments.createPayment(pool, { purpose: 'order', amount: o.total + fee, phone: o.customer_phone, name: o.customer_name,
      lang: o.customer_lang, order_id: o.id, delivery_id: dl?.id, vendor_id: vendorId, vendor_amount: o.total, rider_amount: fee, items: o.lines.length });
  }
  if (!pay) return '';
  const sent = await tell(payments.payLine(pay, o.customer_lang || 'sw'));
  return '\n' + (lang === 'en'
    ? (sent ? `💳 The customer was sent a link to pay ${fmtTsh(pay.amount)} by phone.` : `💳 Give the customer this payment link: ${payments.payUrl(pay.ref)}`)
    : (sent ? `💳 Mteja ametumiwa kiungo cha kulipa ${fmtTsh(pay.amount)} kwa simu.` : `💳 Mpe mteja kiungo hiki cha kulipa: ${payments.payUrl(pay.ref)}`));
}

// ---------- vendor commands ----------
// -> null | { kind: 'list' } | { kind: 'add', parts } | { kind: 'remove'|'out'|'in', what } | { kind: 'orders' }
//    | { kind: 'order', number } | { kind: 'accept'|'reject'|'complete', number }
function parseVendorCatalog(text) {
  const s = String(text || '').trim();
  let m = s.match(/^(?:bidhaa|katalogi|catalog(?:ue)?)\s*$/i);
  if (m) return { kind: 'list' };
  m = s.match(/^(?:bidhaa|katalogi|catalog(?:ue)?)\s+(ongeza|add)\b([\s\S]*)$/i);
  if (m) return { kind: 'add', parts: m[2].split(/[\n,;]+/).map(x => x.trim()).filter(Boolean) };
  m = s.match(/^(?:bidhaa|katalogi|catalog(?:ue)?)\s+(ondoa|remove|imeisha|out|ipo|in)\s+(.+)$/i);
  if (m) {
    const k = m[1].toLowerCase();
    return { kind: ['ondoa', 'remove'].includes(k) ? 'remove' : ['imeisha', 'out'].includes(k) ? 'out' : 'in', what: m[2].trim() };
  }
  const n = norm(s);
  if (['oda', 'orders', 'order'].includes(n)) return { kind: 'orders' };
  m = n.match(/^(?:oda|order)\s+(\d+)$/);
  if (m) return { kind: 'order', number: +m[1] };
  m = n.match(/^(kubali|accept|kataa|reject|maliza|complete)\s+(?:oda|order)\s+(\d+)$/);
  if (m) {
    const k = m[1];
    return { kind: ['kubali', 'accept'].includes(k) ? 'accept' : ['kataa', 'reject'].includes(k) ? 'reject' : 'complete', number: +m[2] };
  }
  return null;
}

async function findItem(pool, vendorId, what) {
  const list = await items(pool, vendorId);
  if (/^\d+$/.test(what)) return list.find(i => i.n === +what) || null;
  return list.find(i => i.name.toLowerCase() === what.toLowerCase()) || null;
}

async function vendorCatalogReply(pool, wa, vendorId, messageId, cmd, lang = 'sw') {
  const L = w(lang);
  if (cmd.kind === 'list') {
    const code = await shopCode(pool, vendorId);
    const list = await items(pool, vendorId);
    const wa_link = `https://wa.me/${MKOBA_NUMBER()}?text=${encodeURIComponent(`duka ${code}`)}`;
    return [L.shopTitle(await shopName(pool, vendorId), code), list.length ? menuLines(list, lang) : L.noItems, '',
      L.vendorLinks(code, `${BASE()}/k/${code}`, wa_link), '', L.vendorHelp].join('\n');
  }
  if (cmd.kind === 'add') {
    const ok = [], bad = [];
    for (const part of cmd.parts) {
      const e = parseLedgerEntry(part);
      if (!e.item || !(e.amount > 0)) { bad.push(`"${part}"`); continue; }
      await pool.query(
        `INSERT INTO catalog_items (vendor_id, name, name_key, price) VALUES ($1, $2, lower($2), $3)
         ON CONFLICT (vendor_id, name_key) DO UPDATE SET price = EXCLUDED.price, available = true, updated_at = now()`,
        [vendorId, e.item, e.amount]);
      ok.push(`- ${cap(e.item)} ${fmtTsh(e.amount)}`);
    }
    await shopCode(pool, vendorId);
    if (!ok.length) return L.badItems(bad.join(', ') || '""');
    return L.added(ok.join('\n')) + (bad.length ? '\n' + L.badItems(bad.join(', ')) : '');
  }
  if (['remove', 'out', 'in'].includes(cmd.kind)) {
    const it = await findItem(pool, vendorId, cmd.what);
    if (!it) return L.noSuchItem(cmd.what);
    if (cmd.kind === 'remove') {
      await pool.query('DELETE FROM catalog_items WHERE id = $1', [it.id]);
      return L.removed(it.name);
    }
    await pool.query('UPDATE catalog_items SET available = $2, updated_at = now() WHERE id = $1', [it.id, cmd.kind === 'in']);
    return cmd.kind === 'in' ? L.markedIn(it.name) : L.markedOut(it.name);
  }
  if (cmd.kind === 'orders') {
    const { rows } = await pool.query(
      `SELECT number, customer_phone, customer_name, total, status FROM orders
        WHERE vendor_id = $1 AND status IN ('new', 'accepted') ORDER BY number`, [vendorId]);
    await pool.query(`UPDATE orders SET vendor_notified_at = now() WHERE vendor_id = $1 AND vendor_notified_at IS NULL`, [vendorId]);
    if (!rows.length) return L.ordersNone;
    return [L.ordersTitle, ...rows.map(o => '- ' + L.orderLine({ ...o, total: Number(o.total) }))].join('\n');
  }

  const o = await orderWithItems(pool, vendorId, cmd.number);
  if (!o) return L.orderNotFound(cmd.number);
  if (cmd.kind === 'order') {
    const next = o.status === 'new' ? L.answer(o.number) : o.status === 'accepted' ? L.whenDone(o.number) : '';
    return orderText(o, lang, L.orderDetail(o)) + (next ? '\n' + next : '');
  }
  if (o.status === 'rejected' || o.status === 'done' || (cmd.kind === 'accept' && o.status !== 'new')) {
    return L.alreadyClosed(o.number, L.statusWord[o.status]);
  }

  const shop = await shopName(pool, vendorId);
  const custLang = o.customer_lang || 'sw';
  const tell = async msg => (await inWindow(pool, o.customer_phone)) && (await wa.sendText(o.customer_phone, msg)).ok;

  if (cmd.kind === 'accept') {
    await pool.query(`UPDATE orders SET status = 'accepted', updated_at = now() WHERE id = $1`, [o.id]);
    const told = await tell(w(custLang).custAccepted(o.number, shop));
    const boda = await require('./delivery').jobForOrder(pool, wa, vendorId, o, lang); // delivery orders get a rider job
    return L.vAccepted(o.number, told) + boda + await orderPayment(pool, wa, vendorId, o, lang, tell) + '\n' + L.whenDone(o.number);
  }
  if (cmd.kind === 'reject') {
    await pool.query(`UPDATE orders SET status = 'rejected', updated_at = now() WHERE id = $1`, [o.id]);
    await pool.query(`UPDATE payments SET status = 'cancelled' WHERE order_id = $1 AND status = 'pending'`, [o.id]);
    await pool.query(`UPDATE payments SET note = 'refund needed: order rejected' WHERE order_id = $1 AND status = 'paid'`, [o.id]);
    return L.vRejected(o.number, await tell(w(custLang).custRejected(o.number, shop)));
  }

  // complete: record the sale (one record per line, so stock and best sellers work) and a receipt for points
  const client = await pool.connect();
  let receiptNo;
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE orders SET status = 'done', updated_at = now() WHERE id = $1 AND status IN ('new', 'accepted')`, [o.id]);
    if (!rowCount) { await client.query('ROLLBACK'); return L.alreadyClosed(o.number, L.statusWord.done); }
    for (const l of o.lines) {
      await client.query(
        `INSERT INTO transactions (vendor_id, message_id, type, direction, amount_tsh, raw_input, channel, parse_confidence, status, item, quantity)
         VALUES ($1, $2, 'sale', 'credit', $3, $4, 'order', 1, 'confirmed', $5, $6)`,
        [vendorId, messageId, Number(l.price) * l.quantity, `oda #${o.number}`, l.name, l.quantity]);
    }
    await client.query('SELECT pg_advisory_xact_lock($1)', [vendorId]);
    const { rows: [r] } = await client.query(
      `INSERT INTO receipts (vendor_id, number, customer_phone, message_id)
       VALUES ($1, (SELECT COALESCE(max(number), 0) + 1 FROM receipts WHERE vendor_id = $1), $2, $3) RETURNING number`,
      [vendorId, o.customer_phone, messageId]);
    receiptNo = r.number;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const { TSH_PER_POINT, balance } = require('./loyalty');
  const pts = Math.floor(o.total / TSH_PER_POINT);
  const { rows: [{ at }] } = await pool.query(`SELECT to_char(now() AT TIME ZONE '${TZ}', 'DD/MM/YYYY HH24:MI') AS at`);
  const CL = require('./i18n').t(custLang);
  const receipt = [CL.receiptHeader(`R-${String(receiptNo).padStart(4, '0')}`, shop), at,
    ...o.lines.map(l => `- ${cap(l.name)} x${l.quantity} ${fmtTsh(Number(l.price) * l.quantity)}`),
    CL.receiptTotal(fmtTsh(o.total)), CL.receiptPoints(pts, (await balance(pool, vendorId, o.customer_phone)).balance), CL.receiptThanks].join('\n');
  const told = await tell(receipt);
  const notes = await stockNotes(pool, vendorId, o.lines.map(l => ({ type: 'sale', item: l.name, quantity: l.quantity })), lang);
  return [L.vDone(o.number, fmtTsh(o.total), pts, told) + notes, ...(told ? [] : [receipt])];
}

// ---------- customer on WhatsApp ----------
function parseShopOpen(text) {
  const m = norm(text).match(/^(duka|shop)\s+(\d{4,6})$/);
  return m ? { code: m[2], lang: m[1] === 'shop' ? 'en' : 'sw' } : null;
}

async function activeSession(pool, phone) {
  const { rows: [s] } = await pool.query(
    'SELECT * FROM customer_sessions WHERE phone = $1 AND expires_at > now()', [phone]);
  return s || null;
}

const saveSession = (pool, phone, s) => pool.query(
  `INSERT INTO customer_sessions (phone, vendor_id, lang, cart, step, expires_at)
   VALUES ($1, $2, $3, $4, $5, now() + interval '${SESSION_HOURS} hours')
   ON CONFLICT (phone) DO UPDATE SET vendor_id = EXCLUDED.vendor_id, lang = EXCLUDED.lang, cart = EXCLUDED.cart,
     step = EXCLUDED.step, expires_at = EXCLUDED.expires_at`,
  [phone, s.vendor_id, s.lang, JSON.stringify(s.cart || []), s.step || null]);

const endSession = (pool, phone) => pool.query('DELETE FROM customer_sessions WHERE phone = $1', [phone]);

const WORDS = {
  cart: ['kikapu', 'cart'], send: ['tuma', 'agiza', 'order', 'send'], menu: ['menyu', 'menu', 'bidhaa', 'orodha'],
  exit: ['toka', 'exit', 'ondoka'], clear: ['futa kikapu', 'clear', 'clear cart'],
};
const is = (n, k) => WORDS[k].includes(n);

function cartText(cart, list, lang) {
  const lines = cart.map(c => { const i = list.find(x => String(x.id) === String(c.itemId)); return i ? { i, q: c.quantity } : null; }).filter(Boolean);
  if (!lines.length) return w(lang).cartEmpty;
  const total = lines.reduce((s, l) => s + l.i.price * l.q, 0);
  return w(lang).cart(lines.map(l => `- ${cap(l.i.name)} x${l.q} ${fmtTsh(l.i.price * l.q)}`).join('\n'), fmtTsh(total));
}

// Handles a message from a customer (someone who opened a shop). Returns reply text(s).
async function customerReply(pool, wa, phone, text, session, open, loc = null) {
  if (open) {
    const { rows: [v] } = await pool.query('SELECT id FROM vendors WHERE shop_code = $1', [open.code]);
    const L = w(open.lang);
    if (!v) return L.noShop(open.code);
    const shop = await shopName(pool, v.id);
    const list = await items(pool, v.id);
    if (!list.length) return L.shopEmpty(shop);
    await saveSession(pool, phone, { vendor_id: v.id, lang: open.lang, cart: [] });
    const privacy = `${BASE()}/${open.lang === 'en' ? 'privacy' : 'faragha'}`;
    return [`${L.shopTitle(shop, open.code)}\n${menuLines(list, open.lang)}`, `${L.welcome(shop)}\n\n${L.privacy(privacy)}`];
  }

  const lang = session.lang, L = w(lang), n = norm(text);
  const list = await items(pool, session.vendor_id);
  const cart = session.cart || [];
  if (loc && session.step === 'ask_delivery') {
    // A shared WhatsApp location: deliver there (the map position lets Mkoba work out the delivery fee).
    const o = await createOrder(pool, session.vendor_id, { phone, name: null, delivery: L.pinned, channel: 'whatsapp', cart });
    await endSession(pool, phone);
    if (!o) return L.cartEmpty;
    await pool.query('UPDATE orders SET customer_lang = $2, drop_lat = $3, drop_lng = $4 WHERE id = $1', [o.id, lang, loc.lat, loc.lng]);
    await notifyVendor(pool, wa, session.vendor_id, { ...o, delivery: L.pinned });
    return L.sent(o.number, await shopName(pool, session.vendor_id), fmtTsh(o.total));
  }
  if (text == null) return L.custHelp;
  if (is(n, 'exit')) { await endSession(pool, phone); return L.bye; }
  if (is(n, 'menu')) return menuLines(list, lang);
  if (is(n, 'cart')) return cartText(cart, list, lang);
  if (is(n, 'clear')) { await saveSession(pool, phone, { ...session, cart: [], step: null }); return L.cleared; }

  if (session.step === 'ask_delivery' && !/^[\d\sx×*,]+$/i.test(n)) {
    const pickup = text.trim().match(/^(?:chukua|pickup|pick up)\b[\s,:-]*(.*)$/i);
    let name, delivery;
    if (pickup) { name = pickup[1].trim() || null; delivery = null; }
    else { const [first, ...rest] = text.split(','); name = rest.length ? first.trim() : null; delivery = (rest.length ? rest.join(',') : text).trim(); }
    const o = await createOrder(pool, session.vendor_id, { phone, name: name?.slice(0, 60), delivery: delivery?.slice(0, 200), channel: 'whatsapp', cart });
    await endSession(pool, phone);
    if (!o) return L.cartEmpty;
    await pool.query('UPDATE orders SET customer_lang = $2 WHERE id = $1', [o.id, lang]);
    await notifyVendor(pool, wa, session.vendor_id, o);
    return L.sent(o.number, await shopName(pool, session.vendor_id), fmtTsh(o.total));
  }

  if (is(n, 'send')) {
    if (!cart.length) return L.cartEmpty;
    await saveSession(pool, phone, { ...session, step: 'ask_delivery' });
    return `${cartText(cart, list, lang).split('\n').slice(0, -1).join('\n')}\n\n${L.askDelivery}`;
  }

  // picks: "1x2, 3", "2 x 1"
  const picks = [...n.matchAll(/(\d+)\s*(?:x|\*)\s*(\d+)|(\d+)/g)].map(m => m[3] ? { n: +m[3], q: 1 } : { n: +m[1], q: +m[2] });
  if (picks.length && /^[\d\sx*,]+$/.test(n)) {
    const next = [...cart];
    for (const p of picks) {
      const it = list.find(i => i.n === p.n);
      if (!it) return L.badPick(p.n);
      if (!it.available) return L.outPick(cap(it.name));
      const q = Math.min(Math.max(p.q, 0), MAX_QTY);
      const ex = next.find(c => String(c.itemId) === String(it.id));
      if (ex) ex.quantity = Math.min(ex.quantity + q, MAX_QTY); else if (q) next.push({ itemId: it.id, quantity: q });
    }
    await saveSession(pool, phone, { ...session, cart: next, step: null });
    return cartText(next, list, lang);
  }
  return L.custHelp;
}

// ---------- web catalog: /k/:code ----------
const router = express.Router();
router.use(express.urlencoded({ extended: false, limit: '8kb' }));
const posts = new Map(); // ip -> timestamps (anti-spam: 5 orders per 10 minutes)

async function shopByCode(pool, code) {
  if (!/^\d{4,6}$/.test(code)) return null;
  const { rows: [v] } = await pool.query('SELECT id FROM vendors WHERE shop_code = $1', [code]);
  return v || null;
}

function webForm(shop, code, list, err = '', vals = {}) {
  const avail = list.filter(i => i.available);
  return page(shop, `
  <h1 class="doc-title">${esc(shop)}</h1>
  ${err ? `<p class="card out" role="alert">${esc(err)}</p>` : ''}
  <form method="post" action="/k/${esc(code)}">
    <ul class="breakdown">${avail.map(i => `<li><label for="q${i.id}">${esc(cap(i.name))} <span class="muted">${esc(fmtTsh(i.price))}</span></label>
      <input id="q${i.id}" name="q${i.id}" type="number" inputmode="numeric" min="0" max="${MAX_QTY}" value="${esc(vals['q' + i.id] || 0)}" style="width:4.5rem;font:inherit;padding:6px"></li>`).join('')}
    </ul>
    ${list.some(i => !i.available) ? `<p class="note">Zimeisha kwa sasa: ${esc(list.filter(i => !i.available).map(i => i.name).join(', '))}</p>` : ''}
    <h2>Taarifa zako</h2>
    <p><label for="name">Jina</label><br><input id="name" name="name" required maxlength="60" value="${esc(vals.name || '')}" style="width:100%;font:inherit;padding:8px"></p>
    <p><label for="phone">Namba ya simu</label><br><input id="phone" name="phone" required inputmode="tel" placeholder="07XX XXX XXX" value="${esc(vals.phone || '')}" style="width:100%;font:inherit;padding:8px"></p>
    <fieldset style="border:0;padding:0;margin:0 0 12px"><legend>Upokeaji</legend>
      <label><input type="radio" name="how" value="pickup"${vals.how !== 'deliver' ? ' checked' : ''}> Nitakuja kuchukua</label><br>
      <label><input type="radio" name="how" value="deliver"${vals.how === 'deliver' ? ' checked' : ''}> Niletewe</label></fieldset>
    <p><label for="place">Mahali pa kukuletea (ukichagua kuletewa)</label><br><input id="place" name="place" maxlength="200" value="${esc(vals.place || '')}" style="width:100%;font:inherit;padding:8px"></p>
    <p class="sr"><label for="website">Usijaze</label><input id="website" name="website" tabindex="-1" autocomplete="off"></p>
    <button class="btn" type="submit">Tuma oda</button>
  </form>
  <p class="note">Jina, namba na mahali unapotoa vitatumwa kwa muuzaji tu. <a href="/faragha">Faragha</a></p>`);
}

function makeRouter(pool, wa) {
  router.get('/:code', async (req, res, next) => {
    try {
      const v = await shopByCode(pool, req.params.code);
      if (!v) return res.status(404).send(page('Duka halipo', '<div class="card"><h1>Duka hili halipo</h1><p>Hakikisha kiungo ni sahihi.</p></div>'));
      const list = await items(pool, v.id);
      res.set('X-Robots-Tag', 'noindex');
      if (!list.some(i => i.available)) return res.send(page('Duka', `<div class="card"><h1>${esc(await shopName(pool, v.id))}</h1><p>Hakuna bidhaa za kuagiza kwa sasa.</p></div>`));
      res.send(webForm(await shopName(pool, v.id), req.params.code, list));
    } catch (err) { next(err); }
  });

  router.post('/:code', async (req, res, next) => {
    try {
      const v = await shopByCode(pool, req.params.code);
      if (!v) return res.status(404).send(page('Duka halipo', '<div class="card"><h1>Duka hili halipo</h1></div>'));
      const now = Date.now();
      const recent = (posts.get(req.ip) || []).filter(t => t > now - 10 * 60e3);
      if (recent.length >= 5) return res.status(429).send(page('Subiri', '<div class="card"><h1>Subiri kidogo</h1><p>Oda nyingi kwa muda mfupi. Jaribu tena baada ya dakika 10.</p></div>'));
      if (req.body.website) return res.status(400).send(page('Kosa', '<div class="card"><h1>Kosa</h1></div>')); // bots fill hidden fields
      const list = await items(pool, v.id);
      const shop = await shopName(pool, v.id);
      const cart = list.filter(i => i.available)
        .map(i => ({ itemId: i.id, quantity: Math.min(parseInt(req.body['q' + i.id], 10) || 0, MAX_QTY) })).filter(c => c.quantity > 0);
      const phoneM = String(req.body.phone || '').replace(/[\s-]/g, '').match(PHONE);
      const name = String(req.body.name || '').trim().slice(0, 60);
      const deliver = req.body.how === 'deliver';
      const place = String(req.body.place || '').trim().slice(0, 200);
      const err = !cart.length ? 'Chagua angalau bidhaa moja.' : !name ? 'Andika jina lako.' : !phoneM ? 'Andika namba sahihi ya simu, mfano 0712345678.'
        : deliver && !place ? 'Andika mahali pa kukuletea.' : '';
      if (err) return res.status(400).send(webForm(shop, req.params.code, list, err, req.body));
      posts.set(req.ip, [...recent, now]);
      const o = await createOrder(pool, v.id, { phone: '255' + phoneM[1], name, delivery: deliver ? place : null, channel: 'web', cart });
      if (!o) return res.status(400).send(webForm(shop, req.params.code, list, 'Bidhaa ulizochagua zimeisha.', req.body));
      await notifyVendor(pool, wa, v.id, o);
      // Web customers may pay right away (WhatsApp can't reach them later); the delivery fee is paid to the rider.
      const pay = await payments.createPayment(pool, { purpose: 'order', amount: o.total, phone: o.customer_phone, name, lang: 'sw',
        order_id: o.id, vendor_id: v.id, vendor_amount: o.total, items: o.lines.length });
      res.send(page('Oda imetumwa', `<div class="card"><h1>✅ Oda #${o.number} imetumwa</h1>
        <p>${esc(shop)} amepokea oda yako ya <b>${esc(fmtTsh(o.total))}</b>.</p>
        <p>Muuzaji atawasiliana nawe kwa namba ${esc(showPhone(o.customer_phone))}.</p>
        ${pay ? `<p><a class="btn" style="text-align:center;text-decoration:none" href="/pay/${esc(pay.ref)}">Lipa ${esc(fmtTsh(o.total))} sasa kwa simu</a></p>
          <p class="note">Au utalipa ukipokea. Oda ikikataliwa baada ya kulipa, utarudishiwa pesa.${deliver ? ' Usafiri utamlipa boda.' : ''}</p>` : ''}</div>`));
    } catch (err) { next(err); }
  });
  return router;
}

// Someone who ordered as a customer and is not a vendor.
async function isPastCustomer(pool, phone) {
  const { rows: [r] } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM orders WHERE customer_phone = $1) AND NOT EXISTS (SELECT 1 FROM vendors WHERE phone_number = $1) AS yes`, [phone]);
  return r.yes;
}

async function customerHint(pool, phone) {
  const { rows: [o] } = await pool.query(
    `SELECT v.shop_code, o.customer_lang FROM orders o JOIN vendors v ON v.id = o.vendor_id
      WHERE o.customer_phone = $1 ORDER BY o.id DESC LIMIT 1`, [phone]);
  return o.customer_lang === 'en'
    ? `Hello! To order again, send: shop ${o.shop_code}\nTo use Mkoba for your own business, send: REGISTER`
    : `Habari! Kuagiza tena, andika: duka ${o.shop_code}\nKutumia Mkoba kwa biashara yako, andika: SAJILI`;
}

module.exports = { isPastCustomer, customerHint, parseVendorCatalog, vendorCatalogReply, parseShopOpen, activeSession, customerReply, pendingOrderNotice, makeRouter, shopCode };
