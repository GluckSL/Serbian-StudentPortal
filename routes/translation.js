// routes/translation.js - OpenAI-powered translation service for subtitles

const express = require('express');
const router = express.Router();
const OpenAIService = require('../services/openaiService');

// Initialize OpenAI service
const openaiService = new OpenAIService();

console.log('🔤 Translation routes loaded');

// POST /api/translate - OpenAI translation endpoint
router.post('/', async (req, res) => {
  console.log('🔤 Translation POST request received:', req.body);
  
  try {
    const { text, from, to } = req.body;
    
    if (!text || !from || !to) {
      console.log('❌ Missing required fields:', { text: !!text, from: !!from, to: !!to });
      return res.status(400).json({ 
        error: 'Missing required fields: text, from, to' 
      });
    }
    
    // Check if OpenAI is configured
    if (!openaiService.isConfigured()) {
      console.log('❌ OpenAI not configured');
      return res.status(503).json({
        error: 'Translation service not configured',
        translatedText: `💬 Translation service unavailable (${from} → ${to})`
      });
    }
    
    console.log('🔤 Translation request:', { text: text.substring(0, 50), from, to });
    
    // Don't translate if source and target are the same
    if (from === to) {
      console.log('✅ Same language, no translation needed');
      return res.json({
        translatedText: text,
        isPartial: false,
        service: 'No translation needed'
      });
    }
    
    // Use OpenAI for translation
    console.log('🤖 Calling OpenAI translation service...');
    const result = await openaiService.translateText(text, from, to);
    console.log('🔤 OpenAI translation result:', result);
    
    if (result.success) {
      res.json({
        translatedText: `💬 ${result.translatedText}`,
        isPartial: false,
        service: result.service
      });
    } else {
      // Fallback to simple message if OpenAI fails
      const languageNames = {
        'Tamil': 'தமிழ்',
        'Sinhala': 'සිංහල',
        'English': 'English',
        'German': 'Deutsch'
      };
      
      const nativeName = languageNames[to] || to;
      res.json({
        translatedText: `💬 ${nativeName} translation temporarily unavailable`,
        isPartial: true,
        service: 'Fallback',
        error: result.error
      });
    }
    
  } catch (error) {
    console.error('❌ Translation service error:', error);
    res.status(500).json({ 
      error: 'Translation service error',
      translatedText: '💬 Translation temporarily unavailable'
    });
  }
});

// GET /api/translate/languages - Get supported language pairs
router.get('/languages', (req, res) => {
  console.log('🔤 Languages request received');
  
  const supportedLanguages = [
    'English',
    'German', 
    'Tamil',
    'Sinhala',
    'Spanish',
    'French',
    'Italian',
    'Portuguese',
    'Dutch',
    'Swedish'
  ];
  
  // Generate all possible pairs
  const supportedPairs = [];
  for (const from of supportedLanguages) {
    for (const to of supportedLanguages) {
      if (from !== to) {
        supportedPairs.push({ from, to });
      }
    }
  }
  
  res.json({
    supportedPairs,
    supportedLanguages,
    service: 'OpenAI GPT',
    totalPairs: supportedPairs.length
  });
});

// GET /api/translate/test - Test OpenAI connection
router.get('/test', async (req, res) => {
  console.log('🔤 Test request received');
  
  try {
    const testResult = await openaiService.testConnection();
    res.json({
      configured: openaiService.isConfigured(),
      connection: testResult
    });
  } catch (error) {
    res.status(500).json({
      configured: openaiService.isConfigured(),
      connection: { success: false, message: error.message }
    });
  }
});

module.exports = router;