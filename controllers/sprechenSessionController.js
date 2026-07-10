'use strict';

const SprechenExamModule = require('../models/SprechenExamModule');
const SprechenExamSession = require('../models/SprechenExamSession');
const {
  getStudentSprechenJourneyAccess,
  sprechenModuleUnlockedForStudentDay,
} = require('../utils/sprechenStudentJourneyGate');
const { presignS3Url } = require('../config/presign');
const a1Engine = require('../services/sprechenExamEngine');
const a2Engine = require('../services/sprechenA2ExamEngine');

function _getEngine(mod) {
  return mod.examFormat === 'A2' ? a2Engine : a1Engine;
}

// Keep named aliases for backwards compat inside this file
const {
  initSession: _a1InitSession,
  advanceReady: _a1AdvanceReady,
  processTurn: _a1ProcessTurn,
  completeSession: _a1CompleteSession,
} = a1Engine;
const { synthesizeSpeechStream } = require('../services/dgTtsService');

// ─── POST /session/start ──────────────────────────────────────────────────────

exports.start = async (req, res) => {
  try {
    const { moduleId } = req.body;
    if (!moduleId) return res.status(400).json({ message: 'moduleId je obavezan' });

    const mod = await SprechenExamModule.findById(moduleId).lean();
    if (!mod || !mod.isActive) return res.status(404).json({ message: 'Modul nije pronađen' });

    if (req.user.role === 'STUDENT') {
      if (!mod.visibleToStudents) {
        return res.status(403).json({ message: 'Modul nije dostupan' });
      }
      const access = await getStudentSprechenJourneyAccess(req.user.id);
      if (!access.enabled) {
        return res.status(403).json({ message: 'Putovanje nije aktivno', code: 'JOURNEY_NOT_ACTIVE' });
      }
      if (!sprechenModuleUnlockedForStudentDay(mod.courseDay, access.courseDay)) {
        return res.status(403).json({
          message: 'Modul se otključava kasnijeg dana.',
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
    const initResult = await _getEngine(mod).initSession(session, mod);

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
    res.status(500).json({ message: e.message || 'Pokretanje nije uspelo' });
  }
};

// ─── POST /session/:id/advance ────────────────────────────────────────────────
// Used for non-speech student actions: action='ready'

exports.advance = async (req, res) => {
  try {
    const session = await _loadSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ message: 'Sesija nije pronađena' });
    if (session.completed) return res.status(400).json({ message: 'Sesija je već završena' });

    const mod = await SprechenExamModule.findById(session.moduleId).lean();
    if (!mod) return res.status(404).json({ message: 'Modul nije pronađen' });

    const { action } = req.body;
    let result;

    if (action === 'ready') {
      result = await _getEngine(mod).advanceReady(session, mod);
    } else {
      return res.status(400).json({ message: `Nepoznata akcija: ${action}` });
    }

    // Presign card image URL so it's fresh for the browser
    if (result.card && result.card.imageUrl) {
      const signed = await presignS3Url(result.card.imageUrl);
      if (signed) result.card.imageUrl = signed;
    }

    res.json(result);
  } catch (e) {
    console.error('[sprechenSession.advance]', e);
    res.status(500).json({ message: e.message || 'Napredovanje nije uspelo' });
  }
};

// ─── POST /session/:id/turn ───────────────────────────────────────────────────
// Process a student speech turn

exports.turn = async (req, res) => {
  try {
    const session = await _loadSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ message: 'Sesija nije pronađena' });
    if (session.completed) return res.status(400).json({ message: 'Sesija je već završena' });

    const { transcript, durationMs, action } = req.body;
    if (!transcript && transcript !== '') {
      return res.status(400).json({ message: 'transkript je obavezan' });
    }

    const mod = await SprechenExamModule.findById(session.moduleId).lean();
    if (!mod) return res.status(404).json({ message: 'Modul nije pronađen' });

    const engine = _getEngine(mod);
    const result = await engine.processTurn(session, mod, transcript, durationMs, action);

    // If exam is done, compile scores
    if (result.done && !session.completed) {
      const scores = await engine.completeSession(session, mod);
      result.scores = scores;
      result.finalScores = scores;
    }

    // Presign card image URL so it's fresh for the browser
    if (result.card && result.card.imageUrl) {
      const signed = await presignS3Url(result.card.imageUrl);
      if (signed) result.card.imageUrl = signed;
    }

    res.json(result);
  } catch (e) {
    console.error('[sprechenSession.turn]', e);
    res.status(500).json({ message: e.message || 'Tura nije uspela' });
  }
};

// ─── POST /session/:id/complete ───────────────────────────────────────────────

exports.complete = async (req, res) => {
  try {
    const session = await _loadSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ message: 'Sesija nije pronađena' });

    const mod = await SprechenExamModule.findById(session.moduleId).lean();
    if (!mod) return res.status(404).json({ message: 'Modul nije pronađen' });

    const scores = await _getEngine(mod).completeSession(session, mod);
    res.json({ scores, completed: true });
  } catch (e) {
    console.error('[sprechenSession.complete]', e);
    res.status(500).json({ message: e.message || 'Završavanje nije uspelo' });
  }
};

// ─── GET /session/:id/state ───────────────────────────────────────────────────

exports.getState = async (req, res) => {
  try {
    const session = await _loadSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ message: 'Sesija nije pronađena' });

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
      scores: completed ? (session.finalScores || scores) : null,
      finalScores: completed ? (session.finalScores || scores) : null,
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
    if (!session) return res.status(404).json({ message: 'Sesija nije pronađena' });

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
        scores: session.finalScores || session.scores,
        finalScores: session.finalScores,
        examinerScores: session.examinerScores,
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
    if (!session) return res.status(404).json({ message: 'Sesija nije pronađena' });

    const turn = session.turns.id(req.params.turnId);
    if (!turn) return res.status(404).json({ message: 'Tura nije pronađena' });
    if (turn.role !== 'student') return res.status(400).json({ message: 'Samo ture učenika mogu biti prepisane' });

    const { points, note } = req.body;
    if (typeof points !== 'number') return res.status(400).json({ message: 'points (broj) je obavezan' });

    turn.tutorOverride = { points, note: note || '', by: req.user.id, at: new Date() };

    // Recompile scores
    const mod = await SprechenExamModule.findById(session.moduleId).select('rubric passThreshold examFormat').lean();
    const { compileTeilScores } = _getEngine(mod || {});
    const result = compileTeilScores(session.turns, mod?.rubric, mod?.passThreshold);
    const scores = result.finalScores || result;
    session.scores = scores;
    session.finalScores = scores;

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
    if (!text) return res.status(400).json({ message: 'tekst je obavezan' });

    const stream = await synthesizeSpeechStream(String(text), voice || 'alloy');
    if (!stream) return res.status(503).json({ message: 'TTS nije dostupan' });

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
    if (!res.headersSent) res.status(500).json({ message: e.message || 'TTS nije uspeo' });
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
