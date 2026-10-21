// Undo ("futa") and correct ("rekebisha 6000") the vendor's most recent entry.
const { parseLedgerEntry } = require('./parser');
const { fmtTsh, capitalize, label } = require('./format');

const UNDO = new Set(['futa', 'futa ya mwisho', 'futa hiyo', 'ondoa', 'undo', 'delete']);
const CORRECT_RE = /^\s*(rekebisha|badilisha|sahihisha|correct|edit)\b(.*)$/i;

function parseCorrection(text) {
  const t = String(text || '').trim();
  const norm = t.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (UNDO.has(norm)) return { action: 'undo' };
  const m = t.match(CORRECT_RE);
  if (m) return { action: 'correct', amount: parseLedgerEntry(m[2]).amount };
  return null;
}

// The vendor's latest entry group: all live transactions from their most recent recorded message.
async function lastGroup(db, vendorId) {
  const { rows: [last] } = await db.query(
    `SELECT id, type, amount_tsh, message_id FROM transactions
      WHERE vendor_id = $1 AND deleted_at IS NULL AND status = 'confirmed'
      ORDER BY id DESC LIMIT 1`,
    [vendorId]
  );
  if (!last) return [];
  if (last.message_id === null) return [last];
  const { rows } = await db.query(
    `SELECT id, type, amount_tsh, message_id FROM transactions
      WHERE vendor_id = $1 AND message_id = $2 AND deleted_at IS NULL AND status = 'confirmed'
      ORDER BY id`,
    [vendorId, last.message_id]
  );
  return rows;
}

async function correctionReply(pool, vendorId, cmd) {
  const group = await lastGroup(pool, vendorId);
  if (!group.length) return 'Hakuna rekodi ya kubadilisha.';

  if (cmd.action === 'undo') {
    await pool.query(
      `UPDATE transactions SET deleted_at = now() WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [group.map(r => r.id)]
    );
    if (group.length === 1) return `Nimefuta ${label(group[0].type)} ${fmtTsh(group[0].amount_tsh)}.`;
    return 'Nimefuta:\n' + group.map(r => `- ${capitalize(label(r.type))} ${fmtTsh(r.amount_tsh)}`).join('\n');
  }

  // correct
  if (!cmd.amount) return 'Andika kiasi kipya, mfano: rekebisha 6000';
  if (group.length > 1) {
    return `Ujumbe wako wa mwisho ulikuwa na rekodi ${group.length}. Andika "futa" kisha utume tena kwa usahihi.`;
  }
  const [r] = group;
  await pool.query(
    `UPDATE transactions SET amount_tsh = $2, updated_at = now() WHERE id = $1`,
    [r.id, cmd.amount]
  );
  return `Nimerekebisha ${label(r.type)}: ${fmtTsh(r.amount_tsh)} → ${fmtTsh(cmd.amount)}.`;
}

module.exports = { parseCorrection, correctionReply };
