// routes/aiTutor.js - Complete version with teacher testing support

const express = require('express');
const router = express.Router();
const AiTutorSession = require('../models/AiTutorSession');
const LearningModule = require('../models/LearningModule');
const StudentProgress = require('../models/StudentProgress');
const { verifyToken, checkRole } = require('../middleware/auth');
const { requirePlatinum } = require('../middleware/subscriptionCheck');
const { v4: uuidv4 } = require('uuid');
const OpenAIService = require('../services/openaiService');

// Initialize OpenAI service with DG bot key
const openaiService = new OpenAIService(process.env.DG_OPENAI_API_KEY);

// Helper function to generate language-specific role-play welcome messages
async function generateRolePlayWelcome(targetLanguage, scenario) {
  let studentRole = scenario.studentRole;
  let aiRole = scenario.aiRole;

  // Welcome message is always in German
  const welcome = `Willkommen zur Rollenspiel-Sitzung! Du bist ${studentRole}, ich bin ${aiRole}. Sage "Los geht's" oder "Beginnen wir", um zu starten, oder "Stopp", um die Sitzung zu beenden.`;

  // Trigger words include both English and target language variants
  const triggersByLang = {
    'German': {
      start: ["Let's start", "Start", "Begin", "Go", "Los geht's", "Beginnen wir", "Anfangen"],
      stop: ["Stop", "End", "Quit", "Finish", "Stopp", "Ende", "Aufhören", "Beenden"]
    }
  };

  const defaultTriggers = {
    start: ["Let's start", "Start", "Begin", "Go", "Los geht's", "Beginnen wir", "Anfangen"],
    stop: ["Stop", "End", "Quit", "Finish"]
  };

  return {
    welcome,
    triggers: triggersByLang[targetLanguage] || defaultTriggers
  };
}

// Enhanced AI Tutor Service using ChatGPT-4o
class AiTutorService {
  static async generateResponse(message, context) {
    // Check if OpenAI is configured
    if (openaiService.isConfigured()) {
      try {
        console.log('🤖 Using OpenAI ChatGPT-4o for response generation');
        return await openaiService.generateTutorResponse({
          message,
          ...context
        });
      } catch (error) {
        console.error('❌ OpenAI service error, falling back to mock:', error);
        return this.generateMockResponse(message, context);
      }
    } else {
      console.warn('⚠️ OpenAI not configured, using mock responses');
      return this.generateMockResponse(message, context);
    }
  }

  static async evaluateAnswer(studentAnswer, correctAnswer, context) {
    // Use OpenAI for intelligent evaluation
    if (openaiService.isConfigured()) {
      try {
        return await openaiService.evaluateGermanAnswer(studentAnswer, correctAnswer, context);
      } catch (error) {
        console.error('OpenAI evaluation error, falling back to simple evaluation:', error);
        return this.simpleMockEvaluation(studentAnswer, correctAnswer);
      }
    } else {
      return this.simpleMockEvaluation(studentAnswer, correctAnswer);
    }
  }

  static async generateExercise(module, difficulty = 'medium', exerciseType = 'multiple-choice') {
    // Use OpenAI to generate dynamic exercises
    if (openaiService.isConfigured()) {
      try {
        return await openaiService.generateExercise(module, difficulty, exerciseType);
      } catch (error) {
        console.error('OpenAI exercise generation error, falling back to mock:', error);
        return this.generateMockExercise(module, exerciseType);
      }
    } else {
      return this.generateMockExercise(module, exerciseType);
    }
  }

  // Fallback mock responses (keep existing implementation as backup)
  static generateMockResponse(message, context) {
    const { module, sessionType } = context;
    
    if (sessionType === 'practice') {
      return this.generatePracticeResponse(message, module);
    } else if (sessionType === 'assessment') {
      return this.generateAssessmentResponse(message, module);
    } else if (sessionType === 'help') {
      return this.generateHelpResponse(message, module);
    } else {
      return this.generateConversationResponse(message, module);
    }
  }
  
  static generatePracticeResponse(message, module) {
    const responses = [
      `Great question! Let's practice this concept from the ${module.title} module.`,
      `I see you're working on ${module.category}. Let me help you with that.`,
      `Excellent! That's related to our current topic. Here's what you need to know...`,
      `Let's break this down step by step. This concept works like this...`
    ];
    
    return {
      content: responses[Math.floor(Math.random() * responses.length)],
      messageType: 'text',
      suggestions: [
        'Tell me more',
        'Give me an exercise',
        'I need help',
        'Continue conversation'
      ]
    };
  }
  
  static generateAssessmentResponse(message, module) {
    // Generate a random exercise from the module
    if (module.content.exercises && module.content.exercises.length > 0) {
      const exercise = module.content.exercises[Math.floor(Math.random() * module.content.exercises.length)];
      
      return {
        content: `Let's test your understanding: ${exercise.question}`,
        messageType: 'exercise',
        exercise: {
          type: exercise.type,
          question: exercise.question,
          options: exercise.options || [],
          correctAnswer: exercise.correctAnswer
        }
      };
    }
    
    return {
      content: 'Let me create a custom exercise for you based on what we\'ve been learning.',
      messageType: 'text'
    };
  }
  
  static generateHelpResponse(message, module) {
    const helpResponses = [
      `I'm here to help! What specific part of ${module.title} are you struggling with?`,
      `No worries, let's work through this together. Can you tell me what's confusing you?`,
      `That's a common question in language learning. Let me explain it clearly...`,
      `Great question! Let me break this down for you step by step.`
    ];
    
    return {
      content: helpResponses[Math.floor(Math.random() * helpResponses.length)],
      messageType: 'help',
      suggestions: [
        'Explain grammar',
        'Give examples',
        'Practice exercises',
        'Continue'
      ]
    };
  }
  
  static generateConversationResponse(message, module) {
    const conversationStarters = [
      `Hallo! Lass uns ein Gespraech auf ${module.targetLanguage} ueben. Wie geht es dir heute?`,
      `Schoen, dich zu sehen! Lass uns auf ${module.targetLanguage} sprechen. Worueber moechtest du reden?`,
      `Willkommen! Ich helfe dir, ${module.targetLanguage} zu ueben. Lass uns mit einem Gespraech starten!`
    ];
    
    return {
      content: conversationStarters[Math.floor(Math.random() * conversationStarters.length)],
      messageType: 'conversation',
      suggestions: [
        'Tell me about yourself',
        'Ask me a question',
        'Practice vocabulary',
        'Role-play scenario'
      ]
    };
  }
  
  static simpleMockEvaluation(studentAnswer, correctAnswer) {
    // Simple evaluation logic - enhance based on exercise type
    const isCorrect = studentAnswer.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
    
    let feedback = '';
    if (isCorrect) {
      feedback = 'Excellent! That\'s correct. Well done!';
    } else {
      feedback = `Not quite right. The correct answer is: ${correctAnswer}. Let me explain why...`;
    }
    
    return {
      isCorrect,
      feedback,
      points: isCorrect ? 10 : 0
    };
  }

  static generateMockExercise(module, exerciseType) {
    // Generate a simple mock exercise
    const exercises = {
      'multiple-choice': {
        type: 'multiple-choice',
        question: `Which greeting is appropriate for ${module.level} level?`,
        options: ['Hello', 'Hi there', 'Good morning', 'Hey'],
        correctAnswer: 'Good morning'
      },
      'fill-blank': {
        type: 'fill-blank',
        question: `Complete the sentence: "I am _____ to meet you."`,
        correctAnswer: 'pleased'
      },
      'translation': {
        type: 'translation',
        question: `Translate to ${module.targetLanguage}: "How are you?"`,
        correctAnswer: module.targetLanguage === 'German' ? 'Wie geht es dir?' : 'How are you?'
      }
    };

    return exercises[exerciseType] || exercises['multiple-choice'];
  }
  
  // Check if module is actually completed based on learning objectives
  static checkModuleCompletion(aiResponse, session, context) {
    const module = context.module;
    const messages = session.messages;
    
    // ✅ RULE 1: Check if AI response indicates completion
    const completionIndicators = [
      'objectives completed', 'learning goals achieved', 'module finished',
      'all topics covered', 'practice complete', 'well done completing',
      'ziele erreicht', 'lernziele abgeschlossen', 'modul beendet',
      'alle themen behandelt', 'übung abgeschlossen'
    ];
    
    const hasCompletionIndicator = completionIndicators.some(indicator => 
      aiResponse.content.toLowerCase().includes(indicator.toLowerCase())
    );
    
    // ✅ RULE 2: Check minimum time requirement (from module configuration)
    const requiredMinutes = module.minimumCompletionTime || 15; // Default to 15 if not set
    const sessionDurationMs = Date.now() - session.startTime.getTime();
    const sessionDurationMinutes = Math.round(sessionDurationMs / 60000);
    const hasMinimumTime = sessionDurationMinutes >= requiredMinutes;
    
    console.log('🕐 Session Duration Check:', {
      durationMinutes: sessionDurationMinutes,
      requiredMinutes,
      hasMinimumTime,
      moduleTitle: module.title
    });
    
    // Check if learning objectives are met
    const objectives = module.learningObjectives || [];
    const objectivesMet = objectives.length === 0 || // No specific objectives
      this.checkObjectivesCompletion(objectives, messages, module);
    
    // Check minimum interaction threshold
    const minMessages = 10; // Minimum meaningful conversation
    const hasMinInteraction = messages.filter(m => m.role === 'student').length >= minMessages;
    
    // Check if role-play scenario is completed (for role-play modules)
    const isRolePlayComplete = module.content?.rolePlayScenario ? 
      this.checkRolePlayCompletion(messages, module.content.rolePlayScenario) : true;
    
    // ✅ BOTH conditions must be met: completion indicators AND minimum time (from module)
    const canComplete = hasCompletionIndicator && objectivesMet && hasMinInteraction && isRolePlayComplete && hasMinimumTime;
    
    console.log('✅ Module Completion Check:', {
      hasCompletionIndicator,
      objectivesMet,
      hasMinInteraction,
      isRolePlayComplete,
      hasMinimumTime,
      canComplete
    });
    
    return canComplete;
  }
  
  // Check if learning objectives are completed
  static checkObjectivesCompletion(objectives, messages, module) {
    if (!objectives || objectives.length === 0) return true;
    
    let completedObjectives = 0;
    const studentMessages = messages.filter(m => m.role === 'student').map(m => m.content.toLowerCase());
    const conversationText = studentMessages.join(' ');
    
    objectives.forEach(objective => {
      const keywords = objective.keywords || [];
      const hasKeywords = keywords.some(keyword => 
        conversationText.includes(keyword.toLowerCase())
      );
      
      if (hasKeywords) {
        completedObjectives++;
      }
    });
    
    // At least 70% of objectives should be covered
    return completedObjectives >= Math.ceil(objectives.length * 0.7);
  }
  
  // Check if role-play scenario is completed
  static checkRolePlayCompletion(messages, scenario) {
    const conversationFlow = scenario.conversationFlow || [];
    if (conversationFlow.length === 0) return true; // No specific flow defined
    
    const studentMessages = messages.filter(m => m.role === 'student').map(m => m.content.toLowerCase());
    const conversationText = studentMessages.join(' ');
    
    let completedStages = 0;
    conversationFlow.forEach(stage => {
      const expectedResponses = stage.expectedResponses || [];
      const hasExpectedResponse = expectedResponses.some(response => 
        conversationText.includes(response.toLowerCase())
      );
      
      if (hasExpectedResponse) {
        completedStages++;
      }
    });
    
    // At least 80% of conversation stages should be completed
    return completedStages >= Math.ceil(conversationFlow.length * 0.8);
  }
}

// POST /api/ai-tutor/start-teacher-test - Start teacher test session (TEACHERS/ADMINS ONLY)
router.post('/start-teacher-test', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { moduleId, sessionType = 'teacher-test' } = req.body;
    const teacherId = req.user.id;
    
    console.log('🧪 Teacher test session requested:', { 
      moduleId, 
      teacherId, 
      sessionType 
    });
    
    // Validate moduleId format
    if (!moduleId || typeof moduleId !== 'string' || moduleId.length !== 24) {
      console.log('❌ Invalid moduleId format:', { moduleId });
      return res.status(400).json({ message: `Invalid module ID format: ${moduleId}` });
    }
    
    // Validate module exists
    const module = await LearningModule.findById(moduleId).lean();
    if (!module || !module.isActive) {
      console.log('❌ Module not found:', { moduleId, found: !!module, active: module?.isActive });
      return res.status(404).json({ message: 'Module not found or inactive' });
    }
    
    // Allow teachers to test any module (removed restriction)
    console.log('🔍 Teacher permission check:', {
      teacherRole: req.user.role,
      teacherId: teacherId,
      moduleCreatedBy: module.createdBy.toString(),
      isOwnModule: module.createdBy.toString() === teacherId,
      allowTesting: true // Allow all teachers to test any module
    });
    
    console.log('🔍 Module loaded for teacher test:', {
      title: module.title,
      createdBy: module.createdBy,
      hasRolePlayScenario: !!module.content?.rolePlayScenario
    });
    
    // Create new test session
    const sessionId = uuidv4();
    const session = new AiTutorSession({
      sessionId,
      studentId: teacherId, // Use teacher ID as student ID for test
      moduleId,
      sessionType,
      isTestSession: true, // Mark as test session
      context: {
        previousSessions: 0,
        currentLevel: module.level,
        strugglingAreas: [],
        strongAreas: [],
        preferredLearningStyle: 'interactive',
        isTeacherTest: true
      }
    });

    // Generate welcome message based on module type
    const welcomeContext = {
      module,
      studentLevel: module.level,
      sessionType,
      previousMessages: []
    };
    
    let welcomeResponse;
    
    // Check if this is a role-play module
    if (module.content?.rolePlayScenario) {
      // For role-play modules, start with introduction state
      const scenario = module.content.rolePlayScenario;
      
      // Generate language-specific welcome message
      const welcomeData = await generateRolePlayWelcome(module.targetLanguage, scenario);
      
      welcomeResponse = {
        content: welcomeData.welcome,
        messageType: 'role-play-intro',
        metadata: {
          sessionState: 'introduction',
          waitingForTrigger: true,
          targetLanguage: module.targetLanguage,
          triggerWords: welcomeData.triggers,
          rolePlayDetails: {
            scenario: scenario.situation,
            setting: scenario.setting || 'A typical situation',
            studentRole: scenario.studentRole,
            aiRole: scenario.aiRole,
            objective: scenario.objective || 'Practice natural conversation',
            allowedVocabulary: module.content.allowedVocabulary || [],
            allowedGrammar: module.content.allowedGrammar || [],
            conversationFlow: module.content.conversationFlow || []
          }
        }
      };
    } else {
      // Regular module welcome
      welcomeResponse = await AiTutorService.generateResponse(
        'start_session',
        welcomeContext
      );
    }
    
    // Add welcome message
    session.messages.push({
      role: 'tutor',
      content: welcomeResponse.content,
      messageType: welcomeResponse.messageType || 'text',
      metadata: welcomeResponse.metadata || {}
    });
    
    await session.save();
    
    console.log('✅ Teacher test session created:', sessionId);
    
    res.json({
      sessionId,
      module: {
        _id: module._id,
        title: module.title,
        description: module.description,
        level: module.level,
        category: module.category,
        targetLanguage: module.targetLanguage,
        nativeLanguage: module.nativeLanguage,
        content: module.content,
        aiTutorConfig: module.aiTutorConfig
      },
      sessionType,
      isTestSession: true,
      welcomeMessage: session.messages[0],
      suggestions: welcomeResponse.suggestions || [],
      message: 'Teacher test session started successfully'
    });
  } catch (error) {
    console.error('❌ Error starting teacher test session:', error);
    res.status(500).json({ message: 'Error starting teacher test session' });
  }
});

// POST /api/ai-tutor/start-session - Start regular student session (PLATINUM STUDENTS ONLY)
router.post('/start-session', verifyToken, requirePlatinum, async (req, res) => {
  try {
    const { moduleId, sessionType = 'practice' } = req.body;
    const studentId = req.user.id;
    
    console.log('🎓 Student session requested:', { 
      moduleId, 
      studentId, 
      sessionType,
      studentRole: req.user.role
    });
    
    // Validate moduleId format
    if (!moduleId || typeof moduleId !== 'string' || moduleId.length !== 24) {
      console.log('❌ Invalid moduleId format:', { moduleId });
      return res.status(400).json({ message: `Invalid module ID format: ${moduleId}` });
    }
    
    // Validate module exists
    const module = await LearningModule.findById(moduleId).lean();
    if (!module || !module.isActive) {
      console.log('❌ Module not found:', { moduleId, found: !!module, active: module?.isActive });
      return res.status(404).json({ message: 'Module not found or inactive' });
    }
    
    console.log('🔍 Module loaded for student session:', {
      title: module.title,
      level: module.level,
      category: module.category
    });
    
    // Get student's previous progress for this module
    let studentProgress = await StudentProgress.findOne({
      studentId,
      moduleId
    }).lean();
    
    // Create new session
    const sessionId = uuidv4();
    const session = new AiTutorSession({
      sessionId,
      studentId,
      moduleId,
      sessionType,
      isTestSession: false,
      context: {
        previousSessions: studentProgress?.sessionsCompleted || 0,
        currentLevel: module.level,
        strugglingAreas: studentProgress?.strugglingAreas || [],
        strongAreas: studentProgress?.strongAreas || [],
        preferredLearningStyle: 'interactive',
        isTeacherTest: false
      }
    });

    // Generate welcome message based on module type
    const welcomeContext = {
      module,
      studentLevel: module.level,
      sessionType,
      previousMessages: [],
      studentProgress
    };
    
    let welcomeResponse;
    
    // Check if this is a role-play module
    if (module.content?.rolePlayScenario) {
      // For role-play modules, start with introduction state
      const scenario = module.content.rolePlayScenario;
      
      // Generate language-specific welcome message
      const welcomeData = await generateRolePlayWelcome(module.targetLanguage, scenario);
      
      welcomeResponse = {
        content: welcomeData.welcome,
        messageType: 'role-play-intro',
        metadata: {
          sessionState: 'introduction',
          waitingForTrigger: true,
          targetLanguage: module.targetLanguage,
          triggerWords: welcomeData.triggers,
          rolePlayDetails: {
            scenario: scenario.situation,
            setting: scenario.setting || 'A typical situation',
            studentRole: scenario.studentRole,
            aiRole: scenario.aiRole,
            objective: scenario.objective || 'Practice natural conversation',
            allowedVocabulary: module.content.allowedVocabulary || [],
            allowedGrammar: module.content.allowedGrammar || [],
            conversationFlow: module.content.conversationFlow || []
          }
        }
      };
    } else {
      // Regular module welcome
      welcomeResponse = await AiTutorService.generateResponse(
        'start_session',
        welcomeContext
      );
    }
    
    // Add welcome message
    session.messages.push({
      role: 'tutor',
      content: welcomeResponse.content,
      messageType: welcomeResponse.messageType || 'text',
      metadata: welcomeResponse.metadata || {}
    });
    
    await session.save();
    
    console.log('✅ Student session created:', sessionId);
    
    res.json({
      sessionId,
      module: {
        _id: module._id,
        title: module.title,
        description: module.description,
        level: module.level,
        category: module.category,
        targetLanguage: module.targetLanguage,
        nativeLanguage: module.nativeLanguage,
        content: module.content,
        aiTutorConfig: module.aiTutorConfig
      },
      sessionType,
      isTestSession: false,
      welcomeMessage: session.messages[0],
      suggestions: welcomeResponse.suggestions || [],
      message: 'Student session started successfully'
    });
  } catch (error) {
    console.error('❌ Error starting student session:', error);
    res.status(500).json({ message: 'Error starting student session' });
  }
});

// POST /api/ai-tutor/send-message - Send message to AI tutor
router.post('/send-message', verifyToken, async (req, res) => {
  try {
    const { sessionId, message, messageType = 'text', exerciseAnswer } = req.body;
    const userId = req.user.id;
    
    // Find session - check if it's a test session or regular session
    const session = await AiTutorSession.findOne({ 
      sessionId, 
      studentId: userId,
      status: 'active'
    }).populate('moduleId');
    
    if (!session) {
      return res.status(404).json({ message: 'Active session not found' });
    }
    
    // Check permissions based on session type
    if (session.isTestSession) {
      // Test session - allow teachers and admins
      if (!['TEACHER', 'ADMIN'].includes(req.user.role)) {
        return res.status(403).json({ message: 'Test sessions are only available to teachers and admins' });
      }
      console.log('🧪 Teacher test message received:', { sessionId, message: message.substring(0, 50) + '...' });
    } else {
      // Regular session - check student role and subscription
      if (req.user.role !== 'STUDENT') {
        return res.status(403).json({ message: 'Regular AI tutoring is only available to students' });
      }
      
      // Check PLATINUM subscription for regular sessions
      const subscriptionCheck = require('../middleware/subscriptionCheck');
      const hasAccess = await new Promise((resolve) => {
        subscriptionCheck.requirePlatinum(req, res, (err) => {
          resolve(!err);
        });
      });
      
      if (!hasAccess) {
        return res.status(403).json({ message: 'PLATINUM subscription required for AI tutoring' });
      }
    }
    
    // Add student message
    const studentMessage = {
      role: 'student',
      content: message,
      messageType,
      timestamp: new Date()
    };
    
    if (exerciseAnswer) {
      studentMessage.metadata = { studentAnswer: exerciseAnswer };
    }
    
    session.messages.push(studentMessage);
    
    // Track vocabulary usage from student message
    if (session.moduleId.vocabulary && Array.isArray(session.moduleId.vocabulary)) {
      const moduleVocabulary = session.moduleId.vocabulary.map(v => {
        if (typeof v === 'string') return v.toLowerCase();
        if (v.german) return v.german.toLowerCase();
        if (v.word) return v.word.toLowerCase();
        return null;
      }).filter(Boolean);
      
      const messageWords = message.toLowerCase()
        .replace(/[^\wäöüß\s]/gi, ' ') // Keep German characters
        .split(/\s+/)
        .filter(word => word.length > 2); // Only words with 3+ characters
      
      const usedVocabulary = [];
      
      // Check each vocabulary item against the message
      moduleVocabulary.forEach(vocab => {
        // Check if the vocabulary word/phrase appears in the message
        if (message.toLowerCase().includes(vocab)) {
          usedVocabulary.push(vocab);
        }
      });
      
      if (usedVocabulary.length > 0) {
        // Initialize vocabularyUsed if it doesn't exist
        if (!session.analytics.vocabularyUsed) {
          session.analytics.vocabularyUsed = [];
        }
        
        // Add new vocabulary words (avoid duplicates)
        usedVocabulary.forEach(word => {
          if (!session.analytics.vocabularyUsed.includes(word)) {
            session.analytics.vocabularyUsed.push(word);
          }
        });
        
        console.log(`📚 Vocabulary tracked: ${usedVocabulary.join(', ')} (Total: ${session.analytics.vocabularyUsed.length})`);
      }
    }
    
    // Check for role-play session control commands
    const isRolePlayModule = session.moduleId.content?.rolePlayScenario;
    const lowerMessage = message.toLowerCase().trim();
    
    // ✅ CHECK FOR ROLE-PLAY START TRIGGERS
    if (isRolePlayModule) {
      const lastTutorMessage = session.messages
        .filter(m => m.role === 'tutor')
        .pop();
      
      // Check if we're in introduction state waiting for trigger
      const isWaitingForTrigger = lastTutorMessage?.metadata?.waitingForTrigger === true;
      
      if (isWaitingForTrigger) {
        // Check for start trigger words
        const startTriggers = [
          "let's start", "lets start", "let's begin", "lets begin",
          "start", "begin", "go", "ready", "ok", "okay",
          "los geht's", "los gehts", "beginnen wir", "anfangen", "start",
          "ஆரம்பிக்கலாம்", "தொடங்கலாம்", "ஆம்",
          "ආරම්භ කරමු", "පටන් ගනිමු", "ඔව්"
        ];
        
        const hasStartTrigger = startTriggers.some(trigger => 
          lowerMessage.includes(trigger.toLowerCase())
        );
        
        if (hasStartTrigger) {
          console.log('🎭 Role-play start trigger detected:', message);
          
          // Override the message to explicitly tell AI to start role-play
          const scenario = session.moduleId.content.rolePlayScenario;
          const explicitStartMessage = `The student said "${message}" which means they want to start the role-play. 

SWITCH TO ROLE-PLAY STATE NOW:
- You are now the ${scenario.aiRole}
- Embody this personality: ${scenario.aiPersonality || 'helpful and patient'}
- Start with your opening line in ${session.moduleId.targetLanguage}
- Use ONLY ${session.moduleId.targetLanguage} language from now on
- Use ONLY the allowed vocabulary and grammar
- Stay in character

Begin the role-play conversation now with your opening line.`;
          
          // Replace the student message with explicit instruction
          session.messages[session.messages.length - 1].content = explicitStartMessage;
          session.messages[session.messages.length - 1].metadata = {
            ...session.messages[session.messages.length - 1].metadata,
            originalMessage: message,
            triggerDetected: true,
            rolePlayStarted: true
          };
        }
      }
    }
    
    // Check for stop commands
    const stopCommands = ['stop', 'end', 'finish', 'quit', 'exit'];
    if (stopCommands.some(cmd => lowerMessage.includes(cmd))) {
      const stopResponse = {
        content: `⚠️ Session Stopped Before Completion

You ended the session early. Here's what happened:

**Session Summary:**
- Scenario: ${session.moduleId.content?.rolePlayScenario?.situation || 'Language practice'}
- Your role: ${session.moduleId.content?.rolePlayScenario?.studentRole || 'Student'}
- Practice time: ${Math.round((Date.now() - session.startTime) / 60000)} minutes

🔄 **Module Status: NOT COMPLETED**
To complete this module and earn full credit, you'll need to:
- Continue the conversation until the learning objectives are met
- Practice the full scenario from start to finish

💡 **Next Steps:**
- You can restart this module anytime to complete it
- Try to reach the conversation goals for full completion
- Don't worry - you can practice as many times as needed!

Keep practicing! 🌟`,
        messageType: 'role-play-incomplete',
        metadata: {
          sessionState: 'manually_ended',
          sessionEnded: true,
          moduleCompleted: false
        }
      };
      
      session.messages.push({
        role: 'tutor',
        content: stopResponse.content,
        messageType: stopResponse.messageType,
        timestamp: new Date(),
        metadata: stopResponse.metadata
      });
      
      await session.save();
      
      return res.json({
        message: 'Session ended by user',
        response: session.messages[session.messages.length - 1],
        suggestions: ['Try again', 'Choose different module', 'End session'],
        sessionStats: {
          totalMessages: session.messages.length,
          correctAnswers: session.analytics.correctAnswers,
          incorrectAnswers: session.analytics.incorrectAnswers,
          sessionScore: session.analytics.sessionScore
        }
      });
    }
    
    // Generate AI response using the full AI tutoring system
    const context = {
      module: session.moduleId,
      studentLevel: session.moduleId.level,
      sessionType: session.sessionType,
      previousMessages: session.messages.slice(-10), // Last 10 messages for context
      isTeacherTest: session.isTestSession
    };
    
    let aiResponse;
    
    // Handle exercise answers
    if (messageType === 'exercise_answer' && exerciseAnswer) {
      const lastTutorMessage = session.messages
        .filter(m => m.role === 'tutor' && m.messageType === 'exercise')
        .pop();
      
      if (lastTutorMessage && lastTutorMessage.metadata?.correctAnswer) {
        const evaluation = await AiTutorService.evaluateAnswer(
          exerciseAnswer,
          lastTutorMessage.metadata.correctAnswer,
          context
        );
        
        aiResponse = {
          content: evaluation.feedback,
          messageType: 'feedback',
          metadata: {
            isCorrect: evaluation.isCorrect,
            points: evaluation.points || 0,
            correctAnswer: lastTutorMessage.metadata.correctAnswer,
            studentAnswer: exerciseAnswer
          }
        };
        
        // Update session analytics
        if (evaluation.isCorrect) {
          session.analytics.correctAnswers++;
        } else {
          session.analytics.incorrectAnswers++;
        }
        session.analytics.sessionScore += evaluation.points || 0;
      }
    } else {
      // Generate regular AI response
      aiResponse = await AiTutorService.generateResponse(message, context);
    }
    
    // ✅ Check if AI is trying to end session prematurely (before minimum time)
    const requiredMinutes = session.moduleId.minimumCompletionTime || 15; // Get from module or default to 15
    const sessionDurationMs = Date.now() - session.startTime.getTime();
    const sessionDurationMinutes = Math.round(sessionDurationMs / 60000);
    const hasMinimumTime = sessionDurationMinutes >= requiredMinutes;
    
    // Check if AI response contains completion indicators
    const completionIndicators = [
      'objectives completed', 'learning goals achieved', 'module finished',
      'all topics covered', 'practice complete', 'well done completing',
      'thank you for practicing', 'see you next time', 'good bye', 'goodbye',
      'have a fantastic day', 'feel free to reach out',
      'vielen dank fürs üben', 'auf wiedersehen', 'bis zum nächsten mal', 'tschüss',
      'ziele erreicht', 'lernziele abgeschlossen', 'modul beendet',
      'பயிற்சிக்கு நன்றி', 'அடுத்த முறை சந்திப்போம்',
      'පුහුණුවීමට ස්තූතියි', 'ඊළඟ වතාවේ හමුවෙමු'
    ];
    
    const hasCompletionIndicator = completionIndicators.some(indicator => 
      aiResponse.content.toLowerCase().includes(indicator.toLowerCase())
    );
    
    // If AI tries to complete before minimum time, override and continue
    if (hasCompletionIndicator && !hasMinimumTime) {
      console.log(`⚠️ AI tried to complete session early (${sessionDurationMinutes} min < ${requiredMinutes} min required for "${session.moduleId.title}")`);
      
      // Override AI's completion attempt with continuation message
      const remainingMinutes = requiredMinutes - sessionDurationMinutes;
      aiResponse = {
        content: `Great progress! Let's continue practicing to reinforce what you've learned. We have about ${remainingMinutes} more minutes to explore this topic further. What would you like to practice next?`,
        messageType: 'text',
        suggestions: [
          'More practice exercises',
          'Review what we covered',
          'Try a harder example',
          'Ask a question'
        ],
        metadata: {
          earlyCompletionOverridden: true,
          sessionDurationMinutes,
          requiredMinutes
        }
      };
    }
    
    // Check for module completion (only if minimum time is met)
    const isModuleCompleted = AiTutorService.checkModuleCompletion(aiResponse, session, context);
    
    // If module is actually completed, ask for confirmation
    if (isModuleCompleted && !session.pendingCompletion) {
      session.pendingCompletion = true;
      
      const confirmationMessage = {
        role: 'tutor',
        content: `${aiResponse.content}\n\n🤔 **Would you like to end this session now?**\n\nType "yes" to complete the module or "continue" to keep practicing.`,
        messageType: 'completion-confirmation',
        timestamp: new Date(),
        metadata: {
          ...aiResponse.metadata,
          awaitingConfirmation: true,
          originalResponse: aiResponse.content
        }
      };
      
      session.messages.push(confirmationMessage);
      await session.save();
      
      return res.json({
        message: 'Completion confirmation requested',
        response: confirmationMessage,
        suggestions: ['Yes, end session', 'Continue practicing', 'Keep going'],
        sessionStats: {
          totalMessages: session.messages.length,
          correctAnswers: session.analytics.correctAnswers,
          incorrectAnswers: session.analytics.incorrectAnswers,
          sessionScore: session.analytics.sessionScore
        }
      });
    }
    
    // Handle confirmation responses
    if (session.pendingCompletion) {
      const confirmYes = ['yes', 'ja', 'ஆம்', 'ඔව්', 'end', 'finish', 'complete'];
      const confirmNo = ['no', 'nein', 'இல்லை', 'නැහැ', 'continue', 'keep going', 'more'];
      
      if (confirmYes.some(word => lowerMessage.includes(word))) {
        // ✅ CHECK MINIMUM TIME BEFORE ALLOWING COMPLETION
        const requiredMinutes = session.moduleId.minimumCompletionTime || 15;
        const sessionDurationMs = Date.now() - session.startTime.getTime();
        const sessionDurationMinutes = Math.round(sessionDurationMs / 60000);
        const hasMinimumTime = sessionDurationMinutes >= requiredMinutes;
        
        if (!hasMinimumTime) {
          // Reject completion - not enough time spent
          const remainingMinutes = requiredMinutes - sessionDurationMinutes;
          
          const rejectionResponse = {
            content: `I appreciate your enthusiasm, but we need to practice a bit more! This module requires at least ${requiredMinutes} minutes of practice time. We've spent ${sessionDurationMinutes} minutes so far, so let's continue for about ${remainingMinutes} more minutes to ensure you've fully mastered the material. What would you like to practice next?`,
            messageType: 'text',
            metadata: {
              completionRejected: true,
              reason: 'insufficient_time',
              sessionDurationMinutes,
              requiredMinutes,
              remainingMinutes
            }
          };
          
          session.messages.push({
            role: 'tutor',
            content: rejectionResponse.content,
            messageType: rejectionResponse.messageType,
            timestamp: new Date(),
            metadata: rejectionResponse.metadata
          });
          
          session.pendingCompletion = false; // Reset pending state
          await session.save();
          
          console.log(`⚠️ Completion rejected: ${sessionDurationMinutes} min < ${requiredMinutes} min required`);
          
          return res.json({
            message: 'Completion rejected - more practice time needed',
            response: session.messages[session.messages.length - 1],
            suggestions: ['Continue practicing', 'Ask questions', 'Try exercises'],
            sessionStats: {
              totalMessages: session.messages.length,
              correctAnswers: session.analytics.correctAnswers,
              incorrectAnswers: session.analytics.incorrectAnswers,
              sessionScore: session.analytics.sessionScore
            }
          });
        }
        
        // User confirmed completion AND minimum time is met
        const completionResponse = {
          content: `🎉 **Module Completed Successfully!**\n\nCongratulations! You've finished this learning module.\n\n**Session Summary:**\n- Practice time: ${sessionDurationMinutes} minutes\n- Total messages: ${session.messages.length}\n- Session score: ${session.analytics.sessionScore}\n\n✅ **Module Status: COMPLETED**\nGreat job! You can now move on to the next module or practice this one again anytime.\n\nKeep up the excellent work! 🌟`,
          messageType: 'module-completed',
          metadata: {
            sessionState: 'completed',
            sessionEnded: true,
            moduleCompleted: true,
            sessionDurationMinutes
          }
        };
        
        session.messages.push({
          role: 'tutor',
          content: completionResponse.content,
          messageType: completionResponse.messageType,
          timestamp: new Date(),
          metadata: completionResponse.metadata
        });
        
        session.status = 'completed';
        session.endTime = new Date();
        session.pendingCompletion = false;
        await session.save();
        
        return res.json({
          message: 'Module completed successfully',
          response: session.messages[session.messages.length - 1],
          suggestions: ['Start new module', 'Practice again', 'View progress'],
          sessionStats: {
            totalMessages: session.messages.length,
            correctAnswers: session.analytics.correctAnswers,
            incorrectAnswers: session.analytics.incorrectAnswers,
            sessionScore: session.analytics.sessionScore
          }
        });
      } else if (confirmNo.some(word => lowerMessage.includes(word))) {
        // User wants to continue
        session.pendingCompletion = false;
        
        const continueResponse = {
          content: `Great! Let's continue practicing. What would you like to work on next?`,
          messageType: 'text',
          metadata: {}
        };
        
        session.messages.push({
          role: 'tutor',
          content: continueResponse.content,
          messageType: continueResponse.messageType,
          timestamp: new Date(),
          metadata: continueResponse.metadata
        });
        
        await session.save();
        
        return res.json({
          message: 'Session continued',
          response: session.messages[session.messages.length - 1],
          suggestions: ['Ask a question', 'Practice more', 'Try exercises'],
          sessionStats: {
            totalMessages: session.messages.length,
            correctAnswers: session.analytics.correctAnswers,
            incorrectAnswers: session.analytics.incorrectAnswers,
            sessionScore: session.analytics.sessionScore
          }
        });
      }
    }
    
    // Add AI response to session
    session.messages.push({
      role: 'tutor',
      content: aiResponse.content,
      messageType: aiResponse.messageType || 'text',
      timestamp: new Date(),
      metadata: aiResponse.metadata || {}
    });
    
    // Update session analytics
    session.analytics.totalMessages = session.messages.length;
    
    await session.save();
    
    res.json({
      message: 'Message sent successfully',
      response: session.messages[session.messages.length - 1],
      suggestions: aiResponse.suggestions || ['Continue conversation', 'Ask a question', 'End session'],
      sessionStats: {
        totalMessages: session.messages.length,
        correctAnswers: session.analytics.correctAnswers,
        incorrectAnswers: session.analytics.incorrectAnswers,
        sessionScore: session.analytics.sessionScore
      }
    });
  } catch (error) {
    console.error('Error sending message to AI tutor:', error);
    res.status(500).json({ message: 'Error processing message' });
  }
});

// POST /api/ai-tutor/end-session - End tutoring session
router.post('/end-session', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.id;
    
    const session = await AiTutorSession.findOne({ 
      sessionId, 
      studentId: userId,
      status: 'active'
    }).populate('moduleId', 'title level minimumCompletionTime');
    
    if (!session) {
      return res.status(404).json({ message: 'Active session not found' });
    }
    
    session.endTime = new Date();
    const durationMinutes = Math.round((session.endTime - session.startTime) / 60000);
    
    // ✅ Determine session state based on duration, interaction, and conversation content
    const module = session.moduleId;
    const requiredMinutes = module.minimumCompletionTime || 15;
    const messageCount = session.messages?.length || 0;
    const studentMessageCount = session.messages?.filter(m => m.role === 'student').length || 0;
    
    // Get last AI message to check for completion indicators
    const lastAIMessage = [...(session.messages || [])].reverse().find(m => m.role === 'tutor');
    const lastAIContent = lastAIMessage?.content?.toLowerCase() || '';
    
    // ✅ NEW: Combination-based completion detection
    // Requires multiple keywords to be present to confirm completion
    // This prevents false positives from single words in normal conversation
    // IMPORTANT: "module" or "session" is REQUIRED in PRIMARY combinations, with FALLBACK patterns
    const completionCombinations = [
      // PRIMARY: English combinations - require "module" or "session"
      { keywords: ['module', 'congratulations', 'completed'], lang: 'English' },
      { keywords: ['module', 'congratulations', 'finished'], lang: 'English' },
      { keywords: ['module', 'successfully', 'completed'], lang: 'English' },
      { keywords: ['module', 'successfully', 'finished'], lang: 'English' },
      { keywords: ['module', 'status', 'completed'], lang: 'English' },
      { keywords: ['module', 'status', 'finished'], lang: 'English' },
      { keywords: ['module', 'completed'], lang: 'English' },
      { keywords: ['module', 'finished'], lang: 'English' },
      { keywords: ['session', 'congratulations', 'completed'], lang: 'English' },
      { keywords: ['session', 'successfully', 'completed'], lang: 'English' },
      { keywords: ['session', 'status', 'completed'], lang: 'English' },
      { keywords: ['session', 'completed'], lang: 'English' },
      
      // FALLBACK: English patterns without "module" but with strong completion indicators (3+ keywords)
      { keywords: ['thank you', 'practicing', 'great work'], lang: 'English' },
      { keywords: ['thank you', 'practicing', 'fantastic'], lang: 'English' },
      { keywords: ['thank you', 'practicing', 'excellent'], lang: 'English' },
      { keywords: ['thank you', 'practicing', 'wonderful'], lang: 'English' },
      { keywords: ['thank you', 'practicing', 'today'], lang: 'English' },
      { keywords: ['great work', 'today', 'goodbye'], lang: 'English' },
      { keywords: ['excellent work', 'today', 'goodbye'], lang: 'English' },
      { keywords: ['wonderful job', 'today', 'goodbye'], lang: 'English' },
      { keywords: ['well done', 'today', 'goodbye'], lang: 'English' },
      { keywords: ['fantastic progress', 'goodbye'], lang: 'English' },
      { keywords: ['great progress', 'goodbye'], lang: 'English' },
      
      // PRIMARY: German combinations - require "modul" or "sitzung"
      { keywords: ['modul', 'glückwunsch', 'abgeschlossen'], lang: 'German' },
      { keywords: ['modul', 'herzlichen glückwunsch'], lang: 'German' },
      { keywords: ['modul', 'erfolgreich', 'abgeschlossen'], lang: 'German' },
      { keywords: ['modul', 'status', 'abgeschlossen'], lang: 'German' },
      { keywords: ['modul', 'abgeschlossen'], lang: 'German' },
      { keywords: ['modul', 'wunderbar', 'abgeschlossen'], lang: 'German' },
      { keywords: ['modul', 'ausgezeichnet', 'abgeschlossen'], lang: 'German' },
      { keywords: ['modul', 'perfekt', 'abgeschlossen'], lang: 'German' },
      { keywords: ['modul', 'toll', 'abgeschlossen'], lang: 'German' },
      { keywords: ['sitzung', 'erfolgreich', 'abgeschlossen'], lang: 'German' },
      { keywords: ['sitzung', 'abgeschlossen'], lang: 'German' },
      { keywords: ['sitzung', 'beendet'], lang: 'German' },
      { keywords: ['session', 'beendet'], lang: 'German' },
      
      // FALLBACK: German patterns without "modul"
      { keywords: ['danke', 'üben', 'toll'], lang: 'German' },
      { keywords: ['danke', 'üben', 'wunderbar'], lang: 'German' },
      { keywords: ['danke', 'üben', 'ausgezeichnet'], lang: 'German' },
      { keywords: ['danke', 'üben', 'heute'], lang: 'German' },
      { keywords: ['toll gemacht', 'heute', 'auf wiedersehen'], lang: 'German' },
      { keywords: ['wunderbar', 'heute', 'tschüss'], lang: 'German' },
      
      // PRIMARY: Tamil combinations - require "பாடம்" (module) or "அமர்வு" (session)
      { keywords: ['பாடம்', 'வாழ்த்துக்கள்', 'முடிந்தது'], lang: 'Tamil' },
      { keywords: ['பாடம்', 'முடிந்தது'], lang: 'Tamil' },
      { keywords: ['அமர்வு', 'முடிந்தது'], lang: 'Tamil' },
      
      // FALLBACK: Tamil patterns without "பாடம்"
      { keywords: ['நன்றி', 'பயிற்சி', 'சிறப்பு'], lang: 'Tamil' },
      { keywords: ['நன்றி', 'பயிற்சி', 'இன்று'], lang: 'Tamil' },
      
      // PRIMARY: Sinhala combinations - require "පාඩම" (module) or "සැසිය" (session)
      { keywords: ['පාඩම', 'සුභපැතුම්', 'අවසන්'], lang: 'Sinhala' },
      { keywords: ['පාඩම', 'අවසන්'], lang: 'Sinhala' },
      { keywords: ['සැසිය', 'අවසන්'], lang: 'Sinhala' },
      
      // FALLBACK: Sinhala patterns without "පාඩම"
      { keywords: ['ස්තූතියි', 'පුහුණුව', 'විශිෂ්ට'], lang: 'Sinhala' },
      { keywords: ['ස්තූතියි', 'පුහුණුව', 'අද'], lang: 'Sinhala' }
    ];
    
    // Check if any combination is satisfied
    let matchedCombination = null;
    for (const combo of completionCombinations) {
      const allKeywordsPresent = combo.keywords.every(keyword => 
        lastAIContent.includes(keyword.toLowerCase())
      );
      
      if (allKeywordsPresent) {
        matchedCombination = combo;
        break;
      }
    }
    
    // ✅ ADDITIONAL CHECK: Exclude if message contains continuation indicators
    const continuationIndicators = [
      'let\'s continue', 'continue with', 'keep going', 'carry on',
      'more practice', 'try again', 'another', 'next question',
      'lass uns weitermachen', 'weiter üben', 'noch einmal', 'nächste frage'
    ];
    
    const hasContinuationIndicator = continuationIndicators.some(indicator =>
      lastAIContent.includes(indicator.toLowerCase())
    );
    
    // Only consider it a completion if:
    // 1. Has matched keyword combination AND
    // 2. Does NOT have continuation indicators
    const hasCompletionPhrase = matchedCombination && !hasContinuationIndicator;
    
    if (matchedCombination) {
      console.log(`✅ Completion combination matched: ${matchedCombination.keywords.join(' + ')} (${matchedCombination.lang})`);
    }
    if (hasContinuationIndicator) {
      console.log(`⚠️ Continuation indicator found - blocking completion`);
    }
    
    // Validate if session should be marked as completed
    const meetsTimeRequirement = durationMinutes >= requiredMinutes;
    const hasMinimumInteraction = studentMessageCount >= 3; // At least 3 student messages
    
    // ✅ TIME-BASED SAFETY CHECK: Only allow early completion within 3 minutes of required time
    const minimumAllowedTime = Math.max(0, requiredMinutes - 3); // Can complete 3 min before required time
    const meetsMinimumTime = durationMinutes >= minimumAllowedTime;
    
    if (hasCompletionPhrase && !meetsMinimumTime) {
      console.log(`⏱️ BLOCKING COMPLETION: Too early - ${durationMinutes} min < ${minimumAllowedTime} min (required: ${requiredMinutes} min, safety buffer: 3 min)`);
      console.log(`🚫 Completion phrase detected but session too short - likely false positive`);
    }
    
    // ✅ NEW: Allow early completion if conversation naturally ended (AI detected completion)
    // BUT only within 3 minutes of required time (safety check)
    // This handles scenarios like restaurant role-play where student completes the task early
    const isNaturalCompletion = hasCompletionPhrase && hasMinimumInteraction && meetsMinimumTime;
    
    // Session is completed if:
    // OPTION 1: Meets time requirement + minimum interaction + completion phrase (normal completion)
    // OPTION 2: Natural completion detected by AI (completion phrase present) + minimum interaction + within 3 min of required time (early completion with safety check)
    if ((meetsTimeRequirement && hasMinimumInteraction && hasCompletionPhrase) || isNaturalCompletion) {
      session.status = 'completed';
      if (!meetsTimeRequirement && isNaturalCompletion) {
        console.log(`✅ Session completed (early): ${durationMinutes} min < ${requiredMinutes} min, but natural completion detected with ${studentMessageCount} student messages (within safety window)`);
      } else {
        console.log(`✅ Session completed: ${durationMinutes} min >= ${requiredMinutes} min, ${studentMessageCount} student messages, has completion phrase`);
      }
    } else {
      session.status = 'active'; // Changed from 'manually_ended' to 'active' to match schema
      console.log(`⚠️ Session incomplete: time=${durationMinutes}/${requiredMinutes}min, messages=${studentMessageCount}, hasCompletion=${hasCompletionPhrase}, meetsMinTime=${meetsMinimumTime}`);
    }
    
    await session.save();
    
    const sessionState = session.status; // Use the same status for SessionRecord
    
    // ✅ NEW: Create/Update SessionRecord for analytics
    try {
      const SessionRecord = require('../models/SessionRecord');
      const User = require('../models/User');
      
      const student = await User.findById(userId).select('name email').lean();
      
      let sessionRecord = await SessionRecord.findOne({ sessionId });
      
      if (sessionRecord) {
        // Update existing record
        sessionRecord.endTime = session.endTime;
        sessionRecord.durationMinutes = durationMinutes;
        sessionRecord.sessionState = sessionState;
        sessionRecord.messages = session.messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          messageType: msg.messageType,
          timestamp: msg.timestamp
        }));
        
        // Calculate accuracy safely (avoid NaN)
        const totalExercises = session.analytics.correctAnswers + session.analytics.incorrectAnswers;
        const accuracy = totalExercises > 0 
          ? Math.round((session.analytics.correctAnswers / totalExercises) * 100) 
          : 0;
        
        sessionRecord.summary = {
          conversationCount: session.messages.filter(m => m.role === 'student').length,
          timeSpentMinutes: durationMinutes,
          vocabularyUsed: session.analytics.vocabularyUsed || [],
          totalScore: session.analytics.sessionScore,
          correctAnswers: session.analytics.correctAnswers,
          incorrectAnswers: session.analytics.incorrectAnswers,
          accuracy: accuracy
        };
        
        // Only mark module as completed if session state is 'completed' (sufficient time)
        sessionRecord.isModuleCompleted = sessionState === 'completed';
        
        await sessionRecord.save();
        console.log('✅ SessionRecord updated with duration:', durationMinutes, 'minutes, state:', sessionState);
      } else {
        // Create new record
        // Calculate accuracy safely (avoid NaN)
        const totalExercises = session.analytics.correctAnswers + session.analytics.incorrectAnswers;
        const accuracy = totalExercises > 0 
          ? Math.round((session.analytics.correctAnswers / totalExercises) * 100) 
          : 0;
        
        sessionRecord = new SessionRecord({
          sessionId,
          studentId: userId,
          studentName: student.name,
          studentEmail: student.email,
          moduleId: session.moduleId._id,
          moduleTitle: session.moduleId.title,
          moduleLevel: session.moduleId.level,
          sessionType: session.sessionType,
          sessionState: sessionState, // Use calculated sessionState
          startTime: session.startTime,
          endTime: session.endTime,
          durationMinutes: durationMinutes,
          messages: session.messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            messageType: msg.messageType,
            timestamp: msg.timestamp
          })),
          summary: {
            conversationCount: session.messages.filter(m => m.role === 'student').length,
            timeSpentMinutes: durationMinutes,
            vocabularyUsed: session.analytics.vocabularyUsed || [],
            totalScore: session.analytics.sessionScore,
            correctAnswers: session.analytics.correctAnswers,
            incorrectAnswers: session.analytics.incorrectAnswers,
            accuracy: accuracy
          },
          isModuleCompleted: sessionState === 'completed' // Only true if session completed with sufficient time
        });
        
        await sessionRecord.save();
        console.log('✅ SessionRecord created with duration:', durationMinutes, 'minutes');
      }
    } catch (recordError) {
      console.error('⚠️ Error saving SessionRecord:', recordError);
      // Don't fail the request if SessionRecord fails
    }
    
    res.json({
      message: 'Session ended successfully',
      summary: {
        duration: durationMinutes,
        totalMessages: session.messages.length,
        correctAnswers: session.analytics.correctAnswers,
        incorrectAnswers: session.analytics.incorrectAnswers,
        sessionScore: session.analytics.sessionScore
      }
    });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ message: 'Error ending session' });
  }
});

module.exports = router;