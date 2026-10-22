// Records messages the parser got wrong, for review (node review.js).
// reason: not_understood (bot replied "sikuelewa"), rejected (vendor said HAPANA), corrected (vendor used rekebisha)
const log = require('./log');

async function logFeedback(pool, { vendorId, messageId = null, text, reason, detail = null }) {
  try {
    await pool.query(
      `INSERT INTO parse_feedback (vendor_id, message_id, text, reason, detail) VALUES ($1, $2, $3, $4, $5)`,
      [vendorId, messageId, text, reason, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    log.error('feedback_log_failed', { error: err.message }); // never break the vendor's reply over this
  }
}

module.exports = { logFeedback };
