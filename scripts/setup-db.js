'use strict';

// One-off database setup: creates the tables and indexes, then reports what is
// there. Safe to run repeatedly - everything uses IF NOT EXISTS.
//
//   npm run db:setup

const config = require('../src/config');
const store = require('../src/db');

async function main() {
  if (!config.databaseUrl) {
    console.error('\n  DATABASE_URL is not set. Add it to .env first.\n');
    process.exit(1);
  }

  const host = (() => {
    try {
      return new URL(config.databaseUrl).host;
    } catch {
      return 'unknown host';
    }
  })();

  console.log(`\n  Connecting to ${host} ...`);
  await store.ensureSchema();
  console.log('  Schema applied.');

  const pruned = await store.pruneRateLimits();
  if (pruned) console.log(`  Cleared ${pruned} expired rate-limit rows.`);

  const { total, counts } = await store.countsByStatus();
  console.log(`\n  Applications stored: ${total}`);
  for (const [status, count] of Object.entries(counts)) {
    if (count) console.log(`    ${status.padEnd(12)} ${count}`);
  }

  console.log('\n  Ready.\n');
  await store.pool.end();
}

main().catch(async (error) => {
  console.error('\n  Setup failed:', error.message, '\n');
  await store.pool.end().catch(() => {});
  process.exit(1);
});
