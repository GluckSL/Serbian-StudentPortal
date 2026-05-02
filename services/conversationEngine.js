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

// ─── Session-end / session-continue keywords ─────────────────────────────────
const END_KEYWORDS = [
  'end', 'stop', 'finish', 'done', 'bye', 'goodbye', 'quit', 'exit',
  'tschüss', 'tschüs', 'tschuss', 'tschues', 'auf wiedersehen', 'wiedersehen',
  'fertig', 'genug', 'schluss', 'aufhören', 'aufhoeren', 'beenden', 'stopp', 'ende',
];
const CONTINUE_KEYWORDS = [
  'continue', 'keep going', 'more', 'carry on', 'go on',
  'weiter', 'weitermachen', 'noch', 'nochmal', 'bitte mehr', 'noch mehr',
];

// ─── Farewell phrase fragments for server-side guard ─────────────────────────
const FAREWELL_FRAGMENTS = [
  'tschüss', 'auf wiedersehen', 'bis bald', 'bis dann', 'bis später',
  'tschau', 'auf wiederschauen', 'schönen tag', 'alles gute', 'viel erfolg',
  'gute reise',
  'goodbye', 'bye', 'see you soon', 'see you later', 'have a nice day',
  'take care', 'farewell', 'all the best',
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise (or re-initialise) the conversation state for a session.
 * Returns the fresh state object.
 *
 * Vocabulary is now tracked in two separate buckets:
 *   vocabStudent  – words from allowedVocabulary  (student should PRODUCE)
 *   vocabAi       – words from aiTutorVocabulary   (AI should MODEL)
 *   vocabList     – union kept for backward compat / single combined % in UI
 */
function startConversation(sessionId, moduleData) {
  const toWord = (v) => (typeof v === 'string' ? v : v?.word || '');

  const vocabStudent = [...new Set(
    (moduleData.allowedVocabulary || []).map(toWord).filter(Boolean),
  )].map((w) => w.toLowerCase().trim());

  const vocabAi = [...new Set(
    (moduleData.aiTutorVocabulary || []).map(toWord).filter(Boolean),
  )].map((w) => w.toLowerCase().trim());

  const vocabList = [...new Set([...vocabStudent, ...vocabAi])];

  const scenario = moduleData.rolePlayScenario || {};
  const timing = _resolvePracticeWindow(moduleData);

  const state = {
    sessionId,
    moduleId: String(moduleData._id || ''),
    conversationStarted: false,
    turnCount: 0,
    maxTurns: Math.max(8, vocabList.length + 3),

    // ── Vocab (split + union) ─────────────────────────────────────────────────
    vocabStudent,           // words student must produce
    vocabAi,               // words AI should model
    vocabList,             // union (for UI / backward compat)
    usedStudentVocab: [],  // covered by student speech
    usedAiVocab: [],       // covered by AI replies
    usedVocab: [],         // union (for UI)

    history: [],           // [{ speaker: 'ai'|'student', text, score? }]
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

    // ── Session-choice flags ──────────────────────────────────────────────────
    sessionChoiceOffered: false,
    sessionChoiceResolved: false,  // true = student chose to continue (extension phase)

    // ── Farewell guard ────────────────────────────────────────────────────────
    closingExchangeCount: 0,

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

/** Returns true when the transcript contains a recognised start trigger. */
function checkStartTrigger(transcript) {
  if (!transcript) return false;
  const lower = transcript.toLowerCase().trim();
  return START_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * True when BOTH vocab buckets are fully covered:
 *   - every student-list word appeared in student speech
 *   - every AI-list word appeared in AI replies
 * Empty lists count as satisfied.
 */
function _isCoreComplete(state) {
  const studentDone =
    state.vocabStudent.length === 0 ||
    state.vocabStudent.every((w) => state.usedStudentVocab.includes(w));
  const aiDone =
    state.vocabAi.length === 0 ||
    state.vocabAi.every((w) => state.usedAiVocab.includes(w));
  return studentDone && aiDone;
}

/** Classify a student response as 'end' | 'continue' | 'ambiguous'. */
function _detectEndOrContinue(transcript) {
  const lower = (transcript || '').toLowerCase();
  const wantsEnd = END_KEYWORDS.some((kw) => lower.includes(kw));
  const wantsContinue = CONTINUE_KEYWORDS.some((kw) => lower.includes(kw));
  if (wantsEnd && !wantsContinue) return 'end';
  if (wantsContinue && !wantsEnd) return 'continue';
  if (/^\s*(yes|ja|okay|ok|sure|klar|gerne)\s*[.!]?\s*$/.test(lower)) return 'continue';
  return 'ambiguous';
}

/** True when the text contains a clear farewell phrase. */
function _isFarewellLine(text) {
  const lower = (text || '').toLowerCase();
  return FAREWELL_FRAGMENTS.some((f) => lower.includes(f));
}

/**
 * Compute time-based completion status.
 * Vocabulary coverage alone no longer auto-completes the session;
 * completion is driven by the student choosing to end or max time.
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
  const maxTimeReached = maxSeconds != null && elapsedSec >= maxSeconds;

  if (maxTimeReached) {
    return {
      complete: true,
      reason: 'max_time_reached',
      elapsedSec, minSeconds, maxSeconds, vocabCoverage, vocabGoalMet,
      shouldWrapUp: true,
    };
  }

  const remainingToMax = maxSeconds != null ? maxSeconds - elapsedSec : null;
  const shouldWrapUp = remainingToMax != null && remainingToMax <= 90;
  return {
    complete: false, reason: null,
    elapsedSec, minSeconds, maxSeconds, vocabCoverage, vocabGoalMet,
    shouldWrapUp,
  };
}

/** Generate the AI's opening line once the student says they are ready. */
async function generateOpeningMessage(state) {
  const ctx = state.moduleContext;

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
 *  1. Record student message + track student-side vocab
 *  2. Compute core-complete + conversation phase
 *  3. Handle session-choice flow
 *  4. Generate AI reply + track AI-side vocab
 *  5. Farewell guard: prevent repeated identical goodbyes
 *  6. Persist state, translate, return enriched result
 */
async function processStudentTurn(sessionId, transcript, pronunciationScore) {
  const state = getState(sessionId);
  if (!state) throw new Error('Conversation session not found — call /conversation/start first');

  const ctx = state.moduleContext;
  const newTurnCount = state.turnCount + 1;

  // Append student turn to working history
  const historyWithStudent = [
    ...state.history,
    { speaker: 'student', text: transcript, score: pronunciationScore },
  ];

  // ── Vocab tracking (student side) ─────────────────────────────────────────
  const usedStudentVocab = _trackVocab(state.vocabStudent, state.usedStudentVocab, transcript);
  // Union for backward compat
  const usedVocabAfterStudent = _trackVocab(state.vocabList, state.usedVocab, transcript);

  // ── Phase determination ────────────────────────────────────────────────────
  const coreCompleteNow = _isCoreComplete({
    ...state,
    usedStudentVocab,
    usedAiVocab: state.usedAiVocab,
  });
  const conversationPhase = coreCompleteNow ? 'extension' : 'core';

  // ── Session-choice handling ────────────────────────────────────────────────
  let sessionChoiceOffered = state.sessionChoiceOffered;
  let sessionChoiceResolved = state.sessionChoiceResolved;
  let choiceResult = null;

  if (sessionChoiceOffered && !sessionChoiceResolved) {
    choiceResult = _detectEndOrContinue(transcript);
    if (choiceResult === 'continue') {
      sessionChoiceResolved = true;
    }
  } else if (coreCompleteNow && !sessionChoiceOffered) {
    // Core vocab just finished for the first time → offer end/continue
    sessionChoiceOffered = true;
  }

  // ── Time-based completion ──────────────────────────────────────────────────
  const testState = { ...state, turnCount: newTurnCount, usedVocab: usedVocabAfterStudent };
  const timeCompletion = isConversationComplete(testState);

  const studentChoseEnd = sessionChoiceOffered && !sessionChoiceResolved && choiceResult === 'end';
  const isComplete = timeCompletion.complete || studentChoseEnd;
  const completionReason = timeCompletion.complete
    ? timeCompletion.reason
    : studentChoseEnd ? 'student_chose_end' : null;

  // ── Build AI reply ─────────────────────────────────────────────────────────
  const systemPrompt = _buildSystemPrompt(
    {
      ...state,
      turnCount: newTurnCount,
      usedStudentVocab,
      usedAiVocab: state.usedAiVocab,
      usedVocab: usedVocabAfterStudent,
      wrapUpStarted: state.wrapUpStarted || timeCompletion.shouldWrapUp || isComplete,
      sessionChoiceOffered,
      sessionChoiceResolved,
      choiceResult,
      conversationPhase,
    },
    historyWithStudent,
  );

  let aiText = await _generateReply(
    systemPrompt,
    historyWithStudent,
    isComplete,
    !state.wrapUpStarted && !timeCompletion.shouldWrapUp,
  );

  // ── Farewell guard: prevent repeated identical goodbyes ────────────────────
  let closingExchangeCount = state.closingExchangeCount || 0;
  if (_isFarewellLine(aiText)) {
    closingExchangeCount += 1;
  }
  if (closingExchangeCount >= 2) {
    // The bot has already said goodbye at least once. Avoid a third full farewell.
    const lastAiLine = state.history.filter((m) => m.speaker === 'ai').slice(-1)[0]?.text || '';
    if (_isFarewellLine(lastAiLine)) {
      // Override with a minimal acknowledgment to break the loop
      const isGerman = (ctx.language || '').toLowerCase().includes('german') || ctx.language === 'Deutsch';
      aiText = isGerman ? 'Alles klar! 😊' : 'Understood! Take care.';
    }
  }

  // ── Track AI-side vocab ────────────────────────────────────────────────────
  const usedAiVocab = _trackVocab(state.vocabAi, state.usedAiVocab, aiText);
  // Update union
  const finalUsedVocab = _trackVocab(state.vocabList, usedVocabAfterStudent, aiText);

  // ── Persist ────────────────────────────────────────────────────────────────
  const finalHistory = [...historyWithStudent, { speaker: 'ai', text: aiText }];
  setState(sessionId, {
    turnCount: newTurnCount,
    usedStudentVocab,
    usedAiVocab,
    usedVocab: finalUsedVocab,
    history: finalHistory,
    wrapUpStarted: state.wrapUpStarted || timeCompletion.shouldWrapUp || isComplete,
    completionReason: isComplete ? completionReason : null,
    sessionChoiceOffered,
    sessionChoiceResolved,
    closingExchangeCount,
  });

  // Translate (non-blocking)
  const translatedTamil = await translateToTamil(aiText, ctx.language).catch(() => '');

  const vocabCoverage = state.vocabList.length > 0
    ? Math.round((finalUsedVocab.length / state.vocabList.length) * 100)
    : 100;

  const studentVocabCoverage = state.vocabStudent.length > 0
    ? Math.round((usedStudentVocab.length / state.vocabStudent.length) * 100)
    : 100;

  const aiVocabCoverage = state.vocabAi.length > 0
    ? Math.round((usedAiVocab.length / state.vocabAi.length) * 100)
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
    // Phase + per-bucket coverage for UI / debug
    phase: conversationPhase,
    studentVocabCoverage,
    aiVocabCoverage,
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _openai() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function _timeout(ms, msg) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
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

function _truncate(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function _studentUtterancesBullets(history, maxLines, maxLen) {
  const lines = (history || [])
    .filter((m) => m.speaker === 'student' && String(m.text || '').trim())
    .slice(-maxLines)
    .map((m) => _truncate(m.text, maxLen));
  return lines.length
    ? lines.map((l, i) => `  ${i + 1}. ${l}`).join('\n')
    : '  (no student speech yet)';
}

function _recentAiBullets(history, maxLines, maxLen) {
  const lines = (history || [])
    .filter((m) => m.speaker === 'ai' && String(m.text || '').trim())
    .slice(-maxLines)
    .map((m) => _truncate(m.text, maxLen));
  return lines.length
    ? lines.map((l, i) => `  ${i + 1}. ${l}`).join('\n')
    : '  (none yet)';
}

/**
 * Build the system prompt dynamically, reflecting current progress.
 * `fullHistory` must include the current student turn for accurate memory.
 *
 * Two distinct PHASE blocks are injected:
 *   core      – vocab coverage still incomplete; drive student + AI word usage
 *   extension – core done; follow scenario thread at same CEFR level, no tangents
 */
function _buildSystemPrompt(state, fullHistory) {
  const hist = fullHistory || state.history || [];
  const ctx = state.moduleContext;
  const level = (ctx.level || 'A1').toUpperCase();

  // ── Vocab lists (resolved from raw objects) ─────────────────────────────────
  const toWord = (v) => (typeof v === 'string' ? v : v?.word || '');
  const studentVocabAll = (ctx.allowedVocabulary || []).map(toWord).filter(Boolean);
  const aiVocabAll      = (ctx.aiTutorVocabulary  || []).map(toWord).filter(Boolean);

  // Words not yet covered in each bucket
  const usedStudent = state.usedStudentVocab || [];
  const usedAi      = state.usedAiVocab || [];
  const unusedStudent = (state.vocabStudent || studentVocabAll.map((w) => w.toLowerCase().trim()))
    .filter((w) => !usedStudent.includes(w));
  const unusedAi = (state.vocabAi || aiVocabAll.map((w) => w.toLowerCase().trim()))
    .filter((w) => !usedAi.includes(w));

  // Combined union for display
  const allVocabWords = [...new Set([...studentVocabAll, ...aiVocabAll])];
  const coveragePct = state.vocabList && state.vocabList.length > 0
    ? Math.round(((state.usedVocab || []).length / state.vocabList.length) * 100)
    : 0;

  // ── Timing ──────────────────────────────────────────────────────────────────
  const elapsedSec = Math.floor((Date.now() - (state.createdAt || Date.now())) / 1000);
  const minSec = Math.max(60, (ctx.minPracticeMinutes || 10) * 60);
  const maxSec = ctx.maxPracticeMinutes != null ? Math.max(minSec, ctx.maxPracticeMinutes * 60) : null;
  const remainingToMin = Math.max(0, minSec - elapsedSec);
  const remainingToMax = maxSec != null ? Math.max(0, maxSec - elapsedSec) : null;

  // ── Memory / anti-repeat ─────────────────────────────────────────────────────
  const studentSoFar  = _studentUtterancesBullets(hist, 14, 140);
  const recentAiFull  = _recentAiBullets(hist, 8, 220);
  const recentAiLines = hist.filter((m) => m.speaker === 'ai').slice(-8).map((m) => m.text);
  const recentQs      = recentAiLines.filter((l) => String(l || '').trim().endsWith('?')).slice(-6);
  const recentQsNote  = recentQs.length > 0
    ? `\nQUESTION-SHAPED LINES YOU USED (never rephrase the same intent):\n${recentQs.map((q) => `  • ${_truncate(q, 180)}`).join('\n')}`
    : '';

  const noRepeatBlock = `
MEMORY — STUDENT HAS ALREADY SAID (treat as fact; never ask again):
${studentSoFar}

YOUR RECENT LINES (do NOT revisit the same intent; advance the scenario):
${recentAiFull}

ANTI-DUPLICATE — HIGHEST PRIORITY:
- Before every reply read MEMORY. NEVER re-ask for information already given (name, spelling, phone, email, any field already answered).
- Do NOT cycle the same fields: Vorname → Nachname → Vorname is forbidden.
- If they gave digits for a phone number: acknowledge once and move on.
- After personal-info fields are collected, move the conversation forward (confirm details, ask about course/schedule, wrap up) — never loop back.
- Your question this turn MUST be about a NEW sub-topic not in YOUR RECENT LINES.
${recentQsNote}`;

  // ── Phase block ──────────────────────────────────────────────────────────────
  const phase = state.conversationPhase || 'core';
  let phaseBlock = '';

  if (phase === 'core') {
    const studentPending = unusedStudent.length > 0
      ? unusedStudent.join(', ')
      : '(all covered)';
    const aiPending = unusedAi.length > 0
      ? unusedAi.join(', ')
      : '(all covered)';

    phaseBlock = `
PHASE: CORE VOCABULARY PRACTICE
Your goal is to help the student practise the admin-defined vocabulary through natural conversation.

STUDENT VOCABULARY (student should PRODUCE these in their replies):
  Still to elicit: ${studentPending}
  Already said:    ${usedStudent.join(', ') || 'none yet'}
  → Ask questions or create situations that naturally invite the student to use these words.

AI VOCABULARY (you should MODEL these in your own lines):
  Still to use: ${aiPending}
  Already used: ${usedAi.join(', ') || 'none yet'}
  → Weave these naturally into YOUR replies; do not just list them.

TOPIC CONSTRAINT: Stay strictly within the scenario. Do NOT introduce topics outside the situation/objective above until all core vocab is covered.`;
  } else {
    phaseBlock = `
PHASE: EXTENSION (all core vocabulary has been practised)
The vocabulary lists have been covered. Continue the conversation naturally.

EXTENSION RULES (strict):
- Continue ONLY along the existing scenario thread — the same situation and roles.
- Do NOT start a completely new questionnaire or jump to an unrelated topic.
- Every turn must logically follow the last substantive topic in MEMORY.
- New words you introduce must match CEFR ${level} difficulty — same simplicity as the admin lists (short, concrete, common words). No advanced vocabulary.
- A natural close is appropriate if the scenario has reached a logical end — but say goodbye ONLY ONCE. After one farewell, give a brief 3–4 word acknowledgment if the student replies, or stay silent (let the session end naturally).
- Do not re-open a new topic after saying goodbye.`;
  }

  // ── Session-choice block ─────────────────────────────────────────────────────
  let sessionChoiceNote = '';
  if (state.sessionChoiceOffered && !state.sessionChoiceResolved) {
    if (state.choiceResult === 'ambiguous') {
      sessionChoiceNote = `\nSESSION CHOICE: Student was unclear. Ask one more time (briefly) whether they want to end or continue. In ${ctx.language} only, under 10 words.`;
    } else {
      const isGerman = (ctx.language || '').toLowerCase().includes('german') || ctx.language === 'Deutsch';
      const choiceQ = isGerman
        ? 'Wollen wir aufhören oder weitermachen?'
        : 'Shall we end here or would you like to continue?';
      sessionChoiceNote = `\nSESSION CHOICE REQUIRED: Core vocabulary is done. Your reply MUST end with: "${choiceQ}" (in ${ctx.language}). Keep the rest under 8 words.`;
    }
  } else if (state.sessionChoiceResolved) {
    sessionChoiceNote = `\nSTUDENT CHOSE TO CONTINUE: Keep the conversation going in EXTENSION mode. Do NOT ask about ending again.`;
  }

  // ── Time / wrap-up note ──────────────────────────────────────────────────────
  let endingNote = '';
  if (state.wrapUpStarted || (remainingToMax != null && remainingToMax <= 90)) {
    endingNote = '\nWRAP-UP MODE: Begin closing naturally, stay in character, end in 1-2 turns.';
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
- Ask at most ONE question per turn (or zero when a confirmation fits better)
- Sound like a REAL PERSON in the situation, not a teacher
- NEVER say "wrong", "incorrect", or "mistake"
- If the student errs, model the correct form naturally in your reply — then advance; do not re-quiz
- Never repeat the same sentence; never re-ask the same semantic question
- Stay in character as ${ctx.aiRole} at all times
${noRepeatBlock}
${phaseBlock}

VOCABULARY OVERVIEW (combined, ${coveragePct}% done):
  All words: ${allVocabWords.join(', ') || '(simple everyday words)'}

OBJECTIVE: ${ctx.objective || 'Complete the scenario naturally'}
${sessionChoiceNote}${endingNote}`;
}

/**
 * Generate a single AI reply.
 * `isClosing` bumps max_tokens for a proper farewell.
 * `allowHigherTemp` raises temperature in core phase to reduce loops.
 */
async function _generateReply(systemPrompt, history, isClosing, allowHigherTemp = false) {
  try {
    const openai = _openai();
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-20).map((m) => ({
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
