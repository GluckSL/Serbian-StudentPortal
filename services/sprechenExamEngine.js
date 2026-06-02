'use strict';

const SprechenExamSession = require('../models/SprechenExamSession');
const { presignS3Url } = require('../config/presign');
const { scoreTurn } = require('./sprechenEvaluatorService');
const { resolveModuleRubric } = require('./sprechenRubricDefaults');
const {
  answerStudentQuestion,
  askStudentQuestion,
  respondToStudentRequest,
  makeRequestToStudent,
} = require('./sprechenInterlocutorService');

function botMsg(role, text, extras = {}) {
  return {
    role,
    text,
    phase: extras.phase,
    captionEn: extras.captionEn || '',
    captionTa: extras.captionTa || '',
  };
}

/** Presign the imageUrl on a card object so it loads in the browser. */
async function presignCard(card) {
  if (!card || !card.imageUrl) return card;
  const signed = await presignS3Url(card.imageUrl);
  if (signed) card.imageUrl = signed;
  return card;
}

// ─── Phase definitions ────────────────────────────────────────────────────────

/** Card shown during Teil 1 (intro image + keyword fallback). */
function teil1StudentCard(module) {
  const t1 = (module && module.teil1) || {};
  return {
    type: 'keywords',
    content: (t1.keywords || []).join(', '),
    imageUrl: t1.introCardImageUrl || '',
  };
}

function makeSpellAskPhase(id, prompt) {
  return {
    id: `${id}_ask`,
    role: 'moderator',
    teil: 1,
    card: null,
    getData: async () => ({ botSpeech: prompt, card: null }),
  };
}

function makeSpellAnswerPhase(id) {
  return {
    id,
    role: 'student',
    teil: 1,
    card: teil1StudentCard,
    turnType: 'teil1_spell',
    evalTeil: 'teil1',
  };
}

function makeNumberAskPhase(id, prompt) {
  return {
    id: `${id}_ask`,
    role: 'moderator',
    teil: 1,
    card: null,
    getData: async () => ({ botSpeech: prompt, card: null }),
  };
}

function makeNumberAnswerPhase(id) {
  return {
    id,
    role: 'student',
    teil: 1,
    card: teil1StudentCard,
    turnType: 'teil1_number',
    evalTeil: 'teil1',
  };
}

/**
 * Build a flat, ordered array of phase descriptors from a module document.
 * Each phase descriptor describes:
 *   - id        unique phase string stored on session.state.phase
 *   - role      'moderator' | 'student' | 'interlocutor'
 *   - teil      1 | 2 | 3 | 0 (0 = global)
 *   - card      card spec (or null)
 *   - getData   async fn(module, session) → { botSpeech, card }
 *               for bot-driven phases (moderator or interlocutor)
 *   - turnType  string for evaluator (student phases only)
 *   - evalTeil  'teil1' | 'teil2' | 'teil3' (student phases only)
 */
function buildPhaseSequence(mod) {
  const themes = (mod.teil2 && mod.teil2.themes) || [];
  const rounds = (mod.teil3 && mod.teil3.rounds) || [];

  const phases = [];

  // ── Welcome ──────────────────────────────────────────────────────────────
  phases.push({
    id: 'welcome',
    role: 'moderator',
    teil: 0,
    card: null,
    getData: async () => ({
      botSpeech:
        'Herzlich willkommen zu Ihrer Goethe A1 Sprechprüfung. ' +
        'Die Prüfung besteht aus drei Teilen. ' +
        'Sind Sie bereit? Sagen Sie bitte „Ja, ich bin bereit.", wenn Sie anfangen möchten.',
      captionEn:
        'Welcome to your Goethe A1 speaking exam. The exam has three parts. ' +
        'Are you ready? Please say “Yes, I am ready” when you want to begin.',
      card: null,
    }),
  });

  // ── Teil 1 ───────────────────────────────────────────────────────────────
  phases.push({
    id: 'teil1_brief',
    role: 'moderator',
    teil: 1,
    card: null,
    getData: async () => ({
      botSpeech: 'Wir beginnen mit Teil eins. Bitte stellen Sie sich vor. Sie sehen eine Karte mit Stichwörtern.',
      captionEn: 'We begin with Part 1. Please introduce yourself. You see a card with keywords.',
      card: null,
    }),
  });

  phases.push({
    id: 'teil1_card',
    role: 'student',
    teil: 1,
    card: teil1StudentCard,
    turnType: 'teil1_card',
    evalTeil: 'teil1',
    instruction: 'Stellen Sie sich bitte vor. Sie können die Karte benutzen.',
    instructionEn: 'Please introduce yourself. You may use the card.',
  });

  // Each spell/number prompt: moderator asks, then student answers (same pattern as Teil 2).
  const spellPrompts = (mod && mod.teil1 && mod.teil1.spellPrompts) || [];
  if (spellPrompts.length === 0) {
    phases.push(makeSpellAskPhase('teil1_spell', 'Buchstabieren Sie bitte Ihren Nachnamen.'));
    phases.push(makeSpellAnswerPhase('teil1_spell'));
  } else {
    spellPrompts.forEach((prompt, i) => {
      const id = `teil1_spell${i > 0 ? `_${i}` : ''}`;
      phases.push(makeSpellAskPhase(id, prompt));
      phases.push(makeSpellAnswerPhase(id));
    });
  }

  const numberPrompts = (mod && mod.teil1 && mod.teil1.numberPrompts) || [];
  if (numberPrompts.length === 0) {
    phases.push(makeNumberAskPhase('teil1_number', 'Nennen Sie mir bitte Ihre Telefonnummer.'));
    phases.push(makeNumberAnswerPhase('teil1_number'));
  } else {
    numberPrompts.forEach((prompt, i) => {
      const id = `teil1_number${i > 0 ? `_${i}` : ''}`;
      phases.push(makeNumberAskPhase(id, prompt));
      phases.push(makeNumberAnswerPhase(id));
    });
  }

  phases.push({
    id: 'teil1_close',
    role: 'moderator',
    teil: 1,
    card: null,
    getData: async () => ({
      botSpeech: 'Danke. Teil eins ist beendet. Wir machen jetzt weiter mit Teil zwei.',
      captionEn: 'Thank you. Part 1 is finished. We continue with Part 2.',
      card: null,
    }),
  });

  // ── Teil 2 ───────────────────────────────────────────────────────────────
  phases.push({
    id: 'teil2_brief',
    role: 'moderator',
    teil: 2,
    card: null,
    getData: async () => ({
      botSpeech:
        'In Teil zwei stellen wir uns gegenseitig Fragen. ' +
        'Ich zeige Ihnen eine Karte mit einem Stichwort. ' +
        'Erst stellen Sie mir eine Frage, dann stelle ich Ihnen eine Frage.',
      captionEn:
        'In Part 2 we ask each other questions. I show you a card with a keyword. ' +
        'First you ask me a question, then I ask you one.',
      card: null,
    }),
  });

  for (let ti = 0; ti < themes.length; ti++) {
    const theme = themes[ti];

    phases.push({
      id: `teil2_theme${ti}_announce`,
      role: 'moderator',
      teil: 2,
      card: null,
      getData: async () => ({
        botSpeech: `Unser Thema ist: ${theme.name}.`,
        card: null,
      }),
    });

    // Student asks (student turn → bot answers immediately after in bot speech)
    phases.push({
      id: `teil2_theme${ti}_student_ask`,
      role: 'student',
      teil: 2,
      card: (module) => {
        const t = (module.teil2.themes || [])[ti] || {};
        return {
          type: 'keyword',
          content: t.studentKeyword || '',
          imageUrl: t.studentCardImageUrl || '',
        };
      },
      turnType: 'teil2_student_ask',
      evalTeil: 'teil2',
      instruction: `Stellen Sie mir bitte eine Frage zum Stichwort auf der Karte.`,
      instructionEn: 'Please ask me a question about the keyword on the card.',
      // After student speaks the bot (interlocutor) answers: handled in engine
      botAnswers: true,
      themeIndex: ti,
    });

    // Bot asks student (interlocutor phase — bot speaks first, then student answers)
    phases.push({
      id: `teil2_theme${ti}_bot_ask`,
      role: 'interlocutor',
      teil: 2,
      card: (module) => {
        const t = (module.teil2.themes || [])[ti] || {};
        return {
          type: 'keyword',
          content: t.botKeyword || '',
          imageUrl: t.botCardImageUrl || '',
        };
      },
      getData: async (module, _session, prev) => {
        const t = (module.teil2.themes || [])[ti] || {};
        const speech = await askStudentQuestion(t.name || '', t.botKeyword || '');
        return {
          botSpeech: speech,
          card: { type: 'keyword', content: t.botKeyword || '', imageUrl: '' },
        };
      },
      themeIndex: ti,
    });

    phases.push({
      id: `teil2_theme${ti}_student_answer`,
      role: 'student',
      teil: 2,
      card: null,
      turnType: 'teil2_student_answer',
      evalTeil: 'teil2',
      instruction: 'Bitte antworten Sie auf meine Frage.',
      instructionEn: 'Please answer my question.',
      themeIndex: ti,
    });
  }

  phases.push({
    id: 'teil2_close',
    role: 'moderator',
    teil: 2,
    card: null,
    getData: async () => ({
      botSpeech: 'Danke. Teil zwei ist beendet. Wir machen jetzt weiter mit Teil drei.',
      captionEn: 'Thank you. Part 2 is finished. We continue with Part 3.',
      card: null,
    }),
  });

  // ── Teil 3 ───────────────────────────────────────────────────────────────
  phases.push({
    id: 'teil3_brief',
    role: 'moderator',
    teil: 3,
    card: null,
    getData: async () => ({
      botSpeech:
        'In Teil drei bitten wir uns gegenseitig um etwas. ' +
        'Ich zeige Ihnen eine Karte. Stellen Sie mir bitte eine Bitte.',
      captionEn:
        'In Part 3 we make requests to each other. I show you a card. Please make a request to me.',
      card: null,
    }),
  });

  for (let ri = 0; ri < rounds.length; ri++) {
    const round = rounds[ri];

    // Student requests
    phases.push({
      id: `teil3_round${ri}_student_request`,
      role: 'student',
      teil: 3,
      card: () => ({
        type: 'object',
        content: round.studentCard.label || '',
        imageUrl: round.studentCard.imageUrl || '',
      }),
      turnType: 'teil3_student_request',
      evalTeil: 'teil3',
      instruction: 'Stellen Sie mir bitte eine Bitte zu dem Gegenstand auf der Karte.',
      instructionEn: 'Please make a request about the object on the card.',
      botAnswers: true,
      roundIndex: ri,
    });

    // Bot requests (interlocutor phase)
    phases.push({
      id: `teil3_round${ri}_bot_request`,
      role: 'interlocutor',
      teil: 3,
      card: () => ({
        type: 'object',
        content: round.botCard.label || '',
        imageUrl: round.botCard.imageUrl || '',
      }),
      getData: async (module, _session) => {
        const r = (module.teil3.rounds || [])[ri] || {};
        const speech = await makeRequestToStudent(r.botCard?.objectDe || r.botCard?.label || '');
        return {
          botSpeech: speech,
          card: { type: 'object', content: r.botCard?.label || '', imageUrl: r.botCard?.imageUrl || '' },
        };
      },
      roundIndex: ri,
    });

    phases.push({
      id: `teil3_round${ri}_student_response`,
      role: 'student',
      teil: 3,
      card: null,
      turnType: 'teil3_student_response',
      evalTeil: 'teil3',
      instruction: 'Bitte antworten Sie auf meine Bitte.',
      instructionEn: 'Please respond to my request.',
      roundIndex: ri,
    });
  }

  phases.push({
    id: 'teil3_close',
    role: 'moderator',
    teil: 3,
    card: null,
    getData: async () => ({
      botSpeech: 'Das ist das Ende der Sprechprüfung. Vielen Dank.',
      captionEn: 'This is the end of the speaking exam. Thank you.',
      card: null,
    }),
  });

  phases.push({
    id: 'complete',
    role: 'moderator',
    teil: 0,
    card: null,
    getData: async () => ({ botSpeech: '', card: null }),
  });

  return phases;
}

// ─── Phase navigation helpers ─────────────────────────────────────────────────

function findPhaseIndex(phases, phaseId) {
  return phases.findIndex((p) => p.id === phaseId);
}

function isStudentPhase(phase) {
  return phase.role === 'student';
}

function isBotPhase(phase) {
  return phase.role === 'moderator' || phase.role === 'interlocutor';
}

function getCard(phaseDef, mod) {
  if (!phaseDef.card) return null;
  if (typeof phaseDef.card === 'function') return phaseDef.card(mod);
  return phaseDef.card;
}

// ─── Compile Teil scores from turns ──────────────────────────────────────────

function compileTeilScores(turns, rubric, passThreshold) {
  let t1 = 0, t2 = 0, t3 = 0;

  for (const turn of turns) {
    if (turn.role !== 'student') continue;
    const eval_ = turn.tutorOverride
      ? { points: turn.tutorOverride.points }
      : turn.evaluation;
    if (!eval_) continue;
    const pts = typeof eval_.points === 'number' ? eval_.points : 0;
    if (turn.teil === 1) t1 += pts;
    else if (turn.teil === 2) t2 += pts;
    else if (turn.teil === 3) t3 += pts;
  }

  // Cap per Teil
  const cap1 = rubric?.teil1?.maxPoints ?? 3;
  const cap2 = rubric?.teil2?.maxPoints ?? 6;
  const cap3 = rubric?.teil3?.maxPoints ?? 6;

  t1 = Math.min(t1, cap1);
  t2 = Math.min(t2, cap2);
  t3 = Math.min(t3, cap3);

  const total = t1 + t2 + t3;
  return {
    teil1: Math.round(t1 * 10) / 10,
    teil2: Math.round(t2 * 10) / 10,
    teil3: Math.round(t3 * 10) / 10,
    total: Math.round(total * 10) / 10,
    passed: total >= (passThreshold || 10),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise a new session — returns welcome state (bot message + no card).
 * Saves session.state into the DB.
 */
async function initSession(session, module) {
  const phases = buildPhaseSequence(module);
  const first = phases[0]; // 'welcome'
  const welcomeData = await first.getData(module, session);
  const botSpeech = welcomeData.botSpeech;
  const welcomeCaptionEn = welcomeData.captionEn || '';

  session.state.phase = first.id;
  session.state.awaitingStudent = false;
  session.state.teilNumber = 0;
  session.state.cardType = '';
  session.state.cardContent = '';
  session.state.cardImageUrl = '';

  const turnCount = session.turns.length;
  session.turns.push({
    teil: 0,
    turnNumber: turnCount,
    phase: first.id,
    role: 'bot',
    card: null,
    transcript: '',
    durationMs: null,
    evaluation: null,
    botSpeech,
    at: new Date(),
  });

  await session.save();
  return {
    botMessages: [botMsg('bot', botSpeech, { phase: first.id, captionEn: welcomeCaptionEn })],
    card: null,
    phase: first.id,
    awaitingStudent: false,
  };
}

/**
 * Advance past the welcome phase (student clicks "I'm ready").
 * Auto-runs bot-only phases until the next student turn.
 */
async function advanceReady(session, module) {
  if (session.state.phase !== 'welcome') {
    return _getCurrentState(session, module);
  }
  const phases = buildPhaseSequence(module);
  // Move to phase index 1 (teil1_brief) and then auto-advance bot phases
  const nextIdx = findPhaseIndex(phases, 'welcome') + 1;
  return _runFromIndex(session, module, phases, nextIdx, null, []);
}

/**
 * Process a student turn and advance the exam.
 *
 * @param {object} session   - Mongoose session doc (not yet saved)
 * @param {object} module    - Mongoose module doc (lean or full)
 * @param {string} transcript
 * @param {number} durationMs
 * @returns {Promise<{ botMessages, card, phase, awaitingStudent, done }>}
 */
async function processTurn(session, module, transcript, durationMs) {
  const phases = buildPhaseSequence(module);
  const currentPhaseId = session.state.phase;
  const currentIdx = findPhaseIndex(phases, currentPhaseId);

  if (currentIdx < 0) {
    throw new Error(`Unknown phase: ${currentPhaseId}`);
  }

  const currentPhaseDef = phases[currentIdx];

  // Should be a student phase
  if (!isStudentPhase(currentPhaseDef)) {
    throw new Error(`Phase ${currentPhaseId} is not a student phase`);
  }

  // ── 1. Record student turn ────────────────────────────────────────────────
  const card = getCard(currentPhaseDef, module);
  const turnNumber = session.turns.length;

  session.turns.push({
    teil: currentPhaseDef.teil,
    turnNumber,
    phase: currentPhaseId,
    role: 'student',
    card: card || null,
    transcript: transcript || '',
    durationMs: durationMs || null,
    evaluation: null,
    botSpeech: '',
    at: new Date(),
  });

  // ── 2. Evaluate silently (async, non-blocking session flow) ───────────────
  const rubric = resolveModuleRubric(module);
  const rubricTeil = rubric && rubric[currentPhaseDef.evalTeil];
  const criteria = (rubricTeil && rubricTeil.criteria) || [];

  const evalResult = await scoreTurn({
    teil: currentPhaseDef.teil,
    turnType: currentPhaseDef.turnType,
    transcript,
    card,
    criteria,
  });

  // Write evaluation back to the turn
  const lastTurnIdx = session.turns.length - 1;
  session.turns[lastTurnIdx].evaluation = evalResult;

  // ── 3. Bot answers THIS turn inline (Teil 2 student_ask / Teil 3 student_request) ──
  const inlineBotMessages = [];

  if (currentPhaseDef.botAnswers) {
    let inlineBotSpeech = '';
    if (currentPhaseDef.turnType === 'teil2_student_ask') {
      const t = (module.teil2.themes || [])[currentPhaseDef.themeIndex] || {};
      inlineBotSpeech = await answerStudentQuestion(t.name || '', transcript);
    } else if (currentPhaseDef.turnType === 'teil3_student_request') {
      const r = (module.teil3.rounds || [])[currentPhaseDef.roundIndex] || {};
      inlineBotSpeech = await respondToStudentRequest(r.studentCard?.objectDe || r.studentCard?.label || '', transcript);
    }
    if (inlineBotSpeech) {
      session.turns.push({
        teil: currentPhaseDef.teil,
        turnNumber: session.turns.length,
        phase: currentPhaseId,
        role: 'bot',
        card: null,
        transcript: '',
        durationMs: null,
        evaluation: null,
        botSpeech: inlineBotSpeech,
        at: new Date(),
      });
      inlineBotMessages.push({ role: 'bot', text: inlineBotSpeech, phase: currentPhaseId });
    }
  }

  // ── 4. Advance to next phase(s) ───────────────────────────────────────────
  return _runFromIndex(session, module, phases, currentIdx + 1, null, inlineBotMessages);
}

/**
 * Run bot-only phases from `startIdx` until we hit a student phase or `complete`.
 * Saves session.state on each hop.
 */
async function _runFromIndex(session, module, phases, startIdx, _prevBotSpeech, prependMessages) {
  const botMessages = [...(prependMessages || [])];
  let finalCard = null;

  for (let i = startIdx; i < phases.length; i++) {
    const phaseDef = phases[i];

    if (phaseDef.id === 'complete') {
      session.state.phase = 'complete';
      session.state.awaitingStudent = false;
      session.state.teilNumber = 0;
      await session.save();
      return {
        botMessages,
        card: null,
        phase: 'complete',
        awaitingStudent: false,
        done: true,
      };
    }

    // Track Teil transitions
    if (phaseDef.teil > 0 && phaseDef.teil !== session.state.teilNumber) {
      session.state.teilNumber = phaseDef.teil;
      session.state.teilStartedAt = new Date();
    }

    if (isBotPhase(phaseDef)) {
      // Generate bot speech
      const phaseData = await phaseDef.getData(module, session);
      const botSpeech = phaseData.botSpeech;
      const cardSpec = phaseData.card || getCard(phaseDef, module);
      const captionEn = phaseData.captionEn || '';

      session.turns.push({
        teil: phaseDef.teil,
        turnNumber: session.turns.length,
        phase: phaseDef.id,
        role: 'bot',
        card: cardSpec || null,
        transcript: '',
        durationMs: null,
        evaluation: null,
        botSpeech: botSpeech || '',
        at: new Date(),
      });

      if (botSpeech) {
        botMessages.push(botMsg('bot', botSpeech, { phase: phaseDef.id, captionEn }));
      }
      if (cardSpec) {
        finalCard = cardSpec;
      }

      // Update state
      session.state.phase = phaseDef.id;
      session.state.awaitingStudent = false;
      if (cardSpec) {
        session.state.cardType = cardSpec.type || '';
        session.state.cardContent = cardSpec.content || '';
        session.state.cardImageUrl = cardSpec.imageUrl || '';
      }
      // Continue to next phase automatically
      continue;
    }

    // Student phase — stop here and wait
    const studentCard = getCard(phaseDef, module);

    session.state.phase = phaseDef.id;
    session.state.awaitingStudent = true;
    if (studentCard) {
      session.state.cardType = studentCard.type || '';
      session.state.cardContent = studentCard.content || '';
      session.state.cardImageUrl = studentCard.imageUrl || '';
      finalCard = studentCard;
    } else if (phaseDef.teil === 1) {
      // Keep Teil 1 intro card visible for spell/number turns when no per-phase card.
      const t1Card = teil1StudentCard(module);
      session.state.cardType = t1Card.type || '';
      session.state.cardContent = t1Card.content || '';
      session.state.cardImageUrl = t1Card.imageUrl || '';
      if (t1Card.imageUrl || t1Card.content) finalCard = t1Card;
    } else {
      session.state.cardType = '';
      session.state.cardContent = '';
      session.state.cardImageUrl = '';
    }

    // Add instruction message for student turn
    if (phaseDef.instruction) {
      botMessages.push(
        botMsg('moderator', phaseDef.instruction, {
          phase: phaseDef.id,
          captionEn: phaseDef.instructionEn || '',
        }),
      );
    }

    // Presign the card image URL so it's fresh for the browser
    if (finalCard && finalCard.imageUrl) {
      const signed = await presignS3Url(finalCard.imageUrl);
      if (signed) finalCard = { ...finalCard, imageUrl: signed };
    }

    await session.save();
    return {
      botMessages,
      card: finalCard,
      phase: phaseDef.id,
      awaitingStudent: true,
      done: false,
    };
  }

  // Exhausted all phases — mark complete
  session.state.phase = 'complete';
  session.state.awaitingStudent = false;
  await session.save();
  return { botMessages, card: null, phase: 'complete', awaitingStudent: false, done: true };
}

function _getCurrentState(session, module) {
  const phases = buildPhaseSequence(module);
  const idx = findPhaseIndex(phases, session.state.phase);
  if (idx < 0) return { phase: session.state.phase, awaitingStudent: false, done: false };

  const phaseDef = phases[idx];
  const card = session.state.cardContent
    ? { type: session.state.cardType, content: session.state.cardContent, imageUrl: session.state.cardImageUrl }
    : null;

  return {
    botMessages: [],
    card,
    phase: session.state.phase,
    awaitingStudent: session.state.awaitingStudent,
    done: session.state.phase === 'complete',
    teilNumber: session.state.teilNumber,
    instruction: phaseDef.instruction || null,
  };
}

/**
 * Finalize session — compile scores, mark completed.
 */
async function completeSession(session, module) {
  const rubric = resolveModuleRubric(module);
  const scores = compileTeilScores(session.turns, rubric, module.passThreshold);
  session.scores = scores;
  session.completed = true;
  session.completedAt = new Date();
  session.state.phase = 'complete';
  session.state.awaitingStudent = false;
  await session.save();
  return scores;
}

module.exports = {
  buildPhaseSequence,
  initSession,
  advanceReady,
  processTurn,
  completeSession,
  compileTeilScores,
};
