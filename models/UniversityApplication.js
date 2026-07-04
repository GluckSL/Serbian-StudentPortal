const mongoose = require('mongoose');

const UniversityApplicationSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  universityName: { type: String, required: true, trim: true },
  course: { type: String, default: '', trim: true },
  degreeLevel: { type: String, default: '', trim: true },
  country: { type: String, default: '', trim: true },
  city: { type: String, default: '', trim: true },
  campus: { type: String, default: '', trim: true },
  intakeTerm: { type: String, default: '', trim: true },
  applicationReference: { type: String, default: '', trim: true },
  website: { type: String, default: '', trim: true },
  languageOfInstruction: { type: String, default: '', trim: true },
  duration: { type: String, default: '', trim: true },
  tuitionFee: { type: String, default: '', trim: true },
  notes: { type: String, default: '' },
  stages: [{
    stage: { type: Number },
    status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
    message: { type: String, default: '' },
    stageDate: { type: Date },
    updatedAt: { type: Date }
  }],
  finalOutcome: { type: String, enum: ['pending', 'accepted', 'rejected', 'withdrawn'], default: 'pending' },
  adminNotes: { type: String, default: '' },
  history: [{
    date: { type: Date, default: Date.now },
    stage: Number,
    note: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

UniversityApplicationSchema.index({ studentId: 1, universityName: 1 }, { unique: true });
UniversityApplicationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('UniversityApplication', UniversityApplicationSchema);
