// middleware/subscriptionCheck.js
// Middleware to check user subscription levels

const User = require('../models/User');
const { isServicePlan, isCoursePlan } = require('../utils/studentSubscriptionPlans');

function isVisaDocsOnly(user) {
  return isServicePlan(user?.subscription);
}

// Middleware to check if user has required subscription level
const checkSubscription = (requiredSubscription) => {
  return async (req, res, next) => {
    try {
      // Get user ID from the verified token
      const userId = req.user.id;
      
      // Fetch user with subscription info
      const user = await User.findById(userId).select('subscription role subscriptionExpiry');
      
      if (!user) {
        return res.status(404).json({ 
          message: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }
      
      // Only check subscription for students
      if (user.role !== 'STUDENT') {
        return next(); // Allow non-students (teachers, admins) to proceed
      }
      
      // Check if user has the required subscription
      if (!user.subscription) {
        return res.status(403).json({ 
          message: 'No subscription found. Please upgrade your account.',
          code: 'NO_SUBSCRIPTION',
          currentSubscription: null,
          requiredSubscription: requiredSubscription
        });
      }
      
      // Check subscription level
      const subscriptionLevels = {
        'VISA_DOC_ONLY': 0,
        'SILVER': 1,
        'PLATINUM': 2
      };
      
      const userLevel = subscriptionLevels[user.subscription] || 0;
      const requiredLevel = subscriptionLevels[requiredSubscription] || 0;
      
      if (userLevel < requiredLevel) {
        return res.status(403).json({ 
          message: `This feature requires ${requiredSubscription} subscription. You currently have ${user.subscription}.`,
          code: 'INSUFFICIENT_SUBSCRIPTION',
          currentSubscription: user.subscription,
          requiredSubscription: requiredSubscription,
          upgradeRequired: true
        });
      }
      
      // Check subscription expiry (if applicable)
      if (user.subscriptionExpiry && new Date() > user.subscriptionExpiry) {
        return res.status(403).json({ 
          message: 'Your subscription has expired. Please renew to continue using premium features.',
          code: 'SUBSCRIPTION_EXPIRED',
          currentSubscription: user.subscription,
          expiryDate: user.subscriptionExpiry
        });
      }
      
      // Add subscription info to request for use in routes
      req.userSubscription = {
        level: user.subscription,
        expiry: user.subscriptionExpiry
      };
      
      next();
    } catch (error) {
      console.error('Subscription check error:', error);
      return res.status(500).json({ 
        message: 'Error checking subscription status',
        code: 'SUBSCRIPTION_CHECK_ERROR'
      });
    }
  };
};

/**
 * Block Visa+Docs-only students from course features.
 * Use this on routes that don't otherwise have a subscription requirement.
 */
const blockVisaDocsOnly = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return next();
    const user = await User.findById(userId).select('subscription role').lean();
    if (!user) return next();
    if (user.role !== 'STUDENT') return next();
    if (!isVisaDocsOnly(user)) return next();
    return res.status(403).json({
      message: 'This feature is not available on your selected service plan.',
      code: 'SERVICE_PLAN_RESTRICTED',
      currentSubscription: user.subscription,
    });
  } catch (error) {
    console.error('Visa+Docs restriction check error:', error);
    return res.status(500).json({
      message: 'Error checking subscription status',
      code: 'SUBSCRIPTION_CHECK_ERROR',
    });
  }
};

// Specific middleware for PLATINUM subscription
const requirePlatinum = checkSubscription('PLATINUM');

// Specific middleware for SILVER or higher subscription
const requireSilver = checkSubscription('SILVER');

module.exports = {
  checkSubscription,
  requirePlatinum,
  requireSilver,
  blockVisaDocsOnly,
  isVisaDocsOnly,
};