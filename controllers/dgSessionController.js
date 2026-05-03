const DGSession = require('../models/DGSession');
const DGModule = require('../models/DGModule');

function extractChatTurns(logs) {
  const out = [];
  for (const log of logs || []) {
    if (log.event === 'conv_student' && String(log.transcript || '').trim()) {
      out.push({
        at: log.at,
        speaker: 'student',
        text: String(log.transcript).trim(),
        score: log.score != null ? log.score : undefined,
      });
    } else if (log.event === 'conv_ai' && log.meta && String(log.meta.text || '').trim()) {
      out.push({
        at: log.at,
        speaker: 'ai',
        text: String(log.meta.text).trim(),
        kind: log.meta.kind || undefined,
      });
    } else if (log.event === 'conv_hint' && log.meta) {
      const hint = String(log.meta.text || '').trim();
      if (hint) {
        out.push({
          at: log.at,
          speaker: 'hint',
          text: hint,
          instructionEn: String(log.meta.instructionEn || log.meta.instruction || '').trim(),
        });
      }
    } else if (log.event === 'practice_attempt' && String(log.transcript || '').trim()) {
      out.push({
        at: log.at,
        speaker: 'student',
        text: String(log.transcript).trim(),
        score: log.score != null ? log.score : undefined,
        kind: 'practice',
      });
    }
  }
  out.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  return out;
}

function totalSessionMinutes(session) {
  const arr = session.timePerSceneMs || [];
  const sumMs = arr.reduce((acc, n) => acc + (Number(n) || 0), 0);
  if (sumMs > 0) return Math.round((sumMs / 60000) * 10) / 10;
  let fromLogs = 0;
  for (const log of session.logs || []) {
    if (log.event === 'scene_complete' && typeof log.durationMs === 'number') {
      fromLogs += log.durationMs;
    }
  }
  if (fromLogs > 0) return Math.round((fromLogs / 60000) * 10) / 10;
  const c = session.createdAt ? new Date(session.createdAt).getTime() : 0;
  const u = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
  if (u > c) return Math.max(0, Math.round(((u - c) / 60000) * 10) / 10);
  return 0;
}

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
        score: s.score,
        attempts: s.attempts,
        successCount: s.successCount,
        failureCount: s.failureCount,
        silenceFailureCount: s.silenceFailureCount,
        timeMinutes: totalSessionMinutes(s),
        chatTurns: extractChatTurns(s.logs),
      };
    });

    const completedN = sessions.filter((x) => x.completed).length;
    const scores = sessions
      .filter((x) => x.completed && typeof x.score === 'number')
      .map((x) => x.score);
    const avgScore = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
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
