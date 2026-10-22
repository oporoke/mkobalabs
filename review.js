// Review messages the parser got wrong.
//   node review.js          list unreviewed feedback with what the parser does with it NOW
//   node review.js --done   mark everything listed as reviewed
require('dotenv').config({ quiet: true });
const pool = require('./db');
const { parseLedgerEntries } = require('./parser');

(async () => {
  const { rows } = await pool.query(
    `SELECT id, reason, text, detail, created_at FROM parse_feedback WHERE reviewed_at IS NULL ORDER BY id`
  );
  if (!rows.length) { console.log('No unreviewed feedback.'); return; }

  for (const r of rows) {
    const now = parseLedgerEntries(r.text).map(e => [e.type, e.amount, e.confidence]);
    console.log(`#${r.id}  ${r.reason.padEnd(14)} ${r.created_at.toISOString().slice(0, 16)}  ${JSON.stringify(r.text)}`);
    if (r.detail) console.log(`      detail: ${JSON.stringify(r.detail)}`);
    console.log(`      parser now: ${JSON.stringify(now)}`);
  }
  console.log(`\n${rows.length} unreviewed. Add the ones that matter to test.js, fix parser.js, then run: node review.js --done`);

  if (process.argv.includes('--done')) {
    await pool.query(`UPDATE parse_feedback SET reviewed_at = now() WHERE id = ANY($1::bigint[])`, [rows.map(r => r.id)]);
    console.log(`Marked ${rows.length} as reviewed.`);
  }
})()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
  