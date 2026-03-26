const mongoose = require('mongoose');

const VisaTrackingSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  visaType: {
    type: String,
    enum: ['PORTAL', 'AU_PAIR'],
    required: true
  },
  // Per-stage details
  stages: [{
    stage: { type: Number },
    status: { type: String, default: '' },
    message: { type: String, default: '' },
    actionRequired: { type: Boolean, default: false },
    actionNote: { type: String, default: '' },
    handledBy: { type: String, enum: ['team', 'embassy', 'student', ''], default: '' },
    outcome: { type: String, default: '' },
    outcomeDate: { type: Date },
    // Stage-specific date (portal submission, embassy submission, appointment, decision)
    stageDate: { type: Date },
    stageDateLabel: { type: String, default: '' },
    updatedAt: { type: Date }
  }],
  // Final outcome (only at last stage)
  finalOutcome: { type: String, enum: ['pending', 'approved', 'rejected', ''], default: '' },
  finalOutcomeNote: { type: String, default: '' },
  // Admin notes (internal, not shown to student)
  adminNotes: { type: String, default: '' },
  // History log
  history: [{
    date: { type: Date, default: Date.now },
    stage: Number,
    note: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('VisaTracking', VisaTrackingSchema);
