import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { fmtPaymentAmount, PAYMENT_CURRENCIES } from './payment-currency.util';

@Component({
  selector: 'app-payment-currency-overdue-totals',
  standalone: true,
  imports: [CommonModule, MatTooltipModule],
  template: `
    <ng-container *ngIf="visibleRows.length; else empty">
      <div class="ph-currency-row" [class.ph-currency-row--compact]="compact" *ngFor="let row of visibleRows">
        <span class="ph-ccy-badge" [ngClass]="row.badgeClass" [attr.title]="row.label">
          <span class="ph-ccy-badge-code">{{ row.label }}</span>
        </span>
        <span class="ph-currency-value ph-currency-value--red" [class.ph-currency-value--compact]="compact">{{ fmt(row.amount) }}</span>
      </div>
      <div class="ph-overdue-since" *ngIf="sinceDate" [matTooltip]="'Overdue since ' + fmtSince(sinceDate)">
        Since {{ fmtSince(sinceDate) }}
      </div>
    </ng-container>
    <ng-template #empty><span class="ph-ccy-empty">0</span></ng-template>
  `,
  styleUrls: ['./payment-currency-shared.scss'],
})
export class PaymentCurrencyOverdueTotalsComponent {
  @Input() lkr = 0;
  @Input() inr = 0;
  @Input() usd = 0;
  @Input() compact = false;
  @Input() hideZero = true;
  /** Earliest overdue conversion date for the row (ISO string). */
  @Input() sinceDate?: string | null;

  get visibleRows() {
    const amounts = { LKR: this.lkr ?? 0, INR: this.inr ?? 0, USD: this.usd ?? 0 };
    return PAYMENT_CURRENCIES.map((meta) => ({
      ...meta,
      amount: amounts[meta.code],
    })).filter((row) => !this.hideZero || row.amount > 0);
  }

  fmt(n: number): string {
    return fmtPaymentAmount(n);
  }

  fmtSince(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
