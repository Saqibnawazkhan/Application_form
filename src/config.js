'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

require('dotenv').config();

const ROOT = path.join(__dirname, '..');

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

const isVercel = Boolean(process.env.VERCEL);
const isProduction = process.env.NODE_ENV === 'production' || isVercel;

const config = {
  root: ROOT,
  isProduction,
  isVercel,
  port: Number(process.env.PORT || 3000),
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, ''),

  // Vercel always sits behind a proxy, so the real client IP is in X-Forwarded-For.
  trustProxy: bool(process.env.TRUST_PROXY, isVercel),

  publicDir: path.join(ROOT, 'public'),
  adminDir: path.join(ROOT, 'admin'),

  /**
   * Connection string, under whichever name the provider used.
   *
   * Neon's Vercel integration names it after the prefix chosen when connecting
   * the project ("STORAGE" is the default, giving STORAGE_URL); Vercel Postgres
   * uses POSTGRES_URL; Neon and Supabase direct both use DATABASE_URL. Prefer
   * the pooled URL and never the explicitly unpooled one.
   */
  databaseUrl:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.STORAGE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    '',

  /**
   * Vercel rejects serverless request bodies over 4.5 MB before they ever reach
   * this code, so the CV cap has to stay under that ceiling.
   */
  maxUploadBytes: Math.round(Number(process.env.MAX_UPLOAD_MB || 4) * 1024 * 1024),

  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionTtlMs: 8 * 60 * 60 * 1000, // 8 hours
};

const warnings = [];

/**
 * In production these must come from the environment - never from a generated
 * fallback. Missing ones are reported rather than thrown, so a misconfigured
 * deployment answers with a readable message instead of crashing the function
 * at import time with an opaque 500.
 */
config.missingRequired = [];

if (isProduction) {
  if (!config.databaseUrl) config.missingRequired.push('DATABASE_URL');
  if (!config.adminPassword) config.missingRequired.push('ADMIN_PASSWORD');
  if (!config.sessionSecret) config.missingRequired.push('SESSION_SECRET');

  // Keep the app inert but functional enough to serve the notice below.
  if (!config.sessionSecret) config.sessionSecret = crypto.randomBytes(48).toString('hex');
  if (!config.adminPassword) config.adminPassword = crypto.randomBytes(18).toString('base64url');
} else {
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
  if (!config.databaseUrl) {
    warnings.push('DATABASE_URL is not set. Set it to your Postgres connection string.');
  }
}

if (config.maxUploadBytes > 4.5 * 1024 * 1024) {
  warnings.push('MAX_UPLOAD_MB is above 4.5 - Vercel will reject those uploads before they reach the app.');
}

config.warnings = warnings;

module.exports = config;
