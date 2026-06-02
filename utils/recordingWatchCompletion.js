/** Shared threshold for “recording watched” (Silver GO uses 90%; others often 75%). */
const SILVER_GO_RECORDING_WATCH_RATIO = 0.9;

function recordingWatchCountsAsComplete(watchSeconds, durationSeconds, ratio = SILVER_GO_RECORDING_WATCH_RATIO) {
  const watched = Math.max(0, Number(watchSeconds) || 0);
  const total = Math.max(0, Number(durationSeconds) || 0);
  if (total <= 0) return watched > 0;
  return watched >= Math.ceil(total * ratio);
}

module.exports = {
  SILVER_GO_RECORDING_WATCH_RATIO,
  recordingWatchCountsAsComplete
};
