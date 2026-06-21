/**
 * Phone / login country helpers for student filters and analytics.
 */

const User = require('../models/User');
const UserActivityLog = require('../models/UserActivityLog');
const {
  COUNTRY_INDIA,
  COUNTRY_SRI_LANKA,
  COUNTRY_RUSSIA,
  COUNTRY_OTHER,
  COUNTRY_UNKNOWN,
  detectPhoneCountry,
} = require('./phoneCountryDetect');

const STUDENT_COUNTRY_FILTER_OPTIONS = [
  COUNTRY_INDIA,
  COUNTRY_SRI_LANKA,
  COUNTRY_RUSSIA,
  COUNTRY_OTHER,
  COUNTRY_UNKNOWN,
];

const ipCountryCache = new Map();
let phoneBackfillStarted = false;
let loginBackfillStarted = false;

/** Re-run phone country backfill (e.g. after detection rules change). */
function resetPhoneCountryBackfill() {
  phoneBackfillStarted = false;
}

function normalizeLoginCountry(name) {
  const n = String(name || '').trim();
  if (!n || n === COUNTRY_UNKNOWN) return COUNTRY_UNKNOWN;
  if (n === COUNTRY_INDIA || n === COUNTRY_SRI_LANKA || n === COUNTRY_RUSSIA) return n;
  return COUNTRY_OTHER;
}

function countryFromRequestHeaders(req) {
  const cf = req?.headers?.['cf-ipcountry'] || req?.headers?.['CF-IPCountry'];
  if (cf && String(cf).trim() && String(cf).trim().toUpperCase() !== 'XX') {
    return countryCodeToName(String(cf).trim().toUpperCase());
  }
  return null;
}

function countryCodeToName(code) {
  const map = {
    IN: COUNTRY_INDIA,
    LK: COUNTRY_SRI_LANKA,
    RU: COUNTRY_RUSSIA,
  };
  return map[code] || null;
}

async function countryFromIp(ip) {
  const key = String(ip || '').trim();
  if (!key) return COUNTRY_UNKNOWN;
  if (ipCountryCache.has(key)) return ipCountryCache.get(key);
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|localhost)/i.test(key)) {
    ipCountryCache.set(key, COUNTRY_UNKNOWN);
    return COUNTRY_UNKNOWN;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(key)}?fields=status,country`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const data = await res.json();
    const name =
      data?.status === 'success' && data?.country ? normalizeLoginCountry(data.country) : COUNTRY_UNKNOWN;
    ipCountryCache.set(key, name);
    return name;
  } catch {
    ipCountryCache.set(key, COUNTRY_UNKNOWN);
    return COUNTRY_UNKNOWN;
  }
}

async function resolveLoginCountry(req) {
  const fromHeader = countryFromRequestHeaders(req);
  if (fromHeader) return normalizeLoginCountry(fromHeader);

  const ip =
    req?.headers?.['x-forwarded-for']?.toString()?.split(',')?.[0]?.trim() || req?.ip || '';
  const fromIp = await countryFromIp(ip);
  return normalizeLoginCountry(fromIp);
}

function applyStudentCountryFilters(query, { phoneCountry, loginCountry }) {
  if (phoneCountry) {
    const pc = String(phoneCountry).trim();
    if (STUDENT_COUNTRY_FILTER_OPTIONS.includes(pc)) {
      query.phoneCountry = pc;
    }
  }
  if (loginCountry) {
    const lc = String(loginCountry).trim();
    if (STUDENT_COUNTRY_FILTER_OPTIONS.includes(lc)) {
      query.lastLoginCountry = lc;
    }
  }
}

async function recordStudentLogin(user, req) {
  if (!user || user.role !== 'STUDENT') return;
  try {
    const country = await resolveLoginCountry(req);
    user.lastLogin = new Date();
    user.lastLoginCountry = country;
    user.portalAbsenceReminderCount = 0;
    user.portalAbsenceReminderSentAt = null;
    await user.save();
    await UserActivityLog.create({
      userId: user._id,
      role: user.role,
      type: 'LOGIN',
      ip: req.headers['x-forwarded-for']?.toString()?.split(',')?.[0]?.trim() || req.ip || '',
      userAgent: req.headers['user-agent'] || '',
      country,
    });
  } catch (e) {
    console.warn('Failed to record login activity:', e?.message || e);
  }
}

async function backfillPhoneCountries() {
  const students = await User.find({ role: 'STUDENT' })
    .select('_id phoneNumber whatsappNumber phoneCountry')
    .lean();
  const ops = [];
  for (const s of students) {
    const next = detectPhoneCountry(s.phoneNumber, s.whatsappNumber);
    if (s.phoneCountry !== next) {
      ops.push({
        updateOne: {
          filter: { _id: s._id },
          update: { $set: { phoneCountry: next } },
        },
      });
    }
  }
  if (ops.length) {
    await User.bulkWrite(ops, { ordered: false });
    console.log(`[studentCountry] phoneCountry backfill updated ${ops.length} students`);
  }
}

async function backfillLoginCountriesFromLogs() {
  const latestByUser = await UserActivityLog.aggregate([
    { $match: { type: 'LOGIN', ip: { $exists: true, $ne: '' } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$userId',
        ip: { $first: '$ip' },
        logCountry: { $first: '$country' },
      },
    },
  ]);

  const ops = [];
  for (const row of latestByUser) {
    let country = row.logCountry ? normalizeLoginCountry(row.logCountry) : null;
    if (!country || country === COUNTRY_UNKNOWN) {
      country = await countryFromIp(row.ip);
    }
    ops.push({
      updateOne: {
        filter: {
          _id: row._id,
          role: 'STUDENT',
          $or: [{ lastLoginCountry: { $exists: false } }, { lastLoginCountry: '' }, { lastLoginCountry: null }],
        },
        update: { $set: { lastLoginCountry: country } },
      },
    });
  }
  if (ops.length) {
    await User.bulkWrite(ops, { ordered: false });
    console.log(`[studentCountry] loginCountry backfill updated ${ops.length} students`);
  }
}

function scheduleCountryBackfills({ forcePhone = false } = {}) {
  if (forcePhone) resetPhoneCountryBackfill();
  if (!phoneBackfillStarted) {
    phoneBackfillStarted = true;
    backfillPhoneCountries().catch((e) => console.warn('[studentCountry] phone backfill:', e?.message || e));
  }
  if (!loginBackfillStarted) {
    loginBackfillStarted = true;
    backfillLoginCountriesFromLogs().catch((e) =>
      console.warn('[studentCountry] login backfill:', e?.message || e)
    );
  }
}

module.exports = {
  COUNTRY_INDIA,
  COUNTRY_SRI_LANKA,
  COUNTRY_RUSSIA,
  COUNTRY_OTHER,
  COUNTRY_UNKNOWN,
  STUDENT_COUNTRY_FILTER_OPTIONS,
  detectPhoneCountry,
  normalizeLoginCountry,
  resolveLoginCountry,
  applyStudentCountryFilters,
  recordStudentLogin,
  scheduleCountryBackfills,
  resetPhoneCountryBackfill,
  backfillPhoneCountries,
};
