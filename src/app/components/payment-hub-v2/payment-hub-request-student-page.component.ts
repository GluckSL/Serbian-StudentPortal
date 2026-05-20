import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PaymentHubApiService, StudentHistory, PaymentRequestItem, ApprovalQueueItem, InstallmentRow } from './payment-hub-api.service';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyAmountComponent } from './payment-currency-amount.component';
import { ReqForPaymentDialogComponent } from './req-for-payment-dialog.component';
import { InstallmentScheduleEditDialogComponent } from './installment-schedule-edit-dialog.component';
import { buildStudentInstallmentView } from './installment-visibility.util';

@Component({
  selector: 'app-payment-hub-request-student-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSlideToggleModule,
    MatDialogModule,
    MatChipsModule,
    MatTooltipModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyAmountComponent,
  ],
  templateUrl: './payment-hub-request-student-page.component.html',
  styleUrls: ['./payment-hub-request-student-page.component.scss'],
})
export class PaymentHubRequestStudentPageComponent implements OnInit {

  studentId = '';
  loading = true;
  history: StudentHistory | null = null;

  historyPage = 1;
  readonly historyPageSize = 15;
  proofLoadingId: string | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
    private readonly dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.studentId = this.route.snapshot.paramMap.get('studentId') ?? '';
    if (this.studentId) this.loadHistory();
  }

  loadHistory(): void {
    this.loading = true;
    this.api.getStudentHistory(this.studentId, { page: this.historyPage, limit: this.historyPageSize }).subscribe({
      next: (res) => {
        this.history = res.data;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snack.open('Failed to load student history', 'Dismiss', { duration: 4000 });
      },
    });
  }

  prevPage(): void {
    if (this.historyPage > 1) { this.historyPage--; this.loadHistory(); }
  }

  nextPage(): void {
    if (this.history && this.historyPage < this.history.totalPages) { this.historyPage++; this.loadHistory(); }
  }

  openReqDialog(): void {
    const ref = this.dialog.open(ReqForPaymentDialogComponent, {
      width: '520px',
      data: { studentId: this.studentId, studentName: this.history?.student?.name },
    });
    ref.afterClosed().subscribe((sent) => {
      if (sent) this.loadHistory();
    });
  }

  // ── Summary card computations ─────────────────────────────────────────────

  get totalPaid(): number {
    return this.history?.profile?.totalPaid ?? 0;
  }

  get totalPaidCurrency(): string {
    if (!this.history?.profile) return '';
    return '';
  }

  get balanceDue(): number {
    const p = this.history?.profile;
    if (!p) return 0;
    // expectedAmount = remaining on open requests (REQUESTED, SUBMITTED, …); overdue is tracked separately
    return (p.overdueAmount ?? 0) + (p.expectedAmount ?? 0);
  }

  get nextPayment(): { amount: number; currency: string; dueDate: string } | null {
    if (!this.history?.requests?.length) return null;
    const now = new Date();

    // Try installment plans first — use the current unlocked slice
    for (const r of this.history.requests) {
      if (!r.installmentAllowed || r.status === 'FULLY_PAID') continue;
      const view = buildStudentInstallmentView(r.installments, now);
      if (view && !view.allPaid && view.displayDueDate && (view.displayAmount ?? 0) > 0) {
        return { amount: view.displayAmount, currency: r.currency, dueDate: view.displayDueDate };
      }
    }

    // Fall back to non-installment open requests
    const open = this.history.requests.filter(r =>
      !r.installmentAllowed &&
      ['REQUESTED', 'OVERDUE', 'REUPLOAD_REQUIRED'].includes(r.status)
    );
    if (!open.length) return null;
    const earliest = open.reduce((a, b) => new Date(a.dueDate) < new Date(b.dueDate) ? a : b);
    return { amount: earliest.amountRemaining, currency: earliest.currency, dueDate: earliest.dueDate };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  fmt(val: number | undefined | null): string {
    if (val == null) return '0';
    return val.toLocaleString('en-IN');
  }

  fmtDate(d: string | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      REQUESTED: 'pill-blue', SUBMITTED: 'pill-blue', UNDER_REVIEW: 'pill-amber',
      APPROVED: 'pill-green', FULLY_PAID: 'pill-green', REJECTED: 'pill-red',
      OVERDUE: 'pill-red', REUPLOAD_REQUIRED: 'pill-orange',
      PENDING: 'pill-grey',
    };
    return map[status] || 'pill-grey';
  }

  hasSubmissions(req: PaymentRequestItem): boolean {
    return Array.isArray(req.submissions) && req.submissions.length > 0;
  }

  viewSubmissionProof(sub: ApprovalQueueItem): void {
    const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
    if (sub.screenshotViewUrl) {
      open(sub.screenshotViewUrl);
      return;
    }
    this.proofLoadingId = sub._id;
    this.api.getSubmissionDetail(sub._id).subscribe({
      next: (res) => {
        this.proofLoadingId = null;
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
      error: () => {
        this.proofLoadingId = null;
        this.snack.open('Could not load proof link', 'Dismiss', { duration: 4000 });
      },
    });
  }

  noSubmissionsYet(): boolean {
    if (!this.history?.requests?.length) return true;
    return !this.history.requests.some(r => this.hasSubmissions(r));
  }

  get paginationLabel(): string {
    if (!this.history) return '';
    const from = (this.historyPage - 1) * this.historyPageSize + 1;
    const to = Math.min(this.historyPage * this.historyPageSize, this.history.total);
    return `${from}–${to} of ${this.history.total}`;
  }

  hasInstallmentBreakdown(req: PaymentRequestItem): boolean {
    return !!req.installmentAllowed && (req.installments?.length ?? 0) > 0;
  }

  sortedInst(req: PaymentRequestItem): InstallmentRow[] {
    return [...(req.installments || [])].sort((a, b) => a.installmentNumber - b.installmentNumber);
  }

  submissionsForInstallment(req: PaymentRequestItem, inst: InstallmentRow): ApprovalQueueItem[] {
    const subs = (req.submissions as Array<ApprovalQueueItem & { installmentNumber?: number }>) || [];
    return subs.filter((s) => (s.installmentNumber ?? null) === inst.installmentNumber);
  }

  /** No live proofs (anything except REJECTED) — safe to edit schedule */
  canEditInstallments(req: PaymentRequestItem): boolean {
    if (!this.hasInstallmentBreakdown(req)) return false;
    const subs = (req.submissions as ApprovalQueueItem[]) || [];
    return !subs.some((s) => s.status !== 'REJECTED');
  }

  private static readonly PAYMENT_TYPE_LABELS: Record<string, string> = {
    LANGUAGE_FEE:   'Language Course Fee',
    DOCS_PAYMENT:   'Documentation Payment',
    VISA_PAYMENT:   'Visa Payment',
    CUSTOM_PAYMENT: 'Custom Payment',
  };

  formatPaymentType(type: string, customType?: string): string {
    const label = PaymentHubRequestStudentPageComponent.PAYMENT_TYPE_LABELS[type] || type;
    return customType ? `${label} — ${customType}` : label;
  }

  openEditInstallments(req: PaymentRequestItem): void {
    if (!req.installments?.length) return;
    const ref = this.dialog.open(InstallmentScheduleEditDialogComponent, {
      width: '560px',
      maxWidth: '96vw',
      data: {
        requestId: req._id,
        currency: req.currency,
        parentAmount: req.amount,
        installments: this.sortedInst(req),
      },
    });
    ref.afterClosed().subscribe((saved) => {
      if (saved) {
        this.snack.open('Instalment schedule updated.', 'OK', { duration: 4000 });
        this.loadHistory();
      }
    });
  }
}
