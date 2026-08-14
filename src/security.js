'use strict';

const crypto = require('node:crypto');
const config = require('./config');

const SESSION_COOKIE = 'orbit_admin';

function hmac(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

/** Constant-time string comparison that tolerates differing lengths. */
function safeEquals(a, b) {
  const bufA = crypto.createHash('sha256').update(String(a)).digest();
  const bufB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkAdminPassword(password) {
  return safeEquals(password, config.adminPassword);
}

function createSessionToken() {
  const payload = `${Date.now() + config.sessionTtlMs}.${crypto.randomBytes(16).toString('base64url')}`;
  return `${payload}.${hmac(payload)}`;
}

function verifySessionToken(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [expiresAt, nonce, signature] = parts;
  const payload = `${expiresAt}.${nonce}`;
  if (!safeEquals(signature, hmac(payload))) return false;

  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    if (!name) continue;
    jar[name] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return jar;
}

function setSessionCookie(res, token) {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(config.sessionTtlMs / 1000)}`,
  ];
  if (config.isProduction || config.trustProxy) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[SESSION_COOKIE]);
}

/** Express middleware guarding every admin route. */
function requireAdmin(req, res, next) {
  if (isAuthenticated(req)) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: 'Not signed in.' });
  }
  return res.redirect('/admin/login');
}

/**
 * Applicant IPs are only kept as a salted hash - enough to spot abuse,
 * not enough to be a stored identifier for anyone who reads the database.
 */
function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHmac('sha256', config.sessionSecret).update(String(ip)).digest('hex').slice(0, 32);
}

module.exports = {
  SESSION_COOKIE,
  checkAdminPassword,
  createSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  requireAdmin,
  hashIp,
};
