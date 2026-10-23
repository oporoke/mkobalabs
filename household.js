// Household group buys (roadmap #5): households join the same groups and weekly bulk orders as vendors.
// The only difference: each household says where it receives its goods (home, a place, or the group point).
// A household starts with "nyumbani" (no vendor sign-up), agrees to the data terms, gives a name, and then
// only the group-buying commands apply. They are stored as vendors with kind = 'household'.
const log = require('./log');
const { t } = require('./i18n');
const { parseConsent, deletionReply, privacyUrl } = require('./privacy');
const { extractName } = require('./onboarding');
const { parseBulk, bulkReply } = require('./bulk');

const START = { nyumbani: 'sw', kaya: 'sw', familia: 'sw', household: 'en', 'for my home': 'en' };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const parseHouseholdStart = text => START[norm(text)] || null;

const W = {
  sw: {
    consent: url => 'Karibu Mkoba – kununua jumla kwa kaya! 👋 Utanunua bidhaa kwa bei ya jumla pamoja na majirani zako.\n\n'
      + 'Ili kufanya hivyo, Mkoba itahifadhi namba yako ya simu, jina lako, kikundi chako, oda zako na mahali pa kupokea mzigo. '
      + 'Hatuziuzi wala kuzitoa kwa mtu mwingine, isipokuwa kwa watoa huduma wanaotuwezesha (WhatsApp na seva yetu). '
      + `Unaweza kuzifuta zote wakati wowote kwa kuandika FUTA DATA.\nSoma zaidi: ${url}\n\nJibu NAKUBALI kuendelea.`,
    askName: 'Asante! Jina lako ni nani?',
    help: n => `Karibu${n ? ` ${n}` : ''}! Hatua 3:\n`
      + '1. Jiunge na kikundi: andika vikundi, kisha jiunge SIN01 (au tuma location yako)\n'
      + '2. Mahali pa kupokea: pokea nyumbani <anwani>, au pokea <mahali>, au pokea kikundi\n'
      + '3. Agiza: jirani mchele kilo 5 (oda inafungwa kila Ijumaa jioni)\n\n'
      + 'Kuona oda: jirani • Kuondoa: jirani ondoa mchele • Mzigo ukifika: jirani imefika\n'
      + 'Lugha: english • Kufuta taarifa zako: FUTA DATA • Msaada: msaada',
  },
  en: {
    consent: url => 'Welcome to Mkoba – bulk buying for households! 👋 Buy at wholesale prices together with your neighbours.\n\n'
      + 'To do that, Mkoba stores your phone number, your name, your group, your orders and where you receive your goods. '
      + 'We do not sell or share them with anyone, except the providers that run the service (WhatsApp and our server). '
      + `You can delete everything at any time by sending DELETE MY DATA.\nMore: ${url}\n\nReply I AGREE to continue.`,
    askName: "Thank you! What's your name?",
    help: n => `Welcome${n ? ` ${n}` : ''}! 3 steps:\n`
      + '1. Join a group: send groups, then join SIN01 (or share your location)\n'
      + '2. Where to receive: deliver home <address>, or deliver to <place>, or collect group\n'
      + '3. Order: bulk rice kilo 5 (orders close every Friday evening)\n\n'
      + 'See the order: bulk • Remove: bulk remove rice • When goods arrive: bulk received\n'
      + 'Language: kiswahili • Delete your data: DELETE MY DATA • Help: help',
  },
};
const w = lang => W[lang] || W.sw;

// Register a new phone as a household (only if it is not already a vendor/household). Returns the welcome, or null.
async function startHousehold(pool, phone, lang) {
  const { rows: [v] } = await pool.query(
    `INSERT INTO vendors (phone_number, name, onboarded_via, onboarding_step, kind, daily_report, language)
     VALUES ($1, $1, 'whatsapp', 'ask_name', 'household', false, $2)
     ON CONFLICT (phone_number) DO NOTHING RETURNING id`, [phone, lang]);
  if (!v) return null;
  log.info('household_created', { vendor: v.id });
  return { id: v.id, reply: w(lang).consent(privacyUrl(lang)) };
}

// All text messages from a household.
async function householdRoute(pool, { vendor, vendorId, messageId, text, lang }) {
  const L = w(lang);
  const deletion = await deletionReply(pool, vendorId, text, lang);
  if (deletion) return { handler: 'deletion', reply: deletion };

  if (!vendor.consent_at) {
    if (!parseConsent(text)) return { handler: 'consent', reply: L.consent(privacyUrl(lang)) };
    await pool.query('UPDATE vendors SET consent_at = now() WHERE id = $1', [vendorId]);
    return { handler: 'consent', reply: L.askName };
  }
  if (vendor.onboarding_step === 'ask_name') {
    const name = extractName(text);
    await pool.query('UPDATE vendors SET name = COALESCE($2, name), onboarding_step = NULL WHERE id = $1', [vendorId, name]);
    if (name || parseBulk(text) === null) return { handler: 'household_onboarding', reply: L.help(name) };
  }
  const bulk = parseBulk(text);
  if (bulk) return { handler: `household:${bulk.kind}`, reply: await bulkReply(pool, vendorId, messageId, bulk, lang) };
  const name = /^\d+$/.test(vendor.name || '') ? null : vendor.name;
  return { handler: 'household_help', reply: L.help(name) };
}

module.exports = { parseHouseholdStart, startHousehold, householdRoute };
