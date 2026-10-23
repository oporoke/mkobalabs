// Mkoba Lite App (roadmap #12): an installable web app (PWA) at /d/app, well under 3 MB, for vendors who want screens.
// Login is the dashboard's: send "dashibodi" on WhatsApp, open the link. The session cookie is scoped to /d, so the app
// lives under /d. Works offline: the page and the last data are cached; records typed offline wait in the phone and
// are sent when the connection returns (each carries a client id, so a retry never saves twice).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const pool = require('./db');
const log = require('./log');
const { fmtTsh, describe } = require('./format');
const { getSummaryRows } = require('./summary');
const { balanceRows } = require('./debts');
const { stockRows, stockReply, stockNotes, fmtQty } = require('./stock');

const TZ = 'Africa/Dar_es_Salaam';
const DIR = path.join(__dirname, 'public', 'app');
const COOKIE = 'mk_sess';
const VERSION = '3'; // bump to make phones fetch the new app files

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function readCookie(req) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}
async function vendorOf(req) {
  const id = readCookie(req);
  if (!id) return null;
  const { rows: [v] } = await pool.query(
    `SELECT v.id, v.name, v.language, v.phone_number FROM sessions s JOIN vendors v ON v.id = s.vendor_id
      WHERE s.id_hash = $1 AND s.expires_at > now() AND v.kind = 'vendor'`, [sha(id)]);
  return v || null;
}

// The app needs its own script, so it gets a policy that allows scripts from this site only.
function appHeaders(_req, res, next) {
  res.set({
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  });
  next();
}

const router = express.Router();
router.use(appHeaders);

// ---- app shell ----
const SHELL = `<!doctype html><html lang="sw"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#1E2A55">
<meta name="robots" content="noindex"><title>Mkoba</title>
<link rel="manifest" href="/d/app/manifest.webmanifest"><link rel="icon" href="/d/app/icon-192.png"><link rel="apple-touch-icon" href="/d/app/icon-192.png">
<link rel="stylesheet" href="/d/app/app.css?v=${VERSION}"></head>
<body><header class="bar"><b>Mkoba</b><span id="who"></span><span id="net" class="net" hidden></span></header>
<main id="main"><p class="muted">…</p></main>
<nav class="tabs" id="tabs"></nav>
<script src="/d/app/app.js?v=${VERSION}"></script></body></html>`;

router.get(['/app', '/app/'], (_req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(SHELL); });
router.get('/app/manifest.webmanifest', (_req, res) => res.type('application/manifest+json').send(JSON.stringify({
  name: 'Mkoba', short_name: 'Mkoba', start_url: '/d/app/', scope: '/d/app/', display: 'standalone',
  background_color: '#F7F8FB', theme_color: '#1E2A55', lang: 'sw',
  icons: [{ src: '/d/app/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/d/app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
})));
// The service worker must be served from inside the scope it controls.
router.get('/app/sw.js', (_req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/d/app/' });
  res.type('application/javascript').send(fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8').replace('__VERSION__', VERSION));
});
for (const [file, type] of [['app.js', 'application/javascript'], ['app.css', 'text/css'], ['icon-192.png', 'image/png'], ['icon-512.png', 'image/png']]) {
  router.get(`/app/${file}`, (_req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.type(type).sendFile(path.join(DIR, file)); });
}

// ---- JSON API: /d/api/* ----
const api = express.Router();
api.use(express.json({ limit: '16kb' }));
api.use(async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    // Writes must come from this site (the cookie alone is not enough proof).
    if (req.method !== 'GET') {
      const from = req.get('origin') || req.get('referer') || '';
      let ok = false; try { ok = new URL(from).host === req.get('host'); } catch { /* none */ }
      if (!ok) return res.status(403).json({ error: 'forbidden' });
    }
    req.vendor = await vendorOf(req);
    return req.vendor ? next() : res.status(401).json({ error: 'login' });
  } catch (err) { next(err); }
});

// A messages_log row per app action, so records made in the app group like WhatsApp messages (futa works the same).
async function appMessage(vendor, body) {
  const { rows: [m] } = await pool.query(
    `INSERT INTO messages_log (vendor_id, phone_number, channel, direction, raw_payload) VALUES ($1, $2, 'app', 'app', $3) RETURNING id`,
    [vendor.id, vendor.phone_number, JSON.stringify(body)]);
  return m.id;
}

api.get('/me', (req, res) => res.json({ name: /^\d+$/.test(req.vendor.name || '') ? '' : req.vendor.name, lang: req.vendor.language }));

api.get('/summary', async (req, res, next) => {
  try {
    const p = ['leo', 'wiki', 'mwezi'].includes(req.query.p) ? req.query.p : 'leo';
    const rows = await getSummaryRows(pool, req.vendor.id, p);
    const get = k => Number(rows.find(r => r.type === k)?.total || 0);
    const s = get('sale'), pu = get('purchase'), e = get('expense');
    res.json({ period: p, sales: s, purchases: pu, expenses: e, net: s - pu - e });
  } catch (err) { next(err); }
});

api.get('/records', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, amount_tsh, item, quantity, unit, counterparty, channel, to_char(created_at AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS at
         FROM transactions WHERE vendor_id = $1 AND deleted_at IS NULL AND status = 'confirmed' ORDER BY created_at DESC, id DESC LIMIT 30`, [req.vendor.id]);
    res.json(rows.map(r => ({ id: r.id, text: describe(r, true, req.vendor.language), amount: Number(r.amount_tsh), type: r.type, at: r.at })));
  } catch (err) { next(err); }
});

// Add a record. Body: { client_id, type, item, quantity, unit, amount, at (ISO, optional: when it was typed offline) }
api.post('/records', async (req, res, next) => {
  try {
    const b = req.body || {};
    const type = ['sale', 'purchase', 'expense'].includes(b.type) ? b.type : null;
    const amount = Math.round(Number(b.amount));
    if (!type || !(amount > 0) || amount > 1e10) return res.status(400).json({ error: 'invalid' });
    const clientId = /^[a-zA-Z0-9-]{8,64}$/.test(b.client_id || '') ? b.client_id : null;
    const item = String(b.item || '').trim().toLowerCase().slice(0, 60) || null;
    const quantity = Number(b.quantity) > 0 ? Number(b.quantity) : null;
    const unit = ['kg', 'l', 'g', 'pcs'].includes(b.unit) && quantity ? b.unit : null;
    // Keep the time it was typed (offline), but never in the future and at most 7 days back.
    const at = b.at && !Number.isNaN(Date.parse(b.at)) ? new Date(Math.min(Date.now(), Math.max(Date.parse(b.at), Date.now() - 7 * 86400e3))) : new Date();
    const mid = await appMessage(req.vendor, { client_id: clientId, type, item, amount });
    const { rows: [t] } = await pool.query(
      `INSERT INTO transactions (vendor_id, message_id, type, direction, amount_tsh, raw_input, channel, parse_confidence, status, item, quantity, unit, client_ref, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'app', 1, 'confirmed', $7, $8, $9, $10, $11)
       ON CONFLICT (vendor_id, client_ref) WHERE client_ref IS NOT NULL DO NOTHING RETURNING id`,
      [req.vendor.id, mid, type, type === 'sale' ? 'credit' : 'debit', amount, `app: ${item || ''} ${amount}`.trim(), item, quantity, unit, clientId, at]);
    const notes = t ? (await stockNotes(pool, req.vendor.id, [{ type, item, quantity, unit }], req.vendor.language)).trim() : '';
    res.json({ ok: true, duplicate: !t, text: `${describe({ type, item, quantity, unit }, true, req.vendor.language)} ${fmtTsh(amount)}`, notes });
  } catch (err) { next(err); }
});

api.post('/records/:id/delete', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE transactions SET deleted_at = now() WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL`, [req.params.id, req.vendor.id]);
    res.json({ ok: rowCount === 1 });
  } catch (err) { next(err); }
});

api.get('/stock', async (req, res, next) => {
  try {
    res.json((await stockRows(pool, req.vendor.id)).map(r => ({ item: r.item, unit: r.unit, qty: r.known && r.qty >= 0 ? r.qty : null,
      text: r.known && r.qty >= 0 ? fmtQty(r.qty, r.unit) : '?', low: r.low, days: r.daysLeft })));
  } catch (err) { next(err); }
});
api.post('/stock', async (req, res, next) => {
  try {
    const b = req.body || {};
    const item = String(b.item || '').trim().toLowerCase().slice(0, 60);
    const quantity = Number(b.quantity);
    const unit = ['kg', 'l', 'g'].includes(b.unit) ? b.unit : '';
    if (!item || !(quantity >= 0)) return res.status(400).json({ error: 'invalid' });
    res.json({ ok: true, text: await stockReply(pool, req.vendor.id, { kind: 'count', items: [{ item, quantity, unit }], bad: [] }, req.vendor.language) });
  } catch (err) { next(err); }
});

api.get('/debts', async (req, res, next) => {
  try { res.json((await balanceRows(pool, req.vendor.id)).map(r => ({ name: r.name, balance: Number(r.balance), days: r.days }))); } catch (err) { next(err); }
});
// Body: { name, kind: credit_given | credit_received | repayment_received | repayment_made, amount }
api.post('/debts', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 40).replace(/\b[a-z]/g, c => c.toUpperCase());
    const kinds = ['credit_given', 'credit_received', 'repayment_received', 'repayment_made'];
    const amount = Math.round(Number(b.amount));
    if (!name || !kinds.includes(b.kind) || !(amount > 0)) return res.status(400).json({ error: 'invalid' });
    const mid = await appMessage(req.vendor, b);
    await pool.query(
      `INSERT INTO transactions (vendor_id, message_id, type, direction, amount_tsh, raw_input, channel, parse_confidence, status, counterparty)
       VALUES ($1, $2, $3, NULL, $4, $5, 'app', 1, 'confirmed', $6)`, [req.vendor.id, mid, b.kind, amount, `app: ${b.kind} ${name} ${amount}`, name]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

api.get('/orders', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.number, o.customer_phone, o.customer_name, o.delivery, o.total, o.status, o.paid_at IS NOT NULL AS paid,
              to_char(o.created_at AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS at,
              (SELECT json_agg(json_build_object('name', i.name, 'q', i.quantity, 'price', i.price) ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id) AS lines
         FROM orders o WHERE o.vendor_id = $1 AND (o.status IN ('new', 'accepted') OR o.updated_at > now() - interval '2 days')
        ORDER BY o.number DESC LIMIT 30`, [req.vendor.id]);
    await pool.query(`UPDATE orders SET vendor_notified_at = now() WHERE vendor_id = $1 AND vendor_notified_at IS NULL`, [req.vendor.id]);
    res.json(rows.map(o => ({ ...o, total: Number(o.total), phone: '0' + String(o.customer_phone).slice(3) })));
  } catch (err) { next(err); }
});
// Same actions as WhatsApp ("kubali oda 3" ...), so customers, riders and payments are told the same way.
api.post('/orders/:n/:action', async (req, res, next) => {
  try {
    const kind = { accept: 'accept', reject: 'reject', complete: 'complete' }[req.params.action];
    if (!kind || !/^\d+$/.test(req.params.n)) return res.status(400).json({ error: 'invalid' });
    const { vendorCatalogReply } = require('./catalog');
    const mid = await appMessage(req.vendor, { order: req.params.n, action: kind });
    const reply = await vendorCatalogReply(pool, require('./whatsapp'), req.vendor.id, mid, { kind, number: +req.params.n }, req.vendor.language);
    res.json({ ok: true, text: [].concat(reply).join('\n\n') });
  } catch (err) { next(err); }
});

api.use((err, _req, res, _next) => {
  log.error('app_api_error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'server' });
});

module.exports = { router, api };
