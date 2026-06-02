import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  fmtPaymentAmount,
  normalizePaymentCurrency,
  PAYMENT_CURRENCIES,
} from './payment-currency.util';

/** Single amount with currency code (e.g. LKR 10,000). */
@Component({
  selector: 'app-payment-currency-amount',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="ph-ccy-inline" *ngIf="amount > 0; else empty">
      <span class="ph-ccy-badge" [ngClass]="meta.badgeClass" [attr.title]="meta.label">
        <span class="ph-ccy-badge-code">{{ meta.label }}</span>
      </span>
      <span class="ph-ccy-inline-amt">{{ fmt(amount) }}</span>
    </span>
    <ng-template #empty><span class="ph-ccy-empty">—</span></ng-template>
  `,
  styleUrls: ['./payment-currency-shared.scss'],
})
export class PaymentCurrencyAmountComponent {
  @Input() currency: string = 'LKR';
  @Input() amount = 0;

  get meta() {
    const code = normalizePaymentCurrency(this.currency);
    return PAYMENT_CURRENCIES.find((c) => c.code === code) ?? PAYMENT_CURRENCIES[0];
  }

  fmt(n: number): string {
    return fmtPaymentAmount(n);
  }
}
