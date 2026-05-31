const mongoose = require('mongoose');

const pageActivitySchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true, index: true },
    page: { type: String, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },
    activeSeconds: { type: Number, default: 0 }
  },
  { collection: 'page_activities' }
);

pageActivitySchema.index({ sessionId: 1, endTime: 1 });
pageActivitySchema.index({ studentId: 1, sessionId: 1 });
pageActivitySchema.index({ page: 1 });
pageActivitySchema.index({ startTime: -1 });

module.exports = mongoose.model('PageActivity', pageActivitySchema);
