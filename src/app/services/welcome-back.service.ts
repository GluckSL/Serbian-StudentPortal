import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface WelcomeBackPayload {
  firstName: string;
  daysSince: number;
}

@Injectable({ providedIn: 'root' })
export class WelcomeBackService {
  private readonly pendingSubject = new BehaviorSubject<WelcomeBackPayload | null>(null);
  readonly pending$ = this.pendingSubject.asObservable();

  queue(payload: WelcomeBackPayload | null | undefined): void {
    if (payload?.firstName) {
      this.pendingSubject.next(payload);
    }
  }

  dismiss(): void {
    this.pendingSubject.next(null);
  }
}
