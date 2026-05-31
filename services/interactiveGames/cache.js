// services/interactiveGames/cache.js — in-memory cache with optional Redis (REDIS_URL)

const DEFAULT_TTL_SEC = 60;

const memory = new Map();
let redisClient = null;

function initRedis() {
  if (redisClient || !process.env.REDIS_URL) return;
  try {
    const Redis = require('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    redisClient.connect().catch(() => { redisClient = null; });
  } catch {
    redisClient = null;
  }
}

initRedis();

function memGet(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key, value, ttlSec) {
  memory.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

async function get(key) {
  if (redisClient) {
    try {
      const raw = await redisClient.get(key);
      if (raw) return JSON.parse(raw);
    } catch { /* fallback */ }
  }
  return memGet(key);
}

async function set(key, value, ttlSec = DEFAULT_TTL_SEC) {
  if (redisClient) {
    try {
      await redisClient.setex(key, ttlSec, JSON.stringify(value));
      return;
    } catch { /* fallback */ }
  }
  memSet(key, value, ttlSec);
}

async function del(pattern) {
  if (redisClient && pattern.includes('*')) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length) await redisClient.del(...keys);
    } catch { /* ignore */ }
  }
  for (const k of memory.keys()) {
    if (pattern === k || (pattern.endsWith('*') && k.startsWith(pattern.slice(0, -1)))) {
      memory.delete(k);
    }
  }
}

function leaderboardKey(gameSetId, period) {
  return `ga:lb:${gameSetId || 'global'}:${period}`;
}

module.exports = { get, set, del, leaderboardKey };
