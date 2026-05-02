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

// ─── Session-end / session-continue keywords (checked when choice is offered) ─
const END_KEYWORDS = [
  'end', 'stop', 'finish', 'done', 'bye', 'goodbye', 'quit', 'exit',
  'tschüss', 'tschüs', 'tschuss', 'tschues', 'auf wiedersehen', 'wiedersehen',
  'fertig', 'genug', 'schluss', 'aufhören', 'aufhoeren', 'beenden', 'stopp', 'ende',
];
const CONTINUE_KEYWORDS = [
  'continue', 'keep going', 'more', 'carry on', 'go on',
  'weiter', 'weitermachen', 'noch', 'nochmal', 'bitte mehr', 'noch mehr',
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
    // ── Session-choice flags (end or continue after all vocab used) ──────────
    sessionChoiceOffered: false,
    sessionChoiceResolved: false,   // true = student chose to continue
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
 * Classify a student response as 'end', 'continue', or 'ambiguous'
 * when the bot has offered the session-end choice.
 */
function _detectEndOrContinue(transcript) {
  const lower = (transcript || '').toLowerCase();
  const wantsEnd = END_KEYWORDS.some((kw) => lower.includes(kw));
  const wantsContinue = CONTINUE_KEYWORDS.some((kw) => lower.includes(kw));
  if (wantsEnd && !wantsContinue) return 'end';
  if (wantsContinue && !wantsEnd) return 'continue';
  // Bare "yes / ja / okay" with nothing else → treat as "continue" (keep going)
  if (/^\s*(yes|ja|okay|ok|sure|klar|gerne)\s*[.!]?\s*$/.test(lower)) return 'continue';
  return 'ambiguous';
}

/**
 * Compute completion status.
 * - Hard finish on max time reached.
 * - Vocabulary coverage alone no longer auto-completes; completion is driven
 *   by the student explicitly choosing to end after the session-choice prompt.
 * - 'student_chose_end' is set directly in processStudentTurn and propagated
 *   back to the caller; this function only needs to cover time-based exits.
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
 *  3. Handle session-choice flow (end or continue after all vocab is covered)
 *  4. Generate AI reply
 *  5. Update + persist state
 *  6. Return { aiText, translatedTamil, turnCount, complete, vocabCoverage }
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

  // ── Session-choice handling ──────────────────────────────────────────────────
  const unusedVocab = state.vocabList.filter((w) => !usedVocab.includes(w));
  const allVocabCovered = state.vocabList.length > 0 && unusedVocab.length === 0;

  let sessionChoiceOffered = state.sessionChoiceOffered;
  let sessionChoiceResolved = state.sessionChoiceResolved;
  let choiceResult = null; // 'end' | 'continue' | 'ambiguous' | null

  if (sessionChoiceOffered && !sessionChoiceResolved) {
    // Student is responding to the end-or-continue prompt
    choiceResult = _detectEndOrContinue(transcript);
    if (choiceResult === 'continue') {
      sessionChoiceResolved = true;
    }
    // 'end' and 'ambiguous' are handled below — for 'end' we will complete the
    // session after generating the AI farewell; for 'ambiguous' the AI re-asks.
  } else if (allVocabCovered && !sessionChoiceOffered) {
    // All vocab used for the first time — offer the choice next AI turn
    sessionChoiceOffered = true;
  }

  // Time-based completion check (max time is still a hard cap)
  const testState = { ...state, turnCount: newTurnCount, usedVocab };
  const timeCompletion = isConversationComplete(testState);

  // Student explicitly ended the session
  const studentChoseEnd = sessionChoiceOffered && !sessionChoiceResolved && choiceResult === 'end';
  const isComplete = timeCompletion.complete || studentChoseEnd;
  const completionReason = timeCompletion.complete
    ? timeCompletion.reason
    : studentChoseEnd
      ? 'student_chose_end'
      : null;

  // Build AI reply
  const systemPrompt = _buildSystemPrompt({
    ...state,
    turnCount: newTurnCount,
    usedVocab,
    wrapUpStarted: state.wrapUpStarted || timeCompletion.shouldWrapUp || isComplete,
    sessionChoiceOffered,
    sessionChoiceResolved,
    choiceResult,
  });
  let aiText = await _generateReply(
    systemPrompt,
    historyWithStudent,
    isComplete,
    !state.wrapUpStarted && !timeCompletion.shouldWrapUp,
  );

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
    wrapUpStarted: state.wrapUpStarted || timeCompletion.shouldWrapUp || isComplete,
    completionReason: isComplete ? completionReason : null,
    sessionChoiceOffered,
    sessionChoiceResolved,
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
    complete: isComplete,
    completionReason,
    elapsedSeconds: timeCompletion.elapsedSec,
    minRequiredSeconds: timeCompletion.minSeconds,
    maxAllowedSeconds: timeCompletion.maxSeconds,
    shouldWrapUp: timeCompletion.shouldWrapUp,
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
 * Extra sections injected based on session state:
 *  - RECENT AI QUESTIONS → anti-repeat guidance
 *  - SESSION CHOICE      → ask end-or-continue when all vocab covered
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

  // ── Anti-repeat: surface the last few AI questions ──────────────────────────
  const recentAiLines = (state.history || [])
    .filter((m) => m.speaker === 'ai')
    .slice(-6)
    .map((m) => m.text);
  const recentQuestions = recentAiLines.filter((l) => l.trim().endsWith('?')).slice(-4);
  const antiRepeatNote = recentQuestions.length > 0
    ? `\nRECENT QUESTIONS ALREADY ASKED (do NOT ask the same thing again — find a different angle or move the conversation forward):\n${recentQuestions.map((q) => `  • "${q}"`).join('\n')}`
    : '';

  // ── Session-choice section ──────────────────────────────────────────────────
  let sessionChoiceNote = '';
  if (state.sessionChoiceOffered && !state.sessionChoiceResolved) {
    if (state.choiceResult === 'ambiguous') {
      sessionChoiceNote = `\nSESSION CHOICE (student was unclear): Ask ONE more time, very briefly, whether they want to end or continue. In ${ctx.language} only. Keep it under 10 words.`;
    } else {
      // First time offering the choice
      const isGerman = (ctx.language || '').toLowerCase().includes('german') || ctx.language === 'Deutsch';
      const choicePrompt = isGerman
        ? 'Wollen wir aufhören oder weitermachen?'
        : 'Shall we end here or would you like to continue?';
      sessionChoiceNote = `\nSESSION CHOICE REQUIRED: All vocabulary has been practised. Your NEXT reply MUST end with this question (translated naturally into ${ctx.language}): "${choicePrompt}" — keep the rest of your reply short (under 8 words before the question).`;
    }
  } else if (state.sessionChoiceResolved) {
    sessionChoiceNote = '\nSTUDENT CHOSE TO CONTINUE: Keep the conversation going naturally. Do NOT ask about ending again unless the student brings it up.';
  }

  // ── Time / wrap-up note ─────────────────────────────────────────────────────
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
- Ask at most ONE question per turn
- Sound like a REAL PERSON in the situation, not a teacher
- Prioritize words from "Still to introduce" when natural
- Use core vocabulary frequently, but you may add simple level-appropriate support words that fit the role and situation
- NEVER say "wrong", "incorrect", or "mistake"
- If the student errs, model the correct form naturally inside your reply
- Vary responses — never repeat the same line or rephrase a question you already asked
- Stay in character as ${ctx.aiRole} and do not break role-play context
${antiRepeatNote}

VOCABULARY:
  All allowed: ${vocabStr || '(simple everyday words)'}
  Already used (${coveragePct}%): ${state.usedVocab.join(', ') || 'none yet'}
  Still to introduce: ${unusedVocab.join(', ') || '✓ all covered'}

OBJECTIVE: ${ctx.objective || 'Complete the scenario naturally'}
${sessionChoiceNote}${endingNote}`;
}

/**
 * Generate a single AI reply.
 * `isClosing` bumps max_tokens slightly for a proper farewell.
 * `allowHigherTemp` bumps temperature when not in wrap-up mode to reduce loops.
 */
async function _generateReply(systemPrompt, history, isClosing, allowHigherTemp = false) {
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
        temperature: allowHigherTemp ? 0.85 : 0.7,
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
