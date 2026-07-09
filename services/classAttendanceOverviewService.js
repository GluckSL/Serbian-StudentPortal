// services/classAttendanceOverviewService.js
// Admin "Engagement Overview – Classes" tab.
// Shows live class attendance per student, per batch, per CEFR level.
//
// Bands (based on attendance %):
//   red    < 60%
//   yellow 60–80%
//   green  > 80%
//
// Level dropdown shows only levels up to the batch's current level.
// Meetings are filtered by courseDay ranges mapped to CEFR levels (journeyDay.js).

'use strict';

const BatchConfig = require('../models/BatchConfig');
const User = require('../models/User');
const MeetingLink = require('../models/MeetingLink');
const {
  computeJourneyDayFromBatchConfig,
  LEVEL_SCHEDULE,
} = require('../utils/journeyDay');

const LEVELS = ['A1', 'A2', 'B1', 'B2'];

/**
 * Attendance band:
 *   green  >= 80%
 *   yellow 60–79%
 *   red    < 60%
 */
function attendanceBand(pct) {
  if (pct >= 80) return 'green';
  if (pct >= 60) return 'yellow';
  return 'red';
}

/**
 * Resolve the current CEFR level for a batch config.
 * For 'old' batches uses oldBatchManualLevel.
 * For new/new2 batches derives from current journey day.
 */
function currentLevelForBatch(cfg) {
  if (cfg.batchType === 'old') {
    return cfg.oldBatchManualLevel || 'A1';
  }
  const currentDay = computeJourneyDayFromBatchConfig(cfg, new Date());
  for (let i = LEVEL_SCHEDULE.length - 1; i >= 0; i--) {
    if (currentDay >= LEVEL_SCHEDULE[i].dayStart) {
      return LEVEL_SCHEDULE[i].level;
    }
  }
  return 'A1';
}

/** Returns levels from A1 up to and including currentLevel. */
function availableLevels(currentLevel) {
  const idx = LEVELS.indexOf(currentLevel);
  if (idx === -1) return ['A1'];
  return LEVELS.slice(0, idx + 1);
}

/** courseDay range for a CEFR level (from LEVEL_SCHEDULE). */
function dayRangeForLevel(level) {
  const entry = LEVEL_SCHEDULE.find((e) => e.level === level);
  return entry ? { minDay: entry.dayStart, maxDay: entry.dayEnd } : null;
}

/**
 * Per-student attendance for one batch at one CEFR level.
 * level = undefined/null  → defaults to batch's current level.
 */
async function getBatchClassAttendance(cfg, level) {
  const batchName = cfg.batchName;
  const batchType = cfg.batchType || 'old';

  const currentLevel = currentLevelForBatch(cfg);
  const available = availableLevels(currentLevel);

  const selectedLevel =
    level && available.includes(level) ? level : currentLevel;

  const range = dayRangeForLevel(selectedLevel);

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
    currentLevel,
    selectedLevel,
    availableLevels: available,
    studentCount: students.length,
    students: [],
    bands: { red: 0, yellow: 0, green: 0 },
  };

  if (!students.length || !range) return base;

  // Meetings for this batch/level with recorded attendance
  const meetings = await MeetingLink.find({
    batch: batchName,
    courseDay: { $gte: range.minDay, $lte: range.maxDay },
    attendanceRecorded: true,
  })
    .select('attendance courseDay startTime')
    .lean();

  const totalMeetings = meetings.length;

  if (totalMeetings === 0) {
    // No attendance data yet — surface everyone as red at 0%
    base.students = students.map((s) => ({
      studentId: String(s._id),
      name: s.name || 'Student',
      regNo: s.regNo || '',
      level: s.level || '',
      attendedCount: 0,
      totalCount: 0,
      attendancePct: 0,
      band: 'red',
    }));
    base.bands.red = students.length;
    return base;
  }

  // Build studentId → attended classes count
  const attendedMap = {};
  for (const meeting of meetings) {
    for (const rec of meeting.attendance || []) {
      if (rec.attended) {
        const sid = String(rec.studentId);
        attendedMap[sid] = (attendedMap[sid] || 0) + 1;
      }
    }
  }

  const blocks = students.map((s) => {
    const sid = String(s._id);
    const attended = attendedMap[sid] || 0;
    const pct = Math.round((attended / totalMeetings) * 100);
    const band = attendanceBand(pct);
    base.bands[band] += 1;
    return {
      studentId: sid,
      name: s.name || 'Student',
      regNo: s.regNo || '',
      level: s.level || '',
      attendedCount: attended,
      totalCount: totalMeetings,
      attendancePct: pct,
      band,
    };
  });

  // Worst attendance first
  blocks.sort((a, b) => a.attendancePct - b.attendancePct || a.name.localeCompare(b.name));
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
 * Active new/new2 batch configs with journey started and ongoing students.
 */
async function getActiveClassBatchConfigs() {
  const [cfgs, studentBatches] = await Promise.all([
    BatchConfig.find({
      batchType: { $in: ['new', 'new2'] },
      batchStartDate: { $ne: null },
      journeyActive: true,
    })
      .select('batchName batchStartDate batchType journeyActive oldBatchManualLevel levelCalendarDates trialAccessStartDate trialDayEnabled journeyLength')
      .lean(),
    User.distinct('batch', {
      role: 'STUDENT',
      isActive: true,
      studentStatus: 'ONGOING',
      batch: { $nin: [null, ''] },
    }),
  ]);

  const batchSet = new Set(studentBatches.map(String));
  const list = cfgs.filter((cfg) => batchSet.has(String(cfg.batchName)));

  const batchNo = (name) => {
    const m = String(name || '').match(/\d+/);
    return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
  };
  return list.sort((a, b) => batchNo(a.batchName) - batchNo(b.batchName));
}

/**
 * Overview of class attendance across all active new/new2 batches.
 * level = default level for each batch unless overridden per-batch via the UI.
 */
async function getClassAttendanceOverview() {
  const cfgs = await getActiveClassBatchConfigs();
  const batches = await mapWithConcurrency(cfgs, 5, (cfg) =>
    getBatchClassAttendance(cfg, undefined)
  );
  return {
    generatedAt: new Date(),
    batches: batches.filter(Boolean),
  };
}

/** Single batch class attendance for a specific CEFR level. */
async function getSingleBatchClassAttendance(batchName, level) {
  const cfg = await BatchConfig.findOne({ batchName })
    .select('batchName batchStartDate batchType journeyActive oldBatchManualLevel levelCalendarDates trialAccessStartDate trialDayEnabled journeyLength')
    .lean();
  if (!cfg || !cfg.journeyActive) return null;
  return getBatchClassAttendance(cfg, level);
}

module.exports = {
  getClassAttendanceOverview,
  getSingleBatchClassAttendance,
  getBatchClassAttendance,
  attendanceBand,
  currentLevelForBatch,
  availableLevels,
};
