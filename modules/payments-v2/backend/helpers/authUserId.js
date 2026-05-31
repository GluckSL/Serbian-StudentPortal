/**
 * Resolve authenticated user id from JWT.
 * Login route (`routes/auth.js`) signs `{ id, role, name }`.
 * Some code paths use `userId` — support both.
 */
function getAuthUserId(req) {
  const u = req?.user;
  if (!u) return undefined;
  if (u.id != null) return u.id;
  if (u.userId != null) return u.userId;
  if (u._id != null) return u._id;
  return undefined;
}

module.exports = { getAuthUserId };
