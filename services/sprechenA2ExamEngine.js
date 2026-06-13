'use strict';

/**
 * Goethe A2 Sprechen exam engine.
 *
 * Public API mirrors the A1 engine so the session controller can dispatch with:
 *   const engine = mod.examFormat === 'A2' ? a2Engine : a1Engine;
 *
 * Phase sequence:
 *   welcome
 *   a2t1_brief
 *   a2t1_card{i}_student_ask  →  bot answers inline  (× N cards)
 *   a2t1_card{i}_bot_ask      →  interlocutor speaks  (× N cards)
 *   a2t1_card{i}_student_answer                       (× N cards)
 *   a2t1_close
 *   a2t2_brief
 *   a2t2_card{i}_monologue    (monologue mode, student speaks freely then clicks Fertig) (× M cards)
 *   a2t2_close
 *   a2t3_brief
 *   a2t3_schedule_shown       (bot speaks, shows timetable card)
 *   a2t3_dialogue             (repeating — each student turn triggers a bot scheduling reply)
 *   complete
 */

const { presignS3Url } = require('../config/presign');
const { scoreTurn } = require('./sprechenEvaluatorService');
const { resolveModuleRubric } = require('./sprechenRubricDefaults');
const {
  a2AnswerQuestionCard,
  a2AskQuestionCard,
  a2ScheduleDialogue,
} = require('./sprechenInterlocutorService');

const A2_MAX_TEIL3_TURNS = 8;

function botMsg(role, text, extras = {}) {
  return {
    role,
    text,
    phase: extras.phase,
    captionEn: extras.captionEn || '',
    captionTa: extras.captionTa || '',
  };
}

async function presignCard(card) {
  if (!card || !card.imageUrl) return card;
  const signed = await presignS3Url(card.imageUrl);
  if (signed) return { ...card, imageUrl: signed };
  return card;
}

// ─── Phase sequence builder ───────────────────────────────────────────────────

function buildPhaseSequence(mod) {
  const cards = (mod.a2Teil1 && mod.a2Teil1.cards) || [];
  const monologueCards = (mod.a2Teil2 && mod.a2Teil2.cards) || [];
  const phases = [];

  // ── Welcome ──────────────────────────────────────────────────────────────
  phases.push({
    id: 'welcome',
    role: 'moderator',
    teil: 0,
    card: null,
    getData: async () => ({
      botSpeech:
        'Herzlich willkommen zu Ihrer Goethe A2 Sprechprüfung. ' +
        'Die Prüfung besteht aus drei Teilen. ' +
        'Sind Sie bereit? Sagen Sie bitte „Ja, ich bin bereit.", wenn Sie anfangen möchten.',
      captionEn:
        'Welcome to your Goethe A2 speaking exam. The exam has three parts. ' +
        'Are you ready? Please say "Yes, I am ready" when you want to begin.',
      card: null,
    }),
  });

  // ── Teil 1: Question-card dialogue ────────────────────────────────────────
  const t1Instruction =
    (mod.a2Teil1 && mod.a2Teil1.instructionDe) ||
    'Sie bekommen vier Karten und stellen mit diesen Karten vier Fragen. ' +
    'Ihr Partner/Ihre Partnerin antwortet. Dann stellt Ihr Partner/Ihre Partnerin vier Fragen und Sie antworten.';

  phases.push({
    id: 'a2t1_brief',
    role: 'moderator',
    teil: 1,
    card: null,
    getData: async () => ({
      botSpeech: `Wir beginnen mit Teil eins. ${t1Instruction}`,
      captionEn: 'We begin with Part 1. You will get cards and ask questions. Then your partner asks you.',
      card: null,
    }),
  });

  for (let ci = 0; ci < cards.length; ci++) {
    const card = cards[ci];
    const questionCard = {
      type: 'a2_question',
      content: card.prompt || '',
      imageUrl: card.imageUrl || '',
      sublabel: card.sublabel || 'Fragen zur Person',
    };

    // Student asks
    phases.push({
      id: `a2t1_card${ci}_student_ask`,
      role: 'student',
      teil: 1,
      card: questionCard,
      turnType: 'a2t1_student_ask',
      evalTeil: 'teil1',
      instruction: `Stellen Sie mir bitte eine Frage zum Thema auf der Karte.`,
      instructionEn: 'Please ask me a question about the topic on the card.',
      botAnswers: true,
      cardIndex: ci,
    });

    // Bot asks (interlocutor generates question from same card prompt)
    phases.push({
      id: `a2t1_card${ci}_bot_ask`,
      role: 'interlocutor',
      teil: 1,
      card: questionCard,
      getData: async () => {
        const c = (mod.a2Teil1.cards || [])[ci] || {};
        const speech = await a2AskQuestionCard(c.prompt || '');
        return {
          botSpeech: speech,
          card: questionCard,
        };
      },
      cardIndex: ci,
    });

    // Student answers
    phases.push({
      id: `a2t1_card${ci}_student_answer`,
      role: 'student',
      teil: 1,
      card: questionCard,
      turnType: 'a2t1_student_answer',
      evalTeil: 'teil1',
      instruction: 'Bitte antworten Sie auf meine Frage.',
      instructionEn: 'Please answer my question.',
      cardIndex: ci,
    });
  }

  phases.push({
    id: 'a2t1_close',
    role: 'moderator',
    teil: 1,
    card: null,
    getData: async () => ({
      botSpeech: 'Danke. Teil eins ist beendet. Wir machen jetzt weiter mit Teil zwei.',
      captionEn: 'Thank you. Part 1 is finished. We continue with Part 2.',
      card: null,
    }),
  });

  // ── Teil 2: Monologue ─────────────────────────────────────────────────────
  const t2Instruction =
    (mod.a2Teil2 && mod.a2Teil2.instructionDe) ||
    'Sie bekommen eine Karte und erzählen etwas über Ihr Leben.';

  phases.push({
    id: 'a2t2_brief',
    role: 'moderator',
    teil: 2,
    card: null,
    getData: async () => ({
      botSpeech: `Jetzt kommen wir zu Teil zwei. ${t2Instruction} Wenn Sie fertig sind, klicken Sie auf „Fertig".`,
      captionEn: 'Now we move to Part 2. You get a card and talk about your life. Click "Fertig" when done.',
      card: null,
    }),
  });

  for (let mi = 0; mi < monologueCards.length; mi++) {
    const mc = monologueCards[mi];
    const monologueCard = {
      type: 'a2_monologue',
      content: mc.title || '',
      imageUrl: mc.imageUrl || '',
      subPrompts: mc.subPrompts || [],
    };

    phases.push({
      id: `a2t2_card${mi}_monologue`,
      role: 'student',
      teil: 2,
      card: monologueCard,
      turnType: 'a2t2_monologue',
      evalTeil: 'teil2',
      instruction: mc.title || '',
      instructionEn: '',
      monologueMode: true,
      cardIndex: mi,
    });
  }

  phases.push({
    id: 'a2t2_close',
    role: 'moderator',
    teil: 2,
    card: null,
    getData: async () => ({
      botSpeech: 'Danke. Teil zwei ist beendet. Wir machen jetzt weiter mit Teil drei.',
      captionEn: 'Thank you. Part 2 is finished. We continue with Part 3.',
      card: null,
    }),
  });

  // ── Teil 3: Timetable scheduling dialogue ─────────────────────────────────
  const scenario = (mod.a2Teil3 && mod.a2Teil3.scenarioDe) || '';
  const dateLabel = (mod.a2Teil3 && mod.a2Teil3.dateLabel) || '';
  const studentTimetable = (mod.a2Teil3 && mod.a2Teil3.studentTimetable) || {};
  const timetableCard = {
    type: 'a2_timetable',
    content: scenario,
    imageUrl: studentTimetable.imageUrl || '',
    dateLabel,
    slots: studentTimetable.slots || [],
  };

  phases.push({
    id: 'a2t3_brief',
    role: 'moderator',
    teil: 3,
    card: null,
    getData: async () => ({
      botSpeech: `Jetzt kommen wir zu Teil drei. ${scenario} Ich zeige Ihnen jetzt Ihren Terminkalender.`,
      captionEn: `Now Part 3. ${scenario} I will show you your timetable.`,
      card: null,
    }),
  });

  phases.push({
    id: 'a2t3_schedule_shown',
    role: 'moderator',
    teil: 3,
    card: timetableCard,
    getData: async () => ({
      botSpeech:
        `Hier ist Ihr Terminkalender für ${dateLabel || 'diesen Tag'}. ` +
        'Schauen Sie sich Ihren Kalender an und schlagen Sie mir bitte eine freie Zeit vor.',
      captionEn: `Here is your timetable for ${dateLabel || 'this day'}. Look at your schedule and suggest a free time.`,
      card: timetableCard,
    }),
  });

  // Single repeating dialogue phase — engine re-uses this phase id for all turns
  phases.push({
    id: 'a2t3_dialogue',
    role: 'student',
    teil: 3,
    card: timetableCard,
    turnType: 'a2t3_dialogue',
    evalTeil: 'teil3',
    instruction: 'Schlagen Sie bitte eine freie Zeit vor oder antworten Sie auf meinen Vorschlag.',
    instructionEn: 'Please suggest a free time or respond to my proposal.',
    monologueMode: false,
    schedulingDialogue: true,
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

// ─── Phase helpers ────────────────────────────────────────────────────────────

function findPhaseIndex(phases, phaseId) {
  return phases.findIndex((p) => p.id === phaseId);
}

function isStudentPhase(phase) {
  return phase.role === 'student';
}

function isBotPhase(phase) {
  return phase.role === 'moderator' || phase.role === 'interlocutor';
}

function getCard(phaseDef) {
  if (!phaseDef.card) return null;
  if (typeof phaseDef.card === 'function') return phaseDef.card();
  return phaseDef.card;
}

// ─── Dual‑examiner score compilation (A2, 23‑pt scale) ────────────────────────

function _sumA2ExaminerScores(turns, rubric, examinerId) {
  let t1 = 0, t2 = 0, t3 = 0;
  const pronScores = [];
  const cap1 = rubric?.teil1?.maxPoints ?? 6;
  const cap2 = rubric?.teil2?.maxPoints ?? 6;
  const cap3 = rubric?.teil3?.maxPoints ?? 6;

  for (const turn of turns) {
    if (turn.role !== 'student') continue;
    const ev = (turn.evaluations || []).find(e => e.examinerId === examinerId);
    const eval_ = turn.tutorOverride
      ? { points: turn.tutorOverride.points }
      : ev;
    if (!eval_) continue;
    const pts = typeof eval_.points === 'number' ? eval_.points : 0;
    if (turn.teil === 1) t1 += pts;
    else if (turn.teil === 2) t2 += pts;
    else if (turn.teil === 3) t3 += pts;

    // Collect global pronunciation scores across all turns
    if (ev && ev.criteria) {
      const pron = ev.criteria.find(c => c.id === 'a2_pronunciation');
      if (pron && pron.pointsAwarded !== undefined) {
        pronScores.push(pron.pointsAwarded);
      }
    }
  }

  // Average pronunciation across all turns that reported it
  const pronunciation = pronScores.length > 0
    ? pronScores.reduce((a, b) => a + b, 0) / pronScores.length
    : 0;

  return {
    teil1: Math.min(t1, cap1),
    teil2: Math.min(t2, cap2),
    teil3: Math.min(t3, cap3),
    pronunciation,
  };
}

function compileTeilScores(turns, rubric, passThreshold) {
  // Gather unique examiner IDs
  const ids = new Set();
  for (const turn of turns) {
    for (const ev of (turn.evaluations || [])) {
      if (ev.examinerId) ids.add(ev.examinerId);
    }
  }
  if (ids.size === 0) ids.add(1);

  const eScores = [];
  for (const eId of ids) {
    const s = _sumA2ExaminerScores(turns, rubric, eId);
    const total = s.teil1 + s.teil2 + s.teil3 + s.pronunciation;
    eScores.push({
      examinerId: eId,
      teil1: Math.round(s.teil1 * 10) / 10,
      teil2: Math.round(s.teil2 * 10) / 10,
      teil3: Math.round(s.teil3 * 10) / 10,
      pronunciation: Math.round(s.pronunciation * 10) / 10,
      total: Math.round(total * 10) / 10,
    });
  }

  // Arithmetic mean → round to nearest 0.5 (A2 spec)
  const mean = (key) => {
    const vals = eScores.map(e => e[key] || 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.round(avg * 2) / 2;
  };

  const final = {
    teil1: mean('teil1'),
    teil2: mean('teil2'),
    teil3: mean('teil3'),
    pronunciation: mean('pronunciation'),
    total: mean('total'),
  };
  final.passed = final.total >= (passThreshold || 14);

  return { examinerScores: eScores, finalScores: final };
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function initSession(session, module) {
  const phases = buildPhaseSequence(module);
  const first = phases[0]; // 'welcome'
  const welcomeData = await first.getData(module, session);

  session.state.phase = first.id;
  session.state.awaitingStudent = false;
  session.state.teilNumber = 0;
  session.state.cardType = '';
  session.state.cardContent = '';
  session.state.cardImageUrl = '';

  session.turns.push({
    teil: 0,
    turnNumber: session.turns.length,
    phase: first.id,
    role: 'bot',
    card: null,
    transcript: '',
    durationMs: null,
    evaluation: null,
    botSpeech: welcomeData.botSpeech,
    at: new Date(),
  });

  await session.save();
  return {
    botMessages: [botMsg('bot', welcomeData.botSpeech, { phase: first.id, captionEn: welcomeData.captionEn || '' })],
    card: null,
    phase: first.id,
    awaitingStudent: false,
    done: false,
  };
}

async function advanceReady(session, module) {
  if (session.state.phase !== 'welcome') {
    return _getCurrentState(session);
  }
  const phases = buildPhaseSequence(module);
  const nextIdx = findPhaseIndex(phases, 'welcome') + 1;
  return _runFromIndex(session, module, phases, nextIdx, []);
}

async function processTurn(session, module, transcript, durationMs, action) {
  const phases = buildPhaseSequence(module);
  const currentPhaseId = session.state.phase;

  // ── Teil 3 scheduling dialogue (repeating phase) ──────────────────────────
  if (currentPhaseId === 'a2t3_dialogue') {
    return _processSchedulingTurn(session, module, phases, transcript, durationMs);
  }

  const currentIdx = findPhaseIndex(phases, currentPhaseId);
  if (currentIdx < 0) throw new Error(`Unknown phase: ${currentPhaseId}`);

  const currentPhaseDef = phases[currentIdx];
  if (!isStudentPhase(currentPhaseDef)) {
    throw new Error(`Phase ${currentPhaseId} is not a student phase`);
  }

  // ── Record student turn ───────────────────────────────────────────────────
  const card = getCard(currentPhaseDef);
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
    evaluations: [],
    botSpeech: '',
    at: new Date(),
  });

  // ── Score with dual examiners ─────────────────────────────────────────────
  const rubric = resolveModuleRubric(module);
  const rubricTeil = rubric && rubric[currentPhaseDef.evalTeil];
  const criteria = (rubricTeil && rubricTeil.criteria) || [];

  const [eval1, eval2] = await Promise.all([
    scoreTurn({ teil: currentPhaseDef.teil, turnType: currentPhaseDef.turnType, transcript, card, criteria, examFormat: 'A2', examinerId: 1 }),
    scoreTurn({ teil: currentPhaseDef.teil, turnType: currentPhaseDef.turnType, transcript, card, criteria, examFormat: 'A2', examinerId: 2 }),
  ]);

  const lastIdx = session.turns.length - 1;
  session.turns[lastIdx].evaluation = eval1;
  session.turns[lastIdx].evaluations = [eval1, eval2];

  // ── A2 Teil 1: bot answers student question inline ────────────────────────
  const inlineBotMessages = [];

  if (currentPhaseDef.botAnswers && currentPhaseDef.turnType === 'a2t1_student_ask') {
    const c = (module.a2Teil1.cards || [])[currentPhaseDef.cardIndex] || {};
    const inlineSpeech = await a2AnswerQuestionCard(c.prompt || '', transcript);
    if (inlineSpeech) {
      session.turns.push({
        teil: currentPhaseDef.teil,
        turnNumber: session.turns.length,
        phase: currentPhaseId,
        role: 'bot',
        card: null,
        transcript: '',
        durationMs: null,
        evaluation: null,
        evaluations: [],
        botSpeech: inlineSpeech,
        at: new Date(),
      });
      inlineBotMessages.push(botMsg('bot', inlineSpeech, { phase: currentPhaseId }));
    }
  }

  return _runFromIndex(session, module, phases, currentIdx + 1, inlineBotMessages);
}

async function _processSchedulingTurn(session, module, phases, transcript, durationMs) {
  const phaseDef = phases.find((p) => p.id === 'a2t3_dialogue');
  const card = getCard(phaseDef);

  // Count how many student scheduling turns have already happened
  const prevTurns = session.turns.filter(
    (t) => t.role === 'student' && t.phase === 'a2t3_dialogue'
  );
  const turnIndex = prevTurns.length;

  // Record student turn
  session.turns.push({
    teil: 3,
    turnNumber: session.turns.length,
    phase: 'a2t3_dialogue',
    role: 'student',
    card: card || null,
    transcript: transcript || '',
    durationMs: durationMs || null,
    evaluation: null,
    evaluations: [],
    botSpeech: '',
    at: new Date(),
  });

  // Score with dual examiners
  const rubric = resolveModuleRubric(module);
  const criteria = ((rubric && rubric.teil3) || {}).criteria || [];
  const [eval1, eval2] = await Promise.all([
    scoreTurn({ teil: 3, turnType: 'a2t3_dialogue', transcript, card, criteria, examFormat: 'A2', examinerId: 1 }),
    scoreTurn({ teil: 3, turnType: 'a2t3_dialogue', transcript, card, criteria, examFormat: 'A2', examinerId: 2 }),
  ]);

  const lastIdx = session.turns.length - 1;
  session.turns[lastIdx].evaluation = eval1;
  session.turns[lastIdx].evaluations = [eval1, eval2];

  // Build chat history for bot
  const chatHistory = session.turns
    .filter((t) => t.phase === 'a2t3_dialogue' || t.phase === 'a2t3_schedule_shown')
    .slice(-12)
    .map((t) => ({ role: t.role === 'student' ? 'student' : 'bot', text: t.transcript || t.botSpeech }))
    .filter((m) => m.text);

  const botSlots = (module.a2Teil3 && module.a2Teil3.botTimetable && module.a2Teil3.botTimetable.slots) || [];
  const { speech: botSpeech, agreed } = await a2ScheduleDialogue({
    scenario: (module.a2Teil3 && module.a2Teil3.scenarioDe) || '',
    dateLabel: (module.a2Teil3 && module.a2Teil3.dateLabel) || '',
    botSlots,
    chatHistory,
    studentMessage: transcript,
    turnIndex,
  });

  if (botSpeech) {
    session.turns.push({
      teil: 3,
      turnNumber: session.turns.length,
      phase: 'a2t3_dialogue',
      role: 'bot',
      card: null,
      transcript: '',
      durationMs: null,
      evaluation: null,
      botSpeech,
      at: new Date(),
    });
  }

  const botMessages = [];
  if (botSpeech) {
    botMessages.push(botMsg('bot', botSpeech, { phase: 'a2t3_dialogue' }));
  }

  const reachedMax = turnIndex + 1 >= A2_MAX_TEIL3_TURNS;

  if (agreed || reachedMax) {
    // Advance to complete
    if (!agreed && reachedMax) {
      const closeSpeech = 'Gut, dann machen wir das so. Vielen Dank!';
      session.turns.push({
        teil: 3,
        turnNumber: session.turns.length,
        phase: 'a2t3_dialogue',
        role: 'bot',
        card: null,
        transcript: '',
        durationMs: null,
        evaluation: null,
        botSpeech: closeSpeech,
        at: new Date(),
      });
      botMessages.push(botMsg('bot', closeSpeech, { phase: 'a2t3_dialogue' }));
    }

    session.state.phase = 'complete';
    session.state.awaitingStudent = false;
    await session.save();
    return { botMessages, card: null, phase: 'complete', awaitingStudent: false, done: true };
  }

  // Stay on a2t3_dialogue, await next student turn
  session.state.phase = 'a2t3_dialogue';
  session.state.awaitingStudent = true;
  if (card) {
    session.state.cardType = card.type || '';
    session.state.cardContent = card.content || '';
    session.state.cardImageUrl = card.imageUrl || '';
  }

  const signedCard = await presignCard(card);
  await session.save();

  return {
    botMessages,
    card: signedCard,
    phase: 'a2t3_dialogue',
    awaitingStudent: true,
    done: false,
  };
}

/**
 * Run bot-only phases from startIdx until the next student phase or 'complete'.
 */
async function _runFromIndex(session, module, phases, startIdx, prependMessages) {
  const botMessages = [...(prependMessages || [])];
  let finalCard = null;

  for (let i = startIdx; i < phases.length; i++) {
    const phaseDef = phases[i];

    if (phaseDef.id === 'complete') {
      session.state.phase = 'complete';
      session.state.awaitingStudent = false;
      await session.save();
      return { botMessages, card: null, phase: 'complete', awaitingStudent: false, done: true };
    }

    if (phaseDef.teil > 0 && phaseDef.teil !== session.state.teilNumber) {
      session.state.teilNumber = phaseDef.teil;
      session.state.teilStartedAt = new Date();
    }

    if (isBotPhase(phaseDef)) {
      const phaseData = await phaseDef.getData(module, session);
      const botSpeech = phaseData.botSpeech;
      const cardSpec = phaseData.card || getCard(phaseDef);
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
      if (cardSpec) finalCard = cardSpec;

      session.state.phase = phaseDef.id;
      session.state.awaitingStudent = false;
      if (cardSpec) {
        session.state.cardType = cardSpec.type || '';
        session.state.cardContent = cardSpec.content || '';
        session.state.cardImageUrl = cardSpec.imageUrl || '';
      }
      continue;
    }

    // Student phase
    const studentCard = getCard(phaseDef);

    session.state.phase = phaseDef.id;
    session.state.awaitingStudent = true;
    if (studentCard) {
      session.state.cardType = studentCard.type || '';
      session.state.cardContent = studentCard.content || '';
      session.state.cardImageUrl = studentCard.imageUrl || '';
      finalCard = studentCard;
    } else {
      session.state.cardType = '';
      session.state.cardContent = '';
      session.state.cardImageUrl = '';
    }

    if (phaseDef.instruction) {
      botMessages.push(
        botMsg('moderator', phaseDef.instruction, {
          phase: phaseDef.id,
          captionEn: phaseDef.instructionEn || '',
        }),
      );
    }

    const signedCard = await presignCard(finalCard);
    await session.save();

    return {
      botMessages,
      card: signedCard,
      phase: phaseDef.id,
      awaitingStudent: true,
      done: false,
      monologueMode: !!phaseDef.monologueMode,
    };
  }

  session.state.phase = 'complete';
  session.state.awaitingStudent = false;
  await session.save();
  return { botMessages, card: null, phase: 'complete', awaitingStudent: false, done: true };
}

function _getCurrentState(session) {
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
  };
}

async function completeSession(session, module) {
  const rubric = resolveModuleRubric(module);
  const { examinerScores, finalScores } = compileTeilScores(
    session.turns, rubric, module.passThreshold
  );
  session.scores = finalScores;
  session.examinerScores = examinerScores;
  session.finalScores = finalScores;
  session.completed = true;
  session.completedAt = new Date();
  session.state.phase = 'complete';
  session.state.awaitingStudent = false;
  await session.save();
  return finalScores;
}

module.exports = {
  buildPhaseSequence,
  initSession,
  advanceReady,
  processTurn,
  completeSession,
  compileTeilScores,
};
