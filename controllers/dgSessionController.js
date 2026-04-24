const DGSession = require('../models/DGSession');
const DGModule = require('../models/DGModule');

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
    const { sessionId, finalScore } = req.body;
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

    const totalAttempts = session.successCount + session.failureCount;
    const successRate =
      totalAttempts > 0 ? Math.round((session.successCount / totalAttempts) * 100) : 0;

    pushLog(session, {
      event: 'session_complete',
      sceneIndex: session.currentSceneIndex,
      meta: { successRate, finalScore: session.score },
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
