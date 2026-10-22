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
    const TODAY = `(now() AT TIME ZONE '${TZ}')::date`;
    const LOCAL_DAY = col => `(${col} AT TIME ZONE '${TZ}')::date`;
    const LIVE = `t.deleted_at IS NULL AND t.status = 'confirmed'`;

    const { rows: [s] } = await pool.query(`
      SELECT (SELECT count(*) FROM vendors) AS vendors,
             (SELECT count(DISTINCT vendor_id) FROM messages_log WHERE created_at > now() - interval '7 days') AS active_7d,
             (SELECT count(DISTINCT vendor_id) FROM messages_log WHERE created_at > now() - interval '30 days') AS active_30d,
             (SELECT count(*) FROM vendors WHERE created_at > now() - interval '7 days') AS new_7d,
             (SELECT count(*) FROM vendors WHERE onboarding_step IS NOT NULL) AS onboarding_open,
             (SELECT count(*) FROM vendors WHERE language = 'en') AS english,
             (SELECT count(*) FROM vendors WHERE NOT daily_report) AS reports_off,
             (SELECT count(*) FROM messages_log WHERE ${LOCAL_DAY('created_at')} = ${TODAY}) AS messages_today,
             (SELECT count(*) FROM transactions t WHERE ${LIVE} AND t.created_at > now() - interval '30 days') AS entries_30d,
             (SELECT COALESCE(sum(amount_tsh), 0) FROM transactions t WHERE t.type = 'sale' AND ${LIVE} AND t.created_at > now() - interval '30 days') AS sales_30d,
             (SELECT count(*) FROM transactions t WHERE t.channel = 'mobile_money' AND ${LIVE} AND t.created_at > now() - interval '30 days') AS mm_30d,
             (SELECT count(*) FROM report_log WHERE created_at > now() - interval '7 days') AS reports_7d,
             (SELECT count(*) FROM parse_feedback WHERE reviewed_at IS NULL) AS unreviewed`);

    // Last 14 days (Tanzania dates): usage and parser quality.
    const { rows: days } = await pool.query(`
      WITH d AS (SELECT generate_series(${TODAY} - 13, ${TODAY}, '1 day')::date AS day),
      m AS (SELECT ${LOCAL_DAY('created_at')} AS day, count(*) AS messages,
                   count(*) FILTER (WHERE raw_payload->>'type' = 'text') AS text_messages,
                   count(DISTINCT vendor_id) AS active
              FROM messages_log WHERE created_at > now() - interval '15 days' GROUP BY 1),
      e AS (SELECT ${LOCAL_DAY('created_at')} AS day, count(*) AS entries
              FROM transactions t WHERE ${LIVE} AND created_at > now() - interval '15 days' GROUP BY 1),
      f AS (SELECT ${LOCAL_DAY('created_at')} AS day,
                   count(*) FILTER (WHERE reason = 'not_understood') AS not_understood,
                   count(*) FILTER (WHERE reason = 'rejected') AS rejected,
                   count(*) FILTER (WHERE reason = 'corrected') AS corrected
              FROM parse_feedback WHERE created_at > now() - interval '15 days' GROUP BY 1)
      SELECT to_char(d.day, 'Dy DD/MM') AS label,
             COALESCE(m.messages, 0) AS messages, COALESCE(m.text_messages, 0) AS text_messages, COALESCE(m.active, 0) AS active,
             COALESCE(e.entries, 0) AS entries, COALESCE(f.not_understood, 0) AS not_understood,
             COALESCE(f.rejected, 0) AS rejected, COALESCE(f.corrected, 0) AS corrected
        FROM d LEFT JOIN m USING (day) LEFT JOIN e USING (day) LEFT JOIN f USING (day)
       ORDER BY d.day DESC`);

    const { rows: vendors } = await pool.query(`
      SELECT v.id, v.name, v.phone_number, v.business_type, v.daily_report, v.language, v.onboarding_step,
             to_char(v.created_at AT TIME ZONE '${TZ}', 'DD/MM/YY') AS joined,
             to_char((SELECT max(created_at) FROM messages_log m WHERE m.vendor_id = v.id) AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS last_seen,
             (SELECT count(*) FROM transactions t WHERE t.vendor_id = v.id AND ${LIVE} AND t.created_at > now() - interval '30 days') AS entries_30d,
             (SELECT COALESCE(sum(amount_tsh), 0) FROM transactions t WHERE t.vendor_id = v.id AND t.type = 'sale' AND ${LIVE} AND t.created_at > now() - interval '30 days') AS sales_30d
        FROM vendors v
       ORDER BY (SELECT max(created_at) FROM messages_log m WHERE m.vendor_id = v.id) DESC NULLS LAST`);

    const { rows: feedback } = await pool.query(`
      SELECT f.reason, f.text, to_char(f.created_at AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS at, v.name
        FROM parse_feedback f JOIN vendors v ON v.id = f.vendor_id
       WHERE f.reviewed_at IS NULL ORDER BY f.id DESC LIMIT 15`);

    const pct = (a, b) => (Number(b) ? `${Math.round((100 * Number(a)) / Number(b))}%` : '–');
    const tot = k => days.reduce((sum, d) => sum + Number(d[k]), 0);
    const maxMsgs = Math.max(1, ...days.map(d => Number(d.messages)));
    const vname = n => (/^\d+$/.test(n || '') ? '(no name)' : n);

    const dayRows = days.map(d => `<tr>
      <td class="num">${esc(d.label)}</td>
      <td class="r num">${esc(d.messages)}</td>
      <td class="bar" aria-hidden="true"><span style="width:${Math.round((100 * d.messages) / maxMsgs)}%"></span></td>
      <td class="r num">${esc(d.active)}</td><td class="r num">${esc(d.entries)}</td>
      <td class="r num">${esc(d.not_understood)}</td><td class="r num">${pct(d.not_understood, d.text_messages)}</td>
      <td class="r num">${esc(d.rejected)}</td><td class="r num">${esc(d.corrected)}</td></tr>`).join('');

    const vendorRows = vendors.map(v => `<tr>
      <td>${esc(vname(v.name))}</td><td class="num">${esc(v.phone_number)}</td>
      <td>${esc(v.business_type || '')}</td><td>${esc(v.language)}</td><td class="num">${esc(v.joined)}</td>
      <td class="num">${esc(v.last_seen || '')}</td>
      <td class="r num">${esc(v.entries_30d)}</td><td class="r num">${esc(fmtTsh(v.sales_30d))}</td>
      <td>${v.onboarding_step ? 'onboarding' : v.daily_report ? 'reports on' : 'reports off'}</td></tr>`).join('');

    const feedbackRows = feedback.map(f => `<tr>
      <td class="num">${esc(f.at)}</td><td>${esc(vname(f.name))}</td><td>${esc(f.reason.replace('_', ' '))}</td>
      <td class="msg">${esc(f.text)}</td></tr>`).join('');

    res.send(page('Mkoba admin', `
      <h1>Mkoba admin</h1>
      <div class="stats num">
        <div><b>${esc(s.vendors)}</b>vendors</div>
        <div><b>${esc(s.active_7d)}</b>active, 7 days</div>
        <div><b>${esc(s.active_30d)}</b>active, 30 days</div>
        <div><b>${esc(s.new_7d)}</b>new this week</div>
        <div><b>${esc(s.messages_today)}</b>messages today</div>
        <div><b>${esc(s.entries_30d)}</b>entries, 30 days</div>
        <div><b>${esc(fmtTsh(s.sales_30d))}</b>sales recorded, 30 days</div>
        <div><b>${pct(tot('not_understood'), tot('text_messages'))}</b>not understood, 14 days</div>
      </div>
      <p class="facts num">Still onboarding: ${esc(s.onboarding_open)}. Using English: ${esc(s.english)}.
        Evening reports off: ${esc(s.reports_off)}. Mobile-money entries, 30 days: ${esc(s.mm_30d)}.
        Evening reports sent, 7 days: ${esc(s.reports_7d)}.</p>

      <h2>Last 14 days</h2>
      <div class="scroll"><table class="days">
        <thead><tr><th>Day</th><th class="r">Messages</th><th><span class="sr">Messages bar</span></th><th class="r">Active vendors</th>
        <th class="r">Entries</th><th class="r">Not understood</th><th class="r">Rate</th><th class="r">Rejected</th><th class="r">Corrected</th></tr></thead>
        <tbody>${dayRows}</tbody></table></div>
      <p class="note">Rate is not-understood messages as a share of text messages. Rejected means the vendor answered NO to a
        confirmation; corrected means they fixed an amount. Both are signs the parser misread something.</p>

      <h2>Parser failures to review (${esc(s.unreviewed)})</h2>
      ${feedback.length ? `<div class="scroll"><table>
        <thead><tr><th>When</th><th>Vendor</th><th>Signal</th><th>Message</th></tr></thead>
        <tbody>${feedbackRows}</tbody></table></div>
        <p class="note">After adding cases to test.js and fixing the parser, mark them reviewed on the server:
        <code>sudo -u mkoba node review.js --done</code></p>`
        : '<p class="note">Nothing to review.</p>'}

      <h2>Vendors</h2>
      <div class="scroll"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Business</th><th>Lang</th><th>Joined</th><th>Last message</th>
        <th class="r">Entries 30d</th><th class="r">Sales 30d</th><th>Status</th></tr></thead>
        <tbody>${vendorRows || '<tr><td colspan="9">No vendors yet.</td></tr>'}</tbody></table></div>`, { wide: true }));
  } catch (err) { next(err); }
});

module.exports = { router };
