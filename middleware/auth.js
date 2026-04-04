//middleware/auth.js

require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Middleware: Verify JWT token from cookie
function verifyToken(req, res, next) {
  const token = req.cookies.authToken; // Get token from cookies

  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Add user data to request
    next();
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
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
  isAdmin,
  checkRole,
};


/* // Middleware: Check if user is admin
function isAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next(); // User is admin
  } else {
    return res.status(403).json({ msg: 'Access denied: Admins only' });
  }
}

module.exports = {
  verifyToken,
  isAdmin
}; */



/* require('dotenv').config();  // Import dotenv to access environment variables

const jwt = require('jsonwebtoken');

// Access JWT_SECRET from environment variables
const JWT_SECRET = process.env.JWT_SECRET;

module.exports = function (req, res, next) {
  // Get the token from Authorization header
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ msg: "No token, authorization denied" });
  }

  try {
    // Verify the token and decode the payload
    const decoded = jwt.verify(token.replace("Bearer ", ""), JWT_SECRET);

    // Attach the decoded user to the request object
    req.user = decoded;
    next();  // Proceed to the next middleware or route handler
  } catch (err) {
    res.status(401).json({ msg: "Invalid token" });
  }

  // Add this route for getting the user profile
router.get("/profile", auth, async (req, res) => {
  try {
    // Find the user by their ID (from the JWT payload)
    const user = await User.findById(req.user.userId).select('-password'); // Don't send password

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    res.json({ user }); // Send the user data
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

};
 */