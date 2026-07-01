import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { PaymentHubApiService, StudentBrowseRow, ApprovalQueueItem, SignupPendingApplication } from './payment-hub-api.service';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentRequestNavService } from './payment-request-nav.service';
import {
  PaymentApprovalDecisionDialogComponent,
  PaymentApprovalDecisionMode,
} from './payment-approval-decision-dialog.component';

@Component({
  selector: 'app-payment-hub-request-payments',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
    MatDialogModule,
    PaymentCurrencyTotalsComponent,
  ],
  templateUrl: './payment-hub-request-payments.component.html',
  styleUrls: ['./payment-hub-request-payments.component.scss'],
})
export class PaymentHubRequestPaymentsComponent implements OnInit {

  // ── Filter bar ────────────────────────────────────────────────────────────
  filterSearch = '';
  filterBatch = '';
  filterLevel = '';
  filterPlan = '';

  readonly levelOptions = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly planOptions = [
    { value: 'SILVER', label: 'Silver' },
    { value: 'PLATINUM', label: 'Platinum' },
    { value: 'VISA_DOC_ONLY', label: 'Visa Doc Only' },
  ];

  // ── Student browse table ──────────────────────────────────────────────────
  loadingStudents = false;
  studentList: StudentBrowseRow[] = [];
  selectedIds = new Set<string>();
  studentTotal = 0;
  studentPage = 1;
  readonly studentPageSize = 20;

  // ── Payment form ──────────────────────────────────────────────────────────
  sendingRequest = false;
  amount: number | null = null;
  currency = 'LKR';
  /** true when all selected students share the same inferred currency (currency is locked) */
  currencyLocked = false;
  /** shown when selected students have mixed inferred currencies */
  currencyMixedWarning = false;
  paymentType = 'Monthly Fee';
  customType = '';
  dueDate: Date | null = null;
  remarks = '';
  installmentAllowed = false;
  notificationToggle = true;

  readonly currencies = ['LKR', 'INR', 'USD'];
  readonly paymentTypes = ['Monthly Fee', 'Registration', 'Exam Fee', 'Custom', 'Other'];

  // ── Approvals tab ─────────────────────────────────────────────────────────
  loadingApprovals = true;
  approvalRows: ApprovalQueueItem[] = [];
  approvalTotal = 0;
  approvalPage = 1;
  readonly approvalPageSize = 20;
  approvalStatusFilter = 'SUBMITTED,UNDER_REVIEW,APPROVED,REJECTED';
  /** Count of items awaiting decision (badge on tab + sidebar). */
  pendingQueueTotal = 0;
  pendingHubTotal = 0;
  pendingSignupTotal = 0;

  loadingSignups = false;
  signupRows: SignupPendingApplication[] = [];
  signupApproveBatch = '';
  loadingSignupToken: string | null = null;

  activeView: 'send' | 'approvals' = 'send';

  activeActionId: string | null = null;
  rejectReason = '';
  reuploadNote = '';
  adminRemarks = '';
  loadingActionId: string | null = null;

  readonly approvalStatuses = [
    { value: 'SUBMITTED,UNDER_REVIEW,APPROVED,REJECTED', label: 'Recent (pending + history)' },
    { value: 'SUBMITTED,UNDER_REVIEW', label: 'Pending only' },
    { value: 'SUBMITTED', label: 'Submitted' },
    { value: 'UNDER_REVIEW', label: 'Under Review' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: '', label: 'All' },
  ];

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
    private readonly paymentRequestNav: PaymentRequestNavService,
    private readonly dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.applyFilters();
    this.loadApprovals();
    this.loadSignupApprovals();
    this.refreshPendingQueueCount();
  }

  setActiveView(view: 'send' | 'approvals'): void {
    this.activeView = view;
    if (view === 'approvals') {
      if (this.approvalStatusFilter !== 'SUBMITTED,UNDER_REVIEW') {
        this.approvalStatusFilter = 'SUBMITTED,UNDER_REVIEW';
        this.approvalPage = 1;
        this.loadApprovals();
      }
      this.loadSignupApprovals();
    }
  }

  // ── Filter / Browse methods ───────────────────────────────────────────────

  applyFilters(): void {
    this.studentPage = 1;
    this.loadStudents();
  }

  resetFilters(): void {
    this.filterSearch = '';
    this.filterBatch = '';
    this.filterLevel = '';
    this.filterPlan = '';
    this.selectedIds.clear();
    this.studentPage = 1;
    this.loadStudents();
  }

  loadStudents(): void {
    this.loadingStudents = true;
    const params: Record<string, string | number | boolean | undefined | null> = {
      page: this.studentPage,
      limit: this.studentPageSize,
    };
    if (this.filterSearch.trim()) params['search'] = this.filterSearch.trim();
    if (this.filterBatch.trim()) params['batch'] = this.filterBatch.trim();
    if (this.filterLevel) params['level'] = this.filterLevel;
    if (this.filterPlan) params['plan'] = this.filterPlan;

    this.api.browseStudentsForRequest(params).subscribe({
      next: (res) => {
        this.studentList = res.data || [];
        this.studentTotal = res.total || 0;
        this.loadingStudents = false;
      },
      error: () => {
        this.loadingStudents = false;
        this.snack.open('Failed to load students', 'Dismiss', { duration: 4000 });
      },
    });
  }

  prevStudentPage(): void {
    if (this.studentPage > 1) { this.studentPage--; this.loadStudents(); }
  }

  nextStudentPage(): void {
    if (this.studentPage * this.studentPageSize < this.studentTotal) { this.studentPage++; this.loadStudents(); }
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  toggleStudent(row: StudentBrowseRow): void {
    if (this.selectedIds.has(row._id)) this.selectedIds.delete(row._id);
    else this.selectedIds.add(row._id);
    this.updateCurrencyFromSelection();
  }

  /** Derives the appropriate currency from the current selection and locks/unlocks the field. */
  private updateCurrencyFromSelection(): void {
    const selected = this.studentList.filter(r => this.selectedIds.has(r._id));
    if (!selected.length) {
      this.currencyLocked = false;
      this.currencyMixedWarning = false;
      return;
    }
    const currencies = [...new Set(selected.map(r => r.inferredCurrency || 'LKR'))];
    if (currencies.length === 1) {
      this.currency = currencies[0];
      this.currencyLocked = true;
      this.currencyMixedWarning = false;
    } else {
      // Mixed countries — unlock so admin can pick, but warn
      this.currencyLocked = false;
      this.currencyMixedWarning = true;
    }
  }

  isSelected(row: StudentBrowseRow): boolean {
    return this.selectedIds.has(row._id);
  }

  selectAll(): void {
    this.studentList.forEach(r => this.selectedIds.add(r._id));
    this.updateCurrencyFromSelection();
  }

  deselectAll(): void {
    this.selectedIds.clear();
    this.updateCurrencyFromSelection();
  }

  get allPageSelected(): boolean {
    return this.studentList.length > 0 && this.studentList.every(r => this.selectedIds.has(r._id));
  }

  toggleSelectAll(): void {
    if (this.allPageSelected) this.deselectAll();
    else this.selectAll();
  }

  // ── View More ─────────────────────────────────────────────────────────────

  viewMore(row: StudentBrowseRow): void {
    window.open(`/admin/payment-request/student/${row._id}`, '_blank');
  }

  // ── Send Request ──────────────────────────────────────────────────────────

  sendRequest(): void {
    if (this.selectedIds.size === 0) {
      this.snack.open('Select at least one student', 'OK', { duration: 3000 });
      return;
    }
    if (!this.amount || this.amount <= 0) {
      this.snack.open('Enter a valid amount', 'OK', { duration: 3000 });
      return;
    }
    if (!this.dueDate) {
      this.snack.open('Select a due date', 'OK', { duration: 3000 });
      return;
    }
    if (this.paymentType === 'Custom' && !this.customType.trim()) {
      this.snack.open('Enter a custom payment type label', 'OK', { duration: 3000 });
      return;
    }

    this.sendingRequest = true;
    this.api.createBulkRequest({
      studentIds: Array.from(this.selectedIds),
      amount: this.amount,
      currency: this.currency,
      paymentType: this.paymentType,
      customType: this.paymentType === 'Custom' ? this.customType : undefined,
      dueDate: this.dueDate.toISOString(),
      remarks: this.remarks || undefined,
      installmentAllowed: this.installmentAllowed,
      notificationToggle: this.notificationToggle,
    }).subscribe({
      next: (res) => {
        this.sendingRequest = false;
        this.snack.open(`Request sent to ${res.count} student(s).`, 'OK', { duration: 4000 });
        this.resetPaymentForm();
      },
      error: (e) => {
        this.sendingRequest = false;
        this.snack.open(e?.error?.message || 'Failed to send request', 'Dismiss', { duration: 5000 });
      },
    });
  }

  private resetPaymentForm(): void {
    this.selectedIds.clear();
    this.amount = null;
    this.currency = 'LKR';
    this.currencyLocked = false;
    this.currencyMixedWarning = false;
    this.paymentType = 'Monthly Fee';
    this.customType = '';
    this.dueDate = null;
    this.remarks = '';
    this.installmentAllowed = false;
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  loadApprovals(): void {
    this.loadingApprovals = true;
    const params: Record<string, string | number | boolean> = {
      page: this.approvalPage,
      limit: this.approvalPageSize,
      sort: '-submittedAt',
    };
    if (this.approvalStatusFilter) params['status'] = this.approvalStatusFilter;

    this.api.getApprovalQueue(params).subscribe({
      next: (res) => {
        this.approvalRows = res.data || [];
        this.approvalTotal = res.total || 0;
        this.loadingApprovals = false;
        if (this.approvalStatusFilter === 'SUBMITTED,UNDER_REVIEW') {
          this.pendingHubTotal = this.approvalTotal;
          this.pendingQueueTotal = this.pendingHubTotal + this.pendingSignupTotal;
        }
      },
      error: () => {
        this.loadingApprovals = false;
        this.snack.open('Could not load approval queue', 'Dismiss', { duration: 4000 });
      },
    });
  }

  loadSignupApprovals(): void {
    this.loadingSignups = true;
    this.api.getPendingSignupApplications().subscribe({
      next: (res) => {
        this.signupRows = res.data || [];
        this.pendingSignupTotal = res.total || this.signupRows.length;
        this.pendingQueueTotal = this.pendingHubTotal + this.pendingSignupTotal;
        this.paymentRequestNav.setPendingCount(this.pendingQueueTotal);
        this.loadingSignups = false;
      },
      error: () => {
        this.loadingSignups = false;
        this.snack.open('Could not load new signup applications', 'Dismiss', { duration: 4000 });
      },
    });
  }

  refreshPendingQueueCount(): void {
    forkJoin({
      hub: this.api.getApprovalQueue({ page: 1, limit: 1, status: 'SUBMITTED,UNDER_REVIEW' }),
      signups: this.api.getPendingSignupApplications(),
    }).subscribe({
      next: ({ hub, signups }) => {
        this.pendingHubTotal = hub.total || 0;
        this.pendingSignupTotal = signups.total || signups.data?.length || 0;
        this.pendingQueueTotal = this.pendingHubTotal + this.pendingSignupTotal;
        this.paymentRequestNav.setPendingCount(this.pendingQueueTotal);
      },
      error: () => { /* ignore */ },
    });
  }

  setApprovalFilter(value: string): void {
    if (this.approvalStatusFilter === value) return;
    this.approvalStatusFilter = value;
    this.onStatusFilterChange();
  }

  onStatusFilterChange(): void {
    this.approvalPage = 1;
    this.activeActionId = null;
    this.loadApprovals();
    if (this.approvalStatusFilter === 'SUBMITTED,UNDER_REVIEW') {
      this.refreshPendingQueueCount();
    }
  }
  prevApproval(): void { if (this.approvalPage > 1) { this.approvalPage--; this.loadApprovals(); } }
  nextApproval(): void { if (this.approvalPage * this.approvalPageSize < this.approvalTotal) { this.approvalPage++; this.loadApprovals(); } }

  toggleActionPanel(id: string): void {
    this.activeActionId = this.activeActionId === id ? null : id;
    this.rejectReason = '';
    this.reuploadNote = '';
    this.adminRemarks = '';
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
            'Proof file not found. If the student just uploaded, confirm the file exists under server uploads or S3.',
            'Dismiss',
            { duration: 7000 },
          );
        }
      },
      error: () => this.snack.open('Could not load proof link', 'Dismiss', { duration: 4000 }),
    });
  }

  quickApprove(sub: ApprovalQueueItem, ev: Event): void {
    ev.stopPropagation();
    this.openApprovalDecision(sub, 'approve');
  }

  quickReject(sub: ApprovalQueueItem, ev: Event): void {
    ev.stopPropagation();
    this.openApprovalDecision(sub, 'reject');
  }

  openApprovalDecision(sub: ApprovalQueueItem, mode: PaymentApprovalDecisionMode, ev?: Event): void {
    ev?.stopPropagation();
    if (!this.isPendingStatus(sub.status) || this.loadingActionId) return;

    const openDialog = (item: ApprovalQueueItem) => {
      const ref = this.dialog.open(PaymentApprovalDecisionDialogComponent, {
        width: '580px',
        maxWidth: '96vw',
        panelClass: 'lm-dialog-panel',
        autoFocus: false,
        data: {
          mode,
          submission: item,
          paymentDateLabel: this.formatPaymentDateTime(item),
          adminRemarks: this.adminRemarks,
        },
      });

      ref.afterClosed().subscribe((result) => {
        if (!result) return;
        if (result.action === 'approve') {
          this.approve(item, result.paidAmount, result.adminRemarks, result.reviewUpdates);
        } else {
          this.reject(item, result.rejectionReason, result.reviewUpdates);
        }
      });
    };

    const student = sub.studentId;
    const hasStudent =
      student &&
      typeof student === 'object' &&
      Boolean((student.name || '').trim() || (student.email || '').trim());
    const hasAmount = Number(sub.paidAmount) > 0;

    if (hasStudent && hasAmount) {
      openDialog(sub);
      return;
    }

    this.api.getSubmissionDetail(sub._id).subscribe({
      next: (res) => openDialog(res.data || sub),
      error: () => openDialog(sub),
    });
  }

  approve(
    sub: ApprovalQueueItem,
    paidAmount?: number,
    adminRemarks?: string,
    reviewUpdates?: Record<string, unknown>,
  ): void {
    this.loadingActionId = sub._id;
    const body: { adminRemarks?: string; paidAmount?: number; reviewUpdates?: Record<string, unknown> } = {
      adminRemarks: (adminRemarks ?? this.adminRemarks) || undefined,
    };
    if (paidAmount != null) {
      body.paidAmount = paidAmount;
    }
    if (reviewUpdates) {
      body.reviewUpdates = reviewUpdates;
    }
    this.api.approveSubmission(sub._id, body).subscribe({
      next: (res) => {
        this.loadingActionId = null;
        const msg = res.receiptNumber ? ` Receipt: ${res.receiptNumber}` : '';
        this.snack.open('Approved. Confirmation email sent to the student.' + msg + (res.isFullyPaid ? ' Fully paid!' : ''), 'OK', { duration: 5000 });
        this.activeActionId = null;
        this.loadApprovals();
        this.loadSignupApprovals();
        this.refreshPendingQueueCount();
      },
      error: (e) => {
        this.loadingActionId = null;
        this.snack.open(e?.error?.message || 'Approve failed', 'Dismiss', { duration: 5000 });
      },
    });
  }

  reject(sub: ApprovalQueueItem, reason?: string, reviewUpdates?: Record<string, unknown>): void {
    const rejectionReason = (reason ?? this.rejectReason).trim();
    if (!rejectionReason) { this.snack.open('Enter a rejection reason', 'OK', { duration: 3000 }); return; }
    this.loadingActionId = sub._id;
    const body: { rejectionReason: string; reviewUpdates?: Record<string, unknown> } = { rejectionReason };
    if (reviewUpdates) {
      body.reviewUpdates = reviewUpdates;
    }
    this.api.rejectSubmission(sub._id, body).subscribe({
      next: () => {
        this.loadingActionId = null;
        this.snack.open('Rejected. The student has been emailed with your reason.', 'OK', { duration: 5000 });
        this.activeActionId = null;
        this.rejectReason = '';
        this.loadApprovals();
        this.loadSignupApprovals();
        this.refreshPendingQueueCount();
      },
      error: (e) => {
        this.loadingActionId = null;
        this.snack.open(e?.error?.message || 'Reject failed', 'Dismiss', { duration: 5000 });
      },
    });
  }

  reupload(sub: ApprovalQueueItem): void {
    this.loadingActionId = sub._id;
    this.api.requestReupload(sub._id, { reuploadNote: this.reuploadNote || 'Please upload a clearer screenshot.' }).subscribe({
      next: () => {
        this.loadingActionId = null;
        this.snack.open('Reupload requested.', 'OK', { duration: 3000 });
        this.activeActionId = null;
        this.reuploadNote = '';
        this.loadApprovals();
        this.loadSignupApprovals();
        this.refreshPendingQueueCount();
      },
      error: (e) => {
        this.loadingActionId = null;
        this.snack.open(e?.error?.message || 'Request failed', 'Dismiss', { duration: 5000 });
      },
    });
  }

  isPendingStatus(status: string): boolean {
    return status === 'SUBMITTED' || status === 'UNDER_REVIEW';
  }

  formatPaymentDateTime(sub: ApprovalQueueItem): string {
    const raw = sub.paymentDateTime || sub.submittedAt;
    if (!raw) return '—';
    return new Date(raw).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  formatSignupSubmittedAt(row: SignupPendingApplication): string {
    const raw = row.proofSubmittedAt || row.createdAt;
    if (!raw) return '—';
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  formatSignupPaymentDate(row: SignupPendingApplication): string {
    if (!row.proofPaymentDateTime) return '—';
    const d = new Date(row.proofPaymentDateTime);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  signupDeclaredAmount(row: SignupPendingApplication): number {
    return row.proofPaidAmount ?? row.amount ?? 0;
  }

  viewSignupProof(row: SignupPendingApplication): void {
    if (!row.proofViewUrl) {
      this.snack.open('Proof file not available.', 'Dismiss', { duration: 4000 });
      return;
    }
    window.open(row.proofViewUrl, '_blank', 'noopener,noreferrer');
  }

  approveSignup(row: SignupPendingApplication, ev?: Event): void {
    ev?.stopPropagation();
    if (this.loadingSignupToken) return;
    this.loadingSignupToken = row.applicationToken;
    const body = this.signupApproveBatch.trim() ? { batch: this.signupApproveBatch.trim() } : undefined;
    this.api.approveSignupApplication(row.applicationToken, body).subscribe({
      next: (res) => {
        this.loadingSignupToken = null;
        const reg = res.regNo ? ` Web App ID: ${res.regNo}.` : '';
        this.snack.open((res.message || 'Signup approved.') + reg, 'OK', { duration: 6000 });
        this.loadSignupApprovals();
        this.refreshPendingQueueCount();
      },
      error: (e) => {
        this.loadingSignupToken = null;
        this.snack.open(e?.error?.message || 'Could not approve signup', 'Dismiss', { duration: 5000 });
      },
    });
  }

  refreshApprovalsTab(): void {
    this.loadApprovals();
    this.loadSignupApprovals();
    this.refreshPendingQueueCount();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  initialLetter(name: string | undefined): string {
    const s = (name || '').trim();
    return s.length ? s.charAt(0).toUpperCase() : '?';
  }

  planLabel(val: string | undefined): string {
    return this.planOptions.find(p => p.value === val)?.label || val || '—';
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      SUBMITTED: 'pill-blue', UNDER_REVIEW: 'pill-amber', APPROVED: 'pill-green',
      REJECTED: 'pill-red', REUPLOAD_REQUIRED: 'pill-orange',
    };
    return map[status] || 'pill-grey';
  }

  overallStatusClass(s: string): string {
    const map: Record<string, string> = {
      CLEAR: 'pill-green', NO_REQUESTS: 'pill-grey', REQUESTED: 'pill-blue',
      PENDING_REVIEW: 'pill-amber', OVERDUE: 'pill-red',
    };
    return map[s] || 'pill-grey';
  }

  fmt(val: number | undefined | null): string {
    if (val === undefined || val === null) return '0';
    return val.toLocaleString('en-IN');
  }

  get studentPaginationLabel(): string {
    const from = (this.studentPage - 1) * this.studentPageSize + 1;
    const to = Math.min(this.studentPage * this.studentPageSize, this.studentTotal);
    return `${from}–${to} of ${this.studentTotal}`;
  }

  get approvalPaginationLabel(): string {
    const from = (this.approvalPage - 1) * this.approvalPageSize + 1;
    const to = Math.min(this.approvalPage * this.approvalPageSize, this.approvalTotal);
    return `${from}–${to} of ${this.approvalTotal}`;
  }

  // ── Approval card context (readable payment + instalment summary) ─────────

  requestTypeLine(sub: ApprovalQueueItem): string {
    const pr = sub.paymentRequestId;
    if (!pr) return 'Payment';
    if (pr.paymentType === 'Custom' && pr.customType?.trim()) {
      return `${pr.paymentType} — ${pr.customType.trim()}`;
    }
    return pr.paymentType;
  }

  /** Parent request is split into multiple scheduled parts */
  isInstallmentRequest(sub: ApprovalQueueItem): boolean {
    const pr = sub.paymentRequestId;
    return Boolean(pr?.installmentAllowed && (pr.totalInstallments ?? 0) > 1);
  }

  /** Chip text for header / summary */
  installmentBadge(sub: ApprovalQueueItem): string | null {
    if (!this.isInstallmentRequest(sub)) return null;
    const total = sub.paymentRequestId?.totalInstallments ?? '?';
    if (sub.installmentNumber != null) return `Instalment ${sub.installmentNumber} of ${total}`;
    return `${total} instalments`;
  }

  openStudentPaymentPage(sub: ApprovalQueueItem, ev?: Event): void {
    ev?.stopPropagation();
    const id = sub.studentId?._id;
    if (!id) return;
    window.open(`/admin/payment-request/student/${id}`, '_blank', 'noopener,noreferrer');
  }

  currencyLabel(currency: string | null | undefined): string {
    return String(currency || '').toUpperCase() === 'USD' ? 'EURO' : String(currency || '');
  }
}
