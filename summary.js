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

const ALIASES = {
  leo: ['leo', 'today', 'muhtasari', 'ripoti', 'ripoti ya leo', 'hesabu ya leo'],
  jana: ['jana', 'yesterday', 'ripoti ya jana'],
  wiki: ['wiki', 'wiki hii', 'week', 'this week', 'ripoti ya wiki'],
  mwezi: ['mwezi', 'mwezi huu', 'month', 'this month', 'ripoti ya mwezi'],
  salio: ['salio', 'balance', 'jumla', 'total'],
  msaada: ['msaada', 'help', 'menu', 'menyu', 'saidia'],
};
const LOOKUP = Object.fromEntries(Object.entries(ALIASES).flatMap(([cmd, words]) => words.map(w => [w, cmd])));

const HELP = [
  'Mkoba - jinsi ya kutumia:',
  '• Rekodi: nimeuza 5000, nimenunua unga 20000, nimelipa nauli 2000',
  '• Muhtasari: leo, jana, wiki, mwezi, salio',
  '• Madeni: Juma ananidai 5000, namdai Juma 5000, Juma amelipa 2000, nimemlipa Juma 2000',
  '• Kuona madeni: madeni, au deni Juma',
  '• Ripoti ya jioni: ACHA RIPOTI / ANZA RIPOTI',
  '• Kufuta rekodi ya mwisho: futa',
  '• Kubadilisha kiasi cha mwisho: rekebisha 6000',
  '• Msaada: msaada',
].join('\n');

function parseCommand(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return LOOKUP[t] || null;
}

const { fmtTsh } = require('./format');

function formatSummary(period, rows) {
  const { title } = PERIODS[period];
  if (!rows.length) return period === 'salio' ? 'Hakuna rekodi bado.' : `Hakuna rekodi za ${title} bado.`;
  const by = Object.fromEntries(rows.map(r => [r.type, { total: Number(r.total), n: Number(r.n) }]));
  const get = t => by[t] || { total: 0, n: 0 };
  const sale = get('sale'), purchase = get('purchase'), expense = get('expense');
  const net = sale.total - purchase.total - expense.total;
  return [
    `📊 Muhtasari wa ${title}:`,
    `Mauzo: ${fmtTsh(sale.total)} (${sale.n})`,
    `Manunuzi: ${fmtTsh(purchase.total)} (${purchase.n})`,
    `Matumizi: ${fmtTsh(expense.total)} (${expense.n})`,
    net >= 0 ? `Faida: ${fmtTsh(net)}` : `Hasara: ${fmtTsh(-net)}`,
  ].join('\n');
}

async function getSummaryRows(pool, vendorId, period) {
  const p = PERIODS[period];
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

async function commandReply(pool, vendorId, command) {
  if (command === 'msaada') return HELP;
  return formatSummary(command, await getSummaryRows(pool, vendorId, command));
}

module.exports = { parseCommand, formatSummary, getSummaryRows, commandReply, HELP };
