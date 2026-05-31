const mongoose = require('mongoose');
const MODEL_NAME = 'PaymentTimelineEvent';

const timelineEventSchema = new mongoose.Schema({
  paymentRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest', index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  eventType: { type: String, required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorRole: String,
  actorName: String,
  description: String,
  metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

module.exports = mongoose.models[MODEL_NAME] || mongoose.model(MODEL_NAME, timelineEventSchema);
