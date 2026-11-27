const { Pool } = require('pg');
const config = require('./index');

// The pool is created on first use, so tests (which mock this file) never need a database.
// TLS: add ?sslmode=require to DATABASE_URL when the database supports it (RDS does).
let pool;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    }
    pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
    pool.on('error', (err) => console.error('Unexpected database error:', err.message));
  }
  return pool;
}

// Always use $1, $2 ... parameters. Never build SQL text from user input.
const query = (text, params) => getPool().query(text, params);

// Runs fn(client) inside BEGIN ... COMMIT; any error rolls everything back.
async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Lets one-off scripts (backup, restore) exit cleanly.
const end = () => (pool ? pool.end() : Promise.resolve());

module.exports = { query, transaction, end };
