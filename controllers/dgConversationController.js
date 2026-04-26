'use strict';

const DGModule = require('../models/DGModule');
const {
  buildDGPrompt,
  buildAllowedSet,
  checkVocabulary,
  getAIResponse,
  translateToTamil,
} = require('../services/dgConversationService');

/** Maximum back-and-forth turns allowed per scene before auto-advancing. */
const MAX_TURNS = 3;

/**
 * Safe fallback lines keyed by target language.
 * Used when the AI response contains too many vocabulary violations even after retry.
 */
const FALLBACK_BY_LANG = {
  German: 'Bitte versuchen Sie es nochmal.',
  English: 'Could you try again please?',
  Spanish: '¿Puede intentarlo de nuevo?',
  French: 'Pouvez-vous réessayer?',
  Italian: 'Potrebbe riprovare?',
  default: 'Please try again.',
};

/**
 * POST /api/dg/conversation/respond
 *
 * Body:
 *   moduleId       - string (required)
 *   sceneIndex     - number (required)
 *   userText       - string (required) — student's spoken transcript
 *   sessionId      - string
 *   pronunciationScore - number
 *   turnNumber     - number (current turn before this response; 0-based)
 *   history        - Array<{ role: 'user'|'ai', text: string }> (last N turns)
 *
 * Response:
 *   text           - AI response in target language (vocabulary-enforced)
 *   translatedTamil - Tamil translation of AI response
 *   turnNumber     - updated turn count (1-based after this response)
 *   sceneComplete  - boolean — true when turnNumber >= MAX_TURNS
 */
exports.respond = async (req, res) => {
  try {
    const {
      moduleId,
      sceneIndex,
      userText,
      pronunciationScore,
      remainingSeconds,
      turnNumber: clientTurnNumber,
      history,
    } = req.body;

    if (!moduleId || sceneIndex == null || !userText) {
      return res.status(400).json({
        message: 'moduleId, sceneIndex, and userText are required',
      });
    }

    // ── Load module ──────────────────────────────────────────
    const mod = await DGModule.findOne({ _id: moduleId, isActive: true });
    if (!mod) return res.status(404).json({ message: 'Module not found' });

    // Student role-check: only visible modules for students.
    if (req.user.role === 'STUDENT' && !mod.visibleToStudents) {
      return res.status(403).json({ message: 'Module not available' });
    }

    // ── Resolve scene ─────────────────────────────────────────
    const scenes = mod.getSortedScenes();
    const scene = scenes[Number(sceneIndex)];
    if (!scene) {
      return res.status(400).json({ message: 'Invalid sceneIndex' });
    }

    const targetLang = mod.language || 'German';

    // ── Build prompt + allowed set ────────────────────────────
    const systemPrompt = buildDGPrompt(mod, scene, { remainingSeconds });
    const allowedSet = buildAllowedSet(mod);

    // ── Call AI (with one vocab-violation retry) ───────────────
    let aiText = '';
    let attempts = 0;

    while (attempts < 2) {
      attempts++;
      try {
        const prompt =
          attempts === 1
            ? systemPrompt
            : systemPrompt +
              '\n\nCRITICAL REMINDER: Use ONLY the allowed vocabulary. Keep response under 10 words. No other words.';

        aiText = await getAIResponse(prompt, userText, history || []);

        const check = checkVocabulary(aiText, allowedSet);
        if (check.ok) break;

        // First attempt failed vocab check — loop for retry
        if (attempts < 2) {
          console.warn(
            `[dgConversation] Vocab violations (${check.violationCount}): ${check.violations.join(', ')} — retrying`,
          );
        }
      } catch (err) {
        console.error(`[dgConversation] AI call attempt ${attempts} failed:`, err.message);
        break;
      }
    }

    // Final safety: if still too many violations, use fallback
    if (!aiText) {
      aiText = FALLBACK_BY_LANG[targetLang] || FALLBACK_BY_LANG.default;
    } else {
      const finalCheck = checkVocabulary(aiText, allowedSet);
      if (finalCheck.violationCount > 4) {
        console.warn(`[dgConversation] Using fallback — too many violations after retry`);
        aiText = FALLBACK_BY_LANG[targetLang] || FALLBACK_BY_LANG.default;
      }
    }

    // ── Translate to Tamil ────────────────────────────────────
    const translatedTamil = await translateToTamil(aiText, targetLang);

    // ── Turn accounting ───────────────────────────────────────
    const prevTurn = typeof clientTurnNumber === 'number' ? clientTurnNumber : 0;
    const newTurnNumber = prevTurn + 1;
    const sceneComplete = newTurnNumber >= MAX_TURNS;

    console.log(
      `[dgConversation] module=${moduleId} scene=${sceneIndex} turn=${newTurnNumber}/${MAX_TURNS} score=${pronunciationScore}`,
    );

    res.json({
      text: aiText,
      translatedTamil,
      turnNumber: newTurnNumber,
      sceneComplete,
    });
  } catch (err) {
    console.error('[dgConversationController]', err);
    res.status(500).json({ message: err.message || 'Conversation response failed' });
  }
};
