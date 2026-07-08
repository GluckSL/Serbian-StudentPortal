/**
 * Sales Dashboard — bucket counsellors by how recently they enrolled a student.
 *
 * CRM dates are DD-MM-YYYY (e.g. 08-07-2026 = 8 July 2026).
 *
 * Example today = 8 Jul:
 * Green  : 8–6 Jul  (0–2 days)
 * Yellow : 5–3 Jul  (3–5 days)
 * Red    : 2 Jul and older, or no enrollment
 *
 * Only watched counsellors (saved in Mongo) appear on the cards.
 */

const { fetchAllCrmRecords } = require('./crmPortalCompare');
const CrmSalesDashboardSettings = require('../models/CrmSalesDashboardSettings');

/** Inclusive day windows from today (local calendar). Boundary dates prefer greener bucket. */
const GREEN_MAX_DAYS = 2; // today through 2 days ago
const YELLOW_MAX_DAYS = 5; // 3–5 days ago

const SETTINGS_KEY = 'default';

/** First-time default team — user requested these 10 names. */
const DEFAULT_WATCH_NAMES = [
  'Vithusha',
  'Piraveena',
  'Dency',
  'Hashnath',
  'Hazna',
  'Dhushyanthini',
  'Shamaz',
  'Gogulawani',
  'Praveena',
  'Nivedha',
];

function parseEnrollmentParts(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    if (a > 12 && b >= 1 && b <= 12) {
      return { y, m: b, d: a };
    }
    if (b > 12 && a >= 1 && a <= 12) {
      return { y, m: a, d: b };
    }
    return { y, m: b, d: a };
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return {
    y: d.getFullYear(),
    m: d.getMonth() + 1,
    d: d.getDate(),
  };
}

function partsToIso({ y, m, d }) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayParts(now = new Date()) {
  return {
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    d: now.getDate(),
  };
}

function toUtcMidnight({ y, m, d }) {
  return Date.UTC(y, m - 1, d);
}

function daysSinceEnrollment(enrolledRaw, now = new Date()) {
  const parts = parseEnrollmentParts(enrolledRaw);
  if (!parts) return null;
  const enrolledMs = toUtcMidnight(parts);
  const todayMs = toUtcMidnight(todayParts(now));
  return Math.floor((todayMs - enrolledMs) / 86400000);
}

function formatEnrollmentDate(raw) {
  const parts = parseEnrollmentParts(raw);
  return parts ? partsToIso(parts) : null;
}

function counsellorName(row) {
  return String(row.assignedSalesRepresentative || row.counsellor || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function enrollmentDateOf(row) {
  return row.dateOfEnrollment || row.enrollmentDate || row.enrollment_date || '';
}

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** First token only — "Vithusha Vithusha" → "vithusha" */
function firstToken(name) {
  const n = normalizeName(name);
  if (!n) return '';
  return n.split(' ')[0] || '';
}

/**
 * Soft name match: watch key vs CRM display name.
 * "Vithusha" matches "Vithusha Vithusha"; "Hazna" matches "hazna hazna".
 * Also tolerates Dushyanthini / Dhushyanthini spelling.
 */
function namesMatch(watchName, crmName) {
  const w = normalizeName(watchName);
  const c = normalizeName(crmName);
  if (!w || !c) return false;
  if (w === c) return true;
  if (c.startsWith(w + ' ') || c.endsWith(' ' + w) || c.includes(' ' + w + ' ')) return true;

  const wt = firstToken(w);
  const ct = firstToken(c);
  if (wt && ct && wt === ct) return true;

  // Common CRM spelling variants
  const soft = (t) =>
    t
      .replace(/dhushyanthini/g, 'dushyanthini')
      .replace(/dushyanthini/g, 'dushyanthini');
  if (soft(wt) && soft(ct) && soft(wt) === soft(ct)) return true;

  return false;
}

function cleanNameList(names) {
  const seen = new Set();
  const out = [];
  for (const raw of names || []) {
    const n = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!n) continue;
    const key = normalizeName(n);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

async function getWatchlistSettings() {
  let doc = await CrmSalesDashboardSettings.findOne({ key: SETTINGS_KEY }).lean();
  if (!doc) {
    doc = (
      await CrmSalesDashboardSettings.create({
        key: SETTINGS_KEY,
        counsellorNames: DEFAULT_WATCH_NAMES,
        updatedBy: 'system-seed',
      })
    ).toObject();
  }
  return {
    counsellorNames: cleanNameList(doc.counsellorNames || []),
    updatedAt: doc.updatedAt || null,
    updatedBy: doc.updatedBy || '',
  };
}

async function saveWatchlistSettings(counsellorNames, updatedBy = '') {
  const cleaned = cleanNameList(counsellorNames);
  const doc = await CrmSalesDashboardSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    {
      $set: {
        counsellorNames: cleaned,
        updatedBy: String(updatedBy || '').trim(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return {
    counsellorNames: cleanNameList(doc.counsellorNames || []),
    updatedAt: doc.updatedAt || null,
    updatedBy: doc.updatedBy || '',
  };
}

function bucketCard(card) {
  if (card.daysSince != null && card.daysSince <= GREEN_MAX_DAYS) return 'green';
  if (card.daysSince != null && card.daysSince <= YELLOW_MAX_DAYS) return 'yellow';
  return 'red';
}

/**
 * @param {{ simple?: object, advanced?: object | null, counsellorNames?: string[] | null, crmRows?: object[] }} [query]
 *   If counsellorNames is provided, use that list (preview). Otherwise load saved DB watchlist.
 *   Pass crmRows to reuse a CRM pull from the same run (e.g. 7 PM cron).
 */
async function buildSalesDashboard(query = {}) {
  const simple = query.simple || {};
  const advanced = query.advanced || null;

  const rowsPromise = Array.isArray(query.crmRows)
    ? Promise.resolve(query.crmRows)
    : fetchAllCrmRecords('enrollment', { simple, advanced });

  const [rows, settings] = await Promise.all([rowsPromise, getWatchlistSettings()]);

  const watchNames =
    query.counsellorNames != null
      ? cleanNameList(query.counsellorNames)
      : settings.counsellorNames;

  const now = new Date();

  /** @type {Map<string, { name: string, lastEnrollment: string | null, daysSince: number | null, totalEnrollments: number, weeklyEnrollments: number, prevWeekDaysSince: number | null }>} */
  const byCounsellor = new Map();

  for (const row of rows) {
    const name = counsellorName(row);
    if (!name) continue;

    const key = normalizeName(name);
    const enrolledRaw = enrollmentDateOf(row);
    const enrolledDate = formatEnrollmentDate(enrolledRaw);
    const days = daysSinceEnrollment(enrolledRaw, now);

    let entry = byCounsellor.get(key);
    if (!entry) {
      entry = {
        name,
        lastEnrollment: null,
        daysSince: null,
        totalEnrollments: 0,
        weeklyEnrollments: 0,
        prevWeekDaysSince: null,
      };
      byCounsellor.set(key, entry);
    }

    entry.totalEnrollments += 1;

    if (days == null || days < 0) continue;

    // Enrollments in the last 7 calendar days (0–6) for "Average Activity"
    if (days <= 6) entry.weeklyEnrollments += 1;

    // "Last week" snapshot: days-since as of 7 days ago
    const prevDays = days - 7;
    if (prevDays >= 0) {
      if (entry.prevWeekDaysSince == null || prevDays < entry.prevWeekDaysSince) {
        entry.prevWeekDaysSince = prevDays;
      }
    }

    if (
      entry.daysSince == null ||
      days < entry.daysSince ||
      (days === entry.daysSince && enrolledDate && enrolledDate > (entry.lastEnrollment || ''))
    ) {
      entry.daysSince = days;
      entry.lastEnrollment = enrolledDate;
    }
  }

  const availableCounsellors = Array.from(byCounsellor.values())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const green = [];
  const yellow = [];
  const red = [];
  const usedCrmKeys = new Set();
  let prevGreen = 0;
  let prevYellow = 0;
  let prevRed = 0;

  // Build one card per watched name (prefer CRM match; else empty/red)
  for (const watch of watchNames) {
    let matched = null;
    for (const entry of byCounsellor.values()) {
      const key = normalizeName(entry.name);
      if (usedCrmKeys.has(key)) continue;
      if (namesMatch(watch, entry.name)) {
        matched = entry;
        usedCrmKeys.add(key);
        break;
      }
    }

    const card = matched
      ? {
          name: matched.name,
          watchName: watch,
          lastEnrollment: matched.lastEnrollment,
          daysSince: matched.daysSince,
          totalEnrollments: matched.totalEnrollments,
          weeklyEnrollments: matched.weeklyEnrollments,
          riskType:
            matched.daysSince == null
              ? 'No activity found'
              : matched.daysSince <= YELLOW_MAX_DAYS
                ? null
                : 'Delayed',
        }
      : {
          name: watch,
          watchName: watch,
          lastEnrollment: null,
          daysSince: null,
          totalEnrollments: 0,
          weeklyEnrollments: 0,
          riskType: 'No activity found',
        };

    const bucket = bucketCard(card);
    if (bucket === 'green') green.push(card);
    else if (bucket === 'yellow') yellow.push(card);
    else red.push(card);

    // Week-over-week bucket for trend (+/- from last week)
    const prevBucket = bucketCard({
      daysSince: matched ? matched.prevWeekDaysSince : null,
    });
    if (prevBucket === 'green') prevGreen += 1;
    else if (prevBucket === 'yellow') prevYellow += 1;
    else prevRed += 1;
  }

  const byRecencyThenName = (a, b) => {
    const da = a.daysSince == null ? 99999 : a.daysSince;
    const db = b.daysSince == null ? 99999 : b.daysSince;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  };

  green.sort(byRecencyThenName);
  yellow.sort(byRecencyThenName);
  red.sort((a, b) => {
    if (a.daysSince == null && b.daysSince != null) return 1;
    if (b.daysSince == null && a.daysSince != null) return -1;
    const da = a.daysSince == null ? -1 : a.daysSince;
    const db = b.daysSince == null ? -1 : b.daysSince;
    if (da !== db) return db - da;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return {
    green,
    yellow,
    red,
    watchedNames: watchNames,
    availableCounsellors,
    setupRequired: watchNames.length === 0,
    totals: {
      counsellors: watchNames.length,
      green: green.length,
      yellow: yellow.length,
      red: red.length,
      enrollmentsScanned: rows.length,
      availableCounsellors: availableCounsellors.length,
    },
    trends: {
      green: green.length - prevGreen,
      yellow: yellow.length - prevYellow,
      red: red.length - prevRed,
    },
    windows: {
      greenMaxDays: GREEN_MAX_DAYS,
      yellowMaxDays: YELLOW_MAX_DAYS,
    },
    settings: {
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildSalesDashboard,
  getWatchlistSettings,
  saveWatchlistSettings,
  daysSinceEnrollment,
  formatEnrollmentDate,
  parseEnrollmentParts,
  namesMatch,
  DEFAULT_WATCH_NAMES,
  GREEN_MAX_DAYS,
  YELLOW_MAX_DAYS,
};
