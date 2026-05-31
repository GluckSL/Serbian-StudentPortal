// utils/matchLogger.js — structured logs for grep-friendly production debugging

function basePayload(event, payload) {
  return JSON.stringify({
    level: 'info',
    event,
    ts: new Date().toISOString(),
    ...payload,
  });
}

function info(event, payload = {}) {
  console.log(basePayload(event, payload));
}

function warn(event, payload = {}) {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event,
      ts: new Date().toISOString(),
      ...payload,
    })
  );
}

function error(event, payload = {}) {
  console.error(
    JSON.stringify({
      level: 'error',
      event,
      ts: new Date().toISOString(),
      ...payload,
    })
  );
}

module.exports = { info, warn, error };
