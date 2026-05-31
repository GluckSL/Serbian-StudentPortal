// services/pronunciationAnalytics.js
//
// In-memory rolling-window analytics for the pronunciation endpoint.
//
// The goal is not "perfect numbers" — it is "good-enough signal for a
// future dashboard". We keep ~1 hour of events per worker, aggregate on
// demand, and expose a couple of convenience helpers. Swap out `record`
// + `getInsights` if/when a real metrics backend lands; callers don't
// need to change.
//
// Each recorded event is the shape below (everything optional except ts):
//   {
//     ts:               number   (ms since epoch)
//     userId:           string   (truncated in logs)
//     requestId:        string
//     engine:           'openai' | 'fallback' | 'client-transcript'
//     language:         'de-DE' | 'en-US' | ...
//     score:            number   (0..100; may be 0 for silence/network)
//     threshold:        number
//     isCorrect:        boolean
//     confidence:       'low' | 'medium' | 'high'
//     silenceRejected:  boolean
//     silenceReason:    'too-short' | 'too-quiet' | null
//     networkError:     boolean
//     assistedMode:     boolean
//     retryCount:       number
//     deviceType:       'mobile' | 'desktop'
//     browser:          string
//     durationMs:       number   (server-side processing time)
//   }

const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window
const MAX_EVENTS = 5000; // hard cap so a noisy worker can't blow memory

const events = [];
let windowMs = DEFAULT_WINDOW_MS;

function setWindow(ms) {
  if (Number.isFinite(Number(ms)) && Number(ms) > 0) windowMs = Math.round(Number(ms));
}

function prune(now = Date.now()) {
  const cutoff = now - windowMs;
  while (events.length && events[0].ts < cutoff) events.shift();
  while (events.length > MAX_EVENTS) events.shift();
}

function record(evt = {}) {
  const ts = Number(evt.ts) || Date.now();
  events.push({
    ts,
    userId: String(evt.userId || ''),
    requestId: String(evt.requestId || ''),
    engine: String(evt.engine || 'unknown'),
    language: String(evt.language || ''),
    score: Number.isFinite(Number(evt.score)) ? Number(evt.score) : 0,
    threshold: Number.isFinite(Number(evt.threshold)) ? Number(evt.threshold) : 0,
    isCorrect: !!evt.isCorrect,
    confidence: evt.confidence || 'low',
    silenceRejected: !!evt.silenceRejected,
    silenceReason: evt.silenceReason || null,
    networkError: !!evt.networkError,
    assistedMode: !!evt.assistedMode,
    retryCount: Number.isFinite(Number(evt.retryCount)) ? Number(evt.retryCount) : 0,
    deviceType: evt.deviceType || 'desktop',
    browser: String(evt.browser || ''),
    durationMs: Number.isFinite(Number(evt.durationMs)) ? Number(evt.durationMs) : 0,
  });
  prune(ts);
}

function safeDiv(n, d) { return d > 0 ? n / d : 0; }
function round3(x) { return Math.round(x * 1000) / 1000; }

function getInsights() {
  prune();
  const n = events.length;
  if (!n) {
    return {
      windowMs,
      sampleSize: 0,
      avgScore: 0,
      silenceFailureRate: 0,
      retryRate: 0,
      networkFailureRate: 0,
      assistedRate: 0,
      correctRate: 0,
      confidenceMix: { low: 0, medium: 0, high: 0 },
      byDevice: { mobile: 0, desktop: 0 },
      topBrowsers: [],
    };
  }

  let scoreSum = 0;
  let scoredCount = 0;
  let silent = 0;
  let retries = 0;
  let network = 0;
  let assisted = 0;
  let correct = 0;
  const conf = { low: 0, medium: 0, high: 0 };
  const devices = { mobile: 0, desktop: 0 };
  const browsers = new Map();

  for (const e of events) {
    if (!e.networkError && !e.silenceRejected && typeof e.score === 'number') {
      scoreSum += e.score;
      scoredCount += 1;
    }
    if (e.silenceRejected) silent += 1;
    if ((e.retryCount || 0) > 0) retries += 1;
    if (e.networkError) network += 1;
    if (e.assistedMode) assisted += 1;
    if (e.isCorrect) correct += 1;
    if (e.confidence && conf[e.confidence] !== undefined) conf[e.confidence] += 1;
    if (devices[e.deviceType] !== undefined) devices[e.deviceType] += 1;
    const b = e.browser || 'unknown';
    browsers.set(b, (browsers.get(b) || 0) + 1);
  }

  const topBrowsers = Array.from(browsers.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return {
    windowMs,
    sampleSize: n,
    avgScore: scoredCount ? Math.round(scoreSum / scoredCount) : 0,
    silenceFailureRate: round3(safeDiv(silent, n)),
    retryRate: round3(safeDiv(retries, n)),
    networkFailureRate: round3(safeDiv(network, n)),
    assistedRate: round3(safeDiv(assisted, n)),
    correctRate: round3(safeDiv(correct, n)),
    confidenceMix: {
      low: round3(safeDiv(conf.low, n)),
      medium: round3(safeDiv(conf.medium, n)),
      high: round3(safeDiv(conf.high, n)),
    },
    byDevice: {
      mobile: round3(safeDiv(devices.mobile, n)),
      desktop: round3(safeDiv(devices.desktop, n)),
    },
    topBrowsers,
  };
}

function reset() { events.length = 0; }

module.exports = {
  record,
  getInsights,
  reset,
  setWindow,
  _events: events, // exposed for tests only
};
