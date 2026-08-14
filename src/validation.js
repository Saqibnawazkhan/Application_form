'use strict';

/**
 * Server-side validation. The browser runs its own checks for a fast UX, but
 * nothing here trusts that: every field is re-validated and normalised below
 * before it can reach the database.
 */

const POSITIONS = ['Website Developer', 'App Developer', 'Digital Marketing Specialist'];
const WORK_PREFERENCES = ['Remote', 'Onsite', 'Hybrid'];
const EXPERIENCE_LEVELS = ['Fresher', 'Less than 1 year', '1–2 years', '2–3 years', '3+ years'];
const AVAILABILITY_OPTIONS = ['Immediately', 'Within 2 weeks', 'Within 1 month', 'Other'];

const EMAIL_RE =
  /^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}.'\-\s]*$/u;

// \p{Cc} = all C0/C1 control characters (includes tab, CR and LF).
const CONTROL_CHARS = /\p{Cc}/gu;

/** Collapse whitespace, strip control characters, and cap the length. */
function clean(value, maxLength = 500) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Same as clean() but keeps paragraph breaks (for the free-text areas). */
function cleanMultiline(value, maxLength = 2000) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(CONTROL_CHARS, ' ').replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function digitsOf(value) {
  return String(value).replace(/\D/g, '');
}

function normalizeUrl(value) {
  const raw = clean(value, 300);
  if (!raw) return { ok: true, value: null };

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, value: null };
  }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, value: null };
  if (!parsed.hostname.includes('.')) return { ok: false, value: null };
  return { ok: true, value: parsed.toString() };
}

function parseSkills(input) {
  let list = [];
  if (Array.isArray(input)) {
    list = input;
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        list = Array.isArray(parsed) ? parsed : trimmed.split(',');
      } catch {
        list = trimmed.split(',');
      }
    } else {
      list = trimmed.split(',');
    }
  }

  const seen = new Set();
  const skills = [];
  for (const entry of list) {
    const skill = clean(entry, 40);
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push(skill);
    if (skills.length >= 20) break;
  }
  return skills;
}

/**
 * @returns {{ errors: Record<string,string>, data: object }}
 */
function validateApplication(body) {
  const errors = {};
  const data = {};

  // --- Full name -----------------------------------------------------------
  data.fullName = clean(body.fullName, 100);
  if (!data.fullName) {
    errors.fullName = 'Please enter your full name.';
  } else if (data.fullName.length < 2) {
    errors.fullName = 'Name looks too short.';
  } else if (!NAME_RE.test(data.fullName)) {
    errors.fullName = 'Please use letters only (no numbers or symbols).';
  }

  // --- Email ---------------------------------------------------------------
  data.email = clean(body.email, 254).toLowerCase();
  if (!data.email) {
    errors.email = 'Please enter your email address.';
  } else if (!EMAIL_RE.test(data.email)) {
    errors.email = 'Please enter a valid email address.';
  }
  data.emailNormalized = data.email;

  // --- Phone ---------------------------------------------------------------
  data.phone = clean(body.phone, 25);
  const phoneDigits = digitsOf(data.phone);
  if (!data.phone) {
    errors.phone = 'Please enter your phone number.';
  } else if (!/^\+?[\d\s\-().]+$/.test(data.phone)) {
    errors.phone = 'Phone number can only contain digits, spaces and + - ( ).';
  } else if (phoneDigits.length < 8 || phoneDigits.length > 15) {
    errors.phone = 'Please enter a valid phone number (8–15 digits).';
  }
  data.phoneNormalized = (data.phone.startsWith('+') ? '+' : '') + phoneDigits;

  // --- City ----------------------------------------------------------------
  data.city = clean(body.city, 80);
  if (!data.city) {
    errors.city = 'Please enter your city.';
  } else if (data.city.length < 2) {
    errors.city = 'City name looks too short.';
  }

  // --- Fixed-choice fields -------------------------------------------------
  data.position = clean(body.position, 60);
  if (!data.position) {
    errors.position = 'Please select the position you are applying for.';
  } else if (!POSITIONS.includes(data.position)) {
    errors.position = 'Please select one of the open positions.';
  }

  data.workPreference = clean(body.workPreference, 20);
  if (!data.workPreference) {
    errors.workPreference = 'Please select your work preference.';
  } else if (!WORK_PREFERENCES.includes(data.workPreference)) {
    errors.workPreference = 'Please select a valid work preference.';
  }

  // Accept a plain hyphen from the wire, store the canonical en-dash label.
  data.experience = clean(body.experience, 30).replace(/(\d)\s*-\s*(\d)/, '$1–$2');
  if (!data.experience) {
    errors.experience = 'Please select your years of experience.';
  } else if (!EXPERIENCE_LEVELS.includes(data.experience)) {
    errors.experience = 'Please select a valid experience level.';
  }

  // --- Skills --------------------------------------------------------------
  const skills = parseSkills(body.skills);
  if (skills.length === 0) {
    errors.skills = 'Please add at least one skill.';
  }
  data.skills = skills;

  // --- Optional links ------------------------------------------------------
  const portfolio = normalizeUrl(body.portfolioUrl);
  if (!portfolio.ok) {
    errors.portfolioUrl = 'Please enter a valid URL (e.g. linkedin.com/in/yourname).';
  }
  data.portfolioUrl = portfolio.value;

  const github = normalizeUrl(body.githubUrl);
  if (!github.ok) {
    errors.githubUrl = 'Please enter a valid URL (e.g. github.com/yourname).';
  }
  data.githubUrl = github.value;

  // --- Free text -----------------------------------------------------------
  data.about = cleanMultiline(body.about, 2000) || null;
  data.expectedSalary = clean(body.expectedSalary, 60) || null;

  // --- Availability --------------------------------------------------------
  const availability = clean(body.availability, 30);
  if (availability && !AVAILABILITY_OPTIONS.includes(availability)) {
    errors.availability = 'Please select a valid availability option.';
  }
  if (availability === 'Other') {
    const note = clean(body.availabilityNote, 80);
    if (!note) {
      errors.availabilityNote = 'Please tell us when you can start.';
    }
    data.availability = note ? `Other — ${note}` : 'Other';
  } else {
    data.availability = availability || null;
  }

  // --- Confirmation --------------------------------------------------------
  const confirmed = body.confirm === true || body.confirm === 'true' || body.confirm === 'on';
  if (!confirmed) {
    errors.confirm = 'Please confirm that your information is accurate.';
  }

  return { errors, data };
}

module.exports = {
  POSITIONS,
  WORK_PREFERENCES,
  EXPERIENCE_LEVELS,
  AVAILABILITY_OPTIONS,
  validateApplication,
  clean,
  cleanMultiline,
};
