import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { PaymentHubApiService, StudentHistory, PaymentRequestItem as PaymentRequest, ApprovalQueueItem } from './payment-hub-api.service';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyPendingTotalsComponent } from './payment-currency-pending-totals.component';
import { PaymentCurrencyOverdueTotalsComponent } from './payment-currency-overdue-totals.component';
import { PaymentCurrencyAmountComponent } from './payment-currency-amount.component';
import {
  LANGUAGE_FEE_STATUS_LABELS,
  LanguageFeeStatus,
  languageFeeStatusClass,
  computeLanguageFeeStatus,
} from './payment-language-fee-status.util';
import { currentJourneyDayFromStudent } from './payment-journey-metrics.util';

@Component({
  selector: 'app-payment-hub-student-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatSnackBarModule,
    MatIconModule,
    MatChipsModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
    PaymentCurrencyOverdueTotalsComponent,
    PaymentCurrencyAmountComponent,
  ],
  templateUrl: './payment-hub-student-detail.component.html',
  styleUrls: ['./payment-hub-student-detail.component.scss'],
})
export class PaymentHubStudentDetailComponent implements OnInit {
  loading = true;
  studentId = '';
  history: StudentHistory | null = null;

  readonly skeletonChips = [0, 1, 2, 3, 4, 5];
  readonly skeletonTableRows = [0, 1, 2, 3, 4];
  readonly skeletonSubBlocks = [0, 1];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.studentId = this.route.snapshot.params['studentId'];
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.getStudentHistory(this.studentId).subscribe({
      next: (res) => {
        this.history = res.data;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snack.open('Could not load student payment history', 'Dismiss', { duration: 4000 });
      },
    });
  }

  viewScreenshot(sub: ApprovalQueueItem): void {
    const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
    if (sub.screenshotViewUrl) {
      open(sub.screenshotViewUrl);
      return;
    }
    this.api.getSubmissionDetail(sub._id).subscribe({
      next: (res) => {
        const url = (res.data as unknown as Record<string, unknown>)?.['screenshotViewUrl'] as string | undefined;
        if (url) open(url);
        else {
          this.snack.open(
            'Proof file not found. It may have been deleted or the stored path no longer matches the file.',
            'Dismiss',
            { duration: 6000 },
          );
        }
      },
      error: () => this.snack.open('Could not load proof link', 'Dismiss', { duration: 4000 }),
    });
  }

  goBack(): void {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/admin/payment-hub';
    }
  }

  fmt(val: number | undefined | null): string {
    if (val === undefined || val === null) return '0';
    return val.toLocaleString('en-IN');
  }

  fmtDate(d: string | undefined | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  fmtDateTime(d: string | undefined | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      REQUESTED: 'pill-grey',
      SUBMITTED: 'pill-blue',
      UNDER_REVIEW: 'pill-amber',
      APPROVED: 'pill-green',
      REJECTED: 'pill-red',
      OVERDUE: 'pill-red',
      FULLY_PAID: 'pill-green',
    };
    return map[status] || 'pill-grey';
  }

  languageFeeStatusKey(): LanguageFeeStatus {
    const fromApi = this.history?.languageFeeStatus || this.history?.profile?.languageFeeStatus;
    if (fromApi === 'FULL_PAID' || fromApi === 'BALANCE' || fromApi === 'DUE') return fromApi;
    const bal = this.history?.languageFeeBalance ?? this.history?.profile?.languageFeeBalance ?? 0;
    const day = currentJourneyDayFromStudent(this.history?.student ?? null);
    return computeLanguageFeeStatus(bal, day);
  }

  languageFeeStatusClass(): string {
    return languageFeeStatusClass(this.languageFeeStatusKey());
  }

  languageFeeStatusLabel(): string {
    return LANGUAGE_FEE_STATUS_LABELS[this.languageFeeStatusKey()];
  }

  requestStatusLabel(status: string): string {
    const map: Record<string, string> = {
      REQUESTED: 'Requested',
      SUBMITTED: 'Submitted',
      UNDER_REVIEW: 'Under review',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
      OVERDUE: 'Overdue',
      FULLY_PAID: 'Fully paid',
    };
    return map[status] || status || '—';
  }

  dateJoined(): string {
    const s = this.history?.student;
    const d = s?.enrollmentDate || s?.createdAt;
    return d ? this.fmtDate(d) : '—';
  }

  get journeyDay(): number | null {
    const d = this.history?.student?.currentCourseDay;
    if (d == null || !Number.isFinite(Number(d))) return null;
    return Math.min(200, Math.max(1, Math.floor(Number(d))));
  }

  get journeyDayLabel(): string {
    const d = this.journeyDay;
    return d != null ? `Day ${d} / 200` : '—';
  }

  get batchLabel(): string {
    const b = (this.history?.student?.batch || '').trim();
    return b || '—';
  }

  get studentStatusLabel(): string {
    const s = (this.history?.student?.studentStatus || '').trim();
    return s || '—';
  }

  balanceDue(req: PaymentRequest): number {
    return Math.max(0, req.amountRemaining ?? 0);
  }

  getSubmissions(req: PaymentRequest): ApprovalQueueItem[] {
    return (req.submissions as ApprovalQueueItem[]) || [];
  }

  hasSubmissions(req: PaymentRequest): boolean {
    return (req.submissions?.length ?? 0) > 0;
  }

  /** Avoid arrow functions in templates (HTML parses `>` as tag end). */
  noSubmissionsYet(): boolean {
    if (!this.history?.requests?.length) return true;
    return !this.history.requests.some((r) => this.hasSubmissions(r));
  }

  private static readonly PAYMENT_TYPE_LABELS: Record<string, string> = {
    LANGUAGE_FEE:   'Language Course Fee',
    DOCS_PAYMENT:   'Documentation Payment',
    VISA_PAYMENT:   'Visa Payment',
    CUSTOM_PAYMENT: 'Custom Payment',
  };

  formatPaymentType(type: string, customType?: string): string {
    const label = PaymentHubStudentDetailComponent.PAYMENT_TYPE_LABELS[type] || type;
    return customType ? `${label} — ${customType}` : label;
  }

  isLegacy(req: PaymentRequest): boolean {
    return !!req.isImported;
  }
}
