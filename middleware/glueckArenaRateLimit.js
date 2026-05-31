// middleware/glueckArenaRateLimit.js — lightweight in-memory rate limit for GlückArena APIs

const config = require('../config/glueckArena');
const buckets = new Map();

function arenaApiLimiter(req, res, next) {
  const key = req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60_000;
  const max = config.rateLimit.apiPerMinute;

  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > max) {
    return res.status(429).json({ success: false, message: 'Too many requests — try again shortly' });
  }
  next();
}

module.exports = { arenaApiLimiter };
