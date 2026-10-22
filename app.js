// HTTP layer: Express app, Meta signature check, routes.
const crypto = require('crypto');
const express = require('express');
const log = require('./log');
const pool = require('./db');
const { sendHealth } = require('./whatsapp');
const { processWebhook } = require('./webhook');
const { secureHeaders, page } = require('./html');
const dashboard = require('./dashboard');
const admin = require('./admin');

const state = { inFlight: 0, shuttingDown: false }; // read by index.js during shutdown

const app = express();
app.set('trust proxy', 'loopback'); // trust X-Forwarded-For only from nginx on this machine

// While shutting down, tell clients not to reuse this connection.
app.use((_req, res, next) => { if (state.shuttingDown) res.set('Connection', 'close'); next(); });
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

// Health check for uptime monitoring: 200 if the app, database and WhatsApp sending work; 503 otherwise.
app.get('/health', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), 3000));
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
  } catch (err) {
    log.error('health_check_failed', { error: err.message });
    return res.status(503).json({ status: 'error', reason: 'database' });
  }
  const wa = sendHealth();
  if (!wa.ok) return res.status(503).json({ status: 'error', reason: `whatsapp_${wa.reason}`, code: wa.code });
  res.json({ status: 'ok', uptime_s: Math.round(process.uptime()) });
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

app.post('/webhook', async (req, res) => {
  if (!validSignature(req)) {
    log.warn('webhook_rejected', { ip: req.ip });
    return res.sendStatus(401);
  }
  res.sendStatus(200); // ack immediately — do the work after
  state.inFlight++;    // shutdown waits for this, so an acknowledged message is never lost
  try {
    await processWebhook(req.body);
  } finally {
    state.inFlight--;
  }
});

// Web pages: vendor dashboard and admin.
app.use('/d', secureHeaders, dashboard.router);
app.use('/admin', secureHeaders, admin.router);

// Errors from web pages: log, show a plain error page (no internal details).
app.use((err, req, res, _next) => {
  log.error('web_error', { path: req.path, error: err.message, stack: err.stack });
  res.status(500).send(page('Hitilafu', '<div class="card"><h1>Kuna hitilafu</h1><p>Jaribu tena baada ya muda mfupi.</p></div>'));
});

module.exports = { app, state };
