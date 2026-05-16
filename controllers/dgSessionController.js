const DGSession = require('../models/DGSession');
const DGModule = require('../models/DGModule');
const {
  getStudentDgJourneyAccess,
  dgModuleUnlockedForStudentDay,
} = require('../utils/dgStudentJourneyGate');
const { totalSessionMinutes, extractChatTurns, effectiveSessionScore } = require('../utils/dgSessionMetrics');

function pushLog(session, entry) {
  session.logs.push({
    at: new Date(),
    ...entry,
  });
}

exports.start = async (req, res) => {
  try {
    const { moduleId } = req.body;
    if (!moduleId) return res.status(400).json({ message: 'moduleId required' });

    const mod = await DGModule.findById(moduleId);
    if (!mod || !mod.isActive) {
      return res.status(404).json({ message: 'Module not found' });
    }
    if (req.user.role === 'STUDENT' && !mod.visibleToStudents) {
      return res.status(403).json({ message: 'Module not available' });
    }

    if (req.user.role === 'STUDENT') {
      const access = await getStudentDgJourneyAccess(req.user.id);
      if (!access.enabled) {
        return res.status(403).json({
          message: 'Journey content is not enabled for your batch yet.',
          code: 'JOURNEY_NOT_ACTIVE',
        });
      }
      if (access.learningEnabled === false) {
        return res.status(403).json({
          message: 'DG modules are not available for your batch.',
          code: 'LEARNING_CONTENT_DISABLED',
        });
      }
      if (!dgModuleUnlockedForStudentDay(mod.courseDay, access.courseDay)) {
        return res.status(403).json({
          message: 'This module unlocks on a later day of your course.',
          code: 'COURSE_DAY_LOCKED',
          studentCourseDay: access.courseDay,
          moduleCourseDay: mod.courseDay,
        });
      }
    }

    const session = new DGSession({
      studentId: req.user.id,
      moduleId,
      currentSceneIndex: 0,
      attempts: 0,
      score: 0,
      completed: false,
    });
    pushLog(session, { event: 'session_start', sceneIndex: 0, meta: { moduleTitle: mod.title } });
    await session.save();

    res.status(201).json({
      sessionId: session._id,
      currentSceneIndex: session.currentSceneIndex,
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Start failed' });
  }
};

exports.update = async (req, res) => {
  try {
    const {
      sessionId,
      event,
      sceneIndex,
      durationMs,
      attemptsDelta,
      success,
      transcript,
      score,
      silenceFailure,
      meta,
    } = req.body;

    if (!sessionId || !event) {
      return res.status(400).json({ message: 'sessionId and event required' });
    }

    const session = await DGSession.findById(sessionId);
    if (!session || session.studentId.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Session not found' });
    }
    if (session.completed) {
      return res.status(400).json({ message: 'Session already completed' });
    }

    const idx = sceneIndex != null ? Number(sceneIndex) : session.currentSceneIndex;
    if (Number.isFinite(idx)) session.currentSceneIndex = idx;

    if (typeof attemptsDelta === 'number' && attemptsDelta > 0) {
      session.attempts += attemptsDelta;
    }
    if (success === true) session.successCount += 1;
    if (success === false) session.failureCount += 1;
    if (silenceFailure === true) session.silenceFailureCount += 1;

    if (typeof score === 'number' && Number.isFinite(score)) {
      session.score = Math.max(session.score, Math.round(score));
    }

    if (typeof durationMs === 'number' && Number.isFinite(durationMs) && Number.isFinite(idx)) {
      session.timePerSceneMs[idx] = (session.timePerSceneMs[idx] || 0) + durationMs;
    }

    pushLog(session, {
      event,
      sceneIndex: Number.isFinite(idx) ? idx : null,
      durationMs: durationMs ?? null,
      attemptsDelta: attemptsDelta || 0,
      success: success ?? null,
      transcript: transcript || '',
      score: score ?? null,
      silenceFailure: !!silenceFailure,
      meta: meta || {},
    });

    await session.save();
    res.json({
      ok: true,
      session: {
        _id: session._id,
        currentSceneIndex: session.currentSceneIndex,
        attempts: session.attempts,
        successCount: session.successCount,
        failureCount: session.failureCount,
        silenceFailureCount: session.silenceFailureCount,
        score: session.score,
        completed: session.completed,
      },
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Update failed' });
  }
};

exports.complete = async (req, res) => {
  try {
    const { sessionId, finalScore, moduleCompletionPercent, naturalConversationComplete } = req.body;
    if (!sessionId) return res.status(400).json({ message: 'sessionId required' });

    const session = await DGSession.findById(sessionId);
    if (!session || session.studentId.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Session not found' });
    }

    session.completed = true;
    session.completedAt = new Date();
    if (typeof finalScore === 'number' && Number.isFinite(finalScore)) {
      session.score = Math.round(finalScore);
    }

    const natural = naturalConversationComplete === true;
    const pctRaw =
      typeof moduleCompletionPercent === 'number' && Number.isFinite(moduleCompletionPercent)
        ? Math.round(moduleCompletionPercent)
        : null;
    const pct = pctRaw != null ? Math.min(100, Math.max(0, pctRaw)) : null;
    const hasNewProgressPayload = natural || pct != null;

    if (!hasNewProgressPayload) {
      // Older clients: keep previous behaviour (session counts as fully done in the hub).
      session.moduleCompletionPercent = null;
      session.moduleFullyComplete = true;
    } else {
      session.moduleFullyComplete = natural || (pct != null && pct >= 100);
      session.moduleCompletionPercent = natural ? 100 : pct;
    }

    const totalAttempts = session.successCount + session.failureCount;
    const successRate =
      totalAttempts > 0 ? Math.round((session.successCount / totalAttempts) * 100) : 0;

    pushLog(session, {
      event: 'session_complete',
      sceneIndex: session.currentSceneIndex,
      meta: {
        successRate,
        finalScore: session.score,
        moduleCompletionPercent: session.moduleCompletionPercent,
        moduleFullyComplete: session.moduleFullyComplete,
        naturalConversationComplete: natural,
      },
    });

    await session.save();
    res.json({
      ok: true,
      session: {
        _id: session._id,
        completed: session.completed,
        score: session.score,
        successRate,
        attempts: session.attempts,
        silenceFailureCount: session.silenceFailureCount,
        moduleCompletionPercent: session.moduleCompletionPercent,
        moduleFullyComplete: session.moduleFullyComplete,
      },
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Complete failed' });
  }
};

exports.getMySessions = async (req, res) => {
  try {
    const { moduleId, limit = 20 } = req.query;
    const filter = { studentId: req.user.id };
    if (moduleId) filter.moduleId = moduleId;
    const rows = await DGSession.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(100, parseInt(limit, 10) || 20))
      .populate('moduleId', 'title level')
      .lean();
    res.json({ sessions: rows });
  } catch (e) {
    res.status(500).json({ message: e.message || 'List failed' });
  }
};

/** Staff: list student sessions for a DG module (analytics + chat timeline from logs). */
exports.listByModuleAdmin = async (req, res) => {
  try {
    const { moduleId } = req.params;
    const mod = await DGModule.findById(moduleId).lean();
    if (!mod || !mod.isActive) {
      return res.status(404).json({ message: 'Module not found' });
    }
    if (req.user.role === 'TEACHER' && mod.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 120));
    const rows = await DGSession.find({ moduleId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('studentId', 'name email regNo level')
      .lean();

    const sessions = rows.map((s) => {
      const stud = s.studentId;
      const student =
        stud && typeof stud === 'object'
          ? {
              _id: stud._id,
              name: stud.name,
              email: stud.email,
              regNo: stud.regNo,
              level: stud.level,
            }
          : null;
      return {
        _id: s._id,
        student,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        completed: !!s.completed,
        completedAt: s.completedAt,
        score: effectiveSessionScore(s),
        attempts: s.attempts,
        successCount: s.successCount,
        failureCount: s.failureCount,
        silenceFailureCount: s.silenceFailureCount,
        timeMinutes: totalSessionMinutes(s),
        chatTurns: extractChatTurns(s.logs),
      };
    });

    const completedN = sessions.filter((x) => x.completed).length;
    const completedSessions = sessions.filter((x) => x.completed);
    const avgScore = completedSessions.length
      ? Math.round(completedSessions.reduce((a, b) => a + (b.score || 0), 0) / completedSessions.length)
      : 0;
    const times = sessions.map((x) => x.timeMinutes).filter((n) => n > 0);
    const avgMinutes = times.length
      ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10
      : 0;

    res.json({
      module: { _id: mod._id, title: mod.title },
      summary: {
        sessionCount: sessions.length,
        completedCount: completedN,
        avgScore,
        avgMinutes,
      },
      sessions,
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Load failed' });
  }
};
