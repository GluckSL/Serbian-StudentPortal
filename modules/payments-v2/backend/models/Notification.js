const mongoose = require('mongoose');
const MODEL_NAME = 'PaymentNotification';

const notificationSchema = new mongoose.Schema({
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipientRole: String,
  type: { type: String, required: true },
  title: String,
  message: String,
  isRead: { type: Boolean, default: false },
  relatedEntityType: String,
  relatedEntityId: mongoose.Schema.Types.ObjectId,
  priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH'], default: 'NORMAL' },
}, { timestamps: true });

module.exports = mongoose.models[MODEL_NAME] || mongoose.model(MODEL_NAME, notificationSchema);
