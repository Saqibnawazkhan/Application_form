'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
require('./db'); // opens the database and applies the schema on boot
const applicationRoutes = require('./routes/applications');
const adminRoutes = require('./routes/admin');

const app = express();

app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// A broad ceiling on top of the per-route limits.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  })
);

app.use('/admin', adminRoutes);
app.use('/api', applicationRoutes);

// ---------------------------------------------------------------------------
// Public page
// ---------------------------------------------------------------------------

app.use(
  express.static(config.publicDir, {
    index: 'index.html',
    maxAge: config.isProduction ? '1h' : 0,
    etag: true,
    setHeaders(res, filePath) {
      // The page itself must stay fresh; hashed-free assets get a short cache.
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// Clean, Instagram-bio friendly aliases for the same single page.
for (const alias of ['/apply', '/careers', '/jobs']) {
  app.get(alias, (req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    return res.status(404).json({ ok: false, error: 'Not found.' });
  }
  res.status(404).sendFile(path.join(config.publicDir, 'index.html'));
});

// ---------------------------------------------------------------------------
// Errors - never leak internals to the client.
// ---------------------------------------------------------------------------

app.use((error, req, res, next) => {
  console.error('[error]', error);
  if (res.headersSent) return next(error);
  res.status(500).json({
    ok: false,
    error: 'Something went wrong on our side. Please try again in a moment.',
  });
});

app.listen(config.port, () => {
  for (const warning of config.warnings) console.warn(`[warning] ${warning}`);
  console.log(`\n  Orbit Innovations - careers page`);
  console.log(`  Application form  ->  http://localhost:${config.port}/`);
  console.log(`  Admin dashboard   ->  http://localhost:${config.port}/admin`);
  console.log(`  Public URL        ->  ${config.publicUrl}\n`);
});
