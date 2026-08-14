# Orbit Innovations — Careers Application Page

A single, fast application page plus a secure backend and a private admin dashboard
for reviewing candidates. No frontend framework, no build step.

```
Candidate  →  /            single-page form
Your team  →  /admin       password-protected dashboard
```

Runs on Vercel (serverless + Postgres) or on any ordinary Node host.

---

## Deploy to Vercel

### 1. Create the database

In the Vercel dashboard: **Storage → Create Database**, then under *Marketplace
Database Providers* pick **Neon** (Serverless Postgres) → **Create**. The free
plan is enough. Choose a region near your candidates and connect it to the
project.

In Neon's *Connect Project* dialog, set **Custom Environment Variable Prefix** to
`DATABASE`, which produces `DATABASE_URL`. The default prefix (`STORAGE`) also
works — the app checks `DATABASE_URL`, `POSTGRES_URL` and `STORAGE_URL` in that
order — but `DATABASE` is the clearest. Whichever you pick, the value Vercel
injects is already the pooled URL.

Leave both **Create Database Branch For Deployment** boxes unchecked. Branching
production would put live applications in a per-deployment branch.

Setting up Postgres yourself instead (Supabase, or Neon outside the
marketplace)? Set `DATABASE_URL` manually and use the **pooled** connection
string — the one with `-pooler` in the hostname. Serverless functions open a lot
of short-lived connections, and the pooler is what stops them exhausting the
database's connection limit.

### 2. Set environment variables

**Settings → Environment Variables:**

| Variable | Value |
| --- | --- |
| `ADMIN_PASSWORD` | A long random password for `/admin` |
| `SESSION_SECRET` | A long random string (command below) |

Those two are the whole list. You do not need to set `PUBLIC_URL` on Vercel —
the share button builds its link from `window.location` in the browser, so it is
always correct on whatever domain the page is served from.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

If either secret is missing in production the app refuses to start rather than
falling back to a generated one.

### 3. Deploy

Import the repo and deploy — there is no build step and no framework preset to
choose.

Vercel detects Express with zero configuration: it looks for the app at
`src/app.js` (among a few other conventional names) and, because that file
exports the app, turns the whole thing into one function. Everything under
`public/` is served from the CDN instead.

Two consequences worth knowing if you edit this later:

- **`express.static()` does nothing on Vercel.** Anything the browser must fetch
  directly belongs in `public/`. The clean URLs are pointed at the static
  `index.html` by the rewrites in `vercel.json`.
- **Do not set `outputDirectory`.** It makes Vercel search for the server
  entrypoint inside that folder, and the build fails with
  `No entrypoint found in output directory`.

The database schema is created automatically on the first request. To do it up
front instead, run `npm run db:setup` locally with `DATABASE_URL` pointing at the
same database.

---

## Run it locally

```bash
npm install
cp .env.example .env        # then edit .env
npm run db:setup            # creates the tables
npm start
```

- Application form → <http://localhost:3000/>
- Admin dashboard → <http://localhost:3000/admin>

Local development needs a Postgres to point `DATABASE_URL` at. The simplest
option is a second free Neon database (or a Neon branch) used as your dev
database — no local install required.

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (use the pooled one) |
| `ADMIN_PASSWORD` | Password for `/admin` |
| `SESSION_SECRET` | Signs admin session cookies |
| `PUBLIC_URL` | Cosmetic — only printed in the local startup banner |
| `MAX_UPLOAD_MB` | Max CV size, default `4` — see the limit note below |
| `PORT` | Local port, default `3000` |
| `TRUST_PROXY` | `true` when self-hosting behind nginx / Caddy (Vercel is detected automatically) |

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

`applications` — one row per submission:

| Field | Notes |
| --- | --- |
| `application_id` | Human-readable, e.g. `ORB-2026-0042` |
| `created_at` / `updated_at` | `timestamptz` |
| `full_name`, `email`, `phone`, `city` | Normalised on the server |
| `position`, `work_preference`, `experience` | Validated against fixed lists |
| `skills` | `jsonb` array |
| `portfolio_url`, `github_url` | Normalised to absolute `https://` URLs |
| `about`, `expected_salary`, `availability` | Optional |
| `status` | Defaults to `New` |
| `internal_notes` | Team-only |
| `source` | Where the candidate came from |
| `ip_hash`, `user_agent` | Salted hash only — for abuse review, not identification |

`application_files` — the CV, one row per application (`file_name`, `mime`,
`size`, `bytes`). It is a separate table so that listing applications never
pulls file data along with it.

`rate_limits` — shared spam counters.

### About CV storage

CVs are stored as bytes in Postgres rather than in object storage. Vercel Blob
serves files from a public URL, which would put candidate CVs one leaked link
away from the open web; keeping them in the database means the only way to read
one is the authenticated admin route.

The trade-off is database size. A typical CV is 100–500 KB and Neon's free tier
holds 0.5 GB, so roughly 1,000–5,000 CVs before you need a paid tier. To check:

```sql
SELECT pg_size_pretty(pg_total_relation_size('application_files'));
```

---

## Security

- **Everything is re-validated on the server.** The browser's checks only exist
  to give fast feedback; `src/validation.js` is the authority, and dropdown
  values are checked against allow-lists rather than trusted.
- **CV files are never publicly reachable.** They live in a table that only the
  authenticated admin download route reads. There is no URL, signed or
  otherwise, that serves a CV without a session.
- **Uploads are checked by content, not just extension.** The magic bytes must
  match the claimed type — a `.exe` renamed to `.pdf` is rejected, and so is a
  text file with a `.pdf` extension. Limited to one file.
- **No candidate data is public.** There is no public read endpoint at all, so
  no candidate can reach another candidate's application. The dashboard and the
  entire `/admin/api` surface sit behind a signed, HttpOnly, SameSite=Strict
  session cookie (8-hour expiry).
- **Duplicate submissions are blocked** by a unique index on
  (email, position) — the same person can apply for different roles, but not
  twice for the same one. The submit button also locks while a request is in
  flight.
- **Spam defences:** a hidden honeypot field, a minimum 3-second fill time,
  10 submissions per hour per IP, and 10 sign-in attempts per 15 minutes. The
  counters live in Postgres, not in memory — on serverless each instance has its
  own memory, so an in-process counter would reset constantly and protect
  nothing.
- **Headers:** a strict CSP (`default-src 'self'`, no inline scripts or styles,
  `frame-ancestors 'none'`) applied by Helmet on dynamic routes and by
  `vercel.json` on static ones.
- **CSV export is injection-safe** — cells starting with `=`, `+`, `-` or `@`
  are prefixed so a spreadsheet cannot execute them.

`.gitignore` excludes `.env`. Never commit real credentials.

---

## Upload size limit

Vercel rejects serverless request bodies larger than **4.5 MB** before they ever
reach the app, so `MAX_UPLOAD_MB` defaults to `4`. The limit is enforced in three
places, and all three must agree if you change it:

1. `MAX_UPLOAD_MB` in the environment
2. `MAX_FILE_BYTES` in `public/assets/app.js`
3. The "max 4 MB" hint text in `public/index.html`

Raising it above 4.5 only works when self-hosting, not on Vercel.

---

## Backups

Everything is in Postgres, so one dump covers applications and CVs together:

```bash
pg_dump "$DATABASE_URL" -Fc -f orbit-applications.dump
```

Neon also keeps point-in-time restore on paid plans.

---

## Project layout

```
src/
  app.js                 the Express app - also Vercel's zero-config entrypoint
  server.js              local / self-hosted listener
  config.js              env config and startup checks
  db.js                  Postgres schema, queries and rate limiting
  validation.js          server-side field validation
  security.js            sessions, password check, IP hashing
  upload.js              CV type checking
  routes/
    applications.js      POST /api/applications
    admin.js             sign-in, dashboard API, CV download, CSV export
public/                  the candidate-facing page (served by the CDN on Vercel)
admin/                   the dashboard (served only to signed-in admins)
scripts/setup-db.js      npm run db:setup
vercel.json              routing, function config and static security headers
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
