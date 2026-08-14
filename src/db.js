'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new DatabaseSync(config.dbFile);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id    TEXT    UNIQUE,
    created_at        TEXT    NOT NULL,
    updated_at        TEXT    NOT NULL,

    full_name         TEXT    NOT NULL,
    email             TEXT    NOT NULL,
    email_normalized  TEXT    NOT NULL,
    phone             TEXT    NOT NULL,
    phone_normalized  TEXT    NOT NULL,
    city              TEXT    NOT NULL,
    position          TEXT    NOT NULL,
    work_preference   TEXT    NOT NULL,
    experience        TEXT    NOT NULL,
    skills            TEXT    NOT NULL,           -- JSON array of strings
    portfolio_url     TEXT,
    github_url        TEXT,

    cv_original_name  TEXT    NOT NULL,
    cv_stored_name    TEXT    NOT NULL,
    cv_mime           TEXT    NOT NULL,
    cv_size           INTEGER NOT NULL,

    about             TEXT,
    expected_salary   TEXT,
    availability      TEXT,

    status            TEXT    NOT NULL DEFAULT 'New',
    internal_notes    TEXT    NOT NULL DEFAULT '',

    source            TEXT,                        -- e.g. instagram (?src= / referrer)
    ip_hash           TEXT,
    user_agent        TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS ux_applications_email_position
    ON applications (email_normalized, position);

  CREATE INDEX IF NOT EXISTS ix_applications_created_at ON applications (created_at DESC);
  CREATE INDEX IF NOT EXISTS ix_applications_status     ON applications (status);
  CREATE INDEX IF NOT EXISTS ix_applications_position   ON applications (position);
`);

const STATUSES = ['New', 'Reviewing', 'Shortlisted', 'Interview', 'Offer', 'Rejected', 'Hired'];

const statements = {
  insert: db.prepare(`
    INSERT INTO applications (
      created_at, updated_at, full_name, email, email_normalized, phone, phone_normalized,
      city, position, work_preference, experience, skills, portfolio_url, github_url,
      cv_original_name, cv_stored_name, cv_mime, cv_size, about, expected_salary,
      availability, status, source, ip_hash, user_agent
    ) VALUES (
      :created_at, :updated_at, :full_name, :email, :email_normalized, :phone, :phone_normalized,
      :city, :position, :work_preference, :experience, :skills, :portfolio_url, :github_url,
      :cv_original_name, :cv_stored_name, :cv_mime, :cv_size, :about, :expected_salary,
      :availability, 'New', :source, :ip_hash, :user_agent
    )
  `),
  setApplicationId: db.prepare('UPDATE applications SET application_id = ? WHERE id = ?'),
  findDuplicate: db.prepare(
    'SELECT application_id, created_at FROM applications WHERE email_normalized = ? AND position = ?'
  ),
  getById: db.prepare('SELECT * FROM applications WHERE id = ?'),
  updateStatus: db.prepare('UPDATE applications SET status = ?, updated_at = ? WHERE id = ?'),
  updateNotes: db.prepare('UPDATE applications SET internal_notes = ?, updated_at = ? WHERE id = ?'),
};

/**
 * Insert an application and stamp it with a human-friendly ID (ORB-2026-0042).
 * Runs in a transaction so the row and its ID are always written together.
 */
function createApplication(record) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = statements.insert.run(record);
    const rowId = Number(result.lastInsertRowid);
    const year = new Date(record.created_at).getUTCFullYear();
    const applicationId = `ORB-${year}-${String(rowId).padStart(4, '0')}`;
    statements.setApplicationId.run(applicationId, rowId);
    db.exec('COMMIT');
    return { id: rowId, applicationId };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function findDuplicate(emailNormalized, position) {
  return statements.findDuplicate.get(emailNormalized, position);
}

function getApplication(id) {
  return statements.getById.get(id);
}

/** Paged + filtered listing for the admin dashboard. */
function listApplications({ status, position, search, from, to, page = 1, pageSize = 20 } = {}) {
  const where = [];
  const params = [];

  if (status && status !== 'all') {
    where.push('status = ?');
    params.push(status);
  }
  if (position && position !== 'all') {
    where.push('position = ?');
    params.push(position);
  }
  if (from) {
    where.push('created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(to);
  }
  if (search) {
    where.push(`(
      full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR city LIKE ?
      OR skills LIKE ? OR application_id LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = Number(
    db.prepare(`SELECT COUNT(*) AS n FROM applications ${whereSql}`).get(...params).n
  );

  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const rows = db
    .prepare(
      `SELECT * FROM applications ${whereSql} ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return { rows, total, page: Math.max(Number(page) || 1, 1), pageSize: limit };
}

function countsByStatus() {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM applications GROUP BY status').all();
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let total = 0;
  for (const row of rows) {
    counts[row.status] = Number(row.n);
    total += Number(row.n);
  }
  return { counts, total };
}

function setStatus(id, status) {
  if (!STATUSES.includes(status)) return false;
  const result = statements.updateStatus.run(status, new Date().toISOString(), id);
  return result.changes > 0;
}

function setNotes(id, notes) {
  const result = statements.updateNotes.run(String(notes).slice(0, 4000), new Date().toISOString(), id);
  return result.changes > 0;
}

module.exports = {
  db,
  STATUSES,
  createApplication,
  findDuplicate,
  getApplication,
  listApplications,
  countsByStatus,
  setStatus,
  setNotes,
};
