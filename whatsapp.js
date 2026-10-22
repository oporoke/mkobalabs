// WhatsApp Cloud API client: free-form text (inside the 24h window) and approved templates (anytime).
const axios = require('axios');
const log = require('./log');

const API = () => `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
const HEADERS = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' });

// --- send health, for /health (item 31) ---
const WINDOW_MS = 15 * 60 * 1000;
const SYSTEMIC_FAILURES = 3;
const AUTH_ERROR = 190;                         // invalid/expired token
const RECIPIENT_ERRORS = new Set([131026, 131047]); // problem with one recipient, not an outage
const events = [];                              // { t, ok, code }
let authBroken = false;                         // sticky: a bad token stays broken until a send succeeds
let wasHealthy = true;

function record(ok, code) {
  const now = Date.now();
  events.push({ t: now, ok, code });
  if (ok) authBroken = false;
  else if (code === AUTH_ERROR) authBroken = true;
  while (events.length && events[0].t < now - WINDOW_MS) events.shift();
  const h = sendHealth();
  if (wasHealthy && !h.ok) log.error('whatsapp_unhealthy', h);
  if (!wasHealthy && h.ok) log.info('whatsapp_recovered');
  wasHealthy = h.ok;
}

function sendHealth() {
  const now = Date.now();
  const recent = events.filter(e => e.t >= now - WINDOW_MS);
  const failures = recent.filter(e => !e.ok && !RECIPIENT_ERRORS.has(e.code));
  const successes = recent.filter(e => e.ok);
  if (authBroken) return { ok: false, reason: 'auth', code: AUTH_ERROR };
  if (failures.length >= SYSTEMIC_FAILURES && successes.length === 0) {
    return { ok: false, reason: 'failing', failures: failures.length, code: failures[failures.length - 1].code };
  }
  return { ok: true };
}

async function post(payload) {
  if (process.env.DRY_RUN === '1') {
    console.log('[DRY_RUN]', JSON.stringify(payload));
    return { ok: true, dryRun: true };
  }
  try {
    const { data } = await axios.post(API(), { messaging_product: 'whatsapp', ...payload }, { headers: HEADERS(), timeout: 15000 });
    const id = data.messages?.[0]?.id;
    log.debug('whatsapp_sent', { to: log.mask(payload.to), type: payload.type, wa_id: id });
    record(true);
    return { ok: true, id };
  } catch (err) {
    const error = err.response?.data?.error || { message: err.message };
    log.error('whatsapp_send_failed', { to: log.mask(payload.to), type: payload.type, code: error.code, error: error.message });
    record(false, error.code);
    return { ok: false, error };
  }
}

const sendText = (to, body) => post({ to, type: 'text', text: { body } });

// params: array of strings for {{1}}, {{2}}, ... in the template body
const sendTemplate = (to, name, lang, params) => post({
  to,
  type: 'template',
  template: {
    name,
    language: { code: lang },
    components: [{ type: 'body', parameters: params.map(text => ({ type: 'text', text: String(text) })) }],
  },
});

module.exports = { sendText, sendTemplate, sendHealth };
