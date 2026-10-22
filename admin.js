// Admin dashboard (item 36): all vendors at a glance. HTTP Basic auth with ADMIN_PASSWORD from .env.
// Disabled (404) when ADMIN_PASSWORD is not set.
const crypto = require('crypto');
const express = require('express');
const log = require('./log');
const pool = require('./db');
const { esc, page } = require('./html');
const { fmtTsh } = require('./format');

const TZ = 'Africa/Dar_es_Salaam';
const MAX_FAILS = 5, FAIL_WINDOW_MS = 15 * 60 * 1000;
const fails = new Map(); // ip -> [timestamps]

const sha = s => crypto.createHash('sha256').update(String(s)).digest();

function checkAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return res.sendStatus(404);

  const now = Date.now();
  const recent = (fails.get(req.ip) || []).filter(t => t > now - FAIL_WINDOW_MS);
  if (recent.length >= MAX_FAILS) return res.status(429).send('Too many attempts. Try again in 15 minutes.');

  const [scheme, encoded] = (req.get('authorization') || '').split(' ');
  const [user, pass] = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(/:(.*)/s) : [];
  if (user === 'admin' && pass !== undefined && crypto.timingSafeEqual(sha(pass), sha(password))) {
    fails.delete(req.ip);
    return next();
  }
  if (encoded) {
    fails.set(req.ip, [...recent, now]);
    log.warn('admin_login_failed', { ip: req.ip });
  }
  res.set('WWW-Authenticate', 'Basic realm="Mkoba admin", charset="UTF-8"').sendStatus(401);
}

const router = express.Router();
router.use(checkAuth);

router.get('/', async (_req, res, next) => {
  try {
    const { rows: [s] } = await pool.query(`
      SELECT (SELECT count(*) FROM vendors) AS vendors,
             (SELECT count(DISTINCT vendor_id) FROM messages_log WHERE created_at > now() - interval '7 days') AS active_7d,
             (SELECT count(*) FROM messages_log WHERE (created_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date) AS messages_today,
             (SELECT count(*) FROM transactions WHERE deleted_at IS NULL AND status = 'confirmed' AND created_at > now() - interval '30 days') AS entries_30d,
             (SELECT COALESCE(sum(amount_tsh), 0) FROM transactions WHERE type = 'sale' AND deleted_at IS NULL AND status = 'confirmed' AND created_at > now() - interval '30 days') AS sales_30d`);
    const { rows: vendors } = await pool.query(`
      SELECT v.id, v.name, v.phone_number, v.business_type, v.daily_report,
             to_char(v.created_at AT TIME ZONE '${TZ}', 'DD/MM/YY') AS joined,
             to_char((SELECT max(created_at) FROM messages_log m WHERE m.vendor_id = v.id) AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS last_seen,
             (SELECT count(*) FROM transactions t WHERE t.vendor_id = v.id AND t.deleted_at IS NULL AND t.status = 'confirmed' AND t.created_at > now() - interval '30 days') AS entries_30d,
             (SELECT COALESCE(sum(amount_tsh), 0) FROM transactions t WHERE t.vendor_id = v.id AND t.type = 'sale' AND t.deleted_at IS NULL AND t.status = 'confirmed' AND t.created_at > now() - interval '30 days') AS sales_30d
        FROM vendors v
       ORDER BY (SELECT max(created_at) FROM messages_log m WHERE m.vendor_id = v.id) DESC NULLS LAST`);

    const rows = vendors.map(v => `<tr>
      <td>${esc(/^\d+$/.test(v.name || '') ? '(no name)' : v.name)}</td><td class="num">${esc(v.phone_number)}</td>
      <td>${esc(v.business_type || '')}</td><td class="num">${esc(v.joined)}</td><td class="num">${esc(v.last_seen || '')}</td>
      <td class="r num">${esc(v.entries_30d)}</td><td class="r num">${esc(fmtTsh(v.sales_30d))}</td>
      <td>${v.daily_report ? 'on' : 'off'}</td></tr>`).join('');

    res.send(page('Mkoba admin', `
      <h1>Mkoba admin</h1>
      <div class="stats num">
        <div><b>${esc(s.vendors)}</b>vendors</div>
        <div><b>${esc(s.active_7d)}</b>active in last 7 days</div>
        <div><b>${esc(s.messages_today)}</b>messages today</div>
        <div><b>${esc(s.entries_30d)}</b>entries, 30 days</div>
        <div><b>${esc(fmtTsh(s.sales_30d))}</b>sales recorded, 30 days</div>
      </div>
      <h2>Vendors</h2>
      <div class="scroll"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Business</th><th>Joined</th><th>Last message</th>
        <th class="r">Entries 30d</th><th class="r">Sales 30d</th><th>Evening report</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8">No vendors yet.</td></tr>'}</tbody></table></div>`, { wide: true }));
  } catch (err) { next(err); }
});

module.exports = { router };
