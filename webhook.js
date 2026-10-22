// Message routing: what each incoming WhatsApp webhook is, and which handler answers it.
const log = require('./log');
const pool = require('./db');
const { sendText } = require('./whatsapp');
const { getVendor, onboardingReply, isActionable, WELCOME } = require('./onboarding');
const { parseCommand, commandReply } = require('./summary');
const { reportSettingReply } = require('./reports');
const { parseCorrection, correctionReply } = require('./corrections');
const { recordEntries, confirmationReply } = require('./ledger');
const { debtReply } = require('./debts');
const { parseDashboardRequest, dashboardLinkReply } = require('./dashboard');

const NON_TEXT_HINTS = {
  audio: 'Samahani, bado siwezi kusikiliza ujumbe wa sauti. Tafadhali andika, mfano: nimeuza 5000',
  other: 'Samahani, ninaelewa ujumbe wa maandishi tu. Andika, mfano: nimeuza 5000 au nimenunua unga 20000',
};
const HINT_TYPES = ['image', 'video', 'document', 'sticker', 'location', 'contacts'];
const SYSTEM_ERROR = 'Samahani, kuna tatizo la mfumo. Tafadhali tuma tena baada ya muda mfupi.';

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

  let vendorId;
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

    const done = handler => log.info('message_handled', { id: msg.id, vendor: vendorId, handler, ms: Date.now() - started });
    const respond = async (handler, reply) => { await sendText(phone, reply); done(handler); };

    if (vendor.created) await sendText(phone, WELCOME);

    if (msg.type !== 'text') {
      if (msg.type === 'audio') return respond('non_text', NON_TEXT_HINTS.audio);
      if (HINT_TYPES.includes(msg.type)) return respond('non_text', NON_TEXT_HINTS.other);
      return done('ignored'); // reactions and other types: logged, no reply
    }

    const text = msg.text.body;
    const route = await routeText({ vendor, vendorId, messageId, text });
    if (route) return respond(route.handler, route.reply);
    return done('welcome');
  } catch (err) {
    log.error('message_failed', { id: msg.id, vendor: vendorId, error: err.message, stack: err.stack });
    if (msg.from) await sendText(msg.from, SYSTEM_ERROR);
  }
}

// Decide which handler answers a text message. Order matters: earlier handlers win.
// Returns { handler, reply }, or null when no reply should be sent.
async function routeText({ vendor, vendorId, messageId, text }) {
  const onboarding = await onboardingReply(pool, vendor, text);
  if (onboarding) return { handler: 'onboarding', reply: onboarding };
  if (vendor.created && !isActionable(text)) return null; // e.g. "habari": the welcome is the reply

  const command = parseCommand(text);
  if (command) return { handler: `command:${command}`, reply: await commandReply(pool, vendorId, command) };

  const reportSetting = await reportSettingReply(pool, vendorId, text);
  if (reportSetting) return { handler: 'report_setting', reply: reportSetting };

  if (parseDashboardRequest(text)) return { handler: 'dashboard_link', reply: await dashboardLinkReply(pool, vendorId) };

  const correction = parseCorrection(text);
  if (correction) return { handler: `correction:${correction.action}`, reply: await correctionReply(pool, vendorId, correction) };

  const confirmation = await confirmationReply(pool, vendorId, text);
  if (confirmation) return { handler: 'confirmation', reply: confirmation };

  // Debts before the ledger: "Juma amelipa 2000" must not be read as an expense.
  const debt = await debtReply(pool, vendorId, messageId, text);
  if (debt) return { handler: 'debt', reply: debt };

  return { handler: 'ledger', reply: await recordEntries(pool, vendorId, messageId, text) };
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
