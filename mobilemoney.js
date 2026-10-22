// Mobile-money SMS import (item 38): a vendor pastes a confirmation SMS into WhatsApp.
// Formats come from real messages (Airtel Money Tanzania; Safaricom M-Pesa Kenya is recognised but not TSh).
// Incoming payments (customer -> vendor) will be added once real samples are available.
const { t } = require('./i18n');
const { listLines, savedMessage, fmtTsh } = require('./format');
const { parseConfirmation } = require('./ledger');

const AMT = '([\\d,]+(?:\\.\\d{1,2})?)';
const num = s => (s == null ? 0 : parseFloat(String(s).replace(/,/g, '')));
const titleCase = s => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\b[a-z]/g, c => c.toUpperCase());
const airtelTid = text => (text.match(/TID:?\s*([A-Z]{2}\d{6}\.\d{4}\.[A-Z0-9]+)/i) || [])[1] || null;
const feeOf = text => num((text.match(new RegExp(`(?:Fee|Charges)\\s*Tsh\\s*${AMT}`, 'i')) || text.match(new RegExp(`Charges\\s*${AMT}\\s*Tsh`, 'i')) || [])[1]);

// Each rule: test(text) -> details or null. First match wins.
const RULES = [
  // --- not money for the ledger ---
  { kind: 'card', re: /^\s*SUCCESS!\s*TID\s*#\d+\s+[A-Z]{3}\s+[\d,.]+.*\bcard\b/is },
  { kind: 'currency', re: /^\s*[A-Z0-9]{10}\s+Confirmed\..*\bKsh\s?[\d,]/is },              // Safaricom M-Pesa Kenya
  { kind: 'own_transfer', re: /Received\s+[\d,.]+\s*TSh\s+from\s+Agent:/i },                   // cash deposit at an agent
  { kind: 'own_transfer', re: /deposited\s+[\d,.]+\s*Tsh\s+to\s+Airtel Money Global Pay card/i },
  { kind: 'own_transfer', re: /Payment to Airtel Money Global Pay is successful/i },
  // --- money out ---
  { kind: 'merchant', parse: s => { // Lipa / till: "Paid 10,000 Tsh to VODACOM TNQR.LIPA NAME. Till 68708140, Fee Tsh 1,000.00."
      const m = s.match(new RegExp(`^\\s*Paid\\s+${AMT}\\s*Tsh\\s+to\\s+(.+?)\\.\\s*Till\\s+(\\d+)`, 'i'));
      return m && { amount: num(m[1]), name: titleCase(m[2].replace(/^.*\bLIPA\s+/i, '')), till: m[3] }; } },
  { kind: 'bundle', parse: s => { // "You have paid 1,000 TSh for YATOSHA BUNDLE."
      const m = s.match(new RegExp(`You have paid\\s+${AMT}\\s*TSh\\s+for\\s+(.+?)\\.\\s`, 'i'));
      return m && { amount: num(m[1]), name: titleCase(m[2]) }; } },
  { kind: 'merchant', parse: s => { // "You have paid 1,000.00 Tsh to TIPS TIPS."
      const m = s.match(new RegExp(`You have paid\\s+${AMT}\\s*Tsh\\s+to\\s+(.+?)\\.\\s`, 'i'));
      return m && { amount: num(m[1]), name: titleCase(m[2]) }; } },
  { kind: 'merchant', parse: s => { // "Payment to NAME is successful. Transaction Amt: 2,704 TSh"
      const m = s.match(new RegExp(`Payment to\\s+(.+?)\\s+is successful\\.\\s*Transaction Amt:\\s*${AMT}\\s*TSh`, 'i'));
      return m && { amount: num(m[2]), name: titleCase(m[1]) }; } },
  { kind: 'person', parse: s => { // "Paid 1000.00 TSh to 255769225819 NICHOLAS OTIENO. Charges Tsh 45.00"
      const m = s.match(new RegExp(`^\\s*Paid\\s+${AMT}\\s*TSh\\s+to\\s+(\\d{9,12})\\s+(.+?)\\.\\s*Charges`, 'i'));
      return m && { amount: num(m[1]), name: titleCase(m[3]) }; } },
  { kind: 'person', parse: s => { // "SENT TSh 1,000 equiv KES (FX 0.0465) to 742397883 DEBORA ODHIAMBO, 20/10/26. Fee TSh 20."
      const m = s.match(new RegExp(`^\\s*SENT\\s+TSh\\s+${AMT}.*?\\bto\\s+(\\d{6,12})\\s+(.+?),\\s*\\d{1,2}/\\d{1,2}/\\d{2,4}`, 'i'));
      return m && { amount: num(m[1]), name: titleCase(m[3]) }; } },
];

// -> null if not a mobile-money SMS; else { kind, amount?, fee, name?, ref, provider }
function parseMobileMoney(text) {
  const s = String(text || '');
  for (const r of RULES) {
    if (r.re) { if (r.re.test(s)) return { kind: r.kind }; continue; }
    const d = r.parse(s);
    if (d && d.amount > 0) return { kind: r.kind, ...d, fee: feeOf(s), ref: airtelTid(s), provider: 'Airtel Money' };
  }
  return null;
}

// Entries to record for a parsed SMS. Person transfers start as 'transfer_out' until the vendor chooses.
function entriesFor(mm) {
  const main = { type: mm.kind === 'bundle' ? 'expense' : mm.kind === 'person' ? 'transfer_out' : 'purchase',
    direction: 'debit', amount: mm.amount, item: mm.name, ref: mm.ref };
  const out = [main];
  if (mm.fee > 0) out.push({ type: mm.kind === 'person' ? 'transfer_out' : 'expense', direction: 'debit', amount: mm.fee, item: `ada ${mm.provider}`, ref: null, isFee: true });
  return out;
}

async function mobileMoneyReply(pool, vendorId, messageId, text, lang = 'sw') {
  const L = t(lang);
  const mm = parseMobileMoney(text);
  if (!mm) return null;
  if (['card', 'currency', 'own_transfer', 'loan'].includes(mm.kind)) return L.mmIgnored[mm.kind];

  const entries = entriesFor(mm);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE transactions SET deleted_at = now() WHERE vendor_id = $1 AND status = 'pending' AND deleted_at IS NULL`, [vendorId]);
    for (const e of entries) {
      await client.query(
        `INSERT INTO transactions (vendor_id, message_id, type, direction, amount_tsh, raw_input, channel, parse_confidence, status, item, external_ref)
         VALUES ($1, $2, $3, $4, $5, $6, 'mobile_money', 0.95, 'pending', $7, $8)`,
        [vendorId, messageId, e.type, e.direction, e.amount, text, e.item, e.ref]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return L.mmDuplicate(mm.ref); // unique (vendor_id, external_ref): already recorded
    throw err;
  } finally {
    client.release();
  }

  if (mm.kind === 'person') return L.mmAskKind(fmtTsh(mm.amount), mm.name, mm.fee > 0 ? fmtTsh(mm.fee) : null);
  return L.pending(listLines(entries, lang));
}

// Answer to "1 / 2 / 3" for a pending person transfer; null if there is none or the text is not an answer.
const CHOICES = { '1': 'purchase', manunuzi: 'purchase', purchase: 'purchase', '2': 'expense', matumizi: 'expense', expense: 'expense',
  '3': 'personal', binafsi: 'personal', personal: 'personal' };

async function transferChoiceReply(pool, vendorId, text, lang = 'sw') {
  const L = t(lang);
  const { rows } = await pool.query(
    `SELECT id, message_id, amount_tsh, item FROM transactions
      WHERE vendor_id = $1 AND status = 'pending' AND deleted_at IS NULL AND type = 'transfer_out'
        AND created_at > now() - interval '1 hour'
        AND message_id = (SELECT max(message_id) FROM transactions WHERE vendor_id = $1 AND status = 'pending' AND deleted_at IS NULL)
      ORDER BY id`,
    [vendorId]
  );
  if (!rows.length) return null;
  const choice = CHOICES[String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '')];
  if (!choice) return parseConfirmation(text) ? L.mmChooseAgain : null; // "ndio" -> re-ask; anything else is handled normally
  const ids = rows.map(r => r.id);
  if (choice === 'personal') {
    await pool.query(`UPDATE transactions SET deleted_at = now() WHERE id = ANY($1::bigint[])`, [ids]);
    return L.mmPersonal;
  }
  // main amount gets the chosen type; the fee is always an expense
  const { rows: saved } = await pool.query(
    `UPDATE transactions SET status = 'confirmed', type = CASE WHEN id = $2 THEN $3 ELSE 'expense' END
      WHERE id = ANY($1::bigint[]) RETURNING id, type, amount_tsh, item`,
    [ids, ids[0], choice] // ids[0] is the amount sent; any other row is its fee
  );
  saved.sort((a, b) => Number(a.id) - Number(b.id));
  return savedMessage(saved.map(r => ({ ...r, amount: r.amount_tsh })), lang);
}

module.exports = { parseMobileMoney, mobileMoneyReply, transferChoiceReply, entriesFor };
