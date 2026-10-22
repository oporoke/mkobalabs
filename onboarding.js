// Onboarding: welcome new vendors and ask for their name and type of business.
// vendors.onboarding_step: 'ask_name' -> 'ask_business' -> NULL (done)
const { parseLedgerEntries } = require('./parser');
const { parseCommand, HELP } = require('./summary');
const { parseCorrection } = require('./corrections');
const { parseConfirmation } = require('./ledger');
const { parseDebt, parseDebtQuery } = require('./debts');
const { parseReportSetting } = require('./reports');
const { parseDashboardRequest } = require('./dashboard');

const WELCOME = 'Karibu Mkoba! 👋 Nitakusaidia kuweka hesabu za biashara yako kupitia WhatsApp.\nKwanza, jina lako ni nani?';
const GREETINGS = new Set(['habari', 'mambo', 'hello', 'hi', 'hey', 'sasa', 'salama', 'poa', 'asante', 'shikamoo', 'vipi', 'niaje']);
const SKIP = new Set(['ruka', 'skip']);

const titleCase = s => s.replace(/\b[a-z]/g, c => c.toUpperCase());
const clean = t => String(t || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();

// True if the text is something the bot should act on (entry, command, debt...), not an onboarding answer.
function isActionable(text) {
  if (parseCommand(text) || parseCorrection(text) || parseConfirmation(text) || parseDebtQuery(text) || parseDebt(text)
      || parseReportSetting(text) !== null || parseDashboardRequest(text)) return true;
  const entries = parseLedgerEntries(text);
  return entries.length > 0 && entries.every(e => e.confidence >= 0.6);
}

function extractName(text) {
  if (/\d/.test(text) || isActionable(text)) return null;
  const t = clean(text).replace(/^(?:jina langu ni|jina langu|naitwa|ninaitwa|mimi ni|my name is|i am|i'm)\s+/, '');
  const words = t.split(' ').filter(Boolean);
  if (!words.length || words.length > 4 || t.length > 40 || words.every(w => GREETINGS.has(w))) return null;
  return titleCase(t);
}

function extractBusiness(text) {
  if (/\d/.test(text) || isActionable(text)) return null;
  const t = clean(text).replace(/^(?:ninauza|nauza|nina|ni|biashara ya|duka la|i sell|i run|i have)\s+/, '');
  const words = t.split(' ').filter(Boolean);
  if (!words.length || words.length > 6 || words.every(w => GREETINGS.has(w))) return null;
  return t;
}

// Upsert the vendor; `created` is true only for a brand-new vendor.
async function getVendor(pool, phone) {
  const { rows: [v] } = await pool.query(
    `INSERT INTO vendors (phone_number, name, onboarded_via, onboarding_step)
     VALUES ($1, $1, 'whatsapp', 'ask_name')
     ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
     RETURNING id, name, onboarding_step, (xmax = 0) AS created`,
    [phone]
  );
  return v;
}

// Returns a reply if the text answers an onboarding question; null otherwise (caller continues).
async function onboardingReply(pool, vendor, text) {
  if (!vendor.onboarding_step) return null;

  if (SKIP.has(clean(text))) {
    await pool.query(`UPDATE vendors SET onboarding_step = NULL WHERE id = $1`, [vendor.id]);
    return `Sawa.\n${HELP}`;
  }

  if (vendor.onboarding_step === 'ask_name') {
    const name = extractName(text);
    if (!name) return null;
    await pool.query(`UPDATE vendors SET name = $2, onboarding_step = 'ask_business' WHERE id = $1`, [vendor.id, name]);
    return `Asante ${name}! Unafanya biashara gani? (mfano: chakula, duka, mboga, nguo)\nAndika "ruka" kuruka swali hili.`;
  }

  if (vendor.onboarding_step === 'ask_business') {
    const business = extractBusiness(text);
    if (!business) return null;
    const { rows: [v] } = await pool.query(
      `UPDATE vendors SET business_type = $2, onboarding_step = NULL WHERE id = $1 RETURNING name`,
      [vendor.id, business]
    );
    return `Safi, ${v.name}! Sasa uko tayari.\n${HELP}`;
  }
  return null;
}

module.exports = { getVendor, onboardingReply, isActionable, extractName, extractBusiness, WELCOME };
