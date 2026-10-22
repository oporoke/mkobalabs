// Summary commands: leo, jana, wiki, mwezi, salio, msaada
const TZ = 'Africa/Dar_es_Salaam';
const LOCAL_NOW = `(now() AT TIME ZONE '${TZ}')`;

const PERIODS = {
  leo:   { title: 'leo',          start: `date_trunc('day', ${LOCAL_NOW})`,                         end: `date_trunc('day', ${LOCAL_NOW}) + interval '1 day'` },
  jana:  { title: 'jana',         start: `date_trunc('day', ${LOCAL_NOW}) - interval '1 day'`,      end: `date_trunc('day', ${LOCAL_NOW})` },
  wiki:  { title: 'wiki hii',     start: `date_trunc('week', ${LOCAL_NOW})`,                        end: `date_trunc('week', ${LOCAL_NOW}) + interval '7 days'` },
  mwezi: { title: 'mwezi huu',    start: `date_trunc('month', ${LOCAL_NOW})`,                       end: `date_trunc('month', ${LOCAL_NOW}) + interval '1 month'` },
  salio: { title: 'tangu mwanzo', start: null, end: null },
};
// The period before each one, for comparison in summaries (insights).
const PREVIOUS = {
  leo:   { start: `date_trunc('day', ${LOCAL_NOW}) - interval '1 day'`,    end: `date_trunc('day', ${LOCAL_NOW})` },
  jana:  { start: `date_trunc('day', ${LOCAL_NOW}) - interval '2 days'`,   end: `date_trunc('day', ${LOCAL_NOW}) - interval '1 day'` },
  wiki:  { start: `date_trunc('week', ${LOCAL_NOW}) - interval '7 days'`,  end: `date_trunc('week', ${LOCAL_NOW})` },
  mwezi: { start: `date_trunc('month', ${LOCAL_NOW}) - interval '1 month'`, end: `date_trunc('month', ${LOCAL_NOW})` },
};

const ALIASES = {
  leo: ['leo', 'today', 'muhtasari', 'ripoti', 'ripoti ya leo', 'hesabu ya leo'],
  jana: ['jana', 'yesterday', 'ripoti ya jana'],
  wiki: ['wiki', 'wiki hii', 'week', 'this week', 'ripoti ya wiki'],
  mwezi: ['mwezi', 'mwezi huu', 'month', 'this month', 'ripoti ya mwezi'],
  salio: ['salio', 'balance', 'jumla', 'total'],
  msaada: ['msaada', 'help', 'menu', 'menyu', 'saidia'],
};
const LOOKUP = Object.fromEntries(Object.entries(ALIASES).flatMap(([cmd, words]) => words.map(w => [w, cmd])));

const { t } = require('./i18n');
const HELP = t('sw').help; // kept for older callers

function parseCommand(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return LOOKUP[s] || null;
}

const { fmtTsh } = require('./format');

function formatSummary(period, rows, lang = 'sw') {
  const L = t(lang);
  const title = L.periods[period];
  if (!rows.length) return period === 'salio' ? L.noRecords : L.noRecordsPeriod(title);
  const by = Object.fromEntries(rows.map(r => [r.type, { total: Number(r.total), n: Number(r.n) }]));
  const get = type => by[type] || { total: 0, n: 0 };
  const sale = get('sale'), purchase = get('purchase'), expense = get('expense');
  const net = sale.total - purchase.total - expense.total;
  return [
    L.summaryTitle(title),
    `${L.sales}: ${fmtTsh(sale.total)} (${sale.n})`,
    `${L.purchases}: ${fmtTsh(purchase.total)} (${purchase.n})`,
    `${L.expenses}: ${fmtTsh(expense.total)} (${expense.n})`,
    net >= 0 ? `${L.profit}: ${fmtTsh(net)}` : `${L.loss}: ${fmtTsh(-net)}`,
  ].join('\n');
}

const rangeSql = p => (p.start
  ? `AND created_at >= (${p.start}) AT TIME ZONE '${TZ}' AND created_at < (${p.end}) AT TIME ZONE '${TZ}'`
  : '');

async function getSummaryRows(pool, vendorId, period, { previous = false } = {}) {
  const p = previous ? PREVIOUS[period] : PERIODS[period];
  if (!p) return [];
  const range = p.start
    ? `AND created_at >= (${p.start}) AT TIME ZONE '${TZ}' AND created_at < (${p.end}) AT TIME ZONE '${TZ}'`
    : '';
  const { rows } = await pool.query(
    `SELECT type, SUM(amount_tsh) AS total, COUNT(*) AS n
       FROM transactions
      WHERE vendor_id = $1 AND deleted_at IS NULL AND status = 'confirmed'
        AND type IN ('sale', 'purchase', 'expense') ${range}
      GROUP BY type`,
    [vendorId]
  );
  return rows;
}

// Largest item by amount in the period: best seller (sales) and biggest cost (purchases + expenses).
async function topItem(pool, vendorId, period, types) {
  const { rows: [r] } = await pool.query(
    `SELECT min(item) AS item, SUM(amount_tsh) AS total FROM transactions
      WHERE vendor_id = $1 AND deleted_at IS NULL AND status = 'confirmed' AND item IS NOT NULL
        AND type = ANY($2::text[]) ${rangeSql(PERIODS[period])}
      GROUP BY lower(item) ORDER BY SUM(amount_tsh) DESC LIMIT 1`,
    [vendorId, types]
  );
  return r ? { item: r.item, total: Number(r.total) } : null;
}

const net = rows => rows.reduce((s, r) => s + (r.type === 'sale' ? 1 : -1) * Number(r.total), 0);

// Summary text plus insights: previous period, best seller, biggest cost. Used by commands and evening reports.
async function buildSummary(pool, vendorId, period, lang = 'sw') {
  const rows = await getSummaryRows(pool, vendorId, period);
  const text = formatSummary(period, rows, lang);
  if (!rows.length || period === 'salio') return text;
  const L = t(lang);
  const [prevRows, best, cost] = await Promise.all([
    getSummaryRows(pool, vendorId, period, { previous: true }),
    topItem(pool, vendorId, period, ['sale']),
    topItem(pool, vendorId, period, ['purchase', 'expense']),
  ]);
  const extra = [];
  if (best) extra.push(L.bestSeller(best.item, fmtTsh(best.total)));
  if (cost) extra.push(L.biggestCost(cost.item, fmtTsh(cost.total)));
  if (prevRows.length) {
    const p = net(prevRows);
    extra.push(L.previous(L.previousLabel[period], p >= 0 ? L.profit : L.loss, fmtTsh(Math.abs(p))));
  }
  return extra.length ? `${text}\n\n${extra.join('\n')}` : text;
}

async function commandReply(pool, vendorId, command, lang = 'sw') {
  if (command === 'msaada') return t(lang).help;
  return buildSummary(pool, vendorId, command, lang);
}

module.exports = { parseCommand, formatSummary, getSummaryRows, buildSummary, commandReply, HELP };
