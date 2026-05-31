// models/NotificationQueue.js — scheduled notification jobs

const mongoose = require('mongoose');

const NotificationQueueSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  channel: { type: String, enum: ['browser', 'mobile', 'email'], default: 'browser' },
  type: { type: String, required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  scheduledFor: { type: Date, required: true, index: true },
  status: { type: String, enum: ['pending', 'sent', 'failed', 'cancelled'], default: 'pending', index: true },
  sentAt: { type: Date, default: null },
  errorMessage: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('NotificationQueue', NotificationQueueSchema);
