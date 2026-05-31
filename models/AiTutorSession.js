// models/AiTutorSession.js

const mongoose = require('mongoose');

const AiTutorSessionSchema = new mongoose.Schema({
  sessionId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  
  studentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  
  moduleId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'LearningModule', 
    required: true 
  },
  
  // Session metadata
  sessionType: {
    type: String,
    enum: ['practice', 'assessment', 'help', 'conversation', 'review', 'teacher-test'],
    required: true
  },
  
  status: {
    type: String,
    enum: ['active', 'completed', 'paused', 'abandoned'],
    default: 'active'
  },
  
  // Test session flag
  isTestSession: {
    type: Boolean,
    default: false
  },
  
  // Completion confirmation flag
  pendingCompletion: {
    type: Boolean,
    default: false
  },
  
  // Conversation data
  messages: [{
    role: { 
      type: String, 
      enum: ['student', 'tutor'], 
      required: true 
    },
    content: { 
      type: String, 
      required: true 
    },
    timestamp: { 
      type: Date, 
      default: Date.now 
    },
    messageType: {
      type: String,
      enum: ['text', 'exercise', 'feedback', 'hint', 'correction', 'encouragement', 'role-play-intro', 'role-play-active', 'role-play-complete', 'conversation'],
      default: 'text'
    },
    metadata: {
      exerciseId: String,
      correctAnswer: String,
      studentAnswer: String,
      isCorrect: Boolean,
      points: Number,
      difficulty: String
    }
  }],
  
  // Session analytics
  analytics: {
    totalMessages: { type: Number, default: 0 },
    correctAnswers: { type: Number, default: 0 },
    incorrectAnswers: { type: Number, default: 0 },
    hintsUsed: { type: Number, default: 0 },
    topicsDiscussed: [String],
    skillsImproved: [String],
    weaknessesIdentified: [String],
    vocabularyUsed: [String], // Track vocabulary words used during session
    sessionScore: { type: Number, default: 0 },
    engagementLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    }
  },
  
  // AI Tutor behavior tracking
  tutorBehavior: {
    personalityUsed: String,
    adaptationsMade: [String],
    encouragementGiven: Number,
    correctionsProvided: Number,
    culturalNotesShared: Number,
    customExercisesCreated: Number
  },
  
  // Learning outcomes
  learningOutcomes: {
    conceptsLearned: [String],
    skillsPracticed: [String],
    mistakesCorrected: [String],
    improvementAreas: [String],
    nextRecommendations: [String]
  },
  
  // Time tracking
  startTime: { type: Date, default: Date.now },
  endTime: Date,
  totalDuration: Number, // in minutes
  activeTime: Number, // actual interaction time
  
  // Session context
  context: {
    previousSessions: Number,
    currentLevel: String,
    strugglingAreas: [String],
    strongAreas: [String],
    preferredLearningStyle: String
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance
AiTutorSessionSchema.index({ studentId: 1, createdAt: -1 });
AiTutorSessionSchema.index({ moduleId: 1, status: 1 });
AiTutorSessionSchema.index({ studentId: 1, moduleId: 1, status: 1 });

// Update timestamps
AiTutorSessionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Calculate duration if session is completed
  if (this.status === 'completed' && this.startTime && this.endTime) {
    this.totalDuration = Math.round((this.endTime - this.startTime) / (1000 * 60));
  }
  
  // Update analytics
  this.analytics.totalMessages = this.messages.length;
  
  next();
});

// Method to add a message to the session
AiTutorSessionSchema.methods.addMessage = function(role, content, messageType = 'text', metadata = {}) {
  this.messages.push({
    role,
    content,
    messageType,
    metadata,
    timestamp: new Date()
  });
  
  // Update analytics
  this.analytics.totalMessages = this.messages.length;
  
  if (messageType === 'exercise' && metadata.isCorrect !== undefined) {
    if (metadata.isCorrect) {
      this.analytics.correctAnswers++;
    } else {
      this.analytics.incorrectAnswers++;
    }
  }
  
  if (messageType === 'hint') {
    this.analytics.hintsUsed++;
  }
  
  return this.save();
};

// Method to track vocabulary usage
AiTutorSessionSchema.methods.trackVocabulary = function(words) {
  if (!Array.isArray(words)) {
    words = [words];
  }
  
  // Initialize vocabularyUsed if it doesn't exist
  if (!this.analytics.vocabularyUsed) {
    this.analytics.vocabularyUsed = [];
  }
  
  // Add new vocabulary words (avoid duplicates)
  words.forEach(word => {
    const normalizedWord = word.toLowerCase().trim();
    if (normalizedWord && !this.analytics.vocabularyUsed.includes(normalizedWord)) {
      this.analytics.vocabularyUsed.push(normalizedWord);
    }
  });
  
  return this.save();
};

// Method to end session
AiTutorSessionSchema.methods.endSession = function() {
  this.status = 'completed';
  this.endTime = new Date();
  this.totalDuration = Math.round((this.endTime - this.startTime) / (1000 * 60));
  
  // Calculate engagement level based on interaction
  const messageRate = this.analytics.totalMessages / Math.max(this.totalDuration, 1);
  if (messageRate > 2) {
    this.analytics.engagementLevel = 'high';
  } else if (messageRate > 1) {
    this.analytics.engagementLevel = 'medium';
  } else {
    this.analytics.engagementLevel = 'low';
  }
  
  return this.save();
};

module.exports = mongoose.model('AiTutorSession', AiTutorSessionSchema);