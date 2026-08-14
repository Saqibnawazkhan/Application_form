'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');

const config = require('../config');
const store = require('../db');
const { POSITIONS } = require('../validation');
const { resolveCvPath } = require('../upload');
const {
  checkAdminPassword,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  requireAdmin,
} = require('../security');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Too many sign-in attempts. Please wait 15 minutes.' },
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

router.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/admin');
  res.sendFile(path.join(config.adminDir, 'login.html'));
});

// Assets the sign-in page itself needs (no session yet).
router.get('/admin.css', (req, res) => res.sendFile(path.join(config.adminDir, 'admin.css')));
router.get('/login.js', (req, res) => res.sendFile(path.join(config.adminDir, 'login.js')));

router.post('/api/login', loginLimiter, express.json(), (req, res) => {
  const password = String((req.body && req.body.password) || '');
  if (!password || !checkAdminPassword(password)) {
    return res.status(401).json({ ok: false, error: 'Incorrect password.' });
  }
  setSessionCookie(res, createSessionToken());
  res.json({ ok: true });
});

router.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Everything below this line requires a valid admin session.
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  res.sendFile(path.join(config.adminDir, 'index.html'));
});

router.get('/app.js', (req, res) => res.sendFile(path.join(config.adminDir, 'app.js')));

function toApplication(row) {
  let skills = [];
  try {
    skills = JSON.parse(row.skills);
  } catch {
    skills = [];
  }
  return {
    id: row.id,
    applicationId: row.application_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    position: row.position,
    workPreference: row.work_preference,
    experience: row.experience,
    skills,
    portfolioUrl: row.portfolio_url,
    githubUrl: row.github_url,
    cvFileName: row.cv_original_name,
    cvSize: row.cv_size,
    about: row.about,
    expectedSalary: row.expected_salary,
    availability: row.availability,
    status: row.status,
    internalNotes: row.internal_notes,
    source: row.source,
  };
}

router.get('/api/applications', (req, res) => {
  const { status, position, search, from, to, page, pageSize } = req.query;

  const result = store.listApplications({
    status: status ? String(status) : undefined,
    position: position ? String(position) : undefined,
    search: search ? String(search).slice(0, 100) : undefined,
    from: from ? `${String(from).slice(0, 10)}T00:00:00.000Z` : undefined,
    to: to ? `${String(to).slice(0, 10)}T23:59:59.999Z` : undefined,
    page: Number(page) || 1,
    pageSize: Number(pageSize) || 20,
  });

  res.json({
    ok: true,
    applications: result.rows.map(toApplication),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    stats: store.countsByStatus(),
    positions: POSITIONS,
    statuses: store.STATUSES,
  });
});

router.get('/api/applications/:id', (req, res) => {
  const row = store.getApplication(Number(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: 'Application not found.' });
  res.json({ ok: true, application: toApplication(row) });
});

router.patch('/api/applications/:id', express.json(), (req, res) => {
  const id = Number(req.params.id);
  const row = store.getApplication(id);
  if (!row) return res.status(404).json({ ok: false, error: 'Application not found.' });

  const body = req.body || {};
  let changed = false;

  if (typeof body.status === 'string') {
    if (!store.STATUSES.includes(body.status)) {
      return res.status(400).json({ ok: false, error: 'Unknown status.' });
    }
    changed = store.setStatus(id, body.status) || changed;
  }

  if (typeof body.internalNotes === 'string') {
    changed = store.setNotes(id, body.internalNotes) || changed;
  }

  if (!changed) return res.status(400).json({ ok: false, error: 'Nothing to update.' });

  res.json({ ok: true, application: toApplication(store.getApplication(id)) });
});

/** CV download - the only route that can ever read the uploads folder. */
router.get('/api/applications/:id/cv', (req, res) => {
  const row = store.getApplication(Number(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: 'Application not found.' });

  const filePath = resolveCvPath(row.cv_stored_name);
  if (!filePath) return res.status(404).json({ ok: false, error: 'CV file is missing from storage.' });

  const extension = path.extname(row.cv_stored_name);
  const downloadName = `${row.application_id}-${row.full_name.replace(/[^\w\- ]+/g, '')}${extension}`;

  res.setHeader('Content-Type', row.cv_mime);
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');

  fs.createReadStream(filePath).pipe(res);
});

/** CSV export of the current filter selection. */
router.get('/api/export.csv', (req, res) => {
  const { status, position, search, from, to } = req.query;
  const result = store.listApplications({
    status: status ? String(status) : undefined,
    position: position ? String(position) : undefined,
    search: search ? String(search).slice(0, 100) : undefined,
    from: from ? `${String(from).slice(0, 10)}T00:00:00.000Z` : undefined,
    to: to ? `${String(to).slice(0, 10)}T23:59:59.999Z` : undefined,
    page: 1,
    pageSize: 100000,
  });

  const columns = [
    'Application ID', 'Date & Time', 'Full Name', 'Email', 'Phone', 'City', 'Position',
    'Work Preference', 'Experience', 'Skills', 'Portfolio', 'GitHub', 'CV File',
    'About Candidate', 'Expected Salary', 'Availability', 'Status', 'Internal Notes',
  ];

  // Prefix formula characters so spreadsheet apps never execute a cell.
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${guarded.replace(/"/g, '""')}"`;
  };

  const lines = [columns.map(escape).join(',')];
  for (const row of result.rows) {
    let skills = '';
    try {
      skills = JSON.parse(row.skills).join('; ');
    } catch {
      skills = '';
    }
    lines.push(
      [
        row.application_id, row.created_at, row.full_name, row.email, row.phone, row.city,
        row.position, row.work_preference, row.experience, skills, row.portfolio_url,
        row.github_url, row.cv_original_name, row.about, row.expected_salary,
        row.availability, row.status, row.internal_notes,
      ].map(escape).join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="orbit-applications.csv"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(`﻿${lines.join('\r\n')}`);
});

module.exports = router;
