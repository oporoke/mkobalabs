// Jirani Bulk Buy (roadmap #4): vendors near the same collection point buy stock together at wholesale prices.
//   Groups = collection points (admin adds them; vendors can create one: "unda kikundi Sinza Mori, Sinza").
//   Join: "jiunge Sinza" (code, name or area), or share a WhatsApp location -> nearest point within 3 km.
//   Weekly group order: "jirani mchele kilo 20" adds your share; it closes on Friday evening (run with the 21:00 reports),
//   each member gets their share and the pickup point; "jirani imefika" records the share as purchases.
//   Automation: when a vendor records a purchase of something the group buys in bulk, Mkoba suggests adding it (max once a week).
const express = require('express');
const log = require('./log');
const { parseLedgerEntry } = require('./parser');
const { fmtTsh, savedMessage } = require('./format');
const { esc, page } = require('./html');
const { stockNotes, fmtQty } = require('./stock');

const TZ = 'Africa/Dar_es_Salaam';
const RADIUS_KM = 3;
const CLOSE_DOW = 5;     // Friday (ISO day of week)
const CLOSE_TIME = '20:00';
const WINDOW_HOURS = 23;
const unitKey = u => (!u || u === 'pcs' ? '' : u);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const EXAMPLE = { kg: 'kilo 20', l: 'lita 10', g: 'gramu 500', '': '10' };

const W = {
  sw: {
    groupsTitle: '👥 Vikundi (sehemu za kuchukua mzigo):',
    groupLine: g => `${g.code} – ${g.name}${g.area && g.area.toLowerCase() !== g.name.toLowerCase() ? ` (${g.area})` : ''}: wanachama ${g.members}`,
    groupsHow: 'Kujiunga: jiunge SIN01 (au jina la eneo). Au tuma location yako nikutafutie kilicho karibu.\nKuunda: unda kikundi Jina, Eneo',
    noGroups: 'Bado hakuna vikundi. Unda: unda kikundi Sinza Mori, Sinza',
    joined: g => `Sawa! Umejiunga na kikundi ${g.name} (${g.code}). Mzigo utachukuliwa ${g.name}${g.area ? `, ${g.area}` : ''}.\nKuongeza mahitaji ya wiki hii: jirani mchele kilo 20`,
    many: (what, list) => `Vikundi kadhaa vinalingana na "${what}":\n${list}\nAndika jiunge na namba ya kikundi, mfano: jiunge ${'SIN01'}`,
    none: what => `Sikupata kikundi "${what}". Andika "vikundi" kuona vyote, au unda: unda kikundi ${cap(what)}, ${cap(what)}`,
    created: g => `Sawa! Kikundi ${g.name} (${g.code}) kimeundwa na umejiunga. Waambie wenzako: jiunge ${g.code}`,
    exists: g => `Kikundi ${g.name} (${g.code}) tayari kipo. Kujiunga: jiunge ${g.code}`,
    createHelp: 'Andika mfano: unda kikundi Sinza Mori, Sinza',
    noGroup: 'Hujajiunga na kikundi. Andika "vikundi", au tuma location yako.',
    left: g => `Sawa, umetoka kikundi ${g}.`,
    info: (g, n) => `👥 ${g.name} (${g.code})${g.area ? ` – ${g.area}` : ''}: wanachama ${n}.`,
    nearest: (g, km) => `Kikundi kilicho karibu nawe: ${g.name} (${g.code}), km ${km}. Kujiunga, andika: jiunge ${g.code}`,
    noneNear: `Hakuna kikundi ndani ya km ${RADIUS_KM}. Unda kipya: unda kikundi Jina, Eneo`,
    locSaved: 'Nimehifadhi eneo lako.',
    orderEmpty: (g, close) => `🧺 Oda ya jumla ya ${g} (inafungwa ${close}): bado haina mahitaji.\nOngeza: jirani mchele kilo 20`,
    orderTitle: (g, close) => `🧺 Oda ya jumla ya ${g} (inafungwa ${close}):`,
    groupTotal: 'Jumla ya kikundi:',
    yours: 'Yako:',
    priceEach: (p, unit) => `${fmtTsh(p)}/${unit || 'kimoja'}`,
    noPrice: 'bei itathibitishwa',
    added: list => `Sawa! Oda ya jumla: ${list}.`,
    removed: item => `Sawa, nimeondoa ${item} kwenye oda ya jumla.`,
    notInOrder: item => `${item} haipo kwenye oda yako ya jumla.`,
    addHelp: 'Andika mfano: jirani mchele kilo 20',
    closedNotice: (g, lines, total, where) => `🧺 Oda ya jumla ya ${g} imefungwa. Sehemu yako:\n${lines}${total ? `\nJumla: ${total}` : ''}\n${where}\nMzigo ukifika, andika: jirani imefika`,
    whereGroup: p => `Utachukua: ${p}`,
    whereHome: a => `Tutakuletea nyumbani: ${a}`,
    wherePlace: p => `Utachukua: ${p}`,
    deliveryNow: d => `Mzigo wako wa jumla: ${d}\nKubadilisha: pokea nyumbani <anwani>, pokea <mahali>, au pokea kikundi`,
    deliverySet: d => `Sawa! ${d}`,
    deliveryHelp: 'Andika mfano: pokea nyumbani Sinza Mori, nyumba namba 12 — au pokea Kanisa la Sinza — au pokea kikundi',
    needDelivery: 'Kwanza niambie mahali pa kupokea mzigo wako:\n• Nyumbani: pokea nyumbani Sinza Mori, nyumba namba 12\n• Mahali fulani: pokea Kanisa la Sinza\n• Sehemu ya kikundi: pokea kikundi',
    householdReceived: 'Asante! Mzigo umepokelewa.',
    nothingToReceive: 'Huna mzigo wa jumla unaosubiri.',
    received: 'Mzigo wa jumla umepokelewa.',
    noPriceReceived: items => `Hizi hazina bei, ziweke mwenyewe (mfano: nimenunua ${items[0]} kilo 20 kwa 46000): ${items.join(', ')}`,
    hintMember: (g, item, price) => `💡 Kikundi chako ${g} kinanunua ${item} jumla${price ? ` kwa ${price}` : ''}. Ongeza yako: jirani ${item} ${'kilo 20'}`,
    hintJoin: '💡 Nunua kwa bei ya jumla pamoja na wafanyabiashara wa karibu: tuma location yako, au andika "vikundi".',
  },
  en: {
    groupsTitle: '👥 Groups (collection points):',
    groupLine: g => `${g.code} – ${g.name}${g.area && g.area.toLowerCase() !== g.name.toLowerCase() ? ` (${g.area})` : ''}: ${g.members} members`,
    groupsHow: 'To join: join SIN01 (or the area name). Or share your location and I will find the nearest.\nTo create: create group Name, Area',
    noGroups: 'No groups yet. Create one: create group Sinza Mori, Sinza',
    joined: g => `Done! You joined ${g.name} (${g.code}). Goods are collected at ${g.name}${g.area ? `, ${g.area}` : ''}.\nTo add this week's needs: bulk rice kilo 20`,
    many: (what, list) => `Several groups match "${what}":\n${list}\nSend join and the group code, e.g.: join SIN01`,
    none: what => `No group "${what}". Send "groups" to see all, or create one: create group ${cap(what)}, ${cap(what)}`,
    created: g => `Done! Group ${g.name} (${g.code}) created and you joined it. Tell others: join ${g.code}`,
    exists: g => `Group ${g.name} (${g.code}) already exists. To join: join ${g.code}`,
    createHelp: 'Send e.g.: create group Sinza Mori, Sinza',
    noGroup: 'You are not in a group. Send "groups", or share your location.',
    left: g => `Done, you left ${g}.`,
    info: (g, n) => `👥 ${g.name} (${g.code})${g.area ? ` – ${g.area}` : ''}: ${n} members.`,
    nearest: (g, km) => `Nearest group: ${g.name} (${g.code}), ${km} km. To join, send: join ${g.code}`,
    noneNear: `No group within ${RADIUS_KM} km. Create one: create group Name, Area`,
    locSaved: 'I saved your location.',
    orderEmpty: (g, close) => `🧺 ${g} bulk order (closes ${close}): nothing yet.\nAdd: bulk rice kilo 20`,
    orderTitle: (g, close) => `🧺 ${g} bulk order (closes ${close}):`,
    groupTotal: 'Group total:',
    yours: 'Yours:',
    priceEach: (p, unit) => `${fmtTsh(p)}/${unit || 'each'}`,
    noPrice: 'price to be confirmed',
    added: list => `Done! Bulk order: ${list}.`,
    removed: item => `Done, removed ${item} from the bulk order.`,
    notInOrder: item => `${item} is not in your bulk order.`,
    addHelp: 'Send e.g.: bulk rice kilo 20',
    closedNotice: (g, lines, total, where) => `🧺 The ${g} bulk order is closed. Your share:\n${lines}${total ? `\nTotal: ${total}` : ''}\n${where}\nWhen the goods arrive, send: bulk received`,
    whereGroup: p => `Collect at: ${p}`,
    whereHome: a => `We deliver to your home: ${a}`,
    wherePlace: p => `Collect at: ${p}`,
    deliveryNow: d => `Your bulk goods: ${d}\nTo change: deliver home <address>, deliver to <place>, or collect group`,
    deliverySet: d => `Done! ${d}`,
    deliveryHelp: 'Send e.g.: deliver home Sinza Mori, house 12 — or deliver to Sinza Church — or collect group',
    needDelivery: 'First tell me where to receive your goods:\n• Home: deliver home Sinza Mori, house 12\n• A place: deliver to Sinza Church\n• The group point: collect group',
    householdReceived: 'Thank you! Goods received.',
    nothingToReceive: 'You have no bulk goods waiting.',
    received: 'Bulk goods received.',
    noPriceReceived: items => `These have no price, record them yourself (e.g.: bought ${items[0]} kilo 20 for 46000): ${items.join(', ')}`,
    hintMember: (g, item, price) => `💡 Your group ${g} is buying ${item} in bulk${price ? ` at ${price}` : ''}. Add yours: bulk ${item} kilo 20`,
    hintJoin: '💡 Buy at wholesale prices with vendors near you: share your location, or send "groups".',
  },
};
const w = lang => W[lang] || W.sw;

// ---------- parsing ----------
// -> null | { kind: 'groups'|'group'|'leave'|'order'|'received' } | { kind: 'join', what } | { kind: 'create', name, area }
//    | { kind: 'add', item, quantity, unit } | { kind: 'remove', item } | { kind: 'badAdd' }
function parseBulk(text) {
  const s = String(text || '').trim(), n = norm(s);
  if (['vikundi', 'groups'].includes(n)) return { kind: 'groups' };
  if (['kikundi', 'kikundi changu', 'group', 'my group'].includes(n)) return { kind: 'group' };
  if (['toka kikundi', 'leave group'].includes(n)) return { kind: 'leave' };
  if (['jirani', 'bulk'].includes(n)) return { kind: 'order' };
  if (['jirani imefika', 'bulk received', 'jirani nimepokea'].includes(n)) return { kind: 'received' };
  if (['pokea', 'delivery'].includes(n)) return { kind: 'delivery' };
  if (['pokea kikundi', 'pokea kituoni', 'collect group', 'collect at group'].includes(n)) return { kind: 'setDelivery', mode: 'point' };
  let m = s.match(/^(?:pokea\s+nyumbani|deliver\s+(?:to\s+)?home)\b[\s,:]*([\s\S]*)$/i);
  if (m) return m[1].trim() ? { kind: 'setDelivery', mode: 'home', address: m[1].trim().slice(0, 200) } : { kind: 'deliveryHelp' };
  m = s.match(/^(?:pokea|deliver\s+to)\s+([\s\S]+)$/i);
  if (m) return { kind: 'setDelivery', mode: 'place', address: m[1].trim().slice(0, 200) };
  m = s.match(/^(?:jiunge|join)\s+(?:na\s+|kikundi\s+|group\s+)?(.+)$/i);
  if (m) return { kind: 'join', what: m[1].trim() };
  m = s.match(/^(?:unda\s+kikundi|create\s+group)\s*(.*)$/i);
  if (m) {
    const [name, area] = m[1].split(',').map(x => x.trim());
    return { kind: 'create', name: name || '', area: area || name || '' };
  }
  m = s.match(/^(?:jirani|bulk)\s+(?:ondoa|remove)\s+(.+)$/i);
  if (m) return { kind: 'remove', item: norm(m[1]) };
  m = s.match(/^(?:jirani|bulk)\s+([\s\S]+)$/i);
  if (m) {
    const items = [];
    for (const part of m[1].split(/[\n,;]+/).map(x => x.trim()).filter(Boolean)) {
      const e = parseLedgerEntry(part);
      let quantity = e.quantity, unit = e.unit;
      if (quantity == null && e.amountKind === 'bare') { quantity = e.amount; unit = null; }
      if (!e.item || !(quantity > 0)) return { kind: 'badAdd' };
      items.push({ item: e.item, quantity, unit: unitKey(unit) });
    }
    return { kind: 'add', items };
  }
  return null;
}

// ---------- groups ----------
const groupById = async (pool, id) => (await pool.query('SELECT * FROM collection_points WHERE id = $1', [id])).rows[0] || null;

async function vendorGroup(pool, vendorId) {
  const { rows: [g] } = await pool.query(
    'SELECT p.* FROM vendors v JOIN collection_points p ON p.id = v.group_id WHERE v.id = $1 AND p.active', [vendorId]);
  return g || null;
}

async function newCode(pool, name) {
  const letters = (name.toUpperCase().replace(/[^A-Z]/g, '') + 'XXX').slice(0, 3);
  const { rows } = await pool.query(`SELECT code FROM collection_points WHERE code LIKE $1`, [letters + '%']);
  let i = 1;
  while (rows.some(r => r.code === letters + String(i).padStart(2, '0'))) i++;
  return letters + String(i).padStart(2, '0');
}

async function createPoint(pool, { name, area, lat = null, lng = null, createdBy = null }) {
  const { rows: [g] } = await pool.query(
    `INSERT INTO collection_points (code, name, area, lat, lng, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [await newCode(pool, name), name, area || null, lat, lng, createdBy]);
  log.info('collection_point_created', { code: g.code, by: createdBy });
  return g;
}

const km = (a, b, c, d) => { // haversine distance in km
  const r = x => (x * Math.PI) / 180, R = 6371;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

async function nearestPoint(pool, lat, lng) {
  const { rows } = await pool.query('SELECT * FROM collection_points WHERE active AND lat IS NOT NULL AND lng IS NOT NULL');
  return rows.map(g => ({ ...g, km: km(lat, lng, Number(g.lat), Number(g.lng)) })).filter(g => g.km <= RADIUS_KM)
    .sort((a, b) => a.km - b.km)[0] || null;
}

// A shared WhatsApp location: remember it and suggest the nearest collection point.
async function locationReply(pool, vendorId, lat, lng, lang = 'sw') {
  const L = w(lang);
  await pool.query('UPDATE vendors SET lat = $2, lng = $3 WHERE id = $1', [vendorId, lat, lng]);
  const g = await nearestPoint(pool, lat, lng);
  return `${L.locSaved} ${g ? L.nearest(g, g.km.toFixed(1)) : L.noneNear}`;
}

// ---------- weekly group order ----------
// The open order for a group, created on first use; closes on the coming Friday 20:00 (Tanzania time).
async function openOrder(pool, groupId, create = false) {
  const { rows: [o] } = await pool.query(
    `SELECT *, to_char(closes_at AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS closes FROM bulk_orders WHERE point_id = $1 AND status = 'open'`, [groupId]);
  if (o || !create) return o || null;
  const { rows: [n] } = await pool.query(
    `INSERT INTO bulk_orders (point_id, closes_at)
     SELECT $1, ((date_trunc('week', l) + interval '${CLOSE_DOW - 1} days' + time '${CLOSE_TIME}')
                 + CASE WHEN date_trunc('week', l) + interval '${CLOSE_DOW - 1} days' + time '${CLOSE_TIME}' <= l THEN interval '7 days' ELSE interval '0' END)
            AT TIME ZONE '${TZ}'
       FROM (SELECT now() AT TIME ZONE '${TZ}' AS l) x
     ON CONFLICT DO NOTHING
     RETURNING *, to_char(closes_at AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS closes`, [groupId]);
  return n || openOrder(pool, groupId, false);
}

const priceList = async pool => Object.fromEntries((await pool.query(
  'SELECT name_key, unit, price FROM bulk_products WHERE active')).rows.map(p => [`${p.name_key}|${p.unit}`, Number(p.price)]));

async function orderReply(pool, vendorId, g, lang) {
  const L = w(lang);
  const o = await openOrder(pool, g.id, true);
  const { rows } = await pool.query(
    `SELECT item_key, unit, min(item) AS item, SUM(quantity) AS total, COUNT(DISTINCT vendor_id) AS members,
            SUM(quantity) FILTER (WHERE vendor_id = $2) AS mine
       FROM bulk_lines WHERE bulk_order_id = $1 GROUP BY item_key, unit ORDER BY 3`, [o.id, vendorId]);
  if (!rows.length) return L.orderEmpty(g.name, o.closes);
  const prices = await priceList(pool);
  const lines = rows.map(r => {
    const p = prices[`${r.item_key}|${r.unit}`];
    return `- ${cap(r.item)}: ${fmtQty(r.total, r.unit)} (${r.members}) – ${p ? L.priceEach(p, r.unit) : L.noPrice}${r.mine ? `; ${L.yours} ${fmtQty(r.mine, r.unit)}` : ''}`;
  });
  return [L.orderTitle(g.name, o.closes), L.groupTotal, ...lines].join('\n');
}

// Where a member receives their share: the group's point (default), home, or a place they named.
function whereText(v, g, L) {
  if (v.delivery_mode === 'home' && v.delivery_address) return L.whereHome(v.delivery_address);
  if (v.delivery_mode === 'place' && v.delivery_address) return L.wherePlace(v.delivery_address);
  return L.whereGroup(g ? `${g.name}${g.area ? `, ${g.area}` : ''}` : '–');
}

// ---------- vendor replies ----------
async function bulkReply(pool, vendorId, messageId, cmd, lang = 'sw') {
  const L = w(lang);
  if (cmd.kind === 'groups') {
    const { rows } = await pool.query(
      `SELECT p.*, (SELECT count(*) FROM vendors v WHERE v.group_id = p.id) AS members FROM collection_points p
        WHERE p.active ORDER BY members DESC, p.name LIMIT 20`);
    if (!rows.length) return L.noGroups;
    return [L.groupsTitle, ...rows.map(g => '- ' + L.groupLine(g)), '', L.groupsHow].join('\n');
  }
  if (cmd.kind === 'join') {
    const what = norm(cmd.what);
    const { rows } = await pool.query(
      `SELECT p.*, (SELECT count(*) FROM vendors v WHERE v.group_id = p.id) AS members FROM collection_points p
        WHERE p.active AND (lower(p.code) = $1 OR lower(p.name) = $1 OR lower(p.area) = $1
              OR lower(p.name) LIKE '%' || $1 || '%' OR lower(p.area) LIKE '%' || $1 || '%')
        ORDER BY (lower(p.code) = $1) DESC, (lower(p.name) = $1) DESC, members DESC LIMIT 6`, [what]);
    const exact = rows.filter(g => [g.code, g.name].some(x => x.toLowerCase() === what));
    const pick = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
    if (!rows.length) return L.none(cmd.what);
    if (!pick) return L.many(cmd.what, rows.map(g => '- ' + L.groupLine(g)).join('\n'));
    await pool.query('UPDATE vendors SET group_id = $2 WHERE id = $1', [vendorId, pick.id]);
    const { rows: [k] } = await pool.query('SELECT kind, delivery_mode FROM vendors WHERE id = $1', [vendorId]);
    return k.kind === 'household' && !k.delivery_mode ? `${L.joined(pick)}\n\n${L.needDelivery}` : L.joined(pick);
  }
  if (cmd.kind === 'create') {
    if (!cmd.name || cmd.name.length > 60) return L.createHelp;
    const { rows: [ex] } = await pool.query('SELECT * FROM collection_points WHERE active AND lower(name) = lower($1)', [cmd.name]);
    if (ex) return L.exists(ex);
    const { rows: [v] } = await pool.query('SELECT lat, lng FROM vendors WHERE id = $1', [vendorId]);
    const g = await createPoint(pool, { name: cap(cmd.name), area: cap(cmd.area.slice(0, 60)), lat: v?.lat, lng: v?.lng, createdBy: vendorId });
    await pool.query('UPDATE vendors SET group_id = $2 WHERE id = $1', [vendorId, g.id]);
    return L.created(g);
  }

  const g = await vendorGroup(pool, vendorId);
  const { rows: [me] } = await pool.query('SELECT kind, delivery_mode, delivery_address FROM vendors WHERE id = $1', [vendorId]);
  if (cmd.kind === 'deliveryHelp') return L.deliveryHelp;
  if (cmd.kind === 'delivery') return L.deliveryNow(whereText(me, g, L));
  if (cmd.kind === 'setDelivery') {
    const { rows: [v] } = await pool.query(
      'UPDATE vendors SET delivery_mode = $2, delivery_address = $3 WHERE id = $1 RETURNING delivery_mode, delivery_address',
      [vendorId, cmd.mode, cmd.mode === 'point' ? null : cmd.address]);
    return L.deliverySet(whereText(v, g, L));
  }
  if (cmd.kind === 'received') return receivedReply(pool, vendorId, messageId, lang, me.kind === 'household');
  if (!g) return L.noGroup;
  if (cmd.kind === 'group') {
    const { rows: [{ n }] } = await pool.query('SELECT count(*) AS n FROM vendors WHERE group_id = $1', [g.id]);
    return `${L.info(g, n)}\n\n${await orderReply(pool, vendorId, g, lang)}`;
  }
  if (cmd.kind === 'leave') {
    await pool.query('UPDATE vendors SET group_id = NULL WHERE id = $1', [vendorId]);
    const o = await openOrder(pool, g.id);
    if (o) await pool.query('DELETE FROM bulk_lines WHERE bulk_order_id = $1 AND vendor_id = $2', [o.id, vendorId]);
    return L.left(g.name);
  }
  if (cmd.kind === 'order') return orderReply(pool, vendorId, g, lang);
  if (cmd.kind === 'badAdd') return L.addHelp;
  if (cmd.kind === 'add') {
    // Each household says where it receives its goods (home or a place) before ordering.
    if (me.kind === 'household' && !me.delivery_mode) return L.needDelivery;
    const o = await openOrder(pool, g.id, true);
    for (const it of cmd.items) {
      await pool.query(
        `INSERT INTO bulk_lines (bulk_order_id, vendor_id, item_key, item, unit, quantity) VALUES ($1, $2, lower($3), $3, $4, $5)
         ON CONFLICT (bulk_order_id, vendor_id, item_key, unit) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [o.id, vendorId, it.item, it.unit, it.quantity]);
    }
    return `${L.added(cmd.items.map(it => `${it.item} ${fmtQty(it.quantity, it.unit)}`).join(', '))}\n\n${await orderReply(pool, vendorId, g, lang)}`;
  }
  if (cmd.kind === 'remove') {
    const o = await openOrder(pool, g.id);
    const { rowCount } = o ? await pool.query('DELETE FROM bulk_lines WHERE bulk_order_id = $1 AND vendor_id = $2 AND item_key = $3',
      [o.id, vendorId, cmd.item]) : { rowCount: 0 };
    return rowCount ? L.removed(cmd.item) : L.notInOrder(cmd.item);
  }
  return null;
}

// "jirani imefika": record the vendor's share of closed orders as purchases (at the closing price).
async function receivedReply(pool, vendorId, messageId, lang, household = false) {
  const L = w(lang);
  const { rows } = await pool.query(
    `SELECT l.id, l.item, l.unit, l.quantity, l.price FROM bulk_lines l JOIN bulk_orders o ON o.id = l.bulk_order_id
      WHERE l.vendor_id = $1 AND o.status = 'closed' AND l.received_at IS NULL ORDER BY l.id`, [vendorId]);
  if (!rows.length) return L.nothingToReceive;
  if (household) { // households keep no business records: just mark it received
    await pool.query('UPDATE bulk_lines SET received_at = now() WHERE id = ANY($1::bigint[])', [rows.map(r => r.id)]);
    return L.householdReceived;
  }
  const priced = rows.filter(r => r.price != null), unpriced = rows.filter(r => r.price == null);
  const entries = priced.map(r => ({ type: 'purchase', item: r.item, quantity: Number(r.quantity), unit: r.unit || null,
    amount: Math.round(Number(r.price) * Number(r.quantity)) }));
  for (const e of entries) {
    await pool.query(
      `INSERT INTO transactions (vendor_id, message_id, type, direction, amount_tsh, raw_input, channel, parse_confidence, status, item, quantity, unit)
       VALUES ($1, $2, 'purchase', 'debit', $3, 'jirani imefika', 'bulk', 1, 'confirmed', $4, $5, $6)`,
      [vendorId, messageId, e.amount, e.item, e.quantity, e.unit]);
  }
  await pool.query('UPDATE bulk_lines SET received_at = now() WHERE id = ANY($1::bigint[])', [rows.map(r => r.id)]);
  const out = [entries.length ? savedMessage(entries, lang) + await stockNotes(pool, vendorId, entries, lang) : L.received];
  if (unpriced.length) out.push(L.noPriceReceived(unpriced.map(r => r.item)));
  return out.join('\n\n');
}

// ---------- automation: purchase hints ----------
// After purchases are saved: suggest the group's bulk order (or joining a group). At most once a week per vendor.
async function bulkNotes(pool, vendorId, entries, lang = 'sw') {
  const bought = entries.filter(e => e.type === 'purchase' && e.item);
  if (!bought.length) return '';
  const { rows: [v] } = await pool.query(
    `SELECT group_id, (bulk_hint_at IS NULL OR bulk_hint_at < now() - interval '7 days') AS may FROM vendors WHERE id = $1`, [vendorId]);
  if (!v?.may) return '';
  const L = w(lang);
  let note = null;
  if (v.group_id) {
    const g = await groupById(pool, v.group_id);
    const o = await openOrder(pool, g.id);
    const prices = await pool.query('SELECT name_key, unit, price FROM bulk_products WHERE active');
    for (const e of bought) {
      const key = e.item.toLowerCase();
      const p = prices.rows.find(x => x.name_key === key);
      const others = o ? (await pool.query(
        'SELECT 1 FROM bulk_lines WHERE bulk_order_id = $1 AND item_key = $2 AND vendor_id <> $3 LIMIT 1', [o.id, key, vendorId])).rowCount : 0;
      if (p || others) { note = L.hintMember(g.name, e.item, p ? L.priceEach(Number(p.price), p.unit) : null); break; }
    }
  } else {
    const { rows: [any] } = await pool.query('SELECT EXISTS (SELECT 1 FROM collection_points WHERE active) AS yes');
    if (any.yes) note = L.hintJoin;
  }
  if (!note) return '';
  await pool.query('UPDATE vendors SET bulk_hint_at = now() WHERE id = $1', [vendorId]);
  return '\n\n' + note;
}

// ---------- closing (run by the 21:00 timer) and notices ----------
async function closeDueOrders(pool, wa) {
  const { rows: due } = await pool.query(
    `UPDATE bulk_orders SET status = 'closed', closed_at = now() WHERE status = 'open' AND closes_at <= now() RETURNING *`);
  const prices = await priceList(pool);
  let notified = 0;
  for (const o of due) {
    const g = await groupById(pool, o.point_id);
    const { rows: lines } = await pool.query('SELECT * FROM bulk_lines WHERE bulk_order_id = $1 ORDER BY vendor_id, id', [o.id]);
    for (const l of lines) {
      const p = prices[`${l.item_key}|${l.unit}`];
      if (p != null) { l.price = p; await pool.query('UPDATE bulk_lines SET price = $2 WHERE id = $1', [l.id, p]); }
    }
    const byVendor = new Map();
    for (const l of lines) byVendor.set(l.vendor_id, [...(byVendor.get(l.vendor_id) || []), l]);
    for (const [vendorId, mine] of byVendor) {
      const { rows: [v] } = await pool.query('SELECT phone_number, language, delivery_mode, delivery_address FROM vendors WHERE id = $1', [vendorId]);
      const L = w(v.language);
      const text = L.closedNotice(g.name,
        mine.map(l => `- ${cap(l.item)} ${fmtQty(l.quantity, l.unit)}${l.price != null ? ` × ${fmtTsh(l.price)} = ${fmtTsh(Math.round(l.price * l.quantity))}` : ` – ${L.noPrice}`}`).join('\n'),
        mine.every(l => l.price != null) ? fmtTsh(mine.reduce((s, l) => s + Math.round(l.price * l.quantity), 0)) : null,
        whereText(v, g, L));
      await notify(pool, wa, vendorId, v.phone_number, text) && notified++;
    }
    log.info('bulk_order_closed', { point: g.code, lines: lines.length, vendors: byVendor.size });
  }
  return { closed: due.length, notified };
}

// Send now if WhatsApp allows (the vendor wrote in the last 23 hours); otherwise keep it for their next message.
async function notify(pool, wa, vendorId, phone, text) {
  const { rows: [r] } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM messages_log WHERE phone_number = $1 AND direction = 'inbound'
                     AND created_at > now() - interval '${WINDOW_HOURS} hours') AS ok`, [phone]);
  if (r.ok && (await wa.sendText(phone, text)).ok) return true;
  await pool.query('INSERT INTO vendor_notices (vendor_id, body) VALUES ($1, $2)', [vendorId, text]);
  return false;
}

async function takeNotices(pool, vendorId) {
  const { rows } = await pool.query(
    `UPDATE vendor_notices SET delivered_at = now() WHERE vendor_id = $1 AND delivered_at IS NULL RETURNING id, body`, [vendorId]);
  return rows.sort((a, b) => a.id - b.id).map(r => r.body);
}

// ---------- admin page: /admin/bulk ----------
const adminRouter = express.Router();
adminRouter.use(express.urlencoded({ extended: false, limit: '4kb' }));
// Basic-auth credentials are sent automatically by the browser, so form posts must come from this site (CSRF).
adminRouter.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const from = req.get('origin') || req.get('referer') || '';
  try { if (new URL(from).host === req.get('host')) return next(); } catch { /* no or bad header */ }
  res.status(403).send('Forbidden');
});

const input = (name, label, attrs = '') => `<label>${label}<br><input name="${name}" ${attrs} style="font:inherit;padding:6px;width:100%"></label>`;

adminRouter.get('/', async (req, res, next) => {
  try {
    const pool = require('./db');
    const { rows: points } = await pool.query(
      `SELECT p.*, (SELECT count(*) FROM vendors v WHERE v.group_id = p.id) AS members, c.name AS creator
         FROM collection_points p LEFT JOIN vendors c ON c.id = p.created_by ORDER BY p.active DESC, p.name`);
    const { rows: products } = await pool.query('SELECT * FROM bulk_products ORDER BY active DESC, name');
    const { rows: orders } = await pool.query(
      `SELECT o.*, p.code, p.name AS point, to_char(o.closes_at AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS closes
         FROM bulk_orders o JOIN collection_points p ON p.id = o.point_id
        WHERE o.status = 'open' OR o.closed_at > now() - interval '14 days' ORDER BY o.status DESC, o.closes_at DESC`);
    const prices = await priceList(pool);
    const orderHtml = [];
    for (const o of orders) {
      const { rows: tot } = await pool.query(
        `SELECT item_key, unit, min(item) AS item, SUM(quantity) AS q, COUNT(DISTINCT vendor_id) AS n, max(price) AS price
           FROM bulk_lines WHERE bulk_order_id = $1 GROUP BY item_key, unit ORDER BY 3`, [o.id]);
      const { rows: per } = await pool.query(
        `SELECT v.name, v.phone_number, v.kind, v.delivery_mode, v.delivery_address, l.item, l.unit, l.quantity, l.received_at IS NOT NULL AS got
           FROM bulk_lines l JOIN vendors v ON v.id = l.vendor_id WHERE l.bulk_order_id = $1 ORDER BY v.name, l.item`, [o.id]);
      const price = t => (t.price != null ? Number(t.price) : prices[`${t.item_key}|${t.unit}`]);
      orderHtml.push(`<h3>${esc(o.point)} (${esc(o.code)}) – ${esc(o.status)}, closes ${esc(o.closes)}</h3>
        ${tot.length ? `<div class="scroll"><table><thead><tr><th>Item</th><th class="r">Quantity</th><th class="r">Vendors</th><th class="r">Price</th><th class="r">Value</th></tr></thead>
        <tbody>${tot.map(t => `<tr><td>${esc(cap(t.item))}</td><td class="r num">${esc(fmtQty(t.q, t.unit))}</td><td class="r num">${esc(t.n)}</td>
          <td class="r num">${price(t) != null ? esc(fmtTsh(price(t))) : '–'}</td><td class="r num">${price(t) != null ? esc(fmtTsh(Math.round(price(t) * t.q))) : '–'}</td></tr>`).join('')}</tbody></table></div>
        <details><summary>Per vendor</summary><table><tbody>${per.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${esc(p.phone_number)}</td>
          <td>${p.kind === 'household' ? 'household' : 'vendor'}</td>
          <td>${esc(p.item)}</td><td class="r num">${esc(fmtQty(p.quantity, p.unit))}</td>
          <td>${esc(p.delivery_mode === 'home' ? `Home: ${p.delivery_address}` : p.delivery_mode === 'place' ? `At: ${p.delivery_address}` : 'Group point')}</td>
          <td>${p.got ? 'received' : ''}</td></tr>`).join('')}</tbody></table></details>`
        : '<p class="note">No lines yet.</p>'}`);
    }
    res.send(page('Mkoba bulk buy', `
      <p><a href="/admin">← Admin</a></p><h1>Jirani Bulk Buy</h1>
      <h2>Group orders</h2>${orderHtml.join('') || '<p class="note">No group orders in the last 14 days.</p>'}
      <p class="note">Open orders close automatically on Friday 20:00 (Tanzania time) with the 21:00 evening run; members get their share.</p>

      <h2>Collection points (groups)</h2>
      <div class="scroll"><table><thead><tr><th>Code</th><th>Name</th><th>Area</th><th>Map</th><th class="r">Members</th><th>Created by</th><th></th></tr></thead>
      <tbody>${points.map(p => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td><td>${esc(p.area || '')}</td>
        <td class="num">${p.lat != null ? `${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}` : '–'}</td><td class="r num">${esc(p.members)}</td>
        <td>${esc(p.creator || 'admin')}</td>
        <td><form method="post" action="/admin/bulk/point/${p.id}/${p.active ? 'off' : 'on'}"><button class="link-btn">${p.active ? 'Deactivate' : 'Activate'}</button></form></td></tr>`).join('')
        || '<tr><td colspan="7">None yet.</td></tr>'}</tbody></table></div>
      <form method="post" action="/admin/bulk/point" class="card" style="margin-top:12px;display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))">
        ${input('name', 'Name', 'required maxlength="60"')}${input('area', 'Area', 'maxlength="60"')}
        ${input('lat', 'Latitude (optional)', 'inputmode="decimal" placeholder="-6.7735"')}${input('lng', 'Longitude (optional)', 'inputmode="decimal" placeholder="39.2192"')}
        <button class="btn" type="submit">Add collection point</button></form>
      <p class="note">With a map position, vendors who share their WhatsApp location within ${RADIUS_KM} km are pointed to it.</p>

      <h2>Wholesale products</h2>
      <div class="scroll"><table><thead><tr><th>Product</th><th>Unit</th><th class="r">Price</th><th></th></tr></thead>
      <tbody>${products.map(p => `<tr><td>${esc(cap(p.name))}</td><td>${esc(p.unit || 'each')}</td><td class="r num">${esc(fmtTsh(p.price))}</td>
        <td><form method="post" action="/admin/bulk/product/${p.id}/${p.active ? 'off' : 'on'}"><button class="link-btn">${p.active ? 'Remove' : 'Restore'}</button></form></td></tr>`).join('')
        || '<tr><td colspan="4">None yet.</td></tr>'}</tbody></table></div>
      <form method="post" action="/admin/bulk/product" class="card" style="margin-top:12px;display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))">
        ${input('name', 'Product (as vendors write it, e.g. mchele)', 'required maxlength="60"')}
        <label>Unit<br><select name="unit" style="font:inherit;padding:6px;width:100%"><option value="kg">kg</option><option value="l">litre</option><option value="g">gram</option><option value="">each</option></select></label>
        ${input('price', 'Wholesale price per unit (TSh)', 'required inputmode="numeric"')}
        <button class="btn" type="submit">Save product</button></form>
      <p class="note">Saving an existing product and unit updates its price. Prices are fixed on each order when it closes.</p>`, { wide: true }));
  } catch (err) { next(err); }
});

adminRouter.post('/point', async (req, res, next) => {
  try {
    const pool = require('./db');
    const name = String(req.body.name || '').trim().slice(0, 60);
    const lat = parseFloat(req.body.lat), lng = parseFloat(req.body.lng);
    const ok = (x, lim) => Number.isFinite(x) && Math.abs(x) <= lim;
    if (name) await createPoint(pool, { name, area: String(req.body.area || '').trim().slice(0, 60) || null,
      lat: ok(lat, 90) && ok(lng, 180) ? lat : null, lng: ok(lat, 90) && ok(lng, 180) ? lng : null });
    res.redirect(303, '/admin/bulk');
  } catch (err) { next(err); }
});
adminRouter.post('/point/:id/:state', async (req, res, next) => {
  try {
    if (!['on', 'off'].includes(req.params.state) || !/^\d+$/.test(req.params.id)) return res.sendStatus(404);
    await require('./db').query('UPDATE collection_points SET active = $2 WHERE id = $1', [req.params.id, req.params.state === 'on']);
    res.redirect(303, '/admin/bulk');
  } catch (err) { next(err); }
});
adminRouter.post('/product', async (req, res, next) => {
  try {
    const name = norm(req.body.name).slice(0, 60);
    const unit = ['kg', 'l', 'g', ''].includes(req.body.unit) ? req.body.unit : '';
    const price = parseFloat(String(req.body.price || '').replace(/,/g, ''));
    if (name && price > 0) {
      await require('./db').query(
        `INSERT INTO bulk_products (name, name_key, unit, price) VALUES ($1, $1, $2, $3)
         ON CONFLICT (name_key, unit) DO UPDATE SET price = EXCLUDED.price, active = true, updated_at = now()`, [name, unit, price]);
    }
    res.redirect(303, '/admin/bulk');
  } catch (err) { next(err); }
});
adminRouter.post('/product/:id/:state', async (req, res, next) => {
  try {
    if (!['on', 'off'].includes(req.params.state) || !/^\d+$/.test(req.params.id)) return res.sendStatus(404);
    await require('./db').query('UPDATE bulk_products SET active = $2, updated_at = now() WHERE id = $1', [req.params.id, req.params.state === 'on']);
    res.redirect(303, '/admin/bulk');
  } catch (err) { next(err); }
});

module.exports = { whereText, parseBulk, bulkReply, bulkNotes, locationReply, closeDueOrders, takeNotices, adminRouter, km };
