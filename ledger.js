// Record parsed entries; uncertain ones wait for NDIO/HAPANA before counting.
const { parseLedgerEntries } = require('./parser');
const { savedMessage, listLines } = require('./format');

const SAVE_MIN = 0.6;      // below this: not understood, ask to resend
const CONFIRM_BELOW = 0.8; // between SAVE_MIN and this: ask the vendor to confirm
const PENDING_TTL = '1 hour';

const YES = new Set(['ndio', 'ndiyo', 'ndio sawa', 'sawa', 'yes', 'y', 'ok', 'sahihi']);
const NO = new Set(['hapana', 'no', 'n', 'si sahihi', 'sio']);

function parseConfirmation(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return YES.has(t) ? 'yes' : NO.has(t) ? 'no' : null;
}

async function recordEntries(pool, vendorId, messageId, text) {
  const entries = parseLedgerEntries(text);
  const unclear = entries.filter(e => e.confidence < SAVE_MIN);
  if (entries.length === 0 || unclear.length) {
    const what = unclear.length && entries.length > 1 ? ` "${unclear[0].text}"` : '';
    return `Samahani, sikuelewa vizuri${what}. Ulitumia/uliuza kiasi gani, TSh ngapi?`;
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
    return `Nimeelewa hivi:\n${listLines(entries)}\nNi sahihi? Jibu NDIO au HAPANA.`;
  }
  return savedMessage(entries);
}

// Returns a reply if the text answers a pending question; null otherwise (caller continues).
async function confirmationReply(pool, vendorId, text) {
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
    return savedMessage(rows.map(r => ({ ...r, amount: r.amount_tsh })));
  }

  await pool.query(
    `UPDATE transactions SET deleted_at = now()
      WHERE vendor_id = $1 AND message_id = $2 AND status = 'pending' AND deleted_at IS NULL`,
    [vendorId, latest.message_id]
  );
  return 'Sawa, sijahifadhi. Tafadhali tuma tena kwa usahihi, mfano: nimenunua mchele 25000';
}

module.exports = { recordEntries, confirmationReply, parseConfirmation };
