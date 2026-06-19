const mongoose = require('mongoose');

const studentChangeFieldSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { _id: false }
);

const studentChangeHistorySchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, default: 'UPDATE', index: true },
  source: { type: String, default: 'student_details' },
  changedFields: { type: [studentChangeFieldSchema], default: [] },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  changedByName: { type: String, default: '' },
  changedByRole: { type: String, default: '' },
  changedAt: { type: Date, default: Date.now, index: true },
  requestIp: { type: String, default: '' },
  userAgent: { type: String, default: '' }
});

studentChangeHistorySchema.index({ studentId: 1, changedAt: -1 });

module.exports = mongoose.model('StudentChangeHistory', studentChangeHistorySchema);
