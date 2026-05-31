'use strict';

const OpenAI = require('openai');

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
      return {
        id: r.id || '',
        label: r.label || ref?.label || '',
        met: Boolean(r.met),
        note: String(r.note || '').slice(0, 120),
        pointsAwarded: typeof r.points_awarded === 'number' ? r.points_awarded : (r.met ? (ref?.points || 0) : 0),
      };
    });

    // Fallback: if GPT returned wrong criterion ids, use met to build result
    const finalCriteria = applicable.map((c) => {
      const found = resultCriteria.find((r) => r.id === c.id);
      if (found) return { id: c.id, label: c.label, met: found.met, note: found.note };
      return { id: c.id, label: c.label, met: false, note: '' };
    });

    const points = finalCriteria.reduce((sum, c, i) => {
      const ref = applicable[i];
      return sum + (c.met ? (ref?.points || 0) : 0);
    }, 0);

    return {
      points: Math.min(points, maxPoints),
      maxPoints,
      criteria: finalCriteria,
      modelVersion: completion.model || 'gpt-4o-mini',
    };
  } catch (err) {
    console.error('[sprechenEvaluator] GPT error:', err.message);
    // Fail open — award 0 but keep the session going
    return {
      points: 0,
      maxPoints,
      criteria: applicable.map((c) => ({ id: c.id, label: c.label, met: false, note: 'eval_error' })),
      modelVersion: 'error',
    };
  }
}

module.exports = { scoreTurn };
