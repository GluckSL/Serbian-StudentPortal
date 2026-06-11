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

// ─── A2 interlocutor functions ────────────────────────────────────────────────

const A2_SYSTEM_PROMPT = `You are a Goethe A2 Sprechen exam partner.
Rules:
- Speak ONLY in simple A2-level German (slightly more complex than A1, still clear and short).
- Keep every response to 1-3 short sentences.
- Never correct the student's grammar or give hints.
- Never break character or switch to English.
- Respond naturally and politely as if in a real oral exam.`;

/**
 * A2 Teil 1: Bot answers the student's question about the given card prompt.
 *
 * @param {string} prompt - e.g. "Geburtstag?"
 * @param {string} studentQuestion - student's spoken question transcript
 */
async function a2AnswerQuestionCard(prompt, studentQuestion) {
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: A2_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `The exam card shows the topic: "${prompt}". The student asked: "${studentQuestion || 'eine Frage'}". Please give a short, natural A2-level German answer about yourself.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 80,
    });
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err) {
    console.error('[sprechenInterlocutor] a2AnswerQuestionCard error:', err.message);
    return 'Das weiß ich nicht genau.';
  }
}

/**
 * A2 Teil 1: Bot asks the student a question based on the card prompt.
 *
 * @param {string} prompt - e.g. "Hobby?"
 */
async function a2AskQuestionCard(prompt) {
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: A2_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `The exam card shows: "${prompt}". Ask the student a natural A2-level W-question in German related to this topic. Return only the question sentence.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 60,
    });
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err) {
    console.error('[sprechenInterlocutor] a2AskQuestionCard error:', err.message);
    return `Was ist Ihr ${prompt.replace('?', '')}?`;
  }
}

/**
 * A2 Teil 3: Scheduling dialogue.
 *
 * The bot has its own busy schedule and tries to find a mutual free time with the student.
 * Returns { speech: string, agreed: boolean }.
 *
 * @param {object} opts
 * @param {string}   opts.scenario      - e.g. "Ihr Freund Patrick hat Geburtstag..."
 * @param {string}   opts.dateLabel     - e.g. "Samstag, 17. Mai"
 * @param {Array}    opts.botSlots      - bot's busy slots [{ start, end, activity, busy }]
 * @param {Array}    opts.chatHistory   - prior turns [{ role: 'student'|'bot', text }]
 * @param {string}   opts.studentMessage - student's latest message
 * @param {number}   opts.turnIndex     - how many dialogue turns have happened (0-based)
 */
async function a2ScheduleDialogue({ scenario, dateLabel, botSlots, chatHistory, studentMessage, turnIndex }) {
  try {
    const busyDesc = (botSlots || [])
      .filter((s) => s.busy)
      .map((s) => `${s.start}–${s.end}: ${s.activity}`)
      .join('; ');

    const historyText = (chatHistory || [])
      .map((m) => `${m.role === 'student' ? 'Kandidat' : 'Bot'}: ${m.text}`)
      .join('\n');

    const maxTurns = 8;
    const forceAgree = turnIndex >= maxTurns - 1;

    const systemContent = `${A2_SYSTEM_PROMPT}

You are scheduling a meeting with the student. Your busy times on ${dateLabel || 'today'} are: ${busyDesc || 'none'}.
The scenario: "${scenario}".
Your goal: find a mutual free time slot.
Respond in 1-2 sentences of A2 German. If you are free at the proposed time, agree and confirm. If not, politely say you are busy and propose an alternative from your free slots.
${forceAgree ? 'You MUST agree on a time in this response and end the conversation with a confirmation.' : ''}
At the very end of your message, on a new line, write exactly "AGREED:yes" if you have confirmed a mutual time, or "AGREED:no" if you have not yet agreed.`;

    const messages = [
      { role: 'system', content: systemContent },
    ];
    if (historyText) {
      messages.push({ role: 'user', content: `Previous conversation:\n${historyText}` });
    }
    messages.push({ role: 'user', content: `Kandidat: ${studentMessage}` });

    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 150,
    });

    const raw = (completion.choices[0]?.message?.content || '').trim();
    const agreedMatch = raw.match(/AGREED:(yes|no)/i);
    const agreed = agreedMatch ? agreedMatch[1].toLowerCase() === 'yes' : false;
    const speech = raw.replace(/\nAGREED:(yes|no)/i, '').trim();

    return { speech, agreed };
  } catch (err) {
    console.error('[sprechenInterlocutor] a2ScheduleDialogue error:', err.message);
    return { speech: 'Das tut mir leid, ich bin dann beschäftigt. Wie wäre es um 13 Uhr?', agreed: false };
  }
}

module.exports = {
  answerStudentQuestion,
  askStudentQuestion,
  respondToStudentRequest,
  makeRequestToStudent,
  a2AnswerQuestionCard,
  a2AskQuestionCard,
  a2ScheduleDialogue,
};
