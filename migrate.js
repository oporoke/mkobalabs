// Database migrations: SQL files in migrations/, applied in name order, each once.
//   node migrate.js             apply pending migrations
//   node migrate.js --status    list applied / pending
//   node migrate.js --baseline  mark all current files as applied WITHOUT running them
//                               (only for a database that already has this schema)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const DIR = path.join(__dirname, 'migrations');

// pg_dump adds psql-only lines (\restrict, \unrestrict); they are not SQL.
const readSql = file => fs.readFileSync(path.join(DIR, file), 'utf8')
  .split('\n').filter(line => !line.startsWith('\\')).join('\n');

(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT version FROM public.schema_migrations');
  const applied = new Set(rows.map(r => r.version));
  const pending = files.filter(f => !applied.has(f));

  if (process.argv.includes('--status')) {
    for (const f of files) console.log(`${applied.has(f) ? 'applied' : 'PENDING'}  ${f}`);
    return;
  }

  if (process.argv.includes('--baseline')) {
    for (const f of pending) await pool.query('INSERT INTO public.schema_migrations (version) VALUES ($1)', [f]);
    console.log(pending.length ? `Baselined: ${pending.join(', ')}` : 'Nothing to baseline.');
    return;
  }

  if (!pending.length) { console.log('Database is up to date.'); return; }
  for (const f of pending) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readSql(f));
      await client.query('RESET search_path'); // pg_dump files clear it; restore before our own statements
      await client.query('INSERT INTO public.schema_migrations (version) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log(`Applied ${f}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`${f} failed, nothing from it was applied: ${err.message}`);
    } finally {
      client.release();
    }
  }
})()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
  