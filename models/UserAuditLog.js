const mongoose = require('mongoose');

const auditFieldSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const userAuditLogSchema = new mongoose.Schema({
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  targetUserRole: { type: String, default: '', index: true },
  targetUserName: { type: String, default: '' },
  targetUserRegNo: { type: String, default: '', index: true },
  targetUserEmail: { type: String, default: '' },
  action: {
    type: String,
    enum: ['CREATE', 'UPDATE', 'DELETE', 'PASSWORD_RESET', 'BULK_UPDATE'],
    required: true,
    index: true,
  },
  source: { type: String, default: '' },
  changedFields: { type: [auditFieldSchema], default: [] },
  /** Full sanitized user snapshot preserved on DELETE (and optional on CREATE). */
  userSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  actorName: { type: String, default: '' },
  actorRole: { type: String, default: '', index: true },
  actorIp: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  occurredAt: { type: Date, default: Date.now, index: true },
});

userAuditLogSchema.index({ occurredAt: -1 });
userAuditLogSchema.index({ targetUserId: 1, occurredAt: -1 });
userAuditLogSchema.index({ actorId: 1, occurredAt: -1 });

module.exports = mongoose.model('UserAuditLog', userAuditLogSchema);
