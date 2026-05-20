import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { fmtPaymentAmount, PAYMENT_CURRENCIES } from './payment-currency.util';

@Component({
  selector: 'app-payment-currency-pending-totals',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="visibleRows.length; else empty">
      <div class="ph-currency-row" *ngFor="let row of visibleRows">
        <span class="ph-ccy-badge" [ngClass]="row.badgeClass" [attr.title]="row.label">
          <span class="ph-ccy-badge-symbol">{{ row.symbol }}</span>
          <span class="ph-ccy-badge-code">{{ row.label }}</span>
        </span>
        <span class="ph-currency-value ph-currency-value--amber" [class.ph-currency-value--compact]="compact">{{ fmt(row.amount) }}</span>
      </div>
    </ng-container>
    <ng-template #empty><span class="ph-ccy-empty">—</span></ng-template>
  `,
  styleUrls: ['./payment-currency-shared.scss'],
})
export class PaymentCurrencyPendingTotalsComponent {
  @Input() lkr = 0;
  @Input() inr = 0;
  @Input() usd = 0;
  @Input() compact = false;
  @Input() hideZero = true;

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
}
