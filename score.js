// Mkoba credit score (roadmap #6): 0–100 from the last 90 days of the vendor's own records.
//   Consistency 30  share of days with records (over the days since the first record, at least 30, at most 90)
//   Profit      25  15 for months in profit (of the last three 30-day months) + 10 for margin (30% margin = full)
//   Trend       15  sales in the last 30 days vs the 30-day average of the 60 before (≤0.5x = 0, ≥1.2x = full);
//                   only days after the first record count, and with under 15 such days the trend is neutral (7.5)
//   Track       15  days since the first record (180 days = full)
//   Debts       10  what the vendor owes vs monthly sales (none = full, a month of sales or more = 0)
//   Quality      5  share of records from mobile-money SMS, completed orders, bulk deliveries or receipts (30% = full)
// The score is only shown with at least 14 days of records over at least 30 days of use.
const { t } = require('./i18n');

const MIN_ACTIVE_DAYS = 14, MIN_DAYS = 30;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const r1 = x => Math.round(x * 10) / 10;

async function computeScore(pool, vendorId) {
  const TZ = 'Africa/Dar_es_Salaam';
  const { rows: [f] } = await pool.query(
    `WITH tx AS (
       SELECT t.*, (t.created_at AT TIME ZONE '${TZ}')::date AS day,
              (t.channel IN ('mobile_money', 'order', 'bulk')
               OR EXISTS (SELECT 1 FROM receipts r WHERE r.vendor_id = t.vendor_id AND r.message_id = t.message_id)) AS verified
         FROM transactions t
        WHERE t.vendor_id = $1 AND t.deleted_at IS NULL AND t.status = 'confirmed'
     ), cash AS (SELECT * FROM tx WHERE type IN ('sale', 'purchase', 'expense'))
     SELECT
       (SELECT min(day) FROM cash) AS first_day,
       ((now() AT TIME ZONE '${TZ}')::date - (SELECT min(day) FROM cash)) AS days_since_first,
       (SELECT count(DISTINCT day) FROM cash WHERE created_at > now() - interval '90 days') AS active_days,
       (SELECT COALESCE(sum(amount_tsh) FILTER (WHERE type = 'sale'), 0) FROM cash WHERE created_at > now() - interval '90 days') AS sales90,
       (SELECT COALESCE(sum(amount_tsh) FILTER (WHERE type <> 'sale'), 0) FROM cash WHERE created_at > now() - interval '90 days') AS costs90,
       (SELECT COALESCE(sum(amount_tsh) FILTER (WHERE type = 'sale'), 0) FROM cash WHERE created_at > now() - interval '30 days') AS sales30,
       (SELECT COALESCE(sum(amount_tsh) FILTER (WHERE type = 'sale'), 0) FROM cash
         WHERE created_at > now() - interval '90 days' AND created_at <= now() - interval '30 days') AS sales_prev60,
       (SELECT json_agg(m ORDER BY m.k) FROM (
          SELECT k, COALESCE(sum(CASE WHEN c.type = 'sale' THEN c.amount_tsh ELSE -c.amount_tsh END), 0) AS net,
                 count(c.id) AS n
            FROM generate_series(0, 2) k
            LEFT JOIN cash c ON c.created_at > now() - ((k + 1) * interval '30 days') AND c.created_at <= now() - (k * interval '30 days')
           GROUP BY k) m) AS months,
       (SELECT count(*) FROM cash WHERE created_at > now() - interval '90 days') AS records90,
       (SELECT count(*) FROM cash WHERE created_at > now() - interval '90 days' AND verified) AS verified90,
       (SELECT COALESCE(-sum(b), 0) FROM (
          SELECT sum(CASE type WHEN 'credit_given' THEN amount_tsh WHEN 'repayment_made' THEN amount_tsh
                               WHEN 'credit_received' THEN -amount_tsh WHEN 'repayment_received' THEN -amount_tsh END) AS b
            FROM tx WHERE counterparty IS NOT NULL GROUP BY lower(counterparty)) x WHERE b < 0) AS owes`,
    [vendorId]);

  const n = k => Number(f[k] || 0);
  const daysSinceFirst = f.first_day ? n('days_since_first') + 1 : 0;
  const facts = {
    daysSinceFirst, activeDays: n('active_days'), sales90: n('sales90'), costs90: n('costs90'),
    sales30: n('sales30'), salesPrev60: n('sales_prev60'), owes: n('owes'),
    records90: n('records90'), verified90: n('verified90'), months: (f.months || []).map(m => ({ net: Number(m.net), n: Number(m.n) })),
  };
  if (facts.activeDays < MIN_ACTIVE_DAYS || daysSinceFirst < MIN_DAYS) return { ready: false, facts };

  const window = clamp(daysSinceFirst, MIN_DAYS, 90);
  const consistency = 30 * clamp(facts.activeDays / window);

  const monthsWithData = facts.months.filter(m => m.n > 0);
  const monthsInProfit = monthsWithData.filter(m => m.net > 0).length;
  const margin = facts.sales90 > 0 ? (facts.sales90 - facts.costs90) / facts.sales90 : 0;
  const profit = 15 * (monthsWithData.length ? monthsInProfit / 3 : 0) + 10 * clamp(margin / 0.3);

  // Compare with the earlier days the vendor actually used Mkoba (not days before their first record).
  const prevDays = clamp(daysSinceFirst - 30, 0, 60);
  const prevAvg = prevDays > 0 ? (facts.salesPrev60 / prevDays) * 30 : 0;
  const ratio = prevAvg > 0 ? facts.sales30 / prevAvg : null;
  const trend = prevDays < 15 ? 7.5                      // too little history to compare: neutral
    : ratio == null ? (facts.sales30 > 0 ? 15 : 0)
    : 15 * clamp((ratio - 0.5) / 0.7);

  const track = 15 * clamp(daysSinceFirst / 180);

  const monthlySales = facts.sales90 / 3;
  const debts = monthlySales > 0 ? 10 * clamp(1 - facts.owes / monthlySales) : facts.owes > 0 ? 0 : 5;

  const quality = facts.records90 ? 5 * clamp(facts.verified90 / facts.records90 / 0.3) : 0;

  const parts = { consistency: r1(consistency), profit: r1(profit), trend: r1(trend), track: r1(track), debts: r1(debts), quality: r1(quality) };
  const score = Math.round(consistency + profit + trend + track + debts + quality);
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'E';
  return { ready: true, score, grade, parts, facts: { ...facts, margin, ratio: ratio ?? 0, monthsInProfit, window } };
}

// Keep one snapshot per vendor per day, so changes over time can be shown to lenders later.
async function saveSnapshot(pool, vendorId, s) {
  if (!s.ready) return;
  await pool.query(
    `INSERT INTO credit_scores (vendor_id, day, score, parts) VALUES ($1, (now() AT TIME ZONE 'Africa/Dar_es_Salaam')::date, $2, $3)
     ON CONFLICT (vendor_id, day) DO UPDATE SET score = EXCLUDED.score, parts = EXCLUDED.parts, created_at = now()`,
    [vendorId, s.score, JSON.stringify(s.parts)]);
}

const MAX = { consistency: 30, profit: 25, trend: 15, track: 15, debts: 10, quality: 5 };
const W = {
  sw: {
    labels: { consistency: 'Kuweka rekodi kila siku', profit: 'Faida', trend: 'Mwenendo wa mauzo', track: 'Muda wa kutumia Mkoba', debts: 'Madeni', quality: 'Rekodi zilizothibitishwa' },
    grades: { A: 'nzuri sana', B: 'nzuri', C: 'wastani', D: 'chini', E: 'chini sana' },
    title: (s, g) => `📈 Alama ya Mkoba: ${s}/100 (${g})`,
    notReady: (d, a) => `Bado hakuna taarifa za kutosha kwa alama. Una siku ${a} zenye rekodi kwa siku ${d} za kutumia Mkoba; zinahitajika angalau siku ${MIN_ACTIVE_DAYS} zenye rekodi kwa siku ${MIN_DAYS}. Endelea kuweka rekodi kila siku!`,
    tipTitle: 'Kuongeza alama:',
    tips: {
      consistency: 'weka rekodi kila siku unayofanya biashara.',
      profit: 'weka gharama zote pia, na angalia bidhaa zenye faida ndogo.',
      trend: 'mauzo ya siku 30 zilizopita yameshuka; endelea kurekodi mauzo yote.',
      track: 'alama hii hupanda yenyewe kadri unavyoendelea kutumia Mkoba.',
      debts: 'punguza madeni yako ukilinganisha na mauzo ya mwezi.',
      quality: 'bandika SMS za pesa ya simu na tumia risiti (risiti 07... chips 5000).',
    },
    note: 'Alama hii inatokana na rekodi zako mwenyewe za siku 90. Inaonekana kwenye taarifa ya biashara unayompa mkopeshaji.',
  },
  en: {
    labels: { consistency: 'Recording every day', profit: 'Profit', trend: 'Sales trend', track: 'Time using Mkoba', debts: 'Debts', quality: 'Verified records' },
    grades: { A: 'very good', B: 'good', C: 'fair', D: 'low', E: 'very low' },
    title: (s, g) => `📈 Mkoba score: ${s}/100 (${g})`,
    notReady: (d, a) => `Not enough data for a score yet. You have ${a} days with records over ${d} days of using Mkoba; at least ${MIN_ACTIVE_DAYS} days with records over ${MIN_DAYS} days are needed. Keep recording every day!`,
    tipTitle: 'To raise your score:',
    tips: {
      consistency: 'record every day you trade.',
      profit: 'record all your costs too, and check items with low profit.',
      trend: 'sales in the last 30 days went down; keep recording all sales.',
      track: 'this rises by itself as you keep using Mkoba.',
      debts: 'reduce what you owe compared with monthly sales.',
      quality: 'paste mobile-money SMS and use receipts (receipt 07... chips 5000).',
    },
    note: 'This score comes from your own records of the last 90 days. It appears on the business statement you give a lender.',
  },
};
const w = lang => W[lang] || W.sw;

const parseScore = text => ['alama', 'alama yangu', 'score', 'my score', 'credit score'].includes(
  String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim());

async function scoreReply(pool, vendorId, lang = 'sw') {
  const L = w(lang);
  const s = await computeScore(pool, vendorId);
  if (!s.ready) return L.notReady(s.facts.daysSinceFirst, s.facts.activeDays);
  await saveSnapshot(pool, vendorId, s);
  const lines = Object.keys(MAX).map(k => `- ${L.labels[k]}: ${s.parts[k]}/${MAX[k]}`);
  // Tips for the two parts furthest from full (by share), skipping ones already near full.
  const weak = Object.keys(MAX).map(k => [k, s.parts[k] / MAX[k]]).filter(([, r]) => r < 0.8).sort((a, b) => a[1] - b[1]).slice(0, 2);
  const tips = weak.length ? `\n\n${L.tipTitle}\n${weak.map(([k]) => `• ${L.tips[k]}`).join('\n')}` : '';
  return `${L.title(s.score, L.grades[s.grade])}\n${lines.join('\n')}${tips}\n\n${L.note}`;
}

module.exports = { computeScore, saveSnapshot, scoreReply, parseScore, MAX, labels: lang => w(lang).labels, grades: lang => w(lang).grades };
