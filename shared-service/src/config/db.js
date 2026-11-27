const { Pool } = require('pg');
const config = require('./index');

// Created on first use, so tests (which mock this file) never need a database.
let pool;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
    pool.on('error', (err) => console.error('Unexpected database error:', err.message));
  }
  return pool;
}

// Always $1, $2 ... parameters. Never build SQL text from user input.
const query = (text, params) => getPool().query(text, params);

module.exports = { query };
