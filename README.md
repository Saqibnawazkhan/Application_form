# Orbit Innovations — Careers Application Page

A single, fast application page plus a secure backend and a private admin dashboard
for reviewing candidates. No frontend framework, no build step, no external database.

```
Candidate  →  /            single-page form
Your team  →  /admin       password-protected dashboard
```

---

## Quick start

```bash
npm install
cp .env.example .env        # then edit .env (see below)
npm start
```

- Application form → <http://localhost:3000/>
- Admin dashboard → <http://localhost:3000/admin>

Requires **Node.js 22.5 or newer** (it uses the built-in `node:sqlite`, so there is
nothing to compile and no database server to run).

### Configure `.env`

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default `3000`) |
| `PUBLIC_URL` | Your live URL, e.g. `https://orbitinnovations.com/apply` |
| `ADMIN_PASSWORD` | Password for `/admin` — **change this** |
| `SESSION_SECRET` | Signs admin session cookies — **change this** |
| `TRUST_PROXY` | `true` when behind nginx / Caddy / Render / Railway |
| `MAX_UPLOAD_MB` | Max CV size (default `5`) |

Generate a strong session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

If `NODE_ENV=production` and either secret is missing, the server refuses to start
rather than running with a generated one.

---

## What the candidate sees

One page, in this order: header + logo → `Join Orbit Innovations` → the
`Hybrid — Remote + Onsite` badge → the three open roles → the form → a share
section → footer. Submitting swaps the form for the success screen without a
page reload.

The form collects every required field: name, email, phone, city, position,
work preference, experience, skills (multi-entry chips), portfolio/LinkedIn,
GitHub, CV upload, about, expected salary, availability (with an "Other"
free-text follow-up), and the accuracy confirmation checkbox.

Mobile details that matter for Instagram traffic: 16px inputs so iOS never
zooms on focus, `viewport-fit=cover` with safe-area padding, 48px minimum tap
targets, system fonts (no webfont download), and no layout that scrolls
sideways.

---

## Sharing on Instagram

Put any of these in the bio — all four serve the same page:

```
https://your-domain.com/
https://your-domain.com/apply
https://your-domain.com/careers
https://your-domain.com/jobs
```

The **Share Application** button uses the Web Share API and opens the native
share sheet on Android and iOS. Where that API does not exist (most desktop
browsers), the button becomes **Copy application link** instead.

Two optional query parameters:

- `?src=instagram` — recorded against the application so you can see which
  channel each candidate came from. Without it the server falls back to the
  referrer hostname.
- `?role=app-developer` — preselects a position. Accepts `website-developer`,
  `app-developer`, `digital-marketing-specialist`.

Example bio link: `https://your-domain.com/apply?src=instagram`

**Link previews:** `public/assets/og-cover.svg` is a ready-made 1200×630 cover.
Export it to PNG, save it as `public/assets/og-cover.png`, and uncomment the two
`og:image` lines near the top of `public/index.html`. WhatsApp and Facebook do
not render SVG previews, which is why it ships commented out.

---

## Admin dashboard

Sign in at `/admin` with `ADMIN_PASSWORD`. You get:

- Counts per status, and clicking a count filters to it
- Filters for status, position, free-text search (name, email, phone, city,
  skill or application ID), and a date range
- A row per application; clicking one opens the full candidate detail
- Status changes and internal notes (notes are never shown to candidates)
- CV download
- CSV export that respects the filters currently applied

Statuses: `New` (the default on submit) → `Reviewing` → `Shortlisted` →
`Interview` → `Offer` → `Hired`, plus `Rejected`.

---

## Stored data

Every application row in `data/applications.db`:

| Field | Notes |
| --- | --- |
| `application_id` | Human-readable, e.g. `ORB-2026-0042` |
| `created_at` / `updated_at` | ISO-8601 UTC |
| `full_name`, `email`, `phone`, `city` | Normalised on the server |
| `position`, `work_preference`, `experience` | Validated against fixed lists |
| `skills` | JSON array |
| `portfolio_url`, `github_url` | Normalised to absolute `https://` URLs |
| `cv_original_name`, `cv_stored_name`, `cv_mime`, `cv_size` | File lives in `uploads/` |
| `about`, `expected_salary`, `availability` | Optional |
| `status` | Defaults to `New` |
| `internal_notes` | Team-only |
| `source` | Where the candidate came from |
| `ip_hash`, `user_agent` | Salted hash only — for abuse review, not identification |

---

## Security

- **Everything is re-validated on the server.** The browser's checks only exist
  to give fast feedback; `src/validation.js` is the authority, and dropdown
  values are checked against allow-lists rather than trusted.
- **CV files are never publicly reachable.** They are written to `uploads/`
  (outside the static folder) under a random filename, and the only route that
  can read them requires an admin session. Filenames are re-derived from the
  database, so path traversal has nothing to attach to.
- **Uploads are checked by content, not just extension.** The magic bytes must
  match the claimed type — a `.exe` renamed to `.pdf` is rejected, and so is a
  text file with a `.pdf` extension. Limited to one file, 5 MB.
- **No candidate data is public.** There is no public read endpoint at all, so
  no candidate can reach another candidate's application. The dashboard and the
  entire `/admin/api` surface sit behind a signed, HttpOnly, SameSite=Strict
  session cookie (8-hour expiry).
- **Duplicate submissions are blocked** by a unique index on
  (email, position) — the same person can apply for different roles, but not
  twice for the same one. The submit button also locks while a request is in
  flight.
- **Spam defences:** a hidden honeypot field, a minimum 3-second fill time,
  10 submissions per hour per IP, and 10 sign-in attempts per 15 minutes.
- **Headers:** Helmet with a strict CSP (`default-src 'self'`, no inline
  scripts or styles, `frame-ancestors 'none'`).
- **CSV export is injection-safe** — cells starting with `=`, `+`, `-` or `@`
  are prefixed so a spreadsheet cannot execute them.

`.gitignore` excludes `.env`, `data/` and `uploads/`. Do not commit candidate data.

---

## Deploying

Any Node host works (Render, Railway, Fly, a VPS behind nginx). Two rules:

1. Set `NODE_ENV=production`, `TRUST_PROXY=true`, and real values for
   `ADMIN_PASSWORD`, `SESSION_SECRET` and `PUBLIC_URL`.
2. Put `data/` and `uploads/` on a **persistent disk**. On an ephemeral
   filesystem every deploy would wipe the applications and CVs.

Serve over HTTPS — session cookies are marked `Secure` in production.

### Backups

The whole dataset is two paths: `data/applications.db` and `uploads/`. Copy both
on the same schedule; a database backup without its CVs is only half a backup.

---

## Project layout

```
src/
  server.js              app wiring, security headers, static + aliases
  config.js              env config and startup checks
  db.js                  SQLite schema and queries
  validation.js          server-side field validation
  security.js            sessions, password check, IP hashing
  upload.js              CV type checking and safe storage
  routes/
    applications.js      POST /api/applications
    admin.js             sign-in, dashboard API, CV download, CSV export
public/                  the candidate-facing page
admin/                   the dashboard (served only to signed-in admins)
data/                    SQLite database (created on first run)
uploads/                 CV files (private)
```

---

## Changing things

- **Add or rename a position** — update `POSITIONS` in `src/validation.js`, the
  `<select>` and the role cards in `public/index.html`, and optionally the skill
  suggestions in `public/assets/app.js`.
- **Change the brand colour** — `--orange` in `public/assets/styles.css`.
- **Add a status** — `STATUSES` in `src/db.js`, plus a `.pill-<Name>` colour in
  `admin/admin.css`.
- **Email notifications** — the insert happens in
  `src/routes/applications.js`; send from there, after the row is created.
