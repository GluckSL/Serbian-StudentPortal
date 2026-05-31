const { synthesizeSpeechStream } = require('../services/dgTtsService');

exports.synthesize = async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const voice = String(req.body?.voice || 'alloy').trim() || 'alloy';
    if (!text) {
      return res.status(400).json({ message: 'text required' });
    }
    if (text.length > 4000) {
      return res.status(400).json({ message: 'text too long (max 4000 chars)' });
    }

    const stream = await synthesizeSpeechStream(text, voice);
    if (!stream) {
      return res.status(503).json({ message: 'TTS engine unavailable' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    stream.pipe(res);
  } catch (e) {
    if (e.code === 'TTS_UNAVAILABLE') {
      return res.status(503).json({ message: e.message });
    }
    console.error('[dgTts]', e);
    res.status(500).json({ message: e.message || 'TTS failed' });
  }
};
