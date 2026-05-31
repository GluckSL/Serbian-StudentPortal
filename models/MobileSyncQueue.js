// models/MobileSyncQueue.js — offline action queue for future mobile apps

const mongoose = require('mongoose');

const MobileSyncQueueSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  clientId: { type: String, required: true },
  actionType: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending', index: true },
  errorMessage: { type: String, default: null },
  processedAt: { type: Date, default: null },
}, { timestamps: true });

MobileSyncQueueSchema.index({ studentId: 1, clientId: 1, createdAt: 1 });

module.exports = mongoose.model('MobileSyncQueue', MobileSyncQueueSchema);
