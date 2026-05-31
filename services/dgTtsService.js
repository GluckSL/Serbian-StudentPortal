const OpenAIService = require('./openaiService');

let singleton;
function getOpenAI() {
  if (!singleton) {
    singleton = new OpenAIService(process.env.DG_OPENAI_API_KEY);
  }
  return singleton;
}

/**
 * @param {string} text
 * @param {string} [voice]
 * @returns {Promise<ReadableStream|import('stream').Readable|null>}
 */
async function synthesizeSpeechStream(text, voice = 'alloy') {
  const svc = getOpenAI();
  if (typeof svc.isConfigured !== 'function' || !svc.isConfigured()) {
    const err = new Error('OpenAI not configured for TTS');
    err.code = 'TTS_UNAVAILABLE';
    throw err;
  }
  return svc.textToSpeech(String(text || '').trim(), voice || 'alloy', { speed: 0.95 });
}

module.exports = { synthesizeSpeechStream, getOpenAI };
