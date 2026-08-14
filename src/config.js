'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

require('dotenv').config();

const ROOT = path.join(__dirname, '..');

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

const isProduction = process.env.NODE_ENV === 'production';

const config = {
  root: ROOT,
  isProduction,
  port: Number(process.env.PORT || 3000),
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  trustProxy: bool(process.env.TRUST_PROXY, false),

  // Directories. `uploads` lives OUTSIDE the static folder on purpose:
  // CV files are only ever streamed through the authenticated admin route.
  dataDir: path.join(ROOT, 'data'),
  uploadDir: path.join(ROOT, 'uploads'),
  publicDir: path.join(ROOT, 'public'),
  adminDir: path.join(ROOT, 'admin'),
  dbFile: path.join(ROOT, 'data', 'applications.db'),

  maxUploadBytes: Math.round(Number(process.env.MAX_UPLOAD_MB || 5) * 1024 * 1024),

  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionTtlMs: 8 * 60 * 60 * 1000, // 8 hours
};

const warnings = [];

if (!config.adminPassword) {
  config.adminPassword = crypto.randomBytes(18).toString('base64url');
  warnings.push(
    `ADMIN_PASSWORD is not set. A temporary password was generated for this run: ${config.adminPassword}`
  );
}

if (!config.sessionSecret) {
  config.sessionSecret = crypto.randomBytes(48).toString('hex');
  warnings.push('SESSION_SECRET is not set. Using a random secret - admin sessions reset on restart.');
}

if (isProduction) {
  for (const message of warnings) {
    // In production these are hard failures: never ship with generated secrets.
    throw new Error(`[config] ${message}`);
  }
}

config.warnings = warnings;

module.exports = config;
