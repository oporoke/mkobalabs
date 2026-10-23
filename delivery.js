// Boda delivery (roadmap #8): riders on WhatsApp take delivery jobs; the fee is worked out from distance.
//   Jobs come from (a) customer orders with delivery, when the vendor accepts them, and (b) household bulk shares
//   for home or a named place, when the admin marks a group's goods as arrived at the collection point.
//   Riders: the admin adds them, or they apply by sending "boda" (admin approves). Commands: kazi, chukua 12,
//   nimechukua 12, nimefikisha 12, acha 12, zima / washa (available), and sharing a WhatsApp location.
//   Fee = base + per km × straight-line km × road factor, rounded up, with a minimum (all editable on /admin/riders).
//   Without both map locations the fee is "to be agreed" between rider and customer.
const express = require('express');
const log = require('./log');
const { fmtTsh } = require('./format');
const { esc, page } = require('./html');
const { km } = require('./bulk');

const TZ = 'Africa/Dar_es_Salaam';
const WINDOW_HOURS = 23;
const MAX_ACTIVE_JOBS = 3;
const DEFAULTS = { base: 1000, per_km: 750, road_factor: 1.3, minimum: 1500, round_to: 500, notify_km: 5 };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const showPhone = p => '0' + String(p).slice(3);

async function settings(pool) {
  const { rows } = await pool.query('SELECT key, value FROM delivery_settings');
  const s = { ...DEFAULTS };
  for (const r of rows) if (r.key in s && Number.isFinite(Number(r.value))) s[r.key] = Number(r.value);
  return s;
}

// -> { km, fee } (fee null when a location is missing)
function quote(set, a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(x => x != null && Number.isFinite(Number(x)))) return { km: null, fee: null };
  const road = km(Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng)) * set.road_factor;
  const raw = set.base + set.per_km * road;
  const fee = Math.max(set.minimum, Math.ceil(raw / set.round_to) * set.round_to);
  return { km: Math.round(road * 10) / 10, fee };
}

async function inWindow(pool, phone) {
  const { rows: [r] } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM messages_log WHERE phone_number = $1 AND direction = 'inbound'
                     AND created_at > now() - interval '${WINDOW_HOURS} hours') AS ok`, [phone]);
  return r.ok;
}
const tryTell = async (pool, wa, phone, text) => (await inWindow(pool, phone)) && (await wa.sendText(phone, text)).ok;

const R = {
  sw: {
    askName: 'Karibu! Kujiunga kama boda wa Mkoba, jina lako kamili ni nani?',
    askArea: n => `Asante ${n}! Unafanya kazi eneo gani? (mfano: Sinza, Kariakoo)`,
    applied: 'Asante! Ombi lako limetumwa kwa Mkoba. Utajulishwa ukikubaliwa.',
    pending: 'Ombi lako bado linasubiri kukubaliwa na Mkoba. Utajulishwa.',
    off: 'Akaunti yako ya boda imesitishwa. Wasiliana na Mkoba.',
    approved: '✅ Umekubaliwa kuwa boda wa Mkoba! Andika "kazi" kuona kazi zilizopo. Tuma location yako kupata kazi za karibu.',
    help: 'Boda wa Mkoba:\n• kazi – kazi zilizo wazi\n• chukua 12 – chukua kazi #12\n• nimechukua 12 – umechukua mzigo\n• nimefikisha 12 – umefikisha\n• acha 12 – acha kazi\n• zima / washa – usipokee / pokea kazi\n• Tuma location yako upate kazi za karibu',
    noJobs: 'Hakuna kazi zilizo wazi kwa sasa.',
    jobsTitle: '🛵 Kazi zilizo wazi:',
    job: (d, away) => `#${d.id} ${d.pickup_text} → ${d.drop_text}${d.km != null ? ` (km ${d.km})` : ''} – ${d.fee ? fmtTsh(d.fee) : 'bei ya kukubaliana'}${away != null ? `; uko km ${away}` : ''}`,
    take: n => `Kuchukua: chukua ${n}`,
    taken: d => `Sawa! Kazi #${d.id} ni yako.\nChukua: ${d.pickup_text}${d.pickup_phone ? ` (${showPhone(d.pickup_phone)})` : ''}\nPeleka: ${d.drop_text}${d.drop_phone ? ` (${showPhone(d.drop_phone)})` : ''}\nMalipo: ${d.fee ? fmtTsh(d.fee) + ' (mteja analipa)' : 'kubaliana na mteja'}\nUkichukua mzigo andika: nimechukua ${d.id}`,
    gone: n => `Kazi #${n} haipo wazi tena.`,
    tooMany: `Una kazi ${MAX_ACTIVE_JOBS} ambazo hujamaliza. Maliza kwanza.`,
    notYours: n => `Kazi #${n} si yako.`,
    picked: n => `Sawa! Ukifikisha andika: nimefikisha ${n}`,
    delivered: (n, fee) => `Hongera! Kazi #${n} imekamilika.${fee ? ` Malipo: ${fmtTsh(fee)}.` : ''}`,
    dropped: n => `Sawa, kazi #${n} imerudishwa kwa wengine.`,
    offNow: 'Sawa, hutapokea kazi mpya. Kuanza tena: washa',
    onNow: 'Sawa, utapokea kazi mpya.',
    loc: 'Nimehifadhi eneo lako. Andika "kazi" kuona kazi za karibu.',
    newJob: d => `🛵 Kazi mpya #${d.id}: ${d.pickup_text} → ${d.drop_text}${d.km != null ? ` (km ${d.km})` : ''} – ${d.fee ? fmtTsh(d.fee) : 'bei ya kukubaliana'}\nKuchukua: chukua ${d.id}`,
    deleted: 'Taarifa zako za boda zimefutwa.',
  },
  en: {
    askName: 'Welcome! To join as a Mkoba rider, what is your full name?',
    askArea: n => `Thank you ${n}! Which area do you work in? (e.g. Sinza, Kariakoo)`,
    applied: 'Thank you! Your application was sent to Mkoba. You will be told when it is approved.',
    pending: 'Your application is still waiting for approval. You will be told.',
    off: 'Your rider account is switched off. Please contact Mkoba.',
    approved: '✅ You are approved as a Mkoba rider! Send "jobs" to see open jobs. Share your location to get jobs near you.',
    help: 'Mkoba rider:\n• jobs – open jobs\n• take 12 – take job #12\n• picked 12 – you collected the goods\n• delivered 12 – delivered\n• drop 12 – give the job back\n• off / on – stop / start getting jobs\n• Share your location to get jobs near you',
    noJobs: 'No open jobs right now.',
    jobsTitle: '🛵 Open jobs:',
    job: (d, away) => `#${d.id} ${d.pickup_text} → ${d.drop_text}${d.km != null ? ` (${d.km} km)` : ''} – ${d.fee ? fmtTsh(d.fee) : 'fee to agree'}${away != null ? `; you are ${away} km away` : ''}`,
    take: n => `To take one: take ${n}`,
    taken: d => `Done! Job #${d.id} is yours.\nPick up: ${d.pickup_text}${d.pickup_phone ? ` (${showPhone(d.pickup_phone)})` : ''}\nDeliver to: ${d.drop_text}${d.drop_phone ? ` (${showPhone(d.drop_phone)})` : ''}\nPay: ${d.fee ? fmtTsh(d.fee) + ' (the customer pays)' : 'agree with the customer'}\nWhen you have the goods, send: picked ${d.id}`,
    gone: n => `Job #${n} is no longer open.`,
    tooMany: `You have ${MAX_ACTIVE_JOBS} unfinished jobs. Finish them first.`,
    notYours: n => `Job #${n} is not yours.`,
    picked: n => `Done! When delivered, send: delivered ${n}`,
    delivered: (n, fee) => `Well done! Job #${n} is complete.${fee ? ` Pay: ${fmtTsh(fee)}.` : ''}`,
    dropped: n => `OK, job #${n} is open for others again.`,
    offNow: "OK, you won't get new jobs. To start again: on",
    onNow: 'OK, you will get new jobs.',
    loc: 'I saved your location. Send "jobs" to see jobs near you.',
    newJob: d => `🛵 New job #${d.id}: ${d.pickup_text} → ${d.drop_text}${d.km != null ? ` (${d.km} km)` : ''} – ${d.fee ? fmtTsh(d.fee) : 'fee to agree'}\nTo take it: take ${d.id}`,
    deleted: 'Your rider data has been deleted.',
  },
};
const r = lang => R[lang] || R.sw;

// Customer / vendor wording about a delivery.
const C = {
  sw: {
    created: d => `🛵 Usafiri: ${d.km != null ? `km ${d.km}, ` : ''}${d.fee ? fmtTsh(d.fee) : 'bei ya kukubaliana na boda'}. Boda atakuja kuchukua.`,
    noVendorLoc: 'Tuma location ya duka lako (📎 > Location) ili gharama ya usafiri ikokotolewe wakati ujao.',
    assigned: (n, rider) => `🛵 Boda ${rider.name} (${showPhone(rider.phone)}) atapeleka oda #${n}.`,
    onWay: n => `🛵 Oda #${n} iko njiani kwako.`,
    done: n => `✅ Oda #${n} imefikishwa.`,
    custFee: (n, d) => `🛵 Oda yako #${n} italetwa na boda. Usafiri: ${d.fee ? fmtTsh(d.fee) : 'mtakubaliana na boda'}.`,
  },
  en: {
    created: d => `🛵 Delivery: ${d.km != null ? `${d.km} km, ` : ''}${d.fee ? fmtTsh(d.fee) : 'fee to agree with the rider'}. A rider will come to collect.`,
    noVendorLoc: 'Share your shop location (📎 > Location) so delivery fees can be worked out next time.',
    assigned: (n, rider) => `🛵 Rider ${rider.name} (${showPhone(rider.phone)}) will deliver order #${n}.`,
    onWay: n => `🛵 Order #${n} is on its way to you.`,
    done: n => `✅ Order #${n} was delivered.`,
    custFee: (n, d) => `🛵 Your order #${n} will be delivered by a rider. Delivery: ${d.fee ? fmtTsh(d.fee) : 'agree with the rider'}.`,
  },
};
const c = lang => C[lang] || C.sw;

// ---------- creating jobs ----------
async function createJob(pool, wa, job) {
  const set = await settings(pool);
  const q = quote(set, { lat: job.pickup_lat, lng: job.pickup_lng }, { lat: job.drop_lat, lng: job.drop_lng });
  const { rows: [d] } = await pool.query(
    `INSERT INTO deliveries (kind, order_id, bulk_order_id, member_id, vendor_id, pickup_text, pickup_phone, pickup_lat, pickup_lng,
                             drop_text, drop_phone, drop_lat, drop_lng, km, fee)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT DO NOTHING RETURNING *`,
    [job.kind, job.order_id || null, job.bulk_order_id || null, job.member_id || null, job.vendor_id || null,
      job.pickup_text, job.pickup_phone || null, job.pickup_lat ?? null, job.pickup_lng ?? null,
      job.drop_text, job.drop_phone || null, job.drop_lat ?? null, job.drop_lng ?? null, q.km, q.fee]);
  if (!d) return null; // already a job for this order / member
  log.info('delivery_created', { id: d.id, kind: d.kind, km: d.km, fee: d.fee });
  await broadcast(pool, wa, d, set);
  return d;
}

// Tell available riders near the pickup (only those WhatsApp lets us message now); others see it with "kazi".
async function broadcast(pool, wa, d, set) {
  const { rows } = await pool.query(`SELECT * FROM riders WHERE status = 'active' AND available`);
  for (const rider of rows) {
    const near = d.pickup_lat == null || rider.lat == null || km(Number(rider.lat), Number(rider.lng), Number(d.pickup_lat), Number(d.pickup_lng)) <= set.notify_km;
    if (near) await tryTell(pool, wa, rider.phone, r(rider.lang).newJob(d));
  }
}

// A customer order with delivery, when the vendor accepts it. Returns text for the vendor's reply ('' if no delivery).
async function jobForOrder(pool, wa, vendorId, o, vendorLang = 'sw') {
  if (!o.delivery) return '';
  const { rows: [v] } = await pool.query('SELECT name, business_type, phone_number, lat, lng FROM vendors WHERE id = $1', [vendorId]);
  const shop = [/^\d+$/.test(v.name || '') ? null : v.name, v.business_type].filter(Boolean).join(' – ') || 'Duka';
  const d = await createJob(pool, wa, {
    kind: 'order', order_id: o.id, vendor_id: vendorId,
    pickup_text: shop, pickup_phone: v.phone_number, pickup_lat: v.lat, pickup_lng: v.lng,
    drop_text: `${o.customer_name ? o.customer_name + ', ' : ''}${o.delivery}`, drop_phone: o.customer_phone, drop_lat: o.drop_lat, drop_lng: o.drop_lng,
  });
  if (!d) return '';
  await tryTell(pool, wa, o.customer_phone, c(o.customer_lang).custFee(o.number, d));
  return '\n' + c(vendorLang).created(d) + (v.lat == null ? '\n' + c(vendorLang).noVendorLoc : '');
}

// Household members of a closed bulk order who chose home or a place: one job each (admin "goods arrived").
async function jobsForBulkOrder(pool, wa, bulkOrderId) {
  const { rows: [o] } = await pool.query(
    `SELECT b.id, p.name, p.area, p.lat, p.lng FROM bulk_orders b JOIN collection_points p ON p.id = b.point_id WHERE b.id = $1 AND b.status = 'closed'`, [bulkOrderId]);
  if (!o) return 0;
  const { rows: members } = await pool.query(
    `SELECT DISTINCT v.id, v.name, v.phone_number, v.language, v.delivery_mode, v.delivery_address, v.lat, v.lng
       FROM bulk_lines l JOIN vendors v ON v.id = l.vendor_id
      WHERE l.bulk_order_id = $1 AND v.delivery_mode IN ('home', 'place') AND v.delivery_address IS NOT NULL`, [bulkOrderId]);
  let made = 0;
  for (const m of members) {
    const d = await createJob(pool, wa, {
      kind: 'bulk', bulk_order_id: o.id, member_id: m.id,
      pickup_text: `${o.name}${o.area ? `, ${o.area}` : ''}`, pickup_lat: o.lat, pickup_lng: o.lng,
      drop_text: `${/^\d+$/.test(m.name || '') ? '' : m.name + ', '}${m.delivery_address}`, drop_phone: m.phone_number,
      // A home delivery uses the location the member shared; a named place has no map position.
      drop_lat: m.delivery_mode === 'home' ? m.lat : null, drop_lng: m.delivery_mode === 'home' ? m.lng : null,
    });
    if (d) {
      made++;
      // The household pays the delivery fee by phone, if it is known (or pays the rider in cash).
      const pay = d.fee ? await require('./payments').createPayment(pool, { purpose: 'delivery', amount: Number(d.fee), phone: m.phone_number,
        lang: m.language, member_id: m.id, delivery_id: d.id, bulk_order_id: o.id, rider_amount: Number(d.fee) }) : null;
      const en = m.language === 'en';
      await require('./bulk').notify(pool, wa, m.id, m.phone_number,
        (en ? `🛵 A rider will bring your bulk goods. Delivery: ${d.fee ? fmtTsh(d.fee) : 'agree with the rider'}.`
            : `🛵 Boda atakuletea mzigo wako wa jumla. Usafiri: ${d.fee ? fmtTsh(d.fee) : 'mtakubaliana na boda'}.`)
        + (pay ? '\n' + require('./payments').payLine(pay, m.language) : en ? ' Pay the rider in cash.' : ' Utamlipa boda taslimu.'));
    }
  }
  return made;
}

// ---------- riders on WhatsApp ----------
const parseRiderStart = text => ({ boda: 'sw', 'boda boda': 'sw', bodaboda: 'sw', dereva: 'sw', rider: 'en' }[norm(text)] || null);

async function riderByPhone(pool, phone) {
  const { rows: [x] } = await pool.query('SELECT * FROM riders WHERE phone = $1', [phone]);
  return x || null;
}

async function startRider(pool, phone, lang) {
  const { rows: [x] } = await pool.query(
    `INSERT INTO riders (phone, name, status, step, lang) VALUES ($1, '', 'pending', 'ask_name', $2) ON CONFLICT (phone) DO NOTHING RETURNING id`, [phone, lang]);
  return x ? r(lang).askName : null;
}

function parseRiderCmd(text) {
  const n = norm(text);
  if (['kazi', 'jobs'].includes(n)) return { kind: 'jobs' };
  if (['zima', 'off'].includes(n)) return { kind: 'off' };
  if (['washa', 'on'].includes(n)) return { kind: 'on' };
  if (['futa data', 'delete my data'].includes(n)) return { kind: 'delete' };
  const m = n.match(/^(chukua|take|nimechukua|picked|nimefikisha|delivered|acha|drop)\s+(?:kazi\s+|job\s+)?#?\s*(\d+)$/);
  if (!m) return null;
  const k = { chukua: 'take', take: 'take', nimechukua: 'picked', picked: 'picked', nimefikisha: 'delivered', delivered: 'delivered', acha: 'drop', drop: 'drop' }[m[1]];
  return { kind: k, id: +m[2] };
}

// All messages from a rider. text may be null (location or other types); loc = { lat, lng } for a shared location.
async function riderReply(pool, wa, rider, text, loc) {
  const L = r(rider.lang);
  if (loc) {
    await pool.query('UPDATE riders SET lat = $2, lng = $3 WHERE id = $1', [rider.id, loc.lat, loc.lng]);
    return rider.status === 'active' ? L.loc : L.pending;
  }
  if (text == null) return L.help;
  if (rider.step === 'ask_name') {
    const name = String(text).trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!name) return L.askName;
    await pool.query(`UPDATE riders SET name = $2, step = 'ask_area' WHERE id = $1`, [rider.id, name]);
    return L.askArea(name);
  }
  if (rider.step === 'ask_area') {
    await pool.query(`UPDATE riders SET area = $2, step = NULL WHERE id = $1`, [rider.id, String(text).trim().slice(0, 60)]);
    log.info('rider_applied', { rider: rider.id });
    return L.applied;
  }
  const cmd = parseRiderCmd(text);
  if (cmd?.kind === 'delete') {
    await pool.query('UPDATE deliveries SET rider_id = NULL, status = CASE WHEN status IN (\'assigned\', \'picked\') THEN \'open\' ELSE status END WHERE rider_id = $1', [rider.id]);
    await pool.query('DELETE FROM riders WHERE id = $1', [rider.id]);
    return L.deleted;
  }
  if (rider.status === 'pending') return L.pending;
  if (rider.status === 'off') return L.off;
  if (!cmd) return L.help;

  if (cmd.kind === 'off' || cmd.kind === 'on') {
    await pool.query('UPDATE riders SET available = $2 WHERE id = $1', [rider.id, cmd.kind === 'on']);
    return cmd.kind === 'on' ? L.onNow : L.offNow;
  }
  if (cmd.kind === 'jobs') {
    const { rows } = await pool.query(`SELECT * FROM deliveries WHERE status = 'open' ORDER BY created_at LIMIT 30`);
    if (!rows.length) return L.noJobs;
    const withDist = rows.map(d => ({ d, away: rider.lat != null && d.pickup_lat != null
      ? Math.round(km(Number(rider.lat), Number(rider.lng), Number(d.pickup_lat), Number(d.pickup_lng)) * 10) / 10 : null }))
      .sort((a, b) => (a.away ?? 999) - (b.away ?? 999)).slice(0, 10);
    return [L.jobsTitle, ...withDist.map(x => '- ' + L.job(x.d, x.away)), '', L.take(withDist[0].d.id)].join('\n');
  }
  if (cmd.kind === 'take') {
    const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM deliveries WHERE rider_id = $1 AND status IN ('assigned', 'picked')`, [rider.id]);
    if (n >= MAX_ACTIVE_JOBS) return L.tooMany;
    const { rows: [d] } = await pool.query(
      `UPDATE deliveries SET status = 'assigned', rider_id = $2, assigned_at = now() WHERE id = $1 AND status = 'open' RETURNING *`, [cmd.id, rider.id]);
    if (!d) return L.gone(cmd.id);
    await statusNotice(pool, wa, d, 'assigned', rider);
    // Already paid by phone? Then the rider must not take cash.
    const { rows: [paid] } = await pool.query(
      `SELECT 1 FROM payments WHERE status = 'paid' AND rider_amount > 0 AND (delivery_id = $1 OR ($2::bigint IS NOT NULL AND order_id = $2))`, [d.id, d.order_id]);
    return L.taken(d) + (paid ? `\n${rider.lang === 'en' ? '💳 Already paid by phone: do not take cash.' : '💳 Imeshalipwa kwa simu: usipokee pesa taslimu.'}` : '');
  }
  const { rows: [d] } = await pool.query('SELECT * FROM deliveries WHERE id = $1', [cmd.id]);
  if (!d || String(d.rider_id) !== String(rider.id) || !['assigned', 'picked'].includes(d.status)) return L.notYours(cmd.id);
  if (cmd.kind === 'drop') {
    await pool.query(`UPDATE deliveries SET status = 'open', rider_id = NULL, assigned_at = NULL, picked_at = NULL WHERE id = $1`, [d.id]);
    await broadcast(pool, wa, d, await settings(pool));
    return L.dropped(d.id);
  }
  if (cmd.kind === 'picked') {
    await pool.query(`UPDATE deliveries SET status = 'picked', picked_at = now() WHERE id = $1`, [d.id]);
    await statusNotice(pool, wa, d, 'picked', rider);
    return L.picked(d.id);
  }
  await pool.query(`UPDATE deliveries SET status = 'delivered', delivered_at = now() WHERE id = $1`, [d.id]);
  await statusNotice(pool, wa, d, 'delivered', rider);
  log.info('delivery_done', { id: d.id, rider: rider.id });
  return L.delivered(d.id, d.fee ? Number(d.fee) : null);
}

// Tell the vendor and the customer (orders) or the household (bulk) how the delivery is going.
async function statusNotice(pool, wa, d, status, rider) {
  if (d.kind === 'order') {
    const { rows: [o] } = await pool.query(
      `SELECT o.number, o.customer_phone, o.customer_lang, v.phone_number, v.language, v.id AS vid
         FROM orders o JOIN vendors v ON v.id = o.vendor_id WHERE o.id = $1`, [d.order_id]);
    if (!o) return;
    const V = c(o.language), K = c(o.customer_lang);
    if (status === 'assigned') {
      await require('./bulk').notify(pool, wa, o.vid, o.phone_number, V.assigned(o.number, rider));
      await tryTell(pool, wa, o.customer_phone, K.assigned(o.number, rider));
    } else if (status === 'picked') await tryTell(pool, wa, o.customer_phone, K.onWay(o.number));
    else if (status === 'delivered') await require('./bulk').notify(pool, wa, o.vid, o.phone_number, V.done(o.number));
  } else if (d.member_id && status !== 'delivered') {
    const { rows: [m] } = await pool.query('SELECT phone_number, language FROM vendors WHERE id = $1', [d.member_id]);
    if (!m) return;
    const text = status === 'assigned'
      ? (m.language === 'en' ? `🛵 Rider ${rider.name} (${showPhone(rider.phone)}) will bring your bulk goods. Delivery: ${d.fee ? fmtTsh(d.fee) : 'agree with the rider'}.`
        : `🛵 Boda ${rider.name} (${showPhone(rider.phone)}) atakuletea mzigo wako wa jumla. Usafiri: ${d.fee ? fmtTsh(d.fee) : 'mtakubaliana na boda'}.`)
      : (m.language === 'en' ? '🛵 Your bulk goods are on the way.' : '🛵 Mzigo wako wa jumla uko njiani.');
    await require('./bulk').notify(pool, wa, d.member_id, m.phone_number, text);
  }
}

// ---------- admin: /admin/riders ----------
function adminRouter(wa) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));
  router.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const from = req.get('origin') || req.get('referer') || '';
    try { if (new URL(from).host === req.get('host')) return next(); } catch { /* none */ }
    res.status(403).send('Forbidden');
  });
  const input = (name, label, attrs = '') => `<label>${label}<br><input name="${name}" ${attrs} style="font:inherit;padding:6px;width:100%"></label>`;

  router.get('/', async (_req, res, next) => {
    try {
      const pool = require('./db');
      const set = await settings(pool);
      const { rows: riders } = await pool.query(
        `SELECT x.*, (SELECT count(*) FROM deliveries d WHERE d.rider_id = x.id AND d.status = 'delivered') AS done,
                (SELECT count(*) FROM deliveries d WHERE d.rider_id = x.id AND d.status IN ('assigned', 'picked')) AS busy
           FROM riders x ORDER BY (x.status = 'pending') DESC, x.status, x.name`);
      const { rows: jobs } = await pool.query(
        `SELECT d.*, x.name AS rider, to_char(d.created_at AT TIME ZONE '${TZ}', 'DD/MM HH24:MI') AS at
           FROM deliveries d LEFT JOIN riders x ON x.id = d.rider_id ORDER BY d.id DESC LIMIT 50`);
      res.send(page('Mkoba riders', `
        <p><a href="/admin">← Admin</a></p><h1>Boda delivery</h1>
        <h2>Riders</h2>
        <div class="scroll"><table><thead><tr><th>Name</th><th>Phone</th><th>Area</th><th>Status</th><th>Available</th><th class="r">Active jobs</th><th class="r">Delivered</th><th></th></tr></thead>
        <tbody>${riders.map(x => `<tr><td>${esc(x.name || '(applying)')}</td><td class="num">${esc(x.phone)}</td><td>${esc(x.area || '')}</td>
          <td>${esc(x.status)}${x.step ? ' (filling in)' : ''}</td><td>${x.available ? 'yes' : 'no'}</td><td class="r num">${esc(x.busy)}</td><td class="r num">${esc(x.done)}</td>
          <td>${x.status !== 'active' ? `<form method="post" action="/admin/riders/${x.id}/active"><button class="link-btn">${x.status === 'pending' ? 'Approve' : 'Switch on'}</button></form>`
            : `<form method="post" action="/admin/riders/${x.id}/off"><button class="link-btn">Switch off</button></form>`}</td></tr>`).join('')
          || '<tr><td colspan="8">No riders yet.</td></tr>'}</tbody></table></div>
        <form method="post" action="/admin/riders" class="card" style="margin-top:12px;display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))">
          ${input('name', 'Name', 'required maxlength="60"')}${input('phone', 'WhatsApp number', 'required inputmode="tel" placeholder="0712345678"')}
          ${input('area', 'Area', 'maxlength="60"')}<button class="btn" type="submit">Add rider</button></form>
        <p class="note">Riders can also apply by sending <b>boda</b> to Mkoba on WhatsApp; they appear here as pending.</p>

        <h2>Delivery fee</h2>
        <form method="post" action="/admin/riders/settings" class="card" style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))">
          ${input('base', 'Base (TSh)', `value="${set.base}" inputmode="numeric"`)}${input('per_km', 'Per km (TSh)', `value="${set.per_km}" inputmode="numeric"`)}
          ${input('road_factor', 'Road factor', `value="${set.road_factor}" inputmode="decimal"`)}${input('minimum', 'Minimum (TSh)', `value="${set.minimum}" inputmode="numeric"`)}
          ${input('round_to', 'Round up to (TSh)', `value="${set.round_to}" inputmode="numeric"`)}${input('notify_km', 'Alert riders within (km)', `value="${set.notify_km}" inputmode="decimal"`)}
          <button class="btn" type="submit">Save</button></form>
        <p class="note">Fee = base + per km × straight-line km × road factor, rounded up, never below the minimum. Example now: 1.5 km → ${esc(fmtTsh(quote(set, { lat: 0, lng: 0 }, { lat: 1.5 / 111.195, lng: 0 }).fee))}.
          Without both map locations (vendor or collection point, and customer or household), the fee is agreed between rider and customer.</p>

        <h2>Recent deliveries</h2>
        <div class="scroll"><table><thead><tr><th>#</th><th>Created</th><th>Type</th><th>From</th><th>To</th><th class="r">km</th><th class="r">Fee</th><th>Status</th><th>Rider</th></tr></thead>
        <tbody>${jobs.map(d => `<tr><td class="num">${d.id}</td><td class="num">${esc(d.at)}</td><td>${esc(d.kind)}</td><td>${esc(d.pickup_text)}</td><td>${esc(d.drop_text)}</td>
          <td class="r num">${d.km ?? '–'}</td><td class="r num">${d.fee ? esc(fmtTsh(d.fee)) : '–'}</td><td>${esc(d.status)}</td><td>${esc(d.rider || '')}</td></tr>`).join('')
          || '<tr><td colspan="9">No deliveries yet.</td></tr>'}</tbody></table></div>`, { wide: true }));
    } catch (err) { next(err); }
  });

  router.post('/', async (req, res, next) => {
    try {
      const m = String(req.body.phone || '').replace(/[\s-]/g, '').match(/^(?:\+?255|0)([67]\d{8})$/);
      const name = String(req.body.name || '').trim().slice(0, 60);
      if (m && name) {
        await require('./db').query(
          `INSERT INTO riders (phone, name, area, status, step) VALUES ($1, $2, $3, 'active', NULL)
           ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, area = EXCLUDED.area, status = 'active', step = NULL`,
          ['255' + m[1], name, String(req.body.area || '').trim().slice(0, 60) || null]);
      }
      res.redirect(303, '/admin/riders');
    } catch (err) { next(err); }
  });

  router.post('/settings', async (req, res, next) => {
    try {
      const pool = require('./db');
      for (const k of Object.keys(DEFAULTS)) {
        const v = Number(String(req.body[k] ?? '').replace(/,/g, ''));
        if (Number.isFinite(v) && v >= 0 && (k !== 'round_to' || v > 0)) {
          await pool.query(`INSERT INTO delivery_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, String(v)]);
        }
      }
      res.redirect(303, '/admin/riders');
    } catch (err) { next(err); }
  });

  router.post('/:id/:state', async (req, res, next) => {
    try {
      const pool = require('./db');
      if (!/^\d+$/.test(req.params.id) || !['active', 'off'].includes(req.params.state)) return res.sendStatus(404);
      const { rows: [x] } = await pool.query(
        `UPDATE riders SET status = $2, step = NULL WHERE id = $1 RETURNING phone, lang, (xmax <> 0) AS ok`, [req.params.id, req.params.state]);
      if (x && req.params.state === 'active') await tryTell(pool, wa, x.phone, r(x.lang).approved);
      res.redirect(303, '/admin/riders');
    } catch (err) { next(err); }
  });
  return router;
}

module.exports = { quote, settings, DEFAULTS, createJob, jobForOrder, jobsForBulkOrder, parseRiderStart, riderByPhone, startRider, riderReply, parseRiderCmd, adminRouter };
