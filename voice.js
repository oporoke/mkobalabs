// Voice notes (roadmap #10): a WhatsApp voice note is downloaded, turned into text with Google Cloud Speech-to-Text,
// and then handled exactly like a typed message (records, commands, shop orders, bulk orders).
//   WhatsApp: GET graph.facebook.com/<version>/<media id> -> { url }, then GET url with the access token (URL valid 5 min).
//   Google:   POST https://speech.googleapis.com/v1/speech:recognize, OGG_OPUS, sw-TZ (or en-US); synchronous requests
//             take audio of 1 minute or less.
// Settings (.env): GOOGLE_STT_CREDENTIALS = path to a service-account JSON file (recommended), or GOOGLE_STT_API_KEY.
const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');
const log = require('./log');

const MAX_SECONDS = 60;
const OPUS_RATES = [8000, 12000, 16000, 24000, 48000];
const configured = () => Boolean(process.env.GOOGLE_STT_CREDENTIALS || process.env.GOOGLE_STT_API_KEY);

// ---- WhatsApp media ----
async function downloadMedia(mediaId) {
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  const { data: meta } = await axios.get(`https://graph.facebook.com/v20.0/${encodeURIComponent(mediaId)}`, { headers: auth, timeout: 15000 });
  const { data } = await axios.get(meta.url, { headers: auth, responseType: 'arraybuffer', timeout: 30000, maxContentLength: 16 * 1024 * 1024 });
  return { buffer: Buffer.from(data), mime: meta.mime_type || '' };
}

// ---- Ogg/Opus header facts: input sample rate (OpusHead) and duration (last page's granule position, 48 kHz clock) ----
function oggInfo(buf) {
  const head = buf.indexOf('OpusHead');
  if (head < 0) return null;
  const preSkip = buf.readUInt16LE(head + 10);
  const inputRate = buf.readUInt32LE(head + 12);
  const last = buf.lastIndexOf('OggS');
  let seconds = null;
  if (last >= 0 && last + 14 <= buf.length) {
    const granule = Number(buf.readBigUInt64LE(last + 6));
    if (granule > 0) seconds = Math.max(0, (granule - preSkip) / 48000);
  }
  return { inputRate, seconds };
}

// ---- Google auth: service account (JWT -> access token, cached) or API key ----
let cached = { token: null, exp: 0 };
async function accessToken() {
  if (cached.token && cached.exp > Date.now() + 60e3) return cached.token;
  const sa = JSON.parse(fs.readFileSync(process.env.GOOGLE_STT_CREDENTIALS, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const { data } = await axios.post('https://oauth2.googleapis.com/token',
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

async function recognize(buffer, lang, rate) {
  const body = {
    config: { encoding: 'OGG_OPUS', sampleRateHertz: rate, languageCode: lang === 'en' ? 'en-US' : 'sw-TZ', maxAlternatives: 1 },
    audio: { content: buffer.toString('base64') },
  };
  const url = 'https://speech.googleapis.com/v1/speech:recognize';
  const opts = { timeout: 30000, headers: { 'Content-Type': 'application/json' } };
  if (process.env.GOOGLE_STT_CREDENTIALS) opts.headers.Authorization = `Bearer ${await accessToken()}`;
  else opts.params = { key: process.env.GOOGLE_STT_API_KEY };
  const { data } = await axios.post(url, body, opts);
  const results = data.results || [];
  const text = results.map(r => r.alternatives?.[0]?.transcript || '').join(' ').replace(/\s+/g, ' ').trim();
  const confs = results.map(r => r.alternatives?.[0]?.confidence).filter(c => typeof c === 'number');
  return { text, confidence: confs.length ? Math.min(...confs) : null };
}

// -> { ok: true, text, confidence } | { ok: false, reason: 'off' | 'too_long' | 'format' | 'empty' | 'error' }
async function transcribe(mediaId, lang = 'sw') {
  if (!configured()) return { ok: false, reason: 'off' };
  if (process.env.DRY_RUN === '1' && process.env.STT_DRY_TEXT) return { ok: true, text: process.env.STT_DRY_TEXT, confidence: 0.9 };
  try {
    const { buffer } = await downloadMedia(mediaId);
    const info = oggInfo(buffer);
    if (!info) return { ok: false, reason: 'format' };
    if (info.seconds != null && info.seconds > MAX_SECONDS) return { ok: false, reason: 'too_long' };
    const rate = OPUS_RATES.includes(info.inputRate) ? info.inputRate : 48000;
    const r = await recognize(buffer, lang, rate);
    log.info('voice_transcribed', { seconds: info.seconds && Math.round(info.seconds), chars: r.text.length, confidence: r.confidence });
    return r.text ? { ok: true, ...r } : { ok: false, reason: 'empty' };
  } catch (err) {
    log.error('voice_failed', { status: err.response?.status, error: err.response?.data?.error?.message || err.message });
    return { ok: false, reason: 'error' };
  }
}

const W = {
  sw: { heard: t => `🎤 Nimesikia: "${t}"`, too_long: 'Ujumbe wa sauti ni mrefu kuliko dakika 1. Tafadhali tuma mfupi zaidi, au andika.',
    empty: 'Sikusikia maneno kwenye ujumbe wa sauti. Jaribu tena mahali penye utulivu, au andika.',
    error: 'Samahani, sikuweza kusikiliza ujumbe huu wa sauti sasa. Tafadhali andika, mfano: nimeuza 5000',
    format: 'Samahani, aina hii ya sauti siwezi kuisoma. Tuma ujumbe wa sauti wa WhatsApp, au andika.' },
  en: { heard: t => `🎤 I heard: "${t}"`, too_long: 'The voice note is longer than 1 minute. Please send a shorter one, or type.',
    empty: "I couldn't hear any words in the voice note. Try again somewhere quiet, or type.",
    error: "Sorry, I couldn't listen to this voice note right now. Please type, e.g.: sold 5000",
    format: "Sorry, I can't read this kind of audio. Send a WhatsApp voice note, or type." },
};
const words = lang => W[lang] || W.sw;

module.exports = { configured, transcribe, oggInfo, words, MAX_SECONDS };
