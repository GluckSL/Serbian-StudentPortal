import { Injectable } from '@angular/core';
import type { DgEmotion, DgGoalStep, DgPlayerStatus, DgScene, DgSceneType } from './dg-bot.types';

/** Orchestration helpers — flow control lives in the player; this keeps rules testable. */
@Injectable({ providedIn: 'root' })
export class DgSceneEngineService {
  readonly flowTypes: DgSceneType[] = ['intro', 'teach', 'practice', 'feedback'];

  emotionAfterEvaluation(correct: boolean, silence: boolean): DgEmotion {
    if (silence) return 'confused';
    return correct ? 'happy' : 'sad';
  }

  feedbackLines(correct: boolean, silence: boolean): { de: string; en: string } {
    if (silence) {
      return {
        de: 'Ich habe dich nicht gut gehört. Sprich bitte etwas deutlicher.',
        en: "I couldn't hear you clearly. Let's try once more.",
      };
    }
    if (correct) {
      return { de: 'Großartig! Perfekt!', en: 'Great job! Perfect pronunciation!' };
    }
    return { de: 'Hmm… Nicht ganz. Versuch es noch einmal!', en: "Hmm… Not quite right. Let's try again!" };
  }

  buildGoalSteps(args: {
    scene: DgScene | null;
    status: DgPlayerStatus;
    practicePassed: boolean;
  }): DgGoalStep[] {
    const scene = args.scene;
    const isPractice = scene?.type === 'practice';
    const listeningDone = !isPractice || ['processing', 'result', 'idle'].includes(args.status) || args.practicePassed;
    const repeatCurrent = isPractice && (args.status === 'listening' || args.status === 'processing');
    const practiceDone = isPractice && args.practicePassed;
    return [
      { id: 'listen', label: 'Listen', done: listeningDone, current: isPractice && args.status === 'speaking' },
      { id: 'repeat', label: 'Repeat', done: practiceDone, current: !!repeatCurrent },
      { id: 'practice', label: 'Practice', done: practiceDone, current: isPractice && !practiceDone && args.status !== 'speaking' },
      { id: 'feedback', label: 'Get feedback', done: practiceDone, current: isPractice && args.status === 'result' },
    ];
  }

  animationKeyForEmotion(emotion: DgEmotion): string {
    const map: Record<DgEmotion, string> = {
      neutral: 'idle',
      happy: 'happy',
      sad: 'sad',
      thinking: 'thinking',
      speaking: 'speaking',
      confused: 'thinking',
      surprised: 'surprised',
      concerned: 'concerned',
      excited: 'excited',
    };
    return map[emotion] || 'idle';
  }
}
