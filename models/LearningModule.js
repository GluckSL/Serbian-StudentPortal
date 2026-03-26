// models/LearningModule.js

const mongoose = require('mongoose');

const LearningModuleSchema = new mongoose.Schema({
  title: { 
    type: String, 
    required: true,
    trim: true
  },
  description: { 
    type: String, 
    required: true 
  },
  
  // NEW: Language support
  targetLanguage: {
    type: String,
    enum: ['English', 'German'],
    required: true,
    default: 'German'
  },
  nativeLanguage: {
    type: String,
    enum: ['English', 'German', 'Tamil', 'Sinhala'],
    required: true,
    default: 'English'
  },
  
  level: { 
    type: String, 
    enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], 
    required: true 
  },
  category: {
    type: String,
    enum: ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening'],
    required: true
  },
  difficulty: {
    type: String,
    enum: ['Beginner', 'Intermediate', 'Advanced'],
    required: true
  },
  estimatedDuration: { 
    type: Number, // in minutes
    required: true 
  },
  
  // ✅ NEW: Minimum time required to complete this module
  minimumCompletionTime: {
    type: Number, // in minutes
    default: 15, // Default 15 minutes for backward compatibility
    min: 5,
    max: 60,
    required: false
  },
  
  // Learning objectives and requirements
  learningObjectives: [{
    objective: String,
    description: String
  }],
  
  prerequisites: [String], // Array of prerequisite topics
  
  // Module content structure
  content: {
    introduction: String,
    
    // Role-play specific content (optional - only for role-play modules)
    rolePlayScenario: {
      situation: {
        type: String,
        required: false // e.g., "At a restaurant", "Job interview", "Shopping"
      },
      studentRole: {
        type: String,
        required: false // e.g., "Customer", "Job applicant", "Tourist"
      },
      aiRole: {
        type: String,
        required: false // e.g., "Waiter", "Interviewer", "Shop assistant"
      },
      setting: String, // e.g., "A busy restaurant in Berlin", "A formal office"
      objective: String, // e.g., "Order a meal and ask for the bill"
      
      // Enhanced role personality and introduction system
      aiPersonality: String, // How the AI should behave in this role
      studentGuidance: String, // Instructions for the student about their role
      aiOpeningLines: [String], // Different ways AI can start the conversation
      suggestedStudentResponses: [String] // Example responses students can use
    },
    
    // Vocabulary constraints
    allowedVocabulary: [{
      word: String,
      translation: String,
      category: String // e.g., "food", "greetings", "numbers"
    }],
    
    // Grammar constraints
    allowedGrammar: [{
      structure: String, // e.g., "Present tense", "Modal verbs", "Questions with 'wie'"
      examples: [String],
      level: String
    }],
    
    // Optional conversation starters/examples
    conversationFlow: [{
      stage: String, // e.g., "greeting", "ordering", "paying"
      aiPrompts: [String], // What AI might say
      expectedResponses: [String], // What student should try to say
      helpfulPhrases: [String]
    }],
    
    keyTopics: [String],
    examples: [{
      german: String,
      english: String,
      explanation: String
    }],
    exercises: [{
      type: {
        type: String,
        enum: ['multiple-choice', 'fill-blank', 'translation', 'conversation', 'essay', 'role-play']
      },
      question: String,
      options: [String], // for multiple choice
      correctAnswer: String,
      explanation: String,
      points: { type: Number, default: 1 }
    }]
  },
  
  // AI Tutor Configuration
  aiTutorConfig: {
    personality: {
      type: String,
      default: 'friendly and encouraging German tutor'
    },
    focusAreas: [String], // What the AI should focus on for this module
    commonMistakes: [String], // Common mistakes to watch for
    helpfulPhrases: [String], // German phrases to teach
    culturalNotes: [String], // Cultural context to include
    
    // AI Tutor vocabulary control - words the AI is allowed to use
    allowedVocabulary: [{
      word: String,
      translation: String,
      category: String,
      usage: String
    }],
    
    // Enhanced role-play instructions
    rolePlayInstructions: {
      aiRole: String, // The role AI should play
      aiPersonality: String, // How AI should behave in this role
      openingLines: [String], // Different conversation starters
      studentRole: String, // The role student should play
      studentGuidance: String, // Instructions for the student
      suggestedResponses: [String] // Example responses for students
    }
  },
  
  // Metadata
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  
  // ✅ NEW: Visibility control for testing modules before making them public
  visibleToStudents: {
    type: Boolean,
    default: false  // Default to hidden from students (draft mode)
  },
  publishedAt: {
    type: Date,
    default: null  // Set when module is made visible to students
  },
  
  // Trash/Soft Delete System
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  deletionReason: {
    type: String,
    default: null
  },
  // Auto-delete after 30 days (will be handled by cleanup job)
  scheduledDeletionDate: {
    type: Date,
    default: null
  },
  
  tags: [String],
  
  // Update history for admin tracking
  updateHistory: [{
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    updatedAt: {
      type: Date,
      default: Date.now
    },
    changes: {
      type: String, // Description of what was changed
      required: true
    },
    version: {
      type: Number,
      default: 1
    }
  }],
  
  // Current version number
  version: {
    type: Number,
    default: 1
  },
  
  // Analytics
  totalEnrollments: { type: Number, default: 0 },
  averageCompletionTime: { type: Number, default: 0 },
  averageScore: { type: Number, default: 0 },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field and track changes before saving
LearningModuleSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // If this is an update (not initial creation), track the change
  if (!this.isNew && this.isModified()) {
    // Get the user ID from the context (will be set in the route)
    if (this._updateContext && this._updateContext.userId) {
      this.lastUpdatedBy = this._updateContext.userId;
      this.version += 1;
      
      // Add to update history
      this.updateHistory.push({
        updatedBy: this._updateContext.userId,
        updatedAt: new Date(),
        changes: this._updateContext.changes || 'Module updated',
        version: this.version
      });
    }
  }
  
  next();
});

// Index for better query performance
LearningModuleSchema.index({ level: 1, category: 1, isActive: 1 });
LearningModuleSchema.index({ createdBy: 1 });
LearningModuleSchema.index({ tags: 1 });
LearningModuleSchema.index({ isDeleted: 1, scheduledDeletionDate: 1 }); // For trash management

// Static method to soft delete a module (move to trash)
LearningModuleSchema.statics.moveToTrash = function(moduleId, userId, reason = 'Deleted by admin') {
  const scheduledDeletion = new Date();
  scheduledDeletion.setDate(scheduledDeletion.getDate() + 30); // 30 days from now
  
  return this.findByIdAndUpdate(moduleId, {
    isDeleted: true,
    deletedAt: new Date(),
    deletedBy: userId,
    deletionReason: reason,
    scheduledDeletionDate: scheduledDeletion,
    isActive: false // Also mark as inactive
  }, { new: true });
};

// Static method to restore from trash
LearningModuleSchema.statics.restoreFromTrash = function(moduleId) {
  return this.findByIdAndUpdate(moduleId, {
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    scheduledDeletionDate: null,
    isActive: true // Restore as active
  }, { new: true });
};

// Static method to permanently delete (remove from database)
LearningModuleSchema.statics.permanentlyDelete = function(moduleId) {
  return this.findByIdAndDelete(moduleId);
};

// Static method to get trash items
LearningModuleSchema.statics.getTrashItems = function(userId = null) {
  const query = { isDeleted: true };
  if (userId) {
    query.deletedBy = userId;
  }
  return this.find(query)
    .populate('deletedBy', 'name email regNo')
    .populate('createdBy', 'name email regNo')
    .sort({ deletedAt: -1 });
};

// Static method to clean up expired trash items (for scheduled job)
LearningModuleSchema.statics.cleanupExpiredTrash = function() {
  const now = new Date();
  return this.deleteMany({
    isDeleted: true,
    scheduledDeletionDate: { $lte: now }
  });
};

module.exports = mongoose.model('LearningModule', LearningModuleSchema);