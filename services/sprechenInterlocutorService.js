'use strict';

const OpenAI = require('openai');

let _singleton;
function getOpenAI() {
  if (!_singleton) {
    _singleton = new OpenAI({ apiKey: process.env.DG_OPENAI_API_KEY });
  }
  return _singleton;
}

const SYSTEM_PROMPT = `You are a Goethe A1 Sprechen exam partner.
Rules:
- Speak ONLY in simple A1-level German.
- Keep every response to 1-2 short sentences.
- Never correct the student's grammar or give hints.
- Never break character or switch to English.
- Respond naturally and politely as if in a real oral exam.`;

/**
 * Generate the bot's A1 German answer to a student's question in Teil 2.
 *
 * @param {string} theme - e.g. "Essen und Trinken"
 * @param {string} studentQuestion - student's spoken question (transcript)
 * @returns {Promise<string>}
 */
async function answerStudentQuestion(theme, studentQuestion) {
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `The exam theme is "${theme}". The student asked: "${studentQuestion || 'eine Frage zum Thema'}". Please give a short A1-level German answer.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 80,
    });
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err) {
    console.error('[sprechenInterlocutor] answerStudentQuestion error:', err.message);
    return 'Das weiß ich nicht genau.';
  }
}

/**
 * Generate the bot's A1 German question to the student in Teil 2.
 *
 * @param {string} theme - e.g. "Essen und Trinken"
 * @param {string} keyword - e.g. "Lieblingsessen"
 * @returns {Promise<string>}
 */
async function askStudentQuestion(theme, keyword) {
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `The exam theme is "${theme}". Ask the student a simple A1-level question in German using the keyword "${keyword}". Return only the question sentence.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 60,
    });
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err) {
    console.error('[sprechenInterlocutor] askStudentQuestion error:', err.message);
    return `Was ist Ihr ${keyword}?`;
  }
}

/**
 * Generate the bot's response to the student's request in Teil 3.
 *
 * @param {string} objectDe - e.g. "einen Stift"
 * @param {string} studentRequest - student's request transcript
 * @returns {Promise<string>}
 */
async function respondToStudentRequest(objectDe, studentRequest) {
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `The student asked for "${objectDe}". Their request was: "${studentRequest || 'Bitte geben Sie mir das.'}". Respond politely in A1 German — either accept and hand it over, or politely decline with a short reason.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 60,
    });
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err) {
    console.error('[sprechenInterlocutor] respondToStudentRequest error:', err.message);
    return 'Ja, natürlich. Bitte sehr.';
  }
}

/**
 * Generate the bot's polite request to the student in Teil 3.
 *
 * @param {string} objectDe - e.g. "ein Glas Wasser"
 * @returns {Promise<string>}
 */
async function makeRequestToStudent(objectDe) {
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Make a short, polite A1-level German request to the student for "${objectDe}". Return only the request sentence.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 50,
    });
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err) {
    console.error('[sprechenInterlocutor] makeRequestToStudent error:', err.message);
    return `Können Sie mir bitte ${objectDe} geben?`;
  }
}

module.exports = {
  answerStudentQuestion,
  askStudentQuestion,
  respondToStudentRequest,
  makeRequestToStudent,
};
