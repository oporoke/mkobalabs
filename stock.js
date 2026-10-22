// Stock (stoo): quantities come from the vendor's own records (purchases add, sales take away)
// plus counts the vendor enters ("stoo mchele kilo 20"). Low-stock alerts: the vendor's own level
// ("stoo mchele chini ya 5"), else automatic: about 2 days of recent sales.
const { parseLedgerEntry } = require('./parser');
const { t } = require('./i18n');

const AUTO_DAYS = 2;          // automatic alert: stock left covers about this many days of sales
const MIN_SALES_FOR_AUTO = 3; // sales records with a quantity in the last 14 days before automatic alerts start

const unitKey = u => (!u || u === 'pcs' ? '' : u);
const fmtQty = (n, unit) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 })}${unit ? ' ' + unit : ''}`;
const EXAMPLE = { kg: 'kilo 20', l: 'lita 5', g: 'gramu 500', '': '20' };
const example = (item, unit) => `stoo ${item} ${EXAMPLE[unit] || '20'}`;

// --- parsing ---
const PREFIX = /^\s*(?:stoo|stoki|stock)\b(.*)$/is;
const ALERT = /^(.+?)\s+(?:chini\s+ya|below)\s+(auto|otomatiki|\d+(?:\.\d+)?)\s*$/i;

// -> null | { kind: 'list' } | { kind: 'alert', item, level } | { kind: 'count', items: [{ item, quantity, unit }], bad: [text] }
function parseStock(text) {
  const m = String(text || '').match(PREFIX);
  if (!m) return null;
  const rest = m[1].trim();
  if (!rest) return { kind: 'list' };

  const a = rest.match(ALERT);
  if (a) {
    const item = parseLedgerEntry(a[1]).item;
    if (!item) return { kind: 'count', items: [], bad: [rest] };
    const level = /^\d/.test(a[2]) ? parseFloat(a[2]) : null; // null = automatic
    return { kind: 'alert', item, level };
  }

  const items = [], bad = [];
  for (const part of rest.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)) {
    const e = parseLedgerEntry(part);
    let quantity = e.quantity, unit = e.unit;
    if (quantity == null && e.amountKind === 'bare') { quantity = e.amount; unit = null; }
    if (!e.item || quantity == null || quantity < 0 || (e.amountKind === 'money' && e.quantity == null)) bad.push(part);
    else items.push({ item: e.item, quantity, unit: unitKey(unit) });
  }
  return { kind: 'count', items, bad };
}

// --- reading stock ---
// One row per (item, unit) the vendor has counted or recorded with a quantity.
async function stockRows(pool, vendorId, itemKey = null) {
  const { rows } = await pool.query(
    `WITH tx AS (
       SELECT id, type, quantity, created_at, item, lower(item) AS item_key,
              CASE WHEN unit IS NULL OR unit = 'pcs' THEN '' ELSE unit END AS unit
         FROM transactions
        WHERE vendor_id = $1 AND deleted_at IS NULL AND status = 'confirmed'
          AND type IN ('sale', 'purchase') AND item IS NOT NULL AND quantity > 0
     ), keys AS (
       SELECT item_key, unit FROM tx UNION SELECT item_key, unit FROM stock_items WHERE vendor_id = $1
     )
     SELECT k.item_key, k.unit,
            COALESCE(s.item, (SELECT min(item) FROM tx x WHERE x.item_key = k.item_key)) AS item,
            s.counted_qty, s.alert_below, (s.vendor_id IS NOT NULL) AS has_row,
            COALESCE(s.counted_qty, 0) + COALESCE(SUM(CASE WHEN tx.type = 'purchase' THEN tx.quantity ELSE -tx.quantity END)
              FILTER (WHERE s.counted_at IS NULL OR tx.created_at > s.counted_at), 0) AS qty,
            COALESCE(SUM(tx.quantity) FILTER (WHERE tx.type = 'sale' AND tx.created_at > now() - interval '14 days'), 0) AS sold_14d,
            COUNT(tx.id) FILTER (WHERE tx.type = 'sale' AND tx.created_at > now() - interval '14 days') AS sales_14d,
            COUNT(tx.id) FILTER (WHERE tx.type = 'purchase') AS purchases
       FROM keys k
       LEFT JOIN stock_items s ON s.vendor_id = $1 AND s.item_key = k.item_key AND s.unit = k.unit
       LEFT JOIN tx ON tx.item_key = k.item_key AND tx.unit = k.unit
      WHERE $2::text IS NULL OR k.item_key = $2
      GROUP BY k.item_key, k.unit, s.vendor_id, s.item, s.counted_qty, s.counted_at, s.alert_below
      ORDER BY 3, 2`,
    [vendorId, itemKey]
  );
  return rows.map(r => {
    const qty = Number(r.qty);
    // Known = the vendor counted it, or bought it with a quantity; otherwise only sales are known.
    const known = r.counted_qty != null || Number(r.purchases) > 0;
    const rate = Number(r.sales_14d) >= MIN_SALES_FOR_AUTO ? Number(r.sold_14d) / 14 : null; // per day
    const threshold = r.alert_below != null ? Number(r.alert_below) : rate ? rate * AUTO_DAYS : null;
    return { item: r.item, itemKey: r.item_key, unit: r.unit, hasRow: r.has_row, known, qty, rate,
      alertBelow: r.alert_below == null ? null : Number(r.alert_below), threshold,
      low: known && qty >= 0 && threshold != null && qty <= threshold,
      daysLeft: known && rate && qty > 0 ? Math.floor(qty / rate) : null };
  });
}

const lowItems = async (pool, vendorId) => (await stockRows(pool, vendorId)).filter(r => r.low);

function listReply(rows, lang = 'sw') {
  const L = t(lang);
  if (!rows.length) return L.stockEmpty;
  const lines = rows.map(r => {
    if (!r.known || r.qty < 0) return `- ${r.item}: ? ${L.stockUnknown(example(r.item, r.unit))}`;
    const days = r.daysLeft != null ? ` ${L.stockDaysLeft(r.daysLeft)}` : '';
    return `- ${r.item}: ${fmtQty(r.qty, r.unit)}${r.low ? ' ⚠️' : ''}${days}`;
  });
  return [L.stockTitle, ...lines, ...(rows.some(r => r.low) ? [L.stockLegend] : [])].join('\n');
}

// --- vendor commands ---
async function stockReply(pool, vendorId, cmd, lang = 'sw') {
  const L = t(lang);
  if (cmd.kind === 'list') return listReply(await stockRows(pool, vendorId), lang);

  if (cmd.kind === 'alert') {
    const key = cmd.item.toLowerCase();
    // Apply to every unit the item is kept in; if it has none yet, use the unit of its latest record.
    let units = (await stockRows(pool, vendorId, key)).map(r => r.unit);
    if (!units.length) units = [''];
    for (const unit of units) {
      await pool.query(
        `INSERT INTO stock_items (vendor_id, item_key, unit, item, alert_below) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (vendor_id, item_key, unit) DO UPDATE SET alert_below = EXCLUDED.alert_below, updated_at = now()`,
        [vendorId, key, unit, cmd.item, cmd.level]
      );
    }
    return cmd.level == null ? L.stockAlertAuto(cmd.item) : L.stockAlertSet(cmd.item, fmtQty(cmd.level, units.length === 1 ? units[0] : ''));
  }

  // counts
  if (!cmd.items.length) return L.stockNotUnderstood;
  for (const s of cmd.items) {
    await pool.query(
      `INSERT INTO stock_items (vendor_id, item_key, unit, item, counted_qty, counted_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (vendor_id, item_key, unit) DO UPDATE SET counted_qty = EXCLUDED.counted_qty, counted_at = now(), item = EXCLUDED.item, updated_at = now()`,
      [vendorId, s.item.toLowerCase(), s.unit, s.item, s.quantity]
    );
  }
  const lines = cmd.items.map(s => `- ${s.item}: ${fmtQty(s.quantity, s.unit)}`).join('\n');
  const bad = cmd.bad.length ? `\n${L.stockSkipped(cmd.bad.map(b => `"${b}"`).join(', '))}` : '';
  return L.stockSet(lines) + bad;
}

// --- after records are saved: low-stock alerts and a one-time hint to enter current stock ---
// entries: confirmed [{ type, item, quantity, unit }]. Returns text to append ('' if nothing).
async function stockNotes(pool, vendorId, entries, lang = 'sw') {
  const L = t(lang);
  const moved = new Map(); // "item|unit" -> { item, unit, sold }
  for (const e of entries) {
    if (!['sale', 'purchase'].includes(e.type) || !e.item || !(Number(e.quantity) > 0)) continue;
    const k = `${e.item.toLowerCase()}|${unitKey(e.unit)}`;
    const m = moved.get(k) || { item: e.item, unit: unitKey(e.unit), sold: 0 };
    if (e.type === 'sale') m.sold += Number(e.quantity);
    moved.set(k, m);
  }
  const notes = [];
  for (const m of moved.values()) {
    const [r] = (await stockRows(pool, vendorId, m.item.toLowerCase())).filter(x => x.unit === m.unit);
    if (!r) continue;
    if (!r.hasRow) {
      // First time this item moves with a quantity: invite the vendor to enter what is on the shelf now. Once only.
      await pool.query(
        `INSERT INTO stock_items (vendor_id, item_key, unit, item) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [vendorId, r.itemKey, r.unit, r.item]
      );
      notes.push(L.stockHint(r.item, example(r.item, r.unit)));
      continue;
    }
    if (!m.sold || !r.known) continue;
    const before = r.qty + m.sold;
    if (before > 0 && r.qty <= 0) notes.push(L.stockFinished(r.item));
    else if (r.threshold != null && before > r.threshold && r.qty <= r.threshold) notes.push(L.stockLow(r.item, fmtQty(r.qty, r.unit)));
  }
  return notes.length ? '\n\n' + notes.join('\n') : '';
}

module.exports = { parseStock, stockReply, stockNotes, stockRows, lowItems, listReply, fmtQty };
