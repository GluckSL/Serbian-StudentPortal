import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PaymentHubApiService } from './payment-hub-api.service';

/** Pending payment-proof count for Req Payment nav badge (admin). */
@Injectable({ providedIn: 'root' })
export class PaymentRequestNavService {
  private readonly countSubject = new BehaviorSubject(0);
  readonly pendingCount$: Observable<number> = this.countSubject.asObservable();

  constructor(private readonly api: PaymentHubApiService) {}

  setPendingCount(count: number): void {
    this.countSubject.next(Math.max(0, count || 0));
  }

  refresh(): void {
    forkJoin({
      hub: this.api.getApprovalQueue({ page: 1, limit: 1, status: 'SUBMITTED,UNDER_REVIEW' }).pipe(
        catchError(() => of({ total: 0, data: [] })),
      ),
      signups: this.api.getPendingSignupApplications().pipe(
        catchError(() => of({ total: 0, data: [] })),
      ),
    }).subscribe({
      next: ({ hub, signups }) => {
        const total = (hub.total || 0) + (signups.total ?? signups.data?.length ?? 0);
        this.setPendingCount(total);
      },
    });
  }
}
