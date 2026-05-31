const mongoose = require('mongoose');

const portalSessionSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },
    totalActiveSeconds: { type: Number, default: 0 },
    deviceType: { type: String, default: 'Unknown' },
    deviceLabel: { type: String, default: 'Unknown device' },
    browser: { type: String, default: '' },
    os: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    lastHeartbeatAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true, index: true }
  },
  { collection: 'portal_sessions' }
);

portalSessionSchema.index({ studentId: 1, isActive: 1 });
portalSessionSchema.index({ lastHeartbeatAt: 1 });
portalSessionSchema.index({ startTime: -1 });
/** Stale-session sweeps */
portalSessionSchema.index({ isActive: 1, lastHeartbeatAt: 1 });

module.exports = mongoose.model('PortalSession', portalSessionSchema);
