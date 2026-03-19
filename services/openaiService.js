// services/openaiService.js
// OpenAI ChatGPT-4o Integration for German Language Tutoring

const OpenAI = require('openai');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.model = process.env.OPENAI_MODEL || 'gpt-4o';
    this.maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS) || 800; // Reduced from 1500
    this.temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7;
  }

  /**
   * Generate AI tutor response using ChatGPT-4o
   */
  async generateTutorResponse(context) {
    try {
      const { message, module, sessionType, previousMessages, studentLevel } = context;
      
      const systemPrompt = this.buildSystemPrompt(module, sessionType, studentLevel);
      const conversationHistory = this.buildConversationHistory(previousMessages);
      
      // Adjust max_tokens based on CEFR level to enforce shorter responses for beginners
      const levelMaxTokens = {
        'A1': 150,
        'A2': 200,
        'B1': 300,
        'B2': 400,
        'C1': 800,
        'C2': 800
      };
      const maxTokens = levelMaxTokens[module.level] || this.maxTokens;

      const completion = await Promise.race([
        this.openai.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...conversationHistory,
            { role: 'user', content: message }
          ],
          max_tokens: maxTokens,
          temperature: this.temperature
          // Removed response_format to fix the error
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('OpenAI request timeout')), 15000) // 15 second timeout
        )
      ]);

      // Parse response - try JSON first, fallback to plain text
      let response;
      try {
        const content = completion.choices[0].message.content;
        
        // Check if response is wrapped in ```json blocks
        if (content.includes('```json')) {
          const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            response = JSON.parse(jsonMatch[1]);
          } else {
            throw new Error('JSON block found but could not extract');
          }
        } else {
          // Try to parse as direct JSON
          response = JSON.parse(content);
        }
      } catch (error) {
        // If not JSON, create a simple response object
        const content = completion.choices[0].message.content
          .replace(/```json\s*/, '')
          .replace(/\s*```/, '')
          .trim();
          
        response = {
          content: content,
          messageType: 'text',
          suggestions: [],
          metadata: {}
        };
      }
      
      return {
        content: response.content,
        messageType: response.messageType || 'text',
        suggestions: response.suggestions || [],
        exercise: response.exercise || null,
        metadata: response.metadata || {}
      };
    } catch (error) {
      console.error('OpenAI API Error:', error);
      return this.getFallbackResponse(context);
    }
  }

  /**
   * Evaluate student's answer using AI
   */
  async evaluateGermanAnswer(studentAnswer, correctAnswer, context) {
    try {
      const { module, exerciseType, question } = context;
      const targetLang = module.targetLanguage || 'German';
      const nativeLang = module.nativeLanguage || 'English';
      
      const evaluationPrompt = `
        As a ${targetLang} language expert, evaluate this student's answer:
        
        Question: ${question}
        Correct Answer: ${correctAnswer}
        Student Answer: ${studentAnswer}
        Exercise Type: ${exerciseType}
        Module: ${module.title} (${module.level})
        Target Language: ${targetLang}
        Native Language: ${nativeLang}
        
        Provide evaluation in JSON format:
        {
          "isCorrect": boolean,
          "score": number (0-100),
          "feedback": "detailed feedback in ${nativeLang}",
          "${targetLang.toLowerCase()}Explanation": "explanation in ${targetLang} if appropriate",
          "suggestions": ["suggestion1", "suggestion2"],
          "commonMistake": "if this is a common mistake, explain it in ${nativeLang}",
          "pronunciation": "pronunciation tips if relevant"
        }
      `;

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: `You are an expert ${targetLang} language teacher providing detailed feedback in ${nativeLang}.` },
          { role: 'user', content: evaluationPrompt }
        ],
        max_tokens: 800,
        temperature: 0.3 // Lower temperature for more consistent evaluation
        // Removed response_format to fix the error
      });

      // Parse response - try JSON first, fallback to simple evaluation
      let evaluation;
      try {
        evaluation = JSON.parse(completion.choices[0].message.content);
      } catch (error) {
        // If not JSON, create a simple evaluation
        const content = completion.choices[0].message.content;
        const isCorrect = content.toLowerCase().includes('correct') || content.toLowerCase().includes('right');
        evaluation = {
          isCorrect,
          score: isCorrect ? 100 : 0,
          feedback: content,
          suggestions: []
        };
      }
      
      return {
        isCorrect: evaluation.isCorrect,
        score: evaluation.score,
        feedback: evaluation.feedback,
        targetLanguageExplanation: evaluation[`${targetLang.toLowerCase()}Explanation`],
        suggestions: evaluation.suggestions || [],
        commonMistake: evaluation.commonMistake,
        pronunciation: evaluation.pronunciation,
        points: evaluation.isCorrect ? 1 : 0
      };
    } catch (error) {
      console.error('OpenAI Evaluation Error:', error);
      return this.getFallbackEvaluation(studentAnswer, correctAnswer);
    }
  }

  /**
   * Generate dynamic exercises using AI
   */
  async generateExercise(module, difficulty, exerciseType = 'multiple-choice') {
    try {
      const targetLang = module.targetLanguage || 'German';
      const nativeLang = module.nativeLanguage || 'English';
      
      const exercisePrompt = `
        Create a ${targetLang} language exercise for:
        
        Module: ${module.title}
        Target Language: ${targetLang}
        Native Language: ${nativeLang} (for instructions)
        Level: ${module.level}
        Category: ${module.category}
        Difficulty: ${difficulty}
        Exercise Type: ${exerciseType}
        Key Topics: ${module.content?.keyTopics?.join(', ') || `General ${targetLang}`}
        
        Generate exercise in JSON format:
        {
          "type": "${exerciseType}",
          "question": "exercise question in ${nativeLang}",
          "${targetLang.toLowerCase()}Text": "${targetLang} text if applicable",
          "options": ["option1", "option2", "option3", "option4"] (for multiple choice),
          "correctAnswer": "correct answer",
          "explanation": "why this is correct (in ${nativeLang})",
          "difficulty": "${difficulty}",
          "points": number,
          "hints": ["hint1", "hint2"] (in ${nativeLang}),
          "culturalNote": "cultural context if relevant to ${targetLang}-speaking countries"
        }
      `;

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: `You are a ${targetLang} language teacher creating educational exercises. Provide instructions in ${nativeLang} and examples in ${targetLang}.` },
          { role: 'user', content: exercisePrompt }
        ],
        max_tokens: 1000,
        temperature: 0.8 // Higher creativity for exercise generation
        // Removed response_format to fix the error
      });

      // Parse response - try JSON first, fallback to simple exercise
      let exercise;
      try {
        exercise = JSON.parse(completion.choices[0].message.content);
      } catch (error) {
        // If not JSON, create a simple exercise
        exercise = this.getFallbackExercise(module, exerciseType);
      }
      return exercise;
    } catch (error) {
      console.error('OpenAI Exercise Generation Error:', error);
      return this.getFallbackExercise(module, exerciseType);
    }
  }

  /**
   * Convert text to speech using OpenAI GPT-4o-Mini-TTS
   * Uses the latest GPT-4o-mini-tts model with improved controllability and voice quality
   */
  async textToSpeech(text, voice = 'alloy', options = {}) {
    try {
      // Use GPT-4o-Mini-TTS for superior text-to-speech quality
      const ttsModel = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
      
      // Enhanced options for language learning
      const requestOptions = {
        model: ttsModel,
        voice: voice, // alloy, echo, fable, onyx, nova, shimmer
        input: text,
        speed: options.speed || 0.9, // Slightly slower for language learning
        // GPT-4o-mini-tts supports additional controllability
        ...(ttsModel === 'gpt-4o-mini-tts' && options.instructions && {
          instructions: options.instructions // Custom pronunciation instructions
        })
      };
      
      const mp3 = await this.openai.audio.speech.create(requestOptions);

      return mp3.body; // Returns audio stream
    } catch (error) {
      console.error('OpenAI GPT-4o-Mini-TTS Error:', error);
      
      // Fallback to basic TTS if GPT-4o-mini-tts fails
      try {
        console.log('Falling back to tts-1...');
        const mp3 = await this.openai.audio.speech.create({
          model: 'tts-1',
          voice: voice,
          input: text,
          speed: options.speed || 0.9
        });
        return mp3.body;
      } catch (fallbackError) {
        console.error('Fallback TTS Error:', fallbackError);
        return null;
      }
    }
  }

  /**
   * Convert speech to text using OpenAI GPT-4o-Transcribe
   * Uses the latest GPT-4o-transcribe model for superior accuracy and performance
   */
  async speechToText(audioBuffer, language = 'de') {
    try {
      // Use GPT-4o-Transcribe for superior speech recognition
      const speechModel = process.env.OPENAI_SPEECH_MODEL || 'gpt-4o-transcribe';
      
      const transcription = await this.openai.audio.transcriptions.create({
        file: audioBuffer,
        model: speechModel,
        language: language,
        response_format: 'json',
        temperature: 0.2 // Lower temperature for more accurate transcription
      });

      return {
        text: transcription.text,
        confidence: transcription.confidence || 0.9
      };
    } catch (error) {
      console.error('OpenAI GPT-4o-Transcribe Error:', error);
      return { text: '', confidence: 0 };
    }
  }

  /**
   * Build system prompt based on context
   */
  buildSystemPrompt(module, sessionType, studentLevel) {
    const targetLang = module.targetLanguage || 'German';
    const nativeLang = module.nativeLanguage || 'English';
    
    // Check if this is a role-play module
    const isRolePlay = module.content?.rolePlayScenario;
    
    if (isRolePlay) {
      return this.buildRolePlaySystemPrompt(module, sessionType, studentLevel, targetLang, nativeLang);
    }
    
    // Regular module prompt (existing code)
    const basePrompt = `You are an expert ${targetLang} language tutor with years of experience teaching ${targetLang} to international students. You are patient, encouraging, and adapt your teaching style to each student's needs.

${this.getCefrLevelGuidelines(module.level)}

Current Context:
- Target Language: ${targetLang} (language being learned)
- Native Language: ${nativeLang} (language for explanations)
- Module: ${module.title}
- Level: ${module.level} 
- Category: ${module.category}
- Session Type: ${sessionType}
- Student Level: ${studentLevel}

Module Details:
- Description: ${module.description || 'Language learning module'}
- Key Topics: ${module.content?.keyTopics?.join(', ') || `General ${targetLang}`}
- Learning Objectives: ${module.learningObjectives?.map(obj => obj.objective).join(', ') || 'Language practice'}

AI Tutor Personality: ${module.aiTutorConfig?.personality || `friendly and encouraging ${targetLang} tutor`}
Focus Areas: ${module.aiTutorConfig?.focusAreas?.join(', ') || `general ${targetLang} skills`}
Helpful Phrases: ${module.aiTutorConfig?.helpfulPhrases?.join(', ') || `basic ${targetLang} phrases`}

Instructions:
1. Always respond in a helpful, encouraging manner
2. Provide explanations in ${nativeLang} but include ${targetLang} examples
3. Correct mistakes gently and explain why in ${nativeLang}
4. Offer cultural context when relevant to ${targetLang}-speaking countries
5. Adapt difficulty to student's level
6. Use the module's focus areas to guide your responses
7. Include pronunciation tips when helpful (use phonetic spelling or IPA)
8. Provide practical examples students can use in real ${targetLang} conversations
9. COMPLETION DETECTION: Only when BOTH conditions are met, include completion signals:
   ✅ CONDITION 1: The conversation has reached a natural conclusion (student has practiced sufficiently and learning objectives are met)
   ✅ CONDITION 2: At least 15 minutes have passed in the session
   
   IMPORTANT: Do NOT end the session prematurely. Students need adequate practice time.
   If learning objectives are met but time is insufficient, continue with:
   - Additional practice exercises
   - Review of covered topics
   - Advanced variations of the concepts
   - Cultural context and real-world applications
   
   When BOTH conditions are met, use completion phrases:
   - For English modules/native: Use phrases like "Thank you for practicing", "Have a fantastic day", "Feel free to reach out", "Practice again", "Good bye", "See you next time"
   - For German modules/native: Use phrases like "Vielen Dank fürs Üben", "Haben Sie einen schönen Tag", "Auf Wiedersehen", "Bis zum nächsten Mal", "Tschüss", "Gut gemacht"
   - For Tamil native language: Use phrases like "பயிற்சிக்கு நன்றி", "நல்ல நாள் இருக்கட்டும்", "வாழ்த்துக்கள்", "அடுத்த முறை சந்திப்போம்"
   - For Sinhala native language: Use phrases like "පුහුණුවීමට ස්තූතියි", "හොඳ දිනයක් වේවා", "සුභපැතුම්", "ඊළඟ වතාවේ හමුවෙමු"
   - Include farewell expressions appropriate to ${targetLang} or ${nativeLang} culture
   - Encourage future practice or learning
   - The system will automatically detect these patterns and complete the module

Language-Specific Guidelines:
${this.getLanguageSpecificGuidelines(targetLang, nativeLang)}

Response Format:
Always respond with valid JSON in this format:
{
  "content": "your main response text in ${nativeLang}",
  "messageType": "text|exercise|feedback|hint|correction|encouragement",
  "suggestions": ["suggestion1", "suggestion2", "suggestion3"],
  "exercise": null or exercise object if generating one,
  "metadata": {
    "${targetLang.toLowerCase()}Phrase": "relevant ${targetLang} phrase if applicable",
    "pronunciation": "pronunciation guide if needed",
    "culturalNote": "cultural context if relevant"
  }
}`;

    // Add session-specific instructions
    switch (sessionType) {
      case 'practice':
        return basePrompt + `\n\nSession Focus: Interactive practice with exercises and immediate feedback. Create engaging practice opportunities for ${targetLang} learning.`;
      
      case 'conversation':
        return basePrompt + `\n\nSession Focus: Free-form ${targetLang} conversation. Encourage the student to speak ${targetLang} as much as possible. Correct mistakes naturally within the conversation flow.`;
      
      case 'assessment':
        return basePrompt + `\n\nSession Focus: Testing and evaluation of ${targetLang} skills. Create exercises to assess the student's understanding. Provide detailed feedback on performance.`;
      
      case 'help':
        return basePrompt + `\n\nSession Focus: Answering questions and providing explanations about ${targetLang}. Be thorough in your explanations and provide multiple examples.`;
      
      case 'review':
        return basePrompt + `\n\nSession Focus: Reviewing previous ${targetLang} topics and reinforcing learning. Help consolidate knowledge and identify areas for improvement.`;
      
      default:
        return basePrompt;
    }
  }

  /**
   * Build role-play specific system prompt with constraints
   */
  buildRolePlaySystemPrompt(module, sessionType, studentLevel, targetLang, nativeLang) {
    const scenario = module.content.rolePlayScenario;
    const allowedVocab = module.content.allowedVocabulary || [];
    const allowedGrammar = module.content.allowedGrammar || [];
    const conversationFlow = module.content.conversationFlow || [];
    const rolePlayInstructions = module.aiTutorConfig?.rolePlayInstructions || {};

    const rolePlayPrompt = `🎭 ROLE-PLAY LANGUAGE TUTOR - SESSION MANAGER

${this.getCefrLevelGuidelines(module.level)}

ROLE-PLAY SCENARIO:
- Situation: ${scenario.situation}
- Setting: ${scenario.setting || 'Not specified'}
- Your Role: ${scenario.aiRole}
- Student Role: ${scenario.studentRole}
- Objective: ${scenario.objective || 'Practice natural conversation'}

AI ROLE PERSONALITY:
${scenario.aiPersonality || rolePlayInstructions.aiPersonality || `You are a helpful and patient ${scenario.aiRole}`}

STUDENT ROLE GUIDANCE (to explain to student):
${scenario.studentGuidance || rolePlayInstructions.studentGuidance || `You are playing the role of ${scenario.studentRole}. Be natural and don't worry about making mistakes.`}

SESSION STATES - FOLLOW THIS FLOW:

1. INTRODUCTION STATE (when session starts):
   - Greet the student warmly in ${nativeLang}
   - Explain the role-play scenario: "${scenario.situation}"
   - Describe the setting: "${scenario.setting || 'Not specified'}"
   - Clearly state: "I will be the ${scenario.aiRole} and you will be the ${scenario.studentRole}"
   - Explain the objective: "${scenario.objective}"
   - Share student guidance: "${scenario.studentGuidance || rolePlayInstructions.studentGuidance || `You are playing the role of ${scenario.studentRole}`}"
   - List vocabulary constraints (show 5-8 key words as examples)
   - Provide suggested opening responses if available
   - Ask student to say "Let's start" or "Begin" to start the role-play
   - DO NOT start role-playing until student says the trigger words

2. ROLE-PLAY STATE (after student says "Let's start" or "Begin"):
   - Switch to character as ${scenario.aiRole}
   - Embody this personality: ${scenario.aiPersonality || rolePlayInstructions.aiPersonality || `helpful and patient ${scenario.aiRole}`}
   - Start with one of these opening lines (if available): ${scenario.aiOpeningLines?.join(' OR ') || rolePlayInstructions.openingLines?.join(' OR ') || 'Use a natural greeting appropriate for the situation'}
   - RESPOND ONLY IN ${targetLang} (the language being learned)
   - Use ONLY the allowed vocabulary and grammar
   - Follow the conversation flow stages
   - Stay in character throughout
   - Track progress toward the objective

3. COMPLETION STATE (when objective is achieved):
   - Recognize when the role-play objective is completed
   - IMPORTANT: Only suggest completion if at least 15 minutes have passed
   - If objectives are met but time is insufficient, continue with:
     * Additional practice scenarios
     * Variations of the conversation
     * More challenging vocabulary or grammar
     * Cultural context discussions
   - When BOTH objective completion AND 15+ minutes are met:
     * Break character and congratulate the student in ${nativeLang}
     * Summarize what was accomplished
     * Provide positive feedback on their performance
     * Use completion phrases appropriate to the native language for congratulations:
       - English: "Thank you for practicing with me today!", "Have a fantastic day!", "Feel free to reach out if you have questions", "Good bye!", "See you next time!"
       - German: "Vielen Dank fürs Üben heute!", "Haben Sie einen schönen Tag!", "Auf Wiedersehen!", "Bis zum nächsten Mal!", "Tschüss!", "Gut gemacht!"
       - Tamil: "பயிற்சிக்கு நன்றி!", "நல்ல நாள் இருக்கட்டும்!", "வாழ்த்துக்கள்!", "அடுத்த முறை சந்திப்போம்!"
       - Sinhala: "පුහුණුවීමට ස්තූතියි!", "හොඳ දිනයක් වේවා!", "සුභපැතුම්!", "ඊළඟ වතාවේ හමුවෙමු!"
     * Include appropriate ${nativeLang} farewell expressions for the completion state
     * The system will automatically detect these completion signals and mark the module as completed

4. MANUAL STOP (if student says "stop", "end", "finish", "quit"):
   - Break character immediately
   - Thank them for practicing in ${nativeLang}
   - Provide encouragement about their progress
   - End the session gracefully

VOCABULARY CONSTRAINTS (CRITICAL - ONLY USE THESE):
${allowedVocab.map(v => `${v.word} (${v.translation})`).join(', ')}

GRAMMAR CONSTRAINTS (CRITICAL - ONLY USE THESE):
${allowedGrammar.map(g => `${g.structure}: ${g.examples.join(', ')}`).join(' | ')}

SUGGESTED STUDENT RESPONSES (to share during introduction):
${scenario.suggestedStudentResponses?.join(' | ') || rolePlayInstructions.suggestedResponses?.join(' | ') || 'No specific suggestions - encourage natural responses'}

CONVERSATION FLOW STAGES:
${conversationFlow.length > 0 ? 
  conversationFlow.map((flow, index) => 
    `Stage ${index + 1} "${flow.stage}": AI says: ${flow.aiPrompts.join(' OR ')}. Student should: ${flow.expectedResponses.join(' OR ')}`
  ).join('\n') 
  : 'No specific flow - let conversation develop naturally within constraints'}

IMPORTANT: Always respond in plain text, not JSON format. Be natural and conversational.

LANGUAGE INSTRUCTIONS:
- INTRODUCTION STATE: Respond in ${nativeLang} (for explanations)
- ROLE-PLAY STATE: Respond ONLY in ${targetLang} (the language being learned)
- COMPLETION STATE: Respond in ${nativeLang} (for congratulations)

CRITICAL RULES:
1. START in INTRODUCTION state - explain everything before role-playing
2. WAIT for "Let's start" or "Begin" before switching to role-play
3. DURING ROLE-PLAY: Use ONLY ${targetLang} language and allowed vocabulary/grammar
4. EMBODY the specified AI role personality throughout the role-play
5. USE the provided opening lines when starting the role-play
6. DETECT when objective is completed and switch to completion state
7. RESPOND to stop words ("stop", "end", "finish", "quit") immediately
8. STAY in character during active role-play state
9. TRACK progress toward the objective throughout the session
10. STRICTLY FOLLOW the CEFR level response rules above — response length and complexity MUST match the student's level. For A1/A2: keep it SHORT and SIMPLE. Never write long responses for beginners.

Remember: You are managing a structured role-play session with clear personality, opening lines, and guidance for both roles!`;

    return rolePlayPrompt;
  }

  /**
   * Build conversation history for context
   */
  buildConversationHistory(previousMessages) {
    if (!previousMessages || previousMessages.length === 0) {
      return [];
    }

    // Convert messages to OpenAI format, keeping last 10 messages for context
    return previousMessages.slice(-10).map(msg => ({
      role: msg.role === 'tutor' ? 'assistant' : 'user',
      content: msg.content
    }));
  }

  /**
   * Fallback response when OpenAI fails
   */
  getFallbackResponse(context) {
    const { sessionType, module } = context;
    
    const fallbackResponses = {
      practice: `Let's practice some German! I'm here to help you with ${module.title}. What would you like to work on?`,
      conversation: `Hallo! Let's have a German conversation. Try to speak as much German as you can!`,
      assessment: `I'll help you test your knowledge of ${module.title}. Are you ready for some questions?`,
      help: `I'm here to help you understand German better. What specific topic would you like me to explain?`,
      review: `Let's review what you've learned in ${module.title}. What topic should we start with?`
    };

    return {
      content: fallbackResponses[sessionType] || fallbackResponses.practice,
      messageType: 'text',
      suggestions: [
        'Can you help me with pronunciation?',
        'I need practice with grammar',
        'Let\'s do some exercises'
      ]
    };
  }

  /**
   * Fallback evaluation when OpenAI fails
   */
  getFallbackEvaluation(studentAnswer, correctAnswer) {
    const isCorrect = studentAnswer.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
    
    return {
      isCorrect,
      score: isCorrect ? 100 : 0,
      feedback: isCorrect 
        ? 'Correct! Well done!' 
        : `Not quite right. The correct answer is: ${correctAnswer}`,
      points: isCorrect ? 1 : 0
    };
  }

  /**
   * Fallback exercise when OpenAI fails
   */
  getFallbackExercise(module, exerciseType) {
    return {
      type: exerciseType,
      question: `Practice question for ${module.title}`,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correctAnswer: 'Option A',
      explanation: 'This is a practice exercise.',
      points: 1
    };
  }

  /**
   * Get CEFR level-based response guidelines to control AI verbosity and complexity
   */
  getCefrLevelGuidelines(level) {
    const guidelines = {
      'A1': `
CEFR A1 (BEGINNER) - RESPONSE RULES:
- Keep responses VERY SHORT: 1-2 simple sentences maximum during role-play
- Use ONLY basic, everyday words (no compound words, no idioms, no abstract vocabulary)
- Use ONLY present tense and simple sentence structures (Subject + Verb + Object)
- Speak slowly and clearly — short phrases, not paragraphs
- ONE idea per message — never combine multiple thoughts
- If correcting mistakes, use 1 short sentence max
- Avoid subordinate clauses, relative clauses, or complex connectors
- Use simple greetings, numbers, colors, basic nouns and verbs only
- Maximum response length: 15-20 words during role-play
- For introductions/explanations in native language: keep under 3-4 short sentences`,

      'A2': `
CEFR A2 (ELEMENTARY) - RESPONSE RULES:
- Keep responses SHORT: 2-3 simple sentences maximum during role-play
- Use basic everyday vocabulary with some common expressions
- Use present tense primarily, simple past when needed
- Simple sentence structures with basic connectors (and, but, because)
- TWO ideas maximum per message
- Short corrections with one brief example
- Maximum response length: 25-30 words during role-play
- For introductions/explanations in native language: keep under 4-5 sentences`,

      'B1': `
CEFR B1 (INTERMEDIATE) - RESPONSE RULES:
- Moderate response length: 3-4 sentences during role-play
- Use common vocabulary with some less frequent words
- Can use past, present, future tenses and basic conditionals
- Use connectors and some subordinate clauses
- Provide brief explanations when correcting
- Maximum response length: 40-50 words during role-play`,

      'B2': `
CEFR B2 (UPPER INTERMEDIATE) - RESPONSE RULES:
- Normal conversational length: 4-5 sentences during role-play
- Use varied vocabulary including some idiomatic expressions
- All tenses, conditionals, passive voice allowed
- Complex sentence structures are fine
- Can include nuanced corrections with examples
- Maximum response length: 60-70 words during role-play`,

      'C1': `
CEFR C1 (ADVANCED) - RESPONSE RULES:
- Natural conversational length with rich vocabulary
- Use idiomatic expressions, nuanced language, and varied structures
- All grammar structures including subjunctive and complex clauses
- Detailed corrections with explanations of subtle differences
- Maximum response length: 80-100 words during role-play`,

      'C2': `
CEFR C2 (MASTERY) - RESPONSE RULES:
- Full natural conversation with no restrictions on complexity
- Use sophisticated vocabulary, idioms, humor, and cultural references
- All grammar structures including rare or literary forms
- Nuanced feedback on style, register, and tone
- No strict word limit — respond naturally as a native speaker would`
    };

    return guidelines[level] || guidelines['B1'];
  }

  /**
   * Get language-specific teaching guidelines
   */
  getLanguageSpecificGuidelines(targetLang, nativeLang) {
    const guidelines = {
      'German': `
- Focus on German grammar rules (cases, verb conjugations, word order)
- Emphasize pronunciation of umlauts (ä, ö, ü) and ß
- Explain German cultural context and formality levels (Sie vs du)
- Include compound words and their formation
- Mention regional variations when relevant`,
      
      'English': `
- Focus on English grammar (tenses, articles, prepositions)
- Emphasize pronunciation differences and silent letters
- Explain cultural context and formality levels
- Include phrasal verbs and idiomatic expressions
- Mention British vs American English differences when relevant`,
      
      'Spanish': `
- Focus on Spanish grammar (gender, verb conjugations, subjunctive)
- Emphasize pronunciation of rolled R and accent marks
- Explain cultural context across Spanish-speaking countries
- Include formal vs informal address (tú vs usted)
- Mention regional variations when relevant`,
      
      'French': `
- Focus on French grammar (gender, verb conjugations, liaisons)
- Emphasize pronunciation of nasal sounds and silent letters
- Explain cultural context and formality levels (tu vs vous)
- Include accent marks and their importance
- Mention francophone cultural differences when relevant`,
      
      'Italian': `
- Focus on Italian grammar (gender, verb conjugations, articles)
- Emphasize pronunciation and double consonants
- Explain cultural context and regional variations
- Include formal vs informal address (tu vs Lei)
- Mention Italian cultural nuances when relevant`,
      
      'Portuguese': `
- Focus on Portuguese grammar (gender, verb conjugations, articles)
- Emphasize pronunciation differences from Spanish
- Explain cultural context (Brazilian vs European Portuguese)
- Include formal vs informal address
- Mention regional variations when relevant`,
      
      'Dutch': `
- Focus on Dutch grammar (word order, verb conjugations)
- Emphasize pronunciation of unique Dutch sounds
- Explain cultural context in Netherlands and Belgium
- Include formal vs informal address (je vs u)
- Mention regional variations when relevant`,
      
      'Swedish': `
- Focus on Swedish grammar (definite articles, verb conjugations)
- Emphasize pronunciation and pitch accent
- Explain cultural context and Swedish social norms
- Include formal vs informal address (du vs ni)
- Mention regional variations when relevant`
    };
    
    return guidelines[targetLang] || `
- Focus on ${targetLang} grammar and pronunciation
- Provide cultural context relevant to ${targetLang}-speaking regions
- Explain formality levels and social conventions
- Include practical examples for real-world use`;
  }

  /**
   * Translate text using OpenAI GPT-5.1
   * Uses the latest GPT-5.1 model with "no reasoning" mode for fast, high-quality translations
   */
  async translateText(text, fromLanguage, toLanguage) {
    try {
      console.log('🔤 OpenAI Translation:', { text: text.substring(0, 50), fromLanguage, toLanguage });
      
      const translationPrompt = `Translate the following text from ${fromLanguage} to ${toLanguage}. 
      
Provide ONLY the translation, no explanations or additional text.

Text to translate: "${text}"

Translation:`;

      // Use GPT-5.1 for translations - latest and highest quality model available
      // Alternative models you can use:
      // - 'gpt-5.1': Latest model with best quality and adaptive reasoning (recommended)
      // - 'gpt-5': High quality but slower than 5.1
      // - 'gpt-4o': Good quality but older generation
      // - 'gpt-4o-mini': Balanced quality and cost but lower than GPT-5 series
      const translationModel = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-5.1';

      const completion = await this.openai.chat.completions.create({
        model: translationModel,
        messages: [
          { 
            role: 'system', 
            content: `You are a professional translator. Translate accurately from ${fromLanguage} to ${toLanguage}. Provide only the translation, no explanations.` 
          },
          { role: 'user', content: translationPrompt }
        ],
        // GPT-5.1 uses max_completion_tokens instead of max_tokens
        ...(translationModel === 'gpt-5.1' ? 
          { max_completion_tokens: 200 } : 
          { max_tokens: 200 }
        ),
        temperature: 0.1, // Low temperature for consistent translations
        // Use "no reasoning" mode for GPT-5.1 to make translations faster
        ...(translationModel === 'gpt-5.1' && { reasoning_effort: 'none' })
      });

      const translation = completion.choices[0].message.content.trim();
      console.log('✅ OpenAI translation success:', translation);
      
      return {
        success: true,
        translatedText: translation,
        service: 'OpenAI'
      };
    } catch (error) {
      console.error('❌ OpenAI translation error:', error);
      return {
        success: false,
        error: error.message,
        service: 'OpenAI'
      };
    }
  }

  /**
   * Check if OpenAI is properly configured
   */
  isConfigured() {
    return !!process.env.OPENAI_API_KEY;
  }

  /**
   * Test OpenAI connection
   */
  async testConnection() {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10
      });
      
      return { success: true, message: 'OpenAI connection successful' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = OpenAIService;