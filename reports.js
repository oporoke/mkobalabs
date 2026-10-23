// Evening summaries. Run by a systemd timer at 21:00 Tanzania time: `node reports.js`
// Sunday: weekly summary; other days: today's summary. Only vendors who recorded something in the period.
const { getSummaryRows, buildSummary } = require('./summary');
const { fmtTsh } = require('./format');
const { t } = require('./i18n');
const { balanceRows } = require('./debts');
const { lowItems, fmtQty } = require('./stock');

const TZ = 'Africa/Dar_es_Salaam';
const TEMPLATE = process.env.REPORT_TEMPLATE || 'mkoba_muhtasari';
const TEMPLATE_LANG = process.env.REPORT_TEMPLATE_LANG || 'sw';

// --- vendor commands: "acha ripoti" / "anza ripoti" ---
const STOP = new Set(['acha ripoti', 'sitisha ripoti', 'zima ripoti', 'stop ripoti', 'stop reports']);
const START = new Set(['anza ripoti', 'washa ripoti', 'start ripoti', 'start reports']);

function parseReportSetting(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return STOP.has(t) ? false : START.has(t) ? true : null;
}

async function reportSettingReply(pool, vendorId, text, lang = 'sw') {
  const on = parseReportSetting(text);
  if (on === null) return null;
  await pool.query(`UPDATE vendors SET daily_report = $2 WHERE id = $1`, [vendorId, on]);
  return on ? t(lang).reportsOn : t(lang).reportsOff;
}

// --- sending ---
function totals(rows) {
  const get = t => Number(rows.find(r => r.type === t)?.total || 0);
  const sale = get('sale'), purchase = get('purchase'), expense = get('expense');
  const net = sale - purchase - expense;
  return { sale, purchase, expense, netLine: net >= 0 ? `Faida: ${fmtTsh(net)}` : `Hasara: ${fmtTsh(-net)}` };
}

const displayName = (name, lang = 'sw') => (!name || /^\d+$/.test(name) ? t(lang).someone : name);

async function sendReports(pool, wa, { forcePeriod } = {}) { // forcePeriod: tests only
  const { rows: [{ dow, today }] } = await pool.query(
    `SELECT extract(isodow FROM now() AT TIME ZONE '${TZ}')::int AS dow, (now() AT TIME ZONE '${TZ}')::date::text AS today`
  );
  const period = forcePeriod || (dow === 7 ? 'wiki' : 'leo');
  const title = period === 'wiki' ? 'wiki hii' : 'leo';

  const { rows: vendors } = await pool.query(
    `SELECT v.id, v.phone_number, v.name, v.language,
            (SELECT max(created_at) FROM messages_log m WHERE m.vendor_id = v.id) > now() - interval '23 hours' AS in_window
       FROM vendors v
      WHERE v.daily_report AND v.consent_at IS NOT NULL`
  );

  const result = { period, date: today, sent: 0, skipped: 0, failed: 0 };
  for (const v of vendors) {
    const rows = await getSummaryRows(pool, v.id, period);
    if (!rows.length) { result.skipped++; continue; }

    // Claim this (vendor, period, date) first so a second run can't send it again.
    const claim = await pool.query(
      `INSERT INTO report_log (vendor_id, period, report_date, sent_via) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING vendor_id`,
      [v.id, period, today, v.in_window ? 'text' : 'template']
    );
    if (!claim.rowCount) { result.skipped++; continue; }

    let res;
    if (v.in_window) {
      const L = t(v.language);
      let debts = '';
      if (period === 'wiki') {
        const owed = (await balanceRows(pool, v.id)).filter(r => Number(r.balance) > 0).slice(0, 5);
        if (owed.length) debts = '\n\n' + L.weeklyDebts(owed.map(r => `- ${r.name} ${fmtTsh(r.balance)} (${L.daysOpen(Number(r.days))})`).join('\n'));
      }
      const low = await lowItems(pool, v.id);
      const stock = low.length ? '\n\n' + L.reportLowStock(low.map(r => `${r.item} ${fmtQty(r.qty, r.unit)}`).join(', ')) : '';
      res = await wa.sendText(v.phone_number, `${L.reportGreeting(displayName(v.name, v.language))}\n${await buildSummary(pool, v.id, period, v.language)}${debts}${stock}\n\n${L.reportFooter}`);
    } else {
      const t = totals(rows);
      res = await wa.sendTemplate(v.phone_number, TEMPLATE, TEMPLATE_LANG,
        [displayName(v.name), title, fmtTsh(t.sale), fmtTsh(t.purchase), fmtTsh(t.expense), t.netLine]);
    }

    if (res.ok && res.dryRun) {
      // Dry run: release the claim so the real run still sends.
      await pool.query(`DELETE FROM report_log WHERE vendor_id = $1 AND period = $2 AND report_date = $3`, [v.id, period, today]);
      result.sent++;
    } else if (res.ok) result.sent++;
    else {
      result.failed++;
      await pool.query(`DELETE FROM report_log WHERE vendor_id = $1 AND period = $2 AND report_date = $3`, [v.id, period, today]);
    }
  }
  return result;
}

module.exports = { sendReports, reportSettingReply, parseReportSetting, totals };

// CLI entry point (systemd timer)
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const pool = require('./db');
  const wa = require('./whatsapp');
  sendReports(pool, wa)
    .then(async r => {
      console.log('Reports:', JSON.stringify(r));
      // Same evening run: close weekly bulk orders that are due (Friday) and tell members their share.
      console.log('Bulk orders:', JSON.stringify(await require('./bulk').closeDueOrders(pool, wa)));
      return pool.end();
    })
    .catch(err => { console.error('Reports failed:', err.stack); process.exit(1); });
}
