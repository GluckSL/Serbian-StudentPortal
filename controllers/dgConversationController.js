'use strict';

const DGModule = require('../models/DGModule');
const {
  startConversation,
  getState,
  setState,
  checkStartTrigger,
  generateOpeningMessage,
  processStudentTurn,
} = require('../services/conversationEngine');
const { translateToTamil, translateText } = require('../services/dgConversationService');

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
    const { moduleId, sessionId, userText, pronunciationScore } = req.body;

    if (!moduleId || !sessionId || !userText) {
      return res.status(400).json({
        message: 'moduleId, sessionId, and userText are required',
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
      state = startConversation(sessionId, mod.toObject ? mod.toObject() : mod);
    }

    const targetLang = state.moduleContext.language || 'German';

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

    // ── Phase: active conversation ────────────────────────────────────────────
    const result = await processStudentTurn(sessionId, userText, pronunciationScore || 0);

    console.log(
      `[dgConversation] session=${sessionId} turn=${result.turnCount} vocab=${result.vocabCoverage}% complete=${result.complete}`,
    );

    const translatedEnglish =
      await translateText(result.aiText, targetLang, 'English').catch(() => '');
    res.json({
      text:               result.aiText,
      translatedEnglish,
      translatedTamil:    result.translatedTamil,
      turnCount:          result.turnCount,
      conversationStarted: true,
      complete:           result.complete,
      vocabCoverage:      result.vocabCoverage,
      usedVocab:          result.usedVocab,
      phase:              result.complete ? 'complete' : 'active',
      completionReason:   result.completionReason || null,
      elapsedSeconds:     result.elapsedSeconds,
      minRequiredSeconds: result.minRequiredSeconds,
      maxAllowedSeconds:  result.maxAllowedSeconds ?? null,
      shouldWrapUp:       !!result.shouldWrapUp,
      // legacy fields kept for backward compat
      turnNumber:         result.turnCount,
      sceneComplete:      result.complete,
    });
  } catch (err) {
    console.error('[dgConversationController.respond]', err);
    res.status(500).json({ message: err.message || 'Conversation response failed' });
  }
};
