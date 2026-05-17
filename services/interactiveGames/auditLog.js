// services/interactiveGames/auditLog.js — structured audit + anti-cheat events

const ArenaAuditLog = require('../../models/ArenaAuditLog');

async function log({ actorId, actorRole, action, resourceType, resourceId, metadata, ip, severity }) {
  try {
    await ArenaAuditLog.create({
      actorId,
      actorRole,
      action,
      resourceType,
      resourceId,
      metadata: metadata || {},
      ip,
      severity: severity || 'info',
    });
  } catch (e) {
    console.warn('[glueck-arena audit]', e.message);
  }
}

async function getRecentLogs({ limit = 50, action, severity } = {}) {
  const q = {};
  if (action) q.action = action;
  if (severity) q.severity = severity;
  return ArenaAuditLog.find(q).sort({ createdAt: -1 }).limit(limit).lean();
}

module.exports = { log, getRecentLogs };
