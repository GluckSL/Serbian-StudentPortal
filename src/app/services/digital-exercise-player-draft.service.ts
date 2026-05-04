// src/app/services/digital-exercise-player-draft.service.ts
// Autosave student in-progress answers in localStorage with a 30-minute sliding TTL.

import { Injectable } from '@angular/core';

export const DIGITAL_EXERCISE_PLAYER_DRAFT_TTL_MS = 30 * 60 * 1000;

const STORAGE_PREFIX = 'gluck-de-player-draft';

/** One row per question index (same order as exercise.questions). */
export interface DigitalExerciseDraftItem {
  typ: string;
  selectedOption?: number | null;
  /** Matching: pair each left column row with the chosen right label (stable across reshuffled columns). */
  matchingSelections?: Array<{ leftIndex: number; rightValue: string }>;
  fillAnswers?: string[];
  singularPluralInputs?: string[];
  spokenText?: string;
  pronunciationScore?: number;
  hasRecorded?: boolean;
  qaResponse?: string;
  listeningText?: string;
  jumbleWordResponse?: string;
  vpSpokenText?: string;
  vpResult?: 'idle' | 'correct' | 'almostCorrect' | 'incorrect';
  vpPlaybackEnded?: boolean;
  vpFailCount?: number;
  isAnswered?: boolean;
  /** True if this question was already POSTed via submit-question (replay on restore). */
  serverGraded?: boolean;
}

export interface DigitalExerciseDraftPayload {
  v: 1;
  savedAt: number;
  expiresAt: number;
  userId: string;
  exerciseId: string;
  questionCount: number;
  currentIndex: number;
  elapsedSeconds: number;
  items: DigitalExerciseDraftItem[];
}

@Injectable({ providedIn: 'root' })
export class DigitalExercisePlayerDraftService {
  storageKey(userId: string, exerciseId: string): string {
    return `${STORAGE_PREFIX}:${userId}:${exerciseId}`;
  }

  read(userId: string, exerciseId: string, questionCount: number): DigitalExerciseDraftPayload | null {
    if (!userId || !exerciseId || typeof window === 'undefined' || !window.localStorage) return null;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(this.storageKey(userId, exerciseId));
    } catch {
      return null;
    }
    if (!raw) return null;
    let parsed: DigitalExerciseDraftPayload;
    try {
      parsed = JSON.parse(raw) as DigitalExerciseDraftPayload;
    } catch {
      this.clear(userId, exerciseId);
      return null;
    }
    if (!parsed || parsed.v !== 1 || parsed.userId !== userId || parsed.exerciseId !== exerciseId) {
      return null;
    }
    if (typeof parsed.expiresAt !== 'number' || Date.now() > parsed.expiresAt) {
      this.clear(userId, exerciseId);
      return null;
    }
    if (!Array.isArray(parsed.items) || parsed.items.length !== questionCount) {
      return null;
    }
    return parsed;
  }

  write(payload: Omit<DigitalExerciseDraftPayload, 'expiresAt' | 'savedAt'> & { expiresAt?: number; savedAt?: number }): void {
    if (!payload.userId || !payload.exerciseId || typeof window === 'undefined' || !window.localStorage) return;
    const now = Date.now();
    const full: DigitalExerciseDraftPayload = {
      ...payload,
      v: 1,
      savedAt: payload.savedAt ?? now,
      expiresAt: payload.expiresAt ?? now + DIGITAL_EXERCISE_PLAYER_DRAFT_TTL_MS
    };
    try {
      window.localStorage.setItem(this.storageKey(payload.userId, payload.exerciseId), JSON.stringify(full));
    } catch {
      /* quota or private mode */
    }
  }

  clear(userId: string, exerciseId: string): void {
    if (!userId || !exerciseId || typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.removeItem(this.storageKey(userId, exerciseId));
    } catch {
      /* ignore */
    }
  }
}
