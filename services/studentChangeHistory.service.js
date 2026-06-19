const mongoose = require('mongoose');
const StudentChangeHistory = require('../models/StudentChangeHistory');

const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordRecoverable',
  'mustChangePassword',
  'authTokenVersion'
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

function stableStringify(value) {
  const normalized = asPlainValue(value);
  if (normalized == null) return String(normalized);
  if (typeof normalized !== 'object') return JSON.stringify(normalized);
  const sortValue = (v) => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === 'object') {
      return Object.keys(v)
        .sort()
        .reduce((acc, key) => {
          acc[key] = sortValue(v[key]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sortValue(normalized));
}

function getPathValue(doc, path) {
  if (!doc || !path) return undefined;
  return String(path)
    .split('.')
    .reduce((cur, part) => (cur == null ? undefined : cur[part]), doc);
}

function actorFromRequest(req) {
  return {
    changedBy: req?.user?.id && mongoose.Types.ObjectId.isValid(String(req.user.id)) ? req.user.id : null,
    changedByName: req?.user?.name || '',
    changedByRole: req?.user?.role || '',
    requestIp: req?.headers?.['x-forwarded-for']?.toString()?.split(',')?.[0]?.trim() || req?.ip || '',
    userAgent: req?.headers?.['user-agent'] || ''
  };
}

function changedFieldsFromDocs(beforeDoc, afterDoc, fields) {
  const before = asPlainValue(beforeDoc);
  const after = asPlainValue(afterDoc);
  const uniqueFields = [...new Set((fields || []).filter(Boolean))];

  return uniqueFields
    .filter((field) => !SENSITIVE_FIELDS.has(String(field).split('.')[0]))
    .map((field) => {
      const oldValue = asPlainValue(getPathValue(before, field));
      const newValue = asPlainValue(getPathValue(after, field));
      return { field, oldValue, newValue };
    })
    .filter((change) => stableStringify(change.oldValue) !== stableStringify(change.newValue));
}

async function recordStudentChange({ beforeDoc, afterDoc, fields, req, source = 'student_details', action = 'UPDATE' }) {
  const student = afterDoc || beforeDoc;
  if (!student || String(student.role || '') !== 'STUDENT') return null;

  const changedFields = changedFieldsFromDocs(beforeDoc, afterDoc, fields);
  if (!changedFields.length) return null;

  return StudentChangeHistory.create({
    studentId: student._id,
    action,
    source,
    changedFields,
    ...actorFromRequest(req)
  });
}

async function recordBulkStudentChanges({ beforeDocs, afterDocs, fields, req, source = 'student_bulk_update' }) {
  const afterById = new Map((afterDocs || []).map((doc) => [String(doc._id), doc]));
  const records = [];

  for (const beforeDoc of beforeDocs || []) {
    const afterDoc = afterById.get(String(beforeDoc._id));
    if (!afterDoc) continue;
    const changedFields = changedFieldsFromDocs(beforeDoc, afterDoc, fields);
    if (!changedFields.length) continue;
    records.push({
      studentId: afterDoc._id,
      action: 'UPDATE',
      source,
      changedFields,
      ...actorFromRequest(req)
    });
  }

  if (!records.length) return [];
  return StudentChangeHistory.insertMany(records);
}

module.exports = {
  recordStudentChange,
  recordBulkStudentChanges,
  changedFieldsFromDocs
};
