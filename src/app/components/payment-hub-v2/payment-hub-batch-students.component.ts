import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  BatchStudentPaymentRow,
  CurrencyBucket,
  CurrencyPaidTotals,
  PaymentHubApiService,
} from './payment-hub-api.service';
import { PaymentCurrencyAmountComponent } from './payment-currency-amount.component';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyPendingTotalsComponent } from './payment-currency-pending-totals.component';
import { paidTotalsFromBucket } from './payment-currency.util';
import { formatJourneyDayCurrentTotal } from './payment-journey-metrics.util';

@Component({
  selector: 'app-payment-hub-batch-students',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
    PaymentCurrencyAmountComponent,
  ],
  templateUrl: './payment-hub-batch-students.component.html',
  styleUrls: ['./payment-hub-insights-page.scss', './payment-hub-batch-students.component.scss'],
})
export class PaymentHubBatchStudentsComponent implements OnInit {
  loading = true;
  batch = '';
  rows: BatchStudentPaymentRow[] = [];
  readonly levelCols = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: PaymentHubApiService,
  ) {}

  ngOnInit(): void {
    this.batch = decodeURIComponent(this.route.snapshot.paramMap.get('batch') || '');
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.getBatchStudentsPaymentDetail(this.batch).subscribe({
      next: (res) => {
        this.rows = res.data?.students || [];
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.loading = false;
      },
    });
  }

  levelPaidTotals(row: BatchStudentPaymentRow, level: string): CurrencyPaidTotals {
    const raw = row.levelPaid?.[level];
    if (raw && typeof raw === 'object') return paidTotalsFromBucket(raw as CurrencyBucket);
    const legacy = typeof raw === 'number' ? raw : 0;
    return { totalPaidLKR: legacy, totalPaidINR: 0, totalPaidUSD: 0 };
  }

  bucketTotals(bucket: CurrencyBucket | undefined): CurrencyPaidTotals {
    return paidTotalsFromBucket(bucket);
  }

  journeyDayDisplay(row: BatchStudentPaymentRow): string {
    return formatJourneyDayCurrentTotal({ currentCourseDay: row.currentJourneyDay }, row.level);
  }

  totalPaidSum(): CurrencyPaidTotals {
    return this.rows.reduce(
      (acc, r) => ({
        totalPaidLKR: acc.totalPaidLKR + (r.totalPaidLKR || 0),
        totalPaidINR: acc.totalPaidINR + (r.totalPaidINR || 0),
        totalPaidUSD: acc.totalPaidUSD + (r.totalPaidUSD || 0),
      }),
      { totalPaidLKR: 0, totalPaidINR: 0, totalPaidUSD: 0 },
    );
  }

  fmt(n: number | null | undefined): string {
    return (n ?? 0).toLocaleString('en-IN');
  }

  fmtDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      GOOD_STANDING: 'pill-green',
      FULLY_PAID: 'pill-green',
      PENDING: 'pill-amber',
      OVERDUE: 'pill-red',
      NO_REQUESTS: 'pill-grey',
    };
    return map[status] || 'pill-grey';
  }

  studentDetailLink(studentId: string): string[] {
    return ['/admin/payment-hub/student', studentId];
  }
}
