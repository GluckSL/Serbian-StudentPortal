const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const PortalSession = require('../models/portalSession.model');
const PageActivity = require('../models/pageActivity.model');
const User = require('../models/User');
const UserActivityLog = require('../models/UserActivityLog');
const StudentLogs = require('../models/StudentLogs');

/** Max seconds credited per heartbeat (tab sends ~every 10s when active). */
const MAX_CREDIT_PER_HEARTBEAT_SEC = 30;
/** No heartbeat for this long → session treated as dead on next heartbeat. */
const HEARTBEAT_GAP_STALE_SEC = 120;
/** Cron / auto-close: silence longer than this ends the session. */
const STALE_SILENCE_MS = 2 * 60 * 1000;

function parseObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function parseDateRange(query) {
  const now = new Date();
  let to = query.to ? new Date(query.to) : now;
  let from = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime())) from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(to.getTime())) to = now;
  if (from > to) {
    const t = from;
    from = to;
    to = t;
  }
  return { from, to };
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

async function startSession(studentId) {
  const sid = parseObjectId(studentId);
  if (!sid) throw new Error('INVALID_STUDENT');

  const sessionId = randomUUID();
  const now = new Date();

  await closeOtherActiveSessions(sid, sessionId);

  const doc = await PortalSession.create({
    studentId: sid,
    sessionId,
    startTime: now,
    endTime: null,
    totalActiveSeconds: 0,
    lastHeartbeatAt: now,
    isActive: true
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

async function getOverview(from, to) {
  const match = { ...sessionTimeRangeMatch(from, to) };

  const [sessionAgg] = await PortalSession.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalSeconds: { $sum: '$totalActiveSeconds' },
        distinctStudents: { $addToSet: '$studentId' }
      }
    },
    {
      $project: {
        totalSeconds: 1,
        studentCount: { $size: '$distinctStudents' }
      }
    }
  ]);

  const totalSeconds = sessionAgg?.totalSeconds || 0;
  const studentCount = sessionAgg?.studentCount || 0;
  const avgTimePerStudent = studentCount > 0 ? Math.round(totalSeconds / studentCount) : 0;

  const activeCutoff = new Date(Date.now() - 5 * 60 * 1000);
  const activeStudents = await PortalSession.distinct('studentId', {
    isActive: true,
    lastHeartbeatAt: { $gte: activeCutoff }
  });

  const pageMatch = {
    startTime: { $lte: to },
    $or: [{ endTime: null }, { endTime: { $gte: from } }, { endTime: { $exists: false } }]
  };

  const [topPage] = await PageActivity.aggregate([
    { $match: pageMatch },
    { $group: { _id: '$page', seconds: { $sum: '$activeSeconds' } } },
    { $sort: { seconds: -1 } },
    { $limit: 1 }
  ]);

  const [topStudent] = await PortalSession.aggregate([
    { $match: match },
    { $group: { _id: '$studentId', seconds: { $sum: '$totalActiveSeconds' } } },
    { $sort: { seconds: -1 } },
    { $limit: 1 }
  ]);

  let topStudentName = null;
  if (topStudent?._id) {
    const u = await User.findById(topStudent._id).select('name').lean();
    topStudentName = u?.name || String(topStudent._id);
  }

  return {
    totalTime: totalSeconds,
    activeStudents: activeStudents.length,
    avgTimePerStudent,
    topPage: topPage ? { page: topPage._id, seconds: topPage.seconds } : null,
    topStudent: topStudent
      ? { studentId: topStudent._id, name: topStudentName, seconds: topStudent.seconds }
      : null,
    range: { from, to }
  };
}

async function getStudentWise(from, to, limit = 200, sortBy = 'time', order = 'desc') {
  const match = { ...sessionTimeRangeMatch(from, to) };
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

  const users = await User.find({ _id: { $in: studentIds } })
    .select('name email')
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
      totalSeconds: row.totalSeconds,
      sessionsCount: row.sessionsCount,
      avgSessionSeconds: avgSession,
      topPage: tp?.topPage || '—',
      topPageSeconds: tp?.topPageSeconds || 0
    };
  });
}

async function getPageWise(from, to, limit = 200) {
  const pageMatch = {
    startTime: { $lte: to },
    $or: [{ endTime: null }, { endTime: { $gte: from } }]
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

  const grandTotal = pageRows.reduce((acc, r) => acc + (r.totalSeconds || 0), 0);
  return pageRows.map((r) => ({
    ...r,
    pctOfTracked: grandTotal > 0 ? Math.round((r.totalSeconds / grandTotal) * 1000) / 10 : 0
  }));
}

async function getTimeline(from, to, limit = 50, skip = 0) {
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
  const sk = Math.min(Math.max(parseInt(String(skip), 10) || 0, 0), 50000);
  const match = {
    startTime: { $lte: to },
    $or: [{ endTime: null }, { endTime: { $gte: from } }]
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

  const items = raw.map((r) => ({
    time: r.startTime,
    endTime: r.endTime,
    page: r.page,
    type: 'PAGE',
    durationSeconds: r.activeSeconds,
    studentName: r.studentId?.name || 'Unknown',
    studentId: r.studentId?._id || r.studentId,
    sessionId: r.sessionId
  }));

  return { items, total, skip: sk, limit: cap };
}

async function getTimeSeriesDaily(from, to) {
  return PageActivity.aggregate([
    { $match: { startTime: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
        seconds: { $sum: '$activeSeconds' }
      }
    },
    { $sort: { _id: 1 } },
    { $project: { date: '$_id', seconds: 1, _id: 0 } }
  ]);
}

async function getPageSharesForDonut(from, to, topN = 8) {
  const rows = await PageActivity.aggregate([
    { $match: { startTime: { $gte: from, $lte: to } } },
    { $group: { _id: '$page', seconds: { $sum: '$activeSeconds' } } },
    { $sort: { seconds: -1 } }
  ]);
  const n = Math.min(topN, rows.length);
  const top = rows.slice(0, n);
  const otherSum = rows.slice(n).reduce((a, r) => a + (r.seconds || 0), 0);
  const labels = top.map((r) => r._id);
  const values = top.map((r) => r.seconds);
  if (otherSum > 0) {
    labels.push('Other');
    values.push(otherSum);
  }
  return { labels, values };
}

async function getActiveStudentsDetail(limit = 30) {
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 30, 1), 100);
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const sessions = await PortalSession.find({
    isActive: true,
    lastHeartbeatAt: { $gte: cutoff }
  })
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

async function getRecentPageEvents(from, to, limit = 35) {
  const cap = Math.min(Math.max(parseInt(String(limit), 10) || 35, 1), 100);
  const rows = await PageActivity.find({
    startTime: { $gte: from, $lte: to }
  })
    .sort({ startTime: -1 })
    .limit(cap)
    .populate('studentId', 'name')
    .lean();

  return rows.map((r) => ({
    time: r.startTime,
    studentName: r.studentId?.name || 'Unknown',
    page: r.page,
    type: 'PAGE',
    durationSeconds: r.activeSeconds,
    sessionId: r.sessionId
  }));
}

async function getPeakHour(from, to) {
  const rows = await PageActivity.aggregate([
    { $match: { startTime: { $gte: from, $lte: to } } },
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

async function getPeakDayOfWeek(from, to) {
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const rows = await PageActivity.aggregate([
    { $match: { startTime: { $gte: from, $lte: to } } },
    { $group: { _id: { $dayOfWeek: '$startTime' }, seconds: { $sum: '$activeSeconds' } } },
    { $sort: { seconds: -1 } },
    { $limit: 1 }
  ]);
  if (!rows.length) return null;
  const idx = rows[0]._id - 1;
  return { dayIndex: rows[0]._id, label: dow[idx] || String(rows[0]._id), seconds: rows[0].seconds };
}

async function getEngagementLeaders(from, to, limit = 12) {
  const match = { ...sessionTimeRangeMatch(from, to) };
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

async function getDropOffPages(from, to, limit = 6) {
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 6, 1), 25);
  return PageActivity.aggregate([
    { $match: { startTime: { $gte: from, $lte: to }, endTime: { $ne: null } } },
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
}

async function buildInsights(from, to, overview) {
  const spanMs = Math.max(to.getTime() - from.getTime(), 86400000);
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - spanMs);
  const prev = await getOverview(prevFrom, prevTo);
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
  const low = await PortalSession.aggregate([
    { $match: { ...sessionTimeRangeMatch(from, to) } },
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

async function getDashboard(from, to, includeHistorical) {
  const overview = await getOverview(from, to);
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
    getTimeSeriesDaily(from, to),
    getPageSharesForDonut(from, to, 8),
    getActiveStudentsDetail(30),
    getRecentPageEvents(from, to, 35),
    getPeakHour(from, to),
    getPeakDayOfWeek(from, to),
    getEngagementLeaders(from, to, 12),
    getDropOffPages(from, to, 6),
    buildInsights(from, to, overview)
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

async function getSessionWise(from, to, limit = 200) {
  const match = { ...sessionTimeRangeMatch(from, to) };
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

module.exports = {
  STALE_SILENCE_MS,
  startSession,
  heartbeat,
  endSession,
  closeStaleSessions,
  parseDateRange,
  getOverview,
  getStudentWise,
  getPageWise,
  getTimeline,
  getSessionWise,
  getDashboard
};
