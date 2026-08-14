'use strict';

// Vercel serverless entrypoint. An Express app is already a (req, res) handler,
// so Vercel can invoke it directly. All dynamic routes are pointed here by the
// rewrites in vercel.json; static files under public/ are served by the CDN.

module.exports = require('../src/app');
