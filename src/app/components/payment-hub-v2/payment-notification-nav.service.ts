import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PaymentHubApiService } from './payment-hub-api.service';

/** Unread journey language-fee due alerts (admin sidebar bell). */
@Injectable({ providedIn: 'root' })
export class PaymentNotificationNavService {
  private readonly countSubject = new BehaviorSubject(0);
  readonly unreadCount$: Observable<number> = this.countSubject.asObservable();

  constructor(private readonly api: PaymentHubApiService) {}

  setUnreadCount(count: number): void {
    this.countSubject.next(Math.max(0, count || 0));
  }

  refresh(): void {
    this.api.getPaymentNotificationUnreadCount({ type: 'JOURNEY_LANGUAGE_FEE_DUE' }).subscribe({
      next: (r) => this.setUnreadCount(r.data?.count ?? 0),
      error: () => { /* keep last count */ },
    });
  }
}
