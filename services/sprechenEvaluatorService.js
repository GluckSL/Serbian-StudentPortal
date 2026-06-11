'use strict';

const OpenAI = require('openai');

function clampNumber(n, min, max) {
  if (typeof n !== 'number' || Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeText(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function heuristicScoreTurn({ turnType, transcript, criteria }) {
  const applicable = (criteria || []).filter((c) => !c.turnType || c.turnType === turnType);
  if (!applicable.length) return { points: 0, maxPoints: 0, criteria: [], modelVersion: 'fallback' };

  const maxPoints = applicable.reduce((sum, c) => sum + (c.points || 0), 0);
  const text = normalizeText(transcript);

  const met = (c) => {
    if (!text) return false;
    if (c.turnType === 'teil1_spell') {
      // Lightweight spelling detection: "s o u r a v" or "s-o-u-r-a-v"
      return /(^| )([a-zäöüß](?:[ -]+[a-zäöüß]){2,})( |$)/i.test(transcript || '');
    }
    if (c.turnType === 'teil1_number') {
      // Accept digits or common German number words.
      return /\d/.test(text) || /\b(null|eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)\b/.test(text);
    }
    if (c.turnType === 'teil2_student_ask') {
      // Question attempt: ? or W-word.
      return /\?/.test(transcript || '') || /\b(wann|was|wo|wie|warum|wer|welche|welcher|welches)\b/.test(text);
    }
    if (c.turnType === 'teil3_student_request') {
      return /\b(bitte|können sie|koennen sie|darf ich|ich möchte|ich moechte)\b/.test(text);
    }
    // A2 turn types
    if (c.turnType === 'a2t1_student_ask') {
      return /\?/.test(transcript || '') || /\b(wann|was|wo|wie|warum|wer|welche|welcher|welches)\b/.test(text);
    }
    if (c.turnType === 'a2t1_student_answer') {
      return text.split(' ').filter(Boolean).length >= 2;
    }
    if (c.turnType === 'a2t2_monologue') {
      return text.split(' ').filter(Boolean).length >= 5;
    }
    if (c.turnType === 'a2t3_dialogue') {
      // Time reference or question attempt
      return /\d{1,2}[:\s][0-5]\d|uhr|\b(morgen|nachmittag|abend|vormittag|mittag)\b|\?/.test(text) ||
        text.split(' ').filter(Boolean).length >= 4;
    }
    // Fallback: any non-trivial attempt.
    return text.split(' ').filter(Boolean).length >= 3;
  };

  const finalCriteria = applicable.map((c) => ({ id: c.id, label: c.label, met: met(c), note: 'fallback' }));
  const points = finalCriteria.reduce((sum, c, i) => sum + (c.met ? (applicable[i]?.points || 0) : 0), 0);

  return {
    points: Math.min(points, maxPoints),
    maxPoints,
    criteria: finalCriteria,
    modelVersion: 'fallback',
  };
}

let _singleton;
function getOpenAI() {
  if (!_singleton) {
    _singleton = new OpenAI({ apiKey: process.env.DG_OPENAI_API_KEY });
  }
  return _singleton;
}

/**
 * Silently score one student turn against the supplied rubric criteria.
 *
 * @param {object} opts
 * @param {number}   opts.teil          1 | 2 | 3
 * @param {string}   opts.turnType      e.g. 'teil1_card', 'teil2_student_ask', …
 * @param {string}   opts.transcript    Student's spoken transcript
 * @param {object}   [opts.card]        { type, content, imageUrl }
 * @param {object[]} opts.criteria      Rubric criteria array from module.rubric.teilN.criteria
 * @returns {Promise<{ points: number, maxPoints: number, criteria: object[], modelVersion: string }>}
 */
async function scoreTurn({ teil, turnType, transcript, card, criteria }) {
  if (!process.env.DG_OPENAI_API_KEY) {
    return heuristicScoreTurn({ turnType, transcript, criteria });
  }

  // Only score criteria that match this turn type
  const applicable = (criteria || []).filter(
    (c) => !c.turnType || c.turnType === turnType
  );

  if (!applicable.length) {
    return { points: 0, maxPoints: 0, criteria: [], modelVersion: 'n/a' };
  }

  const maxPoints = applicable.reduce((sum, c) => sum + (c.points || 0), 0);

  const cardContext = card && card.content
    ? `The student was shown a card with: "${card.content}".`
    : '';

  const criteriaList = applicable
    .map((c, i) => `Criterion ${i + 1} (${c.label}, max ${c.points} pt): ${c.prompt}`)
    .join('\n');

  const systemPrompt = `You are a professional Goethe A1 Sprechen exam evaluator. 
Score the student's response strictly according to the criteria below.
You must NEVER give hints, corrections, or encouragement — only score.
Respond ONLY with valid JSON.`;

  const userPrompt = `Student's Teil ${teil} response (turn type: ${turnType}):
"${transcript || '(no response)'}"
${cardContext}

Scoring criteria:
${criteriaList}

Return a JSON object with this exact structure:
{
  "criteria": [
    { "id": "<criterion id>", "label": "<label>", "met": <true|false>, "points_awarded": <number>, "note": "<brief internal note, max 20 words>" }
  ]
}
Award only 0 or the maximum points per criterion (no partial unless the criterion prompt specifies fractions).`;

  try {
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 400,
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);

    const resultCriteria = (parsed.criteria || []).map((r) => {
      const ref = applicable.find((c) => c.id === r.id);
      const refMax = ref?.points || 0;
      const awarded = typeof r.points_awarded === 'number'
        ? clampNumber(r.points_awarded, 0, refMax)
        : (Boolean(r.met) ? refMax : 0);
      return {
        id: r.id || '',
        label: r.label || ref?.label || '',
        met: Boolean(r.met),
        note: String(r.note || '').slice(0, 120),
        pointsAwarded: awarded,
      };
    });

    // Fallback: if GPT returned wrong criterion ids, use met to build result
    const finalCriteria = applicable.map((c) => {
      const found = resultCriteria.find((r) => r.id === c.id);
      if (found) return { id: c.id, label: c.label, met: found.met, note: found.note, pointsAwarded: found.pointsAwarded };
      return { id: c.id, label: c.label, met: false, note: '' };
    });

    const points = finalCriteria.reduce((sum, c, i) => {
      const ref = applicable[i];
      const refMax = ref?.points || 0;
      if (typeof c.pointsAwarded === 'number') return sum + clampNumber(c.pointsAwarded, 0, refMax);
      return sum + (c.met ? refMax : 0);
    }, 0);

    return {
      points: Math.min(points, maxPoints),
      maxPoints,
      criteria: finalCriteria.map((c) => ({ id: c.id, label: c.label, met: c.met, note: c.note })),
      modelVersion: completion.model || 'gpt-4o-mini',
    };
  } catch (err) {
    console.error('[sprechenEvaluator] GPT error:', err.message);
    // Fail open — fallback scoring so students still get a score.
    return heuristicScoreTurn({ turnType, transcript, criteria });
  }
}

module.exports = { scoreTurn };
