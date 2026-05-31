// models/StudentDocument.js
// Model for storing student uploaded documents

const mongoose = require('mongoose');

const studentDocumentSchema = new mongoose.Schema({
  // Student reference
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  studentName: {
    type: String,
    required: true
  },
  studentEmail: {
    type: String,
    required: true
  },
  
  // Document details
  documentTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DocumentRequirement',
    required: true
  },
  documentType: {
    type: String,
    required: true
  },
  
  documentName: {
    type: String,
    required: true
  },

  documentCategory: {
    type: String,
    default: 'OTHER'
  },
  
  // File information
  fileName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number, // in bytes
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  
  // Additional information
  description: {
    type: String,
    default: ''
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['PENDING', 'VERIFIED', 'REJECTED'],
    default: 'PENDING'
  },
  
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: {
    type: Date
  },
  verificationNotes: {
    type: String
  },

  remarks: {
    type: String
  },

  version: {
    type: Number,
    default: 1
  },
  isCurrent: {
    type: Boolean,
    default: true
  },
  supersededBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentDocument'
  },
  replacedAt: {
    type: Date
  },
  replacedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Metadata
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
studentDocumentSchema.index({ studentId: 1, documentTypeId: 1, isCurrent: 1 });
studentDocumentSchema.index({ studentId: 1, documentType: 1 });
studentDocumentSchema.index({ status: 1 });
studentDocumentSchema.index({ uploadedAt: -1 });
studentDocumentSchema.index({ documentTypeId: 1, version: -1 });

studentDocumentSchema.pre('save', function(next) {
  if (!this.remarks && this.verificationNotes) this.remarks = this.verificationNotes;
  if (!this.verificationNotes && this.remarks) this.verificationNotes = this.remarks;
  next();
});

// Virtual for formatted file size
studentDocumentSchema.virtual('formattedFileSize').get(function() {
  const bytes = this.fileSize;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
});

// Method to get document type display name
studentDocumentSchema.methods.getDocumentTypeDisplayName = function() {
  const displayNames = {
    'MISCELLANEOUS': 'Other Certificates',
    'BIRTH_CERTIFICATE': 'Birth Certificate',
    'CV': 'CV',
    'O_LEVEL_CERTIFICATE': 'O Level Certificate',
    'A_LEVEL_CERTIFICATE': 'A Level Certificate',
    'BROWN_CERTIFICATE': 'Brown Certificate',
    'DEGREE_DIPLOMA': 'Degree / Diploma',
    'ACADEMIC_TRANSCRIPT': 'Academic Transcript',
    'PASSPORT': 'Passport',
    'EXPERIENCE_LETTER': 'Experience Letter',
    'LANGUAGE_CERTIFICATE': 'Language Certificate',
    'EXTRACURRICULAR_CERTIFICATE': 'Extra-curricular Certificate',
    'AFFIDAVIT': 'Affidavit',
    'POLICE_CLEARANCE': 'Police Clearance',
    'OTHER': 'Other Document'
  };
  return displayNames[this.documentType] || this.documentType;
};

// Static method to get document requirements (DEPRECATED - use DocumentRequirement model instead)
studentDocumentSchema.statics.getDocumentRequirements = function() {
  console.warn('⚠️  StudentDocument.getDocumentRequirements() is deprecated. Use DocumentRequirement model instead.');
  return [];
};

module.exports = mongoose.model('StudentDocument', studentDocumentSchema);
