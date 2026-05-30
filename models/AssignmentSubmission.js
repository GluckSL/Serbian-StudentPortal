// models/AssignmentSubmission.js
const mongoose = require('mongoose');

const assignmentSubmissionSchema = new mongoose.Schema(
  {
    // Who submitted
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // What it belongs to
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: false,
    },
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LearningModule',
      required: false,
    },

    title: {
      type: String,
      default: '',
    },

    uploadedBy: {
      type: String,
      enum: ['STUDENT', 'TEACHER'],
      required: true,
    },

    // Files metadata
    files: [
      {
        path: { type: String, required: true },
        originalName: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
      },
    ],

    // Status and correction
    status: {
      type: String,
      enum: ['SUBMITTED', 'IN_REVIEW', 'CORRECTED'],
      default: 'SUBMITTED',
    },
    marks: {
      type: Number,
      default: null,
    },
    feedback: {
      type: String,
      default: '',
    },

    // Placeholder for future auto‑scan / AI checking
    autoCheckResult: {
      type: Object,
      default: null,
    },

    // Link to the assignment template
    assignmentTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AssignmentTemplate',
      required: false,
    },

    submittedAt: {
      type: Date,
      default: Date.now,
    },
    correctedAt: {
      type: Date,
      default: null,
    },

    // Additional comments from teacher
    teacherComments: {
      type: String,
      default: '',
    },

    // Additional comments from student
    studentComments: {
      type: String,
      default: '',
    },

    // Versioning for resubmissions
    version: {
      type: Number,
      default: 1,
    },

    // Soft delete
    isDeleted: {
      type: Boolean,
      default: false,
    },

    // Grading result reference
    gradingResultId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GradingResult',
      default: null,
    },

    // Timestamps for tracking
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },

    // aiGrading
    aiGrading: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: 'AIGradingResult',
    },
    aiGradingStatus: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
    },
    aiGradingRequestedAt: {
      type: Date,
      default: null,
    },
    aiGradingCompletedAt: {
      type: Date,
      default: null,
    },
    aiGradingFeedback: {
      type: String,
      default: '',
    },
    aiGradingScore: {
      type: Number,
      default: null,
    },
    aiGradingModelUsed: {
      type: String,
      default: '',
    },
    aiGradingPromptVersion: {
      type: String,
      default: '',
    },
    aiGradingScores: [
      {
        criterionId: { type: mongoose.Schema.Types.ObjectId, required: true },
        score: { type: Number, required: true },
        feedback: { type: String },
      },
    ],
    aiGradingTotalScore: { type: Number, default: null },
    aiGradingGradedAt: { type: Date, default: null },
    aiGradingUpdatedAt: { type: Date, default: null },
    aiGradingCreatedAt: { type: Date, default: null },
    aiGradingRequestCount: { type: Number, default: 0 },
    aiGradingLastRequestAt: { type: Date, default: null },
    aiGradingErrorMessage: { type: String, default: '' },
    aiGradingProcessingTime: { type: Number, default: null },
    aiGradingResponseData: { type: Object, default: null },
    aiGradingRequestId: { type: String, default: '' },
    aiGradingResponseId: { type: String, default: '' },
    aiGradingSessionId: { type: String, default: '' },
    aiGradingTransactionId: { type: String, default: '' },
    aiGradingCorrelationId: { type: String, default: '' },
    aiGradingTrackingId: { type: String, default: '' },
    aiGradingReferenceId: { type: String, default: '' },
    aiGradingMetaData: { type: Object, default: null },
    aiGradingLogs: { type: [String], default: [] },
    aiGradingNotes: { type: String, default: '' },
    aiGradingHistory: { type: [Object], default: [] },
    aiGradingVersion: { type: String, default: '' },
    aiGradingConfig: { type: Object, default: null },
    aiGradingSettings: { type: Object, default: null },
    aiGradingOptions: { type: Object, default: null },
    aiGradingParameters: { type: Object, default: null },
    aiGradingContext: { type: Object, default: null },
    aiGradingEnvironment: { type: Object, default: null },
    aiGradingPlatform: { type: String, default: '' },
    aiGradingService: { type: String, default: '' },
    aiGradingProvider: { type: String, default: '' },
    aiGradingEndpoint: { type: String, default: '' },
    aiGradingModelVersion: { type: String, default: '' },
    aiGradingPromptTemplate: { type: String, default: '' },
    aiGradingResponseTime: { type: Number, default: null },
    aiGradingCost: { type: Number, default: null }, // in cents

    teaacherReviewedAt: { type: Date, default: null },
    teacherOverrideScore: { type: Number, default: null },
    teacherOverrideFeedback: { type: String, default: '' },
  },
  {
    timestamps: true,
  }
);

assignmentSubmissionSchema.index({ studentId: 1, isDeleted: 1, createdAt: -1 });
assignmentSubmissionSchema.index({ teacherId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('AssignmentSubmission', assignmentSubmissionSchema);
