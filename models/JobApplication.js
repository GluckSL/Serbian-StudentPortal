const mongoose = require('mongoose');

const jobApplicationSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    jobOpeningId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobOpening',
      required: true,
      index: true
    },
    studentName: { type: String, default: '', trim: true, maxlength: 120 },
    studentEmail: { type: String, default: '', trim: true, maxlength: 200 },
    studentRegNo: { type: String, default: '', trim: true, maxlength: 80 },
    studentBatch: { type: String, default: '', trim: true, maxlength: 80 },
    phone: { type: String, default: '', trim: true, maxlength: 40 },
    linkedIn: { type: String, default: '', trim: true, maxlength: 300 },
    coverLetter: { type: String, default: '', trim: true, maxlength: 8000 },
    resumeFileName: { type: String, default: '', trim: true },
    resumeUrl: { type: String, default: '', trim: true }
  },
  { timestamps: true }
);

jobApplicationSchema.index({ studentId: 1, jobOpeningId: 1 }, { unique: true });
jobApplicationSchema.index({ jobOpeningId: 1, createdAt: -1 });

module.exports = mongoose.model('JobApplication', jobApplicationSchema);
