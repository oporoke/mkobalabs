require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const express = require('express');

const log = require('./log');
const pool = require('./db');
const { sendText, sendHealth } = require('./whatsapp');
const { getVendor, onboardingReply, isActionable, WELCOME } = require('./onboarding');
const { parseCommand, commandReply } = require('./summary');
const { reportSettingReply } = require('./reports');
const { parseCorrection, correctionReply } = require('./corrections');
const { recordEntries, confirmationReply } = require('./ledger');
const { debtReply } = require('./debts');

process.on('unhandledRejection', err => log.error('unhandled_rejection', { error: err?.message, stack: err?.stack }));

const app = express();

// While shutting down, tell clients not to reuse this connection.
let shuttingDown = false;
app.use((_req, res, next) => { if (shuttingDown) res.set('Connection', 'close'); next(); });
app.set('trust proxy', 'loopback'); // trust X-Forwarded-For only from nginx on this machine
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

function validSignature(req) {
  const secret = process.env.META_APP_SECRET;
  const header = req.get('x-hub-signature-256') || '';
  if (!secret || !req.rawBody || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex'));
  const received = Buffer.from(header);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

app.get('/', (_req, res) => res.send('Mkoba API is running'));

// Health check for uptime monitoring: 200 if the app and database answer, 503 otherwise.
app.get('/health', async (_req, res) => {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), 3000));
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
    const wa = sendHealth();
    if (!wa.ok) return res.status(503).set('Cache-Control', 'no-store').json({ status: 'error', reason: `whatsapp_${wa.reason}`, code: wa.code });
    res.set('Cache-Control', 'no-store').json({ status: 'ok', uptime_s: Math.round(process.uptime()) });
  } catch (err) {
    log.error('health_check_failed', { error: err.message });
    res.status(503).set('Cache-Control', 'no-store').json({ status: 'error', reason: 'database' });
  }
});

// Meta's one-time webhook verification handshake
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) {
    log.info('webhook_verified');
    return res.status(200).send(req.query['hub.challenge']);
  }
  log.warn('webhook_verify_failed', { ip: req.ip });
  res.sendStatus(403);
});

const NON_TEXT_HINTS = {
  audio: 'Samahani, bado siwezi kusikiliza ujumbe wa sauti. Tafadhali andika, mfano: nimeuza 5000',
  other: 'Samahani, ninaelewa ujumbe wa maandishi tu. Andika, mfano: nimeuza 5000 au nimenunua unga 20000',
};
const HINT_TYPES = ['image', 'video', 'document', 'sticker', 'location', 'contacts'];

// Webhook work still running after the 200 ack; shutdown waits for it so no message is lost.
let inFlight = 0;

app.post('/webhook', async (req, res) => {
  if (!validSignature(req)) {
    log.warn('webhook_rejected', { ip: req.ip });
    return res.sendStatus(401);
  }
  res.sendStatus(200); // ack immediately — do the work after
  inFlight++;
  try {
    await processWebhook(req.body);
  } finally {
    inFlight--;
  }
});

async function processWebhook(body) {
  const started = Date.now();
  const value = body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];

  const receivedOn = value?.metadata?.phone_number_id;
  if (receivedOn && receivedOn !== process.env.WHATSAPP_PHONE_NUMBER_ID) {
    log.warn('phone_number_id_mismatch', { received_on: receivedOn, configured: process.env.WHATSAPP_PHONE_NUMBER_ID });
  }

  const status = value?.statuses?.[0];
  if (status) {
    if (status.status === 'failed') {
      log.warn('delivery_failed', { wa_id: status.id, to: log.mask(status.recipient_id), errors: status.errors });
    } else {
      log.debug('delivery_status', { wa_id: status.id, status: status.status });
    }
    return;
  }
  if (!msg) return;

  let vendorId;
  try {
    const phone = msg.from;
    const vendor = await getVendor(pool, phone);
    vendorId = vendor.id;

    const logged = await pool.query(
      `INSERT INTO messages_log (wa_message_id, vendor_id, phone_number, channel, direction, raw_payload)
       VALUES ($1, $2, $3, 'whatsapp', 'inbound', $4)
       ON CONFLICT (wa_message_id) DO NOTHING
       RETURNING id`,
      [msg.id, vendorId, phone, JSON.stringify(msg)]
    );
    if (logged.rowCount === 0) {
      log.info('duplicate_ignored', { id: msg.id, vendor: vendorId });
      return;
    }
    const messageId = logged.rows[0].id;
    log.info('message_received', { id: msg.id, type: msg.type, vendor: vendorId, from: log.mask(phone), new_vendor: vendor.created });

    const respond = async (handler, body) => {
      await sendText(phone, body);
      log.info('message_handled', { id: msg.id, vendor: vendorId, handler, ms: Date.now() - started });
    };

    if (vendor.created) await sendText(phone, WELCOME);

    if (msg.type !== 'text') {
      if (msg.type === 'audio') return respond('non_text', NON_TEXT_HINTS.audio);
      if (HINT_TYPES.includes(msg.type)) return respond('non_text', NON_TEXT_HINTS.other);
      return log.info('message_handled', { id: msg.id, vendor: vendorId, handler: 'ignored', ms: Date.now() - started });
    }

    const text = msg.text.body;

    const onboarding = await onboardingReply(pool, vendor, text);
    if (onboarding) return respond('onboarding', onboarding);
    if (vendor.created && !isActionable(text)) {
      return log.info('message_handled', { id: msg.id, vendor: vendorId, handler: 'welcome', ms: Date.now() - started });
    }

    const command = parseCommand(text);
    if (command) return respond(`command:${command}`, await commandReply(pool, vendorId, command));

    const reportSetting = await reportSettingReply(pool, vendorId, text);
    if (reportSetting) return respond('report_setting', reportSetting);

    const correction = parseCorrection(text);
    if (correction) return respond(`correction:${correction.action}`, await correctionReply(pool, vendorId, correction));

    const confirmation = await confirmationReply(pool, vendorId, text);
    if (confirmation) return respond('confirmation', confirmation);

    const debt = await debtReply(pool, vendorId, messageId, text);
    if (debt) return respond('debt', debt);

    return respond('ledger', await recordEntries(pool, vendorId, messageId, text));
  } catch (err) {
    log.error('message_failed', { id: msg.id, vendor: vendorId, error: err.message, stack: err.stack });
    if (msg.from) await sendText(msg.from, 'Samahani, kuna tatizo la mfumo. Tafadhali tuma tena baada ya muda mfupi.');
  }
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  log.info('server_started', { host: HOST, port: PORT, pid: process.pid });
  if (process.send) process.send('ready'); // PM2 wait_ready: old instance is stopped only after this
});

// Graceful shutdown (PM2 reload/restart, systemd stop): stop accepting, finish in-flight work, then exit.
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutdown_started', { signal, in_flight: inFlight, pid: process.pid });
  server.close();                // stop accepting new connections
  server.closeIdleConnections(); // drop idle keep-alive connections so clients reconnect to a live instance
  const deadline = Date.now() + 10000;
  while (inFlight > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  await pool.end().catch(() => {});
  log.info('shutdown_complete', { in_flight: inFlight, pid: process.pid });
  process.stdout.write('', () => process.exit(0)); // flush the log line before exiting
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
