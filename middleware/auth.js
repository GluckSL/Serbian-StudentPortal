//middleware/auth.js

require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

/** Bearer-only JWT extraction: Authorization: Bearer <token> */
function extractBearerToken(req) {
  const raw = req.headers.authorization || req.headers.Authorization;
  if (typeof raw === 'string' && raw.toLowerCase().startsWith('bearer ')) {
    const t = raw.slice(7).trim();
    if (t) return t;
  }
  return null;
}

/** Media compatibility: allow token via query string (e.g. native HLS fetch without custom headers). */
function extractMediaToken(req) {
  const bearer = extractBearerToken(req);
  if (bearer) return bearer;
  const q = req?.query?.token;
  if (typeof q === 'string' && q.trim()) return q.trim();
  return null;
}

// Middleware: Verify JWT from Authorization: Bearer <token>
function verifyToken(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return res.status(401).json({
      msg: 'Unauthorized: No token provided',
      message: 'Unauthorized: No token provided',
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Add user data to request
    next();
  } catch (err) {
    return res.status(403).json({
      msg: 'Invalid or expired token',
      message: 'Invalid or expired token',
    });
  }
}

// Middleware: verify JWT from Bearer header, fallback to query token for media endpoints.
function verifyMediaToken(req, res, next) {
  const token = extractMediaToken(req);

  if (!token) {
    return res.status(401).json({
      msg: 'Unauthorized: No token provided',
      message: 'Unauthorized: No token provided',
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({
      msg: 'Invalid or expired token',
      message: 'Invalid or expired token',
    });
  }
}

// Optional middleware for explicit admin check
function isAdmin(req, res, next) {
  const allowedAdminRoles = ['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN'];
  if (!allowedAdminRoles.includes(req.user?.role)) {
    return res.status(403).json({ msg: 'Access denied. Admin roles only.' });
  }
  next();
}

/** Destructive / privileged actions: ADMIN and TEACHER_ADMIN only (not SUB_ADMIN). */
function requireFullAdmin(req, res, next) {
  const role = req.user?.role;
  if (role === 'ADMIN' || role === 'TEACHER_ADMIN') {
    return next();
  }
  return res.status(403).json({
    msg: 'Access denied. Only primary administrators can perform this action.',
    message: 'Access denied. Only primary administrators can perform this action.'
  });
}

// General role-based access control middleware
const checkRole = (roles) => {
  return (req, res, next) => {
    console.log('🔐 checkRole middleware:', {
      requiredRoles: roles,
      userRole: req.user?.role,
      userId: req.user?.id,
      userName: req.user?.name,
      hasUser: !!req.user
    });
    
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    
    // Handle both single role and array of roles
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    const isSubAdminForAdminScope =
      req.user.role === 'SUB_ADMIN' &&
      allowedRoles.some((role) => role === 'ADMIN' || role === 'TEACHER_ADMIN');

    if (allowedRoles.includes(req.user.role) || isSubAdminForAdminScope) {
      console.log('✅ Role check passed');
      next();
    } else {
      console.log('❌ Role check failed:', {
        required: allowedRoles,
        actual: req.user.role
      });
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }
  };
};


// ✅ Export all middleware
module.exports = {
  verifyToken,
  verifyMediaToken,
  isAdmin,
  requireFullAdmin,
  checkRole,
  extractBearerToken,
};