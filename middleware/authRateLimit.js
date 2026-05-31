/**
 * middleware/authRateLimit.js
 *
 * Rate limiters for sensitive authentication endpoints.
 * Uses express-rate-limit with in-memory store.
 *
 * Note: app.js sets trust proxy true for Nginx. express-rate-limit v7 rejects
 * permissive trust proxy by default — we disable that validation and derive
 * the client IP from X-Forwarded-For safely (first hop only).
 */

const rateLimit = require('express-rate-limit');

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

const sharedOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
  keyGenerator: (req) => clientIp(req),
};

const forgotPasswordRequestLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    msg: 'Too many password reset requests. Please try again in 15 minutes.',
  },
  skipSuccessfulRequests: false,
});

const forgotPasswordResetLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    msg: 'Too many reset attempts. Please try again in 15 minutes.',
  },
});

const loginLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    msg: 'Too many login attempts. Please try again in 15 minutes.',
  },
  skipSuccessfulRequests: true,
});

const setupEmailOtpLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    msg: 'Too many verification requests. Please try again in 15 minutes.',
  },
});

const setupCompleteLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    msg: 'Too many attempts. Please try again in 15 minutes.',
  },
});

const setupVerifyOtpLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    msg: 'Too many verification attempts. Please try again in 15 minutes.',
  },
});

const setupSetPasswordLimiter = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    msg: 'Too many attempts. Please try again in 15 minutes.',
  },
});

module.exports = {
  forgotPasswordRequestLimiter,
  forgotPasswordResetLimiter,
  loginLimiter,
  setupEmailOtpLimiter,
  setupCompleteLimiter,
  setupVerifyOtpLimiter,
  setupSetPasswordLimiter,
};
