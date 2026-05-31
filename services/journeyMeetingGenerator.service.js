/**
 * Journey-mode bulk schedule generation (IST) and conflict checks for Zoom MeetingLink rows.
 */

const MeetingLink = require('../models/MeetingLink');
const { findZoomHostOverlap } = require('./zoomMeetingLifecycle.service');

const TZ = 'Asia/Kolkata';
const MAX_AUTO_SLOTS = 500;

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** YYYY-MM-DD for an instant in Asia/Kolkata */
function istYmdFromMs(ms) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

/** HH:mm in IST */
function istHmFromMs(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(ms));
  const hh = parts.find((x) => x.type === 'hour')?.value || '00';
  const mm = parts.find((x) => x.type === 'minute')?.value || '00';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Sunday=0 .. Saturday=6 in IST for this instant */
function istWeekdaySun0(ms) {
  const long = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long'
  }).format(new Date(ms));
  const map = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6
  };
  return map[long] ?? 0;
}

/** @param {string} ymd YYYY-MM-DD @param {string} clock HH:mm */
function istSlotMs(ymd, clock) {
  const pad = String(clock || '').trim();
  return new Date(`${ymd}T${pad}:00+05:30`).getTime();
}

function addDaysToIstYmd(ymd, days) {
  const dt = new Date(`${ymd}T12:00:00+05:30`);
  dt.setTime(dt.getTime() + Number(days) * 86400000);
  return istYmdFromMs(dt.getTime());
}

/**
 * Whole calendar days from prev class date to next class date in IST (midday anchor).
 * Example: Fri → Mon = 3 (Sat + Sun + Mon offset from Fri).
 */
function istCalendarDaysBetween(prevYmd, nextYmd) {
  const t0 = new Date(`${prevYmd}T12:00:00+05:30`).getTime();
  const t1 = new Date(`${nextYmd}T12:00:00+05:30`).getTime();
  const diff = Math.round((t1 - t0) / 86400000);
  return Math.max(0, diff);
}

/**
 * @param {number} minMs minimum slot start instant (inclusive)
 * @param {Set<number>} weekdaysSun0
 * @param {string} clock HH:mm
 * @returns {{ ymd: string, ms: number, startLocal16: string } | null}
 */
function findNextSlotStartingAt(minMs, weekdaysSun0, clock) {
  let ymd = istYmdFromMs(minMs);
  for (let guard = 0; guard < 800; guard++) {
    const ms = istSlotMs(ymd, clock);
    const wd = istWeekdaySun0(ms);
    if (weekdaysSun0.has(wd) && ms >= minMs) {
      const startLocal16 = `${ymd}T${clock.trim().substring(0, 5)}`;
      return { ymd, ms, startLocal16 };
    }
    ymd = addDaysToIstYmd(ymd, 1);
  }
  return null;
}

/**
 * Next occurrence of a specific IST weekday at clock, on or after minMs.
 * @param {number} minMs
 * @param {number} weekdaySun0 0=Sun .. 6=Sat
 * @param {string} clock HH:mm
 */
function findFirstSlotOnWeekday(minMs, weekdaySun0, clock) {
  let ymd = istYmdFromMs(minMs);
  for (let guard = 0; guard < 800; guard++) {
    const ms = istSlotMs(ymd, clock);
    const wd = istWeekdaySun0(ms);
    if (wd === weekdaySun0 && ms >= minMs) {
      const startLocal16 = `${ymd}T${clock.trim().substring(0, 5)}`;
      return { ymd, ms, startLocal16 };
    }
    ymd = addDaysToIstYmd(ymd, 1);
  }
  return null;
}

function clampCourseDay(n) {
  const x = parseInt(String(n), 10);
  if (!Number.isFinite(x)) return null;
  return Math.min(200, Math.max(1, x));
}

/**
 * Build journey class schedule on selected IST weekdays.
 * Journey day for the first class = startingJourneyDay.
 * Each later class: previous journey day + IST calendar days since the previous class
 * (Mon→Wed +2, Fri→Mon +3 so Sat/Sun are included in the count).
 *
 * @param {object} p
 * @param {number[]} p.weekdaysSun0 Selected weekdays (0=Sun .. 6=Sat), e.g. [1,3,5] for Mon/Wed/Fri
 * @param {string} p.startClock "HH:mm" IST wall time
 * @param {number} p.startingJourneyDay
 * @param {number} p.targetJourneyDay
 * @param {number} [p.firstClassWeekdaySun0] If set (0–6), first class is the next occurrence of this weekday (must be selected).
 * @param {number} [p.durationMinutes=120]
 * @returns {{ schedules: Array<{ journeyDay: number, startTime: string, endTime: string }>, warnings: string[] }}
 */
function generateJourneySchedules(p) {
  const warnings = [];
  const weekdaysSun0 = new Set(
    (Array.isArray(p.weekdaysSun0) ? p.weekdaysSun0 : [])
      .map((d) => Number(d))
      .filter((d) => d >= 0 && d <= 6)
  );
  if (weekdaysSun0.size === 0) {
    return { schedules: [], warnings: ['Select at least one weekday.'] };
  }

  const clock = String(p.startClock || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(clock)) {
    return { schedules: [], warnings: ['Invalid start time (use HH:mm).'] };
  }
  const [ch, cm] = clock.split(':').map((x) => parseInt(x, 10));
  const clockNorm = `${String(ch).padStart(2, '0')}:${String(cm).padStart(2, '0')}`;

  const startJ = clampCourseDay(p.startingJourneyDay);
  const endJ = clampCourseDay(p.targetJourneyDay);
  const durationMinutes = Math.max(1, parseInt(String(p.durationMinutes ?? 120), 10) || 120);

  if (!startJ || !endJ) {
    return { schedules: [], warnings: ['Invalid journey day range.'] };
  }
  if (startJ > endJ) {
    return { schedules: [], warnings: ['Starting journey day must be <= target journey day.'] };
  }

  const schedules = [];
  const nowMs = Date.now();
  let minMs = nowMs;
  let prevYmd = null;
  let prevJd = null;

  let firstSlotForced = null;
  const firstWdRaw = p.firstClassWeekdaySun0;
  if (firstWdRaw != null && firstWdRaw !== '' && String(firstWdRaw) !== 'auto') {
    const firstWd = Number(firstWdRaw);
    if (!Number.isFinite(firstWd) || firstWd < 0 || firstWd > 6) {
      return { schedules: [], warnings: ['Invalid first class weekday.'] };
    }
    if (!weekdaysSun0.has(firstWd)) {
      return {
        schedules: [],
        warnings: ['First class weekday must be one of the selected weekdays.']
      };
    }
    firstSlotForced = findFirstSlotOnWeekday(nowMs, firstWd, clockNorm);
    if (!firstSlotForced) {
      return { schedules: [], warnings: ['Could not find a valid first class date for that weekday.'] };
    }
  }

  while (schedules.length < MAX_AUTO_SLOTS) {
    const slot =
      firstSlotForced != null
        ? firstSlotForced
        : findNextSlotStartingAt(minMs, weekdaysSun0, clockNorm);
    if (firstSlotForced != null) {
      firstSlotForced = null;
    }
    if (!slot) {
      warnings.push('Could not find further valid dates within the search window.');
      break;
    }

    let jd;
    if (prevYmd === null) {
      jd = startJ;
    } else {
      jd = prevJd + istCalendarDaysBetween(prevYmd, slot.ymd);
    }

    if (jd > endJ) {
      break;
    }
    if (jd > 200) {
      warnings.push('Journey day would exceed 200; stopping.');
      break;
    }

    const endMs = slot.ms + durationMinutes * 60000;
    const endYmd = istYmdFromMs(endMs);
    const endHm = istHmFromMs(endMs);

    schedules.push({
      journeyDay: jd,
      startTime: slot.startLocal16,
      endTime: `${endYmd}T${endHm}`
    });

    prevYmd = slot.ymd;
    prevJd = jd;

    const nextYmd = addDaysToIstYmd(slot.ymd, 1);
    minMs = istSlotMs(nextYmd, '00:00');
  }

  if (schedules.length >= MAX_AUTO_SLOTS) {
    warnings.push(`Stopped at ${MAX_AUTO_SLOTS} classes (safety cap). Raise target or narrow range.`);
  }

  return { schedules, warnings };
}

/**
 * @param {object} body
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateSchedulePayload(body, opts = {}) {
  const { allowEmptyStudents = false } = opts;
  const errors = [];
  if (!body.batch) errors.push('batch is required');
  if (!body.plan) errors.push('plan is required');
  if (!body.topic || String(body.topic).trim().length < 3) errors.push('topic is required (min 3 chars)');
  if (!body.teacherId) errors.push('teacherId is required');
  if (!body.zoomHostEmail) errors.push('zoomHostEmail is required');
  if (!allowEmptyStudents && (!Array.isArray(body.studentIds) || body.studentIds.length === 0)) {
    errors.push('studentIds required');
  }
  const d = Number(body.duration || 120);
  if (!Number.isFinite(d) || d < 5 || d > 24 * 60) errors.push('duration invalid');
  const startJ = clampCourseDay(body.startingJourneyDay);
  const endJ = clampCourseDay(body.targetJourneyDay);
  if (!startJ || !endJ) errors.push('startingJourneyDay and targetJourneyDay must be 1–200');
  if (startJ && endJ && startJ > endJ) errors.push('startingJourneyDay must be <= targetJourneyDay');
  return { ok: errors.length === 0, errors };
}

async function findTeacherOverlap(teacherId, meetingStart, meetingEnd) {
  if (!teacherId) return null;
  return MeetingLink.findOne({
    assignedTeacher: teacherId,
    status: { $ne: 'cancelled' },
    startTime: { $lt: meetingEnd },
    $expr: {
      $gt: [
        { $add: ['$startTime', { $multiply: ['$duration', 60000] }] },
        meetingStart
      ]
    }
  }).lean();
}

/** Overlap for any of the given students */
async function findAnyStudentOverlap(studentIds, meetingStart, meetingEnd) {
  if (!studentIds || !studentIds.length) return null;
  const ids = studentIds.map((id) => id);
  const overlap = await MeetingLink.findOne({
    status: { $ne: 'cancelled' },
    startTime: { $lt: meetingEnd },
    $expr: {
      $gt: [
        { $add: ['$startTime', { $multiply: ['$duration', 60000] }] },
        meetingStart
      ]
    },
    'attendees.studentId': { $in: ids }
  })
    .select('topic batch startTime duration attendees')
    .lean();
  return overlap;
}

async function findDuplicateBatchCourseDay(batch, courseDay) {
  const batchRe = new RegExp(`^${escapeRegex(batch)}$`, 'i');
  const now = new Date();
  return MeetingLink.findOne({
    batch: batchRe,
    courseDay,
    status: { $ne: 'cancelled' },
    startTime: { $gt: now }
  })
    .select('topic startTime')
    .lean();
}

/**
 * Run conflict checks for one slot (no Zoom calls).
 * @returns {Promise<string[]>} human-readable warnings
 */
async function collectSlotConflicts({
  batch,
  teacherId,
  zoomHostEmail,
  studentIds,
  slotStartTime16,
  durationMinutes,
  courseDay
}) {
  const warnings = [];
  const meetingStart = new Date(`${slotStartTime16}:00+05:30`);
  if (meetingStart.getTime() < Date.now() - 60000) {
    warnings.push(`Past date skipped or invalid: ${slotStartTime16}`);
  }
  const meetingEnd = new Date(meetingStart.getTime() + durationMinutes * 60000);

  const hostHit = await findZoomHostOverlap(zoomHostEmail, meetingStart, meetingEnd);
  if (hostHit) {
    warnings.push(
      `Zoom host busy at ${slotStartTime16}: "${hostHit.topic || ''}"`
    );
  }

  const teachHit = await findTeacherOverlap(teacherId, meetingStart, meetingEnd);
  if (teachHit) {
    warnings.push(
      `Teacher overlap at ${slotStartTime16}: "${teachHit.topic || ''}"`
    );
  }

  const stHit =
    studentIds && studentIds.length
      ? await findAnyStudentOverlap(studentIds, meetingStart, meetingEnd)
      : null;
  if (stHit) {
    warnings.push(
      `Student overlap at ${slotStartTime16} with meeting "${stHit.topic || ''}" (${stHit.batch})`
    );
  }

  if (courseDay != null && Number.isFinite(Number(courseDay))) {
    const dup = await findDuplicateBatchCourseDay(batch, Number(courseDay));
    if (dup) {
      warnings.push(
        `Duplicate future meeting for batch journey day ${courseDay} (${dup.topic || 'meeting'})`
      );
    }
  }

  return warnings;
}

/**
 * @param {object} opts
 * @returns {Promise<{ schedules: object[], allWarnings: string[], blockingErrors: string[] }>}
 */
async function previewJourneyWithConflicts(opts) {
  const {
    batch,
    teacherId,
    zoomHostEmail,
    studentIds,
    durationMinutes,
    weekdaysSun0,
    startClock,
    startingJourneyDay,
    targetJourneyDay,
    firstClassWeekdaySun0
  } = opts;

  const gen = generateJourneySchedules({
    weekdaysSun0,
    startClock,
    startingJourneyDay,
    targetJourneyDay,
    firstClassWeekdaySun0,
    durationMinutes
  });

  const allWarnings = [...gen.warnings];
  const blockingErrors = [];

  for (const row of gen.schedules) {
    const w = await collectSlotConflicts({
      batch,
      teacherId,
      zoomHostEmail,
      studentIds,
      slotStartTime16: row.startTime,
      durationMinutes,
      courseDay: row.journeyDay
    });
    allWarnings.push(...w.map((x) => `[Day ${row.journeyDay}] ${x}`));
  }

  const v = validateSchedulePayload(
    {
      batch,
      plan: opts.plan,
      topic: opts.topic,
      teacherId,
      zoomHostEmail,
      studentIds,
      duration: durationMinutes,
      startingJourneyDay,
      targetJourneyDay
    },
    { allowEmptyStudents: true }
  );
  if (!v.ok) blockingErrors.push(...v.errors);

  return { schedules: gen.schedules, allWarnings, blockingErrors };
}

/**
 * Re-run conflict checks on admin-edited schedule rows (no regeneration).
 * @param {object} opts
 * @param {Array<{ journeyDay: number, startTime: string, endTime?: string }>} opts.schedules
 */
async function previewCustomJourneySchedules(opts) {
  const {
    batch,
    plan,
    topic,
    teacherId,
    zoomHostEmail,
    studentIds,
    durationMinutes,
    schedules,
    startingJourneyDay,
    targetJourneyDay
  } = opts;

  const rows = Array.isArray(schedules) ? schedules : [];
  const allWarnings = [];
  const blockingErrors = [];
  const dur = Math.max(1, parseInt(String(durationMinutes ?? 120), 10) || 120);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const jd = clampCourseDay(row.journeyDay);
    if (!jd) {
      blockingErrors.push(`Row ${i + 1}: journey day must be 1–200`);
      continue;
    }
    const start16 = String(row.startTime || '').trim().substring(0, 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start16)) {
      blockingErrors.push(`Row ${i + 1}: invalid start time (use date and time)`);
      continue;
    }
    const w = await collectSlotConflicts({
      batch,
      teacherId,
      zoomHostEmail,
      studentIds,
      slotStartTime16: start16,
      durationMinutes: dur,
      courseDay: jd
    });
    allWarnings.push(...w.map((x) => `[Day ${jd}] ${x}`));
  }

  const v = validateSchedulePayload(
    {
      batch,
      plan,
      topic,
      teacherId,
      zoomHostEmail,
      studentIds,
      duration: dur,
      startingJourneyDay,
      targetJourneyDay
    },
    { allowEmptyStudents: true }
  );
  if (!v.ok) blockingErrors.push(...v.errors);

  return { schedules: rows, allWarnings, blockingErrors };
}

module.exports = {
  generateJourneySchedules,
  istCalendarDaysBetween,
  validateSchedulePayload,
  findNextSlotStartingAt,
  findFirstSlotOnWeekday,
  findTeacherOverlap,
  findAnyStudentOverlap,
  findDuplicateBatchCourseDay,
  collectSlotConflicts,
  previewJourneyWithConflicts,
  previewCustomJourneySchedules,
  istYmdFromMs,
  istWeekdaySun0,
  MAX_AUTO_SLOTS
};
