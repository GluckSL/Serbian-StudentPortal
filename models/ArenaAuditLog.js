// models/ArenaAuditLog.js — admin activity + anti-cheat audit trail

const mongoose = require('mongoose');

const ArenaAuditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorRole: { type: String, default: null },
  action: { type: String, required: true, index: true },
  resourceType: { type: String, default: null },
  resourceId: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: null },
  severity: { type: String, enum: ['info', 'warn', 'critical'], default: 'info' },
}, { timestamps: true });

ArenaAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ArenaAuditLog', ArenaAuditLogSchema);
