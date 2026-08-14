'use strict';

const path = require('node:path');
const multer = require('multer');
const config = require('./config');

/**
 * CV handling.
 *
 * The file is buffered in memory and checked against both its extension and its
 * real magic bytes, then handed to the database layer. Nothing is ever written
 * to disk - the filesystem is read-only on Vercel, and keeping the bytes in
 * Postgres means the only way to read a CV is the authenticated admin route.
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
  return entry.magic.some((signature) => header.startsWith(signature)) ? entry : null;
}

/** Strip any path or traversal characters from the name shown in the dashboard. */
function safeOriginalName(name) {
  const base = path.basename(String(name || 'cv'));
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'cv';
}

/** Validate an uploaded CV and return the record to store. Throws on bad input. */
function prepareCv(file) {
  const detected = detectType(file.buffer, file.originalname);
  if (!detected) {
    const error = new Error('That file does not look like a valid PDF, DOC or DOCX.');
    error.code = 'INVALID_FILE_TYPE';
    throw error;
  }

  return {
    buffer: file.buffer,
    originalName: safeOriginalName(file.originalname),
    mime: detected.mime,
    size: file.size,
    extension: detected.ext,
  };
}

module.exports = { upload, prepareCv, ACCEPTED_EXTENSIONS };
