'use strict';

const { Pool } = require('pg');
const config = require('./config');

/**
 * Postgres storage layer.
 *
 * CV bytes live in their own table so that listing applications never drags
 * megabytes of file data along with it. The file is only read by the
 * authenticated admin download route.
 */

function sslFor(url) {
  if (!url) return false;
  if (/@(localhost|127\.0\.0\.1)/.test(url)) return false;
  if (/sslmode=disable/.test(url)) return false;
  if (/sslmode=no-verify/.test(url)) return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslFor(config.databaseUrl),
  // One connection per serverless instance; a pooled (PgBouncer) URL does the
  // real multiplexing. Locally a small pool is fine.
  max: config.isVercel ? 1 : 10,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
});

pool.on('error', (error) => console.error('[db] idle client error', error));

const STATUSES = ['New', 'Reviewing', 'Shortlisted', 'Interview', 'Offer', 'Rejected', 'Hired'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS applications (
    id                SERIAL PRIMARY KEY,
    application_id    TEXT UNIQUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    full_name         TEXT NOT NULL,
    email             TEXT NOT NULL,
    email_normalized  TEXT NOT NULL,
    phone             TEXT NOT NULL,
    phone_normalized  TEXT NOT NULL,
    city              TEXT NOT NULL,
    position          TEXT NOT NULL,
    work_preference   TEXT NOT NULL,
    experience        TEXT NOT NULL,
    skills            JSONB NOT NULL DEFAULT '[]'::jsonb,
    portfolio_url     TEXT,
    github_url        TEXT,

    about             TEXT,
    expected_salary   TEXT,
    availability      TEXT,

    status            TEXT NOT NULL DEFAULT 'New',
    internal_notes    TEXT NOT NULL DEFAULT '',

    source            TEXT,
    ip_hash           TEXT,
    user_agent        TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS ux_applications_email_position
    ON applications (email_normalized, position);
  CREATE INDEX IF NOT EXISTS ix_applications_created_at ON applications (created_at DESC);
  CREATE INDEX IF NOT EXISTS ix_applications_status     ON applications (status);
  CREATE INDEX IF NOT EXISTS ix_applications_position   ON applications (position);

  CREATE TABLE IF NOT EXISTS application_files (
    application_id INTEGER PRIMARY KEY REFERENCES applications (id) ON DELETE CASCADE,
    file_name      TEXT    NOT NULL,
    mime           TEXT    NOT NULL,
    size           INTEGER NOT NULL,
    bytes          BYTEA   NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    key          TEXT PRIMARY KEY,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    hits         INTEGER     NOT NULL DEFAULT 0
  );
`;

let schemaPromise = null;

/** Idempotent, and cached per process so it costs one round trip per cold start. */
function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = pool.query(SCHEMA).catch((error) => {
      schemaPromise = null; // let the next request retry
      throw error;
    });
  }
  return schemaPromise;
}

/**
 * Insert the application and its CV in one transaction, and stamp a
 * human-readable ID (ORB-2026-0042) derived from the new row's serial id.
 */
async function createApplication(record, file) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO applications (
         full_name, email, email_normalized, phone, phone_normalized, city, position,
         work_preference, experience, skills, portfolio_url, github_url, about,
         expected_salary, availability, source, ip_hash, user_agent
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18
       )
       RETURNING id, created_at`,
      [
        record.full_name, record.email, record.email_normalized, record.phone,
        record.phone_normalized, record.city, record.position, record.work_preference,
        record.experience, JSON.stringify(record.skills), record.portfolio_url,
        record.github_url, record.about, record.expected_salary, record.availability,
        record.source, record.ip_hash, record.user_agent,
      ]
    );

    const { id, created_at: createdAt } = rows[0];

    // A separate statement: a data-modifying CTE could not see the row it just
    // inserted, because every sub-statement shares one snapshot.
    const applicationId = `ORB-${new Date(createdAt).getUTCFullYear()}-${String(id).padStart(4, '0')}`;
    await client.query('UPDATE applications SET application_id = $1 WHERE id = $2', [applicationId, id]);

    await client.query(
      `INSERT INTO application_files (application_id, file_name, mime, size, bytes)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, file.originalName, file.mime, file.size, file.buffer]
    );

    await client.query('COMMIT');
    return { id, applicationId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function findDuplicate(emailNormalized, position) {
  const { rows } = await pool.query(
    'SELECT application_id, created_at FROM applications WHERE email_normalized = $1 AND position = $2',
    [emailNormalized, position]
  );
  return rows[0] || null;
}

const LIST_COLUMNS = `
  a.id, a.application_id, a.created_at, a.updated_at, a.full_name, a.email, a.phone,
  a.city, a.position, a.work_preference, a.experience, a.skills, a.portfolio_url,
  a.github_url, a.about, a.expected_salary, a.availability, a.status, a.internal_notes,
  a.source, f.file_name AS cv_file_name, f.size AS cv_size
`;

async function getApplication(id) {
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS}
       FROM applications a
       LEFT JOIN application_files f ON f.application_id = a.id
      WHERE a.id = $1`,
    [id]
  );
  return rows[0] || null;
}

/** The CV itself - read only by the authenticated download route. */
async function getApplicationFile(id) {
  const { rows } = await pool.query(
    `SELECT f.file_name, f.mime, f.size, f.bytes, a.application_id, a.full_name
       FROM application_files f
       JOIN applications a ON a.id = f.application_id
      WHERE f.application_id = $1`,
    [id]
  );
  return rows[0] || null;
}

function buildFilters({ status, position, search, from, to }) {
  const where = [];
  const params = [];

  if (status && status !== 'all') {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  }
  if (position && position !== 'all') {
    params.push(position);
    where.push(`a.position = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`a.created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`a.created_at <= $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    where.push(`(
      a.full_name ILIKE $${n} OR a.email ILIKE $${n} OR a.phone ILIKE $${n}
      OR a.city ILIKE $${n} OR a.skills::text ILIKE $${n} OR a.application_id ILIKE $${n}
    )`);
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function listApplications(filters = {}) {
  const { whereSql, params } = buildFilters(filters);

  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS n FROM applications a ${whereSql}`,
    params
  );
  const total = totalResult.rows[0].n;

  const limit = Math.min(Math.max(Number(filters.pageSize) || 20, 1), 100);
  const page = Math.max(Number(filters.page) || 1, 1);

  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS}
       FROM applications a
       LEFT JOIN application_files f ON f.application_id = a.id
       ${whereSql}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );

  return { rows, total, page, pageSize: limit };
}

/** Every row matching the filters, for CSV export. Never includes file bytes. */
async function listAllForExport(filters = {}) {
  const { whereSql, params } = buildFilters(filters);
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS}
       FROM applications a
       LEFT JOIN application_files f ON f.application_id = a.id
       ${whereSql}
      ORDER BY a.created_at DESC, a.id DESC`,
    params
  );
  return rows;
}

async function countsByStatus() {
  const { rows } = await pool.query('SELECT status, COUNT(*)::int AS n FROM applications GROUP BY status');
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  let total = 0;
  for (const row of rows) {
    counts[row.status] = row.n;
    total += row.n;
  }
  return { counts, total };
}

async function setStatus(id, status) {
  if (!STATUSES.includes(status)) return false;
  const result = await pool.query(
    'UPDATE applications SET status = $1, updated_at = now() WHERE id = $2',
    [status, id]
  );
  return result.rowCount > 0;
}

async function setNotes(id, notes) {
  const result = await pool.query(
    'UPDATE applications SET internal_notes = $1, updated_at = now() WHERE id = $2',
    [String(notes).slice(0, 4000), id]
  );
  return result.rowCount > 0;
}

/**
 * Rate limiting has to live in the database: every serverless instance has its
 * own memory, so an in-process counter would reset constantly.
 */
async function consumeRateLimit(key, limit, windowMs) {
  const cutoff = new Date(Date.now() - windowMs);
  const { rows } = await pool.query(
    `INSERT INTO rate_limits (key, window_start, hits)
     VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN rate_limits.window_start < $2 THEN 1 ELSE rate_limits.hits + 1 END,
       window_start = CASE WHEN rate_limits.window_start < $2 THEN now() ELSE rate_limits.window_start END
     RETURNING hits`,
    [key, cutoff]
  );
  const hits = rows[0].hits;
  return { allowed: hits <= limit, hits };
}

/** Housekeeping for the rate-limit table; called by the setup script. */
async function pruneRateLimits() {
  const result = await pool.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");
  return result.rowCount;
}

module.exports = {
  pool,
  STATUSES,
  ensureSchema,
  createApplication,
  findDuplicate,
  getApplication,
  getApplicationFile,
  listApplications,
  listAllForExport,
  countsByStatus,
  setStatus,
  setNotes,
  consumeRateLimit,
  pruneRateLimits,
};
