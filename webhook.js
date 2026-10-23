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
const { parseVendorCatalog, vendorCatalogReply, parseShopOpen, activeSession, customerReply, pendingOrderNotice, isPastCustomer, customerHint } = require('./catalog');
const { parseBulk, bulkReply, locationReply, takeNotices } = require('./bulk');
const { parseHouseholdStart, startHousehold, householdRoute } = require('./household');
const { parseScore, scoreReply } = require('./score');
const { parseLender, lenderReply } = require('./lender');
const { parseRiderStart, riderByPhone, startRider, riderReply } = require('./delivery');
const payments = require('./payments');

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

    const custText = msg.type === 'text' ? msg.text?.body : null;
    const loc = msg.type === 'location' && msg.location?.latitude != null ? { lat: Number(msg.location.latitude), lng: Number(msg.location.longitude) } : null;

    // Boda riders (roadmap #8): a rider's messages go to the rider flow; "boda" from a new number applies to be one.
    const rider = await riderByPhone(pool, phone);
    const riderStart = !rider && custText ? parseRiderStart(custText) : null;
    if (rider || riderStart) {
      const isVendor = riderStart && (await pool.query('SELECT 1 FROM vendors WHERE phone_number = $1', [phone])).rowCount;
      if (!isVendor) {
        const mid = await logInbound(msg, null, phone);
        if (!mid) return log.info('duplicate_ignored', { id: msg.id });
        const reply = rider ? await riderReply(pool, { sendText }, rider, custText, loc) : await startRider(pool, phone, riderStart);
        if (reply) await sendText(phone, reply);
        log.info('message_handled', { id: msg.id, handler: rider ? 'rider' : 'rider_start', from: log.mask(phone), ms: Date.now() - started });
        return;
      }
    }

    // Customers (roadmap #3): "duka 4821" opens a shop; while that visit lasts, their messages go to the shop, not the ledger.
    const open = custText ? parseShopOpen(custText) : null;
    const session = open ? null : await activeSession(pool, phone);
    // A customer who has ordered before (and is not a vendor) gets a shop hint instead of vendor sign-up,
    // unless they ask to register their own business ("sajili").
    const pastCustomer = !open && !session && !/^\s*(?:sajili|register)\s*$/i.test(custText || '') && !parseHouseholdStart(custText)
      && await isPastCustomer(pool, phone);
    if (pastCustomer) {
      const mid = await logInbound(msg, null, phone);
      if (!mid) return log.info('duplicate_ignored', { id: msg.id });
      const pay = payments.parsePay(custText) ? await payments.payReply(pool, { sendText }, phone, /^\s*pay\b/i.test(custText) ? 'en' : 'sw') : null;
      const hint = pay ?? await customerHint(pool, phone);
      if (hint) await sendText(phone, hint);
      log.info('message_handled', { id: msg.id, handler: 'customer_hint', from: log.mask(phone), ms: Date.now() - started });
      return;
    }
    // Households (roadmap #5): "nyumbani" registers a new phone for household group buying, without vendor sign-up.
    const household = !open && !session && custText ? parseHouseholdStart(custText) : null;
    if (household) {
      const hh = await startHousehold(pool, phone, household);
      if (hh) {
        const mid = await logInbound(msg, hh.id, phone);
        if (!mid) return log.info('duplicate_ignored', { id: msg.id });
        await sendText(phone, hh.reply);
        log.info('message_handled', { id: msg.id, handler: 'household_start', vendor: hh.id, ms: Date.now() - started });
        return;
      }
    }
    if (open || session) {
      const mid = await logInbound(msg, null, phone);
      if (!mid) return log.info('duplicate_ignored', { id: msg.id });
      const reply = await customerReply(pool, { sendText }, phone, custText, session, open, loc);
      for (const part of [].concat(reply)) await sendText(phone, part);
      log.info('message_handled', { id: msg.id, handler: open ? 'shop_open' : 'customer', from: log.mask(phone), ms: Date.now() - started });
      return;
    }

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

    if (msg.type === 'location' && msg.location?.latitude != null) {
      return respond('location', await locationReply(pool, vendorId, Number(msg.location.latitude), Number(msg.location.longitude), lang));
    }
    if (msg.type !== 'text') {
      if (msg.type === 'audio') return respond('non_text', L.audioHint);
      if (HINT_TYPES.includes(msg.type)) return respond('non_text', L.textOnlyHint);
      return done('ignored'); // reactions and other types: logged, no reply
    }
    if (switchTo) return respond('language', L.languageSet);

    const route = await routeText({ vendor, vendorId, messageId, text: msg.text.body, lang });
    if (route) {
      // New shop orders the vendor has not been told about (they arrived outside WhatsApp's 24-hour window).
      // Plus notices kept for later (e.g. a closed bulk order), since WhatsApp only allows messages within 24 hours.
      const extra = vendor.consent_at ? [await pendingOrderNotice(pool, vendorId, lang), ...await takeNotices(pool, vendorId)].filter(Boolean) : [];
      return respond(route.handler, [].concat(route.reply, extra));
    }
    return done('no_reply');
  } catch (err) {
    log.error('message_failed', { id: msg.id, vendor: vendorId, error: err.message, stack: err.stack });
    if (msg.from) await sendText(msg.from, t(lang).systemError);
  }
}

// Decide which handler answers a text message. Order matters: earlier handlers win.
// Returns { handler, reply }, or null when no reply should be sent.
async function routeText({ vendor, vendorId, messageId, text, lang = 'sw' }) {
  if (vendor.kind === 'household') return householdRoute(pool, { vendor, vendorId, messageId, text, lang });
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

  const shop = parseVendorCatalog(text);
  if (shop) return { handler: `catalog:${shop.kind}`, reply: await vendorCatalogReply(pool, { sendText }, vendorId, messageId, shop, lang) };

  if (payments.parsePay(text)) {
    const { rows: [me] } = await pool.query('SELECT phone_number FROM vendors WHERE id = $1', [vendorId]);
    return { handler: 'pay', reply: (await payments.payReply(pool, { sendText }, me.phone_number, lang)) || [] };
  }

  const lender = parseLender(text);
  if (lender) {
    const reply = await lenderReply(pool, vendorId, lender, lang);
    if (reply) return { handler: `lender:${lender.kind}`, reply };
  }

  if (parseScore(text)) return { handler: 'score', reply: await scoreReply(pool, vendorId, lang) };

  const bulk = parseBulk(text);
  if (bulk) return { handler: `bulk:${bulk.kind}`, reply: await bulkReply(pool, vendorId, messageId, bulk, lang) };

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
