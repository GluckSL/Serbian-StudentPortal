const User = require('../models/User');
const { subAdminHasTabAccess } = require('../services/subAdminPermissions');

const ADMIN_STAFF_ROLES = ['ADMIN', 'TEACHER_ADMIN'];

/**
 * ADMIN / TEACHER_ADMIN pass through; SUB_ADMIN requires sidebar tab access.
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

    if (role !== 'SUB_ADMIN') {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    try {
      const user = await User.findById(req.user.id)
        .select('role sidebarPermissions sidebarAccessLevels')
        .lean();
      if (subAdminHasTabAccess(user, tabId, requiredLevel)) {
        return next();
      }
    } catch (err) {
      console.error('[subAdminTabAccess]', tabId, err);
    }

    return res.status(403).json({
      message: `Access denied. ${tabId} permission required.`,
    });
  };
}

module.exports = {
  requireAdminOrSubAdminTab,
  ADMIN_STAFF_ROLES,
};
