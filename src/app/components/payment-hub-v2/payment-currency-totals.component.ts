import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  amountForCurrency,
  CurrencyPaidTotals,
  fmtPaymentAmount,
  PAYMENT_CURRENCIES,
} from './payment-currency.util';

/** Shows LKR / INR / Euro (USD) with currency badges — never combines currencies. */
@Component({
  selector: 'app-payment-currency-totals',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="visibleRows.length; else empty">
      <div class="ph-currency-row" *ngFor="let row of visibleRows">
        <span class="ph-ccy-badge" [ngClass]="row.badgeClass" [attr.title]="row.label">
          <span class="ph-ccy-badge-symbol">{{ row.symbol }}</span>
          <span class="ph-ccy-badge-code">{{ row.label }}</span>
        </span>
        <span class="ph-currency-value" [class.ph-currency-value--compact]="compact">{{ fmt(row.amount) }}</span>
      </div>
    </ng-container>
    <ng-template #empty><span class="ph-ccy-empty">—</span></ng-template>
  `,
  styleUrls: ['./payment-currency-shared.scss'],
})
export class PaymentCurrencyTotalsComponent {
  @Input() lkr = 0;
  @Input() inr = 0;
  @Input() usd = 0;
  @Input() compact = false;
  /** When true, only rows with amount &gt; 0 (good for table cells). */
  @Input() hideZero = false;

  get totals(): CurrencyPaidTotals {
    return { totalPaidLKR: this.lkr ?? 0, totalPaidINR: this.inr ?? 0, totalPaidUSD: this.usd ?? 0 };
  }

  get visibleRows() {
    return PAYMENT_CURRENCIES.map((meta) => ({
      ...meta,
      amount: amountForCurrency(meta.code, this.totals),
    })).filter((row) => !this.hideZero || row.amount > 0);
  }

  fmt(n: number): string {
    return fmtPaymentAmount(n);
  }
}
