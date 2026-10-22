// Debts (madeni): who owes the vendor, and whom the vendor owes.
// Stored in transactions with a counterparty and one of four types:
//   credit_given       they owe me      (+)   "namdai Juma 5000", "Juma anadaiwa 5000", "nimemkopesha Juma 5000"
//   credit_received    I owe them       (-)   "Juma ananidai 5000", "nadaiwa na Juma 5000", "nimekopa kwa Juma 5000"
//   repayment_received they paid me     (-)   "Juma amelipa 2000", "Juma amenilipa 2000"
//   repayment_made     I paid them      (+)   "nimemlipa Juma 2000", "nimelipa deni la Juma 2000"
const { parseLedgerEntry } = require('./parser');
const { fmtTsh } = require('./format');
const { t } = require('./i18n');

const PREFIX = '(?:mama|baba|bi|bw|bwana|kaka|dada|mzee|ndugu|shangazi|mjomba|mr|mrs)';
const NAME = `(${PREFIX}\\s+[a-z]+|[a-z]+)`;
const NOT_NAMES = new Set(['leo', 'jana', 'deni', 'madeni', 'tsh', 'sh', 'shilingi', 'na', 'kwa', 'la', 'ya', 'me', 'i', 'he', 'she']);

const PATTERNS = [
  // name after the verb
  ['credit_given', new RegExp(`\\b(?:ni)?namdai\\s+${NAME}`)],
  ['credit_given', new RegExp(`\\bnime(?:m|wa)?kopesha\\s+${NAME}`)],
  ['credit_given', new RegExp(`\\blent\\s+${NAME}`)],
  ['credit_received', new RegExp(`\\b(?:ni)?nadaiwa\\s+na\\s+${NAME}`)],
  ['credit_received', new RegExp(`\\bnimekopa\\s+(?:kutoka\\s+)?kwa\\s+${NAME}`)],
  ['credit_received', new RegExp(`\\bi\\s+owe\\s+${NAME}`)],
  ['repayment_made', new RegExp(`\\bnimemlipa\\s+${NAME}`)],
  ['repayment_made', new RegExp(`\\bnimelipa\\s+deni\\s+(?:la|ya)\\s+${NAME}`)],
  ['repayment_made', new RegExp(`\\bnimemrudishia\\s+${NAME}`)],
  // name before the verb
  ['credit_given', new RegExp(`${NAME}\\s+(?:anadaiwa|amekopa|alikopa|owes\\s+me)\\b`)],
  ['credit_received', new RegExp(`${NAME}\\s+(?:ananidai|alinidai)\\b`)],
  ['repayment_received', new RegExp(`${NAME}\\s+(?:amelipa|amenilipa|alilipa|alinilipa|amerudisha|amenirudishia|paid(?:\\s+me|\\s+back)?)\\b`)],
];

const titleCase = s => s.replace(/\b[a-z]/g, c => c.toUpperCase());

function parseDebt(text) {
  const lower = String(text || '').toLowerCase();
  for (const [type, re] of PATTERNS) {
    const m = lower.match(re);
    if (!m) continue;
    const name = m[1].trim();
    if (NOT_NAMES.has(name)) continue;
    const rest = lower.slice(0, m.index) + ' ' + lower.slice(m.index + m[0].length);
    return { type, name: titleCase(name), amount: parseLedgerEntry(rest).amount };
  }
  return null;
}

function parseDebtQuery(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (['madeni', 'deni', 'debts', 'debt'].includes(t)) return { all: true };
  const m = t.match(new RegExp(`^(?:deni|debt)\\s+(?:la\\s+|ya\\s+|of\\s+)?${NAME}$`));
  return m ? { name: titleCase(m[1]) } : null;
}

const SIGNED = `CASE type WHEN 'credit_given' THEN amount_tsh WHEN 'repayment_made' THEN amount_tsh
                         WHEN 'credit_received' THEN -amount_tsh WHEN 'repayment_received' THEN -amount_tsh END`;
const LIVE = `deleted_at IS NULL AND status = 'confirmed' AND counterparty IS NOT NULL`;

function balanceLine(name, balance, lang = 'sw') {
  const b = Number(balance), L = t(lang);
  if (b > 0) return L.owesYou(name, fmtTsh(b));
  if (b < 0) return L.youOwe(name, fmtTsh(-b));
  return L.settled(name);
}

async function personBalance(pool, vendorId, name) {
  const { rows: [r] } = await pool.query(
    `SELECT COALESCE(SUM(${SIGNED}), 0) AS balance, COUNT(*) AS n FROM transactions
      WHERE vendor_id = $1 AND ${LIVE} AND lower(counterparty) = lower($2)`,
    [vendorId, name]
  );
  return r;
}

// Non-zero balances per person: [{ name, balance }] (positive = they owe the vendor)
async function balanceRows(pool, vendorId) {
  const { rows } = await pool.query(
    `SELECT min(counterparty) AS name, SUM(${SIGNED}) AS balance FROM transactions
      WHERE vendor_id = $1 AND ${LIVE}
      GROUP BY lower(counterparty)
     HAVING SUM(${SIGNED}) <> 0
      ORDER BY abs(SUM(${SIGNED})) DESC`,
    [vendorId]
  );
  return rows;
}

async function allBalances(pool, vendorId, lang = 'sw') {
  const L = t(lang);
  const rows = await balanceRows(pool, vendorId);
  if (!rows.length) return L.noDebts;
  const owedToMe = rows.filter(r => Number(r.balance) > 0);
  const iOwe = rows.filter(r => Number(r.balance) < 0);
  const out = [L.debtsTitle];
  if (owedToMe.length) out.push(L.owedToYou, ...owedToMe.map(r => `- ${r.name} ${fmtTsh(r.balance)}`));
  if (iOwe.length) out.push(L.youOweHeading, ...iOwe.map(r => `- ${r.name} ${fmtTsh(-r.balance)}`));
  return out.join('\n');
}

const ACTION = t('sw').debtAction; // kept for older callers

// Returns a reply if the text is about debts; null otherwise (caller continues).
async function debtReply(pool, vendorId, messageId, text, lang = 'sw') {
  const L = t(lang);
  const q = parseDebtQuery(text);
  if (q) {
    if (q.all) return allBalances(pool, vendorId, lang);
    const r = await personBalance(pool, vendorId, q.name);
    return Number(r.n) ? balanceLine(q.name, r.balance, lang) + '.' : L.noRecordsFor(q.name);
  }

  const d = parseDebt(text);
  if (!d) return null;
  if (!d.amount) return L.askDebtAmount(String(text).trim());

  await pool.query(
    `INSERT INTO transactions (vendor_id, message_id, type, direction, amount_tsh, raw_input, channel, parse_confidence, status, counterparty)
     VALUES ($1, $2, $3, NULL, $4, $5, 'whatsapp', 0.9, 'confirmed', $6)`,
    [vendorId, messageId, d.type, d.amount, text, d.name]
  );
  const r = await personBalance(pool, vendorId, d.name);
  return L.debtSaved(L.debtAction[d.type](d.name, fmtTsh(d.amount)), balanceLine(d.name, r.balance, lang));
}

module.exports = { parseDebt, parseDebtQuery, debtReply, balanceRows, ACTION };
