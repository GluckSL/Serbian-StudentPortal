import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  BatchStudentPaymentRow,
  CurrencyBucket,
  CurrencyPaidTotals,
  PaymentHubApiService,
} from './payment-hub-api.service';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyPendingTotalsComponent } from './payment-currency-pending-totals.component';
import { PaymentCurrencyOverdueTotalsComponent } from './payment-currency-overdue-totals.component';
import { paidTotalsFromBucket } from './payment-currency.util';
import { formatJourneyDayCurrentTotal } from './payment-journey-metrics.util';
import {
  computeLanguageFeeStatus,
  LANGUAGE_FEE_STATUS_LABELS,
  languageFeeStatusClass,
  LanguageFeeStatus,
} from './payment-language-fee-status.util';

type StudentInsightFilter = '' | 'paid_full' | 'have_balance' | 'overdue' | 'paid_docs' | 'paid_visa';

@Component({
  selector: 'app-payment-hub-batch-students',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatInputModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
    PaymentCurrencyOverdueTotalsComponent,
  ],
  templateUrl: './payment-hub-batch-students.component.html',
  styleUrls: ['./payment-hub-insights-page.scss', './payment-hub-batch-students.component.scss'],
})
export class PaymentHubBatchStudentsComponent implements OnInit {
  loading = true;
  batch = '';
  rows: BatchStudentPaymentRow[] = [];
  searchQuery = '';
  studentInsight: StudentInsightFilter = '';
  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8];

  readonly studentInsightOptions = [
    { value: '' as StudentInsightFilter, key: 'all', label: 'Total students', icon: 'groups', hint: 'Show all students', color: 'slate', amountKind: 'received' as const },
    { value: 'paid_full' as StudentInsightFilter, key: 'paid_full', label: 'Paid full', icon: 'check_circle', hint: 'Language fee fully paid', color: 'green', amountKind: 'received' as const },
    { value: 'have_balance' as StudentInsightFilter, key: 'have_balance', label: 'Have balance', icon: 'account_balance_wallet', hint: 'Outstanding balance', color: 'amber', amountKind: 'pending' as const },
    { value: 'overdue' as StudentInsightFilter, key: 'overdue', label: 'Overdue', icon: 'warning_amber', hint: 'Past due payments', color: 'red', amountKind: 'overdue' as const },
    { value: 'paid_docs' as StudentInsightFilter, key: 'paid_docs', label: 'Paid docs', icon: 'description', hint: 'Docs payment approved', color: 'teal', amountKind: 'docs' as const },
    { value: 'paid_visa' as StudentInsightFilter, key: 'paid_visa', label: 'Paid visa', icon: 'flight', hint: 'Visa payment approved', color: 'indigo', amountKind: 'visa' as const },
  ] as const;

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

  get displayRows(): BatchStudentPaymentRow[] {
    let list = this.rows;
    if (this.studentInsight) {
      list = list.filter((r) => this.rowMatchesInsight(r, this.studentInsight));
    }
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q),
    );
  }

  insightCount(key: string): number {
    if (key === 'all') return this.rows.length;
    const insight = key as StudentInsightFilter;
    return this.rows.filter((r) => this.rowMatchesInsight(r, insight)).length;
  }

  studentPct(count: number, total: number): string {
    if (!total) return '0%';
    return `${Math.round((count / total) * 100)}%`;
  }

  applyInsightFilter(insight: StudentInsightFilter): void {
    this.studentInsight = this.studentInsight === insight ? '' : insight;
  }

  isInsightActive(value: StudentInsightFilter): boolean {
    return this.studentInsight === value;
  }

  activeInsightLabel(): string {
    const opt = this.studentInsightOptions.find((o) => o.value === this.studentInsight);
    return opt?.label || '';
  }

  hasInsightAmount(key: string): boolean {
    const a = this.insightAmountsFor(key);
    return a.lkr > 0 || a.inr > 0 || a.usd > 0;
  }

  insightAmountLkr(key: string): number {
    return this.insightAmountsFor(key).lkr;
  }

  insightAmountInr(key: string): number {
    return this.insightAmountsFor(key).inr;
  }

  insightAmountUsd(key: string): number {
    return this.insightAmountsFor(key).usd;
  }

  private insightAmountsFor(key: string): { lkr: number; inr: number; usd: number } {
    const matched =
      key === 'all'
        ? this.rows
        : this.rows.filter((r) => this.rowMatchesInsight(r, key as StudentInsightFilter));

    return matched.reduce(
      (acc, r) => {
        if (key === 'have_balance') {
          return {
            lkr: acc.lkr + (r.pendingApprovalAmountLKR ?? 0),
            inr: acc.inr + (r.pendingApprovalAmountINR ?? 0),
            usd: acc.usd + (r.pendingApprovalAmountUSD ?? 0),
          };
        }
        if (key === 'overdue') {
          return {
            lkr: acc.lkr + (r.overdueAmountLKR ?? 0),
            inr: acc.inr + (r.overdueAmountINR ?? 0),
            usd: acc.usd + (r.overdueAmountUSD ?? 0),
          };
        }
        if (key === 'paid_docs') {
          const d = this.bucketTotals(r.docsPaidByCurrency);
          return { lkr: acc.lkr + d.totalPaidLKR, inr: acc.inr + d.totalPaidINR, usd: acc.usd + d.totalPaidUSD };
        }
        if (key === 'paid_visa') {
          const v = this.bucketTotals(r.visaPaidByCurrency);
          return { lkr: acc.lkr + v.totalPaidLKR, inr: acc.inr + v.totalPaidINR, usd: acc.usd + v.totalPaidUSD };
        }
        return {
          lkr: acc.lkr + (r.totalPaidLKR ?? 0),
          inr: acc.inr + (r.totalPaidINR ?? 0),
          usd: acc.usd + (r.totalPaidUSD ?? 0),
        };
      },
      { lkr: 0, inr: 0, usd: 0 },
    );
  }

  private rowMatchesInsight(row: BatchStudentPaymentRow, insight: StudentInsightFilter): boolean {
    if (!insight) return true;
    const status = this.rowLanguageFeeStatus(row);
    switch (insight) {
      case 'paid_full':
        return status === 'FULL_PAID';
      case 'have_balance':
        return status === 'BALANCE' || this.pendingTotal(row) > 0;
      case 'overdue':
        return status === 'DUE' || this.overdueTotal(row) > 0 || row.overallStatus === 'OVERDUE';
      case 'paid_docs':
        return this.bucketPaidTotal(row.docsPaidByCurrency) > 0;
      case 'paid_visa':
        return this.bucketPaidTotal(row.visaPaidByCurrency) > 0;
      default:
        return true;
    }
  }

  private rowLanguageFeeStatus(row: BatchStudentPaymentRow): LanguageFeeStatus {
    const pending = this.pendingTotal(row);
    const overdue = this.overdueTotal(row);
    if (pending <= 0 && overdue <= 0 && ['FULLY_PAID', 'GOOD_STANDING'].includes(row.overallStatus)) {
      return 'FULL_PAID';
    }
    return computeLanguageFeeStatus(pending + overdue, row.currentJourneyDay);
  }

  private pendingTotal(row: BatchStudentPaymentRow): number {
    return (row.pendingApprovalAmountLKR ?? 0) + (row.pendingApprovalAmountINR ?? 0) + (row.pendingApprovalAmountUSD ?? 0);
  }

  private overdueTotal(row: BatchStudentPaymentRow): number {
    return (row.overdueAmountLKR ?? 0) + (row.overdueAmountINR ?? 0) + (row.overdueAmountUSD ?? 0);
  }

  private bucketPaidTotal(bucket: CurrencyBucket | undefined): number {
    const t = paidTotalsFromBucket(bucket);
    return t.totalPaidLKR + t.totalPaidINR + t.totalPaidUSD;
  }

  bucketTotals(bucket: CurrencyBucket | undefined): CurrencyPaidTotals {
    return paidTotalsFromBucket(bucket);
  }

  journeyDayDisplay(row: BatchStudentPaymentRow): string {
    return formatJourneyDayCurrentTotal({ currentCourseDay: row.currentJourneyDay }, row.level);
  }

  languageFeeStatusLabel(row: BatchStudentPaymentRow): string {
    const key = this.rowLanguageFeeStatus(row);
    return LANGUAGE_FEE_STATUS_LABELS[key] || key;
  }

  languageFeePillClass(row: BatchStudentPaymentRow): string {
    return languageFeeStatusClass(this.rowLanguageFeeStatus(row));
  }

  openStudentDetail(row: BatchStudentPaymentRow): void {
    window.open(`/admin/payment-hub/student/${row.studentId}`, '_blank');
  }
}
