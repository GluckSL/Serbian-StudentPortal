'use strict';

/**
 * Sprechen exam scoring test suite.
 *
 * Run:  node test/sprechen-scoring.test.js
 *
 * Tests both A1 and A2 scoring logic without needing a running server.
 * Uses examinerId=2 (heuristic) so no OpenAI API key is required.
 */

const { scoreTurn } = require('../services/sprechenEvaluatorService');
const a1Engine = require('../services/sprechenExamEngine');
const a2Engine = require('../services/sprechenA2ExamEngine');
const { resolveModuleRubric } = require('../services/sprechenRubricDefaults');
const { DEFAULT_A2_RUBRIC } = require('../services/sprechen-a2-rubric-defaults');
const placeholderContent = require('../content/sprechen-a1-placeholder.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

function assertNear(actual, expected, tolerance, label) {
  const ok = Math.abs(actual - expected) <= (tolerance || 0.01);
  if (ok) {
    passed++;
    console.log(`  ✅ ${label} (got ${actual})`);
  } else {
    failed++;
    console.error(`  ❌ ${label} — expected ${expected}, got ${actual}`);
  }
}

// ─── A1 Heuristic Tests ───────────────────────────────────────────────────────

async function testA1HeuristicScoring() {
  console.log('\n━━━ A1 — Heuristic (examiner 2) scoring ━━━');

  // t1_content: full points for 5+ topics
  let r = await scoreTurn({
    teil: 1, turnType: 'teil1_card',
    transcript: 'Mein Name ist John. Mein Alter ist 25. Mein Land ist Deutschland. Mein Wohnort ist Berlin. Ich lerne Sprachen. Mein Beruf ist Student. Mein Hobby ist Fußball.',
    criteria: [{ id: 't1_content', label: 'Introduces all topics', points: 1, prompt: '', turnType: 'teil1_card' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.points === 1, 't1_content full = 1pt');

  r = await scoreTurn({
    teil: 1, turnType: 'teil1_card',
    transcript: '',
    criteria: [{ id: 't1_content', label: 'Introduces all topics', points: 1, prompt: '', turnType: 'teil1_card' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.points === 0, 't1_content empty = 0pt');

  // t1_spell
  r = await scoreTurn({
    teil: 1, turnType: 'teil1_spell',
    transcript: 's o u r a v',
    criteria: [{ id: 't1_spell', label: 'Spells correctly', points: 1, prompt: '', turnType: 'teil1_spell' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.criteria[0].level === 'full', 'teil1_spell level = full');
  assert(r.points === 1, 'teil1_spell full = 1pt');

  // t1_number
  r = await scoreTurn({
    teil: 1, turnType: 'teil1_number',
    transcript: 'eins zwei drei vier',
    criteria: [{ id: 't1_number', label: 'Produces number correctly', points: 1, prompt: '', turnType: 'teil1_number' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.criteria[0].level === 'full', 't1_number level = full');

  // t2_question: full
  r = await scoreTurn({
    teil: 2, turnType: 'teil2_student_ask',
    transcript: 'Was ist dein Hobby?',
    criteria: [{ id: 't2_question', label: 'Forms a question', points: 2, prompt: '', turnType: 'teil2_student_ask' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.criteria[0].level === 'full', 't2_question level = full');
  assert(r.points === 2, 't2_question full = 2pt');

  // t2_question: partial
  r = await scoreTurn({
    teil: 2, turnType: 'teil2_student_ask',
    transcript: 'erzähl mir dein Hobby',
    criteria: [{ id: 't2_question', label: 'Forms a question', points: 2, prompt: '', turnType: 'teil2_student_ask' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.criteria[0].level === 'partial', 't2_question level = partial');
  assert(r.points === 1, 't2_question partial = 1pt');

  // t2_question: zero
  r = await scoreTurn({
    teil: 2, turnType: 'teil2_student_ask',
    transcript: '',
    criteria: [{ id: 't2_question', label: 'Forms a question', points: 2, prompt: '', turnType: 'teil2_student_ask' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.points === 0, 't2_question empty = 0pt');

  // t2_answer: full
  r = await scoreTurn({
    teil: 2, turnType: 'teil2_student_answer',
    transcript: 'Ich mag Fußball.',
    criteria: [{ id: 't2_answer', label: 'Answers the question', points: 1, prompt: '', turnType: 'teil2_student_answer' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.criteria[0].level === 'full', 't2_answer level = full');
  assert(r.points === 1, 't2_answer full = 1pt');

  // t3_request: full
  r = await scoreTurn({
    teil: 3, turnType: 'teil3_student_request',
    transcript: 'Können Sie mir bitte einen Stift geben?',
    criteria: [{ id: 't3_request', label: 'Makes polite request', points: 2, prompt: '', turnType: 'teil3_student_request' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.criteria[0].level === 'full', 't3_request level = full');
  assert(r.points === 2, 't3_request full = 2pt');

  // t3_request: partial
  r = await scoreTurn({
    teil: 3, turnType: 'teil3_student_request',
    transcript: 'Gib mir Stift',
    criteria: [{ id: 't3_request', label: 'Makes polite request', points: 2, prompt: '', turnType: 'teil3_student_request' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.criteria[0].level === 'partial', 't3_request level = partial');
  assert(r.points === 1, 't3_request partial = 1pt');

  // t3_response: full
  r = await scoreTurn({
    teil: 3, turnType: 'teil3_student_response',
    transcript: 'Ja, natürlich, hier bitte.',
    criteria: [{ id: 't3_response', label: 'Responds to request', points: 1, prompt: '', turnType: 'teil3_student_response' }],
    examFormat: 'A1', examinerId: 2,
  });
  assert(r.criteria[0].level === 'full', 't3_response level = full');
  assert(r.points === 1, 't3_response full = 1pt');

  // Wrong task type tag
  r = await scoreTurn({
    teil: 3, turnType: 'teil3_student_request',
    transcript: 'gib mir einen Stift',
    criteria: [{ id: 't3_request', label: 'Makes polite request', points: 2, prompt: '', turnType: 'teil3_student_request' }],
    examFormat: 'A1', examinerId: 2,
  });
  const tags = r.criteria[0].issueTags || [];
  assert(tags.includes('Wrong task type'), 'Wrong task type tag present for non-request');
}

// ─── A2 Heuristic Tests ───────────────────────────────────────────────────────

async function testA2HeuristicScoring() {
  console.log('\n━━━ A2 — Heuristic (examiner 2) scoring ━━━');

  // a2t1_aufgabe: A-level
  let r = await scoreTurn({
    teil: 1, turnType: 'a2t1_student_ask',
    transcript: 'Wann bist du gestern aufgestanden?',
    criteria: DEFAULT_A2_RUBRIC.teil1.criteria,
    examFormat: 'A2', examinerId: 2,
  });
  let aufg = r.criteria.find(c => c.id === 'a2t1_aufgabe');
  assert(aufg.level === 'A', 'a2t1_aufgabe level = A for question with W-word + 5+ words');
  assertNear(aufg.pointsAwarded, 4, 0.01, 'a2t1_aufgabe points = 4');

  // a2t1_aufgabe: D-level for minimal
  r = await scoreTurn({
    teil: 1, turnType: 'a2t1_student_answer',
    transcript: 'ja',
    criteria: DEFAULT_A2_RUBRIC.teil1.criteria,
    examFormat: 'A2', examinerId: 2,
  });
  aufg = r.criteria.find(c => c.id === 'a2t1_aufgabe');
  assert(aufg.level === 'D', 'a2t1_aufgabe level = D for minimal response');
  assertNear(aufg.pointsAwarded, 1, 0.01, 'a2t1_aufgabe points = 1');

  // a2t2_monologue: A-level for 30+ words
  r = await scoreTurn({
    teil: 2, turnType: 'a2t2_monologue',
    transcript: 'I like sports very much. I play football every weekend with my friends. We also go swimming sometimes. My favourite sport is tennis. I watch tennis on TV. I like reading books and watching movies. Cooking is fun too. I cook pasta and pizza.',
    criteria: DEFAULT_A2_RUBRIC.teil2.criteria,
    examFormat: 'A2', examinerId: 2,
  });
  aufg = r.criteria.find(c => c.id === 'a2t2_aufgabe');
  assert(aufg.level === 'A', 'a2t2_aufgabe level = A for long monologue');

  // a2t3_dialogue: A-level for time + question
  r = await scoreTurn({
    teil: 3, turnType: 'a2t3_dialogue',
    transcript: 'Um 14 Uhr am Nachmittag? Passt das für Sie gut?',
    criteria: DEFAULT_A2_RUBRIC.teil3.criteria,
    examFormat: 'A2', examinerId: 2,
  });
  aufg = r.criteria.find(c => c.id === 'a2t3_aufgabe');
  assert(aufg.level === 'A', 'a2t3_aufgabe level = A for time+question');

  // a2t3_dialogue: C-level for time only
  r = await scoreTurn({
    teil: 3, turnType: 'a2t3_dialogue',
    transcript: 'Um 14 Uhr.',
    criteria: DEFAULT_A2_RUBRIC.teil3.criteria,
    examFormat: 'A2', examinerId: 2,
  });
  aufg = r.criteria.find(c => c.id === 'a2t3_aufgabe');
  assert(aufg.level === 'C' || aufg.level === 'B', 'a2t3_aufgabe level = C/B for time only');
}

// ─── A1 Score Compilation Tests ──────────────────────────────────────────────

function testA1Compilation() {
  console.log('\n━━━ A1 — Score compilation (dual-examiner) ━━━');

  const rubric = {
    teil1: { maxPoints: 3, criteria: [] },
    teil2: { maxPoints: 6, criteria: [] },
    teil3: { maxPoints: 6, criteria: [] },
  };

  const turns = [
    { teil: 1, role: 'student', evaluations: [{ examinerId: 1, points: 3 }, { examinerId: 2, points: 2 }] },
    { teil: 2, role: 'student', evaluations: [{ examinerId: 1, points: 5 }, { examinerId: 2, points: 4 }] },
    { teil: 3, role: 'student', evaluations: [{ examinerId: 1, points: 4 }, { examinerId: 2, points: 3 }] },
  ];
  const r = a1Engine.compileTeilScores(turns, rubric, 9, 'A1');
  assert(r.examinerScores.length === 2, 'two examiner scores');
  assert(r.finalScores.teil1 === 3, 'teil1 avg = 3');
  assert(r.finalScores.teil2 === 5, 'teil2 avg = 5');
  assert(r.finalScores.teil3 === 4, 'teil3 avg = 4');
  assert(r.finalScores.total === 11, 'total avg = 11 (mean of 12+9)');
  assert(r.finalScores.passed === true, 'passed = true');

  // Pass threshold
  const passing = a1Engine.compileTeilScores(
    Array(3).fill(0).map((_, i) => ({
      teil: i + 1, role: 'student',
      evaluations: [{ examinerId: 1, points: 3 }, { examinerId: 2, points: 3 }],
    })), rubric, 9, 'A1'
  );
  assert(passing.finalScores.passed === true, '9/15 = passing');

  const failing = a1Engine.compileTeilScores(
    [{ teil: 1, role: 'student', evaluations: [{ examinerId: 1, points: 1 }, { examinerId: 2, points: 1 }] },
     { teil: 2, role: 'student', evaluations: [{ examinerId: 1, points: 3 }, { examinerId: 2, points: 3 }] },
     { teil: 3, role: 'student', evaluations: [{ examinerId: 1, points: 3 }, { examinerId: 2, points: 3 }] }],
    rubric, 9, 'A1'
  );
  assert(failing.finalScores.passed === false, '7/15 = failing');

  // Caps
  const capped = a1Engine.compileTeilScores(
    [{ teil: 1, role: 'student', evaluations: [{ examinerId: 1, points: 99 }, { examinerId: 2, points: 99 }] },
     { teil: 2, role: 'student', evaluations: [{ examinerId: 1, points: 99 }, { examinerId: 2, points: 99 }] },
     { teil: 3, role: 'student', evaluations: [{ examinerId: 1, points: 99 }, { examinerId: 2, points: 99 }] }],
    rubric, 9, 'A1'
  );
  assert(capped.finalScores.teil1 === 3, 'teil1 capped at 3');
  assert(capped.finalScores.teil2 === 6, 'teil2 capped at 6');
  assert(capped.finalScores.teil3 === 6, 'teil3 capped at 6');
}

// ─── A2 Score Compilation Tests ──────────────────────────────────────────────

function testA2Compilation() {
  console.log('\n━━━ A2 — Score compilation (dual-examiner, 23pt scale) ━━━');

  const rubric = {
    teil1: { maxPoints: 6, criteria: [] },
    teil2: { maxPoints: 6, criteria: [] },
    teil3: { maxPoints: 6, criteria: [] },
  };

  // Averaging
  const r = a2Engine.compileTeilScores([
    { teil: 1, role: 'student', evaluations: [{ examinerId: 1, points: 5, criteria: [] }, { examinerId: 2, points: 3, criteria: [] }] },
    { teil: 2, role: 'student', evaluations: [{ examinerId: 1, points: 4.5, criteria: [] }, { examinerId: 2, points: 3.5, criteria: [] }] },
    { teil: 3, role: 'student', evaluations: [{ examinerId: 1, points: 3.5, criteria: [{ id: 'a2_pronunciation', pointsAwarded: 4 }] }, { examinerId: 2, points: 2.5, criteria: [{ id: 'a2_pronunciation', pointsAwarded: 3 }] }] },
  ], rubric, 14);
  assert(r.finalScores.teil1 === 4, 'teil1 avg = (5+3)/2 = 4');
  assert(r.finalScores.teil2 === 4, 'teil2 avg = (4.5+3.5)/2 = 4');
  assert(r.finalScores.teil3 === 3, 'teil3 avg = (3.5+2.5)/2 = 3');
  assertNear(r.finalScores.pronunciation, 3.5, 0.01, 'pronunciation avg = (4+3)/2 = 3.5');

  // Pass threshold
  const passing = a2Engine.compileTeilScores([
    { teil: 1, role: 'student', evaluations: [{ examinerId: 1, points: 5, criteria: [] }, { examinerId: 2, points: 5, criteria: [] }] },
    { teil: 2, role: 'student', evaluations: [{ examinerId: 1, points: 5, criteria: [] }, { examinerId: 2, points: 5, criteria: [] }] },
    { teil: 3, role: 'student', evaluations: [{ examinerId: 1, points: 4, criteria: [{ id: 'a2_pronunciation', pointsAwarded: 4 }] }, { examinerId: 2, points: 4, criteria: [{ id: 'a2_pronunciation', pointsAwarded: 4 }] }] },
  ], rubric, 14);
  assert(passing.finalScores.passed === true, '14+ = passing');

  // Pronunciation averaging
  const pron = a2Engine.compileTeilScores([
    { teil: 1, role: 'student', evaluations: [{ examinerId: 1, points: 4, criteria: [{ id: 'a2_pronunciation', pointsAwarded: 5 }] }] },
    { teil: 2, role: 'student', evaluations: [{ examinerId: 1, points: 4, criteria: [{ id: 'a2_pronunciation', pointsAwarded: 3 }] }] },
    { teil: 3, role: 'student', evaluations: [{ examinerId: 1, points: 4, criteria: [{ id: 'a2_pronunciation', pointsAwarded: 4 }] }] },
  ], rubric, 14);
  assertNear(pron.finalScores.pronunciation, 4, 0.01, 'pronunciation = (5+3+4)/3 = 4');
}

// ─── Rubric Content Tests ────────────────────────────────────────────────────

function testRubricContent() {
  console.log('\n━━━ Rubric content validation ━━━');

  // A1
  const a1r = placeholderContent.rubric;
  assert(a1r.teil1.maxPoints === 3, 'A1 teil1 max = 3');
  assert(a1r.teil1.criteria.length === 3, 'A1 teil1 has 3 criteria');
  assert(a1r.teil2.maxPoints === 6, 'A1 teil2 max = 6');
  assert(a1r.teil2.criteria.find(c => c.id === 't2_question').points === 2, 't2_question = 2pt');
  assert(a1r.teil2.criteria.find(c => c.id === 't2_answer').points === 1, 't2_answer = 1pt');
  assert(a1r.teil3.maxPoints === 6, 'A1 teil3 max = 6');
  assert(a1r.teil3.criteria.find(c => c.id === 't3_request').points === 2, 't3_request = 2pt');
  assert(a1r.teil3.criteria.find(c => c.id === 't3_response').points === 1, 't3_response = 1pt');
  const a1Total = a1r.teil1.maxPoints + a1r.teil2.maxPoints + a1r.teil3.maxPoints;
  assert(a1Total === 15, 'A1 total = 15');

  // A2
  const a2r = resolveModuleRubric({ examFormat: 'A2' });
  assert(a2r.teil1.maxPoints === 6, 'A2 teil1 max = 6');
  assert(a2r.teil1.criteria.length === 2, 'A2 teil1 has 2 criteria');
  assert(a2r.teil1.criteria.find(c => c.isAufgabe), 'A2 teil1 has Aufgabe');
  assert(a2r.teil2.maxPoints === 6, 'A2 teil2 max = 6');
  assert(a2r.teil2.criteria.length === 2, 'A2 teil2 has 2 criteria');
  assert(a2r.teil3.maxPoints === 6, 'A2 teil3 max = 6');
  assert(a2r.teil3.criteria.length === 2, 'A2 teil3 has 2 criteria');
  assert(a2r.global.maxPoints === 5, 'A2 global max = 5');
  assert(a2r.global.criteria[0].id === 'a2_pronunciation', 'A2 global = a2_pronunciation');
  const a2Total = a2r.teil1.maxPoints + a2r.teil2.maxPoints + a2r.teil3.maxPoints + a2r.global.maxPoints;
  assert(a2Total === 23, 'A2 total = 23');

  const c = a2r.teil1.criteria[0];
  assert(c.levelMap.A === 4, 'level A = 4');
  assert(c.levelMap.E === 0, 'level E = 0');
  assert(c.scoringMode === 'a2_level', 'scoringMode = a2_level');
}

// ─── Zero-Override Test ──────────────────────────────────────────────────────

async function testA2ZeroOverride() {
  console.log('\n━━━ A2 — Zero-override rule ━━━');

  const r = await scoreTurn({
    teil: 1, turnType: 'a2t1_student_answer',
    transcript: '',
    criteria: DEFAULT_A2_RUBRIC.teil1.criteria,
    examFormat: 'A2', examinerId: 2,
  });
  const aufgabe = r.criteria.find(c => c.id === 'a2t1_aufgabe');
  const sprache = r.criteria.find(c => c.id === 'a2t1_sprache');
  assert(aufgabe.level === 'E', 'aufgabe = E for empty response');
  assert(sprache.level === 'E', 'sprache = E via zero-override');
  assert(sprache.pointsAwarded === 0, 'sprache points = 0');
}

// ─── A1 Retry Detection Test ─────────────────────────────────────────────────

async function testA1RetryDetection() {
  console.log('\n━━━ A1 — Guided retry detection ━━━');

  // Should trigger retry (no politeness markers, not a request)
  let r = await scoreTurn({
    teil: 3, turnType: 'teil3_student_request',
    transcript: 'will einen Stift',
    criteria: [{ id: 't3_request', label: 'Makes polite request', points: 2, prompt: '', turnType: 'teil3_student_request' }],
    examFormat: 'A1', examinerId: 2,
  });
  let hasWrongTag = (r.criteria[0].issueTags || []).includes('Wrong task type');
  assert(hasWrongTag, 'Wrong task type tag for insufficient request');

  // Should NOT trigger retry (proper polite request)
  r = await scoreTurn({
    teil: 3, turnType: 'teil3_student_request',
    transcript: 'Können Sie mir bitte einen Stift geben?',
    criteria: [{ id: 't3_request', label: 'Makes polite request', points: 2, prompt: '', turnType: 'teil3_student_request' }],
    examFormat: 'A1', examinerId: 2,
  });
  hasWrongTag = (r.criteria[0].issueTags || []).includes('Wrong task type');
  assert(!hasWrongTag, 'No Wrong task type tag for proper request');
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('════════════════════════════════════════════════');
  console.log('  Sprechen Scoring Test Suite');
  console.log('════════════════════════════════════════════════');
  console.log('\n📋 All tests use heuristic examiner (no API key needed)\n');

  testRubricContent();
  testA1Compilation();
  testA2Compilation();

  await testA1HeuristicScoring();
  await testA2HeuristicScoring();
  await testA2ZeroOverride();
  await testA1RetryDetection();

  console.log('\n════════════════════════════════════════════════');
  console.log(`  Results:  ✅ ${passed} passed  ❌ ${failed} failed`);
  console.log('════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
