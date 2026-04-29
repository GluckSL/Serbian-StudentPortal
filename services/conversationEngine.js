'use strict';

const OpenAI = require('openai');
const { translateToTamil } = require('./dgConversationService');

// ─── In-memory session store (keyed by sessionId, TTL 2 h) ───────────────────
const _sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

// ─── Start-trigger keywords ───────────────────────────────────────────────────
const START_KEYWORDS = [
  'start', 'ready', 'begin', 'bereit', 'los', 'anfangen',
  "let's start", 'lets start', 'ja', 'yes', 'okay', 'ok',
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise (or re-initialise) the conversation state for a session.
 * Returns the fresh state object.
 */
function startConversation(sessionId, moduleData) {
  const vocab = _extractVocabWords(moduleData);
  const scenario = moduleData.rolePlayScenario || {};
  const timing = _resolvePracticeWindow(moduleData);

  const state = {
    sessionId,
    moduleId: String(moduleData._id || ''),
    conversationStarted: false,
    turnCount: 0,
    // Make sure there are enough turns to cover all vocab + a few extras
    maxTurns: Math.max(8, vocab.length + 3),
    vocabList: vocab,
    usedVocab: [],
    history: [],               // [{ speaker: 'ai'|'student', text, score? }]
    moduleContext: {
      situation:        scenario.situation      || '',
      setting:          scenario.setting        || '',
      aiRole:           scenario.aiRole         || 'language tutor',
      studentRole:      scenario.studentRole    || 'student',
      objective:        scenario.objective      || '',
      aiPersonality:    scenario.aiPersonality  || 'Friendly, patient, encouraging',
      studentGuidance:  scenario.studentGuidance || '',
      aiOpeningLines:   scenario.aiOpeningLines  || [],
      language:         moduleData.language      || 'German',
      nativeLanguage:   moduleData.nativeLanguage || 'English',
      minimumCompletionTime: moduleData.minimumCompletionTime || 10,
      minPracticeMinutes: timing.minPracticeMinutes,
      maxPracticeMinutes: timing.maxPracticeMinutes,
      allowedVocabulary:  moduleData.allowedVocabulary  || [],
      aiTutorVocabulary:  moduleData.aiTutorVocabulary  || [],
      allowedGrammar:     moduleData.allowedGrammar      || [],
      level: moduleData.level || 'A1',
    },
    wrapUpStarted: false,
    completionReason: null,
    createdAt: Date.now(),
  };

  _sessions.set(sessionId, state);
  _cleanupOldSessions();
  return state;
}

/** Get existing state (returns null if not found). */
function getState(sessionId) {
  return _sessions.get(sessionId) || null;
}

/** Merge updates into existing state. */
function setState(sessionId, updates) {
  const existing = _sessions.get(sessionId);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  _sessions.set(sessionId, updated);
  return updated;
}

/**
 * Returns true when the transcript contains a recognised start trigger.
 */
function checkStartTrigger(transcript) {
  if (!transcript) return false;
  const lower = transcript.toLowerCase().trim();
  return START_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Compute completion status with time-first policy.
 */
function isConversationComplete(state) {
  const elapsedSec = Math.floor((Date.now() - (state.createdAt || Date.now())) / 1000);
  const minSeconds = Math.max(60, (state.moduleContext.minPracticeMinutes || 10) * 60);
  const maxMinutes = state.moduleContext.maxPracticeMinutes;
  const maxSeconds = maxMinutes != null ? Math.max(minSeconds, maxMinutes * 60) : null;

  const vocabCoverage = state.vocabList.length > 0
    ? state.usedVocab.length / state.vocabList.length
    : 1;
  const vocabGoalMet = vocabCoverage >= 0.8;
  const minTimeMet = elapsedSec >= minSeconds;
  const maxTimeReached = maxSeconds != null && elapsedSec >= maxSeconds;

  if (!minTimeMet && !maxTimeReached) {
    return {
      complete: false,
      reason: null,
      elapsedSec,
      minSeconds,
      maxSeconds,
      vocabCoverage,
      vocabGoalMet,
      shouldWrapUp: false,
    };
  }

  if (maxTimeReached) {
    return {
      complete: true,
      reason: 'max_time_reached',
      elapsedSec,
      minSeconds,
      maxSeconds,
      vocabCoverage,
      vocabGoalMet,
      shouldWrapUp: true,
    };
  }

  if (vocabGoalMet) {
    return {
      complete: true,
      reason: 'vocab_goal',
      elapsedSec,
      minSeconds,
      maxSeconds,
      vocabCoverage,
      vocabGoalMet,
      shouldWrapUp: false,
    };
  }

  const remainingToMax = maxSeconds != null ? maxSeconds - elapsedSec : null;
  const shouldWrapUp = remainingToMax != null && remainingToMax <= 90;
  return {
    complete: false,
    reason: null,
    elapsedSec,
    minSeconds,
    maxSeconds,
    vocabCoverage,
    vocabGoalMet,
    shouldWrapUp,
  };
}

/**
 * Generate the AI's opening line once the student says they are ready.
 */
async function generateOpeningMessage(state) {
  const ctx = state.moduleContext;

  // Use admin-configured opening line when available
  if (ctx.aiOpeningLines && ctx.aiOpeningLines.length > 0) {
    return ctx.aiOpeningLines[Math.floor(Math.random() * ctx.aiOpeningLines.length)];
  }

  const prompt = _buildSystemPrompt(state);
  const seed = `The student just said they are ready. Open the conversation naturally as ${ctx.aiRole} in "${ctx.situation || 'the scenario'}". One short line in ${ctx.language} only.`;

  try {
    const openai = _openai();
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user',   content: seed  },
        ],
        max_tokens: 50,
        temperature: 0.7,
      }),
      _timeout(8000, 'Opening message timeout'),
    ]);
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err) {
    console.warn('[conversationEngine] generateOpening fallback:', err.message);
    return ctx.language === 'German'
      ? 'Guten Tag! Wie kann ich Ihnen helfen?'
      : 'Hello! How can I help you?';
  }
}

/**
 * Process one student turn:
 *  1. Record student message
 *  2. Track vocab usage
 *  3. Generate AI reply
 *  4. Update + persist state
 *  5. Return { aiText, translatedTamil, turnCount, complete, vocabCoverage }
 */
async function processStudentTurn(sessionId, transcript, pronunciationScore) {
  const state = getState(sessionId);
  if (!state) throw new Error('Conversation session not found — call /conversation/start first');

  const ctx = state.moduleContext;
  const newTurnCount = state.turnCount + 1;

  // Append student turn
  const historyWithStudent = [
    ...state.history,
    { speaker: 'student', text: transcript, score: pronunciationScore },
  ];

  // Track vocab in student speech
  const usedVocab = _trackVocab(state.vocabList, state.usedVocab, transcript);

  // Evaluate completion with current student turn before generating AI reply.
  const testState = { ...state, turnCount: newTurnCount, usedVocab };
  const completion = isConversationComplete(testState);

  // Build AI reply
  const systemPrompt = _buildSystemPrompt({
    ...state,
    turnCount: newTurnCount,
    usedVocab,
    wrapUpStarted: state.wrapUpStarted || completion.shouldWrapUp || completion.complete,
  });
  let aiText = await _generateReply(systemPrompt, historyWithStudent, completion.complete);

  // Track vocab in AI reply too
  const finalUsedVocab = _trackVocab(state.vocabList, usedVocab, aiText);

  // Persist
  const finalHistory = [
    ...historyWithStudent,
    { speaker: 'ai', text: aiText },
  ];
  setState(sessionId, {
    turnCount: newTurnCount,
    usedVocab: finalUsedVocab,
    history: finalHistory,
    wrapUpStarted: state.wrapUpStarted || completion.shouldWrapUp || completion.complete,
    completionReason: completion.complete ? completion.reason : null,
  });

  // Translate (non-blocking)
  const translatedTamil = await translateToTamil(aiText, ctx.language).catch(() => '');

  const vocabCoverage = state.vocabList.length > 0
    ? Math.round((finalUsedVocab.length / state.vocabList.length) * 100)
    : 100;

  return {
    aiText,
    translatedTamil,
    turnCount: newTurnCount,
    complete: completion.complete,
    completionReason: completion.reason,
    elapsedSeconds: completion.elapsedSec,
    minRequiredSeconds: completion.minSeconds,
    maxAllowedSeconds: completion.maxSeconds,
    shouldWrapUp: completion.shouldWrapUp,
    vocabCoverage,
    usedVocab: finalUsedVocab,
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _openai() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function _timeout(ms, msg) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}

function _extractVocabWords(moduleData) {
  const toWord = (v) => (typeof v === 'string' ? v : v?.word || '');
  const a = (moduleData.allowedVocabulary || []).map(toWord).filter(Boolean);
  const b = (moduleData.aiTutorVocabulary  || []).map(toWord).filter(Boolean);
  return [...new Set([...a, ...b])].map((w) => w.toLowerCase().trim());
}

function _trackVocab(vocabList, currentUsed, text) {
  if (!text) return currentUsed;
  const lower = text.toLowerCase();
  const used = new Set(currentUsed);
  for (const word of vocabList) {
    if (lower.includes(word)) used.add(word);
  }
  return [...used];
}

function _resolvePracticeWindow(moduleData) {
  const fallbackMin = Number(moduleData.minimumCompletionTime || 10);
  const minRaw = moduleData.minPracticeMinutes ?? fallbackMin;
  const maxRaw = moduleData.maxPracticeMinutes;

  const minPracticeMinutes = Number.isFinite(Number(minRaw))
    ? Math.min(120, Math.max(5, Number(minRaw)))
    : 10;
  let maxPracticeMinutes = null;
  if (maxRaw != null && maxRaw !== '') {
    const parsed = Number(maxRaw);
    if (Number.isFinite(parsed)) {
      maxPracticeMinutes = Math.min(180, Math.max(minPracticeMinutes, parsed));
    }
  }
  return { minPracticeMinutes, maxPracticeMinutes };
}

/**
 * Build the system prompt dynamically, reflecting current progress.
 */
function _buildSystemPrompt(state) {
  const ctx = state.moduleContext;
  const level = (ctx.level || 'A1').toUpperCase();

  const allVocab = [
    ...(ctx.allowedVocabulary  || []).map((v) => (typeof v === 'string' ? v : v.word)),
    ...(ctx.aiTutorVocabulary  || []).map((v) => (typeof v === 'string' ? v : v.word)),
  ].filter(Boolean);
  const vocabStr = [...new Set(allVocab)].join(', ');

  const unusedVocab = state.vocabList.filter((w) => !state.usedVocab.includes(w));
  const coveragePct = state.vocabList.length > 0
    ? Math.round((state.usedVocab.length / state.vocabList.length) * 100)
    : 0;
  const elapsedSec = Math.floor((Date.now() - (state.createdAt || Date.now())) / 1000);
  const minSec = Math.max(60, (ctx.minPracticeMinutes || 10) * 60);
  const maxSec = ctx.maxPracticeMinutes != null ? Math.max(minSec, ctx.maxPracticeMinutes * 60) : null;
  const remainingToMin = Math.max(0, minSec - elapsedSec);
  const remainingToMax = maxSec != null ? Math.max(0, maxSec - elapsedSec) : null;

  let endingNote = '';
  if (state.wrapUpStarted || (remainingToMax != null && remainingToMax <= 90)) {
    endingNote = '\nWRAP-UP MODE: Begin closing naturally, keep role consistency, and end in 1-2 turns.';
  } else if (remainingToMin > 0) {
    endingNote = `\nMIN PRACTICE TIME NOT REACHED: keep conversation active for at least ${Math.ceil(remainingToMin / 60)} more minute(s).`;
  }

  return `You are a ${ctx.language} CEFR ${level} conversation partner playing the role of: ${ctx.aiRole}

SITUATION: ${ctx.situation || 'General language practice'}
SETTING: ${ctx.setting || 'Language learning'}
STUDENT ROLE: ${ctx.studentRole}
YOUR PERSONALITY: ${ctx.aiPersonality}

STRICT RULES:
- Speak ONLY in ${ctx.language}
- Keep every reply SHORT — maximum ${level.startsWith('A1') ? 10 : 14} words
- Ask ONE question per turn
- Sound like a REAL PERSON in the situation, not a teacher
- Prioritize words from "Still to introduce" when natural
- Use core vocabulary frequently, but you may add simple level-appropriate support words that fit the role and situation
- NEVER say "wrong", "incorrect", or "mistake"
- If the student errs, model the correct form naturally inside your reply
- Vary responses — never repeat the same line
- Stay in character as ${ctx.aiRole} and do not break role-play context

VOCABULARY:
  All allowed: ${vocabStr || '(simple everyday words)'}
  Already used (${coveragePct}%): ${state.usedVocab.join(', ') || 'none yet'}
  Still to introduce: ${unusedVocab.join(', ') || '✓ all covered'}

OBJECTIVE: ${ctx.objective || 'Complete the scenario naturally'}
${endingNote}`;
}

async function _generateReply(systemPrompt, history, isClosing) {
  try {
    const openai = _openai();
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-8).map((m) => ({
        role: m.speaker === 'ai' ? 'assistant' : 'user',
        content: m.text,
      })),
    ];
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages,
        max_tokens: isClosing ? 80 : 60,
        temperature: 0.7,
      }),
      _timeout(10000, 'AI reply timeout'),
    ]);
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err) {
    console.error('[conversationEngine] _generateReply error:', err.message);
    return 'Ich verstehe. Bitte machen Sie weiter.';
  }
}

function _cleanupOldSessions() {
  const now = Date.now();
  for (const [id, s] of _sessions.entries()) {
    if (now - s.createdAt > SESSION_TTL_MS) _sessions.delete(id);
  }
}

module.exports = {
  startConversation,
  getState,
  setState,
  checkStartTrigger,
  isConversationComplete,
  generateOpeningMessage,
  processStudentTurn,
};
