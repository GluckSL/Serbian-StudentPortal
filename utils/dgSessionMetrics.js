'use strict';

/**
 * Shared helpers for DG Bot session time and chat extraction.
 * Used by dgSessionController and portalAnalytics to ensure consistent numbers.
 */

/**
 * Returns the total session duration in minutes (one decimal place).
 * Priority: timePerSceneMs array → scene_complete log durations → wall-clock diff.
 */
function totalSessionMinutes(session) {
  const arr = session.timePerSceneMs || [];
  const sumMs = arr.reduce((acc, n) => acc + (Number(n) || 0), 0);
  if (sumMs > 0) return Math.round((sumMs / 60000) * 10) / 10;
  let fromLogs = 0;
  for (const log of session.logs || []) {
    if (log.event === 'scene_complete' && typeof log.durationMs === 'number') {
      fromLogs += log.durationMs;
    }
  }
  if (fromLogs > 0) return Math.round((fromLogs / 60000) * 10) / 10;
  const c = session.createdAt ? new Date(session.createdAt).getTime() : 0;
  const u = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
  if (u > c) return Math.max(0, Math.round(((u - c) / 60000) * 10) / 10);
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
