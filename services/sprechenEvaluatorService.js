'use strict';

const OpenAI = require('openai');

const A1_ISSUE_TAGS = [
  'Pronunciation affects understanding',
  'Syntax affects understanding',
  'Word choice affects understanding',
  'Incomplete response',
  'Wrong task type',
  'No response',
  'Unintelligible',
];

const A2_ISSUE_TAGS = [
  'Intonation affects understanding',
  'Word stress affects understanding',
  'Vocabulary range too limited',
  'Grammar errors impair understanding',
  'Interaction one-sided / no partner engagement',
  'Register inappropriate for situation',
  'Task not completed/off-topic',
  'Unintelligible',
];

function clampNumber(n, min, max) {
  if (typeof n !== 'number' || Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeText(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function wordCount(s) {
  return normalizeText(s).split(/\s+/).filter(Boolean).length;
}

function matchesTurnType(criterionTurnType, actualTurnType) {
  if (!criterionTurnType) return true;
  return criterionTurnType.split('|').some(t => t.trim() === actualTurnType);
}

// ─── A1 Heuristic (Examiner 2) ─────────────────────────────────────────────────

function heuristicA1Criteria({ turnType, transcript, criteria }) {
  const text = normalizeText(transcript);
  const wc = wordCount(transcript);
  const result = [];
  let hasContent = wc >= 3;

  for (const c of criteria) {
    let level = 'zero';
    let tags = [];

    if (!text) {
      tags.push('No response');
      result.push({ id: c.id, label: c.label, level, tags, met: false, points: 0 });
      continue;
    }

    if (matchesTurnType(c.turnType, 'teil1_card')) {
      const topics = ['name', 'alter', 'land', 'wohnort', 'sprachen', 'beruf', 'hobby'];
      const matched = topics.filter(t => text.includes(t)).length;
      if (matched >= 5) { level = 'full'; }
      else if (matched >= 3) { level = 'partial'; tags.push('Incomplete response'); }
      else { level = 'zero'; tags.push('Incomplete response'); }
    }
    else if (matchesTurnType(c.turnType, 'teil1_spell')) {
      if (/(^| )([a-zäöüß](?:[ -]+[a-zäöüß]){2,})( |$)/i.test(transcript)) level = 'full';
      else if (wc >= 2) { level = 'partial'; tags.push('Incomplete response'); }
      else level = 'zero';
    }
    else if (matchesTurnType(c.turnType, 'teil1_number')) {
      if (/\d/.test(text) || /\b(null|eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)\b/.test(text)) level = 'full';
      else if (wc >= 2) { level = 'partial'; tags.push('Incomplete response'); }
      else level = 'zero';
    }
    else if (matchesTurnType(c.turnType, 'teil2_student_ask')) {
      if (/\?/.test(transcript) || /\b(wann|was|wo|wie|warum|wer|welche|welcher|welches)\b/.test(text)) level = 'full';
      else if (wc >= 3) { level = 'partial'; tags.push('Incomplete response'); }
      else level = 'zero';
    }
    else if (matchesTurnType(c.turnType, 'teil2_student_answer')) {
      if (wc >= 3) level = 'full';
      else if (wc >= 1) { level = 'partial'; tags.push('Incomplete response'); }
      else level = 'zero';
    }
    else if (matchesTurnType(c.turnType, 'teil3_student_request')) {
      if (/\b(bitte|können sie|koennen sie|darf ich|ich möchte|ich moechte)\b/.test(text)) level = 'full';
      else if (wc >= 3) { level = 'partial'; tags.push('Wrong task type'); }
      else level = 'zero';
    }
    else if (matchesTurnType(c.turnType, 'teil3_student_response')) {
      if (wc >= 3) level = 'full';
      else if (wc >= 1) { level = 'partial'; tags.push('Incomplete response'); }
      else level = 'zero';
    }
    else {
      if (wc >= 5) level = 'full';
      else if (wc >= 2) level = 'partial';
      else level = 'zero';
    }

    if (level === 'zero' && !tags.length && !text) tags.push('No response');
    const points = level === 'full' ? c.points : (level === 'partial' ? c.points / 2 : 0);

    result.push({
      id: c.id,
      label: c.label,
      level,
      tags,
      met: level !== 'zero',
      pointsAwarded: points,
    });
  }

  return result;
}

// ─── A2 Heuristic (Examiner 2) ─────────────────────────────────────────────────

function heuristicA2Criteria({ turnType, transcript, criteria }) {
  const text = normalizeText(transcript);
  const wc = wordCount(transcript);
  const result = [];

  for (const c of criteria) {
    let level = 'E';
    let tags = [];
    const lm = c.levelMap || _defaultA2LevelMap(c.points);

    if (!text) {
      tags.push('No response');
      result.push({ id: c.id, label: c.label, level, tags, met: false, pointsAwarded: 0 });
      continue;
    }

    if (matchesTurnType(c.turnType, 'a2t1_student_ask') || matchesTurnType(c.turnType, 'a2t1_student_answer')) {
      if (c.isAufgabe) {
        const hasQ = /\?/.test(transcript) || /\b(wann|was|wo|wie|warum|wer|welche|welcher|welches)\b/.test(text);
        if (hasQ && wc >= 5) level = 'A';
        else if (hasQ && wc >= 3) level = 'B';
        else if (wc >= 3) level = 'C';
        else if (wc >= 1) { level = 'D'; tags.push('Incomplete response'); }
        else level = 'E';
      } else {
        if (wc >= 10) level = 'A';
        else if (wc >= 6) level = 'B';
        else if (wc >= 4) { level = 'C'; tags.push('Vocabulary range too limited'); }
        else if (wc >= 2) { level = 'D'; tags.push('Vocabulary range too limited'); }
        else level = 'E';
      }
    }
    else if (matchesTurnType(c.turnType, 'a2t2_monologue')) {
      if (c.isAufgabe) {
        if (wc >= 30) level = 'A';
        else if (wc >= 20) level = 'B';
        else if (wc >= 12) level = 'C';
        else if (wc >= 5) { level = 'D'; tags.push('Incomplete response'); }
        else level = 'E';
      } else {
        if (wc >= 25) level = 'A';
        else if (wc >= 15) level = 'B';
        else if (wc >= 8) { level = 'C'; tags.push('Vocabulary range too limited'); }
        else if (wc >= 4) { level = 'D'; tags.push('Vocabulary range too limited'); }
        else level = 'E';
      }
    }
    else if (matchesTurnType(c.turnType, 'a2t3_dialogue')) {
      if (c.isAufgabe) {
        const hasTime = /\d{1,2}[:\s][0-5]\d|uhr|\b(morgen|nachmittag|abend|vormittag)\b/.test(text);
        const hasQ = /\?/.test(transcript);
        if (hasTime && hasQ && wc >= 8) level = 'A';
        else if (hasTime && wc >= 5) level = 'B';
        else if (hasTime || (wc >= 5)) level = 'C';
        else if (wc >= 2) { level = 'D'; tags.push('Incomplete response'); }
        else level = 'E';
      } else {
        if (wc >= 10) level = 'A';
        else if (wc >= 6) level = 'B';
        else if (wc >= 4) { level = 'C'; tags.push('Vocabulary range too limited'); }
        else if (wc >= 2) { level = 'D'; tags.push('Grammar errors impair understanding'); }
        else level = 'E';
      }
    }
    else if (matchesTurnType(c.turnType, 'global')) {
      // Pronunciation heuristic: estimate from word count and transcript clarity
      if (wc >= 40) level = 'A';
      else if (wc >= 25) level = 'B';
      else if (wc >= 10) level = 'C';
      else if (wc >= 4) level = 'D';
      else level = 'E';
    }

    const points = lm[level] || 0;
    result.push({
      id: c.id,
      label: c.label,
      level,
      tags,
      met: level !== 'E',
      pointsAwarded: points,
    });
  }

  return result;
}

// ─── General Heuristic Entry ────────────────────────────────────────────────────

function heuristicScoreTurn({ turnType, transcript, criteria, examFormat }) {
  const applicable = (criteria || []).filter(
    (c) => matchesTurnType(c.turnType, turnType) || c.turnType === 'global'
  );
  if (!applicable.length) {
    return { points: 0, maxPoints: 0, criteria: [], modelVersion: 'heuristic-fallback' };
  }

  const maxPoints = applicable.reduce((sum, c) => sum + (c.points || 0), 0);
  const resultCriteria = examFormat === 'A2'
    ? heuristicA2Criteria({ turnType, transcript, criteria: applicable })
    : heuristicA1Criteria({ turnType, transcript, criteria: applicable });

  const points = resultCriteria.reduce((sum, r) => sum + (r.pointsAwarded || 0), 0);

  // Zero-override for A2: if any Aufgabenerfüllung is E, force paired Sprache to 0
  if (examFormat === 'A2') {
    for (const c of resultCriteria) {
      const def = applicable.find(d => d.id === c.id);
      if (def && def.isAufgabe && c.level === 'E') {
        // Find the paired Sprache criterion
        const teilPrefix = def.id.replace('_aufgabe', '');
        const sprache = resultCriteria.find(r => r.id === `${teilPrefix}_sprache`);
        if (sprache) {
          sprache.level = 'E';
          sprache.pointsAwarded = 0;
          sprache.met = false;
          if (!sprache.tags.includes('Task not completed/off-topic')) {
            sprache.tags.push('Task not completed/off-topic');
          }
        }
      }
    }
  }

  return {
    points: Math.min(points, maxPoints),
    maxPoints,
    criteria: resultCriteria.map(r => ({
      id: r.id,
      label: r.label,
      met: r.met,
      pointsAwarded: r.pointsAwarded,
      level: r.level,
      issueTags: r.tags,
      note: r.tags.join('; '),
    })),
    modelVersion: 'heuristic',
  };
}

// ─── GPT Evaluator ──────────────────────────────────────────────────────────────

let _singleton;
function getOpenAI() {
  if (!_singleton) {
    _singleton = new OpenAI({ apiKey: process.env.DG_OPENAI_API_KEY });
  }
  return _singleton;
}

function buildA1SystemPrompt() {
  return `You are a professional Goethe A1 Sprechen exam evaluator.
Score the student's response using a 3-level scale: FULL, PARTIAL, or ZERO.

FULL = Task fully completed and the response is intelligible.
PARTIAL = Task partly completed due to vocabulary, syntax, or pronunciation weaknesses. The listener is briefly confused but ultimately understands.
ZERO = Task not completed or completely unintelligible.

You must NEVER give hints, corrections, or encouragement — only score.
Respond ONLY with valid JSON.

Include relevant issue tags from this list if applicable:
- Pronunciation affects understanding
- Syntax affects understanding
- Word choice affects understanding
- Incomplete response
- Wrong task type
- No response
- Unintelligible`;
}

function buildA2SystemPrompt() {
  return `You are a professional Goethe A2 Sprechen exam evaluator.
Score the student's response using a 5-level A-E scale:

A = Fully appropriate; errors do not impair understanding.
B = Predominantly appropriate; minor issues or errors do not impair understanding.
C = Partially appropriate; errors partially impair understanding.
D = Barely appropriate; limited interaction; errors considerably impair understanding.
E = Task not fulfilled / unintelligible / not assessable.

You must NEVER give hints, corrections, or encouragement — only score.
Respond ONLY with valid JSON.

Include relevant issue tags from this list if applicable:
- Intonation affects understanding
- Word stress affects understanding
- Vocabulary range too limited
- Grammar errors impair understanding
- Interaction one-sided / no partner engagement
- Register inappropriate for situation
- Task not completed/off-topic
- Unintelligible`;
}

function buildA1UserPrompt({ teil, turnType, transcript, card, criteria }) {
  const cardContext = card && card.content
    ? `The student was shown a card with: "${card.content}".`
    : '';

  const criteriaList = criteria
    .map((c, i) => `Criterion ${i + 1} (${c.label}, max ${c.points} pt): ${c.prompt}`)
    .join('\n');

  return `Student's Teil ${teil} response (turn type: ${turnType}):
"${transcript || '(no response)'}"
${cardContext}

Scoring criteria:
${criteriaList}

Return a JSON object with this exact structure:
{
  "criteria": [
    {
      "id": "<criterion id>",
      "level": "full" | "partial" | "zero",
      "issueTags": ["<tag1>", "<tag2>"],
      "note": "<brief internal note, max 20 words>"
    }
  ]
}

Award FULL = max points, PARTIAL = half of max points, ZERO = 0 points.`;
}

function buildA2UserPrompt({ teil, turnType, transcript, card, criteria }) {
  const cardContext = card && card.content
    ? `The student was shown a card with: "${card.content}".`
    : '';

  const criteriaList = criteria
    .map((c, i) => `Criterion ${i + 1} (${c.label}, max ${c.points} pt):\n${c.prompt}`)
    .join('\n\n');

  return `Student's Teil ${teil} response (turn type: ${turnType}):
"${transcript || '(no response)'}"
${cardContext}

Scoring criteria:
${criteriaList}

Return a JSON object with this exact structure:
{
  "criteria": [
    {
      "id": "<criterion id>",
      "level": "A" | "B" | "C" | "D" | "E",
      "issueTags": ["<tag1>", "<tag2>"],
      "note": "<brief internal note, max 20 words>"
    }
  ]
}

Map the level to points using the scale provided per criterion.`;
}

function applyA1LevelToPoints(criterionDef, level) {
  const max = criterionDef.points || 0;
  switch (level) {
    case 'full': return max;
    case 'partial': return max / 2;
    case 'zero': return 0;
    default: return 0;
  }
}

function _defaultA2LevelMap(points) {
  if (!points || points <= 0) return { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const r = (v) => Math.round(v * 2) / 2; // round to nearest 0.5
  return {
    A: r(points),
    B: r(points * 0.75),
    C: r(points * 0.5),
    D: r(points * 0.25),
    E: 0,
  };
}

function applyA2LevelToPoints(criterionDef, level) {
  const lm = criterionDef.levelMap || _defaultA2LevelMap(criterionDef.points);
  return lm[level] !== undefined ? lm[level] : 0;
}

async function gptScoreTurn({ teil, turnType, transcript, card, criteria, examFormat }) {
  if (!process.env.DG_OPENAI_API_KEY) {
    throw new Error('No OpenAI API key configured');
  }

  const applicable = (criteria || []).filter(
    (c) => matchesTurnType(c.turnType, turnType) || c.turnType === 'global'
  );
  if (!applicable.length) {
    return { points: 0, maxPoints: 0, criteria: [], modelVersion: 'n/a' };
  }

  const maxPoints = applicable.reduce((sum, c) => sum + (c.points || 0), 0);
  const isA2 = examFormat === 'A2';
  const systemPrompt = isA2 ? buildA2SystemPrompt() : buildA1SystemPrompt();
  const userPrompt = isA2
    ? buildA2UserPrompt({ teil, turnType, transcript, card, criteria: applicable })
    : buildA1UserPrompt({ teil, turnType, transcript, card, criteria: applicable });

  const client = getOpenAI();
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 500,
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);

  // Build result criteria from GPT response
  const resultCriteria = applicable.map((c) => {
    const found = (parsed.criteria || []).find((r) => r.id === c.id);
    let level = '';
    let tags = [];
    let note = '';

    if (found) {
      level = String(found.level || '').toLowerCase();
      tags = Array.isArray(found.issueTags) ? found.issueTags : [];
      note = String(found.note || '').slice(0, 120);
    }

    const isA2Level = isA2 && ['a', 'b', 'c', 'd', 'e'].includes(level);
    const isA1Level = !isA2 && ['full', 'partial', 'zero'].includes(level);

    // Fallback: if GPT returned invalid level, default to E (A2) or zero (A1)
    if (!isA2Level && !isA1Level) {
      level = isA2 ? 'E' : 'zero';
    }

    if (isA2) level = level.toUpperCase();

    const pointsAwarded = isA2
      ? applyA2LevelToPoints(c, level)
      : applyA1LevelToPoints(c, level);

    return {
      id: c.id,
      label: c.label,
      level,
      met: level !== (isA2 ? 'E' : 'zero'),
      pointsAwarded: clampNumber(pointsAwarded, 0, c.points || 0),
      issueTags: tags,
      note,
    };
  });

  // A2 zero-override rule
  if (isA2) {
    for (const c of resultCriteria) {
      const def = applicable.find(d => d.id === c.id);
      if (def && def.isAufgabe && c.level === 'E') {
        const teilPrefix = def.id.replace('_aufgabe', '');
        const sprache = resultCriteria.find(r => r.id === `${teilPrefix}_sprache`);
        if (sprache) {
          sprache.level = 'E';
          sprache.pointsAwarded = 0;
          sprache.met = false;
          if (!sprache.issueTags.includes('Task not completed/off-topic')) {
            sprache.issueTags.push('Task not completed/off-topic');
          }
        }
      }
    }
  }

  const points = resultCriteria.reduce((sum, c) => sum + c.pointsAwarded, 0);

  return {
    points: Math.min(points, maxPoints),
    maxPoints,
    criteria: resultCriteria,
    modelVersion: completion.model || 'gpt-4o-mini',
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Score one student turn.
 *
 * @param {object} opts
 * @param {number}   opts.teil          1 | 2 | 3
 * @param {string}   opts.turnType      e.g. 'teil1_card', 'teil2_student_ask', …
 * @param {string}   opts.transcript    Student's spoken transcript
 * @param {object}   [opts.card]        { type, content, imageUrl }
 * @param {object[]} opts.criteria      Rubric criteria array
 * @param {string}   [opts.examFormat]  'A1' (default) | 'A2'
 * @param {number}   [opts.examinerId]  1 (GPT, default) | 2 (heuristic)
 * @returns {Promise<{ points, maxPoints, criteria, modelVersion }>}
 */
async function scoreTurn({ teil, turnType, transcript, card, criteria, examFormat, examinerId }) {
  const format = examFormat || 'A1';
  const eId = examinerId || 1;

  if (eId === 2) {
    // Examiner 2: Heuristic (rule-based)
    return { ...heuristicScoreTurn({ turnType, transcript, criteria, examFormat: format }), examinerId: eId };
  }

  // Examiner 1: GPT
  if (!process.env.DG_OPENAI_API_KEY) {
    return { ...heuristicScoreTurn({ turnType, transcript, criteria, examFormat: format }), examinerId: eId };
  }

  try {
    return { ...await gptScoreTurn({ teil, turnType, transcript, card, criteria, examFormat: format }), examinerId: eId };
  } catch (err) {
    console.error('[sprechenEvaluator] GPT error:', err.message);
    return { ...heuristicScoreTurn({ turnType, transcript, criteria, examFormat: format }), examinerId: eId };
  }
}

module.exports = { scoreTurn };
