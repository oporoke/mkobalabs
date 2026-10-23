// Mobile-money payments through Selcom (roadmap #9): customer orders, bulk-order shares and delivery fees.
//   Each payment has a short link (mkoba.digital/pay/<ref>) that opens Selcom's payment page, and the payer can send
//   LIPA on WhatsApp to get a PIN prompt on their phone (USSD push).
//   Selcom's notification is not trusted on its own: Mkoba always re-asks Selcom for the order status before marking paid.
//   Money arrives in the Mkoba Selcom account. What is owed to each vendor and rider is shown on /admin/payments, where
//   payouts are recorded after they are sent (sending them through Selcom is not automated yet).
const crypto = require('crypto');
const express = require('express');
const log = require('./log');
const selcom = require('./selcom');
const { fmtTsh } = require('./format');
const { esc, page } = require('./html');

const TZ = 'Africa/Dar_es_Salaam';
const BASE = () => process.env.PUBLIC_URL || 'https://mkoba.digital';
const enabled = () => selcom.configured() || process.env.DRY_RUN === '1';
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const W = {
  sw: {
    payLine: (amt, url) => `💳 Lipa ${amt} kwa simu: andika LIPA (utapokea ombi la PIN), au fungua: ${url}`,
    pushed: amt => `📲 Angalia simu yako: weka PIN kulipa ${amt}. Ukimaliza, nitakujulisha.`,
    pushFailed: url => `Sikuweza kutuma ombi la PIN. Lipa hapa badala yake: ${url}`,
    nothing: 'Huna malipo yanayosubiri.',
    paid: (amt, what) => `✅ Malipo ya ${amt} yamepokelewa (${what}). Asante!`,
    whatOrder: n => `oda #${n}`, whatBulk: 'oda ya jumla', whatDelivery: 'usafiri',
    vendorPaid: (n, amt) => `💳 Oda #${n} imelipwa kwa simu: ${amt}.`,
    riderPaid: id => `💳 Usafiri wa kazi #${id} umelipwa kwa simu. Usipokee pesa taslimu kwa kazi hii.`,
    refundNeeded: n => `Oda #${n} ilikuwa imeshalipwa. Mkoba itamrudishia mteja pesa.`,
  },
  en: {
    payLine: (amt, url) => `💳 Pay ${amt} by phone: send PAY (you get a PIN prompt), or open: ${url}`,
    pushed: amt => `📲 Check your phone: enter your PIN to pay ${amt}. I will tell you when it is done.`,
    pushFailed: url => `I couldn't send the PIN prompt. Pay here instead: ${url}`,
    nothing: 'You have no payments waiting.',
    paid: (amt, what) => `✅ Payment of ${amt} received (${what}). Thank you!`,
    whatOrder: n => `order #${n}`, whatBulk: 'bulk order', whatDelivery: 'delivery',
    vendorPaid: (n, amt) => `💳 Order #${n} was paid by phone: ${amt}.`,
    riderPaid: id => `💳 Delivery job #${id} was paid by phone. Do not take cash for this job.`,
    refundNeeded: n => `Order #${n} was already paid. Mkoba will refund the customer.`,
  },
};
const w = lang => W[lang] || W.sw;
const payUrl = ref => `${BASE()}/pay/${ref}`;

// Create a payment and its Selcom order. split: { vendor_amount, rider_amount, supplier_amount } (sum = amount).
// Returns the payment row, or null when payments are off or Selcom refused.
async function createPayment(pool, p) {
  if (!enabled() || !(p.amount > 0)) return null;
  const ref = `MKB${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const { rows: [row] } = await pool.query(
    `INSERT INTO payments (ref, purpose, amount, payer_phone, payer_name, lang, order_id, bulk_order_id, member_id, delivery_id,
                           vendor_id, vendor_amount, rider_amount, supplier_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [ref, p.purpose, Math.round(p.amount), p.phone, p.name || null, p.lang || 'sw', p.order_id || null, p.bulk_order_id || null,
      p.member_id || null, p.delivery_id || null, p.vendor_id || null, p.vendor_amount || 0, p.rider_amount || 0, p.supplier_amount || 0]);
  const r = await selcom.createOrder({ orderId: ref, phone: p.phone, name: p.name, amount: row.amount, items: p.items || 1,
    webhook: `${BASE()}/pay/selcom/webhook`, redirect: `${BASE()}/pay/${ref}/done`, cancel: `${BASE()}/pay/${ref}` });
  if (!r.ok || !r.gatewayUrl) {
    await pool.query(`UPDATE payments SET status = 'failed', note = $2 WHERE id = $1`, [row.id, 'Selcom create-order failed']);
    return null;
  }
  const { rows: [done] } = await pool.query('UPDATE payments SET gateway_url = $2 WHERE id = $1 RETURNING *', [row.id, r.gatewayUrl]);
  log.info('payment_created', { ref, purpose: p.purpose, amount: row.amount });
  return done;
}

const payLine = (p, lang) => (p ? w(lang).payLine(fmtTsh(p.amount), payUrl(p.ref)) : '');

// Ask Selcom for the status; on the first time it is paid, record it and tell everyone involved.
async function refresh(pool, wa, p) {
  if (!p || p.status !== 'pending') return p;
  const s = await selcom.orderStatus(p.ref);
  if (!s.ok || s.status === 'pending') return p;
  const { rows: [u] } = await pool.query(
    `UPDATE payments SET status = $2, paid_at = CASE WHEN $2 = 'paid' THEN now() END, selcom_transid = $3, reference = $4, channel = $5
      WHERE id = $1 AND status = 'pending' RETURNING *`, [p.id, s.status, s.transid, s.reference, s.channel]);
  if (u?.status === 'paid') await onPaid(pool, wa, u);
  return u || p;
}

async function onPaid(pool, wa, p) {
  log.info('payment_paid', { ref: p.ref, purpose: p.purpose, amount: p.amount });
  const L = w(p.lang);
  const { notify } = require('./bulk');
  const tell = async (phone, text) => {
    const { rows: [r] } = await pool.query(`SELECT EXISTS (SELECT 1 FROM messages_log WHERE phone_number = $1 AND direction = 'inbound'
      AND created_at > now() - interval '23 hours') AS ok`, [phone]);
    return r.ok && (await wa.sendText(phone, text)).ok;
  };
  if (p.purpose === 'order') {
    const { rows: [o] } = await pool.query(
      `SELECT o.number, o.status, v.id AS vid, v.phone_number, v.language FROM orders o JOIN vendors v ON v.id = o.vendor_id WHERE o.id = $1`, [p.order_id]);
    await pool.query('UPDATE orders SET paid_at = now() WHERE id = $1', [p.order_id]);
    await tell(p.payer_phone, L.paid(fmtTsh(p.amount), L.whatOrder(o.number)));
    await notify(pool, wa, o.vid, o.phone_number, w(o.language).vendorPaid(o.number, fmtTsh(p.amount))
      + (o.status === 'rejected' ? '\n' + w(o.language).refundNeeded(o.number) : ''));
    if (o.status === 'rejected') await pool.query(`UPDATE payments SET note = 'refund needed: order rejected' WHERE id = $1`, [p.id]);
  } else if (p.purpose === 'bulk') {
    await notify(pool, wa, p.member_id, p.payer_phone, L.paid(fmtTsh(p.amount), L.whatBulk));
  } else if (p.purpose === 'delivery') {
    if (p.member_id) await notify(pool, wa, p.member_id, p.payer_phone, L.paid(fmtTsh(p.amount), L.whatDelivery));
    else await tell(p.payer_phone, L.paid(fmtTsh(p.amount), L.whatDelivery));
  }
  // A paid delivery fee (alone, or inside an order payment): tell the rider not to take cash.
  const { rows: [d] } = await pool.query(
    `SELECT d.id, x.phone, x.lang FROM deliveries d JOIN riders x ON x.id = d.rider_id
      WHERE d.id = $1 OR (d.order_id = $2 AND $3 > 0)`, [p.delivery_id, p.order_id, Number(p.rider_amount)]);
  if (d) await tell(d.phone, (W[d.lang] || W.sw).riderPaid(d.id));
}

// "lipa" / "pay": PIN prompt for the payer's latest waiting payment.
const parsePay = text => ['lipa', 'pay', 'jirani lipa', 'bulk pay', 'lipia'].includes(norm(text));

async function payReply(pool, wa, phone, lang = 'sw') {
  const L = w(lang);
  const { rows: [p] } = await pool.query(
    `SELECT * FROM payments WHERE payer_phone = $1 AND status = 'pending' AND created_at > now() - interval '7 days'
      ORDER BY id DESC LIMIT 1`, [phone]);
  if (!p) return L.nothing;
  const fresh = await refresh(pool, wa, p);
  if (fresh.status !== 'pending') return fresh.status === 'paid' ? '' : L.nothing; // just paid: the paid message was sent
  const r = await selcom.walletPush({ transid: `${p.ref}-${Date.now().toString(36)}`, orderId: p.ref, phone });
  return r.ok ? L.pushed(fmtTsh(p.amount)) : L.pushFailed(payUrl(p.ref));
}

// Check pending payments older than 3 minutes (Selcom's advice for in-progress results). Run with the evening job.
async function checkPending(pool, wa) {
  const { rows } = await pool.query(
    `SELECT * FROM payments WHERE status = 'pending' AND created_at < now() - interval '3 minutes' AND created_at > now() - interval '7 days'`);
  let paid = 0;
  for (const p of rows) if ((await refresh(pool, wa, p)).status === 'paid') paid++;
  await pool.query(`UPDATE payments SET status = 'expired' WHERE status = 'pending' AND created_at <= now() - interval '7 days'`);
  return { checked: rows.length, paid };
}

// ---------- web: /pay ----------
function router(pool, wa) {
  const r = express.Router();
  // Selcom's notification: only the order id is used; the status always comes from asking Selcom.
  r.post('/selcom/webhook', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const ref = String(req.body?.order_id || '');
      const { rows: [p] } = await pool.query('SELECT * FROM payments WHERE ref = $1', [ref]);
      if (p) await refresh(pool, wa, p);
      log.info('selcom_webhook', { ref, known: Boolean(p), result: req.body?.result, status: req.body?.payment_status });
      res.json({ result: 'SUCCESS', resultcode: '000' });
    } catch (err) {
      log.error('selcom_webhook_failed', { error: err.message });
      res.status(500).json({ result: 'FAIL' });
    }
  });
  const show = async (req, res, next) => {
    try {
      if (!/^MKB[A-Z0-9]{4,20}$/.test(req.params.ref)) return res.sendStatus(404);
      let { rows: [p] } = await pool.query('SELECT * FROM payments WHERE ref = $1', [req.params.ref]);
      if (!p) return res.status(404).send(page('Malipo', '<div class="card"><h1>Malipo hayapo</h1></div>'));
      p = await refresh(pool, wa, p);
      if (p.status === 'paid') return res.send(page('Imelipwa', `<div class="card"><h1>✅ Imelipwa</h1><p>${esc(fmtTsh(p.amount))} yamepokelewa. Asante!</p></div>`));
      if (p.status !== 'pending' || !p.gateway_url) return res.send(page('Malipo', '<div class="card"><h1>Malipo haya hayapo tena</h1><p>Muulize muuzaji kiungo kipya.</p></div>'));
      if (req.path.endsWith('/done')) return res.send(page('Malipo', `<div class="card"><h1>Tunasubiri uthibitisho</h1><p>Malipo ya ${esc(fmtTsh(p.amount))} bado hayajathibitishwa. Ukimaliza kulipa, utapokea ujumbe WhatsApp.</p><p><a href="/pay/${esc(p.ref)}">Angalia tena</a></p></div>`));
      res.redirect(303, p.gateway_url);
    } catch (err) { next(err); }
  };
  r.get('/:ref', show);
  r.get('/:ref/done', show);
  return r;
}

// ---------- admin: /admin/payments ----------
function adminRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '4kb' }));
  r.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const from = req.get('origin') || req.get('referer') || '';
    try { if (new URL(from).host === req.get('host')) return next(); } catch { /* none */ }
    res.status(403).send('Forbidden');
  });
  r.get('/', async (_req, res, next) => {
    try {
      const pool = require('./db');
      const { rows: [t] } = await pool.query(
        `SELECT COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0) AS paid, count(*) FILTER (WHERE status = 'pending') AS pending,
                COALESCE(sum(supplier_amount) FILTER (WHERE status = 'paid'), 0) AS bulk FROM payments`);
      const { rows: vendors } = await pool.query(
        `SELECT v.id, v.name, v.phone_number, COALESCE(sum(p.vendor_amount), 0) AS earned,
                COALESCE((SELECT sum(amount) FROM payouts WHERE payee_type = 'vendor' AND payee_id = v.id), 0) AS sent
           FROM payments p JOIN vendors v ON v.id = p.vendor_id WHERE p.status = 'paid' GROUP BY v.id ORDER BY v.name`);
      const { rows: riders } = await pool.query(
        `SELECT x.id, x.name, x.phone, COALESCE(sum(p.rider_amount), 0) AS earned,
                COALESCE((SELECT sum(amount) FROM payouts WHERE payee_type = 'rider' AND payee_id = x.id), 0) AS sent
           FROM payments p JOIN deliveries d ON d.id = p.delivery_id OR (p.delivery_id IS NULL AND d.order_id = p.order_id)
           JOIN riders x ON x.id = d.rider_id
          WHERE p.status = 'paid' AND p.rider_amount > 0 AND d.status = 'delivered' GROUP BY x.id ORDER BY x.name`);
      const { rows: list } = await pool.query(
        `SELECT p.*, to_char(p.created_at AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS at FROM payments p ORDER BY p.id DESC LIMIT 60`);
      const owe = (rows, type, name, phone) => rows.map(x => {
        const due = Number(x.earned) - Number(x.sent);
        return `<tr><td>${esc(x[name] || '')}</td><td class="num">${esc(x[phone])}</td><td class="r num">${esc(fmtTsh(x.earned))}</td>
          <td class="r num">${esc(fmtTsh(x.sent))}</td><td class="r num"><b>${esc(fmtTsh(due))}</b></td>
          <td>${due > 0 ? `<form method="post" action="/admin/payments/payout"><input type="hidden" name="type" value="${type}"><input type="hidden" name="id" value="${x.id}">
            <input type="hidden" name="amount" value="${due}"><button class="link-btn">Mark ${esc(fmtTsh(due))} sent</button></form>` : ''}</td></tr>`;
      }).join('');
      const head = '<thead><tr><th>Name</th><th>Phone</th><th class="r">Paid in</th><th class="r">Sent</th><th class="r">Owed</th><th></th></tr></thead>';
      res.send(page('Mkoba payments', `
        <p><a href="/admin">← Admin</a></p><h1>Payments (Selcom)</h1>
        <p class="facts num">${selcom.configured() ? `Selcom: ${process.env.SELCOM_LIVE === '1' ? 'live' : 'test'} mode.` : '<b>Selcom is not set up</b> (SELCOM_VENDOR, SELCOM_API_KEY, SELCOM_API_SECRET in .env): no payment links are sent.'}
          Received: ${esc(fmtTsh(t.paid))}. Waiting: ${esc(t.pending)}. Bulk-order money for suppliers: ${esc(fmtTsh(t.bulk))}.</p>
        <h2>Owed to vendors (customer orders)</h2>
        ${vendors.length ? `<div class="scroll"><table>${head}<tbody>${owe(vendors, 'vendor', 'name', 'phone_number')}</tbody></table></div>` : '<p class="note">Nothing yet.</p>'}
        <h2>Owed to riders (delivery fees paid by phone, delivered jobs)</h2>
        ${riders.length ? `<div class="scroll"><table>${head}<tbody>${owe(riders, 'rider', 'name', 'phone')}</tbody></table></div>` : '<p class="note">Nothing yet.</p>'}
        <p class="note">Send the money (e.g. from the Selcom account), then click "Mark sent" so it is not paid twice.</p>
        <h2>Recent payments</h2>
        <div class="scroll"><table><thead><tr><th>Ref</th><th>When</th><th>For</th><th>Payer</th><th class="r">Amount</th><th>Status</th><th>Selcom ref</th><th>Note</th></tr></thead>
        <tbody>${list.map(p => `<tr><td class="num">${esc(p.ref)}</td><td class="num">${esc(p.at)}</td><td>${esc(p.purpose)}</td><td class="num">${esc(p.payer_phone)}</td>
          <td class="r num">${esc(fmtTsh(p.amount))}</td><td>${esc(p.status)}</td><td class="num">${esc(p.reference || '')}</td><td>${esc(p.note || '')}</td></tr>`).join('')
          || '<tr><td colspan="8">No payments yet.</td></tr>'}</tbody></table></div>`, { wide: true }));
    } catch (err) { next(err); }
  });
  r.post('/payout', async (req, res, next) => {
    try {
      const amount = Number(req.body.amount);
      if (['vendor', 'rider'].includes(req.body.type) && /^\d+$/.test(req.body.id) && amount > 0) {
        await require('./db').query('INSERT INTO payouts (payee_type, payee_id, amount) VALUES ($1, $2, $3)', [req.body.type, req.body.id, amount]);
      }
      res.redirect(303, '/admin/payments');
    } catch (err) { next(err); }
  });
  return r;
}

module.exports = { enabled, createPayment, payLine, refresh, payReply, parsePay, checkPending, router, adminRouter, payUrl };
