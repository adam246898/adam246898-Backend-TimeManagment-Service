// Creates the gw_* tables in the database from DATABASE_URL. Safe to run twice.   npm run db:init
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'gateway_tables.sql'), 'utf8'));
    console.log('gateway tables are ready.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`db:init failed: ${err.message}`);
  process.exit(1);
});
