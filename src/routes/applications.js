'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const config = require('../config');
const store = require('../db');
const { validateApplication, clean } = require('../validation');
const { upload, storeCv, removeCv } = require('../upload');
const { hashIp } = require('../security');

const router = express.Router();

/**
 * Max 10 submission attempts per hour from one IP. Deliberately above the three
 * open roles plus a few corrected mistakes, so a real candidate is never locked
 * out - the unique index is what actually stops duplicates.
 */
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    ok: false,
    error: 'Too many applications from this device. Please try again later.',
  },
});

function fileUpload(req, res, next) {
  upload.single('cv')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        ok: false,
        errors: { cv: `Your CV is too large. Maximum size is ${config.maxUploadBytes / (1024 * 1024)} MB.` },
      });
    }
    if (error.code === 'INVALID_FILE_TYPE') {
      return res.status(415).json({ ok: false, errors: { cv: error.message } });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE' || error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ ok: false, errors: { cv: 'Please attach a single CV file.' } });
    }
    return next(error);
  });
}

router.post('/applications', submitLimiter, fileUpload, async (req, res, next) => {
  const body = req.body || {};

  // --- Spam traps -----------------------------------------------------------
  // 1. Honeypot: a hidden field only a bot would fill in.
  if (clean(body.website, 100)) {
    // Look successful so the bot does not retry with a different shape.
    return res.status(202).json({ ok: true, applicationId: 'ORB-0000-0000' });
  }

  // 2. Humans do not complete this form in under three seconds.
  const startedAt = Number(body.startedAt);
  if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 3000) {
    return res.status(429).json({
      ok: false,
      error: 'That was a little too quick. Please review your details and submit again.',
    });
  }

  const { errors, data } = validateApplication(body);

  if (!req.file) {
    errors.cv = 'Please upload your CV or resume.';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  // --- Duplicate guard: one application per email, per position -------------
  const existing = store.findDuplicate(data.emailNormalized, data.position);
  if (existing) {
    return res.status(409).json({
      ok: false,
      duplicate: true,
      applicationId: existing.application_id,
      error: `You have already applied for ${data.position} with this email address. Our team already has your application (${existing.application_id}).`,
    });
  }

  let cv;
  try {
    cv = await storeCv(req.file);
  } catch (error) {
    if (error.code === 'INVALID_FILE_TYPE') {
      return res.status(415).json({ ok: false, errors: { cv: error.message } });
    }
    return next(error);
  }

  const now = new Date().toISOString();

  try {
    const { applicationId } = store.createApplication({
      created_at: now,
      updated_at: now,
      full_name: data.fullName,
      email: data.email,
      email_normalized: data.emailNormalized,
      phone: data.phone,
      phone_normalized: data.phoneNormalized,
      city: data.city,
      position: data.position,
      work_preference: data.workPreference,
      experience: data.experience,
      skills: JSON.stringify(data.skills),
      portfolio_url: data.portfolioUrl,
      github_url: data.githubUrl,
      cv_original_name: cv.originalName,
      cv_stored_name: cv.storedName,
      cv_mime: cv.mime,
      cv_size: cv.size,
      about: data.about,
      expected_salary: data.expectedSalary,
      availability: data.availability,
      source: clean(body.source, 60) || null,
      ip_hash: hashIp(req.ip),
      user_agent: clean(req.get('user-agent'), 250) || null,
    });

    return res.status(201).json({ ok: true, applicationId });
  } catch (error) {
    // Never leave an orphaned CV on disk if the insert fails.
    await removeCv(cv.storedName).catch(() => {});

    if (String(error.message || '').includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        ok: false,
        duplicate: true,
        error: `You have already applied for ${data.position} with this email address.`,
      });
    }
    return next(error);
  }
});

module.exports = router;
