// Message routing: what each incoming WhatsApp webhook is, and which handler answers it.
const log = require('./log');
const pool = require('./db');
const { sendText } = require('./whatsapp');
const { getVendor, onboardingReply } = require('./onboarding');
const { t, detectLanguage, parseLanguageSwitch } = require('./i18n');
const { parseCommand, commandReply } = require('./summary');
const { reportSettingReply } = require('./reports');
const { parseCorrection, correctionReply } = require('./corrections');
const { recordEntries, confirmationReply } = require('./ledger');
const { debtReply } = require('./debts');
const { parseDashboardRequest, dashboardLinkReply } = require('./dashboard');
const { mobileMoneyReply, transferChoiceReply, parseMobileMoney } = require('./mobilemoney');
const { consentReply, deletionReply, privacyUrl } = require('./privacy');
const { parseStatementCommand, statementReply } = require('./statement');
const { parseStock, stockReply } = require('./stock');
const { parseLoyalty, loyaltyReply } = require('./loyalty');

const HINT_TYPES = ['image', 'video', 'document', 'sticker', 'location', 'contacts'];

// Handle one webhook body (already signature-checked and acknowledged).
async function processWebhook(body) {
  const started = Date.now();
  const value = body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];

  // Only handle traffic for this environment's own number (item 35). The Meta app has one webhook URL,
  // so messages to another number (e.g. the test number) also arrive here; they must not touch this database.
  const receivedOn = value?.metadata?.phone_number_id;
  if (receivedOn && receivedOn !== process.env.WHATSAPP_PHONE_NUMBER_ID) {
    log.warn('other_number_ignored', { received_on: receivedOn, configured: process.env.WHATSAPP_PHONE_NUMBER_ID,
      kind: value?.messages ? 'message' : value?.statuses ? 'status' : 'other' });
    return;
  }

  const status = value?.statuses?.[0];
  if (status) return logDeliveryStatus(status);
  if (!msg) return;

  let vendorId, lang = 'sw';
  try {
    const phone = msg.from;
    const vendor = await getVendor(pool, phone);
    vendorId = vendor.id;

    const messageId = await logInbound(msg, vendorId, phone);
    if (!messageId) {
      log.info('duplicate_ignored', { id: msg.id, vendor: vendorId });
      return;
    }
    log.info('message_received', { id: msg.id, type: msg.type, vendor: vendorId, from: log.mask(phone), new_vendor: vendor.created });

    const done = handler => log.info('message_handled', { id: msg.id, vendor: vendorId, handler, lang, ms: Date.now() - started });
    const respond = async (handler, reply) => {
      for (const part of [].concat(reply)) await sendText(phone, part); // a handler may return several messages
      done(handler);
    };

    // Language (item 37): explicit "english"/"kiswahili", else switch only on a clearly one-language message.
    const text = msg.type === 'text' ? msg.text?.body : null;
    const switchTo = text ? parseLanguageSwitch(text) : null;
    lang = vendor.language || 'sw';
    // Pasted mobile-money SMS are always in the provider's language, so they say nothing about the vendor's.
    const wanted = switchTo || (text && !parseMobileMoney(text) ? detectLanguage(text) : null);
    if (wanted && wanted !== lang) {
      await pool.query('UPDATE vendors SET language = $2 WHERE id = $1', [vendorId, wanted]);
      lang = wanted;
    }
    const L = t(lang);

    // Privacy (item 40): a new vendor first gets the welcome with the data notice, and must agree before anything is recorded.
    if (vendor.created) return respond('consent_prompt', L.consentPrompt(privacyUrl(lang)));
    if (!vendor.consent_at && msg.type !== 'text') return respond('consent_reminder', L.consentReminder(privacyUrl(lang)));

    if (msg.type !== 'text') {
      if (msg.type === 'audio') return respond('non_text', L.audioHint);
      if (HINT_TYPES.includes(msg.type)) return respond('non_text', L.textOnlyHint);
      return done('ignored'); // reactions and other types: logged, no reply
    }
    if (switchTo) return respond('language', L.languageSet);

    const route = await routeText({ vendor, vendorId, messageId, text: msg.text.body, lang });
    if (route) return respond(route.handler, route.reply);
    return done('no_reply');
  } catch (err) {
    log.error('message_failed', { id: msg.id, vendor: vendorId, error: err.message, stack: err.stack });
    if (msg.from) await sendText(msg.from, t(lang).systemError);
  }
}

// Decide which handler answers a text message. Order matters: earlier handlers win.
// Returns { handler, reply }, or null when no reply should be sent.
async function routeText({ vendor, vendorId, messageId, text, lang = 'sw' }) {
  // Deletion works with or without consent; then nothing else runs until the vendor has agreed.
  const deletion = await deletionReply(pool, vendorId, text, lang);
  if (deletion) return { handler: 'deletion', reply: deletion };
  const consent = await consentReply(pool, vendor, text, lang);
  if (consent) return { handler: 'consent', reply: consent };

  const onboarding = await onboardingReply(pool, vendor, text, lang);
  if (onboarding) return { handler: 'onboarding', reply: onboarding };

  const command = parseCommand(text);
  if (command) return { handler: `command:${command}`, reply: await commandReply(pool, vendorId, command, lang) };

  const reportSetting = await reportSettingReply(pool, vendorId, text, lang);
  if (reportSetting) return { handler: 'report_setting', reply: reportSetting };

  if (parseDashboardRequest(text)) return { handler: 'dashboard_link', reply: await dashboardLinkReply(pool, vendorId, lang) };

  const statement = parseStatementCommand(text);
  if (statement) return { handler: `statement:${statement}`, reply: await statementReply(pool, vendorId, statement, lang) };

  const stock = parseStock(text);
  if (stock) return { handler: `stock:${stock.kind}`, reply: await stockReply(pool, vendorId, stock, lang) };

  const loyalty = parseLoyalty(text);
  if (loyalty) return { handler: `loyalty:${loyalty.kind}`, reply: await loyaltyReply(pool, vendorId, messageId, loyalty, lang) };

  const correction = parseCorrection(text);
  if (correction) return { handler: `correction:${correction.action}`, reply: await correctionReply(pool, vendorId, correction, lang) };

  // A pending "1/2/3?" question about money sent to a person (item 38) comes before YES/NO confirmations.
  const transferChoice = await transferChoiceReply(pool, vendorId, text, lang);
  if (transferChoice) return { handler: 'mm_choice', reply: transferChoice };

  const confirmation = await confirmationReply(pool, vendorId, text, lang);
  if (confirmation) return { handler: 'confirmation', reply: confirmation };

  // Pasted mobile-money SMS, before debts: "You have paid ... to NAME" must not be read as a debt.
  const mobileMoney = await mobileMoneyReply(pool, vendorId, messageId, text, lang);
  if (mobileMoney) return { handler: 'mobile_money', reply: mobileMoney };

  // Debts before the ledger: "Juma amelipa 2000" must not be read as an expense.
  const debt = await debtReply(pool, vendorId, messageId, text, lang);
  if (debt) return { handler: 'debt', reply: debt };

  return { handler: 'ledger', reply: await recordEntries(pool, vendorId, messageId, text, lang) };
}

// Store the raw message once; returns its messages_log id, or null if it was a duplicate.
async function logInbound(msg, vendorId, phone) {
  const { rows } = await pool.query(
    `INSERT INTO messages_log (wa_message_id, vendor_id, phone_number, channel, direction, raw_payload)
     VALUES ($1, $2, $3, 'whatsapp', 'inbound', $4)
     ON CONFLICT (wa_message_id) DO NOTHING
     RETURNING id`,
    [msg.id, vendorId, phone, JSON.stringify(msg)]
  );
  return rows[0]?.id || null;
}

function logDeliveryStatus(status) {
  if (status.status === 'failed') {
    log.warn('delivery_failed', { wa_id: status.id, to: log.mask(status.recipient_id), errors: status.errors });
  } else {
    log.debug('delivery_status', { wa_id: status.id, status: status.status });
  }
}

module.exports = { processWebhook, routeText };
