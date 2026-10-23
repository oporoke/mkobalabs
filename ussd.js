// USSD (roadmap #11): Mkoba on any phone, through Africa's Talking.
//   Africa's Talking POSTs (form-encoded) sessionId, serviceCode, phoneNumber (+255...), text = the choices so far joined
//   by "*" ("" on the first screen, then "1", "1*chips", "1*chips*5000"). Reply: plain text starting "CON " (show and wait)
//   or "END " (show and close). Screens are kept under 182 characters.
//   The callback URL carries a secret (USSD_TOKEN in .env): https://mkoba.digital/ussd/<USSD_TOKEN>
const log = require('./log');
const { t } = require('./i18n');
const { fmtTsh, describe } = require('./format');
const { getSummaryRows } = require('./summary');
const { balanceRows } = require('./debts');
const { stockRows, fmtQty } = require('./stock');

const MAX = 182;
const clip = s => (s.length <= MAX ? s : s.slice(0, MAX - 1) + '…');
const con = s => `CON ${clip(s)}`;
const end = s => `END ${clip(s)}`;
const n0 = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });

const W = {
  sw: {
    welcome: 'Karibu Mkoba! Tunahifadhi namba, jina na rekodi zako kwa hesabu za biashara yako. Masharti: mkoba.digital/faragha\n1. Nakubali\n2. Hapana',
    askName: 'Jina lako?', bye: 'Sawa. Karibu tena wakati wowote.',
    joined: n => `Karibu ${n}! Piga tena kuanza kuweka rekodi. Pia unaweza kutumia WhatsApp: +255 788 001 168`,
    menu: 'Mkoba\n1. Weka mauzo\n2. Weka manunuzi\n3. Weka matumizi\n4. Muhtasari wa leo\n5. Muhtasari wa wiki\n6. Madeni\n7. Stoo\n8. Futa rekodi ya mwisho',
    askItem: 'Bidhaa gani? (andika 0 kuruka)', askAmount: 'Kiasi gani (TSh)?', badAmount: 'Kiasi si sahihi. Piga tena.',
    saved: (d, a) => `Imehifadhiwa: ${d} ${a}.`,
    sum: (title, s, p, e, net) => `${title}:\nMauzo ${n0(s)}\nManunuzi ${n0(p)}\nMatumizi ${n0(e)}\n${net >= 0 ? 'Faida' : 'Hasara'} TSh ${n0(Math.abs(net))}`,
    today: 'Leo', week: 'Wiki hii', none: 'Hakuna rekodi bado.',
    debts: 'Madeni', noDebts: 'Hakuna madeni.', owes: (n, a) => `${n} anadaiwa ${a}`, youOwe: (n, a) => `Unadaiwa na ${n} ${a}`,
    stock: 'Stoo', noStock: 'Bado hakuna stoo. Weka kwa WhatsApp: stoo mchele kilo 20',
    undoAsk: d => `Futa ${d}?\n1. Ndio\n2. Hapana`, undone: d => `Imefutwa: ${d}.`, nothing: 'Hakuna rekodi ya kufuta.', kept: 'Sawa, haijafutwa.',
    bad: 'Chaguo si sahihi. Piga tena.', otherKind: 'Namba hii inatumia Mkoba kwa kununua jumla au usafiri. Tafadhali tumia WhatsApp: +255 788 001 168',
  },
  en: {
    welcome: 'Welcome to Mkoba! We store your number, name and records for your business accounts. Terms: mkoba.digital/privacy\n1. I agree\n2. No',
    askName: 'Your name?', bye: 'OK. Welcome back any time.',
    joined: n => `Welcome ${n}! Dial again to start recording. You can also use WhatsApp: +255 788 001 168`,
    menu: 'Mkoba\n1. Record a sale\n2. Record a purchase\n3. Record an expense\n4. Today\'s summary\n5. This week\n6. Debts\n7. Stock\n8. Delete last record',
    askItem: 'Which item? (send 0 to skip)', askAmount: 'How much (TSh)?', badAmount: 'Amount not valid. Please dial again.',
    saved: (d, a) => `Saved: ${d} ${a}.`,
    sum: (title, s, p, e, net) => `${title}:\nSales ${n0(s)}\nPurchases ${n0(p)}\nExpenses ${n0(e)}\n${net >= 0 ? 'Profit' : 'Loss'} TSh ${n0(Math.abs(net))}`,
    today: 'Today', week: 'This week', none: 'No records yet.',
    debts: 'Debts', noDebts: 'No debts.', owes: (n, a) => `${n} owes you ${a}`, youOwe: (n, a) => `You owe ${n} ${a}`,
    stock: 'Stock', noStock: 'No stock yet. Set it on WhatsApp: stock rice kilo 20',
    undoAsk: d => `Delete ${d}?\n1. Yes\n2. No`, undone: d => `Deleted: ${d}.`, nothing: 'No record to delete.', kept: 'OK, not deleted.',
    bad: 'Invalid choice. Please dial again.', otherKind: 'This number uses Mkoba for bulk buying or delivery. Please use WhatsApp: +255 788 001 168',
  },
};
const TYPES = { 1: ['sale', 'credit'], 2: ['purchase', 'debit'], 3: ['expense', 'debit'] };

// Amount typed on a phone keypad: digits, maybe with commas/dots as thousands separators.
function parseAmount(s) {
  const clean = String(s || '').replace(/[,\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '');
  return /^\d{2,12}$/.test(clean) && Number(clean) > 0 ? Number(clean) : null;
}

async function logSession(pool, vendorId, phone, body) {
  const { rows: [m] } = await pool.query(
    `INSERT INTO messages_log (vendor_id, phone_number, channel, direction, raw_payload) VALUES ($1, $2, 'ussd', 'ussd', $3) RETURNING id`,
    [vendorId, phone, JSON.stringify(body)]);
  return m.id;
}

async function lastRecord(pool, vendorId) {
  const { rows: [r] } = await pool.query(
    `SELECT id, type, amount_tsh, item, quantity, unit, counterparty FROM transactions
      WHERE vendor_id = $1 AND deleted_at IS NULL AND status = 'confirmed' ORDER BY id DESC LIMIT 1`, [vendorId]);
  return r || null;
}

// -> the reply text ("CON ..." or "END ...")
async function handleUssd(pool, { sessionId, phoneNumber, text }) {
  const phone = String(phoneNumber || '').replace(/^\+/, '');
  if (!/^255\d{9}$/.test(phone)) return end('Namba si sahihi.');
  const steps = String(text || '') === '' ? [] : String(text).split('*');
  const { rows: [v] } = await pool.query('SELECT id, name, kind, language, consent_at FROM vendors WHERE phone_number = $1', [phone]);
  const L = W[v?.language] || W.sw;

  // New number (or never agreed): agree, give a name, done.
  if (!v || !v.consent_at) {
    if (!steps.length) return con(L.welcome);
    if (steps[0] !== '1') return end(L.bye);
    if (steps.length === 1) return con(L.askName);
    const name = steps.slice(1).join(' ').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name || /\d/.test(name)) return con(L.askName);
    await pool.query(
      `INSERT INTO vendors (phone_number, name, onboarded_via, consent_at, onboarding_step) VALUES ($1, $2, 'ussd', now(), NULL)
       ON CONFLICT (phone_number) DO UPDATE SET name = EXCLUDED.name, consent_at = now(), onboarding_step = NULL`, [phone, name]);
    log.info('ussd_registered', { session: sessionId });
    return end(L.joined(name));
  }
  if (v.kind !== 'vendor') return end(L.otherKind);
  if (!steps.length) return con(L.menu);

  const [choice, a, b] = steps;
  const lang = v.language || 'sw';
  if (TYPES[choice]) {
    if (steps.length === 1) return con(L.askItem);
    if (steps.length === 2) return con(L.askAmount);
    const amount = parseAmount(b);
    if (!amount) return end(L.badAmount);
    const item = a === '0' || !a.trim() ? null : a.trim().toLowerCase().slice(0, 60);
    const [type, direction] = TYPES[choice];
    const mid = await logSession(pool, v.id, phone, { sessionId, text });
    await pool.query(
      `INSERT INTO transactions (vendor_id, message_id, type, direction, amount_tsh, raw_input, channel, parse_confidence, status, item)
       VALUES ($1, $2, $3, $4, $5, $6, 'ussd', 1, 'confirmed', $7)`,
      [v.id, mid, type, direction, amount, `ussd: ${item || ''} ${amount}`.trim(), item]);
    return end(L.saved(describe({ type, item }, true, lang), fmtTsh(amount)));
  }
  if (choice === '4' || choice === '5') {
    const rows = await getSummaryRows(pool, v.id, choice === '4' ? 'leo' : 'wiki');
    if (!rows.length) return end(L.none);
    const get = k => Number(rows.find(r => r.type === k)?.total || 0);
    const s = get('sale'), p = get('purchase'), e = get('expense');
    return end(L.sum(choice === '4' ? L.today : L.week, s, p, e, s - p - e));
  }
  if (choice === '6') {
    const rows = (await balanceRows(pool, v.id)).slice(0, 5);
    if (!rows.length) return end(L.noDebts);
    return end([L.debts + ':', ...rows.map(r => (Number(r.balance) > 0 ? L.owes(r.name, n0(r.balance)) : L.youOwe(r.name, n0(-r.balance))))].join('\n'));
  }
  if (choice === '7') {
    const rows = (await stockRows(pool, v.id)).filter(r => r.known && r.qty >= 0).sort((x, y) => Number(y.low) - Number(x.low)).slice(0, 6);
    if (!rows.length) return end(L.noStock);
    return end([L.stock + ':', ...rows.map(r => `${r.item} ${fmtQty(r.qty, r.unit)}${r.low ? ' !' : ''}`)].join('\n'));
  }
  if (choice === '8') {
    const r = await lastRecord(pool, v.id);
    if (!r) return end(L.nothing);
    const d = `${describe(r, true, lang)} ${fmtTsh(r.amount_tsh)}`;
    if (steps.length === 1) return con(L.undoAsk(d));
    if (a !== '1') return end(L.kept);
    await pool.query('UPDATE transactions SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [r.id]);
    return end(L.undone(d));
  }
  return end(L.bad);
}

module.exports = { handleUssd, parseAmount };
