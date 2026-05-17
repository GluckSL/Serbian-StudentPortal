// models/MobileDeviceSession.js — device tracking for mobile clients

const mongoose = require('mongoose');

const MobileDeviceSessionSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  deviceId: { type: String, required: true },
  platform: { type: String, default: 'unknown' },
  appVersion: { type: String, default: '' },
  pushToken: { type: String, default: null },
  lastSeenAt: { type: Date, default: Date.now },
  reconnectCount: { type: Number, default: 0 },
}, { timestamps: true });

MobileDeviceSessionSchema.index({ studentId: 1, deviceId: 1 }, { unique: true });

module.exports = mongoose.model('MobileDeviceSession', MobileDeviceSessionSchema);
