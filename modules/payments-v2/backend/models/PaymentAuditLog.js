const mongoose = require('mongoose');
const MODEL_NAME = 'PaymentAuditLog';

const auditLogSchema = new mongoose.Schema({
  entityType: { type: String, required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  performedByRole: String,
  previousState: mongoose.Schema.Types.Mixed,
  newState: mongoose.Schema.Types.Mixed,
  metadata: mongoose.Schema.Types.Mixed,
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
}, { timestamps: true });

module.exports = mongoose.models[MODEL_NAME] || mongoose.model(MODEL_NAME, auditLogSchema);
