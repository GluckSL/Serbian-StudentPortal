import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * Visual / UX state for the DG tutor character.
 * Single source of truth for avatar styling and motion cues.
 */
export type DgCharacterAnimState =
  | 'idle'
  | 'speaking'
  | 'listening'
  | 'thinking'
  | 'happy'
  | 'sad'
  | 'confused';

@Injectable({ providedIn: 'root' })
export class DgCharacterStateService {
  private readonly subject = new BehaviorSubject<DgCharacterAnimState>('idle');

  /** Current character animation state (cold observable for templates). */
  readonly state$ = this.subject.asObservable();

  get snapshot(): DgCharacterAnimState {
    return this.subject.value;
  }

  setState(next: DgCharacterAnimState): void {
    if (this.subject.value !== next) {
      this.subject.next(next);
    }
  }

  /** Return to idle after a brief expressive state (happy/sad/confused). */
  resetToIdle(): void {
    const cur = this.subject.value;
    if (cur === 'happy' || cur === 'sad' || cur === 'confused') {
      this.subject.next('idle');
    }
  }

  forceIdle(): void {
    this.subject.next('idle');
  }
}
