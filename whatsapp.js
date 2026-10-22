// WhatsApp Cloud API client: free-form text (inside the 24h window) and approved templates (anytime).
const axios = require('axios');
const log = require('./log');

const API = () => `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
const HEADERS = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' });

async function post(payload) {
  if (process.env.DRY_RUN === '1') {
    console.log('[DRY_RUN]', JSON.stringify(payload));
    return { ok: true, dryRun: true };
  }
  try {
    const { data } = await axios.post(API(), { messaging_product: 'whatsapp', ...payload }, { headers: HEADERS(), timeout: 15000 });
    const id = data.messages?.[0]?.id;
    log.debug('whatsapp_sent', { to: log.mask(payload.to), type: payload.type, wa_id: id });
    return { ok: true, id };
  } catch (err) {
    const error = err.response?.data?.error || { message: err.message };
    log.error('whatsapp_send_failed', { to: log.mask(payload.to), type: payload.type, code: error.code, error: error.message });
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

module.exports = { sendText, sendTemplate };
