import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface WelcomeBackPayload {
  missedClass?: boolean;
}

@Injectable({ providedIn: 'root' })
export class WelcomeBackService {
  private readonly pendingSubject = new BehaviorSubject<WelcomeBackPayload | null>(null);
  readonly pending$ = this.pendingSubject.asObservable();

  queue(payload: WelcomeBackPayload | null | undefined): void {
    if (payload?.missedClass) {
      this.pendingSubject.next(payload);
    }
  }

  dismiss(): void {
    this.pendingSubject.next(null);
  }
}
