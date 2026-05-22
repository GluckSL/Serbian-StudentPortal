// models/DocumentRequirement.js
// Model for managing required document types

const mongoose = require('mongoose');

const documentRequirementSchema = new mongoose.Schema({
  // Canonical API fields
  name: {
    type: String,
    required: true,
    trim: true
  },
  isRequired: {
    type: Boolean,
    default: false
  },
  allowMultiple: {
    type: Boolean,
    default: false
  },

  // Optional program scoping. Empty = all programs.
  programKeys: [{
    type: String,
    trim: true
  }],

  // Legacy aliases kept for backward compatibility
  type: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  label: {
    type: String,
    required: false,
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
    enum: ['ACADEMIC', 'IDENTIFICATION', 'PROFESSIONAL', 'LEGAL', 'VISA', 'AGREEMENT', 'OTHER'],
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

documentRequirementSchema.pre('validate', function(next) {
  if (!this.name && this.label) this.name = this.label;
  if (!this.label && this.name) this.label = this.name;
  if (typeof this.isRequired !== 'boolean' && typeof this.required === 'boolean') {
    this.isRequired = this.required;
  }
  if (typeof this.required !== 'boolean' && typeof this.isRequired === 'boolean') {
    this.required = this.isRequired;
  }

  if (!this.type && this.name) {
    this.type = this.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  if (Array.isArray(this.applicableServices) && this.applicableServices.length > 0 && (!this.programKeys || this.programKeys.length === 0)) {
    this.programKeys = [...this.applicableServices];
  }
  if (Array.isArray(this.programKeys) && this.programKeys.length > 0 && (!this.applicableServices || this.applicableServices.length === 0)) {
    this.applicableServices = [...this.programKeys];
  }

  next();
});

// Index for faster queries
documentRequirementSchema.index({ active: 1, order: 1 });
documentRequirementSchema.index({ type: 1, active: 1 });

module.exports = mongoose.model('DocumentRequirement', documentRequirementSchema);
