/** Small pacing helper for scene / TTS / mic handoff. */
export function dgDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Character / dialogue UX timing (DG Bot player). */
export const DG_CHAR_TIMING = {
  preSpeakAnticipationMs: 150,
  postSpeakSpeakingTailMs: 100,
  postSpeakPauseBeforeReactionMs: 150,
  reactionHoldMs: 300,
  successHappyHoldMs: 400,
  failureThinkBeforeSadMs: 200,
  practiceListeningPrimingMs: 300,
} as const;

/** ±40ms jitter on top of (base × pacing) — keeps motion human, bounded. */
export async function humanDelay(baseMs: number, pacing = 1): Promise<void> {
  const jitter = Math.random() * 80 - 40;
  const ms = Math.max(30, Math.round(baseMs * pacing + jitter));
  await dgDelay(ms);
}

/**
 * Flow multiplier: gentler after a wrong attempt, slightly snappier on a correct streak.
 * Clamped to [0.9, 1.2].
 */
export function dgPacingMultiplier(ctx: { lastPracticeWrong: boolean; correctStreak: number }): number {
  let m = 1;
  if (ctx.lastPracticeWrong) m += 0.12;
  if (ctx.correctStreak >= 2) m -= 0.06 * Math.min(ctx.correctStreak - 1, 3);
  return Math.min(1.2, Math.max(0.9, m));
}

/** ~15% chance of an extra “thinking” beat (200–400ms), scaled by pacing. */
export async function maybeOccasionalThoughtPause(pacing: number): Promise<void> {
  if (Math.random() >= 0.15) return;
  const extra = 200 + Math.random() * 200;
  await dgDelay(Math.max(120, Math.round(extra * pacing)));
}

/** Subtle hold-length variety for the same nominal emotion (20–30% branches). */
export function humanReactionHoldMs(
  baseMs: number,
  mood: 'happy' | 'sad' | 'default',
): number {
  const r = Math.random();
  if (mood === 'happy') {
    if (r < 0.25) return Math.max(120, Math.round(baseMs * 0.72));
    if (r < 0.5) return Math.round(baseMs * 1.28);
    return baseMs;
  }
  if (mood === 'sad') {
    if (r < 0.28) return Math.round(baseMs * 1.22);
    if (r < 0.42) return Math.max(120, Math.round(baseMs * 0.9));
    return baseMs;
  }
  if (r < 0.22) return Math.max(120, Math.round(baseMs * 0.88));
  if (r < 0.38) return Math.round(baseMs * 1.14);
  return baseMs;
}

/** Think-before-sad: sometimes snappier, sometimes more hesitant. */
export function humanFailureThinkMs(baseMs: number): number {
  const r = Math.random();
  if (r < 0.25) return Math.max(80, Math.round(baseMs * 0.52));
  if (r < 0.45) return Math.round(baseMs * 1.38);
  return baseMs;
}

/** At most one retry — for flaky mobile networks. */
export async function dgWithOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}
