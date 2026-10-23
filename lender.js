// Lender integration (roadmap #7): lenders see a vendor's statement and score only with the vendor's permission.
//   Vendor (WhatsApp): wakopeshaji | ruhusu NMB | kataa NMB | ondoa ruhusa NMB   (also: ndio NMB / hapana NMB)
//   Lender portal:     /l  — log in, request permission by phone number, see permitted vendors, score history, statement
//   Admin:             /admin/lenders — add lenders, set or reset their password, switch them off
// Every grant, decline, revoke and request is kept in consent_events; every lender view in lender_views.
const crypto = require('crypto');
const express = require('express');
const log = require('./log');
const { esc, page } = require('./html');
const score = require('./score');

const TZ = 'Africa/Dar_es_Salaam';
const SESSION_HOURS = 12;
const COOKIE = 'mk_lender';
const PHONE = /^(?:\+?255|0)([67]\d{8})$/;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const showPhone = p => '0' + String(p).slice(3);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(String(pw), salt, 32));
}
const newPassword = () => crypto.randomBytes(9).toString('base64url'); // 12 characters

// ---------- vendor side (WhatsApp) ----------
const W = {
  sw: {
    title: '🏦 Wakopeshaji:',
    none: 'Bado hakuna wakopeshaji waliounganishwa na Mkoba.',
    st: { granted: d => `wanaona taarifa zako (tangu ${d})`, requested: () => 'wanaomba ruhusa', declined: () => 'umekataa', revoked: () => 'hawana ruhusa', null: () => 'hawana ruhusa' },
    seen: d => `, waliangalia mwisho ${d}`,
    how: 'Kuruhusu: ruhusu NMB • Kukataa: kataa NMB • Kuondoa ruhusa: ondoa ruhusa NMB',
    noLender: x => `Sikupata mkopeshaji "${x}". Andika "wakopeshaji" kuona orodha.`,
    granted: (n, c) => `Sawa! ${n} sasa wanaweza kuona taarifa yako ya biashara na alama yako ya Mkoba (miezi 6 ya mauzo, gharama, faida, madeni na alama).\nKuondoa ruhusa wakati wowote: ondoa ruhusa ${c}`,
    already: n => `${n} tayari wana ruhusa.`,
    declined: n => `Sawa, nimekataa ombi la ${n}.`,
    revoked: n => `Sawa, ${n} hawawezi tena kuona taarifa zako.`,
    nothingToRevoke: n => `${n} hawana ruhusa ya kuona taarifa zako.`,
    request: (n, c, note) => `🏦 ${n} wanaomba ruhusa kuona taarifa yako ya biashara na alama yako ya Mkoba (miezi 6 ya mauzo, gharama, faida, madeni na alama).${note ? `\nUjumbe wao: "${note}"` : ''}\nKukubali: ruhusu ${c}\nKukataa: kataa ${c}\nUkiruhusu, unaweza kuondoa ruhusa wakati wowote: ondoa ruhusa ${c}`,
  },
  en: {
    title: '🏦 Lenders:',
    none: 'No lenders are connected to Mkoba yet.',
    st: { granted: d => `can see your records (since ${d})`, requested: () => 'asking for permission', declined: () => 'you declined', revoked: () => 'no access', null: () => 'no access' },
    seen: d => `, last viewed ${d}`,
    how: 'Allow: allow NMB • Decline: decline NMB • Remove access: revoke NMB',
    noLender: x => `No lender "${x}". Send "lenders" to see the list.`,
    granted: (n, c) => `Done! ${n} can now see your business statement and Mkoba score (6 months of sales, costs, profit, debts and the score).\nTo remove access at any time: revoke ${c}`,
    already: n => `${n} already has access.`,
    declined: n => `OK, I declined ${n}'s request.`,
    revoked: n => `Done, ${n} can no longer see your records.`,
    nothingToRevoke: n => `${n} does not have access to your records.`,
    request: (n, c, note) => `🏦 ${n} asks for permission to see your business statement and Mkoba score (6 months of sales, costs, profit, debts and the score).${note ? `\nTheir message: "${note}"` : ''}\nTo agree: allow ${c}\nTo decline: decline ${c}\nIf you allow, you can remove access at any time: revoke ${c}`,
  },
};
const w = lang => W[lang] || W.sw;

// -> null | { kind: 'list' } | { kind: 'grant'|'decline'|'revoke', who, strict }
// strict = the word is only a lender command if `who` is a real lender (ndio/hapana/yes/no/kataa also mean other things).
function parseLender(text) {
  const n = norm(text);
  if (['wakopeshaji', 'lenders', 'ruhusa', 'permissions'].includes(n)) return { kind: 'list' };
  let m = n.match(/^(?:ondoa ruhusa|revoke)\s+(.+)$/);
  if (m) return { kind: 'revoke', who: m[1], strict: false };
  m = n.match(/^(ruhusu|allow|ndio|ndiyo|yes|kataa|decline|hapana|no)\s+([a-z0-9 ]{2,40})$/);
  if (m) {
    const grant = ['ruhusu', 'allow', 'ndio', 'ndiyo', 'yes'].includes(m[1]);
    return { kind: grant ? 'grant' : 'decline', who: m[2], strict: !['ruhusu', 'allow', 'decline'].includes(m[1]) };
  }
  return null;
}

async function findLender(pool, who) {
  const { rows: [l] } = await pool.query(
    'SELECT * FROM lenders WHERE active AND (lower(code) = $1 OR lower(name) = $1)', [norm(who)]);
  return l || null;
}

const event = (db, lenderId, vendorId, ev, by, note = null) => db.query(
  'INSERT INTO consent_events (lender_id, vendor_id, event, by_whom, note) VALUES ($1, $2, $3, $4, $5)', [lenderId, vendorId, ev, by, note]);

// Returns a reply, or null when the text is not for this module.
async function lenderReply(pool, vendorId, cmd, lang = 'sw') {
  const L = w(lang);
  if (cmd.kind === 'list') {
    const { rows } = await pool.query(
      `SELECT l.code, l.name, c.status, to_char(c.decided_at AT TIME ZONE '${TZ}', 'DD/MM/YYYY') AS since,
              to_char((SELECT max(at) FROM lender_views x WHERE x.lender_id = l.id AND x.vendor_id = $1) AT TIME ZONE '${TZ}', 'DD/MM/YYYY') AS seen
         FROM lenders l LEFT JOIN lender_consents c ON c.lender_id = l.id AND c.vendor_id = $1
        WHERE l.active ORDER BY (c.status = 'granted') DESC NULLS LAST, l.name`, [vendorId]);
    if (!rows.length) return L.none;
    return [L.title, ...rows.map(r => `- ${r.code} – ${r.name}: ${L.st[r.status || 'null'](r.since)}${r.status === 'granted' && r.seen ? L.seen(r.seen) : ''}`), '', L.how].join('\n');
  }
  const lender = await findLender(pool, cmd.who);
  if (!lender) return cmd.strict ? null : L.noLender(cmd.who);

  const { rows: [c] } = await pool.query('SELECT status FROM lender_consents WHERE lender_id = $1 AND vendor_id = $2', [lender.id, vendorId]);
  if (cmd.kind === 'grant') {
    if (c?.status === 'granted') return L.already(lender.name);
    await pool.query(
      `INSERT INTO lender_consents (lender_id, vendor_id, status, decided_at) VALUES ($1, $2, 'granted', now())
       ON CONFLICT (lender_id, vendor_id) DO UPDATE SET status = 'granted', decided_at = now()`, [lender.id, vendorId]);
    await event(pool, lender.id, vendorId, 'granted', 'vendor');
    log.info('lender_consent', { lender: lender.code, vendor: vendorId, status: 'granted' });
    return L.granted(lender.name, lender.code);
  }
  if (cmd.kind === 'decline') {
    if (cmd.strict && c?.status !== 'requested') return null; // "hapana X" with no request waiting: not for us
    await pool.query(
      `INSERT INTO lender_consents (lender_id, vendor_id, status, decided_at) VALUES ($1, $2, 'declined', now())
       ON CONFLICT (lender_id, vendor_id) DO UPDATE SET status = 'declined', decided_at = now()`, [lender.id, vendorId]);
    await event(pool, lender.id, vendorId, 'declined', 'vendor');
    return L.declined(lender.name);
  }
  // revoke
  if (c?.status !== 'granted') return L.nothingToRevoke(lender.name);
  await pool.query(`UPDATE lender_consents SET status = 'revoked', decided_at = now() WHERE lender_id = $1 AND vendor_id = $2`, [lender.id, vendorId]);
  await event(pool, lender.id, vendorId, 'revoked', 'vendor');
  log.info('lender_consent', { lender: lender.code, vendor: vendorId, status: 'revoked' });
  return L.revoked(lender.name);
}

// Daily score snapshots for vendors who let at least one lender see them (run with the 21:00 job), for score history.
async function snapshotScores(pool) {
  const { rows } = await pool.query(`SELECT DISTINCT vendor_id FROM lender_consents c JOIN lenders l ON l.id = c.lender_id WHERE c.status = 'granted' AND l.active`);
  let saved = 0;
  for (const r of rows) {
    const s = await score.computeScore(pool, r.vendor_id);
    if (s.ready) { await score.saveSnapshot(pool, r.vendor_id, s); saved++; }
  }
  return { vendors: rows.length, saved };
}

// ---------- shared: same-site check for form posts ----------
function sameSite(req, res, next) {
  if (req.method !== 'POST') return next();
  const from = req.get('origin') || req.get('referer') || '';
  try { if (new URL(from).host === req.get('host')) return next(); } catch { /* none */ }
  res.status(403).send('Forbidden');
}
const field = (name, label, attrs = '') => `<label>${label}<br><input name="${name}" ${attrs} style="font:inherit;padding:8px;width:100%"></label>`;

// ---------- lender portal: /l ----------
function portal(pool, wa) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));
  router.use(sameSite);
  const fails = new Map();

  const readCookie = req => {
    const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
    return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
  };
  async function lenderOf(req) {
    const id = readCookie(req);
    if (!id) return null;
    const { rows: [l] } = await pool.query(
      `SELECT l.* FROM lender_sessions s JOIN lenders l ON l.id = s.lender_id WHERE s.id_hash = $1 AND s.expires_at > now() AND l.active`, [sha(id)]);
    return l || null;
  }
  const loginPage = (err = '') => page('Mkoba for lenders', `<div class="card"><h1>Mkoba for lenders</h1>
    ${err ? `<p class="out" role="alert">${esc(err)}</p>` : ''}
    <form method="post" action="/l/login" style="display:grid;gap:10px;margin-top:12px">
      ${field('code', 'Lender code', 'required autocomplete="username"')}${field('password', 'Password', 'type="password" required autocomplete="current-password"')}
      <button class="btn" type="submit">Log in</button></form>
    <p class="note">Access is given by Mkoba. Vendors' records are shown only with their permission.</p></div>`);

  router.get('/login', (_req, res) => res.send(loginPage()));
  router.post('/login', async (req, res, next) => {
    try {
      const now = Date.now();
      const recent = (fails.get(req.ip) || []).filter(t => t > now - 15 * 60e3);
      if (recent.length >= 5) return res.status(429).send(loginPage('Too many attempts. Try again in 15 minutes.'));
      const { rows: [l] } = await pool.query('SELECT * FROM lenders WHERE lower(code) = lower($1) AND active', [String(req.body.code || '').trim()]);
      if (!l || !checkPassword(req.body.password || '', l.password_hash)) {
        fails.set(req.ip, [...recent, now]);
        log.warn('lender_login_failed', { ip: req.ip });
        return res.status(401).send(loginPage('Wrong code or password.'));
      }
      fails.delete(req.ip);
      const id = crypto.randomBytes(32).toString('base64url');
      await pool.query(`INSERT INTO lender_sessions (id_hash, lender_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_HOURS} hours')`, [sha(id), l.id]);
      res.cookie(COOKIE, id, { httpOnly: true, secure: req.secure, sameSite: 'strict', path: '/l', maxAge: SESSION_HOURS * 3600e3 });
      log.info('lender_login', { lender: l.code });
      res.redirect(303, '/l');
    } catch (err) { next(err); }
  });
  router.post('/logout', async (req, res, next) => {
    try {
      const id = readCookie(req);
      if (id) await pool.query('DELETE FROM lender_sessions WHERE id_hash = $1', [sha(id)]);
      res.clearCookie(COOKIE, { path: '/l' });
      res.redirect(303, '/l/login');
    } catch (err) { next(err); }
  });

  // Everything below needs a logged-in lender.
  router.use(async (req, res, next) => {
    try { req.lender = await lenderOf(req); return req.lender ? next() : res.redirect(303, '/l/login'); } catch (err) { next(err); }
  });

  router.get('/', async (req, res, next) => {
    try {
      const l = req.lender;
      const { rows: vendors } = await pool.query(
        `SELECT v.id, v.name, v.business_type, v.phone_number, to_char(c.decided_at AT TIME ZONE '${TZ}', 'DD/MM/YYYY') AS since,
                (SELECT score FROM credit_scores s WHERE s.vendor_id = v.id ORDER BY day DESC LIMIT 1) AS score
           FROM lender_consents c JOIN vendors v ON v.id = c.vendor_id
          WHERE c.lender_id = $1 AND c.status = 'granted' ORDER BY c.decided_at DESC`, [l.id]);
      const { rows: asks } = await pool.query(
        `SELECT c.asked_phone, c.status, to_char(c.requested_at AT TIME ZONE '${TZ}', 'DD/MM/YYYY') AS at
           FROM lender_consents c WHERE c.lender_id = $1 AND c.status IN ('requested', 'declined', 'revoked') AND c.asked_phone IS NOT NULL
          ORDER BY c.requested_at DESC LIMIT 30`, [l.id]);
      const msg = { sent: 'Request sent. If this number uses Mkoba, the vendor gets your request on WhatsApp.', bad: 'Enter a valid Tanzanian mobile number, e.g. 0712345678.',
        limit: 'Daily request limit reached (30). Try again tomorrow.' }[req.query.m] || '';
      const vname = n => (/^\d+$/.test(n || '') ? '(no name)' : n);
      res.send(page(`${l.name} – Mkoba`, `
        <div class="top"><h1>${esc(l.name)} – Mkoba for lenders</h1>
          <form method="post" action="/l/logout"><button class="link-btn" type="submit">Log out</button></form></div>
        <h2>Vendors who gave you access</h2>
        ${vendors.length ? `<div class="scroll"><table><thead><tr><th>Name</th><th>Business</th><th>Phone</th><th>Access since</th><th class="r">Score</th><th></th></tr></thead>
          <tbody>${vendors.map(v => `<tr><td>${esc(vname(v.name))}</td><td>${esc(v.business_type || '')}</td><td class="num">${esc(showPhone(v.phone_number))}</td>
            <td class="num">${esc(v.since)}</td><td class="r num">${v.score != null ? esc(v.score) : '–'}</td><td><a href="/l/v/${v.id}">View</a></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="empty">No vendor has given you access yet. Ask a vendor below, or ask them to send <b>ruhusu ' + esc(l.code) + '</b> to Mkoba on WhatsApp.</p>'}
        <h2>Ask a vendor for access</h2>
        ${msg ? `<p class="card" role="status">${esc(msg)}</p>` : ''}
        <form method="post" action="/l/request" class="card" style="display:grid;gap:10px">
          ${field('phone', "Vendor's WhatsApp number", 'required inputmode="tel" placeholder="0712345678"')}
          ${field('note', 'Message to the vendor (optional)', 'maxlength="140" placeholder="For your loan application of 22 October"')}
          <button class="btn" type="submit">Send request</button></form>
        <p class="note">The vendor answers on WhatsApp. You see their records only after they agree, and they can remove access at any time.</p>
        ${asks.length ? `<h2>Your requests</h2><div class="scroll"><table><thead><tr><th>Number</th><th>Status</th><th>Asked</th></tr></thead>
          <tbody>${asks.map(a => `<tr><td class="num">${esc(showPhone(a.asked_phone))}</td><td>${esc({ requested: 'waiting', declined: 'declined', revoked: 'access removed' }[a.status])}</td><td class="num">${esc(a.at)}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
        { wide: true }));
    } catch (err) { next(err); }
  });

  router.post('/request', async (req, res, next) => {
    try {
      const l = req.lender;
      const m = String(req.body.phone || '').replace(/[\s-]/g, '').match(PHONE);
      if (!m) return res.redirect(303, '/l?m=bad');
      const { rows: [{ n }] } = await pool.query(
        `SELECT count(*)::int AS n FROM consent_events WHERE lender_id = $1 AND event = 'requested' AND at > now() - interval '1 day'`, [l.id]);
      if (n >= 30) return res.redirect(303, '/l?m=limit');
      const phone = '255' + m[1];
      const note = String(req.body.note || '').trim().slice(0, 140) || null;
      const { rows: [v] } = await pool.query(
        `SELECT id, phone_number, language FROM vendors WHERE phone_number = $1 AND kind = 'vendor' AND consent_at IS NOT NULL`, [phone]);
      // The same answer whether or not the number uses Mkoba, so lenders can't probe who is a user.
      if (v) {
        const { rows: [c] } = await pool.query(
          `INSERT INTO lender_consents (lender_id, vendor_id, status, requested_at, asked_phone, note) VALUES ($1, $2, 'requested', now(), $3, $4)
           ON CONFLICT (lender_id, vendor_id) DO UPDATE SET
             status = CASE WHEN lender_consents.status = 'granted' THEN 'granted' ELSE 'requested' END,
             requested_at = now(), asked_phone = $3, note = $4
           RETURNING status`, [l.id, v.id, phone, note]);
        await event(pool, l.id, v.id, 'requested', 'lender', note);
        if (c.status === 'requested') {
          await require('./bulk').notify(pool, wa, v.id, v.phone_number, w(v.language).request(l.name, l.code, note));
        }
      }
      log.info('lender_request', { lender: l.code });
      res.redirect(303, '/l?m=sent');
    } catch (err) { next(err); }
  });

  router.get('/v/:id', async (req, res, next) => {
    try {
      const l = req.lender;
      if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
      const { rows: [v] } = await pool.query(
        `SELECT v.id AS vendor_id, v.name, v.business_type, v.phone_number,
                to_char((SELECT min(created_at) FROM transactions WHERE vendor_id = v.id AND deleted_at IS NULL) AT TIME ZONE '${TZ}', 'DD/MM/YYYY') AS since
           FROM lender_consents c JOIN vendors v ON v.id = c.vendor_id
          WHERE c.lender_id = $1 AND c.vendor_id = $2 AND c.status = 'granted'`, [l.id, req.params.id]);
      if (!v) return res.status(403).send(page('No access', '<div class="card"><h1>No access</h1><p>This vendor has not given you access, or removed it.</p><p><a href="/l">Back</a></p></div>'));
      await pool.query('INSERT INTO lender_views (lender_id, vendor_id) VALUES ($1, $2)', [l.id, v.vendor_id]);
      const { statementBody } = require('./statement');
      const body = await statementBody(v, 'en', { fullPhone: true }); // also saves today's score snapshot
      const { rows: hist } = await pool.query(
        `SELECT to_char(day, 'DD/MM/YYYY') AS d, score FROM credit_scores WHERE vendor_id = $1 ORDER BY day DESC LIMIT 30`, [v.vendor_id]);
      const { rows: evs } = await pool.query(
        `SELECT event, by_whom, note, to_char(at AT TIME ZONE '${TZ}', 'DD/MM/YYYY HH24:MI') AS t FROM consent_events
          WHERE lender_id = $1 AND vendor_id = $2 ORDER BY at DESC LIMIT 20`, [l.id, v.vendor_id]);
      const name = /^\d+$/.test(v.name || '') ? '(no name)' : v.name;
      res.send(page(`${name} – Mkoba`, `
        <p><a href="/l">← All vendors</a></p>
        <h1 class="doc-title">Business statement: ${esc(name)}</h1>
        ${body}
        <h2>Score history</h2>
        ${hist.length ? `<table><thead><tr><th>Date</th><th class="r">Score</th></tr></thead><tbody>${hist.map(h => `<tr><td class="num">${esc(h.d)}</td><td class="r num">${esc(h.score)}</td></tr>`).join('')}</tbody></table>`
          : '<p class="note">No score snapshots yet.</p>'}
        <h2>Consent log</h2>
        <table><tbody>${evs.map(e => `<tr><td class="num">${esc(e.t)}</td><td>${esc(e.event)} by ${esc(e.by_whom)}</td><td>${esc(e.note || '')}</td></tr>`).join('')}</tbody></table>
        <p class="note">These figures come from records the business owner entered in Mkoba. Mkoba has not verified them. Records from mobile-money SMS were taken from the provider's messages. Your views of this page are logged and the vendor can see when you last looked.</p>`,
        { wide: true }));
    } catch (err) { next(err); }
  });
  return router;
}

// ---------- admin: /admin/lenders ----------
const adminRouter = express.Router();
adminRouter.use(express.urlencoded({ extended: false, limit: '4kb' }));
adminRouter.use(sameSite);

async function adminPage(pool, notice = '') {
  const { rows } = await pool.query(
    `SELECT l.*, (SELECT count(*) FROM lender_consents c WHERE c.lender_id = l.id AND c.status = 'granted') AS granted,
            (SELECT count(*) FROM lender_consents c WHERE c.lender_id = l.id AND c.status = 'requested') AS waiting,
            to_char((SELECT max(at) FROM lender_views x WHERE x.lender_id = l.id) AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS last_view
       FROM lenders l ORDER BY l.active DESC, l.name`);
  return page('Mkoba lenders', `
    <p><a href="/admin">← Admin</a></p><h1>Lenders</h1>
    ${notice ? `<p class="card" role="status">${notice}</p>` : ''}
    <div class="scroll"><table><thead><tr><th>Code</th><th>Name</th><th>Contact</th><th class="r">Vendors with access</th><th class="r">Waiting</th><th>Last view</th><th></th><th></th></tr></thead>
    <tbody>${rows.map(l => `<tr><td>${esc(l.code)}</td><td>${esc(l.name)}</td><td>${esc(l.contact || '')}</td><td class="r num">${esc(l.granted)}</td>
      <td class="r num">${esc(l.waiting)}</td><td class="num">${esc(l.last_view || '')}</td>
      <td><form method="post" action="/admin/lenders/${l.id}/password"><button class="link-btn">New password</button></form></td>
      <td><form method="post" action="/admin/lenders/${l.id}/${l.active ? 'off' : 'on'}"><button class="link-btn">${l.active ? 'Switch off' : 'Switch on'}</button></form></td></tr>`).join('')
      || '<tr><td colspan="8">No lenders yet.</td></tr>'}</tbody></table></div>
    <form method="post" action="/admin/lenders" class="card" style="margin-top:12px;display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))">
      ${field('code', 'Code (2–10 letters/digits, e.g. NMB)', 'required pattern="[A-Za-z0-9]{2,10}"')}${field('name', 'Name', 'required maxlength="80"')}
      ${field('contact', 'Contact person / email (optional)', 'maxlength="120"')}<button class="btn" type="submit">Add lender</button></form>
    <p class="note">Lenders log in at <b>/l</b> with their code and password. A switched-off lender cannot log in and vendors no longer see it.
      Vendors give access with <b>ruhusu CODE</b> on WhatsApp.</p>`, { wide: true });
}
const showPw = (code, pw) => `Password for <b>${esc(code)}</b>: <code>${esc(pw)}</code> — copy it now and give it to the lender privately. It is not shown again.`;

adminRouter.get('/', async (_req, res, next) => { try { res.send(await adminPage(require('./db'))); } catch (err) { next(err); } });
adminRouter.post('/', async (req, res, next) => {
  try {
    const pool = require('./db');
    const code = String(req.body.code || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim().slice(0, 80);
    if (!/^[A-Z0-9]{2,10}$/.test(code) || !name) return res.status(400).send(await adminPage(pool, 'Code must be 2–10 letters or digits, and a name is needed.'));
    const pw = newPassword();
    const { rowCount } = await pool.query(
      `INSERT INTO lenders (code, name, contact, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING`,
      [code, name, String(req.body.contact || '').trim().slice(0, 120) || null, hashPassword(pw)]);
    if (!rowCount) return res.status(400).send(await adminPage(pool, `Code ${esc(code)} is already used.`));
    log.info('lender_created', { lender: code });
    res.send(await adminPage(pool, showPw(code, pw)));
  } catch (err) { next(err); }
});
adminRouter.post('/:id/password', async (req, res, next) => {
  try {
    const pool = require('./db');
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
    const pw = newPassword();
    const { rows: [l] } = await pool.query('UPDATE lenders SET password_hash = $2 WHERE id = $1 RETURNING code', [req.params.id, hashPassword(pw)]);
    if (!l) return res.sendStatus(404);
    await pool.query('DELETE FROM lender_sessions WHERE lender_id = $1', [req.params.id]); // log out everywhere
    res.send(await adminPage(pool, showPw(l.code, pw)));
  } catch (err) { next(err); }
});
adminRouter.post('/:id/:state', async (req, res, next) => {
  try {
    const pool = require('./db');
    if (!/^\d+$/.test(req.params.id) || !['on', 'off'].includes(req.params.state)) return res.sendStatus(404);
    await pool.query('UPDATE lenders SET active = $2 WHERE id = $1', [req.params.id, req.params.state === 'on']);
    if (req.params.state === 'off') await pool.query('DELETE FROM lender_sessions WHERE lender_id = $1', [req.params.id]);
    res.redirect(303, '/admin/lenders');
  } catch (err) { next(err); }
});

module.exports = { parseLender, lenderReply, snapshotScores, portal, adminRouter, hashPassword, checkPassword };
