'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const store = require('../db');
const { POSITIONS } = require('../validation');
const {
  checkAdminPassword,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  requireAdmin,
  hashIp,
} = require('../security');

const router = express.Router();

/**
 * The dashboard's own files are read once at startup instead of being streamed
 * per request with res.sendFile.
 *
 * Vercel bundles only the files it can statically trace, and it ignores
 * express.static entirely. A literal __dirname read is traceable; a sendFile
 * path built at runtime is not - so this is what guarantees these files are
 * actually present in the deployed function. It also saves a disk read per hit.
 */
const ADMIN_DIR = path.join(__dirname, '..', '..', 'admin');
const ASSETS = {
  dashboardHtml: fs.readFileSync(path.join(ADMIN_DIR, 'index.html'), 'utf8'),
  loginHtml: fs.readFileSync(path.join(ADMIN_DIR, 'login.html'), 'utf8'),
  css: fs.readFileSync(path.join(ADMIN_DIR, 'admin.css'), 'utf8'),
  dashboardJs: fs.readFileSync(path.join(ADMIN_DIR, 'app.js'), 'utf8'),
  loginJs: fs.readFileSync(path.join(ADMIN_DIR, 'login.js'), 'utf8'),
};

function sendAsset(res, body, type) {
  res.type(type).set('Cache-Control', 'private, no-store').send(body);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

router.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/admin');
  sendAsset(res, ASSETS.loginHtml, 'html');
});

// Assets the sign-in page itself needs (no session yet).
router.get('/admin.css', (req, res) => sendAsset(res, ASSETS.css, 'css'));
router.get('/login.js', (req, res) => sendAsset(res, ASSETS.loginJs, 'js'));

router.post('/api/login', express.json(), async (req, res, next) => {
  try {
    const { allowed } = await store.consumeRateLimit(
      `login:${hashIp(req.ip)}`,
      10,
      15 * 60 * 1000
    );
    if (!allowed) {
      return res.status(429).json({ ok: false, error: 'Too many sign-in attempts. Please wait 15 minutes.' });
    }

    const password = String((req.body && req.body.password) || '');
    if (!password || !checkAdminPassword(password)) {
      return res.status(401).json({ ok: false, error: 'Incorrect password.' });
    }

    setSessionCookie(res, createSessionToken());
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
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

router.get('/', (req, res) => sendAsset(res, ASSETS.dashboardHtml, 'html'));

router.get('/app.js', (req, res) => sendAsset(res, ASSETS.dashboardJs, 'js'));

function toApplication(row) {
  return {
    id: row.id,
    applicationId: row.application_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    position: row.position,
    workPreference: row.work_preference,
    experience: row.experience,
    skills: Array.isArray(row.skills) ? row.skills : [],
    portfolioUrl: row.portfolio_url,
    githubUrl: row.github_url,
    cvFileName: row.cv_file_name,
    cvSize: row.cv_size,
    about: row.about,
    expectedSalary: row.expected_salary,
    availability: row.availability,
    status: row.status,
    internalNotes: row.internal_notes,
    source: row.source,
  };
}

function readFilters(query) {
  return {
    status: query.status ? String(query.status) : undefined,
    position: query.position ? String(query.position) : undefined,
    search: query.search ? String(query.search).slice(0, 100) : undefined,
    from: query.from ? `${String(query.from).slice(0, 10)}T00:00:00.000Z` : undefined,
    to: query.to ? `${String(query.to).slice(0, 10)}T23:59:59.999Z` : undefined,
  };
}

router.get('/api/applications', async (req, res, next) => {
  try {
    const result = await store.listApplications({
      ...readFilters(req.query),
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
    });

    res.json({
      ok: true,
      applications: result.rows.map(toApplication),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      stats: await store.countsByStatus(),
      positions: POSITIONS,
      statuses: store.STATUSES,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/applications/:id', async (req, res, next) => {
  try {
    const row = await store.getApplication(Number(req.params.id));
    if (!row) return res.status(404).json({ ok: false, error: 'Application not found.' });
    res.json({ ok: true, application: toApplication(row) });
  } catch (error) {
    next(error);
  }
});

router.patch('/api/applications/:id', express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await store.getApplication(id);
    if (!row) return res.status(404).json({ ok: false, error: 'Application not found.' });

    const body = req.body || {};
    let changed = false;

    if (typeof body.status === 'string') {
      if (!store.STATUSES.includes(body.status)) {
        return res.status(400).json({ ok: false, error: 'Unknown status.' });
      }
      changed = (await store.setStatus(id, body.status)) || changed;
    }

    if (typeof body.internalNotes === 'string') {
      changed = (await store.setNotes(id, body.internalNotes)) || changed;
    }

    if (!changed) return res.status(400).json({ ok: false, error: 'Nothing to update.' });

    res.json({ ok: true, application: toApplication(await store.getApplication(id)) });
  } catch (error) {
    next(error);
  }
});

/** CV download - the only route that can ever read a stored file. */
router.get('/api/applications/:id/cv', async (req, res, next) => {
  try {
    const file = await store.getApplicationFile(Number(req.params.id));
    if (!file) return res.status(404).json({ ok: false, error: 'CV not found.' });

    const extension = path.extname(file.file_name) || '';
    const downloadName = `${file.application_id}-${file.full_name.replace(/[^\w\- ]+/g, '')}${extension}`;

    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', file.bytes.length);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.bytes);
  } catch (error) {
    next(error);
  }
});

/** CSV export of the current filter selection. */
router.get('/api/export.csv', async (req, res, next) => {
  try {
    const rows = await store.listAllForExport(readFilters(req.query));

    const columns = [
      'Application ID', 'Date & Time', 'Full Name', 'Email', 'Phone', 'City', 'Position',
      'Work Preference', 'Experience', 'Skills', 'Portfolio', 'GitHub', 'CV File',
      'About Candidate', 'Expected Salary', 'Availability', 'Status', 'Internal Notes',
    ];

    // Prefix formula characters so spreadsheet apps never execute a cell.
    const escape = (value) => {
      let text;
      if (value === null || value === undefined) text = '';
      else if (value instanceof Date) text = value.toISOString();
      else text = String(value);
      const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${guarded.replace(/"/g, '""')}"`;
    };

    const lines = [columns.map(escape).join(',')];
    for (const row of rows) {
      lines.push(
        [
          row.application_id, row.created_at, row.full_name, row.email, row.phone, row.city,
          row.position, row.work_preference, row.experience,
          (Array.isArray(row.skills) ? row.skills : []).join('; '),
          row.portfolio_url, row.github_url, row.cv_file_name, row.about,
          row.expected_salary, row.availability, row.status, row.internal_notes,
        ].map(escape).join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orbit-applications.csv"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(`﻿${lines.join('\r\n')}`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
