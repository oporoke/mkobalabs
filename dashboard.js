// Vendor web dashboard (item 36). Login: vendor sends "dashibodi" on WhatsApp and gets a one-time link.
const crypto = require('crypto');
const express = require('express');
const log = require('./log');
const pool = require('./db');
const { esc, page } = require('./html');
const { fmtTsh, describe } = require('./format');
const { getSummaryRows } = require('./summary');
const { balanceRows } = require('./debts');

const TZ = 'Africa/Dar_es_Salaam';
const LINK_MINUTES = 15;
const SESSION_DAYS = 30;
const COOKIE = 'mk_sess';

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// --- WhatsApp side: "dashibodi" -> one-time link ---
const REQUESTS = new Set(['dashibodi', 'dashboard', 'dashbodi', 'dashibod', 'mtandaoni', 'link ya dashibodi']);
function parseDashboardRequest(text) {
  return REQUESTS.has(String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim());
}

async function dashboardLinkReply(pool, vendorId) {
  const token = newToken();
  await pool.query(
    `INSERT INTO login_tokens (token_hash, vendor_id, expires_at) VALUES ($1, $2, now() + interval '${LINK_MINUTES} minutes')`,
    [hash(token), vendorId]
  );
  const base = process.env.PUBLIC_URL || 'https://mkoba.digital';
  return `Fungua dashibodi yako hapa (kiungo kinafanya kazi kwa dakika ${LINK_MINUTES}, mara moja tu):\n${base}/d/login?t=${token}`;
}

// --- web side ---
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

async function sessionVendor(req) {
  const id = readCookie(req, COOKIE);
  if (!id) return null;
  const { rows: [v] } = await pool.query(
    `SELECT v.id, v.name, v.phone_number FROM sessions s JOIN vendors v ON v.id = s.vendor_id
      WHERE s.id_hash = $1 AND s.expires_at > now()`,
    [hash(id)]
  );
  return v || null;
}

const router = express.Router();
router.use(express.urlencoded({ extended: false, limit: '2kb' }));

const LINK_INVALID = page('Kiungo kimeisha', `
  <div class="card"><h1>Kiungo hiki hakifanyi kazi tena</h1>
  <p>Kimeisha muda au kimeshatumika. Tuma <b>dashibodi</b> kwenye WhatsApp ya Mkoba upate kiungo kipya.</p></div>`);

// Step 1: show a button. Opening the link alone never logs in (link scanners can't use it up).
router.get('/login', (req, res) => {
  const t = String(req.query.t || '');
  if (!t) return res.status(400).send(LINK_INVALID);
  res.send(page('Ingia kwenye Mkoba', `
    <div class="card"><h1>Dashibodi ya Mkoba</h1>
    <p>Bonyeza kitufe kufungua hesabu zako. Utabaki umeingia kwenye simu hii kwa siku ${SESSION_DAYS}.</p>
    <form method="post" action="/d/login"><input type="hidden" name="t" value="${esc(t)}">
    <button class="btn" type="submit">Ingia</button></form></div>`));
});

// Step 2: use up the token (atomically, once) and start a session.
router.post('/login', async (req, res, next) => {
  try {
    const { rows: [tok] } = await pool.query(
      `UPDATE login_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING vendor_id`,
      [hash(req.body.t || '')]
    );
    if (!tok) return res.status(400).send(LINK_INVALID);
    const id = newToken();
    await pool.query(
      `INSERT INTO sessions (id_hash, vendor_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
      [hash(id), tok.vendor_id]
    );
    res.cookie(COOKIE, id, { httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/d', maxAge: SESSION_DAYS * 86400e3 });
    log.info('dashboard_login', { vendor: tok.vendor_id });
    res.redirect(303, '/d');
  } catch (err) { next(err); }
});

router.post('/logout', async (req, res, next) => {
  try {
    const id = readCookie(req, COOKIE);
    if (id) await pool.query('DELETE FROM sessions WHERE id_hash = $1', [hash(id)]);
    res.clearCookie(COOKIE, { path: '/d' });
    res.send(page('Umetoka', `<div class="card"><h1>Umetoka</h1><p>Tuma <b>dashibodi</b> kwenye WhatsApp kuingia tena.</p></div>`));
  } catch (err) { next(err); }
});

const PERIODS = { leo: 'Leo', wiki: 'Wiki hii', mwezi: 'Mwezi huu' };

async function dailyNet(vendorId) {
  const { rows } = await pool.query(
    `WITH days AS (
       SELECT generate_series((now() AT TIME ZONE '${TZ}')::date - 13, (now() AT TIME ZONE '${TZ}')::date, '1 day')::date AS day)
     SELECT d.day, to_char(d.day, 'DD/MM') AS label,
            COALESCE(SUM(CASE WHEN t.type = 'sale' THEN t.amount_tsh ELSE -t.amount_tsh END), 0) AS net
       FROM days d
       LEFT JOIN transactions t
         ON t.vendor_id = $1 AND t.deleted_at IS NULL AND t.status = 'confirmed'
        AND t.type IN ('sale', 'purchase', 'expense')
        AND (t.created_at AT TIME ZONE '${TZ}')::date = d.day
      GROUP BY d.day ORDER BY d.day`,
    [vendorId]
  );
  return rows.map(r => ({ label: r.label, net: Number(r.net) }));
}

async function recentEntries(vendorId) {
  const { rows } = await pool.query(
    `SELECT type, amount_tsh, item, quantity, unit, counterparty,
            to_char(created_at AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS at
       FROM transactions
      WHERE vendor_id = $1 AND deleted_at IS NULL AND status = 'confirmed'
      ORDER BY created_at DESC, id DESC LIMIT 12`,
    [vendorId]
  );
  return rows;
}

// 14 bars, profit above the line in green, loss below in red.
function chartSvg(days) {
  const W = 280, H = 96, mid = H / 2, bw = W / days.length;
  const max = Math.max(1, ...days.map(d => Math.abs(d.net)));
  const bars = days.map((d, i) => {
    const h = Math.round((Math.abs(d.net) / max) * (mid - 6));
    const y = d.net >= 0 ? mid - h : mid;
    const color = d.net >= 0 ? 'var(--in)' : 'var(--out)';
    return `<rect x="${(i * bw + 2).toFixed(1)}" y="${y}" width="${(bw - 4).toFixed(1)}" height="${Math.max(h, d.net ? 1 : 0)}" rx="2" fill="${color}"><title>${esc(d.label)}: ${esc(fmtTsh(d.net))}</title></rect>`;
  }).join('');
  const total = days.reduce((s, d) => s + d.net, 0);
  return `<svg class="chart" viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="Faida kwa siku 14 zilizopita, jumla ${esc(fmtTsh(total))}">
    <line x1="0" y1="${mid}" x2="${W}" y2="${mid}" stroke="var(--rule)" stroke-width="1"/>${bars}
    <text x="0" y="${H + 12}" font-size="9" fill="var(--muted)">${esc(days[0].label)}</text>
    <text x="${W}" y="${H + 12}" font-size="9" fill="var(--muted)" text-anchor="end">Leo</text></svg>`;
}

router.get('/', async (req, res, next) => {
  try {
    const vendor = await sessionVendor(req);
    if (!vendor) {
      return res.status(401).send(page('Ingia kwenye Mkoba', `
        <div class="card"><h1>Dashibodi ya Mkoba</h1>
        <p>Tuma <b>dashibodi</b> kwenye WhatsApp ya Mkoba. Utapokea kiungo cha kuingia.</p></div>`));
    }
    const period = PERIODS[req.query.p] ? req.query.p : 'leo';
    const [rows, days, recent, debts] = await Promise.all([
      getSummaryRows(pool, vendor.id, period), dailyNet(vendor.id), recentEntries(vendor.id), balanceRows(pool, vendor.id),
    ]);
    const get = t => Number(rows.find(r => r.type === t)?.total || 0);
    const sale = get('sale'), purchase = get('purchase'), expense = get('expense');
    const net = sale - purchase - expense;
    const name = /^\d+$/.test(vendor.name || '') ? 'Dashibodi yako' : `Dashibodi ya ${vendor.name}`;

    const tabs = Object.entries(PERIODS).map(([k, label]) =>
      `<a href="/d?p=${k}"${k === period ? ' aria-current="page"' : ''}>${label}</a>`).join('');

    const entries = recent.length
      ? `<ol class="daftari">${recent.map(r => {
          // Cash in/out gets a colour and sign; debt entries are neutral (they are not sales or costs).
          const cls = r.type === 'sale' ? 'in' : ['purchase', 'expense'].includes(r.type) ? 'out' : 'debt';
          const sign = cls === 'in' ? '+' : cls === 'out' ? '−' : '';
          return `<li><span class="what">${esc(describe(r, true))}</span><span class="when num">${esc(r.at)}</span>
                  <span class="amt num ${cls}">${sign}${esc(fmtTsh(r.amount_tsh))}</span></li>`;
        }).join('')}</ol>`
      : `<p class="empty">Bado hujaweka rekodi. Tuma ujumbe kama <b>nimeuza chips 5000</b> kwenye WhatsApp.</p>`;

    const owed = debts.filter(d => Number(d.balance) > 0), owing = debts.filter(d => Number(d.balance) < 0);
    const debtList = (list, sign) => `<ul class="debts">${list.map(d =>
      `<li><span>${esc(d.name)}</span><span class="num">${esc(fmtTsh(sign * Number(d.balance)))}</span></li>`).join('')}</ul>`;
    const debtHtml = debts.length
      ? (owed.length ? `<p class="debt-group">Unaowadai</p>${debtList(owed, 1)}` : '')
        + (owing.length ? `<p class="debt-group">Wanaokudai</p>${debtList(owing, -1)}` : '')
      : `<p class="empty">Hakuna madeni. Andika kama <b>namdai Juma 5000</b> kuweka deni.</p>`;

    res.send(page(name, `
      <div class="top"><h1>${esc(name)}</h1>
        <form method="post" action="/d/logout"><button class="link-btn" type="submit">Toka</button></form></div>
      <nav class="periods" aria-label="Kipindi">${tabs}</nav>
      <section class="hero" aria-live="polite">
        <span class="label">${net >= 0 ? 'Faida' : 'Hasara'} ${PERIODS[period].toLowerCase()}</span>
        <span class="big num ${net >= 0 ? 'in' : 'out'}">${esc(fmtTsh(Math.abs(net)))}</span>
        <ul class="breakdown num">
          <li><span>Mauzo</span><span class="in">${esc(fmtTsh(sale))}</span></li>
          <li><span>Manunuzi</span><span class="out">${esc(fmtTsh(purchase))}</span></li>
          <li><span>Matumizi</span><span class="out">${esc(fmtTsh(expense))}</span></li>
        </ul>
      </section>
      <h2>Siku 14 zilizopita</h2>${chartSvg(days)}
      <p class="chart-note">Kijani ni faida, nyekundu ni hasara.</p>
      <h2>Rekodi za karibuni</h2>${entries}
      <h2>Madeni</h2>${debtHtml}`));
  } catch (err) { next(err); }
});

module.exports = { router, parseDashboardRequest, dashboardLinkReply };
