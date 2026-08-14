'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('./config');

/**
 * CV handling.
 *
 * Files are buffered in memory, checked against both their extension and their
 * real magic bytes, then written to /uploads under a random name. That folder is
 * never served statically - the only way out is the authenticated admin route.
 */

const ALLOWED = [
  { ext: '.pdf', mime: 'application/pdf', magic: ['25504446'] }, // %PDF
  {
    ext: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: ['504b0304', '504b0506', '504b0708'], // ZIP container
  },
  { ext: '.doc', mime: 'application/msword', magic: ['d0cf11e0'] }, // OLE2 compound file
];

const ACCEPTED_EXTENSIONS = ALLOWED.map((entry) => entry.ext);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
    fields: 40,
    fieldSize: 8 * 1024,
  },
  fileFilter(req, file, callback) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      const error = new Error('Please upload your CV as a PDF, DOC or DOCX file.');
      error.code = 'INVALID_FILE_TYPE';
      return callback(error);
    }
    callback(null, true);
  },
});

/** Verify the bytes actually match the claimed extension. */
function detectType(buffer, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const entry = ALLOWED.find((item) => item.ext === ext);
  if (!entry) return null;

  const header = buffer.subarray(0, 8).toString('hex');
  const matches = entry.magic.some((signature) => header.startsWith(signature));
  return matches ? entry : null;
}

/** Strip any path/traversal characters from the name we show in the dashboard. */
function safeOriginalName(name) {
  const base = path.basename(String(name || 'cv'));
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'cv';
}

async function storeCv(file) {
  const detected = detectType(file.buffer, file.originalname);
  if (!detected) {
    const error = new Error('That file does not look like a valid PDF, DOC or DOCX.');
    error.code = 'INVALID_FILE_TYPE';
    throw error;
  }

  const storedName = `${Date.now().toString(36)}-${crypto.randomBytes(16).toString('hex')}${detected.ext}`;
  const destination = path.join(config.uploadDir, storedName);

  await fsp.mkdir(config.uploadDir, { recursive: true });
  await fsp.writeFile(destination, file.buffer, { mode: 0o600, flag: 'wx' });

  return {
    storedName,
    originalName: safeOriginalName(file.originalname),
    mime: detected.mime,
    size: file.size,
  };
}

/** Resolve a stored CV path, refusing anything that escapes the upload folder. */
function resolveCvPath(storedName) {
  const base = path.basename(String(storedName || ''));
  if (!base || !ACCEPTED_EXTENSIONS.includes(path.extname(base).toLowerCase())) return null;

  const resolved = path.resolve(config.uploadDir, base);
  if (path.dirname(resolved) !== path.resolve(config.uploadDir)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

async function removeCv(storedName) {
  const target = resolveCvPath(storedName);
  if (!target) return;
  await fsp.rm(target, { force: true });
}

module.exports = { upload, storeCv, resolveCvPath, removeCv, ACCEPTED_EXTENSIONS };
