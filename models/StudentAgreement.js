const mongoose = require('mongoose');

const studentAgreementSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, required: true },
  studentEmail: { type: String, required: true },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgreementTemplate', required: true },
  templateName: { type: String, required: true },
  displayName: { type: String, required: true }, // admin-entered label for checklist
  fieldValues: { type: Map, of: String, default: {} },

  // Generated filled PDF (stored on S3 matching existing student-documents bucket)
  generatedFile: {
    s3Key: String,
    fileName: String,
    fileSize: Number,
    mimeType: { type: String, default: 'application/pdf' }
  },

  // Signed copy uploaded by student
  signedFile: {
    s3Key: String,
    fileName: String,
    fileSize: Number,
    mimeType: String
  },

  // Links to the StudentDocument checklist row so existing verify UI works
  studentDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentDocument' },

  status: {
    type: String,
    enum: ['SENT', 'SIGNED_PENDING', 'VERIFIED', 'REJECTED'],
    default: 'SENT'
  },

  verificationNotes: { type: String },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sentAt: { type: Date, default: Date.now },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: { type: Date }
}, { timestamps: true });

studentAgreementSchema.index({ studentId: 1, status: 1 });
studentAgreementSchema.index({ studentDocumentId: 1 });

module.exports = mongoose.model('StudentAgreement', studentAgreementSchema);
