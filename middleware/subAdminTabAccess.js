const User = require('../models/User');
const { subAdminHasTabAccess, teacherHasTabAccess } = require('../services/subAdminPermissions');

const ADMIN_STAFF_ROLES = ['ADMIN', 'TEACHER_ADMIN'];
const STUDENT_LIST_TAB_IDS = ['students', 'finance-dashboard'];

/**
 * ADMIN / TEACHER_ADMIN pass through unconditionally.
 * SUB_ADMIN requires sidebar tab access.
 * TEACHER requires the tab to be assigned via teacherTabPermissions / teacherTabAccessLevels.
 */
function requireAdminOrSubAdminTab(tabId, requiredLevel = 'view') {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const role = req.user.role;
    if (ADMIN_STAFF_ROLES.includes(role)) {
      return next();
    }

    if (role !== 'SUB_ADMIN' && role !== 'TEACHER') {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    try {
      if (role === 'SUB_ADMIN') {
        const user = await User.findById(req.user.id)
          .select('role sidebarPermissions sidebarAccessLevels')
          .lean();
        if (subAdminHasTabAccess(user, tabId, requiredLevel)) {
          return next();
        }
      } else {
        // TEACHER — check assigned admin tab permissions
        const user = await User.findById(req.user.id)
          .select('role teacherTabPermissions teacherTabAccessLevels')
          .lean();
        if (teacherHasTabAccess(user, tabId, requiredLevel)) {
          return next();
        }
      }
    } catch (err) {
      console.error('[subAdminTabAccess]', tabId, err);
    }

    return res.status(403).json({
      message: `Access denied. ${tabId} permission required.`,
    });
  };
}

/**
 * GET /admin/students — staff roles, or SUB_ADMIN with Students or Finance Dashboard tab.
 */
function requireStudentsListAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  const role = req.user.role;
  if (role === 'ADMIN' || role === 'TEACHER_ADMIN' || role === 'TEACHER') {
    return next();
  }

  if (role === 'SUB_ADMIN') {
    return loadSubAdminStudentListAccess(req, res, next);
  }

  return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
}

async function loadSubAdminStudentListAccess(req, res, next) {
  try {
    const user = await User.findById(req.user.id)
      .select('role sidebarPermissions sidebarAccessLevels')
      .lean();
    const allowed = STUDENT_LIST_TAB_IDS.some((tabId) =>
      subAdminHasTabAccess(user, tabId, 'view'),
    );
    if (allowed) return next();
  } catch (err) {
    console.error('[requireStudentsListAccess] SUB_ADMIN', err);
  }
  return res.status(403).json({
    message: 'Access denied. Students or Finance Dashboard permission required.',
  });
}

module.exports = {
  requireAdminOrSubAdminTab,
  requireStudentsListAccess,
  ADMIN_STAFF_ROLES,
};
