'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');

const config = require('./config');
const store = require('./db');
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

/**
 * Apply the schema once per process. It is idempotent and cached, so this costs
 * a single round trip on a cold start and nothing afterwards.
 */
async function withSchema(req, res, next) {
  try {
    await store.ensureSchema();
    next();
  } catch (error) {
    next(error);
  }
}

app.use('/admin', withSchema, adminRoutes);
app.use('/api', withSchema, applicationRoutes);

// ---------------------------------------------------------------------------
// Public page
//
// On Vercel these files are served straight from the CDN and never reach this
// handler; locally this is what serves them.
// ---------------------------------------------------------------------------

app.use(
  express.static(config.publicDir, {
    index: 'index.html',
    maxAge: config.isProduction ? '1h' : 0,
    etag: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// Clean, Instagram-bio friendly aliases for the same single page.
for (const alias of ['/apply', '/careers', '/jobs']) {
  app.get(alias, (req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));
}

app.get('/healthz', async (req, res) => {
  try {
    await store.pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'unreachable' });
  }
});

app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    return res.status(404).json({ ok: false, error: 'Not found.' });
  }
  res.redirect(302, '/');
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

module.exports = app;
