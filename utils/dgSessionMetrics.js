'use strict';

/**
 * Shared helpers for DG Bot session time and chat extraction.
 * Used by dgSessionController and portalAnalytics to ensure consistent numbers.
 */

/** Max gap between activity logs counted as one continuous stretch (15 min). */
const MAX_LOG_GAP_MS = 15 * 60 * 1000;

const ACTIVITY_LOG_EVENTS = new Set([
  'conv_student',
  'conv_ai',
  'conv_hint',
  'practice_attempt',
  'scene_complete',
  'tts_play',
  'scene_enter',
]);

function minutesFromMs(ms) {
  return Math.round((ms / 60000) * 10) / 10;
}

/**
 * Estimates active time from spaced activity logs (conversation modules do not
 * always populate timePerSceneMs). Gaps longer than MAX_LOG_GAP_MS are capped so
 * idle time between visits is not counted.
 */
function activeTimeFromLogsMs(session) {
  const logs = (session.logs || [])
    .filter((log) => log.at && ACTIVITY_LOG_EVENTS.has(log.event))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  if (logs.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < logs.length; i += 1) {
    const gap = new Date(logs[i].at).getTime() - new Date(logs[i - 1].at).getTime();
    if (gap > 0) total += Math.min(gap, MAX_LOG_GAP_MS);
  }
  return total;
}

/**
 * Returns the total session duration in minutes (one decimal place).
 * Priority: timePerSceneMs → scene_complete durations → log-based active time →
 * wall-clock (completed sessions only, uses completedAt not updatedAt).
 */
function totalSessionMinutes(session) {
  const arr = session.timePerSceneMs || [];
  const sumMs = arr.reduce((acc, n) => acc + (Number(n) || 0), 0);
  if (sumMs > 0) return minutesFromMs(sumMs);

  let fromSceneLogs = 0;
  for (const log of session.logs || []) {
    if (log.event === 'scene_complete' && typeof log.durationMs === 'number') {
      fromSceneLogs += log.durationMs;
    }
  }
  if (fromSceneLogs > 0) return minutesFromMs(fromSceneLogs);

  const fromActivityLogs = activeTimeFromLogsMs(session);
  if (fromActivityLogs > 0) return minutesFromMs(fromActivityLogs);

  // Incomplete sessions must not use createdAt→updatedAt: every conv_* save bumps
  // updatedAt, so a student who opens the module and returns a day later looks
  // like they practiced for 24h+.
  if (!session.completed) return 0;

  const c = session.createdAt ? new Date(session.createdAt).getTime() : 0;
  const end = session.completedAt
    ? new Date(session.completedAt).getTime()
    : session.updatedAt
      ? new Date(session.updatedAt).getTime()
      : 0;
  if (end > c) return minutesFromMs(end - c);
  return 0;
}

/**
 * Extracts ordered, human-readable chat turns from a DGSession log array.
 * Includes conversation turns (student/ai/hint) and practice attempts.
 */
function extractChatTurns(logs) {
  const out = [];
  for (const log of logs || []) {
    if (log.event === 'conv_student' && String(log.transcript || '').trim()) {
      out.push({
        at: log.at,
        speaker: 'student',
        text: String(log.transcript).trim(),
        score: log.score != null ? log.score : undefined,
      });
    } else if (log.event === 'conv_ai' && log.meta && String(log.meta.text || '').trim()) {
      out.push({
        at: log.at,
        speaker: 'ai',
        text: String(log.meta.text).trim(),
        kind: log.meta.kind || undefined,
      });
    } else if (log.event === 'conv_hint' && log.meta) {
      const hint = String(log.meta.text || '').trim();
      if (hint) {
        out.push({
          at: log.at,
          speaker: 'hint',
          text: hint,
          instructionEn: String(log.meta.instructionEn || log.meta.instruction || '').trim(),
        });
      }
    } else if (log.event === 'practice_attempt' && String(log.transcript || '').trim()) {
      out.push({
        at: log.at,
        speaker: 'student',
        text: String(log.transcript).trim(),
        score: log.score != null ? log.score : undefined,
        kind: 'practice',
      });
    }
  }
  out.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  return out;
}

/**
 * Best available score for a session (0–100).
 * Completed sessions often store score=0 while moduleCompletionPercent or log scores hold the real value.
 */
function effectiveSessionScore(session) {
  let best = typeof session.score === 'number' && Number.isFinite(session.score) ? Math.round(session.score) : 0;
  const pct = session.moduleCompletionPercent;
  if (typeof pct === 'number' && Number.isFinite(pct)) {
    best = Math.max(best, Math.round(pct));
  }
  for (const log of session.logs || []) {
    if (typeof log.score === 'number' && Number.isFinite(log.score)) {
      best = Math.max(best, Math.round(log.score));
    }
    if (log.event === 'session_complete' && log.meta && typeof log.meta === 'object') {
      if (typeof log.meta.successRate === 'number' && Number.isFinite(log.meta.successRate)) {
        best = Math.max(best, Math.round(log.meta.successRate));
      }
      if (typeof log.meta.finalScore === 'number' && Number.isFinite(log.meta.finalScore)) {
        best = Math.max(best, Math.round(log.meta.finalScore));
      }
    }
  }
  return Math.min(100, Math.max(0, best));
}

module.exports = { totalSessionMinutes, extractChatTurns, effectiveSessionScore };
