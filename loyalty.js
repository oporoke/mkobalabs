// Digital receipts and loyalty points (roadmap #2).
//   risiti 0712345678 chips 5000      -> records the sale, gives the vendor a receipt to forward to the customer, adds points
//   pointi 0712345678 / pointi         -> one customer's points / top customers
//   tumia pointi 0712345678 20         -> the customer uses points (the vendor decides the reward)
// Points are worked out from live sale records, so `futa` and `rekebisha` on a receipt sale also fix its points.
const { parseLedgerEntries } = require('./parser');
const { fmtTsh, describe } = require('./format');
const { t } = require('./i18n');
const { stockNotes } = require('./stock');

const TSH_PER_POINT = 1000;
const TZ = 'Africa/Dar_es_Salaam';
const PHONE = '(?:\\+?255|0)[67]\\d{8}';
const normPhone = p => '255' + p.replace(/^\+?255|^0/, '');
const showPhone = p => '0' + String(p).slice(3);
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// -> null | { kind: 'receipt', phone, text } | { kind: 'points', phone|null } | { kind: 'redeem', phone, points } | { kind: 'help' }
function parseLoyalty(text) {
  const s = String(text || '').trim();
  let m = s.match(new RegExp(`^(?:risiti|receipt)\\s+(${PHONE})\\s+([\\s\\S]+)$`, 'i'));
  if (m) return { kind: 'receipt', phone: normPhone(m[1]), text: m[2] };
  m = s.match(new RegExp(`^(?:tumia\\s+pointi|redeem(?:\\s+points)?)\\s+(${PHONE})\\s+(\\d+)$`, 'i'));
  if (m) return { kind: 'redeem', phone: normPhone(m[1]), points: parseInt(m[2], 10) };
  m = s.match(new RegExp(`^(?:pointi|points)(?:\\s+(${PHONE}))?$`, 'i'));
  if (m) return { kind: 'points', phone: m[1] ? normPhone(m[1]) : null };
  if (/^(?:risiti|receipt|tumia pointi|redeem)\b/i.test(norm(s))) return { kind: 'help' };
  return null;
}

// Points per customer = sum over their receipts of floor(live sales on that receipt / 1000), minus points used.
const BALANCES = `
  WITH earned AS (
    SELECT r.customer_phone, SUM(floor(COALESCE(x.total, 0) / ${TSH_PER_POINT}))::int AS earned,
           SUM(COALESCE(x.total, 0)) AS spent, COUNT(*) FILTER (WHERE x.total > 0) AS visits, max(r.created_at) AS last_at
      FROM receipts r
      LEFT JOIN LATERAL (SELECT SUM(amount_tsh) AS total FROM transactions
                          WHERE vendor_id = r.vendor_id AND message_id = r.message_id AND type = 'sale'
                            AND deleted_at IS NULL AND status = 'confirmed') x ON true
     WHERE r.vendor_id = $1 AND ($2::text IS NULL OR r.customer_phone = $2)
     GROUP BY r.customer_phone
  ), used AS (
    SELECT customer_phone, SUM(points)::int AS used FROM point_redemptions
     WHERE vendor_id = $1 AND ($2::text IS NULL OR customer_phone = $2) GROUP BY customer_phone
  )
  SELECT e.customer_phone, e.earned, COALESCE(u.used, 0) AS used, e.earned - COALESCE(u.used, 0) AS balance,
         e.spent, e.visits, e.last_at
    FROM earned e LEFT JOIN used u USING (customer_phone)`;

async function balance(pool, vendorId, phone) {
  const { rows: [r] } = await pool.query(BALANCES, [vendorId, phone]);
  return r ? { ...r, balance: Number(r.balance), earned: Number(r.earned), spent: Number(r.spent), visits: Number(r.visits) }
           : { balance: 0, earned: 0, used: 0, spent: 0, visits: 0 };
}

async function vendorTitle(pool, vendorId) {
  const { rows: [v] } = await pool.query('SELECT name, business_type FROM vendors WHERE id = $1', [vendorId]);
  const name = v?.name && !/^\d+$/.test(v.name) ? v.name : null;
  return [name, v?.business_type].filter(Boolean).join(' – ') || 'Mkoba';
}

async function receiptReply(pool, vendorId, messageId, cmd, lang) {
  const L = t(lang);
  // Receipts are for sales: a line without an action word is read as a sale ("chips 5000").
  const lines = cmd.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .map(l => (/\b(?:nimeuza|niliuza|tumeuza|sold|mauzo)\b/i.test(l) ? l : `nimeuza ${l}`));
  const entries = parseLedgerEntries(lines.join('\n'));
  const bad = entries.filter(e => e.type !== 'sale' || e.amount == null || e.confidence < 0.6);
  if (!entries.length || bad.length) return L.receiptNotUnderstood;

  const client = await pool.connect();
  let number;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [vendorId]); // receipt numbers are per vendor, no gaps or repeats
    for (const e of entries) {
      await client.query(
        `INSERT INTO transactions (vendor_id, message_id, type, direction, amount_tsh, raw_input, channel, parse_confidence, status, item, quantity, unit)
         VALUES ($1, $2, 'sale', 'credit', $3, $4, 'whatsapp', $5, 'confirmed', $6, $7, $8)`,
        [vendorId, messageId, e.amount, e.text, e.confidence, e.item, e.quantity, e.unit]
      );
    }
    const { rows: [r] } = await client.query(
      `INSERT INTO receipts (vendor_id, number, customer_phone, message_id)
       VALUES ($1, (SELECT COALESCE(max(number), 0) + 1 FROM receipts WHERE vendor_id = $1), $2, $3) RETURNING number`,
      [vendorId, cmd.phone, messageId]
    );
    number = r.number;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const total = entries.reduce((s, e) => s + e.amount, 0);
  const earned = Math.floor(total / TSH_PER_POINT);
  const b = await balance(pool, vendorId, cmd.phone);
  const { rows: [{ at }] } = await pool.query(`SELECT to_char(now() AT TIME ZONE '${TZ}', 'DD/MM/YYYY HH24:MI') AS at`);
  const ref = `R-${String(number).padStart(4, '0')}`;
  const receipt = [
    L.receiptHeader(ref, await vendorTitle(pool, vendorId)),
    at,
    ...entries.map(e => `- ${describe({ ...e, type: 'sale' }, true, lang).replace(/^[^ ]+ (?:ya|of) /, '').replace(/^./, c => c.toUpperCase())} ${fmtTsh(e.amount)}`),
    L.receiptTotal(fmtTsh(total)),
    L.receiptPoints(earned, b.balance),
    L.receiptThanks,
  ].join('\n');
  const vendorMsg = L.receiptSaved(ref, fmtTsh(total), showPhone(cmd.phone), earned, b.balance)
    + await stockNotes(pool, vendorId, entries, lang);
  return [vendorMsg, receipt];
}

async function pointsReply(pool, vendorId, cmd, lang) {
  const L = t(lang);
  if (cmd.phone) {
    const b = await balance(pool, vendorId, cmd.phone);
    if (!b.visits && !b.earned) return L.pointsNone(showPhone(cmd.phone));
    return L.pointsOne(showPhone(cmd.phone), b.balance, b.visits, fmtTsh(b.spent));
  }
  const { rows } = await pool.query(`${BALANCES} ORDER BY balance DESC, spent DESC LIMIT 10`, [vendorId, null]);
  if (!rows.length) return L.pointsEmpty;
  return [L.pointsTitle, ...rows.map(r => `- ${showPhone(r.customer_phone)}: ${L.pointsLine(Number(r.balance), Number(r.visits))}`)].join('\n');
}

async function redeemReply(pool, vendorId, cmd, lang) {
  const L = t(lang);
  if (!(cmd.points > 0)) return L.redeemHelp;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [vendorId]);
    const { rows: [r] } = await client.query(BALANCES, [vendorId, cmd.phone]);
    const have = r ? Number(r.balance) : 0;
    if (cmd.points > have) { await client.query('ROLLBACK'); return L.redeemTooMany(showPhone(cmd.phone), have); }
    await client.query('INSERT INTO point_redemptions (vendor_id, customer_phone, points) VALUES ($1, $2, $3)', [vendorId, cmd.phone, cmd.points]);
    await client.query('COMMIT');
    const left = have - cmd.points;
    return [L.redeemDone(showPhone(cmd.phone), cmd.points, left), L.redeemCustomer(await vendorTitle(pool, vendorId), cmd.points, left)];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function loyaltyReply(pool, vendorId, messageId, cmd, lang = 'sw') {
  if (cmd.kind === 'receipt') return receiptReply(pool, vendorId, messageId, cmd, lang);
  if (cmd.kind === 'points') return pointsReply(pool, vendorId, cmd, lang);
  if (cmd.kind === 'redeem') return redeemReply(pool, vendorId, cmd, lang);
  return t(lang).receiptHelp;
}

module.exports = { parseLoyalty, loyaltyReply, normPhone, TSH_PER_POINT };
