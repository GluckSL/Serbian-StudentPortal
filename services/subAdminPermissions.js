/**
 * Sub-admin tab access helpers (view / edit / full + optional delete per tab).
 */

function accessLevelsToObject(accessLevels) {
  if (!accessLevels) return {};
  if (accessLevels instanceof Map) {
    return Object.fromEntries(accessLevels.entries());
  }
  if (typeof accessLevels === "object" && !Array.isArray(accessLevels)) {
    return { ...accessLevels };
  }
  return {};
}

function accessLevelRank(level) {
  return { view: 1, edit: 2, full: 3 }[level] || 0;
}

function canAccessLevel(current, required) {
  if (!current) return false;
  return accessLevelRank(current) >= accessLevelRank(required);
}

function getSubAdminTabLevel(user, tabId) {
  if (!user || user.role !== "SUB_ADMIN") return null;
  const levels = accessLevelsToObject(user.sidebarAccessLevels);
  if (levels[tabId]) return levels[tabId];
  const legacy = Array.isArray(user.sidebarPermissions) ? user.sidebarPermissions : [];
  return legacy.includes(tabId) ? "view" : null;
}

/** Whether SUB_ADMIN has at least the required access on a sidebar tab. */
function subAdminHasTabAccess(user, tabId, required = "view") {
  if (!user || user.role !== "SUB_ADMIN") return false;
  return canAccessLevel(getSubAdminTabLevel(user, tabId), required);
}

/**
 * Whether a SUB_ADMIN may perform delete actions on a tab.
 * Full access always includes delete; edit + sidebarDeletePermissions grants delete.
 */
function subAdminCanDeleteOnTab(user, tabId) {
  if (!user || user.role !== "SUB_ADMIN") return false;
  const levels = accessLevelsToObject(user.sidebarAccessLevels);
  const level = levels[tabId];
  if (!canAccessLevel(level, "edit")) return false;
  if (level === "full") return true;
  const deletePerms = Array.isArray(user.sidebarDeletePermissions)
    ? user.sidebarDeletePermissions
    : [];
  return deletePerms.includes(tabId);
}

module.exports = {
  accessLevelsToObject,
  subAdminCanDeleteOnTab,
  getSubAdminTabLevel,
  subAdminHasTabAccess,
};
