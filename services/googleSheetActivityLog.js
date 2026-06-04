/** In-memory activity log for Google Sheet sync + OCR (admin UI polling). */
const MAX_ENTRIES = 400;

let nextId = 1;
const entries = [];
let job = null;

function append(level, message) {
  const entry = {
    id: nextId++,
    at: new Date().toISOString(),
    level,
    message: String(message),
  };
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) entries.shift();
  return entry;
}

function startJob(type, total, message) {
  job = {
    type,
    running: true,
    current: 0,
    total: total || 0,
    startedAt: new Date().toISOString(),
    message: message || '',
  };
  append('info', message);
}

function setJobProgress(current, total, message) {
  if (job) {
    job.current = current;
    job.total = total;
    if (message) job.message = message;
  }
  if (message) append('info', message);
}

function endJob(ok, message) {
  append(ok ? 'success' : 'error', message);
  if (job) {
    job.running = false;
    job.finishedAt = new Date().toISOString();
    job.message = message;
  }
  const finished = job;
  setTimeout(() => {
    if (job === finished && !job.running) job = null;
  }, 120000);
}

function clearLog() {
  entries.length = 0;
  nextId = 1;
  job = null;
}

function getActivity(since = 0) {
  const sid = Number(since) || 0;
  return {
    job,
    logs: entries.filter((e) => e.id > sid),
    lastId: entries.length ? entries[entries.length - 1].id : 0,
  };
}

function isJobRunning() {
  return !!(job && job.running);
}

module.exports = {
  append,
  startJob,
  setJobProgress,
  endJob,
  clearLog,
  getActivity,
  isJobRunning,
};
