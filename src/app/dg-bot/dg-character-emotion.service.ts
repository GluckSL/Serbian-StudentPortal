import { Injectable } from '@angular/core';
import type { DgSceneType } from './dg-bot.types';
import type { DgCharacterAnimState } from './dg-character-state.service';
import type { PronunciationConfidence } from '../services/pronunciation.service';

export interface DgEmotionResult {
  isCorrect?: boolean;
  isSilent?: boolean;
  /** From pronunciation evaluation — shapes tone when the answer is not quite right. */
  confidence?: PronunciationConfidence;
}

@Injectable({ providedIn: 'root' })
export class DgCharacterEmotionService {
  /**
   * Map scene / feedback context to character animation state.
   * When `hasText` is false (no line and no audio), falls back to idle.
   */
  getEmotion(
    sceneType: DgSceneType | 'feedback',
    result?: DgEmotionResult,
    opts?: { hasText?: boolean },
  ): DgCharacterAnimState {
    const hasText = opts?.hasText !== false;

    if (sceneType === 'feedback') {
      if (!result) return hasText ? 'thinking' : 'idle';
      if (result.isSilent) return 'confused';
      if (result.isCorrect) return 'happy';
      if (result.confidence === 'medium') return 'thinking';
      return 'sad';
    }

    if (!hasText) return 'idle';

    if (sceneType === 'intro') return 'happy';
    if (sceneType === 'teach') return 'speaking';
    if (sceneType === 'practice') return 'listening';

    return 'idle';
  }
}
