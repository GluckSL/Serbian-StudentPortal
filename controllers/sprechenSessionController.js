'use strict';

const SprechenExamModule = require('../models/SprechenExamModule');
const SprechenExamSession = require('../models/SprechenExamSession');
const {
  getStudentSprechenJourneyAccess,
  sprechenModuleUnlockedForStudentDay,
} = require('../utils/sprechenStudentJourneyGate');
const { presignS3Url } = require('../config/presign');
const {
  initSession,
  advanceReady,
  processTurn,
  completeSession,
} = require('../services/sprechenExamEngine');
const { synthesizeSpeechStream } = require('../services/dgTtsService');

// ─── POST /session/start ──────────────────────────────────────────────────────

exports.start = async (req, res) => {
  try {
    const { moduleId } = req.body;
    if (!moduleId) return res.status(400).json({ message: 'moduleId required' });

    const mod = await SprechenExamModule.findById(moduleId).lean();
    if (!mod || !mod.isActive) return res.status(404).json({ message: 'Module not found' });

    if (req.user.role === 'STUDENT') {
      if (!mod.visibleToStudents) {
        return res.status(403).json({ message: 'Module not available' });
      }
      const access = await getStudentSprechenJourneyAccess(req.user.id);
      if (!access.enabled) {
        return res.status(403).json({ message: 'Journey not active', code: 'JOURNEY_NOT_ACTIVE' });
      }
      if (!sprechenModuleUnlockedForStudentDay(mod.courseDay, access.courseDay)) {
        return res.status(403).json({
          message: 'Module unlocks on a later day.',
          code: 'COURSE_DAY_LOCKED',
        });
      }
    }

    const session = new SprechenExamSession({
      studentId: req.user.id,
      moduleId,
      state: { phase: 'welcome', awaitingStudent: false, teilNumber: 0, startedAt: new Date() },
    });

    // Initialise — saves session with welcome bot message
    const initResult = await initSession(session, mod);

    // Presign the card image URL so it's fresh for this response
    if (initResult.card && initResult.card.imageUrl) {
      const signed = await presignS3Url(initResult.card.imageUrl);
      if (signed) initResult.card.imageUrl = signed;
    }

    res.status(201).json({
      sessionId: session._id,
      ...initResult,
    });
  } catch (e) {
    console.error('[sprechenSession.start]', e);
    res.status(500).json({ message: e.message || 'Start failed' });
  }
};

// ─── POST /session/:id/advance ────────────────────────────────────────────────
// Used for non-speech student actions: action='ready'

exports.advance = async (req, res) => {
  try {
    const session = await _loadSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (session.completed) return res.status(400).json({ message: 'Session already complete' });

    const mod = await SprechenExamModule.findById(session.moduleId).lean();
    if (!mod) return res.status(404).json({ message: 'Module not found' });

    const { action } = req.body;
    let result;

    if (action === 'ready') {
      result = await advanceReady(session, mod);
    } else {
      return res.status(400).json({ message: `Unknown action: ${action}` });
    }

    // Presign card image URL so it's fresh for the browser
    if (result.card && result.card.imageUrl) {
      const signed = await presignS3Url(result.card.imageUrl);
      if (signed) result.card.imageUrl = signed;
    }

    res.json(result);
  } catch (e) {
    console.error('[sprechenSession.advance]', e);
    res.status(500).json({ message: e.message || 'Advance failed' });
  }
};

// ─── POST /session/:id/turn ───────────────────────────────────────────────────
// Process a student speech turn

exports.turn = async (req, res) => {
  try {
    const session = await _loadSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (session.completed) return res.status(400).json({ message: 'Session already complete' });

    const { transcript, durationMs } = req.body;
    if (!transcript && transcript !== '') {
      return res.status(400).json({ message: 'transcript required' });
    }

    const mod = await SprechenExamModule.findById(session.moduleId).lean();
    if (!mod) return res.status(404).json({ message: 'Module not found' });

    const result = await processTurn(session, mod, transcript, durationMs);

    // If exam is done, compile scores
    if (result.done && !session.completed) {
      const scores = await completeSession(session, mod);
      result.scores = scores;
    }

    // Presign card image URL so it's fresh for the browser
    if (result.card && result.card.imageUrl) {
      const signed = await presignS3Url(result.card.imageUrl);
      if (signed) result.card.imageUrl = signed;
    }

    res.json(result);
  } catch (e) {
    console.error('[sprechenSession.turn]', e);
    res.status(500).json({ message: e.message || 'Turn failed' });
  }
};

// ─── POST /session/:id/complete ───────────────────────────────────────────────

exports.complete = async (req, res) => {
  try {
    const session = await _loadSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const mod = await SprechenExamModule.findById(session.moduleId).lean();
    if (!mod) return res.status(404).json({ message: 'Module not found' });

    const scores = await completeSession(session, mod);
    res.json({ scores, completed: true });
  } catch (e) {
    console.error('[sprechenSession.complete]', e);
    res.status(500).json({ message: e.message || 'Complete failed' });
  }
};

// ─── GET /session/:id/state ───────────────────────────────────────────────────

exports.getState = async (req, res) => {
  try {
    const session = await _loadSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const { state, scores, completed } = session;
    let cardImageUrl = state.cardImageUrl || '';
    if (cardImageUrl) {
      const signed = await presignS3Url(cardImageUrl);
      if (signed) cardImageUrl = signed;
    }
    const card = state.cardContent
      ? { type: state.cardType, content: state.cardContent, imageUrl: cardImageUrl }
      : null;

    res.json({
      phase: state.phase,
      awaitingStudent: state.awaitingStudent,
      teilNumber: state.teilNumber,
      card,
      completed,
      scores: completed ? scores : null,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─── GET /session/:id/replay ──────────────────────────────────────────────────
// Staff-only: full turn timeline

exports.getReplay = async (req, res) => {
  try {
    const session = await SprechenExamSession.findById(req.params.id)
      .populate('studentId', 'name email regNo batch')
      .lean();
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const mod = await SprechenExamModule.findById(session.moduleId)
      .select('title passThreshold rubric')
      .lean();

    res.json({
      session: {
        _id: session._id,
        student: session.studentId,
        createdAt: session.createdAt,
        completed: session.completed,
        completedAt: session.completedAt,
        scores: session.scores,
        moduleTitle: mod?.title,
        passThreshold: mod?.passThreshold,
      },
      turns: session.turns,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─── PATCH /session/:id/turns/:turnId/score ───────────────────────────────────
// Tutor score override

exports.overrideTurnScore = async (req, res) => {
  try {
    const session = await SprechenExamSession.findById(req.params.id).lean(false);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const turn = session.turns.id(req.params.turnId);
    if (!turn) return res.status(404).json({ message: 'Turn not found' });
    if (turn.role !== 'student') return res.status(400).json({ message: 'Only student turns can be overridden' });

    const { points, note } = req.body;
    if (typeof points !== 'number') return res.status(400).json({ message: 'points (number) required' });

    turn.tutorOverride = { points, note: note || '', by: req.user.id, at: new Date() };

    // Recompile scores
    const mod = await SprechenExamModule.findById(session.moduleId).select('rubric passThreshold').lean();
    const { compileTeilScores } = require('../services/sprechenExamEngine');
    const scores = compileTeilScores(session.turns, mod?.rubric, mod?.passThreshold);
    session.scores = scores;

    await session.save();
    res.json({ turn: turn.toObject(), scores });
  } catch (e) {
    console.error('[sprechenSession.overrideTurnScore]', e);
    res.status(500).json({ message: e.message });
  }
};

// ─── TTS proxy (reuses DG TTS service + voice) ───────────────────────────────

exports.tts = async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ message: 'text required' });

    const stream = await synthesizeSpeechStream(String(text), voice || 'alloy');
    if (!stream) return res.status(503).json({ message: 'TTS unavailable' });

    res.setHeader('Content-Type', 'audio/mpeg');
    if (stream.pipe) {
      stream.pipe(res);
    } else {
      const reader = stream.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(Buffer.from(value));
        pump();
      };
      pump();
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ message: e.message || 'TTS failed' });
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _loadSession(id, user) {
  const session = await SprechenExamSession.findById(id);
  if (!session) return null;
  // Students can only access their own sessions; staff can see all
  if (user.role === 'STUDENT' && String(session.studentId) !== String(user.id)) return null;
  return session;
}
