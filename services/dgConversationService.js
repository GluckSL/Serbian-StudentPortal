'use strict';

const OpenAI = require('openai');

/**
 * Basic grammatical connectors always permitted regardless of module vocabulary.
 * Covers both English connectors and common German function words so the AI can
 * form natural short sentences without teaching/explaining.
 */
const BASIC_CONNECTORS = new Set([
  // English pronouns / auxiliaries
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
  'should', 'shall', 'may', 'might', 'must',
  // English connectors / articles
  'a', 'an', 'the', 'and', 'but', 'or', 'so', 'for', 'nor',
  'in', 'on', 'at', 'to', 'of', 'with', 'by', 'from', 'up', 'about', 'into',
  'that', 'this', 'here', 'there', 'what', 'how', 'which',
  // English common words
  'yes', 'no', 'not', 'very', 'please', 'thank', 'thanks', 'ok', 'okay',
  'good', 'great', 'my', 'your', 'our', 'their', 'its', 'too', 'also', 'just',
  'get', 'go', 'come', 'see', 'take', 'give', 'put', 'know', 'think', 'say',
  'tell', 'ask', 'try', 'use', 'want', 'need', 'like', 'more', 'some', 'any',
  'all', 'one', 'two', 'three',
  // German function words
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'sie',
  'ist', 'sind', 'bin', 'war', 'waren', 'bist', 'seid',
  'haben', 'hat', 'habe', 'hatte', 'hatten',
  'kann', 'können', 'möchte', 'möchten', 'will', 'wollen',
  'bitte', 'danke', 'ja', 'nein', 'nicht', 'kein', 'keine',
  'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'der', 'die', 'das', 'den', 'dem', 'des',
  'und', 'oder', 'aber', 'denn', 'weil', 'wenn', 'dass',
  'in', 'an', 'auf', 'bei', 'mit', 'von', 'zu', 'aus', 'nach', 'über', 'unter',
  'hier', 'da', 'dort', 'was', 'wie', 'wo', 'wer', 'wann', 'warum', 'welche',
  'sehr', 'auch', 'noch', 'schon', 'gut', 'gern', 'gerne',
  'mein', 'meine', 'dein', 'deine', 'sein', 'ihre', 'unser', 'euer',
]);

// ─────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────

/**
 * Build the strict system prompt for the DG Bot role-play conversation.
 *
 * Uses a structured template that enforces:
 * - Role + vocabulary boundary
 * - Natural style variety (questions / confirmations / acknowledgements)
 * - Memory of previous turns (no repeated questions)
 * - Soft correction (model the correct phrase naturally, never lecture)
 * - Off-topic redirection back to scene goal
 */
function buildDGPrompt(module, scene, runtime = {}) {
  const vocab = _buildVocabList(module);
  const scenario = module.rolePlayScenario || {};
  const targetLang = module.language || 'German';
  const nativeLang = module.nativeLanguage || 'English';

  const role = scenario.aiRole || 'language tutor';
  const studentRole = scenario.studentRole || 'student';
  const personality = scenario.aiPersonality || 'friendly and natural';
  const setting = scenario.setting || '';
  const durationMinutes = module.minPracticeMinutes || module.minimumCompletionTime || 10;
  const remainingSeconds =
    typeof runtime.remainingSeconds === 'number'
      ? Math.max(0, Math.floor(runtime.remainingSeconds))
      : durationMinutes * 60;

  const sceneGoal = scene.expectedAnswer
    ? `Guide the student to say something close to: "${scene.expectedAnswer}"`
    : 'Keep the conversation natural and on-topic within the scene.';

  const expectedAnswer = scene.expectedAnswer || '';

  const vocabLine = vocab.length
    ? vocab.join(', ')
    : '(use simple everyday words appropriate for the level)';

  return `You are a role-play conversation partner in a real-life scenario.

STRICT RULES:
* Stay inside this role: ${role}
* Prioritize these core vocabulary words: ${vocabLine}
* You may use basic connectors (I, you, want, is, are, am, please, thank, yes, no, a, an, the, and, but, or, my, your, not, good, here, what, how)
* You may add simple support words that fit CEFR level ${module.level || 'A1'} and the role-play context
* Keep topic aligned with the scene objective and roles
* Do NOT teach or explain grammar

LANGUAGE:
* Speak ONLY in ${targetLang} — never switch to ${nativeLang}
* Keep sentences short (maximum 12 words)

CONVERSATION STYLE:
* Sound natural and human — like a real person in a real situation
* Be friendly and interactive
* Sometimes ask questions
* Sometimes confirm what the student said
* Sometimes give short replies
* Occasionally acknowledge (e.g., "Okay", "Gut", "Schön")
* Avoid repeating the exact same sentence unless needed for clarification
* Vary tone slightly across responses while staying within vocabulary

MEMORY:
* Use previous conversation turns for context
* Progress the conversation naturally forward

SCENE:
* Setting: ${setting || 'a real-life scenario'}
* Student role: ${studentRole}
* Your personality: ${personality}
* Scene context: ${scene.text || ''}
${scene.hint ? `* Hint for student: ${scene.hint}` : ''}
* Goal: ${sceneGoal}
${expectedAnswer ? `* Expected student phrase: "${expectedAnswer}"` : ''}

SESSION CONTROL:
* Total session duration: ${durationMinutes} minutes
* Remaining time: ${remainingSeconds} seconds

TIME BEHAVIOR:
* If remaining time is low (<30 seconds), begin to wrap up naturally
* If remaining time is very low (<15 seconds), be more direct and concise

INSTRUCTION:
Guide the student to speak close to the expected phrase using only allowed vocabulary.

If user is slightly wrong:
* Respond naturally using the correct version in your reply — do NOT say "wrong" or "incorrect"

If user goes off-topic:
* Bring them back to the scenario using allowed vocabulary only

END BEHAVIOR:
* When time is nearly over, guide the conversation to a close
* Use shorter replies (prefer under 8 words)
* Ask direct, simple questions if needed
* When session ends, say a short closing line using only allowed vocabulary, for example:
  "Good job, done."
  "Nice, you finished."
  (Adapt to ${targetLang} and the scene context)

GOAL:
Make it feel like a real conversation, not a lesson.`;
}

// ─────────────────────────────────────────────────────────────
// Vocabulary helpers
// ─────────────────────────────────────────────────────────────

function _buildVocabList(module) {
  const toWord = (v) => (typeof v === 'string' ? v : v?.word || '');
  const vocab = (module.allowedVocabulary || []).map(toWord).filter(Boolean);
  const aiVocab = (module.aiTutorVocabulary || []).map(toWord).filter(Boolean);
  return [...new Set([...vocab, ...aiVocab])];
}

function buildAllowedSet(module) {
  const words = _buildVocabList(module).map((w) => w.toLowerCase().trim());
  return new Set([...words, ...BASIC_CONNECTORS]);
}

function _normalizeWord(w) {
  return w.toLowerCase().replace(/[^a-züäöß]/g, '');
}

function _extractWords(text) {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"()\-–—«»„"]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/**
 * Check how many words in `text` fall outside `allowedSet`.
 * Returns { ok: boolean, violationCount: number }.
 */
function checkVocabulary(text, allowedSet) {
  const words = _extractWords(text);
  const violations = words.filter((w) => {
    const clean = _normalizeWord(w);
    return clean.length > 0 && !allowedSet.has(clean) && !BASIC_CONNECTORS.has(clean);
  });
  return { ok: violations.length <= 2, violationCount: violations.length, violations };
}

// ─────────────────────────────────────────────────────────────
// OpenAI call
// ─────────────────────────────────────────────────────────────

function _makeOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Call OpenAI with the DG conversation prompt.
 * History items: { role: 'user' | 'ai', text: string }
 */
async function getAIResponse(systemPrompt, userText, history) {
  const openai = _makeOpenAI();

  const historyMessages = (history || []).slice(-6).map((m) => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: m.text,
  }));

  const messages = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
    { role: 'user', content: userText },
  ];

  const completion = await Promise.race([
    openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages,
      max_completion_tokens: 60,
      temperature: 0.7,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('DG conversation AI timeout')), 10000),
    ),
  ]);

  return (completion.choices[0]?.message?.content || '').trim();
}

// ─────────────────────────────────────────────────────────────
// Translation
// ─────────────────────────────────────────────────────────────

/**
 * Translate `text` from `fromLang` to Tamil.
 * Returns empty string on failure (non-blocking).
 */
async function translateToTamil(text, fromLang) {
  if (!text || !process.env.OPENAI_API_KEY) return '';
  try {
    const openai = _makeOpenAI();
    const translationModel = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o';

    const completion = await Promise.race([
      openai.chat.completions.create({
        model: translationModel,
        messages: [
          {
            role: 'system',
            content:
              'You are a professional translator. Translate accurately. Provide ONLY the translation — no explanations, no quotes.',
          },
          {
            role: 'user',
            content: `Translate this from ${fromLang} to Tamil:\n"${text}"\n\nTranslation:`,
          },
        ],
        max_completion_tokens: 150,
        temperature: 0.1,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DG translation timeout')), 8000),
      ),
    ]);

    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err) {
    console.warn('[dgConversationService] Translation failed:', err.message);
    return '';
  }
}

/**
 * Generic translation helper.
 * Returns empty string on failure (non-blocking).
 */
async function translateText(text, fromLang, toLang) {
  if (!text || !process.env.OPENAI_API_KEY) return '';
  try {
    const openai = _makeOpenAI();
    const translationModel = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o';
    const baseMessages = [
      {
        role: 'system',
        content:
          'You are a professional translator. Translate accurately. Provide ONLY the translation — no explanations, no quotes.',
      },
      {
        role: 'user',
        content: `Translate this from ${fromLang} to ${toLang}:\n"${text}"\n\nTranslation:`,
      },
    ];
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: translationModel,
        messages: baseMessages,
        max_completion_tokens: 150,
        temperature: 0.1,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DG translation timeout')), 8000),
      ),
    ]);
    let translated = (completion.choices[0]?.message?.content || '').trim();

    // Some models occasionally echo source text for EN translations.
    // Retry once with stricter instructions when output appears unchanged.
    const normalizedSource = (text || '').trim().toLowerCase();
    const normalizedOut = (translated || '').trim().toLowerCase();
    if (toLang === 'English' && normalizedOut && normalizedOut === normalizedSource) {
      const retry = await Promise.race([
        openai.chat.completions.create({
          model: translationModel,
          messages: [
            {
              role: 'system',
              content:
                'Translate the user text into natural English. Do not copy the source language. Return ONLY English translation text.',
            },
            {
              role: 'user',
              content: `Source language: ${fromLang}\nTarget language: English\nText: ${text}`,
            },
          ],
          max_completion_tokens: 150,
          temperature: 0,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('DG translation retry timeout')), 8000),
        ),
      ]);
      translated = (retry.choices[0]?.message?.content || translated).trim();
    }

    return translated;
  } catch (err) {
    console.warn('[dgConversationService] Translation failed:', err.message);
    return '';
  }
}

module.exports = {
  buildDGPrompt,
  buildAllowedSet,
  checkVocabulary,
  getAIResponse,
  translateToTamil,
  translateText,
};
