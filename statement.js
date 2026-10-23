// Business statement for lenders/SACCOs: a private, expiring, revocable link with 6 months of figures.
// The figures are the vendor's own records; the page says so plainly.
const crypto = require('crypto');
const express = require('express');
const log = require('./log');
const pool = require('./db');
const { esc, page } = require('./html');
const { fmtTsh } = require('./format');
const { t } = require('./i18n');
const score = require('./score');

const TZ = 'Africa/Dar_es_Salaam';
const LINK_DAYS = 30;
const SHORT = {
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const n0 = v => Math.round(Number(v)).toLocaleString('en-US'); // table cells: plain numbers, TSh is in the heading
const MONTHS = {
  sw: ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const norm = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const CREATE = new Set(['taarifa ya biashara', 'ripoti ya biashara', 'taarifa ya mkopo', 'ripoti ya mkopo', 'statement', 'business statement', 'loan statement']);
const REVOKE = new Set(['funga taarifa', 'funga taarifa ya biashara', 'revoke statement', 'close statement']);
const parseStatementCommand = text => (CREATE.has(norm(text)) ? 'create' : REVOKE.has(norm(text)) ? 'revoke' : null);

async function statementReply(pool, vendorId, kind, lang = 'sw') {
  const L = t(lang);
  await pool.query(`UPDATE statement_links SET revoked_at = now() WHERE vendor_id = $1 AND revoked_at IS NULL`, [vendorId]);
  if (kind === 'revoke') return L.statementRevoked;
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO statement_links (token_hash, vendor_id, expires_at) VALUES ($1, $2, now() + interval '${LINK_DAYS} days')`,
    [hash(token), vendorId]
  );
  log.info('statement_created', { vendor: vendorId });
  return L.statementReady(LINK_DAYS, `${process.env.PUBLIC_URL || 'https://mkoba.digital'}/s/${token}`);
}

// --- the shared page ---
const W = {
  sw: {
    title: 'Taarifa ya biashara', from: 'Kutoka Mkoba', business: 'Biashara', phone: 'Simu', since: 'Anatumia Mkoba tangu',
    period: 'Kipindi', month: 'Mwezi', sales: 'Mauzo', costs: 'Gharama', profit: 'Faida', days: 'Siku', total: 'Jumla', inTsh: 'Kiasi ni kwa TSh. Siku = siku zenye rekodi.',
    avgSales: 'Wastani wa mauzo kwa mwezi', avgProfit: 'Wastani wa faida kwa mwezi', activeShare: 'Siku zenye rekodi',
    owedToVendor: 'Wateja wanaodaiwa (anawadai)', vendorOwes: 'Madeni yake (anadaiwa)', mmShare: 'Rekodi kutoka SMS za pesa ya simu',
    note: 'Taarifa hii inatokana na rekodi alizoweka mfanyabiashara mwenyewe kwenye Mkoba kupitia WhatsApp. Mkoba haijazihakiki. Rekodi zilizotoka kwenye SMS za pesa ya simu zimetoka moja kwa moja kwenye ujumbe wa mtoa huduma.',
    ref: 'Namba ya kumbukumbu', generated: 'Imetolewa', valid: 'Kiungo kinafanya kazi mpaka', other: 'Read in English', otherLang: 'en',
    gone: 'Kiungo hiki kimeisha muda au kimefungwa na mwenye biashara.', print: 'Chapisha',
  },
  en: {
    title: 'Business statement', from: 'From Mkoba', business: 'Business', phone: 'Phone', since: 'Using Mkoba since',
    period: 'Period', month: 'Month', sales: 'Sales', costs: 'Costs', profit: 'Profit', days: 'Days', total: 'Total', inTsh: 'Amounts in TSh. Days = days with records.',
    avgSales: 'Average monthly sales', avgProfit: 'Average monthly profit', activeShare: 'Days with records',
    owedToVendor: 'Owed to the business by customers', vendorOwes: 'Owed by the business', mmShare: 'Records from mobile-money SMS',
    note: "These figures come from records the business owner entered in Mkoba on WhatsApp. Mkoba has not verified them. Records imported from mobile-money SMS were taken directly from the provider's messages.",
    ref: 'Reference', generated: 'Generated', valid: 'Link valid until', other: 'Soma kwa Kiswahili', otherLang: 'sw',
    gone: 'This link has expired or was closed by the business owner.', print: 'Print',
  },
};
// Mkoba score block for the statement (shown only when there is enough data).
async function scoreHtml(vendorId, lang) {
  const s = await score.computeScore(pool, vendorId);
  const L = { sw: { h: 'Alama ya Mkoba', none: 'Bado hakuna rekodi za kutosha kwa alama (zinahitajika siku 14 zenye rekodi kwa siku 30).',
                    how: 'Alama 0–100 kutoka rekodi za siku 90: kuweka rekodi kila siku 30, faida 25, mwenendo wa mauzo 15, muda wa kutumia Mkoba 15, madeni 10, rekodi zilizothibitishwa 5.' },
              en: { h: 'Mkoba score', none: 'Not enough records for a score yet (14 days with records over 30 days are needed).',
                    how: 'Score 0–100 from the last 90 days of records: recording every day 30, profit 25, sales trend 15, time using Mkoba 15, debts 10, verified records 5.' } }[lang];
  if (!s.ready) return `<h2>${L.h}</h2><p class="note">${L.none}</p>`;
  await score.saveSnapshot(pool, vendorId, s);
  const labels = score.labels(lang);
  return `<h2>${L.h}: ${s.score}/100 (${esc(score.grades(lang)[s.grade])})</h2>
    <ul class="breakdown num">${Object.keys(score.MAX).map(k => `<li><span>${esc(labels[k])}</span><span>${s.parts[k]} / ${score.MAX[k]}</span></li>`).join('')}</ul>
    <p class="note">${L.how}</p>`;
}

const maskPhone = p => String(p).replace(/^(\d{3})(\d{2})\d+(\d{3})$/, '+$1 $2x xxx $3');

const router = express.Router();
// The statement figures (facts, 6-month table, averages, debts, score), shared by the lender link (/s) and the lender portal.
// v: { vendor_id, business_type, phone_number, since }. fullPhone: the lender portal shows the number (the vendor gave consent).
async function statementBody(v, lang, { fullPhone = false } = {}) {
  const w = W[lang];
    const { rows: months } = await pool.query(
      `WITH m AS (SELECT generate_series(date_trunc('month', now() AT TIME ZONE '${TZ}') - interval '5 months',
                                         date_trunc('month', now() AT TIME ZONE '${TZ}'), '1 month') AS month)
       SELECT extract(month FROM m.month)::int AS mon, extract(year FROM m.month)::int AS yr,
              COALESCE(SUM(t.amount_tsh) FILTER (WHERE t.type = 'sale'), 0) AS sales,
              COALESCE(SUM(t.amount_tsh) FILTER (WHERE t.type IN ('purchase', 'expense')), 0) AS costs,
              COUNT(DISTINCT (t.created_at AT TIME ZONE '${TZ}')::date) AS days,
              COUNT(t.id) AS entries, COUNT(t.id) FILTER (WHERE t.channel = 'mobile_money') AS mm
         FROM m LEFT JOIN transactions t
           ON t.vendor_id = $1 AND t.deleted_at IS NULL AND t.status = 'confirmed' AND t.type IN ('sale', 'purchase', 'expense')
          AND date_trunc('month', t.created_at AT TIME ZONE '${TZ}') = m.month
        GROUP BY m.month ORDER BY m.month DESC`,
      [v.vendor_id]
    );
    const { rows: [debt] } = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN b > 0 THEN b END), 0) AS owed_to_vendor, COALESCE(-SUM(CASE WHEN b < 0 THEN b END), 0) AS vendor_owes
         FROM (SELECT SUM(CASE type WHEN 'credit_given' THEN amount_tsh WHEN 'repayment_made' THEN amount_tsh
                                    WHEN 'credit_received' THEN -amount_tsh WHEN 'repayment_received' THEN -amount_tsh END) AS b
                 FROM transactions WHERE vendor_id = $1 AND deleted_at IS NULL AND status = 'confirmed' AND counterparty IS NOT NULL
                GROUP BY lower(counterparty)) x`,
      [v.vendor_id]
    );
    const { rows: [days] } = await pool.query(
      `SELECT (now() AT TIME ZONE '${TZ}')::date - (date_trunc('month', now() AT TIME ZONE '${TZ}') - interval '5 months')::date + 1 AS calendar_days`
    );

    const num = k => months.reduce((s, m) => s + Number(m[k]), 0);
    const totals = { sales: num('sales'), costs: num('costs'), days: num('days'), entries: num('entries'), mm: num('mm') };
    const activeMonths = months.filter(m => Number(m.entries) > 0).length || 1;
    const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
    const rows = months.map(m => {
      const profit = Number(m.sales) - Number(m.costs);
      return `<tr><td>${SHORT[lang][m.mon - 1]} ${m.yr}</td><td class="r num">${n0(m.sales)}</td>
        <td class="r num">${n0(m.costs)}</td><td class="r num ${profit < 0 ? 'out' : ''}">${profit < 0 ? '−' : ''}${n0(Math.abs(profit))}</td>
        <td class="r num">${esc(m.days)}</td></tr>`;
    }).join('');
    const totalProfit = totals.sales - totals.costs;

    return `      <dl class="facts-list">
        ${v.business_type ? `<div><dt>${w.business}</dt><dd>${esc(v.business_type)}</dd></div>` : ''}
        <div><dt>${w.phone}</dt><dd class="num">${esc(fullPhone ? '+' + v.phone_number : maskPhone(v.phone_number))}</dd></div>
        ${v.since ? `<div><dt>${w.since}</dt><dd class="num">${esc(v.since)}</dd></div>` : ''}
        <div><dt>${w.period}</dt><dd>${MONTHS[lang][months[months.length - 1].mon - 1]} ${months[months.length - 1].yr} – ${MONTHS[lang][months[0].mon - 1]} ${months[0].yr}</dd></div>
      </dl>
      <p class="note">${w.inTsh}</p>
      <div class="scroll"><table class="statement">
        <thead><tr><th>${w.month}</th><th class="r">${w.sales}</th><th class="r">${w.costs}</th><th class="r">${w.profit}</th><th class="r">${w.days}</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th>${w.total}</th><th class="r num">${n0(totals.sales)}</th><th class="r num">${n0(totals.costs)}</th>
          <th class="r num">${totalProfit < 0 ? '−' : ''}${n0(Math.abs(totalProfit))}</th><th class="r num">${totals.days}</th></tr></tfoot>
      </table></div>
      <ul class="breakdown num">
        <li><span>${w.avgSales}</span><span>${esc(fmtTsh(Math.round(totals.sales / activeMonths)))}</span></li>
        <li><span>${w.avgProfit}</span><span>${totalProfit < 0 ? '−' : ''}${esc(fmtTsh(Math.round(Math.abs(totalProfit) / activeMonths)))}</span></li>
        <li><span>${w.activeShare}</span><span>${totals.days} / ${esc(days.calendar_days)} (${pct(totals.days, Number(days.calendar_days))})</span></li>
        <li><span>${w.owedToVendor}</span><span>${esc(fmtTsh(debt.owed_to_vendor))}</span></li>
        <li><span>${w.vendorOwes}</span><span>${esc(fmtTsh(debt.vendor_owes))}</span></li>
        <li><span>${w.mmShare}</span><span>${pct(totals.mm, totals.entries)}</span></li>
      </ul>
      ${await scoreHtml(v.vendor_id, lang)}`;
}

router.get('/:token', async (req, res, next) => {
  try {
    const { rows: [link] } = await pool.query(
      `SELECT l.vendor_id, l.token_hash, to_char(l.expires_at AT TIME ZONE '${TZ}', 'DD/MM/YYYY') AS expires,
              v.name, v.business_type, v.phone_number, v.language,
              to_char((SELECT min(created_at) FROM transactions WHERE vendor_id = v.id AND deleted_at IS NULL) AT TIME ZONE '${TZ}', 'DD/MM/YYYY') AS since
         FROM statement_links l JOIN vendors v ON v.id = l.vendor_id
        WHERE l.token_hash = $1 AND l.revoked_at IS NULL AND l.expires_at > now()`,
      [hash(req.params.token)]
    );
    const lang = req.query.lang === 'en' || req.query.lang === 'sw' ? req.query.lang : link?.language || 'sw';
    const w = W[lang];
    res.set('X-Robots-Tag', 'noindex');
    if (!link) return res.status(404).send(page(w.title, `<div class="card"><h1>${w.title}</h1><p>${w.gone}</p></div>`));

    const name = /^\d+$/.test(link.name || '') ? '' : link.name;
    const ref = link.token_hash.slice(0, 10).toUpperCase();

    res.send(page(`${w.title}${name ? ` - ${name}` : ''}`, `
      <div class="top"><p class="muted">${w.from}</p><a href="?lang=${w.otherLang}">${w.other}</a></div>
      <h1 class="doc-title">${w.title}${name ? `: ${esc(name)}` : ''}</h1>
      ${await statementBody(link, lang)}
      <p class="note">${w.note}</p>
      <dl class="facts-list small num">
        <div><dt>${w.ref}</dt><dd>${ref}</dd></div>
        <div><dt>${w.generated}</dt><dd>${new Date().toLocaleDateString('en-GB', { timeZone: TZ })}</dd></div>
        <div><dt>${w.valid}</dt><dd>${esc(link.expires)}</dd></div>
      </dl>`));
  } catch (err) { next(err); }
});

module.exports = { router, parseStatementCommand, statementReply, statementBody };
