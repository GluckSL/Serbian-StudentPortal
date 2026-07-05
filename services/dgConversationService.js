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
// Beginner mode helpers
// ─────────────────────────────────────────────────────────────

function getBeginnerQuestions(bm) {
  if (!bm) return [];
  if (Array.isArray(bm.questions) && bm.questions.length) {
    return [...bm.questions].sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  const legacy = bm.dialoguePrompts || [];
  if (!legacy.length) return [];
  return legacy.map((p, i) => ({
    questionText: p.promptText || '',
    targetAnswer: p.targetAnswer || '',
    hint: p.hint || '',
    imageUrl: i === 0 ? bm.contextImageUrl || '' : '',
    order: i,
  }));
}

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

  // ── Beginner mode block ───────────────────────────────────────────────────
  const bm = module.beginnerMode;
  const isBeginnerMode = bm && bm.enabled;

  if (isBeginnerMode) {
    const questions = getBeginnerQuestions(bm);
    const sessionIntro = (bm.sessionIntro || bm.contextText || '').trim();

    const questionsBlock = questions.length
      ? questions
          .map((q, i) => {
            let line = `${i + 1}. Ask: "${q.questionText}"`;
            if (q.imageUrl) line += ` [show/reference image: ${q.imageUrl}]`;
            if (q.targetAnswer) line += ` (expected: "${q.targetAnswer}")`;
            if (q.hint) line += ` [hint: ${q.hint}]`;
            return line;
          })
          .join('\n')
      : '(no questions set — improvise short beginner-friendly steps)';

    return `You are an AI speaking partner helping a complete beginner practice ${targetLang}.

WHO YOU ARE:
* You are NOT a teacher. You are a fellow beginner who is learning ${targetLang} alongside the student.
* Your goal is to build the student's CONFIDENCE, not to teach grammar or hold long conversations.
* You are friendly, encouraging, and patient — like a study buddy.

STRICT MESSAGE RULES:
* Each message must contain ONLY ONE of: one question, one task, or one idea.
* Maximum 10 words per message.
* Never write long paragraphs. Short is always better.
* Examples of good messages: "Hallo!" / "Wie heißt du?" / "Super!" / "Schauen wir das Bild an." / "Was siehst du?"

LANGUAGE:
* Speak primarily in ${targetLang} — short, simple words only.
* You may occasionally use ${nativeLang} for a single word to help the student (e.g., "Say: Guten Morgen").
* Use CEFR level ${module.level || 'A1'} vocabulary only.

VOCABULARY YOU CAN USE:
${vocabLine}

${sessionIntro ? `SESSION GREETING (optional start):\n"${sessionIntro}"\n` : ''}
YOUR QUESTIONS (work through in order — one at a time):
${questionsBlock}

SESSION STRUCTURE (5–10 minutes):
1. Greeting (say hello, ask the student's name)
2. For each question: reference its picture if it has one, ask the question, wait for the student
3. Give short positive feedback after each student response
4. Friendly goodbye

SESSION CONTROL:
* Total session duration: ${durationMinutes} minutes
* Remaining time: ${remainingSeconds} seconds
* If remaining time is low (<30 seconds), wrap up with a goodbye.

BEHAVIOUR:
* If the student says something slightly wrong, gently model the correct phrase in your reply — never say "wrong".
* If the student goes off-topic, bring them back with a simple question about the current step.
* Always end your turn with a question or task so the student has something to respond to.
* Progress through the questions — do not repeat the same question twice.

GOAL:
Make it feel like chatting with a friendly study buddy, not taking a German lesson.`;
  }

  // ── Standard (non-beginner) prompt ───────────────────────────────────────
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
  return new OpenAI({ apiKey: process.env.DG_OPENAI_API_KEY });
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
  if (!text || !process.env.DG_OPENAI_API_KEY) return '';
  try {
    const openai = _makeOpenAI();
    const translationModel = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini';

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
        setTimeout(() => reject(new Error('DG translation timeout')), 5000),
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
  if (!text || !process.env.DG_OPENAI_API_KEY) return '';
  try {
    const openai = _makeOpenAI();
    const translationModel = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini';
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
        setTimeout(() => reject(new Error('DG translation timeout')), 5000),
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
          setTimeout(() => reject(new Error('DG translation retry timeout')), 5000),
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

/**
 * Score a beginner-mode student answer against the expected phrase (0–100).
 * Uses local similarity first; optional AI refinement when OPENAI key is set.
 */
function scoreBeginnerAnswerLocally(said, expected) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .trim()
      .replace(/[.,!?;:'"„"–—]/g, '')
      .replace(/\s+/g, ' ');

  const s = norm(said);
  const e = norm(expected);

  if (!s || !e) return 0;
  if (s === e) return 100;
  if (s.includes(e)) return 100;
  if (e.includes(s) && s.length >= Math.max(3, e.length * 0.6)) return 95;

  const eWords = e.split(' ').filter(Boolean);
  const sWords = new Set(s.split(' ').filter(Boolean));
  if (eWords.length === 0) return 0;

  const matched = eWords.filter((w) =>
    sWords.has(w) ||
    [...sWords].some((sw) => (sw.length > 2 && w.startsWith(sw)) || (w.length > 2 && sw.startsWith(w)))
  );
  return Math.round((matched.length / eWords.length) * 100);
}

/**
 * AI grade for beginner mode — compares student answer to expected answer.
 * Returns { score: 0-100 } or null on failure.
 */
async function gradeBeginnerAnswerWithAI({ studentAnswer, expectedAnswer, questionText, language, nativeLanguage }) {
  if (!process.env.DG_OPENAI_API_KEY) return null;
  const said = String(studentAnswer || '').trim();
  const expected = String(expectedAnswer || '').trim();
  if (!said || !expected) return null;

  try {
    const openai = _makeOpenAI();
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              `You grade ${language || 'German'} A1 beginner speaking answers. ` +
              'Return JSON only: {"score": number 0-100}. ' +
              'Score 100 for a correct answer in the target language. ' +
              'Score 0 if the student answered entirely in the wrong language (e.g. English only, raw digits without German phrasing). ' +
              'Give partial credit for close attempts with minor errors.',
          },
          {
            role: 'user',
            content:
              `Question: ${questionText || '(not given)'}\n` +
              `Expected answer (${language}): "${expected}"\n` +
              `Student said: "${said}"\n` +
              `Student native language: ${nativeLanguage || 'English'}\n` +
              'Grade how well the student answer matches the expected answer in the target language.',
          },
        ],
        max_completion_tokens: 80,
        temperature: 0.1,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Beginner grading timeout')), 8000),
      ),
    ]);
    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    return { score };
  } catch (err) {
    console.warn('[dgConversationService] gradeBeginnerAnswerWithAI failed:', err.message);
    return null;
  }
}

module.exports = {
  buildDGPrompt,
  buildAllowedSet,
  checkVocabulary,
  getAIResponse,
  getBeginnerQuestions,
  translateToTamil,
  translateText,
  scoreBeginnerAnswerLocally,
  gradeBeginnerAnswerWithAI,
};
