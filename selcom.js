// Selcom Checkout API client (mobile money: USSD push + payment page).
// Signing (developers.selcommobile.com): Authorization "SELCOM base64(API key)"; Timestamp ISO 8601 with offset;
// Digest = base64(HMAC-SHA256("timestamp=<ts>&k1=v1&k2=v2...", API secret)); Signed-Fields = "k1,k2,..." in the same order.
// Endpoints (as used by Selcom integrations): checkout/create-order-minimal, checkout/wallet-payment, checkout/order-status,
// checkout/cancel-order. Base: https://apigw.selcommobile.com/v1/ (live) or https://apigwtest.selcommobile.com/v1/ (test).
// Settings (.env): SELCOM_VENDOR, SELCOM_API_KEY, SELCOM_API_SECRET, SELCOM_LIVE=1 for live, SELCOM_BUYER_EMAIL (Selcom
// requires an email; vendors' customers usually have none), SELCOM_EXPIRY_MINUTES (default 60).
const crypto = require('crypto');
const axios = require('axios');
const log = require('./log');

const configured = () => Boolean(process.env.SELCOM_VENDOR && process.env.SELCOM_API_KEY && process.env.SELCOM_API_SECRET);
const base = () => `https://${process.env.SELCOM_LIVE === '1' ? 'apigw' : 'apigwtest'}.selcommobile.com/v1/`;

// "2026-10-23T11:46:00+03:00" (Tanzania time)
function timestamp(d = new Date()) {
  const t = new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 19);
  return `${t}+03:00`;
}

function headers(data, ts = timestamp()) {
  const keys = Object.keys(data);
  const signing = [`timestamp=${ts}`, ...keys.map(k => `${k}=${data[k]}`)].join('&');
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `SELCOM ${Buffer.from(process.env.SELCOM_API_KEY || '').toString('base64')}`,
    'Digest-Method': 'HS256',
    Digest: crypto.createHmac('sha256', process.env.SELCOM_API_SECRET || '').update(signing).digest('base64'),
    'Signed-Fields': keys.join(','),
    Timestamp: ts,
    'Cache-Control': 'no-cache',
  };
}

async function call(method, path, data) {
  if (process.env.DRY_RUN === '1') {
    console.log('[DRY_RUN selcom]', method, path, JSON.stringify(data));
    return { ok: true, dryRun: true, data: { result: 'SUCCESS', resultcode: '000', data: [{ payment_gateway_url: Buffer.from(`https://example.test/pay/${data.order_id}`).toString('base64'), payment_status: process.env.SELCOM_DRY_STATUS || 'PENDING', reference: 'DRY123' }] } };
  }
  try {
    const res = await axios({ method, url: base() + path, headers: headers(data), timeout: 20000,
      ...(method === 'GET' || method === 'DELETE' ? { params: data } : { data }) });
    return { ok: true, data: res.data };
  } catch (err) {
    const body = err.response?.data;
    log.error('selcom_failed', { path, status: err.response?.status, result: body?.result, code: body?.resultcode, message: body?.message || err.message });
    return { ok: false, data: body, error: body?.message || err.message };
  }
}

// Create a checkout order. Returns { ok, gatewayUrl, data }.
async function createOrder({ orderId, phone, name, amount, items = 1, webhook, redirect, cancel }) {
  const body = {
    vendor: process.env.SELCOM_VENDOR,
    order_id: orderId,
    buyer_email: process.env.SELCOM_BUYER_EMAIL || 'malipo@mkoba.digital',
    buyer_name: (name || 'Mteja').slice(0, 60),
    buyer_phone: phone,
    amount: Math.round(amount),
    currency: 'TZS',
    redirect_url: Buffer.from(redirect).toString('base64'),
    cancel_url: Buffer.from(cancel).toString('base64'),
    webhook: Buffer.from(webhook).toString('base64'),
    no_of_items: items,
    expiry: Number(process.env.SELCOM_EXPIRY_MINUTES || 60),
  };
  const r = await call('POST', 'checkout/create-order-minimal', body);
  const url64 = r.data?.data?.[0]?.payment_gateway_url;
  const ok = r.ok && (r.data?.result === 'SUCCESS' || r.data?.resultcode === '000');
  return { ok, gatewayUrl: url64 ? Buffer.from(url64, 'base64').toString() : null, data: r.data };
}

// Ask the wallet (M-Pesa, Airtel Money, Mixx by Yas, HaloPesa…) to show a PIN prompt on the payer's phone.
async function walletPush({ transid, orderId, phone }) {
  const r = await call('POST', 'checkout/wallet-payment', { transid, order_id: orderId, msisdn: phone });
  return { ok: r.ok && ['SUCCESS', 'INPROGRESS'].includes(r.data?.result), data: r.data };
}

// -> { status: 'paid' | 'pending' | 'failed', reference, transid, channel, raw }
async function orderStatus(orderId) {
  const r = await call('GET', 'checkout/order-status', { order_id: orderId });
  const row = r.data?.data?.[0] || {};
  const s = String(row.payment_status || '').toUpperCase();
  const status = s === 'COMPLETED' ? 'paid' : ['CANCELLED', 'CANCELED', 'USERCANCELED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(s) ? 'failed' : 'pending';
  return { ok: r.ok, status, reference: row.reference || null, transid: row.transid || null, channel: row.channel || null, raw: r.data };
}

module.exports = { configured, createOrder, walletPush, orderStatus, headers, timestamp };
