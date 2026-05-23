const User = require('../models/User');
const { subAdminHasTabAccess } = require('../services/subAdminPermissions');

const RECORDING_STAFF_ROLES = ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'];
const CLASS_RECORDINGS_TAB = 'class-recordings';

/**
 * Staff who may review recording-access requests.
 * SUB_ADMIN: requires Class Recordings tab (edit+ for mutations, view+ for reads).
 * @param {{ allowTeacher?: boolean }} options — backfill routes set allowTeacher: false
 */
function requireRecordingApprovalStaff(requiredLevel = 'view', options = {}) {
  const allowTeacher = options.allowTeacher !== false;

  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const role = req.user.role;
    if (RECORDING_STAFF_ROLES.includes(role)) {
      if (!allowTeacher && role === 'TEACHER') {
        return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
      }
      return next();
    }

    if (role !== 'SUB_ADMIN') {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    try {
      const user = await User.findById(req.user.id)
        .select('role sidebarPermissions sidebarAccessLevels')
        .lean();
      if (subAdminHasTabAccess(user, CLASS_RECORDINGS_TAB, requiredLevel)) {
        return next();
      }
    } catch (err) {
      console.error('[recordingStaffAccess]', err);
    }

    return res.status(403).json({
      message: 'Access denied. Class Recordings permission required.',
    });
  };
}

module.exports = {
  requireRecordingApprovalStaff,
  RECORDING_STAFF_ROLES,
  CLASS_RECORDINGS_TAB,
};
