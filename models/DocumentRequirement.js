// models/DocumentRequirement.js
// Model for managing required document types

const mongoose = require('mongoose');

const documentRequirementSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  label: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  required: {
    type: Boolean,
    default: false
  },
  category: {
    type: String,
    enum: ['ACADEMIC', 'IDENTIFICATION', 'PROFESSIONAL', 'LEGAL', 'VISA', 'OTHER'],
    default: 'OTHER'
  },
  // Which services this document applies to. Empty array = ALL services.
  applicableServices: [{
    type: String,
    trim: true
  }],
  order: {
    type: Number,
    default: 0
  },
  active: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for faster queries
documentRequirementSchema.index({ active: 1, order: 1 });

module.exports = mongoose.model('DocumentRequirement', documentRequirementSchema);
