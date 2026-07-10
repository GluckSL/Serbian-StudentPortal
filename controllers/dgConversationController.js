'use strict';

const DGModule = require('../models/DGModule');
const {
  getStudentDgJourneyAccess,
  dgModuleUnlockedForAccess,
  dgWeekLockMessage,
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
        message: 'Sadržaj putovanja još nije omogućen za vašu grupu.',
        code: 'JOURNEY_NOT_ACTIVE',
      },
    };
  }
  if (access.dgBotEnabled === false) {
    return {
      status: 403,
      body: {
        message: 'DG moduli nisu dostupni za vašu grupu.',
        code: 'LEARNING_CONTENT_DISABLED',
      },
    };
  }
  if (!dgModuleUnlockedForAccess(access, mod.courseDay)) {
    const weekLock = dgWeekLockMessage(access, mod.courseDay);
    if (weekLock) {
      return { status: 403, body: weekLock };
    }
    return {
      status: 403,
      body: {
        message: 'Ovaj modul se otključava kasnijeg dana vašeg kursa.',
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
      return res.status(400).json({ message: 'moduleId i sessionId su obavezni' });
    }

    const mod = await DGModule.findOne({ _id: moduleId, isActive: true });
    if (!mod) return res.status(404).json({ message: 'Modul nije pronađen' });

    if (req.user.role === 'STUDENT' && !mod.visibleToStudents) {
      return res.status(403).json({ message: 'Modul nije dostupan' });
    }

    const journeyDeny = await denyIfStudentDgJourneyLocked(req, mod);
    if (journeyDeny) return res.status(journeyDeny.status).json(journeyDeny.body);

    const modData = mod.toObject ? mod.toObject() : mod;
    const state = startConversation(sessionId, modData);

    const scenario = modData.rolePlayScenario || {};
    const bm = modData.beginnerMode || {};
    const hasBmQuestions = !!(bm.enabled && Array.isArray(bm.questions) && bm.questions.length);
    const hasSceneGradedSteps = (modData.scenes || []).some(
      (s) =>
        ['practice', 'teach'].includes(String(s.type || '').toLowerCase()) &&
        String(s.expectedAnswer || '').trim(),
    );
    const isBeginnerMode = hasBmQuestions || hasSceneGradedSteps;

    // For beginner mode: use the sessionIntro if set, otherwise empty (frontend fills in "I am Ooly")
    // For normal mode: use studentGuidance or role description
    const roleMessage = isBeginnerMode
      ? (bm.sessionIntro || '').trim()
      : (
        scenario.studentGuidance?.trim() ||
        (scenario.studentRole
          ? `Your role: ${scenario.studentRole}. The ${scenario.aiRole || 'AI'} will guide you.`
          : 'Get ready for the conversation!')
      );

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
    res.status(500).json({ message: err.message || 'Pokretanje nije uspelo' });
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
        message: 'moduleId i sessionId su obavezni',
      });
    }

    // Lazy-init session (backward compat if /start was not called)
    let state = getState(sessionId);
    if (!state) {
      const mod = await DGModule.findOne({ _id: moduleId, isActive: true });
      if (!mod) return res.status(404).json({ message: 'Modul nije pronađen' });
      if (req.user.role === 'STUDENT' && !mod.visibleToStudents) {
        return res.status(403).json({ message: 'Modul nije dostupan' });
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
        return res.status(400).json({ message: 'Razgovor još nije počeo' });
      }
      if (clientAction === 'continue') {
        setState(sessionId, { sessionChoiceResolved: true });
        const msg =
          String(targetLang).toLowerCase().includes('german') || targetLang === 'Deutsch'
            ? 'Sehr gut, wir machen weiter!'
            : 'Great, let\'s keep going!';
        const [translatedTamil, translatedEnglish] = await Promise.all([
          translateToTamil(msg, targetLang).catch(() => ''),
          translateText(msg, targetLang, 'English').catch(() => ''),
        ]);
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
      const [translatedTamil, translatedEnglish] = await Promise.all([
        translateToTamil(farewell, targetLang).catch(() => ''),
        translateText(farewell, targetLang, 'English').catch(() => ''),
      ]);
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
        message: 'userText je obavezan',
      });
    }

    // ── Phase: waiting for start trigger ─────────────────────────────────────
    if (!state.conversationStarted) {
      if (!checkStartTrigger(userText)) {
        const promptMsg =
          targetLang === 'German'
            ? 'Sagen Sie "Bereit!" wenn Sie anfangen möchten.'
            : 'Say "Ready!" when you want to begin.';
        const [translatedTamil, translatedEnglish] = await Promise.all([
          translateToTamil(promptMsg, targetLang).catch(() => ''),
          translateText(promptMsg, targetLang, 'English').catch(() => ''),
        ]);
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
      const [translatedTamil, translatedEnglish] = await Promise.all([
        translateToTamil(openingText, targetLang).catch(() => ''),
        translateText(openingText, targetLang, 'English').catch(() => ''),
      ]);

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
    const lastAiForHint = _lastAiTextFromHistory(state.history);
    if (shouldRequestGermanHint(userText, targetLang, { lastAiText: lastAiForHint })) {
      let hintDe;
      if (state.isBeginnerMode) {
        // Beginner mode: use the expected answer as the hint if available
        const currentQ = state.beginnerQuestions[state.beginnerQuestionIndex];
        if (currentQ?.targetAnswer?.trim()) {
          hintDe = currentQ.targetAnswer.trim();
        } else {
          const lastAi = _lastAiTextFromHistory(state.history);
          hintDe = await suggestGermanLine(lastAi, userText);
        }
        // Mark that student was shown a hint; next turn they should repeat
        setState(sessionId, { beginnerAwaitingRepeat: true });
      } else {
        const lastAi = _lastAiTextFromHistory(state.history);
        hintDe = await suggestGermanLine(lastAi, userText);
      }

      const hintEn = 'Say this to continue.';
      const s = snap();
      const [translatedTamil, translatedEnglish] = await Promise.all([
        translateToTamil(hintDe, targetLang).catch(() => ''),
        translateText(hintDe, targetLang, 'English').catch(() => ''),
      ]);
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
        beginnerQuestionIndex: state.isBeginnerMode ? state.beginnerQuestionIndex : undefined,
      });
    }

    // ── Phase: active conversation ────────────────────────────────────────────
    const result = await processStudentTurn(sessionId, userText, pronunciationScore || 0);

    console.log(
      `[dgConversation] session=${sessionId} turn=${result.turnCount} vocab=${result.vocabCoverage}% phase=${result.phase} complete=${result.complete}`,
    );

    const [translatedTamil, translatedEnglish] = await Promise.all([
      translateToTamil(result.aiText, targetLang).catch(() => ''),
      translateText(result.aiText, targetLang, 'English').catch(() => ''),
    ]);
    res.json({
      text:                   result.aiText,
      translatedEnglish,
      translatedTamil,
      turnCount:              result.turnCount,
      conversationStarted:    true,
      complete:               result.complete,
      vocabCoverage:          result.vocabCoverage,
      usedVocab:              result.usedVocab,
      // Phased vocab coverage (per-bucket)
      phase:                  result.complete ? 'complete' : (result.phase || 'active'),
      studentVocabCoverage:   result.studentVocabCoverage ?? null,
      aiVocabCoverage:        result.aiVocabCoverage ?? null,
      completionReason:       result.completionReason || null,
      elapsedSeconds:         result.elapsedSeconds,
      minRequiredSeconds:     result.minRequiredSeconds,
      maxAllowedSeconds:      result.maxAllowedSeconds ?? null,
      shouldWrapUp:           !!result.shouldWrapUp,
      languageHint:           false,
      // Beginner mode: current question index after this turn
      beginnerQuestionIndex:  result.beginnerQuestionIndex ?? undefined,
      questionSkipped:        result.questionSkipped || undefined,
      skipMessage:            result.skipMessage || undefined,
      answerScore:            result.answerScore ?? undefined,
      answerPassed:           result.answerPassed ?? undefined,
      gradingThreshold:       result.gradingThreshold ?? undefined,
      // legacy fields kept for backward compat
      turnNumber:             result.turnCount,
      sceneComplete:          result.complete,
    });
  } catch (err) {
    console.error('[dgConversationController.respond]', err);
    res.status(500).json({ message: err.message || 'Odgovor na razgovor nije uspeo' });
  }
};
