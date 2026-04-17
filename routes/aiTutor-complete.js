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

// Initialize OpenAI service
const openaiService = new OpenAIService();

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
    const module = await LearningModule.findById(moduleId);
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
      
      welcomeResponse = {
        content: `Willkommen zur Rollenspiel-Sitzung! Du bist ${scenario.studentRole}, ich bin ${scenario.aiRole}. Sage "Los geht's" oder "Beginnen wir", um zu starten, oder "Stopp", um die Sitzung zu beenden.`,
        messageType: 'role-play-intro',
        metadata: {
          sessionState: 'introduction',
          waitingForTrigger: true,
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
    
    // Check for role-play session control commands
    const isRolePlayModule = session.moduleId.content?.rolePlayScenario;
    const lowerMessage = message.toLowerCase().trim();
    
    // Check for stop commands
    const stopCommands = ['stop', 'end', 'finish', 'quit', 'exit'];
    if (stopCommands.some(cmd => lowerMessage.includes(cmd))) {
      const stopResponse = {
        content: `Thank you for practicing! You did great in this session. 

**Session Summary:**
- Scenario: ${session.moduleId.content?.rolePlayScenario?.situation || 'Language practice'}
- Your role: ${session.moduleId.content?.rolePlayScenario?.studentRole || 'Student'}
- Practice time: ${Math.round((Date.now() - session.startTime) / 60000)} minutes

Feel free to try this scenario again or explore other modules. Keep up the excellent work! 🎉`,
        messageType: 'role-play-complete',
        metadata: {
          sessionState: 'manually_ended',
          sessionEnded: true
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
    });
    
    if (!session) {
      return res.status(404).json({ message: 'Active session not found' });
    }
    
    session.status = 'completed';
    session.endTime = new Date();
    await session.save();
    
    res.json({
      message: 'Session ended successfully',
      summary: {
        duration: Math.round((session.endTime - session.startTime) / 60000),
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