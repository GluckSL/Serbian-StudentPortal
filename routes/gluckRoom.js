const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const GluckRoomSession = require('../models/GluckRoomSession');
const GluckRoomParticipant = require('../models/GluckRoomParticipant');
const GluckRoomBreakout = require('../models/GluckRoomBreakout');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const gluckRoomService = require('../services/gluckRoomService');
const { generateJourneySchedules } = require('../services/journeyMeetingGenerator.service');

function getUserId(req) {
  return req.user?.id || req.user?.userId || req.user?._id;
}

function isHostOrAdmin(req, session) {
  const userId = getUserId(req);
  const role = req.user?.role;
  if (role === 'ADMIN' || role === 'SUB_ADMIN' || role === 'TEACHER_ADMIN') return true;
  return session.hostId.toString() === userId.toString();
}

async function getHostName(userId) {
  const user = await User.findById(userId).select('name');
  return user?.name || 'Unknown';
}

function parseScheduledTime(input, tz = 'Asia/Kolkata') {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (/Z|[+-]\d{2}:\d{2}$/.test(input)) return new Date(input);
  return new Date(`${input}+05:30`);
}

// ── Session Management ──

// POST /api/gluckroom/sessions — Create a new session
router.post('/sessions', verifyToken, checkRole(['TEACHER', 'SUB_ADMIN', 'ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await User.findById(userId).select('role assignedBatches batch');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const {
      sessionName, scheduledStartTime, maxDurationMinutes, batch, courseDay, level,
      plan, agenda, timezone, targetJourneyDay, scheduleType, journeySettings,
      accessType, allowedBatches, allowedStudents, maxParticipants
    } = req.body;

    if (!sessionName || !scheduledStartTime || !batch) {
      return res.status(400).json({ success: false, message: 'sessionName, scheduledStartTime, and batch are required' });
    }

    if (user.role === 'TEACHER' && !user.assignedBatches?.includes(batch)) {
      return res.status(403).json({ success: false, message: 'You can only create sessions for your assigned batches' });
    }

    const activeSession = await GluckRoomSession.findOne({ hostId: userId, status: 'active' });
    if (activeSession) {
      return res.status(409).json({ success: false, message: 'You already have an active session. End it before creating a new one.' });
    }

    const session = new GluckRoomSession({
      sessionName,
      hostId: userId,
      scheduledStartTime: parseScheduledTime(scheduledStartTime, timezone),
      maxDurationMinutes: maxDurationMinutes || 180,
      batch,
      courseDay: courseDay || null,
      targetJourneyDay: targetJourneyDay || null,
      level: level || null,
      plan: plan || null,
      agenda: agenda || '',
      timezone: timezone || 'Asia/Kolkata',
      scheduleType: scheduleType || 'single',
      journeySettings: journeySettings || undefined,
      accessType: accessType || 'batch',
      allowedBatches: allowedBatches || [batch],
      allowedStudents: allowedStudents || [],
      maxParticipants: maxParticipants || 100,
      livekitRoomName: `gluckroom_${new mongoose.Types.ObjectId()}_${Date.now()}`
    });

    await session.save();

    res.status(201).json({ success: true, data: session });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/gluckroom/sessions — List sessions
router.get('/sessions', verifyToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await User.findById(userId).select('role assignedBatches batch');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { status, batch, plan, scheduleType, search, includeTabCounts, page = 1, limit = 25 } = req.query;

    // Build base access filter (students only see their sessions)
    const baseAccess = {};
    if (user.role === 'STUDENT') {
      baseAccess.$or = [
        { accessType: 'open' },
        { allowedBatches: { $in: [user.batch] } },
        { allowedStudents: userId }
      ];
    }

    const query = { ...baseAccess };
    if (status) query.status = status;
    if (batch) query.batch = batch;
    if (plan) query.plan = plan;
    if (scheduleType) query.scheduleType = scheduleType;
    if (search && search.trim()) {
      query.sessionName = { $regex: search.trim(), $options: 'i' };
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const skip = (pageNum - 1) * pageSize;

    let sort = { createdAt: -1 };
    if (status === 'scheduled') sort = { scheduledStartTime: 1 };
    else if (status === 'active') sort = { actualStartTime: -1 };
    else if (status === 'ended') sort = { actualEndTime: -1 };

    // Build filter without status so tab counts span all statuses
    const baseFilter = { ...baseAccess };
    if (batch) baseFilter.batch = batch;
    if (plan) baseFilter.plan = plan;
    if (search && search.trim()) baseFilter.sessionName = { $regex: search.trim(), $options: 'i' };

    const countPromises = [
      GluckRoomSession.find(query)
        .populate('hostId', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(pageSize),
      GluckRoomSession.countDocuments(query),
      GluckRoomSession.distinct('batch', {}),
    ];

    if (includeTabCounts === 'true') {
      countPromises.push(
        GluckRoomSession.countDocuments({ ...baseFilter, status: 'scheduled' }),
        GluckRoomSession.countDocuments({ ...baseFilter, status: 'active' }),
        GluckRoomSession.countDocuments({ ...baseFilter, status: 'ended' })
      );
    }

    const results = await Promise.all(countPromises);
    const sessions = results[0];
    const totalCount = results[1];
    const availableBatches = (results[2] || []).sort();

    const response = {
      success: true,
      count: sessions.length,
      totalCount,
      pagination: {
        page: pageNum, limit: pageSize, totalItems: totalCount,
        totalPages: Math.ceil(totalCount / pageSize)
      },
      data: sessions,
      availableBatches
    };

    if (includeTabCounts === 'true') {
      response.tabCounts = {
        scheduled: results[3] || 0,
        active: results[4] || 0,
        ended: results[5] || 0
      };
    }

    res.json(response);
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/gluckroom/sessions/batches — Batch journey data for session creation
router.get('/sessions/batches', verifyToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await User.findById(userId).select('role assignedBatches batch');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let batchFilter = {};
    if (user.role === 'TEACHER' && user.assignedBatches?.length) {
      batchFilter = { batch: { $in: user.assignedBatches } };
    }

    const sessions = await GluckRoomSession.find(batchFilter)
      .select('batch courseDay targetJourneyDay plan')
      .sort({ createdAt: -1 })
      .lean();

    // Build batch summary from actual session data
    const batchMap = new Map();
    for (const s of sessions) {
      if (!s.batch) continue;
      if (!batchMap.has(s.batch)) {
        batchMap.set(s.batch, {
          batchName: s.batch,
          batchCurrentDay: 0,
          journeyLength: 200,
          journeyActive: true,
          plans: new Set()
        });
      }
      const entry = batchMap.get(s.batch);
      if (s.courseDay && s.courseDay > entry.batchCurrentDay) {
        entry.batchCurrentDay = s.courseDay;
      }
      if (s.plan) entry.plans.add(s.plan);
    }

    const batches = Array.from(batchMap.values()).map(b => ({
      ...b,
      plans: Array.from(b.plans)
    }));
    batches.sort((a, b) => a.batchName.localeCompare(b.batchName));

    res.json({ success: true, batches });
  } catch (err) {
    console.error('Batches error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/gluckroom/sessions/:id — Get session details
router.get('/sessions/:id', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id)
      .populate('hostId', 'name email')
      .populate('allowedStudents', 'name email');

    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    res.json({ success: true, data: session.toObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/gluckroom/sessions/:id — Update session (host only)
router.put('/sessions/:id', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only the host can update this session' });
    if (session.status !== 'scheduled') return res.status(400).json({ success: false, message: 'Can only update scheduled sessions' });

    const allowed = ['sessionName', 'maxDurationMinutes', 'courseDay', 'targetJourneyDay', 'level', 'plan', 'agenda', 'timezone', 'scheduleType', 'journeySettings', 'accessType', 'maxParticipants', 'batch', 'allowedBatches', 'allowedStudents'];
    allowed.forEach(field => {
      if (req.body[field] !== undefined) session[field] = req.body[field];
    });
    if (req.body.scheduledStartTime !== undefined) {
      session.scheduledStartTime = parseScheduledTime(req.body.scheduledStartTime, req.body.timezone || session.timezone);
    }

    await session.save();
    res.json({ success: true, data: session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/gluckroom/sessions/:id — Cancel or hard-delete session (host only)
router.delete('/sessions/:id', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only the host can cancel this session' });

    if (session.status === 'ended' || session.status === 'cancelled') {
      // Hard-delete ended/cancelled sessions and related records
      await GluckRoomParticipant.deleteMany({ sessionId: session._id });
      await GluckRoomSession.findByIdAndDelete(session._id);
      return res.json({ success: true, message: 'Session deleted permanently' });
    }

    if (session.status === 'active') {
      await gluckRoomService.deleteRoom(session.livekitRoomName);
    }

    session.status = 'cancelled';
    await session.save();
    res.json({ success: true, message: 'Session cancelled', data: session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/sessions/bulk/preview — Preview journey schedules
router.post('/sessions/bulk/preview', verifyToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await User.findById(userId).select('role');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { weekdaysSun0, startClock, startingJourneyDay, targetJourneyDay, durationMinutes } = req.body;

    if (!Array.isArray(weekdaysSun0) || weekdaysSun0.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one weekday' });
    }
    if (!startClock || !startingJourneyDay || !targetJourneyDay) {
      return res.status(400).json({ success: false, message: 'startClock, startingJourneyDay, and targetJourneyDay are required' });
    }

    const result = generateJourneySchedules({
      weekdaysSun0,
      startClock,
      startingJourneyDay: Number(startingJourneyDay),
      targetJourneyDay: Number(targetJourneyDay),
      durationMinutes: Number(durationMinutes) || 120
    });

    const totalTeachingHours = result.schedules.length * (Number(durationMinutes) || 120) / 60;

    res.json({
      success: true,
      data: {
        schedules: result.schedules,
        warnings: result.warnings,
        blockingErrors: [],
        totalTeachingHours: Math.round(totalTeachingHours * 10) / 10
      }
    });
  } catch (err) {
    console.error('Bulk preview error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/sessions/bulk — Create multiple sessions at once
router.post('/sessions/bulk', verifyToken, checkRole(['TEACHER', 'SUB_ADMIN', 'ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await User.findById(userId).select('role assignedBatches batch');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const {
      sessionName, batch, plan, level, teacherId,
      duration, timezone, agenda, studentIds,
      bulkScheduleId,
      startingJourneyDay, targetJourneyDay,
      schedules
    } = req.body;

    if (!sessionName || !batch || !Array.isArray(schedules) || schedules.length === 0) {
      return res.status(400).json({ success: false, message: 'sessionName, batch, and schedules array are required' });
    }

    if (user.role === 'TEACHER' && !user.assignedBatches?.includes(batch)) {
      return res.status(403).json({ success: false, message: 'You can only create sessions for your assigned batches' });
    }

    const created = [];
    const failures = [];
    const defaultAgenda = agenda || `Gluck Room - Batch ${batch}`;
    const bulkId = bulkScheduleId || `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    for (const slot of schedules) {
      try {
        const { journeyDay, startTime, endTime } = slot;
        if (!journeyDay || !startTime) {
          failures.push({ startTime: startTime || 'unknown', message: 'Missing journeyDay or startTime' });
          continue;
        }

        const scheduledStart = new Date(`${startTime}:00+05:30`);
        if (Number.isNaN(scheduledStart.getTime())) {
          failures.push({ startTime, message: 'Invalid startTime format' });
          continue;
        }

        const sessionDoc = new GluckRoomSession({
          sessionName: `${sessionName} - Day ${journeyDay}`,
          hostId: teacherId || userId,
          scheduledStartTime: scheduledStart,
          maxDurationMinutes: Number(duration) || 120,
          batch,
          courseDay: Number(journeyDay),
          targetJourneyDay: Number(targetJourneyDay) || null,
          level: level || null,
          plan: plan || null,
          agenda: defaultAgenda,
          timezone: timezone || 'Asia/Kolkata',
          scheduleType: 'journey',
          journeySettings: {
            weekdays: req.body.weekdaysSun0 || [],
            startClock: req.body.startClock || '19:00',
            bulkScheduleId: bulkId
          },
          accessType: 'batch',
          allowedBatches: [batch],
          allowedStudents: Array.isArray(studentIds) ? studentIds : [],
          livekitRoomName: `gluckroom_${new mongoose.Types.ObjectId()}_${Date.now()}`
        });

        await sessionDoc.save();
        created.push(sessionDoc);
      } catch (slotErr) {
        failures.push({ startTime: slot.startTime || 'unknown', message: slotErr.message });
      }
    }

    res.status(201).json({
      success: true,
      data: {
        sessions: created,
        summary: {
          createdCount: created.length,
          failedCount: failures.length,
          failedSchedules: failures
        }
      }
    });
  } catch (err) {
    console.error('Bulk create error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/sessions/:id/start — Start session (host only)
router.post('/sessions/:id/start', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only the host can start this session' });
    if (session.status !== 'scheduled') return res.status(400).json({ success: false, message: 'Session is not in scheduled status' });

    const activeSession = await GluckRoomSession.findOne({ hostId: session.hostId, status: 'active' });
    if (activeSession && activeSession._id.toString() !== session._id.toString()) {
      return res.status(409).json({ success: false, message: 'You already have another active session' });
    }

    const roomName = await gluckRoomService.createRoom(session.livekitRoomName);

    session.livekitRoomName = roomName;
    session.status = 'active';
    session.actualStartTime = new Date();
    await session.save();

    const hostName = await getHostName(session.hostId);
    const hostToken = await gluckRoomService.generateToken(roomName, session.hostId.toString(), hostName, true);

    res.json({ success: true, data: { session, hostToken } });
  } catch (err) {
    console.error('Start session error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/sessions/:id/end — End session (host only)
router.post('/sessions/:id/end', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only the host can end this session' });
    if (session.status !== 'active') return res.status(400).json({ success: false, message: 'Session is not active' });

    await gluckRoomService.deleteRoom(session.livekitRoomName);

    session.status = 'ended';
    session.actualEndTime = new Date();
    await session.save();

    const totalDurationMs = session.actualEndTime - session.actualStartTime;
    const totalDurationSeconds = totalDurationMs > 0 ? Math.floor(totalDurationMs / 1000) : 0;

    const participants = await GluckRoomParticipant.find({ sessionId: session._id, joinedAt: { $ne: null } });

    for (const participant of participants) {
      if (participant.leftAt && participant.joinedAt && totalDurationSeconds > 0) {
        const attendedSeconds = Math.floor((participant.leftAt - participant.joinedAt) / 1000);
        participant.durationSeconds = Math.max(0, attendedSeconds);
        participant.isPresent = (participant.durationSeconds / totalDurationSeconds) >= 0.7;
      } else {
        participant.isPresent = false;
      }
      await participant.save();
    }

    session.participantCount = participants.length;
    await session.save();

    try {
      const roomNamespace = req.app.get('gluckRoomNamespace');
      if (roomNamespace) {
        roomNamespace.to(session.livekitRoomName).emit('session-ended');
      }
    } catch (err) {
      console.warn('Could not emit session-ended event:', err.message);
    }

    const updatedSession = await GluckRoomSession.findById(session._id)
      .populate('hostId', 'name email')
      .populate('allowedStudents', 'name email');

    res.json({ success: true, data: updatedSession });
  } catch (err) {
    console.error('End session error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Access Control ──

// POST /api/gluckroom/sessions/:id/students — Add students manually (host only)
router.post('/sessions/:id/students', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only the host can manage students' });

    const { studentIds } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'studentIds array is required' });
    }

    const existingIds = session.allowedStudents.map(s => s.toString());
    const newIds = studentIds.filter(id => !existingIds.includes(id.toString()));
    session.allowedStudents.push(...newIds);
    await session.save();

    res.json({ success: true, data: session.allowedStudents });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/gluckroom/sessions/:id/students/:studentId — Remove student (host only)
router.delete('/sessions/:id/students/:studentId', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only the host can manage students' });

    session.allowedStudents = session.allowedStudents.filter(
      s => s.toString() !== req.params.studentId
    );
    await session.save();

    res.json({ success: true, data: session.allowedStudents });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/gluckroom/sessions/:id/students — List allowed students (host only)
router.get('/sessions/:id/students', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id).populate('allowedStudents', 'name email batch');
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    res.json({ success: true, data: session.allowedStudents });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/gluckroom/sessions/:id/batches — Update allowed batches (host only)
router.put('/sessions/:id/batches', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only the host can manage batches' });

    const { allowedBatches } = req.body;
    if (!Array.isArray(allowedBatches)) {
      return res.status(400).json({ success: false, message: 'allowedBatches array is required' });
    }

    session.allowedBatches = allowedBatches;
    await session.save();

    res.json({ success: true, data: session.allowedBatches });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Participation ──

// POST /api/gluckroom/sessions/:id/token — Generate LiveKit JWT
router.post('/sessions/:id/token', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (session.status !== 'active') return res.status(400).json({ success: false, message: 'Session is not active' });

    const userId = getUserId(req);
    const user = await User.findById(userId).select('name role');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const isStudent = user.role === 'STUDENT';
    const canPublish = true;
    const canPublishSources = isStudent ? [1, 2] : [];
    const token = await gluckRoomService.generateToken(session.livekitRoomName, userId.toString(), user.name, canPublish, canPublishSources);

    res.json({ success: true, data: { token, roomName: session.livekitRoomName, livekitUrl: process.env.LIVEKIT_URL } });
  } catch (err) {
    console.error('Token generation error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/sessions/:id/join — Join session
router.post('/sessions/:id/join', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (session.status !== 'active') return res.status(400).json({ success: false, message: 'Session is not active' });

    const userId = getUserId(req);
    const user = await User.findById(userId).select('name role batch email');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let joinMethod = 'batch_access';
    let authorized = false;

    if (user.role !== 'STUDENT') {
      authorized = true;
      joinMethod = 'admin_override';
    } else if (session.hostId.toString() === userId.toString()) {
      authorized = true;
      joinMethod = 'host_invite';
    } else if (session.accessType === 'open') {
      authorized = true;
      joinMethod = 'batch_access';
    } else if (session.accessType === 'batch' && session.allowedBatches.includes(user.batch)) {
      authorized = true;
      joinMethod = 'batch_access';
    } else if (session.accessType === 'manual' && session.allowedStudents.some(s => s.toString() === userId.toString())) {
      authorized = true;
      joinMethod = 'manual';
    }

    if (!authorized) {
      return res.status(403).json({ success: false, message: 'You are not authorized to join this session' });
    }

    const isStudent = user.role === 'STUDENT';
    const canPublish = true;
    const canPublishSources = isStudent ? [1, 2] : [];
    const token = await gluckRoomService.generateToken(session.livekitRoomName, userId.toString(), user.name, canPublish, canPublishSources);

    let participant = await GluckRoomParticipant.findOne({ sessionId: session._id, userId });
    if (!participant) {
      const participantRole = user.role === 'STUDENT' ? 'student' :
        user.role === 'TEACHER' ? 'teacher' :
        user.role === 'ADMIN' || user.role === 'TEACHER_ADMIN' ? 'admin' : 'student';

      participant = new GluckRoomParticipant({
        sessionId: session._id,
        userId,
        role: participantRole,
        joinMethod,
        isMuted: true,
        isCameraDisabled: true,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    }

    participant.joinedAt = new Date();
    participant.leftAt = null;
    await participant.save();

    session.participantCount = await GluckRoomParticipant.countDocuments({ sessionId: session._id, joinedAt: { $ne: null } });
    await session.save();

    res.json({
      success: true,
      data: {
        token,
        roomName: session.livekitRoomName,
        livekitUrl: process.env.LIVEKIT_URL,
        participant
      }
    });
  } catch (err) {
    console.error('Join session error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/sessions/:id/leave — Leave session
router.post('/sessions/:id/leave', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const userId = getUserId(req);
    const participant = await GluckRoomParticipant.findOne({ sessionId: session._id, userId });
    if (!participant) return res.status(404).json({ success: false, message: 'Participant record not found' });

    participant.leftAt = new Date();
    if (participant.joinedAt) {
      participant.durationSeconds = Math.floor((participant.leftAt - participant.joinedAt) / 1000);
    }
    await participant.save();

    session.participantCount = await GluckRoomParticipant.countDocuments({ sessionId: session._id, joinedAt: { $ne: null } });
    await session.save();

    res.json({ success: true, message: 'Left session', data: participant });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Attendance & Metrics ──

// GET /api/gluckroom/sessions/:id/attendance — Get attendance report
router.get('/sessions/:id/attendance', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Access denied' });

    const participants = await GluckRoomParticipant.find({ sessionId: session._id })
      .populate('userId', 'name email batch')
      .sort({ joinedAt: 1 });

    const totalDurationMs = session.actualEndTime && session.actualStartTime
      ? session.actualEndTime - session.actualStartTime
      : 0;
    const totalDurationSeconds = totalDurationMs > 0 ? Math.floor(totalDurationMs / 1000) : 0;

    const attendance = participants.map(p => ({
      user: p.userId,
      role: p.role,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt,
      durationSeconds: p.durationSeconds,
      attendancePercent: totalDurationSeconds > 0
        ? Math.round((p.durationSeconds / totalDurationSeconds) * 100)
        : 0,
      isPresent: p.isPresent,
      joinMethod: p.joinMethod
    }));

    res.json({ success: true, data: { session: { _id: session._id, sessionName: session.sessionName }, attendance } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/gluckroom/sessions/:id/metrics — Get session metrics
router.get('/sessions/:id/metrics', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Access denied' });

    const totalParticipants = await GluckRoomParticipant.countDocuments({ sessionId: session._id });
    const presentCount = await GluckRoomParticipant.countDocuments({ sessionId: session._id, isPresent: true });
    const totalDurationMs = session.actualEndTime && session.actualStartTime
      ? session.actualEndTime - session.actualStartTime
      : 0;

    res.json({
      success: true,
      data: {
        sessionName: session.sessionName,
        status: session.status,
        actualStartTime: session.actualStartTime,
        actualEndTime: session.actualEndTime,
        durationMinutes: totalDurationMs > 0 ? Math.round(totalDurationMs / 60000) : 0,
        totalParticipants,
        presentCount,
        absentCount: totalParticipants - presentCount,
        participantCount: session.participantCount,
        maxParticipants: session.maxParticipants
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/gluckroom/attendance/batch/:batch — Batch attendance overview
router.get('/attendance/batch/:batch', verifyToken, async (req, res) => {
  try {
    const { batch } = req.params;
    const sessions = await GluckRoomSession.find({ batch, status: 'ended' }).select('_id sessionName actualStartTime actualEndTime');
    const sessionIds = sessions.map(s => s._id);

    const participants = await GluckRoomParticipant.find({ sessionId: { $in: sessionIds } })
      .populate('userId', 'name email batch');

    const studentMap = {};
    for (const p of participants) {
      const uid = p.userId?._id?.toString();
      if (!uid) continue;
      if (!studentMap[uid]) {
        studentMap[uid] = { user: p.userId, sessionsAttended: 0, totalSessions: 0, totalDurationSeconds: 0 };
      }
      studentMap[uid].totalSessions++;
      if (p.isPresent) studentMap[uid].sessionsAttended++;
      studentMap[uid].totalDurationSeconds += p.durationSeconds;
    }

    const summary = Object.values(studentMap).map(s => ({
      user: s.user,
      sessionsAttended: s.sessionsAttended,
      totalSessions: s.totalSessions,
      attendanceRate: s.totalSessions > 0 ? Math.round((s.sessionsAttended / s.totalSessions) * 100) : 0,
      totalDurationMinutes: Math.round(s.totalDurationSeconds / 60)
    }));

    res.json({ success: true, data: { batch, totalSessions: sessions.length, students: summary } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/gluckroom/attendance/student/:userId — Student attendance history
router.get('/attendance/student/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('name email batch');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const participants = await GluckRoomParticipant.find({ userId })
      .populate({ path: 'sessionId', select: 'sessionName batch actualStartTime actualEndTime status' })
      .sort({ joinedAt: -1 });

    const history = participants.map(p => ({
      session: p.sessionId,
      role: p.role,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt,
      durationSeconds: p.durationSeconds,
      isPresent: p.isPresent,
      joinMethod: p.joinMethod
    }));

    res.json({ success: true, data: { user, history } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Breakout Rooms ──

// POST /api/gluckroom/sessions/:id/breakouts — Create breakout rooms
router.post('/sessions/:id/breakouts', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only host can create breakouts' });
    if (session.status !== 'active') return res.status(400).json({ success: false, message: 'Session must be active' });

    const { count = 1, namePrefix = 'Room' } = req.body;
    const userId = getUserId(req);
    const created = [];

    for (let i = 1; i <= count; i++) {
      const livekitRoomName = `breakout_${session._id}_${i}_${Date.now()}`;
      await gluckRoomService.createBreakoutRoom(livekitRoomName);

      const breakout = await GluckRoomBreakout.create({
        sessionId: session._id,
        name: `${namePrefix} ${i}`,
        livekitRoomName,
        hostId: userId,
        assignedParticipants: [],
        status: 'active',
      });
      created.push(breakout);
    }

    const roomNamespace = req.app.get('gluckRoomNamespace');
    if (roomNamespace) {
      roomNamespace.to(session.livekitRoomName).emit('breakouts-updated');
    }

    res.json({ success: true, data: created });
  } catch (err) {
    console.error('Create breakouts error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/gluckroom/sessions/:id/breakouts — List breakout rooms
router.get('/sessions/:id/breakouts', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const breakouts = await GluckRoomBreakout.find({ sessionId: session._id, status: 'active' })
      .populate('assignedParticipants', 'name email')
      .sort({ createdAt: 1 });

    res.json({ success: true, data: breakouts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/sessions/:id/breakouts/:breakoutId/assign — Assign participants to breakout
router.post('/sessions/:id/breakouts/:breakoutId/assign', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only host can assign' });

    const breakout = await GluckRoomBreakout.findById(req.params.breakoutId);
    if (!breakout) return res.status(404).json({ success: false, message: 'Breakout not found' });
    if (breakout.status !== 'active') return res.status(400).json({ success: false, message: 'Breakout is ended' });

    breakout.assignedParticipants = req.body.participantIds || [];
    await breakout.save();

    const populated = await GluckRoomBreakout.findById(breakout._id)
      .populate('assignedParticipants', 'name email');

    // Notify assigned participants via socket
    const roomNamespace = req.app.get('gluckRoomNamespace');
    if (roomNamespace) {
      for (const pid of breakout.assignedParticipants) {
        roomNamespace.to(session.livekitRoomName).emit('breakout-assigned', {
          breakoutId: breakout._id,
          breakoutName: breakout.name,
          participantId: pid.toString(),
        });
      }
      roomNamespace.to(session.livekitRoomName).emit('breakouts-updated');
    }

    res.json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/sessions/:id/breakouts/:breakoutId/join — Get token for breakout
router.post('/sessions/:id/breakouts/:breakoutId/join', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (session.status !== 'active') return res.status(400).json({ success: false, message: 'Session is not active' });

    const breakout = await GluckRoomBreakout.findById(req.params.breakoutId);
    if (!breakout) return res.status(404).json({ success: false, message: 'Breakout not found' });
    if (breakout.status !== 'active') return res.status(400).json({ success: false, message: 'Breakout is ended' });

    const userId = getUserId(req);
    const isHost = isHostOrAdmin(req, session);
    const isAssigned = breakout.assignedParticipants.some(
      pid => pid.toString() === userId.toString()
    );

    if (!isHost && !isAssigned) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this breakout' });
    }

    const user = await User.findById(userId).select('name');
    const token = await gluckRoomService.generateBreakoutToken(
      breakout.livekitRoomName,
      userId,
      user?.name || 'Unknown'
    );

    res.json({
      success: true,
      data: {
        token,
        livekitUrl: process.env.LIVEKIT_URL,
        roomName: breakout.livekitRoomName,
        breakoutName: breakout.name,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/sessions/:id/breakouts/:breakoutId/leave — Leave breakout (no-op)
router.post('/sessions/:id/breakouts/:breakoutId/leave', verifyToken, (req, res) => {
  res.json({ success: true, message: 'Left breakout' });
});

// POST /api/gluckroom/sessions/:id/breakouts/:breakoutId/end — End a specific breakout
router.post('/sessions/:id/breakouts/:breakoutId/end', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only host can end breakouts' });

    const breakout = await GluckRoomBreakout.findById(req.params.breakoutId);
    if (!breakout) return res.status(404).json({ success: false, message: 'Breakout not found' });

    await gluckRoomService.deleteBreakoutRoom(breakout.livekitRoomName);

    breakout.status = 'ended';
    breakout.endedAt = new Date();
    breakout.assignedParticipants = [];
    await breakout.save();

    const roomNamespace = req.app.get('gluckRoomNamespace');
    if (roomNamespace) {
      roomNamespace.to(session.livekitRoomName).emit('breakout-ended', {
        breakoutId: breakout._id.toString(),
      });
      roomNamespace.to(session.livekitRoomName).emit('breakouts-updated');
    }

    res.json({ success: true, data: breakout });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/sessions/:id/breakouts/end-all — End all active breakouts
router.post('/sessions/:id/breakouts/end-all', verifyToken, async (req, res) => {
  try {
    const session = await GluckRoomSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Only host can end breakouts' });

    const active = await GluckRoomBreakout.find({ sessionId: session._id, status: 'active' });

    for (const breakout of active) {
      await gluckRoomService.deleteBreakoutRoom(breakout.livekitRoomName);
      breakout.status = 'ended';
      breakout.endedAt = new Date();
      breakout.assignedParticipants = [];
      await breakout.save();
    }

    const roomNamespace = req.app.get('gluckRoomNamespace');
    if (roomNamespace) {
      roomNamespace.to(session.livekitRoomName).emit('breakout-return-to-main');
      roomNamespace.to(session.livekitRoomName).emit('breakouts-updated');
    }

    res.json({ success: true, data: { ended: active.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
