// services/interactiveGames/redisAdapter.js — Socket.io Redis pub/sub for multi-instance

let adapterAttached = false;

async function attachRedisAdapter(io) {
  if (adapterAttached || !process.env.REDIS_URL) return { ok: false, reason: 'not_configured' };
  try {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const { createClient } = require('redis');
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    adapterAttached = true;
    console.log('[glueck-arena] Socket.io Redis adapter attached');
    return { ok: true };
  } catch (e) {
    console.warn('[glueck-arena] Redis adapter unavailable:', e.message);
    return { ok: false, reason: e.message };
  }
}

function isAdapterActive() {
  return adapterAttached;
}

module.exports = { attachRedisAdapter, isAdapterActive };
