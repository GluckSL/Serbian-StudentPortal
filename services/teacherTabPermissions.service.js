/**
 * Teachers with assigned admin-tab access (view/edit/full) may use shared admin
 * content for that tab. Without assignment they remain limited to own content.
 */
const User = require('../models/User');
const { teacherHasTabAccess } = require('./subAdminPermissions');

async function loadTeacherTabUser(userId) {
  if (!userId) return null;
  return User.findById(userId)
    .select('role teacherTabPermissions teacherTabAccessLevels')
    .lean();
}

async function teacherHasAssignedTabAccessById(userId, tabId, required = 'view') {
  const user = await loadTeacherTabUser(userId);
  if (!user || user.role !== 'TEACHER') return false;
  return teacherHasTabAccess(user, tabId, required);
}

function ownerId(value) {
  if (!value) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

async function teacherCanAccessOwnedOrAssignedTab(req, tabId, contentOwnerId, required = 'view') {
  if (!req.user || req.user.role !== 'TEACHER') return true;
  if (ownerId(contentOwnerId) === String(req.user.id)) return true;
  return teacherHasAssignedTabAccessById(req.user.id, tabId, required);
}

function dgTabIdForModuleVersion(version) {
  return version === 'v2' ? 'dg-bot-v2' : 'dg-bot';
}

function dgTabIdForModule(docOrVersion) {
  const version =
    typeof docOrVersion === 'string'
      ? docOrVersion
      : docOrVersion?.version;
  return dgTabIdForModuleVersion(version === 'v2' ? 'v2' : 'v1');
}

function exercisesTabIdForVersion(version) {
  return version === 'v2' ? 'exercises-v2' : 'exercises';
}

module.exports = {
  loadTeacherTabUser,
  teacherHasAssignedTabAccessById,
  teacherCanAccessOwnedOrAssignedTab,
  dgTabIdForModuleVersion,
  dgTabIdForModule,
  exercisesTabIdForVersion,
  ownerId,
};
