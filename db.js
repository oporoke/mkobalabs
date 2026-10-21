const { Pool } = require('pg');

// Local database: no SSL. Remote database: set DATABASE_SSL=true (certificate is verified).
const useSsl = process.env.DATABASE_SSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: true } : false,
});

module.exports = pool;