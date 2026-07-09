// services/engagementOverviewService.js
// Admin "Engagement Overview" — per-batch, per-week engagement heatmap.
//
// Engagement for a student in a given journey week = combined active learning
// time across Exercises + DG Bot (Gluck Buddy) + GlückArena, over that week's
// 7-day calendar window. Target is 6 hrs/week; bands:
//   red    < 40%   (< 2.4 h)
//   yellow 40–75%  (2.4–4.5 h)
//   green  >= 75%  (>= 4.5 h)
// Zero activity counts as red (under target).
//
// Reuses the exact time aggregators from languageTrackingAnalytics so the
// numbers match the existing Language Tracking / admin ENGAGEMENT % figures.

'use strict';

const BatchConfig = require('../models/BatchConfig');
const User = require('../models/User');
const {
  aggregateExerciseSeconds,
  aggregateDGSeconds,
  aggregateArenaSeconds,
} = require('./languageTrackingAnalytics.service');
const {
  computeJourneyDayFromBatchConfig,
  utcMidnightMs,
  MS_PER_DAY,
  JOURNEY_DAY_MAX,
} = require('../utils/journeyDay');
const { journeyWeekFromDay } = require('../utils/oldBatchDgWeekAccess');
const { isLearningEnabled } = require('../utils/batchType');

const TARGET_WEEKLY_SECONDS = 6 * 3600; // 6 hours
const TOTAL_WEEKS = Math.ceil(JOURNEY_DAY_MAX / 7); // 200 days -> ~29 weeks

/**
 * Engagement bands (based on 6 h/week target):
 *   red    0–3 h  (<  50% of target)
 *   yellow 3–6 h  (50–99% of target)
 *   green  6 h+   (>= 100% of target)
 */
function bandForPct(pct) {
  if (pct >= 100) return 'green';
  if (pct >= 50) return 'yellow';
  return 'red';
}

/** Students with 5–6 h engagement (just below the 6 h/week target). */
function isFiveToSixHours(seconds) {
  const hours = seconds / 3600;
  return hours >= 5 && hours < 6;
}

/**
 * Calendar window [from, to] for a batch's journey week.
 * Journey day 1 = batchStartDate's calendar day; week W = days (W-1)*7+1 .. W*7.
 */
function weekWindow(batchStartDate, week) {
  const w = Math.max(1, Math.floor(Number(week) || 1));
  const startMs = utcMidnightMs(new Date(batchStartDate));
  const from = new Date(startMs + (w - 1) * 7 * MS_PER_DAY);
  const to = new Date(startMs + w * 7 * MS_PER_DAY - 1); // inclusive end of day 7
  return { from, to };
}

/** Default overview week: last completed journey week (never future/current partial week). */
function defaultEngagementWeek(currentWeek) {
  const cw = Math.max(1, Math.floor(Number(currentWeek) || 1));
  return Math.max(1, cw - 1);
}
function secondsMap(byStudent) {
  const map = {};
  for (const row of byStudent || []) {
    map[String(row._id)] = (map[String(row._id)] || 0) + (row.seconds || 0);
  }
  return map;
}

/**
 * Engagement for one batch at one week.
 * week = 0  → "Overall": entire journey from batchStartDate to now.
 * week = N  → specific journey week N.
 * week = undefined/null → default to the batch's last completed journey week.
 * Batches without a journey start date fall back to a rolling last-7-days window.
 * @returns {Promise<object>} batch row with per-student blocks + band counts.
 */
async function getBatchEngagement(cfg, week, opts = {}) {
  const { lite = false } = opts;
  const batchName = cfg.batchName;
  const batchType = cfg.batchType || 'old';
  if (!isLearningEnabled(batchType)) {
    return null;
  }
  const hasJourney = Boolean(cfg.batchStartDate);
  const currentDay = hasJourney ? computeJourneyDayFromBatchConfig(cfg, new Date()) : null;
  const currentWeek = hasJourney ? Math.min(TOTAL_WEEKS, journeyWeekFromDay(currentDay || 1)) : null;

  const requestedWeek = week === undefined || week === null || week === ''
    ? NaN
    : Number(week);
  let selectedWeek;
  if (!hasJourney) {
    selectedWeek = null;
  } else if (requestedWeek === 0) {
    selectedWeek = 0; // Overall
  } else if (Number.isFinite(requestedWeek) && requestedWeek > 0) {
    selectedWeek = Math.min(TOTAL_WEEKS, Math.max(1, Math.floor(requestedWeek)));
  } else {
    selectedWeek = defaultEngagementWeek(currentWeek);
  }

  const students = await User.find({
    role: 'STUDENT',
    isActive: true,
    studentStatus: 'ONGOING',
    batch: batchName,
  })
    .select('_id name regNo level')
    .lean();

  const base = {
    batchName,
    batchType,
    hasJourney,
    currentWeek,
    selectedWeek,
    totalWeeks: TOTAL_WEEKS,
    targetHours: TARGET_WEEKLY_SECONDS / 3600,
    studentCount: students.length,
    students: [],
    bands: { red: 0, yellow: 0, green: 0, fiveToSix: 0 },
  };

  if (!students.length) {
    return base;
  }

  const studentIds = students.map((s) => s._id);
  let from;
  let to;
  if (hasJourney) {
    if (selectedWeek === 0) {
      // Overall: full journey from start date to now
      from = new Date(cfg.batchStartDate);
      to = new Date();
    } else {
      ({ from, to } = weekWindow(cfg.batchStartDate, selectedWeek));
    }
  } else {
    to = new Date();
    from = new Date(to.getTime() - 7 * MS_PER_DAY);
  }

  const [ex, dg, arena] = await Promise.all([
    aggregateExerciseSeconds(from, to, studentIds),
    aggregateDGSeconds(from, to, studentIds),
    aggregateArenaSeconds(from, to, studentIds),
  ]);

  const exMap = secondsMap(ex.byStudent);
  const dgMap = secondsMap(dg.byStudent);
  const arMap = secondsMap(arena.byStudent);

  if (lite) {
    for (const s of students) {
      const sid = String(s._id);
      const seconds = (exMap[sid] || 0) + (dgMap[sid] || 0) + (arMap[sid] || 0);
      const pct = Math.min(100, Math.round((seconds / TARGET_WEEKLY_SECONDS) * 100));
      base.bands[bandForPct(pct)] += 1;
      if (isFiveToSixHours(seconds)) base.bands.fiveToSix += 1;
    }
    return base;
  }

  const blocks = students.map((s) => {
    const sid = String(s._id);
    const seconds = (exMap[sid] || 0) + (dgMap[sid] || 0) + (arMap[sid] || 0);
    const pct = Math.min(100, Math.round((seconds / TARGET_WEEKLY_SECONDS) * 100));
    const band = bandForPct(pct);
    base.bands[band] += 1;
    if (isFiveToSixHours(seconds)) base.bands.fiveToSix += 1;
    return {
      studentId: sid,
      name: s.name || 'Student',
      regNo: s.regNo || '',
      level: s.level || '',
      hours: Math.round((seconds / 3600) * 10) / 10,
      minutes: Math.round(seconds / 60),
      pct,
      band,
      breakdown: {
        exerciseMin: Math.round((exMap[sid] || 0) / 60),
        dgMin: Math.round((dgMap[sid] || 0) / 60),
        arenaMin: Math.round((arMap[sid] || 0) / 60),
      },
    };
  });

  // Worst engagement first — red students surface at the front of each bar.
  blocks.sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));

  base.students = blocks;
  return base;
}

/** Run an async mapper over items with limited concurrency. */
async function mapWithConcurrency(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Every new/new2 journey batch that has active/ongoing students, sorted by batch number.
 * Only journey batches (batchStartDate set) with learning-enabled batch types appear.
 */
async function getActiveBatchConfigs() {
  const cfgs = await BatchConfig.find({
    batchType: { $in: ['new', 'new2'] },
    batchStartDate: { $ne: null },
    journeyActive: true,
  })
    .select('batchName batchStartDate batchType journeyActive trialAccessStartDate trialDayEnabled')
    .lean();

  if (!cfgs.length) return [];

  const batchNames = cfgs.map((c) => c.batchName);
  const studentBatches = await User.distinct('batch', {
    role: 'STUDENT',
    isActive: true,
    studentStatus: 'ONGOING',
    batch: { $in: batchNames },
  });

  const byName = new Map(cfgs.map((c) => [String(c.batchName), c]));
  const list = studentBatches
    .filter((name) => {
      const cfg = byName.get(String(name));
      return cfg && isLearningEnabled(cfg.batchType);
    })
    .map((name) => byName.get(String(name)));

  const batchNo = (name) => {
    const m = String(name || '').match(/\d+/);
    return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
  };
  return list.sort((a, b) => batchNo(a.batchName) - batchNo(b.batchName));
}

/**
 * Overview: every active batch at its current journey week, or at a selected
 * week when the global week filter is applied.
 * @returns {Promise<{ targetHours, totalWeeks, batches: object[] }>}
 */
async function getEngagementOverview(week) {
  const cfgs = await getActiveBatchConfigs();
  const batches = await mapWithConcurrency(cfgs, 10, (cfg) =>
    getBatchEngagement(cfg, week, { lite: true })
  );
  return {
    targetHours: TARGET_WEEKLY_SECONDS / 3600,
    totalWeeks: TOTAL_WEEKS,
    generatedAt: new Date(),
    batches: batches.filter(Boolean),
  };
}

/** One batch at a specific week (for the per-batch week dropdown). */
async function getSingleBatchEngagement(batchName, week) {
  const cfg = await BatchConfig.findOne({ batchName })
    .select('batchName batchStartDate batchType journeyActive trialAccessStartDate trialDayEnabled')
    .lean();
  if (!cfg || !isLearningEnabled(cfg.batchType) || !cfg.batchStartDate || !cfg.journeyActive) {
    return null;
  }
  return getBatchEngagement(cfg, week, { lite: false });
}

module.exports = {
  getEngagementOverview,
  getSingleBatchEngagement,
  getBatchEngagement,
  TARGET_WEEKLY_SECONDS,
  TOTAL_WEEKS,
  bandForPct,
  weekWindow,
  defaultEngagementWeek,
};
