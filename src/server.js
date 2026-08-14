'use strict';

// Local / self-hosted entrypoint. On Vercel the app is exported from api/index.js
// instead, and this file is never run.

const config = require('./config');
const app = require('./app');

app.listen(config.port, () => {
  for (const warning of config.warnings) console.warn(`[warning] ${warning}`);
  console.log(`\n  Orbit Innovations - careers page`);
  console.log(`  Application form  ->  http://localhost:${config.port}/`);
  console.log(`  Admin dashboard   ->  http://localhost:${config.port}/admin`);
  console.log(`  Public URL        ->  ${config.publicUrl}\n`);
});
