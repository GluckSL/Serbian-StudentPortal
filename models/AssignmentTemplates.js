// models/AssignmentTemplates.js
const mongoose = require('mongoose');

const assignmentTemplateSchema = new mongoose.Schema(
  {
    // Who created it
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Optional targeting
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
      required: true,
    },
    description: {
      type: String,
      default: '',
    },

    // Attach question paper / exam files
    files: [
      {
        path: { type: String, required: true },
        originalName: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
      },
    ],

    dueDate: {
      type: Date,
      required: false,
    },

    // Visibility
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

assignmentTemplateSchema.index({ courseId: 1, moduleId: 1, isActive: 1, createdAt: -1 });

module.exports = mongoose.model('AssignmentTemplate', assignmentTemplateSchema);
