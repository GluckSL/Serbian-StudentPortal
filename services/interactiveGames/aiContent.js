// services/interactiveGames/aiContent.js — AI exercise generation (provider abstraction)

const config = require('../../config/glueckArena');
const auditLog = require('./auditLog');

const BLOCKED = /\b(violence|explicit|hate)\b/i;

function validateGenerated(items, gameType) {
  const errors = [];
  const clean = [];
  for (let i = 0; i < items.length; i++) {
    const row = items[i];
    if (gameType === 'scramble_rush') {
      const word = String(row.word || '').trim().toUpperCase();
      if (!word || word.length < 2) errors.push(`Row ${i + 1}: invalid word`);
      else if (BLOCKED.test(word) || BLOCKED.test(row.hint || '')) errors.push(`Row ${i + 1}: moderation failed`);
      else clean.push({ word, hint: row.hint || '', difficultyLevel: row.difficultyLevel || 1 });
    } else if (gameType === 'sentence_builder') {
      const sentence = String(row.correctSentence || '').trim();
      if (!sentence) errors.push(`Row ${i + 1}: missing sentence`);
      else if (BLOCKED.test(sentence)) errors.push(`Row ${i + 1}: moderation failed`);
      else clean.push({
        correctSentence: sentence,
        translation: row.translation || '',
        randomizeWords: row.randomizeWords !== false,
      });
    }
  }
  return { valid: errors.length === 0, errors, items: clean };
}

async function callProvider(prompt, systemPrompt) {
  if (config.ai.provider === 'openai' && process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model: config.ai.model,
      max_tokens: config.ai.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    });
    const text = res.choices[0]?.message?.content || '{}';
    return JSON.parse(text);
  }
  // Mock provider for dev without API key
  return { items: [] };
}

async function generatePreview(adminId, { gameType, topic, count = 5, level = 'A1' }) {
  const systemPrompt = 'You are a German language teacher. Return JSON only: { "items": [...] }. No markdown.';
  let prompt = '';
  if (gameType === 'scramble_rush') {
    prompt = `Generate ${count} German vocabulary words for level ${level} about "${topic}". Each item: word (UPPERCASE), hint (English), difficultyLevel 1-5.`;
  } else {
    prompt = `Generate ${count} German sentences for level ${level} about "${topic}". Each: correctSentence, translation (English), randomizeWords true.`;
  }

  let parsed;
  try {
    parsed = await callProvider(prompt, systemPrompt);
  } catch (e) {
    return { ok: false, message: e.message, items: [], errors: [e.message] };
  }

  const items = parsed.items || parsed.questions || [];
  const validation = validateGenerated(items, gameType);
  await auditLog.log({
    actorId: adminId,
    action: 'ai_content_preview',
    metadata: { gameType, topic, count: validation.items.length },
  });

  return { ok: validation.valid, items: validation.items, errors: validation.errors, preview: true };
}

module.exports = { generatePreview, validateGenerated };
