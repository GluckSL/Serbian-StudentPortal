/**
 * Per-scene expressive behavior (presets + emotion variants).
 * Scales inputs passed into {@link humanDelay} / timing bases — does not replace timing helpers.
 */

export type DgBehaviorPreset = 'fast' | 'normal' | 'expressive';

export type DgHappyVariant = 'quick' | 'proud' | 'bounce';
export type DgSadVariant = 'immediate' | 'delayed' | 'shortRetry';
export type DgThinkingVariant = 'short' | 'long' | 'quick';

export interface DgSceneBehaviorPlan {
  preset: DgBehaviorPreset;
  happyVariant: DgHappyVariant;
  sadVariant: DgSadVariant;
  thinkingVariant: DgThinkingVariant;
  /** ~10%: slightly longer pre-speak and, on success, a touch more celebration hold */
  emphasisMoment: boolean;
}

const PRESET = {
  fast: { preSpeak: 0.88, reactionHold: 0.9, transition: 0.9 },
  normal: { preSpeak: 1, reactionHold: 1, transition: 1 },
  expressive: { preSpeak: 1.14, reactionHold: 1.12, transition: 1.08 },
} as const;

const THINKING_PRE = {
  short: 0.92,
  long: 1.18,
  quick: 0.84,
} as const;

const THINKING_TRANSITION = {
  short: 0.96,
  long: 1.06,
  quick: 0.9,
} as const;

const HAPPY_HOLD = {
  quick: 0.9,
  proud: 1.26,
  bounce: 1.06,
} as const;

const SAD_HOLD = {
  immediate: 0.92,
  delayed: 1.12,
  shortRetry: 0.86,
} as const;

const NEUTRAL_HOLD = {
  short: 0.96,
  long: 1.04,
  quick: 0.94,
} as const;

function pick3<T extends readonly string[]>(variants: T): T[number] {
  return variants[Math.floor(Math.random() * variants.length)] as T[number];
}

function pickPreset(consecutivePracticeFails: number, correctStreak: number): DgBehaviorPreset {
  if (correctStreak >= 2 && consecutivePracticeFails === 0) {
    const r = Math.random();
    if (r < 0.48) return 'fast';
    if (r < 0.88) return 'normal';
    return 'expressive';
  }
  if (consecutivePracticeFails >= 2) {
    const r = Math.random();
    if (r < 0.42) return 'expressive';
    if (r < 0.78) return 'normal';
    return 'fast';
  }
  const r = Math.random();
  if (r < 0.34) return 'normal';
  if (r < 0.67) return 'fast';
  return 'expressive';
}

function pickThinkingVariant(correctStreak: number, consecutivePracticeFails: number): DgThinkingVariant {
  if (correctStreak >= 2 && consecutivePracticeFails === 0 && Math.random() < 0.38) {
    return 'quick';
  }
  if (consecutivePracticeFails >= 2 && Math.random() < 0.4) {
    return 'long';
  }
  return pick3(['short', 'long', 'quick'] as const);
}

/** New plan for the current scene index — call once per {@link presentScene}. */
export function createSceneBehaviorPlan(ctx: {
  consecutivePracticeFails: number;
  correctStreak: number;
}): DgSceneBehaviorPlan {
  return {
    preset: pickPreset(ctx.consecutivePracticeFails, ctx.correctStreak),
    happyVariant: pick3(['quick', 'proud', 'bounce'] as const),
    sadVariant: pick3(['immediate', 'delayed', 'shortRetry'] as const),
    thinkingVariant: pickThinkingVariant(ctx.correctStreak, ctx.consecutivePracticeFails),
    emphasisMoment: Math.random() < 0.1,
  };
}

export function behaviorPreSpeakFactor(plan: DgSceneBehaviorPlan): number {
  const p = PRESET[plan.preset].preSpeak;
  const t = THINKING_PRE[plan.thinkingVariant];
  const e = plan.emphasisMoment ? 1.26 : 1;
  return p * t * e;
}

export function behaviorTransitionFactor(plan: DgSceneBehaviorPlan): number {
  return PRESET[plan.preset].transition * THINKING_TRANSITION[plan.thinkingVariant];
}

export function behaviorReactionHoldFactor(
  plan: DgSceneBehaviorPlan,
  mood: 'happy' | 'sad' | 'default',
): number {
  const p = PRESET[plan.preset].reactionHold;
  if (mood === 'happy') return p * HAPPY_HOLD[plan.happyVariant];
  if (mood === 'sad') return p * SAD_HOLD[plan.sadVariant];
  return p * NEUTRAL_HOLD[plan.thinkingVariant];
}

/** Scales the think→sad gap from {@link humanFailureThinkMs} (not double-stacked with hold factors). */
export function behaviorFailureThinkFactor(plan: DgSceneBehaviorPlan, consecutiveFails: number): number {
  let m =
    plan.sadVariant === 'immediate' ? 0.66 : plan.sadVariant === 'delayed' ? 1.34 : 0.9;
  if (consecutiveFails >= 2) {
    m *= 1.08 + 0.04 * Math.min(consecutiveFails - 2, 2);
  }
  return m;
}

/** Extra celebration hold after correct (subtle; stacks only as one multiplier). */
export function behaviorSuccessHoldBoost(plan: DgSceneBehaviorPlan): number {
  return plan.emphasisMoment ? 1.12 : 1;
}

/** Skip occasional thought pause when emphasis already lengthened pre-speak (avoid stacking). */
export function shouldSkipOccasionalThoughtPause(plan: DgSceneBehaviorPlan): boolean {
  return plan.emphasisMoment;
}
