// services/interactiveGames/observability.js — enterprise metrics aggregation

const os = require('os');
const battleEngine = require('./battleEngine');
const spectatorService = require('./spectator');
const replayService = require('./replays');
const multiplayerService = require('./multiplayer');
const antiCheat = require('./antiCheat');
const productionHealth = require('./productionHealth');
const redisAdapter = require('./redisAdapter');

const latencySamples = [];
const errorLog = [];
const MAX_SAMPLES = 200;
const MAX_ERRORS = 100;

function recordLatency(ms) {
  latencySamples.push(ms);
  if (latencySamples.length > MAX_SAMPLES) latencySamples.shift();
}

function recordError(source, message, meta = {}) {
  errorLog.unshift({ source, message, meta, at: new Date().toISOString() });
  if (errorLog.length > MAX_ERRORS) errorLog.pop();
}

function latencyStats() {
  if (!latencySamples.length) return { p50: 0, p95: 0, avg: 0, samples: 0 };
  const sorted = [...latencySamples].sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { p50, p95, avg: Math.round(avg), samples: sorted.length };
}

async function getDashboard() {
  const [health, metrics, live, replayStats, antiCheatLogs] = await Promise.all([
    productionHealth.getHealth(),
    productionHealth.getMetrics(),
    multiplayerService.getLiveStats(),
    replayService.getReplayAnalytics(),
    antiCheat.getAntiCheatSummary(20),
  ]);

  return {
    health,
    metrics,
    multiplayer: {
      ...live,
      battle: battleEngine.getMetrics(),
      spectators: spectatorService.getSpectatorMetrics(),
    },
    sockets: {
      redisAdapter: redisAdapter.isAdapterActive(),
    },
    replays: replayStats,
    latency: latencyStats(),
    process: {
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      loadAvg: os.loadavg(),
      uptimeSeconds: Math.floor((Date.now() - productionHealth.startTime) / 1000),
    },
    recentErrors: errorLog.slice(0, 15),
    antiCheat: antiCheatLogs,
  };
}

module.exports = {
  getDashboard,
  recordLatency,
  recordError,
  latencyStats,
};
