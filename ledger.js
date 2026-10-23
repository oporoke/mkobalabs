// Record parsed entries; uncertain ones wait for NDIO/HAPANA before counting.
const { parseLedgerEntries } = require('./parser');
const { savedMessage, listLines, fmtTsh } = require('./format');
const { logFeedback } = require('./feedback');
const { t } = require('./i18n');
const { stockNotes } = require('./stock');
const { bulkNotes } = require('./bulk');

const SAVE_MIN = 0.6;      // below this: not understood, ask to resend
const CONFIRM_BELOW = 0.8; // between SAVE_MIN and this: ask the vendor to confirm
const PENDING_TTL = '1 hour';

const YES = new Set(['ndio', 'ndiyo', 'ndio sawa', 'sawa', 'yes', 'y', 'ok', 'sahihi']);
const NO = new Set(['hapana', 'no', 'n', 'si sahihi', 'sio']);

function parseConfirmation(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return YES.has(t) ? 'yes' : NO.has(t) ? 'no' : null;
}

// Price memory: a small bare number after a known item is a quantity, not TSh ("nimeuza soda 10" -> 10 x last soda price).
const MAX_BARE_QUANTITY = 100; // nothing sells for under TSh 100, so a bare number below this is a count

async function lastUnitPrice(pool, vendorId, type, item) {
  const { rows: [r] } = await pool.query(
    `SELECT round(amount_tsh / quantity, 2) AS price FROM transactions
      WHERE vendor_id = $1 AND type = $2 AND lower(item) = lower($3) AND quantity > 0
        AND status = 'confirmed' AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [vendorId, type, item]
  );
  return r ? Number(r.price) : null;
}

async function applyPriceMemory(pool, vendorId, entries) {
  for (const e of entries) {
    if (!e.item || !['sale', 'purchase'].includes(e.type)) continue;
    const bareCount = e.amountKind === 'bare' && e.quantity == null && Number.isInteger(e.amount) && e.amount > 0 && e.amount < MAX_BARE_QUANTITY;
    const qtyNoAmount = e.amount === null && e.quantity > 0;
    if (!bareCount && !qtyNoAmount) continue;
    const price = await lastUnitPrice(pool, vendorId, e.type, e.item);
    if (!price) {
      if (bareCount) { e.askPrice = true; e.confidence = 0.3; } // "nimeuza maandazi 5": 5 pieces, not TSh 5
      continue;
    }
    if (bareCount) e.quantity = e.amount;
    e.amount = Math.round(e.quantity * price);
    e.unitPrice = price;
    e.confidence = 0.7; // always ask before saving a calculated amount
  }
  return entries;
}

async function recordEntries(pool, vendorId, messageId, text, lang = 'sw') {
  const entries = await applyPriceMemory(pool, vendorId, parseLedgerEntries(text));
  const unclear = entries.filter(e => e.confidence < SAVE_MIN);
  const askPrice = entries.find(e => e.askPrice);
  if (askPrice) return t(lang).askPrice(askPrice.item, askPrice.amount, askPrice.type);
  if (entries.length === 0 || unclear.length) {
    await logFeedback(pool, { vendorId, messageId, text, reason: 'not_understood',
      detail: entries.map(e => ({ text: e.text, type: e.type, amount: e.amount, confidence: e.confidence })) });
    const what = unclear.length && entries.length > 1 ? ` "${unclear[0].text}"` : '';
    return t(lang).notUnderstood(what);
  }

  const status = entries.some(e => e.confidence < CONFIRM_BELOW) ? 'pending' : 'confirmed';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A new entry replaces any earlier unanswered question.
    await client.query(
      `UPDATE transactions SET deleted_at = now()
        WHERE vendor_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
      [vendorId]
    );
    for (const e of entries) {
      await client.query(
        `INSERT INTO transactions (vendor_id, message_id, type, direction, amount_tsh, raw_input, channel, parse_confidence, status, item, quantity, unit)
         VALUES ($1, $2, $3, $4, $5, $6, 'whatsapp', $7, $8, $9, $10, $11)`,
        [vendorId, messageId, e.type, e.direction, e.amount, e.text, e.confidence, status, e.item, e.quantity, e.unit]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (status === 'pending') {
    const priced = entries.filter(e => e.unitPrice);
    const hint = priced.length ? '\n' + priced.map(e => t(lang).priceHint(e.item, fmtTsh(e.unitPrice))).join('\n') : '';
    return t(lang).pending(listLines(entries, lang) + hint);
  }
  return savedMessage(entries, lang) + await stockNotes(pool, vendorId, entries, lang) + await bulkNotes(pool, vendorId, entries, lang);
}

// Returns a reply if the text answers a pending question; null otherwise (caller continues).
async function confirmationReply(pool, vendorId, text, lang = 'sw') {
  const answer = parseConfirmation(text);
  if (!answer) return null;

  const { rows: [latest] } = await pool.query(
    `SELECT message_id FROM transactions
      WHERE vendor_id = $1 AND status = 'pending' AND deleted_at IS NULL
        AND created_at > now() - interval '${PENDING_TTL}'
      ORDER BY id DESC LIMIT 1`,
    [vendorId]
  );
  if (!latest) return null;

  if (answer === 'yes') {
    const { rows } = await pool.query(
      `UPDATE transactions SET status = 'confirmed', updated_at = now()
        WHERE vendor_id = $1 AND message_id = $2 AND status = 'pending' AND deleted_at IS NULL
        RETURNING type, amount_tsh, item, quantity, unit`,
      [vendorId, latest.message_id]
    );
    return savedMessage(rows.map(r => ({ ...r, amount: r.amount_tsh })), lang) + await stockNotes(pool, vendorId, rows, lang) + await bulkNotes(pool, vendorId, rows, lang);
  }

  const { rows: rejected } = await pool.query(
    `UPDATE transactions SET deleted_at = now()
      WHERE vendor_id = $1 AND message_id = $2 AND status = 'pending' AND deleted_at IS NULL
      RETURNING raw_input, type, amount_tsh`,
    [vendorId, latest.message_id]
  );
  await logFeedback(pool, { vendorId, messageId: latest.message_id, text: rejected.map(r => r.raw_input).join('\n'),
    reason: 'rejected', detail: rejected.map(r => ({ type: r.type, amount: Number(r.amount_tsh) })) });
  return t(lang).rejected;
}

module.exports = { recordEntries, confirmationReply, parseConfirmation };
