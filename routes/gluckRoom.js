const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const GluckRoomSession = require('../models/GluckRoomSession');
const GluckRoomParticipant = require('../models/GluckRoomParticipant');
const GluckRoomRecording = require('../models/GluckRoomRecording');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const gluckRoomService = require('../services/gluckRoomService');

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

// ── Session Management ──

// POST /api/gluckroom/sessions — Create a new session
router.post('/sessions', verifyToken, checkRole(['TEACHER', 'SUB_ADMIN', 'ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await User.findById(userId).select('role assignedBatches batch');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const {
      sessionName, scheduledStartTime, maxDurationMinutes, batch, courseDay, level,
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
      scheduledStartTime: new Date(scheduledStartTime),
      maxDurationMinutes: maxDurationMinutes || 180,
      batch,
      courseDay: courseDay || null,
      level: level || null,
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

    const { status, batch, page = 1, limit = 25 } = req.query;
    const query = {};

    if (user.role === 'STUDENT') {
      query.$or = [
        { accessType: 'open' },
        { allowedBatches: { $in: [user.batch] } },
        { allowedStudents: userId }
      ];
    }

    if (status) query.status = status;
    if (batch) query.batch = batch;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const skip = (pageNum - 1) * pageSize;

    const [sessions, totalCount] = await Promise.all([
      GluckRoomSession.find(query)
        .populate('hostId', 'name email')
        .populate('allowedStudents', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize),
      GluckRoomSession.countDocuments(query)
    ]);

    res.json({
      success: true,
      count: sessions.length,
      totalCount,
      pagination: {
        page: pageNum, limit: pageSize, totalItems: totalCount,
        totalPages: Math.ceil(totalCount / pageSize)
      },
      data: sessions
    });
  } catch (err) {
    console.error('List sessions error:', err);
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

    res.json({ success: true, data: session });
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

    const allowed = ['sessionName', 'scheduledStartTime', 'maxDurationMinutes', 'courseDay', 'level', 'accessType', 'maxParticipants', 'batch', 'allowedBatches', 'allowedStudents'];
    allowed.forEach(field => {
      if (req.body[field] !== undefined) session[field] = req.body[field];
    });

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
      await GluckRoomRecording.deleteMany({ sessionId: session._id });
      await GluckRoomSession.findByIdAndDelete(session._id);
      return res.json({ success: true, message: 'Session deleted permanently' });
    }

    if (session.status === 'active' && session.egressId) {
      await gluckRoomService.stopRecordingAndDeleteRoom(session.livekitRoomName, session.egressId);
    }

    session.status = 'cancelled';
    await session.save();
    res.json({ success: true, message: 'Session cancelled', data: session });
  } catch (err) {
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

    const videoSource = req.body.videoSource || 'camera';
    const { roomName, egressId } = await gluckRoomService.createRoomAndStartRecording(
      session.livekitRoomName,
      session.hostId.toString(),
      videoSource
    );

    session.livekitRoomName = roomName;
    session.egressId = egressId;
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

    if (session.egressId) {
      await gluckRoomService.stopRecordingAndDeleteRoom(session.livekitRoomName, session.egressId);
    }

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

    if (session.isRecordingPublished) {
      const r2Key = `gluckroom/${session.livekitRoomName}/recording.mp4`;
      const recording = new GluckRoomRecording({
        sessionId: session._id,
        r2Key,
        status: 'ready',
        isPublished: true,
        accessBatches: session.allowedBatches || [session.batch],
        accessLevel: session.level,
        accessPlan: 'ALL'
      });
      await recording.save();
      session.recordingKey = r2Key;
      await session.save();
    }

    res.json({ success: true, data: session });
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

// ── Recording ──

// GET /api/gluckroom/recordings/:id — Get presigned URL for playback
router.get('/recordings/:id', verifyToken, async (req, res) => {
  try {
    const recording = await GluckRoomRecording.findById(req.params.id).populate('sessionId', 'sessionName batch level');
    if (!recording) return res.status(404).json({ success: false, message: 'Recording not found' });

    if (!recording.isPublished && !isHostOrAdmin(req, recording)) {
      return res.status(403).json({ success: false, message: 'Recording is not published' });
    }

    const url = await gluckRoomService.getRecordingUrl(recording.r2Key);

    res.json({ success: true, data: { recording, playbackUrl: url } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/gluckroom/recordings/:id/publish — Publish/unpublish recording
router.put('/recordings/:id/publish', verifyToken, async (req, res) => {
  try {
    const recording = await GluckRoomRecording.findById(req.params.id);
    if (!recording) return res.status(404).json({ success: false, message: 'Recording not found' });

    const session = await GluckRoomSession.findById(recording.sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Access denied' });

    const { isPublished } = req.body;
    recording.isPublished = isPublished !== undefined ? isPublished : !recording.isPublished;
    recording.publishedAt = recording.isPublished ? new Date() : null;
    recording.publishedBy = recording.isPublished ? getUserId(req) : null;
    await recording.save();

    res.json({ success: true, data: recording });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/gluckroom/recordings/:id — Delete recording
router.delete('/recordings/:id', verifyToken, async (req, res) => {
  try {
    const recording = await GluckRoomRecording.findById(req.params.id);
    if (!recording) return res.status(404).json({ success: false, message: 'Recording not found' });

    const session = await GluckRoomSession.findById(recording.sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!isHostOrAdmin(req, session)) return res.status(403).json({ success: false, message: 'Access denied' });

    await GluckRoomRecording.deleteOne({ _id: recording._id });

    res.json({ success: true, message: 'Recording deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
