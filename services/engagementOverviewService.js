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

const TARGET_WEEKLY_SECONDS = 6 * 3600; // 6 hours
const TOTAL_WEEKS = Math.ceil(JOURNEY_DAY_MAX / 7); // 200 days -> ~29 weeks

/** red / yellow / green from an engagement percentage (0 activity -> red). */
function bandForPct(pct) {
  if (pct >= 75) return 'green';
  if (pct >= 40) return 'yellow';
  return 'red';
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

/** Map an aggregator's byStudent array to { [studentId]: seconds }. */
function secondsMap(byStudent) {
  const map = {};
  for (const row of byStudent || []) {
    map[String(row._id)] = (map[String(row._id)] || 0) + (row.seconds || 0);
  }
  return map;
}

/**
 * Engagement for one batch at one week.
 * Batches without a journey start date fall back to a rolling last-7-days
 * window (weeks can't be mapped to calendar dates without Day 1).
 * @returns {Promise<object>} batch row with per-student blocks + band counts.
 */
async function getBatchEngagement(cfg, week) {
  const batchName = cfg.batchName;
  const hasJourney = Boolean(cfg.batchStartDate);
  const currentDay = hasJourney ? computeJourneyDayFromBatchConfig(cfg, new Date()) : null;
  const currentWeek = hasJourney ? Math.min(TOTAL_WEEKS, journeyWeekFromDay(currentDay || 1)) : null;
  const selectedWeek = hasJourney
    ? Math.min(TOTAL_WEEKS, Math.max(1, Math.floor(Number(week) || currentWeek)))
    : null;

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
    hasJourney,
    currentWeek,
    selectedWeek,
    totalWeeks: TOTAL_WEEKS,
    targetHours: TARGET_WEEKLY_SECONDS / 3600,
    studentCount: students.length,
    students: [],
    bands: { red: 0, yellow: 0, green: 0 },
  };

  if (!students.length) {
    return base;
  }

  const studentIds = students.map((s) => s._id);
  let from;
  let to;
  if (hasJourney) {
    ({ from, to } = weekWindow(cfg.batchStartDate, selectedWeek));
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

  const blocks = students.map((s) => {
    const sid = String(s._id);
    const seconds = (exMap[sid] || 0) + (dgMap[sid] || 0) + (arMap[sid] || 0);
    const pct = Math.min(100, Math.round((seconds / TARGET_WEEKLY_SECONDS) * 100));
    const band = bandForPct(pct);
    base.bands[band] += 1;
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
 * Every batch that has active/ongoing students, sorted by batch number.
 * Uses the BatchConfig (journey start date) when one exists; batches without
 * a config/start date are still included so no batch silently disappears.
 */
async function getActiveBatchConfigs() {
  const [cfgs, studentBatches] = await Promise.all([
    BatchConfig.find({ batchStartDate: { $ne: null } })
      .select('batchName batchStartDate journeyActive trialAccessStartDate trialDayEnabled')
      .lean(),
    User.distinct('batch', {
      role: 'STUDENT',
      isActive: true,
      studentStatus: 'ONGOING',
      batch: { $nin: [null, ''] },
    }),
  ]);

  const byName = new Map(cfgs.map((c) => [String(c.batchName), c]));
  const list = studentBatches.map(
    (name) => byName.get(String(name)) || { batchName: String(name), batchStartDate: null }
  );

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
  const batches = await mapWithConcurrency(cfgs, 5, (cfg) => getBatchEngagement(cfg, week));
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
    .select('batchName batchStartDate journeyActive trialAccessStartDate trialDayEnabled')
    .lean();
  return getBatchEngagement(cfg || { batchName, batchStartDate: null }, week);
}

module.exports = {
  getEngagementOverview,
  getSingleBatchEngagement,
  getBatchEngagement,
  TARGET_WEEKLY_SECONDS,
  TOTAL_WEEKS,
  bandForPct,
  weekWindow,
};
