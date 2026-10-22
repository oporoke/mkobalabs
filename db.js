const { Pool } = require('pg');
const log = require('./log');

// Local database: no SSL. Remote database: set DATABASE_SSL=true (certificate is verified).
const useSsl = process.env.DATABASE_SSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
  connectionTimeoutMillis: 5000, // fail fast while the database is down instead of hanging
});

// An idle connection dropped by the server (e.g. a PostgreSQL restart) must not crash the app.
// The pool discards that connection and opens a new one on the next query.
pool.on('error', err => log.error('db_pool_error', { error: err.message, code: err.code }));

module.exports = pool;
