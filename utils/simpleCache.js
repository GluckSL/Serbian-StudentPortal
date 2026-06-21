const cache = new Map();

const interval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expires <= now) cache.delete(key);
  }
}, 60_000);
if (interval.unref) interval.unref();

function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

module.exports = { get, set };
