'use strict';

const DGModule = require('../models/DGModule');
const {
  getStudentDgJourneyAccess,
  dgModuleUnlockedForStudentDay,
} = require('../utils/dgStudentJourneyGate');
const {
  startConversation,
  getState,
  setState,
  checkStartTrigger,
  generateOpeningMessage,
  processStudentTurn,
} = require('../services/conversationEngine');
const { translateToTamil, translateText } = require('../services/dgConversationService');
const {
  shouldRequestGermanHint,
  suggestGermanLine,
} = require('../services/dgGermanHintService');

/** @returns {Promise<{ status: number, body: object }|null>} error payload or null if allowed */
async function denyIfStudentDgJourneyLocked(req, mod) {
  if (req.user.role !== 'STUDENT') return null;
  const access = await getStudentDgJourneyAccess(req.user.id);
  if (!access.enabled) {
    return {
      status: 403,
      body: {
        message: 'Journey content is not enabled for your batch yet.',
        code: 'JOURNEY_NOT_ACTIVE',
      },
    };
  }
  if (access.learningEnabled === false) {
    return {
      status: 403,
      body: {
        message: 'DG modules are not available for your batch.',
        code: 'LEARNING_CONTENT_DISABLED',
      },
    };
  }
  if (!dgModuleUnlockedForStudentDay(mod.courseDay, access.courseDay)) {
    return {
      status: 403,
      body: {
        message: 'This module unlocks on a later day of your course.',
        code: 'COURSE_DAY_LOCKED',
        studentCourseDay: access.courseDay,
        moduleCourseDay: mod.courseDay,
      },
    };
  }
  return null;
}

function _lastAiTextFromHistory(history) {
  const ai = (history || []).filter((m) => m.speaker === 'ai').map((m) => m.text);
  return ai.length ? String(ai[ai.length - 1] || '').trim() : '';
}

function _snapshotFromState(state) {
  if (!state) return null;
  const elapsedSeconds = Math.floor((Date.now() - (state.createdAt || Date.now())) / 1000);
  const minSec = Math.max(60, (state.moduleContext.minPracticeMinutes || 10) * 60);
  const maxMin = state.moduleContext.maxPracticeMinutes;
  const maxSec = maxMin != null ? Math.max(minSec, maxMin * 60) : null;
  const unionPct = state.vocabList?.length
    ? Math.round((state.usedVocab.length / state.vocabList.length) * 100)
    : 100;
  const studPct = state.vocabStudent?.length
    ? Math.round((state.usedStudentVocab.length / state.vocabStudent.length) * 100)
    : 100;
  const aiPct = state.vocabAi?.length
    ? Math.round((state.usedAiVocab.length / state.vocabAi.length) * 100)
    : 100;
  const studentDone =
    !state.vocabStudent?.length ||
    state.vocabStudent.every((w) => (state.usedStudentVocab || []).includes(w));
  const aiDone =
    !state.vocabAi?.length ||
    state.vocabAi.every((w) => (state.usedAiVocab || []).includes(w));
  const coreDone = studentDone && aiDone;
  const phase = coreDone ? 'extension' : 'core';
  return {
    turnCount: state.turnCount || 0,
    vocabCoverage: unionPct,
    studentVocabCoverage: studPct,
    aiVocabCoverage: aiPct,
    usedVocab: [...(state.usedVocab || [])],
    phase,
    elapsedSeconds,
    minRequiredSeconds: minSec,
    maxAllowedSeconds: maxSec,
    shouldWrapUp: maxSec != null && maxSec - elapsedSeconds <= 90,
  };
}

// ─── POST /api/dg/conversation/start ─────────────────────────────────────────
/**
 * Initialise conversation state for a session.
 * Returns the student role message and metadata the player uses for the briefing scene.
 */
exports.start = async (req, res) => {
  try {
    const { moduleId, sessionId } = req.body;
    if (!moduleId || !sessionId) {
      return res.status(400).json({ message: 'moduleId and sessionId are required' });
    }

    const mod = await DGModule.findOne({ _id: moduleId, isActive: true });
    if (!mod) return res.status(404).json({ message: 'Module not found' });

    if (req.user.role === 'STUDENT' && !mod.visibleToStudents) {
      return res.status(403).json({ message: 'Module not available' });
    }

    const journeyDeny = await denyIfStudentDgJourneyLocked(req, mod);
    if (journeyDeny) return res.status(journeyDeny.status).json(journeyDeny.body);

    const modData = mod.toObject ? mod.toObject() : mod;
    const state = startConversation(sessionId, modData);

    const scenario = modData.rolePlayScenario || {};
    const roleMessage =
      scenario.studentGuidance?.trim() ||
      (scenario.studentRole
        ? `Your role: ${scenario.studentRole}. The ${scenario.aiRole || 'AI'} will guide you.`
        : 'Get ready for the conversation!');

    res.json({
      ok: true,
      roleMessage,
      maxTurns: state.maxTurns,
      vocabCount: state.vocabList.length,
      language: modData.language || 'German',
      situation: scenario.situation || '',
      minPracticeMinutes: state.moduleContext.minPracticeMinutes || 10,
      maxPracticeMinutes: state.moduleContext.maxPracticeMinutes ?? null,
    });
  } catch (err) {
    console.error('[dgConversation.start]', err);
    res.status(500).json({ message: err.message || 'Start failed' });
  }
};

// ─── POST /api/dg/conversation/respond ───────────────────────────────────────
/**
 * Process one student speech turn.
 *
 * Phases:
 *   waiting_start  → student hasn't triggered the conversation yet
 *   started        → first AI message after trigger
 *   active         → normal conversation exchange
 *   complete       → conversation done (vocab ≥ 80 % or max turns reached)
 */
exports.respond = async (req, res) => {
  try {
    const { moduleId, sessionId, userText, pronunciationScore, clientAction } = req.body;

    if (!moduleId || !sessionId) {
      return res.status(400).json({
        message: 'moduleId and sessionId are required',
      });
    }

    // Lazy-init session (backward compat if /start was not called)
    let state = getState(sessionId);
    if (!state) {
      const mod = await DGModule.findOne({ _id: moduleId, isActive: true });
      if (!mod) return res.status(404).json({ message: 'Module not found' });
      if (req.user.role === 'STUDENT' && !mod.visibleToStudents) {
        return res.status(403).json({ message: 'Module not available' });
      }
      const journeyDeny = await denyIfStudentDgJourneyLocked(req, mod);
      if (journeyDeny) return res.status(journeyDeny.status).json(journeyDeny.body);
      state = startConversation(sessionId, mod.toObject ? mod.toObject() : mod);
    }

    const targetLang = state.moduleContext.language || 'German';
    const snap = () => _snapshotFromState(getState(sessionId));

    // ── UI actions: Continue / Complete (no spoken userText required) ────────
    if (clientAction === 'continue' || clientAction === 'complete') {
      if (!state.conversationStarted) {
        return res.status(400).json({ message: 'Conversation has not started yet' });
      }
      if (clientAction === 'continue') {
        setState(sessionId, { sessionChoiceResolved: true });
        const msg =
          String(targetLang).toLowerCase().includes('german') || targetLang === 'Deutsch'
            ? 'Sehr gut, wir machen weiter!'
            : 'Great, let\'s keep going!';
        const translatedTamil = await translateToTamil(msg, targetLang).catch(() => '');
        const translatedEnglish = await translateText(msg, targetLang, 'English').catch(() => '');
        const s = snap();
        return res.json({
          text: msg,
          translatedTamil,
          translatedEnglish,
          turnCount: s.turnCount,
          conversationStarted: true,
          complete: false,
          vocabCoverage: s.vocabCoverage,
          usedVocab: s.usedVocab,
          phase: 'extension',
          studentVocabCoverage: s.studentVocabCoverage,
          aiVocabCoverage: s.aiVocabCoverage,
          completionReason: null,
          elapsedSeconds: s.elapsedSeconds,
          minRequiredSeconds: s.minRequiredSeconds,
          maxAllowedSeconds: s.maxAllowedSeconds,
          shouldWrapUp: s.shouldWrapUp,
          turnNumber: s.turnCount,
          sceneComplete: false,
          languageHint: false,
        });
      }
      // complete
      const farewell =
        String(targetLang).toLowerCase().includes('german') || targetLang === 'Deutsch'
          ? 'Vielen Dank! Auf Wiedersehen!'
          : 'Thank you! Goodbye!';
      const translatedTamil = await translateToTamil(farewell, targetLang).catch(() => '');
      const translatedEnglish = await translateText(farewell, targetLang, 'English').catch(() => '');
      const s = snap();
      return res.json({
        text: farewell,
        translatedTamil,
        translatedEnglish,
        turnCount: s.turnCount,
        conversationStarted: true,
        complete: true,
        vocabCoverage: s.vocabCoverage,
        usedVocab: s.usedVocab,
        phase: 'complete',
        studentVocabCoverage: s.studentVocabCoverage,
        aiVocabCoverage: s.aiVocabCoverage,
        completionReason: 'client_complete_button',
        elapsedSeconds: s.elapsedSeconds,
        minRequiredSeconds: s.minRequiredSeconds,
        maxAllowedSeconds: s.maxAllowedSeconds,
        shouldWrapUp: true,
        turnNumber: s.turnCount,
        sceneComplete: true,
        languageHint: false,
      });
    }

    if (!clientAction && (!userText || !String(userText).trim())) {
      return res.status(400).json({
        message: 'userText is required',
      });
    }

    // ── Phase: waiting for start trigger ─────────────────────────────────────
    if (!state.conversationStarted) {
      if (!checkStartTrigger(userText)) {
        const promptMsg =
          targetLang === 'German'
            ? 'Sagen Sie "Bereit!" wenn Sie anfangen möchten.'
            : 'Say "Ready!" when you want to begin.';
        const translatedTamil = await translateToTamil(promptMsg, targetLang).catch(() => '');
        const translatedEnglish = await translateText(promptMsg, targetLang, 'English').catch(() => '');
        return res.json({
          text: promptMsg, translatedTamil, translatedEnglish,
          turnCount: 0, conversationStarted: false, complete: false,
          vocabCoverage: 0, phase: 'waiting_start',
          completionReason: null,
          minRequiredSeconds: (state.moduleContext.minPracticeMinutes || 10) * 60,
          maxAllowedSeconds:
            state.moduleContext.maxPracticeMinutes != null
              ? state.moduleContext.maxPracticeMinutes * 60
              : null,
          elapsedSeconds: Math.floor((Date.now() - (state.createdAt || Date.now())) / 1000),
          // legacy
          turnNumber: 0, sceneComplete: false,
        });
      }

      // Mark conversation started and generate opening message
      setState(sessionId, { conversationStarted: true });
      const openingText = await generateOpeningMessage({ ...state, conversationStarted: true });
      const translatedTamil = await translateToTamil(openingText, targetLang).catch(() => '');
      const translatedEnglish = await translateText(openingText, targetLang, 'English').catch(() => '');

      // Record opening in history
      setState(sessionId, {
        conversationStarted: true,
        history: [{ speaker: 'ai', text: openingText }],
      });

      console.log(`[dgConversation] session=${sessionId} STARTED — opening: "${openingText}"`);
      return res.json({
        text: openingText, translatedTamil, translatedEnglish,
        turnCount: 0, conversationStarted: true, complete: false,
        vocabCoverage: 0, phase: 'started',
        completionReason: null,
        minRequiredSeconds: (state.moduleContext.minPracticeMinutes || 10) * 60,
        maxAllowedSeconds:
          state.moduleContext.maxPracticeMinutes != null
            ? state.moduleContext.maxPracticeMinutes * 60
            : null,
        elapsedSeconds: Math.floor((Date.now() - (state.createdAt || Date.now())) / 1000),
        turnNumber: 0, sceneComplete: false,
      });
    }

    // ── German-only: hint instead of advancing when student used English ───────
    if (shouldRequestGermanHint(userText, targetLang)) {
      const lastAi = _lastAiTextFromHistory(state.history);
      const hintDe = await suggestGermanLine(lastAi, userText);
      const hintEn = 'Say this in German to continue.';
      const s = snap();
      const translatedTamil = await translateToTamil(hintDe, targetLang).catch(() => '');
      const translatedEnglish = await translateText(hintDe, targetLang, 'English').catch(() => '');
      return res.json({
        text: '',
        translatedTamil,
        translatedEnglish,
        hintDe,
        hintEn,
        languageHint: true,
        turnCount: s.turnCount,
        conversationStarted: true,
        complete: false,
        vocabCoverage: s.vocabCoverage,
        usedVocab: s.usedVocab,
        phase: s.phase,
        studentVocabCoverage: s.studentVocabCoverage,
        aiVocabCoverage: s.aiVocabCoverage,
        completionReason: null,
        elapsedSeconds: s.elapsedSeconds,
        minRequiredSeconds: s.minRequiredSeconds,
        maxAllowedSeconds: s.maxAllowedSeconds,
        shouldWrapUp: s.shouldWrapUp,
        turnNumber: s.turnCount,
        sceneComplete: false,
      });
    }

    // ── Phase: active conversation ────────────────────────────────────────────
    const result = await processStudentTurn(sessionId, userText, pronunciationScore || 0);

    console.log(
      `[dgConversation] session=${sessionId} turn=${result.turnCount} vocab=${result.vocabCoverage}% phase=${result.phase} complete=${result.complete}`,
    );

    const translatedEnglish =
      await translateText(result.aiText, targetLang, 'English').catch(() => '');
    res.json({
      text:                 result.aiText,
      translatedEnglish,
      translatedTamil:      result.translatedTamil,
      turnCount:            result.turnCount,
      conversationStarted:  true,
      complete:             result.complete,
      vocabCoverage:        result.vocabCoverage,
      usedVocab:            result.usedVocab,
      // Phased vocab coverage (per-bucket)
      phase:                result.complete ? 'complete' : (result.phase || 'active'),
      studentVocabCoverage: result.studentVocabCoverage ?? null,
      aiVocabCoverage:      result.aiVocabCoverage ?? null,
      completionReason:     result.completionReason || null,
      elapsedSeconds:       result.elapsedSeconds,
      minRequiredSeconds:   result.minRequiredSeconds,
      maxAllowedSeconds:    result.maxAllowedSeconds ?? null,
      shouldWrapUp:         !!result.shouldWrapUp,
      languageHint:         false,
      // legacy fields kept for backward compat
      turnNumber:           result.turnCount,
      sceneComplete:        result.complete,
    });
  } catch (err) {
    console.error('[dgConversationController.respond]', err);
    res.status(500).json({ message: err.message || 'Conversation response failed' });
  }
};
