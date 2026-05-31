'use strict';

/**
 * AI-powered DG scene generator.
 *
 * Given a role-play scenario (situation / studentRole / aiRole),
 * vocabulary lists, grammar structures, and a target count, asks the
 * configured OpenAI model to produce an array of scenes that mirror
 * the DGScene shape used by the player and the form:
 *
 *   { type: 'intro' | 'teach' | 'practice' | 'feedback',
 *     text, expectedAnswer, translation, hint, order }
 */

const OpenAI = require('openai');

const SCENE_TYPES = ['intro', 'teach', 'practice', 'feedback'];

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured on the server.');
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function buildPrompt({
  count,
  level,
  language,
  nativeLanguage,
  rolePlayScenario,
  allowedVocabulary,
  aiTutorVocabulary,
  allowedGrammar,
}) {
  const rps = rolePlayScenario || {};
  const vocab = safeArr(allowedVocabulary)
    .map((v) => `- ${v.word}${v.translation ? ` (${v.translation})` : ''}`)
    .join('\n') || '(none provided)';
  const aiVocab = safeArr(aiTutorVocabulary)
    .map((v) => `- ${v.word}${v.translation ? ` (${v.translation})` : ''}`)
    .join('\n') || '(none provided)';
  const grammar = safeArr(allowedGrammar)
    .map((g) => `- ${g.structure}${g.examples?.length ? ` — e.g. ${g.examples.slice(0, 3).join('; ')}` : ''}`)
    .join('\n') || '(none provided)';

  return `You are an expert ${language} language teacher designing a guided role-play module
for a ${level || 'A1'}-level student whose native language is ${nativeLanguage || 'English'}.

ROLE-PLAY SCENARIO
Situation: ${rps.situation || 'general conversation'}
Setting: ${rps.setting || ''}
Student role: ${rps.studentRole || 'student'}
AI role: ${rps.aiRole || 'tutor'}
Objective: ${rps.objective || ''}
AI personality: ${rps.aiPersonality || 'friendly and supportive'}
Student guidance: ${rps.studentGuidance || ''}

ALLOWED STUDENT VOCABULARY (the words students must learn):
${vocab}

ALLOWED AI TUTOR VOCABULARY (extra words the AI may use):
${aiVocab}

ALLOWED GRAMMAR STRUCTURES:
${grammar}

TASK
Create exactly ${count} scenes that walk the student through this role-play.
Use ONLY the vocabulary and grammar provided where possible.

Each scene must be one of these four types:
- "intro": friendly opener / context-setting line spoken by the digital guide.
- "teach": presents a target word or short phrase with its translation. \`text\` is the line in ${language}; \`translation\` is its meaning in ${nativeLanguage}.
- "practice": prompts the student to SAY a specific word or sentence aloud. \`text\` is the prompt (in ${nativeLanguage} or mixed), \`expectedAnswer\` is exactly what the student should say in ${language}, \`translation\` is the meaning in ${nativeLanguage}, \`hint\` is a brief helper.
- "feedback": short closing/encouragement line.

Mandatory composition for ${count} scenes:
1. Start with exactly ONE \`intro\` scene.
2. Include several \`teach\` scenes that introduce vocabulary BEFORE asking the student to use it.
3. At least 40% of the scenes (and at minimum 1) MUST be \`practice\` scenes covering different vocabulary items.
4. End with exactly ONE \`feedback\` scene.
5. Every \`practice\` scene MUST have a non-empty \`expectedAnswer\` in ${language}.

Return STRICT JSON in exactly this shape and nothing else (no markdown, no commentary):
{
  "scenes": [
    {
      "type": "intro" | "teach" | "practice" | "feedback",
      "text": "string",
      "expectedAnswer": "string",
      "translation": "string",
      "hint": "string"
    }
  ]
}`;
}

function _stripFences(s) {
  return String(s || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function _coerceScenes(parsed, count) {
  const arr = Array.isArray(parsed) ? parsed : safeArr(parsed?.scenes);
  const cleaned = arr
    .filter((s) => s && typeof s === 'object')
    .map((s, idx) => {
      const type = SCENE_TYPES.includes(s.type) ? s.type : 'teach';
      return {
        type,
        text: String(s.text || '').trim(),
        expectedAnswer: String(s.expectedAnswer || '').trim(),
        translation: String(s.translation || '').trim(),
        hint: String(s.hint || '').trim(),
        order: idx,
      };
    });
  if (cleaned.length === 0) return [];

  if (cleaned.length > count) cleaned.length = count;

  let hasPractice = cleaned.some((s) => s.type === 'practice');
  if (!hasPractice) {
    const teachIdx = cleaned.findIndex((s) => s.type === 'teach');
    if (teachIdx >= 0) {
      cleaned[teachIdx].type = 'practice';
      if (!cleaned[teachIdx].expectedAnswer) {
        cleaned[teachIdx].expectedAnswer = cleaned[teachIdx].text;
      }
    }
  }

  cleaned.forEach((s, i) => (s.order = i));
  return cleaned;
}

async function generateScenesWithAi(opts) {
  const count = Math.max(2, Math.min(30, Number(opts?.count) || 8));
  const prompt = buildPrompt({ ...opts, count });

  const client = getClient();
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You generate JSON-only structured curricula for language tutoring scenes. Always respond with strict JSON, no markdown.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.6,
    max_tokens: 2200,
    response_format: { type: 'json_object' },
  });

  const raw = completion?.choices?.[0]?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(_stripFences(raw));
    } catch {
      parsed = null;
    }
  }
  const scenes = _coerceScenes(parsed, count);
  if (scenes.length === 0) {
    throw new Error('AI did not return any usable scenes. Please try again.');
  }
  return scenes;
}

module.exports = { generateScenesWithAi };
