// config/matchConfig.js — centralized thresholds for Zoom ↔ roster matching

module.exports = {
  /** Max |portal join click − Zoom participant join_time| for join_log_time fallback */
  JOIN_TIME_WINDOW_MS: 10 * 60 * 1000,
  /** Ignore Zoom rows shorter than this (seconds) for join-log fallback */
  MIN_DURATION_SEC: 300,
  /** Initials match only if normalized Zoom display name is this short or shorter */
  INITIALS_MAX_ZOOM_NAME_LEN: 4,
  /** Do not run initials / join-log fallback if we already have at least this confidence */
  STRONG_MATCH_MIN_CONFIDENCE: 90,
  /** Base confidence for join-log time match before secondary checks / duration */
  JOIN_LOG_BASE_CONFIDENCE: 70,
  /** Join-log match when portal name has no token overlap with Zoom and initials don’t align */
  JOIN_LOG_WEAK_CONFIDENCE: 55,
  /** Inclusive band: final confidence here → ambiguous (no auto-assign) */
  AMBIGUOUS_CONFIDENCE_MIN: 50,
  AMBIGUOUS_CONFIDENCE_MAX: 65,
  /** Skip fuzzy (and partial) stages when roster is this large */
  LARGE_ROSTER_THRESHOLD: 100,
  /** If true: no join_log / initials / fuzzy / partial / containment — only email, exact_name, strong email_local */
  STRICT_MATCH_MODE: process.env.STRICT_MATCH_MODE === 'true',
  /** Email-local auto-match requires safety (overlap / tokens); unsafe high scores capped here */
  EMAIL_LOCAL_UNSAFE_CAP: 80,

  /** Priority for weaker-match prevention (higher = stronger claim) */
  MATCH_PRIORITY: {
    EMAIL: 4,
    EXACT: 3,
    EMAIL_LOCAL_STRONG: 3,
    EMAIL_LOCAL_WEAK: 2,
    INITIALS: 2,
    JOIN_LOG: 2,
    CONTAINMENT: 2,
    PARTIAL: 1,
    FUZZY: 1,
    SINGLE_PARTICIPANT: 1,
  },

  /** Very large meetings: join-log off; only email, exact, initials, email_local ≥ 92 */
  SAFE_LARGE_CLASS_THRESHOLD: 150,
};
