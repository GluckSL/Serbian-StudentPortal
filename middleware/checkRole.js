//middleware/checkRole.js

module.exports = function (requiredRoles) {
    return (req, res, next) => {
      // Ensure user information is available from the auth middleware
      if (!req.user) {
        return res.status(401).json({ message: "User not authenticated" });
      }
  
      // Convert single role to array for consistent handling
      const rolesArray = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
      
      const isSubAdminForAdminScope =
        req.user.role === "SUB_ADMIN" &&
        rolesArray.some((role) => role === "ADMIN" || role === "TEACHER_ADMIN");

      // Check if the user's role matches any of the required roles
      if (!rolesArray.includes(req.user.role) && !isSubAdminForAdminScope) {
        return res.status(403).json({ message: "Access denied. Insufficient permissions." });
      }
  
      next();  // User has the required role, proceed to the route handler
    };
  };
  