const mongoose = require('mongoose');
const UserAuditLog = require('../models/UserAuditLog');
const { changedFieldsFromDocs } = require('./studentChangeHistory.service');

const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordRecoverable',
  'mustChangePassword',
  'authTokenVersion',
]);

function asPlainValue(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (Array.isArray(value)) return value.map(asPlainValue);
  if (typeof value === 'object') {
    if (typeof value.toObject === 'function') return asPlainValue(value.toObject());
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = asPlainValue(child);
    }
    return out;
  }
  return value;
}

function sanitizeUserSnapshot(doc) {
  if (!doc) return null;
  const plain = asPlainValue(typeof doc.toObject === 'function' ? doc.toObject() : doc);
  for (const key of SENSITIVE_FIELDS) {
    if (key in plain) delete plain[key];
  }
  return plain;
}

function targetSummary(doc) {
  if (!doc) {
    return {
      targetUserId: null,
      targetUserRole: '',
      targetUserName: '',
      targetUserRegNo: '',
      targetUserEmail: '',
    };
  }
  return {
    targetUserId: doc._id || null,
    targetUserRole: doc.role || '',
    targetUserName: doc.name || '',
    targetUserRegNo: doc.regNo || '',
    targetUserEmail: doc.email || '',
  };
}

function actorFromRequest(req) {
  const user = req?.user || {};
  return {
    actorId:
      user.id && mongoose.Types.ObjectId.isValid(String(user.id))
        ? user.id
        : null,
    actorName: user.name || '',
    actorRole: user.role || '',
    actorIp:
      req?.headers?.['x-forwarded-for']?.toString()?.split(',')?.[0]?.trim() ||
      req?.ip ||
      '',
    userAgent: req?.headers?.['user-agent'] || '',
  };
}

async function recordUserAudit({
  action,
  beforeDoc,
  afterDoc,
  fields,
  req,
  source = '',
  metadata = null,
  includeSnapshot = false,
}) {
  const targetDoc = afterDoc || beforeDoc;
  const changedFields =
    action === 'UPDATE'
      ? changedFieldsFromDocs(beforeDoc, afterDoc, fields)
      : [];

  if (action === 'UPDATE' && !changedFields.length) return null;

  const payload = {
    ...targetSummary(targetDoc),
    action,
    source,
    changedFields,
    metadata: metadata ? asPlainValue(metadata) : null,
    ...actorFromRequest(req),
    occurredAt: new Date(),
  };

  if (action === 'DELETE' || includeSnapshot) {
    payload.userSnapshot = sanitizeUserSnapshot(beforeDoc || afterDoc);
  } else if (action === 'CREATE') {
    payload.userSnapshot = sanitizeUserSnapshot(afterDoc);
  }

  try {
    return await UserAuditLog.create(payload);
  } catch (err) {
    console.error('[UserAuditLog] Failed to record audit entry:', err.message);
    return null;
  }
}

async function recordUserDeletion({ deletedUser, req, source = 'auth_delete_user' }) {
  return recordUserAudit({
    action: 'DELETE',
    beforeDoc: deletedUser,
    req,
    source,
    includeSnapshot: true,
  });
}

async function recordUserCreation({ createdUser, req, source = 'auth_signup' }) {
  return recordUserAudit({
    action: 'CREATE',
    afterDoc: createdUser,
    req,
    source,
    includeSnapshot: true,
  });
}

async function recordPasswordReset({ user, req, source, emailed = false }) {
  if (!user) return null;
  try {
    return await UserAuditLog.create({
      ...targetSummary(user),
      action: 'PASSWORD_RESET',
      source,
      changedFields: [{ field: 'password', oldValue: '[redacted]', newValue: '[changed]' }],
      metadata: { emailed: !!emailed },
      ...actorFromRequest(req),
      occurredAt: new Date(),
    });
  } catch (err) {
    console.error('[UserAuditLog] Failed to record password reset:', err.message);
    return null;
  }
}

module.exports = {
  recordUserAudit,
  recordUserDeletion,
  recordUserCreation,
  recordPasswordReset,
  sanitizeUserSnapshot,
};
