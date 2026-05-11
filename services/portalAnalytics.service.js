const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const PortalSession = require('../models/portalSession.model');
const PageActivity = require('../models/pageActivity.model');
const DigitalExercise = require('../models/DigitalExercise');
const User = require('../models/User');
const UserActivityLog = require('../models/UserActivityLog');
const StudentLogs = require('../models/StudentLogs');
const RecordingView = require('../models/RecordingView');
const ZoomRecordingView = require('../models/ZoomRecordingView');
const MeetingLink = require('../models/MeetingLink');

/** Max seconds credited per heartbeat (tab sends ~every 10s when active). */
const MAX_CREDIT_PER_HEARTBEAT_SEC = 30;
/** No heartbeat for this long → session treated as dead on next heartbeat. */
const HEARTBEAT_GAP_STALE_SEC = 120;
/** Cron / auto-close: silence longer than this ends the session. */
const STALE_SILENCE_MS = 2 * 60 * 1000;
/** Set PORTAL_ANALYTICS_DEBUG=1 to log heartbeats / timer events (off by default). */
const PORTAL_ANALYTICS_DEBUG = /^(1|true|yes)$/i.test(String(process.env.PORTAL_ANALYTICS_DEBUG || '0'));

function logPortalDebug(message, payload = null) {
  if (!PORTAL_ANALYTICS_DEBUG) return;
  if (payload) {
    console.log(message, payload);
    return;
  }
  console.log(message);
}

function parseObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function parseDeviceMeta(rawUserAgent) {
  const ua = String(rawUserAgent || '').trim().slice(0, 512);
  const lower = ua.toLowerCase();

  let deviceType = 'Desktop';
  if (/ipad|tablet|playbook|silk|kindle/.test(lower)) {
    deviceType = 'Tablet';
  } else if (/mobile|android|iphone|ipod|blackberry|windows phone/.test(lower)) {
    deviceType = 'Mobile';
  }

  let os = 'Unknown OS';
  if (/windows nt/i.test(ua)) os = 'Windows';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Unknown browser';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = 'Chrome';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari';

  return {
    userAgent: ua,
    deviceType,
    os,
    browser,
    deviceLabel: `${deviceType} • ${os} • ${browser}`
  };
}

function parseDateRange(query) {
  const now = new Date();
  let to = query.to ? new Date(query.to) : now;
  let from = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime())) from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(to.getTime())) to = now;

  const fromRaw = query.from ? String(query.from) : '';
  const toRaw = query.to ? String(query.to) : '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const IST_OFFSET_MINUTES = 5.5 * 60;
  const parseDateOnlyAsIstBoundary = (value, endOfDay = false) => {
    const [yy, mm, dd] = value.split('-').map((n) => parseInt(n, 10));
    if (!yy || !mm || !dd) return null;
    const utcMs =
      Date.UTC(yy, mm - 1, dd, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0) -
      IST_OFFSET_MINUTES * 60 * 1000;
    return new Date(utcMs);
  };

  // HTML date inputs send YYYY-MM-DD. Interpret these as IST day boundaries.
  if (dateOnly.test(fromRaw)) {
    const parsed = parseDateOnlyAsIstBoundary(fromRaw, false);
    if (parsed) from = parsed;
  }
  if (dateOnly.test(toRaw)) {
    const parsed = parseDateOnlyAsIstBoundary(toRaw, true);
    if (parsed) to = parsed;
  }

  if (from > to) {
    const t = from;
    from = to;
    to = t;
  }
  return { from, to };
}

/**
 * Returns an array of student ObjectIds for the given cohort, or null for 'overall' (no filter).
 * - 'platinum': PLATINUM subscription students that are NOT in Go
 * - 'go': students with goStatus === 'GO'
 */
async function getCohortStudentIds(cohort) {
  if (!cohort || cohort === 'overall') return null;
  let userFilter = {};
  if (cohort === 'platinum') {
    userFilter = { role: 'STUDENT', subscription: 'PLATINUM', goStatus: { $ne: 'GO' } };
  } else if (cohort === 'go') {
    userFilter = { role: 'STUDENT', goStatus: 'GO' };
  } else {
    return null;
  }
  const users = await User.find(userFilter).select('_id').lean();
  return users.map((u) => u._id);
}

function sessionTimeRangeMatch(from, to) {
  return {
    $or: [
      { startTime: { $gte: from, $lte: to } },
      { endTime: { $gte: from, $lte: to } },
      { $and: [{ startTime: { $lte: from } }, { $or: [{ endTime: { $gte: to } }, { endTime: null }, { isActive: true }] }] }
    ]
  };
}

function extractDigitalExerciseIdFromPage(page) {
  const raw = String(page || '');
  const m = raw.match(/\/digital-exercises\/([a-f\d]{24})(?:\/|$)/i);
  return m ? m[1] : null;
}

async function buildDigitalExerciseTitleMapFromPages(pages) {
  const ids = Array.from(
    new Set(
      (pages || [])
        .map((p) => extractDigitalExerciseIdFromPage(p))
        .filter(Boolean)
    )
  );
  if (!ids.length) return new Map();
  const docs = await DigitalExercise.find({ _id: { $in: ids } })
    .select('_id title')
    .lean();
  return new Map(docs.map((d) => [String(d._id), String(d.title || '').trim()]));
}

function prettyPageLabel(page, titleMap) {
  const raw = String(page || '/');
  const exId = extractDigitalExerciseIdFromPage(raw);
  if (!exId) return raw;
  const title = titleMap.get(exId);
  if (!title) return raw;
  return `Digital Exercise: ${title}`;
}

async function closeOpenPageActivities(sessionId, endTime) {
  await PageActivity.updateMany(
    { sessionId, endTime: null },
    { $set: { endTime } }
  );
}

async function finalizePortalSession(session, endTime = new Date()) {
  if (!session) return;
  await closeOpenPageActivities(session.sessionId, endTime);
  await PortalSession.updateOne(
    { _id: session._id },
    { $set: { isActive: false, endTime } }
  );
}

/**
 * Ends other active sessions for this student (single active session invariant).
 */
async function closeOtherActiveSessions(studentId, exceptSessionId) {
  const others = await PortalSession.find({
    studentId,
    isActive: true,
    sessionId: { $ne: exceptSessionId }
  }).lean();

  for (const s of others) {
    await finalizePortalSession(s, new Date());
  }
}

async function startSession(studentId, rawUserAgent = '') {
  const sid = parseObjectId(studentId);
  if (!sid) throw new Error('INVALID_STUDENT');

  const sessionId = randomUUID();
  const now = new Date();
  const deviceMeta = parseDeviceMeta(rawUserAgent);

  await closeOtherActiveSessions(sid, sessionId);

  const doc = await PortalSession.create({
    studentId: sid,
    sessionId,
    startTime: now,
    endTime: null,
    totalActiveSeconds: 0,
    deviceType: deviceMeta.deviceType,
    deviceLabel: deviceMeta.deviceLabel,
    browser: deviceMeta.browser,
    os: deviceMeta.os,
    userAgent: deviceMeta.userAgent,
    lastHeartbeatAt: now,
    isActive: true
  });

  logPortalDebug('⏱ [Portal analytics] Timer started', {
    studentId: String(sid),
    sessionId: doc.sessionId,
    startTime: doc.startTime
  });

  return { sessionId: doc.sessionId, startTime: doc.startTime };
}

function computeCreditSeconds(lastHeartbeatAt, now) {
  const gapSec = Math.floor((now.getTime() - lastHeartbeatAt.getTime()) / 1000);
  if (gapSec <= 0) return 0;
  return Math.min(gapSec, MAX_CREDIT_PER_HEARTBEAT_SEC);
}

async function heartbeat(studentId, sessionId, page) {
  const sid = parseObjectId(studentId);
  if (!sid) throw new Error('INVALID_STUDENT');
  if (!sessionId || typeof sessionId !== 'string') throw new Error('INVALID_SESSION');
  const pageStr = typeof page === 'string' && page.trim() ? page.trim().slice(0, 512) : '/';

  const session = await PortalSession.findOne({ sessionId, studentId: sid });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.isActive) throw new Error('SESSION_ENDED');

  const now = new Date();
  const gapSec = Math.floor((now.getTime() - session.lastHeartbeatAt.getTime()) / 1000);
  if (gapSec > HEARTBEAT_GAP_STALE_SEC) {
    logPortalDebug('⚠️ [Portal analytics] Session marked stale on heartbeat', {
      studentId: String(sid),
      sessionId,
      gapSec
    });
    await finalizePortalSession(session, now);
    throw new Error('SESSION_STALE');
  }

  const add = computeCreditSeconds(session.lastHeartbeatAt, now);

  // Close every open segment for other pages so route changes never leave orphans.
  await PageActivity.updateMany(
    { sessionId, endTime: null, page: { $ne: pageStr } },
    { $set: { endTime: now } }
  );

  let open = await PageActivity.findOne({ sessionId, page: pageStr, endTime: null }).sort({ startTime: -1 });

  if (!open) {
    open = await PageActivity.create({
      studentId: sid,
      sessionId,
      page: pageStr,
      startTime: now,
      endTime: null,
      activeSeconds: 0
    });
  }

  if (add > 0) {
    await PageActivity.updateOne({ _id: open._id }, { $inc: { activeSeconds: add } });
  }

  await PortalSession.updateOne(
    { _id: session._id },
    {
      $set: { lastHeartbeatAt: now },
      $inc: { totalActiveSeconds: add }
    }
  );

  if (add > 0) {
    logPortalDebug('💓 [Portal analytics] Heartbeat credited', {
      studentId: String(sid),
      sessionId,
      page: pageStr,
      creditedSeconds: add
    });
  }

  return { ok: true, creditedSeconds: add, lastHeartbeatAt: now };
}

async function endSession(studentId, sessionId) {
  const sid = parseObjectId(studentId);
  if (!sid) throw new Error('INVALID_STUDENT');
  if (!sessionId) throw new Error('INVALID_SESSION');

  const session = await PortalSession.findOne({ sessionId, studentId: sid });
  if (!session) throw new Error('SESSION_NOT_FOUND');

  const now = new Date();
  const add = session.isActive ? computeCreditSeconds(session.lastHeartbeatAt, now) : 0;

  if (add > 0 && session.isActive) {
    const open = await PageActivity.findOne({ sessionId, endTime: null }).sort({ startTime: -1 });
    if (open) {
      await PageActivity.updateOne({ _id: open._id }, { $inc: { activeSeconds: add } });
    }
    await PortalSession.updateOne(
      { _id: session._id },
      { $inc: { totalActiveSeconds: add }, $set: { lastHeartbeatAt: now } }
    );
  }

  const fresh = await PortalSession.findById(session._id).lean();
  await finalizePortalSession(fresh, now);

  logPortalDebug('🛑 [Portal analytics] Timer ended', {
    studentId: String(sid),
    sessionId,
    endTime: now,
    finalCreditSeconds: add
  });

  return { ok: true };
}

async function closeStaleSessions() {
  const cutoff = new Date(Date.now() - STALE_SILENCE_MS);
  const stale = await PortalSession.find({
    isActive: true,
    lastHeartbeatAt: { $lt: cutoff }
  }).lean();

  let closed = 0;
  for (const s of stale) {
    await finalizePortalSession(s, new Date());
    closed += 1;
  }
  return { closed };
}

async function getOverview(from, to, cohortIds = null) {
  /** Same window as getTimeSeriesDaily / donut — summed PageActivity segments (not PortalSession rollups). */
  const trackedMatch = {
    startTime: { $gte: from, $lte: to },
    ...(cohortIds ? { studentId: { $in: cohortIds } } : {})
  };

  const aggRows = await PageActivity.aggregate([
    { $match: trackedMatch },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalSeconds: { $sum: '$activeSeconds' },
              students: { $addToSet: '$studentId' }
            }
          },
          {
            $project: {
              _id: 0,
              totalSeconds: 1,
              studentCount: { $size: '$students' }
            }
          }
        ],
        topPage: [
          { $group: { _id: '$page', seconds: { $sum: '$activeSeconds' } } },
          { $sort: { seconds: -1 } },
          { $limit: 1 }
        ],
        topStudent: [
          { $group: { _id: '$studentId', seconds: { $sum: '$activeSeconds' } } },
          { $sort: { seconds: -1 } },
          { $limit: 1 }
        ]
      }
    }
  ]);
  const agg = aggRows[0];

  const totalsRow = agg?.totals?.[0];
  const totalSeconds = Math.max(0, Math.floor(Number(totalsRow?.totalSeconds) || 0));
  const studentCount = Math.max(0, Math.floor(Number(totalsRow?.studentCount) || 0));
  const avgTimePerStudent = studentCount > 0 ? Math.round(totalSeconds / studentCount) : 0;

  const activeCutoff = new Date(Date.now() - 5 * 60 * 1000);
  const activeStudents = await PortalSession.distinct('studentId', {
    isActive: true,
    lastHeartbeatAt: { $gte: activeCutoff },
    ...(cohortIds ? { studentId: { $in: cohortIds } } : {})
  });

  const topPage = agg?.topPage?.[0] || null;
  const topPageTitleMap = await buildDigitalExerciseTitleMapFromPages(topPage ? [topPage._id] : []);

  const topStudentRow = agg?.topStudent?.[0] || null;
  let topStudentName = null;
  if (topStudentRow?._id) {
    const u = await User.findById(topStudentRow._id).select('name').lean();
    topStudentName = u?.name || String(topStudentRow._id);
  }

  return {
    totalTime: totalSeconds,
    activeStudents: activeStudents.length,
    avgTimePerStudent,
    topPage: topPage ? { page: prettyPageLabel(topPage._id, topPageTitleMap), seconds: topPage.seconds } : null,
    topStudent: topStudentRow
      ? { studentId: topStudentRow._id, name: topStudentName, seconds: topStudentRow.seconds }
      : null,
    range: { from, to }
  };
}

async function getStudentWise(from, to, limit = 200, sortBy = 'time', order = 'desc', cohortIds = null) {
  const match = { ...sessionTimeRangeMatch(from, to) };
  if (cohortIds) match.studentId = { $in: cohortIds };
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 200, 1), 500);
  const dir = String(order).toLowerCase() === 'asc' ? 1 : -1;
  const sb = String(sortBy || 'time').toLowerCase();

  const groupStage = {
    $group: {
      _id: '$studentId',
      totalSeconds: { $sum: '$totalActiveSeconds' },
      sessionsCount: { $sum: 1 }
    }
  };

  let pipeline;
  if (sb === 'name') {
    pipeline = [
      { $match: match },
      groupStage,
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: '_user'
        }
      },
      {
        $addFields: {
          _sortName: { $toLower: { $ifNull: [{ $arrayElemAt: ['$_user.name', 0] }, ''] } }
        }
      },
      { $sort: { _sortName: dir } },
      { $limit: cap },
      { $project: { _sortName: 0, _user: 0 } }
    ];
  } else {
    const sortStage = sb === 'sessions' ? { sessionsCount: dir } : { totalSeconds: dir };
    pipeline = [{ $match: match }, groupStage, { $sort: sortStage }, { $limit: cap }];
  }

  const byStudent = await PortalSession.aggregate(pipeline);

  const studentIds = byStudent.map((r) => r._id);
  if (studentIds.length === 0) return [];

  const topPages = await PageActivity.aggregate([
    {
      $match: {
        studentId: { $in: studentIds },
        startTime: { $lte: to },
        $or: [{ endTime: null }, { endTime: { $gte: from } }]
      }
    },
    { $group: { _id: { studentId: '$studentId', page: '$page' }, seconds: { $sum: '$activeSeconds' } } },
    { $sort: { seconds: -1 } },
    {
      $group: {
        _id: '$_id.studentId',
        topPage: { $first: '$_id.page' },
        topPageSeconds: { $first: '$seconds' }
      }
    }
  ]);
  const topPageMap = new Map(topPages.map((t) => [String(t._id), t]));
  const topPageTitleMap = await buildDigitalExerciseTitleMapFromPages(topPages.map((t) => t.topPage));

  const users = await User.find({ _id: { $in: studentIds } })
    .select('name email batch currentCourseDay')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  return byStudent.map((row) => {
    const idStr = String(row._id);
    const u = userMap.get(idStr);
    const tp = topPageMap.get(idStr);
    const avgSession = row.sessionsCount > 0 ? Math.round(row.totalSeconds / row.sessionsCount) : 0;
    return {
      studentId: row._id,
      studentName: u?.name || 'Unknown',
      email: u?.email || '',
      batch: u?.batch || '',
      journeyDay: Number(u?.currentCourseDay || 0),
      totalSeconds: row.totalSeconds,
      sessionsCount: row.sessionsCount,
      avgSessionSeconds: avgSession,
      topPage: tp?.topPage ? prettyPageLabel(tp.topPage, topPageTitleMap) : '—',
      topPageSeconds: tp?.topPageSeconds || 0
    };
  });
}

async function getPageWise(from, to, limit = 200, cohortIds = null) {
  const pageMatch = {
    startTime: { $lte: to },
    $or: [{ endTime: null }, { endTime: { $gte: from } }],
    ...(cohortIds ? { studentId: { $in: cohortIds } } : {})
  };
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 200, 1), 500);

  const pageRows = await PageActivity.aggregate([
    { $match: pageMatch },
    {
      $group: {
        _id: '$page',
        totalSeconds: { $sum: '$activeSeconds' },
        students: { $addToSet: '$studentId' }
      }
    },
    {
      $project: {
        page: '$_id',
        totalSeconds: 1,
        uniqueStudents: { $size: '$students' },
        _id: 0
      }
    },
    {
      $addFields: {
        avgSecondsPerUser: {
          $cond: [{ $gt: ['$uniqueStudents', 0] }, { $divide: ['$totalSeconds', '$uniqueStudents'] }, 0]
        }
      }
    },
    { $sort: { totalSeconds: -1 } },
    { $limit: cap }
  ]);
  const titleMap = await buildDigitalExerciseTitleMapFromPages(pageRows.map((r) => r.page));

  const grandTotal = pageRows.reduce((acc, r) => acc + (r.totalSeconds || 0), 0);
  return pageRows.map((r) => ({
    ...r,
    page: prettyPageLabel(r.page, titleMap),
    pctOfTracked: grandTotal > 0 ? Math.round((r.totalSeconds / grandTotal) * 1000) / 10 : 0
  }));
}

async function getTimeline(from, to, limit = 50, skip = 0, cohortIds = null) {
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
  const sk = Math.min(Math.max(parseInt(String(skip), 10) || 0, 0), 50000);
  const match = {
    startTime: { $lte: to },
    $or: [{ endTime: null }, { endTime: { $gte: from } }],
    ...(cohortIds ? { studentId: { $in: cohortIds } } : {})
  };

  const [total, raw] = await Promise.all([
    PageActivity.countDocuments(match),
    PageActivity.find(match)
      .sort({ startTime: -1 })
      .skip(sk)
      .limit(cap)
      .populate('studentId', 'name')
      .lean()
  ]);
  const titleMap = await buildDigitalExerciseTitleMapFromPages(raw.map((r) => r.page));

  const items = raw.map((r) => ({
    time: r.startTime,
    endTime: r.endTime,
    page: prettyPageLabel(r.page, titleMap),
    type: 'PAGE',
    durationSeconds: r.activeSeconds,
    studentName: r.studentId?.name || 'Unknown',
    studentId: r.studentId?._id || r.studentId,
    sessionId: r.sessionId
  }));

  return { items, total, skip: sk, limit: cap };
}

async function getTimeSeriesDaily(from, to, cohortIds = null) {
  /** Must match parseDateRange / daily logs — date-only filters are IST calendar days. */
  const tz = 'Asia/Kolkata';
  const matchCond = { startTime: { $gte: from, $lte: to } };
  if (cohortIds) matchCond.studentId = { $in: cohortIds };
  return PageActivity.aggregate([
    { $match: matchCond },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime', timezone: tz } },
        seconds: { $sum: '$activeSeconds' },
        interactions: { $sum: 1 },
        studentIds: { $addToSet: '$studentId' }
      }
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        date: '$_id',
        seconds: 1,
        interactions: 1,
        uniqueStudents: { $size: '$studentIds' },
        _id: 0
      }
    }
  ]);
}

/** IST calendar days from `from` through `to` (matches portal date picker). */
function eachCalendarDayInIstRange(fromDate, toDate) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const endYmd = fmt.format(toDate);
  const days = [];
  let cur = new Date(fromDate.getTime());
  for (let guard = 0; guard < 400; guard += 1) {
    const ymd = fmt.format(cur);
    if (!days.length || days[days.length - 1] !== ymd) days.push(ymd);
    if (ymd >= endYmd) break;
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return days;
}

/**
 * Per-day rollup for admin "Logs" table: portal time, interaction count, avg per student,
 * top page / student, plus detail breakdowns.
 */
async function getDailyPortalLogs(from, to, cohortIds = null) {
  const tz = 'Asia/Kolkata';
  const dayExpr = { $dateToString: { format: '%Y-%m-%d', date: '$startTime', timezone: tz } };
  const matchCond = { startTime: { $gte: from, $lte: to } };
  if (cohortIds) matchCond.studentId = { $in: cohortIds };

  const [summary, pageByDay, studentByDay] = await Promise.all([
    PageActivity.aggregate([
      { $match: matchCond },
      { $addFields: { day: dayExpr } },
      {
        $group: {
          _id: '$day',
          portalSeconds: { $sum: '$activeSeconds' },
          interactions: { $sum: 1 },
          studentIds: { $addToSet: '$studentId' }
        }
      },
      {
        $project: {
          _id: 1,
          portalSeconds: 1,
          interactions: 1,
          uniqueStudents: { $size: '$studentIds' }
        }
      }
    ]),
    PageActivity.aggregate([
      { $match: matchCond },
      { $addFields: { day: dayExpr } },
      { $group: { _id: { day: '$day', page: '$page' }, seconds: { $sum: '$activeSeconds' } } },
      { $sort: { '_id.day': 1, seconds: -1 } },
      {
        $group: {
          _id: '$_id.day',
          pages: { $push: { page: '$_id.page', seconds: '$seconds' } }
        }
      },
      { $addFields: { pages: { $slice: ['$pages', 25] } } },
      { $project: { date: '$_id', pages: 1, _id: 0 } }
    ]),
    PageActivity.aggregate([
      { $match: matchCond },
      { $addFields: { day: dayExpr } },
      {
        $group: {
          _id: { day: '$day', studentId: '$studentId' },
          seconds: { $sum: '$activeSeconds' }
        }
      },
      { $sort: { '_id.day': 1, seconds: -1 } },
      {
        $group: {
          _id: '$_id.day',
          students: { $push: { studentId: '$_id.studentId', seconds: '$seconds' } }
        }
      },
      { $addFields: { students: { $slice: ['$students', 25] } } },
      { $project: { date: '$_id', students: 1, _id: 0 } }
    ])
  ]);

  const summaryMap = new Map(summary.map((r) => [r._id, r]));
  const pageMap = new Map(pageByDay.map((r) => [r.date, r.pages]));
  const studentMap = new Map(studentByDay.map((r) => [r.date, r.students]));

  const allPageKeys = new Set();
  for (const row of pageByDay) {
    for (const p of row.pages || []) allPageKeys.add(p.page);
  }
  const titleMap = await buildDigitalExerciseTitleMapFromPages([...allPageKeys]);

  const allStudentIds = new Set();
  for (const row of studentByDay) {
    for (const s of row.students || []) {
      if (s.studentId) allStudentIds.add(String(s.studentId));
    }
  }
  const sidArr = [...allStudentIds]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const users = sidArr.length ? await User.find({ _id: { $in: sidArr } }).select('name').lean() : [];
  const nameById = new Map(users.map((u) => [String(u._id), u.name || 'Unknown']));

  const calendarDays = eachCalendarDayInIstRange(from, to);
  const sortedDesc = [...calendarDays].reverse();

  const items = sortedDesc.map((date) => {
    const sum = summaryMap.get(date);
    const portalSeconds = sum ? Math.max(0, Math.floor(Number(sum.portalSeconds) || 0)) : 0;
    const interactions = sum ? Math.max(0, Math.floor(Number(sum.interactions) || 0)) : 0;
    const uniqueStudents = sum ? Math.max(0, Math.floor(Number(sum.uniqueStudents) || 0)) : 0;
    const avgStudentSeconds =
      uniqueStudents > 0 ? Math.round(portalSeconds / uniqueStudents) : 0;

    const pagesRaw = pageMap.get(date) || [];
    const pages = pagesRaw.map((p) => ({
      page: prettyPageLabel(p.page, titleMap),
      rawPage: String(p.page || ''),
      seconds: Math.max(0, Math.floor(Number(p.seconds) || 0))
    }));
    const topPage = pages.length ? { page: pages[0].page, rawPage: pages[0].rawPage, seconds: pages[0].seconds } : null;

    const studentsRaw = studentMap.get(date) || [];
    const students = studentsRaw.map((s) => ({
      studentId: String(s.studentId || ''),
      name: nameById.get(String(s.studentId)) || 'Unknown',
      seconds: Math.max(0, Math.floor(Number(s.seconds) || 0))
    }));
    const topStudent = students.length ? students[0] : null;

    return {
      date,
      portalSeconds,
      interactions,
      uniqueStudents,
      avgStudentSeconds,
      topPage,
      topStudent,
      details: { pages, students }
    };
  });

  return { items, range: { from, to }, timezone: tz };
}

async function getPageSharesForDonut(from, to, topN = 8, cohortIds = null) {
  const matchCond = { startTime: { $gte: from, $lte: to } };
  if (cohortIds) matchCond.studentId = { $in: cohortIds };
  const rows = await PageActivity.aggregate([
    { $match: matchCond },
    { $group: { _id: '$page', seconds: { $sum: '$activeSeconds' } } },
    { $sort: { seconds: -1 } }
  ]);
  const n = Math.min(topN, rows.length);
  const top = rows.slice(0, n);
  const otherSum = rows.slice(n).reduce((a, r) => a + (r.seconds || 0), 0);
  const titleMap = await buildDigitalExerciseTitleMapFromPages(top.map((r) => r._id));
  const labels = top.map((r) => prettyPageLabel(r._id, titleMap));
  const values = top.map((r) => r.seconds);
  if (otherSum > 0) {
    labels.push('Other');
    values.push(otherSum);
  }
  return { labels, values };
}

async function getActiveStudentsDetail(limit = 30, cohortIds = null) {
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 30, 1), 100);
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const sessionFilter = {
    isActive: true,
    lastHeartbeatAt: { $gte: cutoff },
    ...(cohortIds ? { studentId: { $in: cohortIds } } : {})
  };
  const sessions = await PortalSession.find(sessionFilter)
    .sort({ lastHeartbeatAt: -1 })
    .limit(lim)
    .populate('studentId', 'name email')
    .lean();

  return sessions.map((s) => ({
    studentId: s.studentId?._id || s.studentId,
    name: s.studentId?.name || 'Unknown',
    email: s.studentId?.email || '',
    sessionId: s.sessionId,
    lastHeartbeatAt: s.lastHeartbeatAt
  }));
}

async function getRecentPageEvents(from, to, limit = 35, cohortIds = null) {
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 35, 1), 100);
  const pageFilter = {
    startTime: { $gte: from, $lte: to },
    ...(cohortIds ? { studentId: { $in: cohortIds } } : {})
  };
  const rows = await PageActivity.find(pageFilter)
    .sort({ startTime: -1 })
    .limit(cap)
    .populate('studentId', 'name')
    .lean();
  const titleMap = await buildDigitalExerciseTitleMapFromPages(rows.map((r) => r.page));

  return rows.map((r) => ({
    time: r.startTime,
    studentName: r.studentId?.name || 'Unknown',
    page: prettyPageLabel(r.page, titleMap),
    type: 'PAGE',
    durationSeconds: r.activeSeconds,
    sessionId: r.sessionId
  }));
}

async function getPeakHour(from, to, cohortIds = null) {
  const matchCond = { startTime: { $gte: from, $lte: to } };
  if (cohortIds) matchCond.studentId = { $in: cohortIds };
  const rows = await PageActivity.aggregate([
    { $match: matchCond },
    {
      $group: {
        _id: { $hour: { date: '$startTime', timezone: 'UTC' } },
        seconds: { $sum: '$activeSeconds' }
      }
    },
    { $sort: { seconds: -1 } },
    { $limit: 1 }
  ]);
  if (!rows.length) return null;
  const h = rows[0]._id;
  const h2 = (h + 1) % 24;
  return {
    hour: h,
    label: `${String(h).padStart(2, '0')}:00–${String(h2).padStart(2, '0')}:00 UTC`,
    seconds: rows[0].seconds
  };
}

async function getPeakDayOfWeek(from, to, cohortIds = null) {
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const matchCond = { startTime: { $gte: from, $lte: to } };
  if (cohortIds) matchCond.studentId = { $in: cohortIds };
  const rows = await PageActivity.aggregate([
    { $match: matchCond },
    { $group: { _id: { $dayOfWeek: '$startTime' }, seconds: { $sum: '$activeSeconds' } } },
    { $sort: { seconds: -1 } },
    { $limit: 1 }
  ]);
  if (!rows.length) return null;
  const idx = rows[0]._id - 1;
  return { dayIndex: rows[0]._id, label: dow[idx] || String(rows[0]._id), seconds: rows[0].seconds };
}

async function getEngagementLeaders(from, to, limit = 12, cohortIds = null) {
  const match = { ...sessionTimeRangeMatch(from, to) };
  if (cohortIds) match.studentId = { $in: cohortIds };
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 12, 1), 100);
  const rows = await PortalSession.aggregate([
    { $match: match },
    {
      $project: {
        studentId: 1,
        active: '$totalActiveSeconds',
        wallSec: {
          $max: [
            1,
            {
              $divide: [{ $subtract: [{ $ifNull: ['$endTime', '$$NOW'] }, '$startTime'] }, 1000]
            }
          ]
        }
      }
    },
    {
      $group: {
        _id: '$studentId',
        activeSum: { $sum: '$active' },
        wallSum: { $sum: '$wallSec' }
      }
    },
    {
      $project: {
        score: {
          $cond: [{ $gt: ['$wallSum', 0] }, { $divide: ['$activeSum', '$wallSum'] }, 0]
        },
        activeSum: 1,
        wallSum: 1
      }
    },
    { $sort: { score: -1 } },
    { $limit: lim }
  ]);

  const ids = rows.map((r) => r._id);
  if (!ids.length) return [];
  const users = await User.find({ _id: { $in: ids } })
    .select('name')
    .lean();
  const nameMap = new Map(users.map((u) => [String(u._id), u.name]));
  return rows.map((r) => ({
    studentId: r._id,
    name: nameMap.get(String(r._id)) || 'Unknown',
    engagementScore: Math.round((r.score || 0) * 1000) / 1000,
    activeSeconds: r.activeSum,
    sessionWallSeconds: Math.round(r.wallSum)
  }));
}

async function getDropOffPages(from, to, limit = 6, cohortIds = null) {
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 6, 1), 25);
  const baseMatch = { startTime: { $gte: from, $lte: to }, endTime: { $ne: null } };
  if (cohortIds) baseMatch.studentId = { $in: cohortIds };
  const rows = await PageActivity.aggregate([
    { $match: baseMatch },
    { $sort: { sessionId: 1, startTime: -1 } },
    {
      $group: {
        _id: '$sessionId',
        lastPage: { $first: '$page' },
        lastActive: { $first: '$activeSeconds' }
      }
    },
    { $group: { _id: '$lastPage', sessions: { $sum: 1 }, avgLastSegmentSec: { $avg: '$lastActive' } } },
    { $sort: { sessions: -1 } },
    { $limit: lim },
    {
      $project: {
        page: '$_id',
        sessionsEnded: '$sessions',
        avgLastSegmentSec: { $toInt: { $add: ['$avgLastSegmentSec', 0.5] } },
        _id: 0
      }
    }
  ]);
  const titleMap = await buildDigitalExerciseTitleMapFromPages(rows.map((r) => r.page));
  return rows.map((r) => ({ ...r, page: prettyPageLabel(r.page, titleMap) }));
}

async function buildInsights(from, to, overview, cohortIds = null) {
  const spanMs = Math.max(to.getTime() - from.getTime(), 86400000);
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - spanMs);
  const prev = await getOverview(prevFrom, prevTo, cohortIds);
  const prevTotal = prev.totalTime || 0;
  const currTotal = overview.totalTime || 0;
  const changePct = prevTotal > 0 ? Math.round(((currTotal - prevTotal) / prevTotal) * 1000) / 10 : null;

  const list = [];
  if (changePct !== null) {
    list.push({
      id: 'trend',
      tone: changePct >= 0 ? 'positive' : 'negative',
      title: 'Period vs previous',
      body: `Tracked portal time is ${changePct >= 0 ? 'up' : 'down'} ${Math.abs(changePct)}% vs the prior window of equal length.`
    });
  }
  if (overview.topPage) {
    list.push({
      id: 'page',
      tone: 'neutral',
      title: 'Most engaging route',
      body: `Students spend the most tracked time on “${overview.topPage.page}”.`
    });
  }
  if (overview.topStudent) {
    list.push({
      id: 'student',
      tone: 'neutral',
      title: 'Top engagement (tracked)',
      body: `${overview.topStudent.name} leads this range by tracked active seconds.`
    });
  }
  const lowMatch = { ...sessionTimeRangeMatch(from, to) };
  if (cohortIds) lowMatch.studentId = { $in: cohortIds };
  const low = await PortalSession.aggregate([
    { $match: lowMatch },
    { $group: { _id: '$studentId', t: { $sum: '$totalActiveSeconds' }, c: { $sum: 1 } } },
    { $match: { t: { $lt: 300 }, c: { $gte: 1 } } },
    { $count: 'n' }
  ]);
  const lowN = low[0]?.n || 0;
  if (lowN > 0) {
    list.push({
      id: 'low',
      tone: 'warn',
      title: 'Low tracked time',
      body: `${lowN} student(s) had under 5 minutes of tracked portal time in this range (heartbeat-based).`
    });
  }
  return list;
}

async function estimateFromLoginActivity(from, to) {
  const maxEvents = 15000;
  const logs = await UserActivityLog.find({
    createdAt: { $gte: from, $lte: to },
    type: { $in: ['LOGIN', 'LOGOUT'] }
  })
    .sort({ userId: 1, createdAt: 1 })
    .limit(maxEvents)
    .select('userId type createdAt role')
    .lean();

  const CAP_SEC = 8 * 3600;
  let estimatedSeconds = 0;
  let pairedSessions = 0;
  const pending = new Map();

  for (const ev of logs) {
    if (ev.role && ev.role !== 'STUDENT') continue;
    const uid = String(ev.userId);
    if (ev.type === 'LOGIN') {
      pending.set(uid, ev.createdAt);
    } else if (ev.type === 'LOGOUT') {
      const start = pending.get(uid);
      pending.delete(uid);
      if (!start) continue;
      const sec = Math.min(
        CAP_SEC,
        Math.max(0, (new Date(ev.createdAt).getTime() - new Date(start).getTime()) / 1000)
      );
      if (sec > 30) {
        estimatedSeconds += sec;
        pairedSessions += 1;
      }
    }
  }

  let studentLogEventsCount = 0;
  try {
    studentLogEventsCount = await StudentLogs.countDocuments({
      updatedAt: { $gte: from, $lte: to }
    });
  } catch {
    /* ignore */
  }

  return {
    label: 'Estimated (from login/logout activity)',
    source: 'UserActivityLog',
    disclaimer:
      'Inferred gaps between LOGIN and LOGOUT for student-role users (capped at 8h per pair). Not heartbeat-based; separate from Portal Analytics.',
    estimatedSeconds: Math.round(estimatedSeconds),
    pairedSessions,
    eventsSampled: logs.length,
    studentLogEventsCount,
    studentLogNote:
      'Student Logs (profile/student record updates) are counted separately — they do not represent portal page time.'
  };
}

async function getDashboard(from, to, includeHistorical, cohort = null) {
  const cohortIds = await getCohortStudentIds(cohort);
  const overview = await getOverview(from, to, cohortIds);
  const [
    timeSeries,
    donut,
    activeStudents,
    recentActivity,
    peakHour,
    peakDay,
    engagement,
    dropoffs,
    insights
  ] = await Promise.all([
    getTimeSeriesDaily(from, to, cohortIds),
    getPageSharesForDonut(from, to, 8, cohortIds),
    getActiveStudentsDetail(30, cohortIds),
    getRecentPageEvents(from, to, 35, cohortIds),
    getPeakHour(from, to, cohortIds),
    getPeakDayOfWeek(from, to, cohortIds),
    getEngagementLeaders(from, to, 12, cohortIds),
    getDropOffPages(from, to, 6, cohortIds),
    buildInsights(from, to, overview, cohortIds)
  ]);

  let historical = null;
  if (includeHistorical) {
    historical = await estimateFromLoginActivity(from, to);
    historical.comparisonNote =
      overview.totalTime > 0 && historical.estimatedSeconds > 0
        ? `Estimated login-based time is ${Math.round((historical.estimatedSeconds / overview.totalTime) * 100)}% of heartbeat-tracked time for this window (different methodologies).`
        : null;
  }

  return {
    range: { from, to },
    kpis: {
      totalTime: overview.totalTime,
      activeStudents: overview.activeStudents,
      avgTimePerStudent: overview.avgTimePerStudent,
      topPage: overview.topPage,
      topStudent: overview.topStudent
    },
    timeSeries,
    donut,
    activeStudents,
    recentActivity,
    peakHour,
    peakDay,
    engagement,
    dropoffs,
    insights,
    historical
  };
}

async function getSessionWise(from, to, limit = 200, cohortIds = null) {
  const match = { ...sessionTimeRangeMatch(from, to) };
  if (cohortIds) match.studentId = { $in: cohortIds };
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 200, 1), 500);

  const sessions = await PortalSession.find(match)
    .sort({ startTime: -1 })
    .limit(cap)
    .populate('studentId', 'name')
    .lean();

  const sessionIds = sessions.map((s) => s.sessionId);
  const activities = await PageActivity.find({ sessionId: { $in: sessionIds } })
    .sort({ startTime: 1 })
    .lean();

  const bySession = new Map();
  for (const a of activities) {
    if (!bySession.has(a.sessionId)) bySession.set(a.sessionId, []);
    bySession.get(a.sessionId).push({
      page: a.page,
      activeSeconds: a.activeSeconds,
      startTime: a.startTime,
      endTime: a.endTime
    });
  }

  return sessions.map((s) => ({
    sessionId: s.sessionId,
    studentName: s.studentId?.name || 'Unknown',
    studentId: s.studentId?._id || s.studentId,
    startTime: s.startTime,
    endTime: s.endTime,
    totalActiveSeconds: s.totalActiveSeconds,
    isActive: s.isActive,
    pages: bySession.get(s.sessionId) || []
  }));
}

async function getDeviceWise(from, to, limit = 250, cohortIds = null) {
  const match = { ...sessionTimeRangeMatch(from, to) };
  if (cohortIds) match.studentId = { $in: cohortIds };
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 250, 1), 1000);

  const rows = await PortalSession.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          studentId: '$studentId',
          deviceLabel: { $ifNull: ['$deviceLabel', 'Unknown device'] },
          deviceType: { $ifNull: ['$deviceType', 'Unknown'] },
          os: { $ifNull: ['$os', 'Unknown OS'] },
          browser: { $ifNull: ['$browser', 'Unknown browser'] }
        },
        totalSeconds: { $sum: '$totalActiveSeconds' },
        sessionsCount: { $sum: 1 },
        lastSeenAt: { $max: '$lastHeartbeatAt' }
      }
    },
    { $sort: { totalSeconds: -1, sessionsCount: -1 } },
    { $limit: cap }
  ]);

  const studentIds = rows.map((r) => r?._id?.studentId).filter(Boolean);
  const users = studentIds.length
    ? await User.find({ _id: { $in: studentIds } }).select('_id name email').lean()
    : [];
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  return rows.map((r) => {
    const sid = String(r?._id?.studentId || '');
    const u = userMap.get(sid);
    return {
      studentId: sid,
      studentName: u?.name || 'Unknown',
      email: u?.email || '',
      deviceType: String(r?._id?.deviceType || 'Unknown'),
      os: String(r?._id?.os || 'Unknown OS'),
      browser: String(r?._id?.browser || 'Unknown browser'),
      deviceLabel: String(r?._id?.deviceLabel || 'Unknown device'),
      totalSeconds: Math.max(0, Math.floor(Number(r?.totalSeconds) || 0)),
      sessionsCount: Math.max(0, Number(r?.sessionsCount) || 0),
      lastSeenAt: r?.lastSeenAt || null
    };
  });
}

async function attachStudentNames(rowsByStudentId) {
  const ids = Object.keys(rowsByStudentId).filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!ids.length) return [];
  const users = await User.find({ _id: { $in: ids } })
    .select('_id name email batch currentCourseDay')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  return Object.entries(rowsByStudentId).map(([studentId, row]) => ({
    studentId,
    studentName: userMap.get(studentId)?.name || 'Unknown',
    email: userMap.get(studentId)?.email || '',
    batch: userMap.get(studentId)?.batch || '-',
    journeyDay: Number(userMap.get(studentId)?.currentCourseDay || 0) || null,
    ...row
  }));
}

function summarizeLearningRows(items, valueField = 'totalSeconds') {
  const totalSeconds = items.reduce((sum, it) => sum + Number(it[valueField] || 0), 0);
  const top = items.length
    ? items.reduce((best, curr) => (Number(curr[valueField] || 0) > Number(best[valueField] || 0) ? curr : best), items[0])
    : null;
  const avgSeconds = items.length ? Math.round(totalSeconds / items.length) : 0;
  return {
    totalSeconds,
    topStudent: top
      ? { studentId: top.studentId, name: top.studentName, seconds: Number(top[valueField] || 0) }
      : null,
    avgSeconds
  };
}

/** Recording / Zoom view rows overlapping the analytics window (player sends watch-duration heartbeats). */
function recordingViewWindowMatch(from, to) {
  return {
    $and: [{ startedAt: { $lte: to } }, { lastUpdatedAt: { $gte: from } }]
  };
}

/**
 * Recorded video: ClassRecording + Zoom recording watch time from RecordingView / ZoomRecordingView
 * (watchDuration updated by the player heartbeat), grouped per student with per-recording breakdown.
 */
async function getRecordedVideoWatchAnalytics(from, to, limit, cohortIds = null) {
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 300, 1), 1000);
  const win = recordingViewWindowMatch(from, to);
  const cohortFilter = cohortIds ? { student: { $in: cohortIds } } : {};

  const [manualChunks, zoomChunks] = await Promise.all([
    RecordingView.aggregate([
      { $match: { ...win, ...cohortFilter } },
      {
        $lookup: {
          from: 'classrecordings',
          localField: 'recording',
          foreignField: '_id',
          as: 'rec'
        }
      },
      { $match: { rec: { $elemMatch: { active: true } } } },
      { $unwind: '$rec' },
      {
        $group: {
          _id: { student: '$student', rid: '$recording' },
          seconds: { $sum: { $ifNull: ['$watchDuration', 0] } },
          viewSessions: { $sum: 1 },
          title: { $first: { $ifNull: ['$rec.title', 'Recording'] } }
        }
      }
    ]),
    ZoomRecordingView.aggregate([
      { $match: { ...win, ...cohortFilter } },
      {
        $lookup: {
          from: 'meetinglinks',
          localField: 'meetingLinkId',
          foreignField: '_id',
          as: 'ml'
        }
      },
      { $unwind: '$ml' },
      {
        $group: {
          _id: { student: '$student', mid: '$meetingLinkId' },
          seconds: { $sum: { $ifNull: ['$watchDuration', 0] } },
          viewSessions: { $sum: 1 },
          title: { $first: { $ifNull: ['$ml.topic', 'Zoom recording'] } }
        }
      }
    ])
  ]);

  const byStudent = new Map();
  const bump = (studentId, detailKey, title, seconds, viewSessions) => {
    if (!studentId || !mongoose.Types.ObjectId.isValid(String(studentId))) return;
    const sid = String(studentId);
    if (!byStudent.has(sid)) {
      byStudent.set(sid, { totalSeconds: 0, interactions: 0, detailsMap: new Map() });
    }
    const row = byStudent.get(sid);
    const sec = Math.max(0, Number(seconds) || 0);
    const vs = Math.max(0, Number(viewSessions) || 0);
    row.totalSeconds += sec;
    row.interactions += vs;
    if (!row.detailsMap.has(detailKey)) {
      row.detailsMap.set(detailKey, { title: String(title || 'Recording').trim() || 'Recording', seconds: 0, viewSessions: 0 });
    }
    const d = row.detailsMap.get(detailKey);
    d.seconds += sec;
    d.viewSessions += vs;
  };

  for (const r of manualChunks) {
    const st = r?._id?.student;
    const rid = r?._id?.rid;
    bump(st, `m:${String(rid)}`, r.title, r.seconds, r.viewSessions);
  }
  for (const r of zoomChunks) {
    const st = r?._id?.student;
    const mid = r?._id?.mid;
    bump(st, `z:${String(mid)}`, r.title, r.seconds, r.viewSessions);
  }

  const rowsByStudent = {};
  for (const [studentId, row] of byStudent) {
    const recordings = Array.from(row.detailsMap.values()).sort((a, b) => b.seconds - a.seconds);
    rowsByStudent[studentId] = {
      totalSeconds: row.totalSeconds,
      interactions: row.interactions,
      recordings
    };
  }

  let items = await attachStudentNames(rowsByStudent);
  items = items
    .filter((it) => Number(it.totalSeconds || 0) > 0)
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, cap);
  const summary = summarizeLearningRows(items, 'totalSeconds');
  return {
    kind: 'video',
    session: 'recorded',
    range: { from, to },
    summary,
    items
  };
}

/**
 * Live classes: Zoom-linked meetings in the window with per-student attendance duration.
 */
async function getLiveClassAttendanceAnalytics(from, to, limit, cohortIds = null) {
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 300, 1), 1000);

  const rows = await MeetingLink.aggregate([
    {
      $match: {
        startTime: { $gte: from, $lte: to },
        status: { $ne: 'cancelled' }
      }
    },
    { $unwind: { path: '$attendance', preserveNullAndEmptyArrays: false } },
    {
      $match: {
        $or: [
          { 'attendance.attended': true },
          { 'attendance.duration': { $gt: 0 } },
          { 'attendance.durationMinutes': { $gt: 0 } }
        ],
        ...(cohortIds ? { 'attendance.studentId': { $in: cohortIds } } : {})
      }
    },
    {
      $addFields: {
        studentId: '$attendance.studentId',
        sec: {
          $cond: [
            { $gt: [{ $ifNull: ['$attendance.duration', 0] }, 0] },
            { $ifNull: ['$attendance.duration', 0] },
            { $multiply: [{ $toDouble: { $ifNull: ['$attendance.durationMinutes', 0] } }, 60] }
          ]
        },
        embedName: { $ifNull: ['$attendance.name', ''] }
      }
    },
    { $match: { studentId: { $exists: true, $ne: null } } },
    {
      $project: {
        studentId: 1,
        embedName: 1,
        topic: { $ifNull: ['$topic', 'Live class'] },
        batch: { $ifNull: ['$batch', ''] },
        startTime: '$startTime',
        sec: 1
      }
    },
    {
      $group: {
        _id: '$studentId',
        totalSeconds: { $sum: '$sec' },
        classCount: { $sum: 1 },
        embedName: { $first: '$embedName' },
        classes: {
          $push: {
            topic: '$topic',
            batch: '$batch',
            seconds: '$sec',
            startTime: '$startTime'
          }
        }
      }
    },
    { $sort: { totalSeconds: -1 } },
    { $limit: cap * 2 }
  ]);

  const userIds = rows.map((r) => r._id).filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));
  const users = await User.find({ _id: { $in: userIds } })
    .select('_id name email')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const items = rows
    .map((r) => {
      const sid = String(r._id);
      const u = userMap.get(sid);
      const liveClasses = (r.classes || [])
        .map((c) => ({
          topic: c.topic,
          batch: c.batch,
          seconds: Math.max(0, Math.floor(Number(c.seconds) || 0)),
          startTime: c.startTime
        }))
        .sort((a, b) => (b.seconds || 0) - (a.seconds || 0));
      return {
        studentId: sid,
        studentName: u?.name || String(r.embedName || '').trim() || 'Unknown',
        email: u?.email || '',
        totalSeconds: Math.max(0, Math.floor(Number(r.totalSeconds) || 0)),
        interactions: Number(r.classCount || 0),
        liveClasses
      };
    })
    .filter((it) => it.totalSeconds > 0 || it.interactions > 0)
    .slice(0, cap);

  const summary = summarizeLearningRows(items, 'totalSeconds');
  return {
    kind: 'video',
    session: 'live',
    range: { from, to },
    summary,
    items
  };
}

/** Map portal URL (heartbeat `page`) to Recording vs Live + short title for analytics. */
function classifyPortalVideoPage(pageRaw) {
  const page = String(pageRaw || '/').trim() || '/';
  const p = page.split('?')[0] || '/';
  const lower = p.toLowerCase();

  const isLive =
    /(^|\/)teacher\/meetings(\/|$)/i.test(p) ||
    /\/join(\/|$)/i.test(lower) ||
    /live-class|liveclass|zoom-meeting|meeting-join/i.test(lower) ||
    (/meeting\b/i.test(lower) && !/class-recording\b/i.test(lower) && !/class-recordings\b/i.test(lower));

  const isExplicitRecordingRoute =
    /^\/class-recording\//i.test(p) ||
    /\/class-recordings(\/|$)/i.test(p) ||
    /\/recording(\/|$)/i.test(p) ||
    /zoom-recording|recording-player|player/i.test(lower);

  // Course hub page is too generic to claim "watched recording".
  if (/student\/my-course/i.test(p)) {
    return { bucket: 'none', title: 'My course' };
  }

  let title = p;
  if (/^\/class-recording\//i.test(p)) title = 'Class recording (replay)';
  else if (p.length > 72) title = `${p.slice(0, 69)}…`;

  if (isLive) return { bucket: 'live', title };
  if (isExplicitRecordingRoute) return { bucket: 'recording', title };
  return { bucket: 'none', title };
}

/**
 * Portal tab heartbeats on video-related routes, grouped per student with Recording vs Live split.
 */
async function getPortalVideoTypeBreakdown(from, to, cohortIds = null) {
  const kindRegex = /(my-course|class-recordings|recording|zoom|meeting)/i;
  const pageMatch = {
    startTime: { $lte: to },
    $or: [{ endTime: null }, { endTime: { $gte: from } }],
    ...(cohortIds ? { studentId: { $in: cohortIds } } : {})
  };
  const chunk = await PageActivity.aggregate([
    { $match: pageMatch },
    { $match: { page: { $regex: kindRegex } } },
    {
      $group: {
        _id: { studentId: '$studentId', page: '$page' },
        seconds: { $sum: '$activeSeconds' }
      }
    }
  ]);

  const byStudent = new Map();
  for (const r of chunk) {
    if (!r?._id?.studentId) continue;
    const sid = String(r._id.studentId);
    const page = String(r._id.page || '/');
    const sec = Math.max(0, Number(r.seconds || 0));
    const { bucket, title } = classifyPortalVideoPage(page);

    if (!byStudent.has(sid)) {
      byStudent.set(sid, { recordingSec: 0, liveSec: 0, pageCount: 0, lines: new Map() });
    }
    const st = byStudent.get(sid);
    st.pageCount += 1;
    if (bucket === 'live') st.liveSec += sec;
    else if (bucket === 'recording') st.recordingSec += sec;

    if (bucket !== 'none') {
      const key = `${bucket}|||${title}`;
      const line = st.lines.get(key) || { kind: bucket, title, seconds: 0 };
      line.seconds += sec;
      st.lines.set(key, line);
    }
  }

  for (const [, st] of byStudent) {
    st.typeRows = Array.from(st.lines.values()).sort((a, b) => b.seconds - a.seconds);
    delete st.lines;
  }
  return byStudent;
}

function mergeVideoTypeLines(portalPb, recordings, liveClasses) {
  const lineMap = new Map();
  const add = (kind, title, sec) => {
    const t = String(title || '').trim() || (kind === 'live' ? 'Live class' : 'Recording');
    const k = `${kind}|||${t}`;
    const cur = lineMap.get(k) || { kind, title: t, seconds: 0 };
    cur.seconds += Math.max(0, Number(sec) || 0);
    lineMap.set(k, cur);
  };

  if (portalPb?.typeRows) {
    for (const row of portalPb.typeRows) {
      add(row.kind, row.title, row.seconds);
    }
  }
  for (const rec of recordings || []) {
    add('recording', rec.title, rec.seconds);
  }
  for (const lc of liveClasses || []) {
    add('live', lc.topic, lc.seconds);
  }

  return Array.from(lineMap.values())
    .filter((x) => x.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
}

/**
 * Video: RecordingView + live attendance + portal heartbeats on video routes (merged Types + totals).
 * Totals use max(portal recording bucket, DB recording) + max(portal live bucket, DB live) to limit double-count.
 */
async function getCombinedVideoLearningAnalytics(from, to, limit, cohortIds = null) {
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 300, 1), 1000);
  const [recRes, liveRes, portalByStudent] = await Promise.all([
    getRecordedVideoWatchAnalytics(from, to, limit, cohortIds),
    getLiveClassAttendanceAnalytics(from, to, limit, cohortIds),
    getPortalVideoTypeBreakdown(from, to, cohortIds)
  ]);

  const byId = new Map();
  for (const it of recRes.items || []) {
    const sid = String(it.studentId);
    byId.set(sid, {
      studentId: sid,
      studentName: it.studentName,
      email: it.email || '',
      recordedSeconds: Number(it.totalSeconds || 0),
      liveSeconds: 0,
      recordedInteractions: Number(it.interactions || 0),
      liveInteractions: 0,
      recordings: Array.isArray(it.recordings) ? it.recordings : [],
      liveClasses: []
    });
  }
  for (const it of liveRes.items || []) {
    const sid = String(it.studentId);
    const existing = byId.get(sid);
    if (existing) {
      existing.liveSeconds = Number(it.totalSeconds || 0);
      existing.liveInteractions = Number(it.interactions || 0);
      existing.liveClasses = Array.isArray(it.liveClasses) ? it.liveClasses : [];
      if (!existing.email && it.email) existing.email = it.email;
    } else {
      byId.set(sid, {
        studentId: sid,
        studentName: it.studentName,
        email: it.email || '',
        recordedSeconds: 0,
        liveSeconds: Number(it.totalSeconds || 0),
        recordedInteractions: 0,
        liveInteractions: 0,
        recordings: [],
        liveClasses: Array.isArray(it.liveClasses) ? it.liveClasses : []
      });
    }
  }

  const allIds = new Set([...byId.keys(), ...portalByStudent.keys()]);
  const rowsByStudent = {};
  for (const sid of allIds) {
    const m = byId.get(sid) || {
      studentId: sid,
      studentName: '',
      email: '',
      recordedSeconds: 0,
      liveSeconds: 0,
      recordedInteractions: 0,
      liveInteractions: 0,
      recordings: [],
      liveClasses: []
    };
    const pb = portalByStudent.get(sid);

    const recS = Math.max(0, Number(m.recordedSeconds || 0));
    const liveS = Math.max(0, Number(m.liveSeconds || 0));
    const portalRec = pb ? Math.max(0, Number(pb.recordingSec || 0)) : 0;
    const portalLive = pb ? Math.max(0, Number(pb.liveSec || 0)) : 0;

    const totalSeconds = Math.max(recS, portalRec) + Math.max(liveS, portalLive);
    const interactions =
      Number(m.recordedInteractions || 0) +
      Number(m.liveInteractions || 0) +
      (pb ? Number(pb.pageCount || 0) : 0);

    let typeRows = mergeVideoTypeLines(pb, m.recordings || [], m.liveClasses || []);
    const sumType = typeRows.reduce((s, t) => s + Number(t.seconds || 0), 0);
    if (sumType > totalSeconds + 2 && totalSeconds >= 0 && sumType > 0) {
      const scale = totalSeconds / sumType;
      typeRows = typeRows.map((t) => ({
        ...t,
        seconds: Math.max(0, Math.round(Number(t.seconds || 0) * scale))
      }));
    }

    rowsByStudent[sid] = {
      recordedSeconds: recS,
      liveSeconds: liveS,
      totalSeconds,
      interactions,
      typeRows
    };
  }

  let items = await attachStudentNames(rowsByStudent);
  items = items
    .filter(
      (it) =>
        Number(it.totalSeconds || 0) > 0 ||
        Number(it.interactions || 0) > 0 ||
        (Array.isArray(it.typeRows) && it.typeRows.length > 0)
    )
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, cap);

  const summary = summarizeLearningRows(items, 'totalSeconds');
  return {
    kind: 'video',
    session: 'combined',
    range: { from, to },
    summary,
    items
  };
}

async function getLearningAnalytics(from, to, kind = 'video', limit = 300, cohort = null) {
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 300, 1), 1000);
  const k = String(kind || 'video').toLowerCase();
  const cohortIds = await getCohortStudentIds(cohort);

  if (k === 'video') {
    return getCombinedVideoLearningAnalytics(from, to, limit, cohortIds);
  }

  const pageMatch = {
    startTime: { $lte: to },
    $or: [{ endTime: null }, { endTime: { $gte: from } }],
    ...(cohortIds ? { studentId: { $in: cohortIds } } : {})
  };
  let kindRegex = null;
  if (k === 'exercises') {
    kindRegex = /(digital-exercises|exercise)/i;
  } else if (k === 'modules') {
    kindRegex = /(learning-modules|module)/i;
  } else {
    throw new Error('INVALID_LEARNING_KIND');
  }

  const agg = await PageActivity.aggregate([
    { $match: pageMatch },
    { $match: { page: { $regex: kindRegex } } },
    {
      $group: {
        _id: '$studentId',
        totalSeconds: { $sum: '$activeSeconds' },
        interactions: { $sum: 1 }
      }
    }
  ]);

  const rowsByStudent = {};
  for (const r of agg) {
    if (!r?._id) continue;
    rowsByStudent[String(r._id)] = {
      totalSeconds: Number(r.totalSeconds || 0),
      interactions: Number(r.interactions || 0)
    };
  }
  let items = await attachStudentNames(rowsByStudent);
  items = items.sort((a, b) => b.totalSeconds - a.totalSeconds).slice(0, cap);
  const summary = summarizeLearningRows(items, 'totalSeconds');
  return { kind: k, range: { from, to }, summary, items };
}

module.exports = {
  STALE_SILENCE_MS,
  startSession,
  heartbeat,
  endSession,
  closeStaleSessions,
  parseDateRange,
  getCohortStudentIds,
  getOverview,
  getStudentWise,
  getPageWise,
  getTimeline,
  getSessionWise,
  getDeviceWise,
  getDashboard,
  getDailyPortalLogs,
  getLearningAnalytics
};
