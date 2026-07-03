'use strict';

const DigitalExercise = require('../models/DigitalExercise');
const MeetingLink = require('../models/MeetingLink');
const DGModule = require('../models/DGModule');
const GameSet = require('../models/GameSet');
const BatchConfig = require('../models/BatchConfig');
const { effectiveStudentBatch, normalizeBatch } = require('../utils/effectiveStudentBatch');
const { studentTargetBatchKeys, moduleTargetingQuery } = require('../utils/batchTargeting');
const {
  isLearningEnabled,
  exerciseVersionClauseForBatch,
  dgModuleVersionClauseForBatch,
  normalizeBatchType,
  isNew2BatchType,
} = require('../utils/batchType');
const { utcMidnightMs, journeyDayRangeStart } = require('../utils/journeyDay');

const TZ = 'Asia/Kolkata';
const MS_PER_DAY = 86_400_000;

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function istYmd(date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date instanceof Date ? date : new Date(date));
}

function formatIstTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(date));
}

function calendarDateForJourneyDay(cfg, journeyDay) {
  if (!cfg?.batchStartDate) return null;
  const trial = !!cfg.trialDayEnabled;
  const jd = Number(journeyDay);

  if (trial && jd === 0) {
    const base = cfg.trialAccessStartDate || cfg.batchStartDate;
    return new Date(utcMidnightMs(base));
  }

  const offset = trial ? jd : Math.max(0, jd - 1);
  return new Date(utcMidnightMs(cfg.batchStartDate) + offset * MS_PER_DAY);
}

function meetingCalendarDate(meeting) {
  if (!meeting?.startTime) return null;
  const ymd = istYmd(meeting.startTime);
  return new Date(`${ymd}T00:00:00+05:30`);
}

/**
 * Build automatic student timetable from journey schedule (meetings + assigned content).
 */
async function buildStudentJourneyTimetable(student, options = {}) {
  const batchName = effectiveStudentBatch(student);
  if (!batchName) {
    return { batchName: '', days: [], message: 'No batch assigned to your account.' };
  }

  const batchNorm = normalizeBatch(batchName);
  const batchRegex = batchNorm
    ? new RegExp(`^${escapeRegExp(batchNorm)}$`, 'i')
    : new RegExp(`^${escapeRegExp(batchName)}$`, 'i');

  function batchMatchesMeeting(meetingBatch) {
    const raw = String(meetingBatch || '').trim();
    if (!raw) return false;
    const mNorm = normalizeBatch(raw);
    return mNorm === batchNorm || raw.toLowerCase() === String(batchName).toLowerCase();
  }
  const cfg = await BatchConfig.findOne({ batchName: batchRegex }).lean();
  const journeyLength = cfg?.journeyLength || 200;
  const trial = !!cfg?.trialDayEnabled;
  const dayStart = journeyDayRangeStart(trial);
  const learningEnabled = cfg ? isLearningEnabled(cfg.batchType) : true;
  const batchType = normalizeBatchType(cfg?.batchType);
  const batchKeys = studentTargetBatchKeys(student);
  const plan = String(student.subscription || '').toUpperCase();

  const todayMs = utcMidnightMs(new Date());
  const horizonDays = Math.max(7, Math.min(90, Number(options.horizonDays) || 28));
  const horizonEndMs = todayMs + horizonDays * MS_PER_DAY;

  const [allMeetings, exercises, dgModules, arenaGames] = await Promise.all([
    MeetingLink.find({
      plan: { $in: [plan, 'ALL'] },
      status: { $ne: 'cancelled' },
      courseDay: { $gte: dayStart, $lte: journeyLength },
    })
      .populate('assignedTeacher', 'name email')
      .select('topic startTime duration courseDay joinUrl zoomPassword assignedTeacher status batch plan')
      .sort({ startTime: 1 })
      .lean(),
    learningEnabled
      ? DigitalExercise.find({
        courseDay: { $gte: dayStart, $lte: journeyLength },
        isDeleted: { $ne: true },
        visibleToStudents: true,
        isActive: true,
        ...exerciseVersionClauseForBatch(batchType, batchKeys),
      })
        .select('title category level courseDay weeklyTestEnabled examEnabled')
        .sort({ courseDay: 1, title: 1 })
        .lean()
      : [],
    learningEnabled
      ? DGModule.find({
        courseDay: { $gte: dayStart, $lte: journeyLength },
        visibleToStudents: true,
        isActive: true,
        $and: [
          dgModuleVersionClauseForBatch(batchType, batchKeys),
          ...(isNew2BatchType(batchType) ? [] : [moduleTargetingQuery(batchKeys)]),
        ],
      })
        .select('title level courseDay weeklyTestEnabled examEnabled')
        .sort({ courseDay: 1, title: 1 })
        .lean()
      : [],
    learningEnabled
      ? GameSet.find({
        visibleToStudents: true,
        isPublished: true,
        isDeleted: { $ne: true },
        courseDay: { $gte: dayStart, $lte: journeyLength },
        ...moduleTargetingQuery(batchKeys),
      })
        .select('title gameType courseDay difficulty')
        .sort({ courseDay: 1, title: 1 })
        .lean()
      : [],
  ]);

  const meetings = allMeetings.filter((m) => batchMatchesMeeting(m.batch));

  const dayMap = new Map();

  const ensureDay = (journeyDay) => {
    const key = Number(journeyDay);
    if (!dayMap.has(key)) {
      dayMap.set(key, {
        journeyDay: key,
        calendarDate: null,
        liveClasses: [],
        exercises: [],
        dgModules: [],
        arenaGames: [],
      });
    }
    return dayMap.get(key);
  };

  meetings.forEach((m) => {
    let journeyDay = m.courseDay;
    if (journeyDay == null && m.startTime && cfg?.batchStartDate) {
      const meetMs = utcMidnightMs(meetingCalendarDate(m) || new Date(m.startTime));
      const startMs = utcMidnightMs(cfg.batchStartDate);
      const diff = Math.round((meetMs - startMs) / MS_PER_DAY);
      journeyDay = trial ? diff : diff + 1;
      if (!Number.isFinite(journeyDay) || journeyDay < dayStart) journeyDay = null;
    }
    if (journeyDay == null) return;
    const row = ensureDay(journeyDay);
    const start = m.startTime ? new Date(m.startTime) : null;
    const end = start ? new Date(start.getTime() + (m.duration || 60) * 60000) : null;
    row.calendarDate = meetingCalendarDate(m) || row.calendarDate;
    row.liveClasses.push({
      meetingId: m._id,
      topic: m.topic || 'Live class',
      startTime: m.startTime,
      endTime: end,
      timeLabel: start ? `${formatIstTime(start)}${end ? ` - ${formatIstTime(end)}` : ''}` : '',
      duration: m.duration,
      teacherName: m.assignedTeacher?.name || 'Teacher',
      joinUrl: m.joinUrl || '',
      password: m.zoomPassword || '',
      status: m.status,
    });
  });

  exercises.forEach((e) => {
    if (e.courseDay == null) return;
    const row = ensureDay(e.courseDay);
    row.exercises.push({
      _id: e._id,
      title: e.title,
      category: e.category,
      level: e.level,
      kind: e.examEnabled ? 'exam' : e.weeklyTestEnabled ? 'weekly-test' : 'exercise',
    });
  });

  dgModules.forEach((m) => {
    if (m.courseDay == null) return;
    const row = ensureDay(m.courseDay);
    row.dgModules.push({
      _id: m._id,
      title: m.title,
      level: m.level,
      kind: m.examEnabled ? 'exam' : m.weeklyTestEnabled ? 'weekly-test' : 'dg-bot',
    });
  });

  arenaGames.forEach((g) => {
    if (g.courseDay == null) return;
    const row = ensureDay(g.courseDay);
    row.arenaGames.push({
      _id: g._id,
      title: g.title,
      gameType: g.gameType,
      difficulty: g.difficulty,
    });
  });

  for (const row of dayMap.values()) {
    if (!row.calendarDate && cfg?.batchStartDate) {
      row.calendarDate = calendarDateForJourneyDay(cfg, row.journeyDay);
    }
    if (row.calendarDate) {
      row.dateKey = istYmd(row.calendarDate);
    }
  }

  let days = [...dayMap.values()]
    .filter((d) =>
      d.liveClasses.length ||
      d.exercises.length ||
      d.dgModules.length ||
      d.arenaGames.length
    )
    .sort((a, b) => {
      const ad = a.calendarDate ? utcMidnightMs(a.calendarDate) : a.journeyDay * MS_PER_DAY;
      const bd = b.calendarDate ? utcMidnightMs(b.calendarDate) : b.journeyDay * MS_PER_DAY;
      return ad - bd || a.journeyDay - b.journeyDay;
    });

  days = days.filter((d) => {
    if (!d.calendarDate) return true;
    const ms = utcMidnightMs(d.calendarDate);
    return ms >= todayMs && ms <= horizonEndMs;
  });

  return {
    batchName,
    batchStartDate: cfg?.batchStartDate || null,
    journeyLength,
    studentCurrentDay: student.currentCourseDay ?? 1,
    horizonDays,
    days,
  };
}

module.exports = { buildStudentJourneyTimetable };
