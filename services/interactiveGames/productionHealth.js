// services/interactiveGames/productionHealth.js — health, metrics, env validation

const mongoose = require('mongoose');
const gaConfig = require('../../config/glueckArena');
const cacheService = require('./cache');
const multiplayerService = require('./multiplayer');

const startTime = Date.now();

function validateEnvironment() {
  const warnings = [];
  const errors = [];
  if (!process.env.JWT_SECRET) errors.push('JWT_SECRET missing');
  if (!process.env.MONGO_URI && process.env.NODE_ENV === 'production') errors.push('MONGO_URI missing');
  if (gaConfig.features.multiplayer && !process.env.JWT_SECRET) errors.push('Multiplayer requires JWT_SECRET');
  if (process.env.GA_AI_GENERATION !== 'false' && !process.env.OPENAI_API_KEY) {
    warnings.push('OPENAI_API_KEY not set — AI generation uses mock provider');
  }
  if (!process.env.REDIS_URL) warnings.push('REDIS_URL not set — using in-memory cache');
  return { ok: errors.length === 0, errors, warnings };
}

async function getHealth() {
  const mongoOk = mongoose.connection.readyState === 1;
  let redisOk = false;
  try {
    if (process.env.REDIS_URL) {
      await cacheService.set('ga:health:ping', { t: Date.now() }, 5);
      redisOk = !!(await cacheService.get('ga:health:ping'));
    }
  } catch { redisOk = false; }

  return {
    status: mongoOk ? 'healthy' : 'degraded',
    module: 'GlückArena',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    mongo: mongoOk,
    redis: process.env.REDIS_URL ? redisOk : 'not_configured',
    features: gaConfig.features,
    timestamp: new Date().toISOString(),
  };
}

async function getMetrics() {
  const [live, env] = await Promise.all([
    multiplayerService.getLiveStats(),
    Promise.resolve(validateEnvironment()),
  ]);
  return {
    live,
    env: { warnings: env.warnings.length, errors: env.errors.length },
    process: {
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    },
  };
}

module.exports = { validateEnvironment, getHealth, getMetrics, startTime };
