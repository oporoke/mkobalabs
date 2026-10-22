// Privacy (item 40): consent before anything is recorded, and full deletion on request.
const log = require('./log');
const { t } = require('./i18n');

const DELETE_CONFIRM_MINUTES = 10;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const CONSENT = new Set(['nakubali', 'ninakubali', 'kubali', 'nakubaliana', 'i agree', 'agree', 'i accept', 'accept', 'ndio', 'ndiyo', 'yes']);
const DELETE_REQUEST = new Set(['futa data', 'futa taarifa', 'futa taarifa zangu', 'futa data zangu', 'futa akaunti', 'futa akaunti yangu',
  'delete my data', 'delete data', 'delete my account', 'delete account']);
const DELETE_CONFIRM = new Set(['futa kabisa', 'delete everything']);

const parseConsent = text => CONSENT.has(norm(text));
const parseDeletion = text => (DELETE_REQUEST.has(norm(text)) ? 'request' : DELETE_CONFIRM.has(norm(text)) ? 'confirm' : null);

const privacyUrl = lang => `${process.env.PUBLIC_URL || 'https://mkoba.digital'}/${lang === 'en' ? 'privacy' : 'faragha'}`;

// Consent gate. Returns a reply while the vendor hasn't agreed (nothing else is processed); null once they have.
async function consentReply(pool, vendor, text, lang = 'sw') {
  if (vendor.consent_at) return null;
  const L = t(lang);
  if (!parseConsent(text)) return L.consentReminder(privacyUrl(lang));
  await pool.query('UPDATE vendors SET consent_at = now() WHERE id = $1', [vendor.id]);
  vendor.consent_at = new Date();
  log.info('consent_given', { vendor: vendor.id });
  return vendor.onboarding_step === 'ask_name' ? L.consentThanksNew : L.consentThanksExisting;
}

// "futa data" -> warning; "futa kabisa" within 10 minutes -> delete everything. Null if the text is neither.
async function deletionReply(pool, vendorId, text, lang = 'sw') {
  const kind = parseDeletion(text);
  if (!kind) return null;
  const L = t(lang);

  if (kind === 'request') {
    await pool.query('UPDATE vendors SET deletion_requested_at = now() WHERE id = $1', [vendorId]);
    return L.deletionWarn(DELETE_CONFIRM_MINUTES);
  }

  const { rows: [v] } = await pool.query(
    `SELECT deletion_requested_at > now() - interval '${DELETE_CONFIRM_MINUTES} minutes' AS confirmed FROM vendors WHERE id = $1`,
    [vendorId]
  );
  if (!v?.confirmed) return L.deletionNoRequest;

  const counts = await deleteVendorData(pool, vendorId);
  log.info('vendor_data_deleted', { vendor: vendorId, ...counts });
  return L.deletionDone;
}

// Permanently delete a vendor and everything linked to them, in one transaction.
async function deleteVendorData(pool, vendorId) {
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('BEGIN');
    for (const table of ['stock_items', 'statement_links', 'login_tokens', 'sessions', 'report_log', 'parse_feedback', 'transactions', 'messages_log']) {
      counts[table] = (await client.query(`DELETE FROM ${table} WHERE vendor_id = $1`, [vendorId])).rowCount;
    }
    counts.vendors = (await client.query('DELETE FROM vendors WHERE id = $1', [vendorId])).rowCount;
    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { consentReply, deletionReply, deleteVendorData, parseConsent, parseDeletion, privacyUrl };
