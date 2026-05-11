import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PaymentHubApiService, PaymentRequestItem as PaymentRequest, StudentCatalog, CefrRow, InstallmentRow } from './payment-hub-api.service';
import { PaymentUploadDialogComponent } from './payment-upload-dialog.component';
@Component({
  selector: 'app-payment-hub-student-portal',
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
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './payment-hub-student-portal.component.html',
  styleUrls: ['./payment-hub-student-portal.component.scss'],
})
export class PaymentHubStudentPortalComponent implements OnInit {
  loading = true;
  requests: PaymentRequest[] = [];
  total = 0;
  page = 1;
  readonly pageSize = 20;

  catalog: StudentCatalog | null = null;
  loadingCatalog = true;
  /** Currency inferred from the student's phone (INR / LKR / USD) — drives which amounts to show */
  inferredCurrency = 'LKR';

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
    private readonly dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.load();
    this.loadCatalog();
  }

  loadCatalog(): void {
    this.api.getMyCatalog().subscribe({
      next: (res) => {
        this.catalog = res.data;
        this.inferredCurrency = res.data.inferredCurrency || 'LKR';
        this.loadingCatalog = false;
      },
      error: () => {
        this.loadingCatalog = false;
      },
    });
  }

  get catalogCefrRows(): CefrRow[] {
    return this.catalog?.cefrRows ?? [];
  }

  /** Student has at least one non–fully-paid payment request on an installment plan */
  get hasActiveInstallmentPlan(): boolean {
    return this.requests.some(
      r =>
        r.installmentAllowed &&
        r.status !== 'FULLY_PAID' &&
        r.studentInstallmentView?.allPaid !== true,
    );
  }

  /** Fifth summary card: catalog level fee minus approved payments */
  get showInstallmentBalanceCard(): boolean {
    return (
      !this.loadingCatalog &&
      !!this.catalog?.studentLevel &&
      this.hasActiveInstallmentPlan &&
      this.catalogCefrRows.length > 0
    );
  }

  private approvedPaidSum(currency: string): number {
    return this.paidPerCurrency.find(p => p.currency === currency)?.amount ?? 0;
  }

  approvedPaidLkr(): number {
    return this.approvedPaidSum('LKR');
  }

  approvedPaidInr(): number {
    return this.approvedPaidSum('INR');
  }

  balanceLkr(): number {
    return Math.max(0, this.cefrTotalLkr() - this.approvedPaidLkr());
  }

  balanceInr(): number {
    return Math.max(0, this.cefrTotalInr() - this.approvedPaidInr());
  }

  cefrTotalLkr(): number {
    return this.catalogCefrRows.reduce((sum, r) => sum + (r.lkr || 0), 0);
  }

  cefrTotalInr(): number {
    return this.catalogCefrRows.reduce((sum, r) => sum + (r.inr || 0), 0);
  }

  /** The single catalog amount relevant to this student's currency */
  get catalogFeeDisplay(): { currency: string; amount: number } | null {
    if (!this.catalogCefrRows.length) return null;
    if (this.inferredCurrency === 'INR') return { currency: 'INR', amount: this.cefrTotalInr() };
    if (this.inferredCurrency === 'LKR') return { currency: 'LKR', amount: this.cefrTotalLkr() };
    // USD: fall back to LKR as the base (USD pricing not in catalog yet)
    return { currency: 'LKR', amount: this.cefrTotalLkr() };
  }

  /** Paid amounts filtered to only the student's currency */
  get paidFiltered(): { currency: string; amount: number }[] {
    return this.paidPerCurrency.filter(p => p.currency === this.inferredCurrency);
  }

  /** Balance (catalog - approved) for the inferred currency only */
  get catalogBalanceDisplay(): { currency: string; amount: number } | null {
    const fee = this.catalogFeeDisplay;
    if (!fee) return null;
    const paid = this.paidFiltered.find(p => p.currency === fee.currency)?.amount ?? 0;
    return { currency: fee.currency, amount: Math.max(0, fee.amount - paid) };
  }

  /**
   * Open upload for a payment request that matches the student's current CEFR level
   * (custom type equals level, contains level, or remarks reference the level).
   */
  levelPaymentRequest(): PaymentRequest | null {
    const level = (this.catalog?.studentLevel || '').trim().toUpperCase();
    if (!level) return null;
    for (const req of this.requests) {
      if (!this.canUpload(req)) continue;
      const ct = (req.customType || '').trim().toUpperCase();
      if (ct === level) return req;
      if (level.length >= 2 && ct.includes(level)) return req;
      const rem = (req.remarks || '').toUpperCase();
      if (rem.includes(level) && /\b(LEVEL|PROGRAM|CEFR|TUITION)\b/.test(rem)) return req;
    }
    return null;
  }

  openLevelFeeUpload(): void {
    const req = this.levelPaymentRequest();
    if (!req) {
      this.snack.open(
        'No open payment request is linked to your level yet. When your coordinator sends a request, set its custom label or notes to include your level (e.g. A1), or use Upload on that request below.',
        'Dismiss',
        { duration: 8000 },
      );
      return;
    }
    this.openUpload(req);
  }

  load(): void {
    this.loading = true;
    this.api.getMyRequests({ page: this.page, limit: this.pageSize }).subscribe({
      next: (res) => {
        this.requests = res.data || [];
        this.total = res.total || 0;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snack.open('Could not load your payments', 'Dismiss', { duration: 4000 });
      },
    });
  }

  get reuploadRequests(): PaymentRequest[] {
    return this.requests.filter(r => {
      const subs = (r.submissions as Array<{ status: string; reuploadNote?: string }>) || [];
      return subs.some(s => s.status === 'REUPLOAD_REQUIRED');
    });
  }

  /** Amounts already applied to the request (approved + partials still in REQUESTED), by currency */
  get paidPerCurrency(): { currency: string; amount: number }[] {
    const map = new Map<string, number>();
    for (const r of this.requests) {
      const paid = (r.amount ?? 0) - (r.amountRemaining ?? 0);
      if (paid <= 0) continue;
      const c = r.currency || 'LKR';
      map.set(c, (map.get(c) || 0) + paid);
    }
    return Array.from(map.entries()).map(([currency, amount]) => ({ currency, amount }));
  }

  /** Earliest open request with an amount still to pay */
  get nextPaymentBlock(): { dueDate: string; currency: string; amount: number; title: string } | null {
    // Prefer the current unlocked installment slice when the request is an installment plan
    for (const r of this.requests) {
      if (r.status === 'FULLY_PAID') continue;
      if (r.installmentAllowed && r.studentInstallmentView) {
        const view = r.studentInstallmentView;
        if (view.allPaid || !view.displayDueDate) continue;
        const amt = view.displayAmount ?? 0;
        if (amt <= 0) continue;
        const title = `${r.paymentType}${r.customType ? ' — ' + r.customType : ''} (${view.activeInstallmentNumber}/${view.totalInstallments})`;
        return { dueDate: view.displayDueDate, currency: r.currency || 'LKR', amount: amt, title };
      }
    }
    // Fall back to existing logic for non-installment requests
    const candidates = this.requests.filter(
      r => !r.installmentAllowed && r.amountRemaining != null && r.amountRemaining > 0 && r.status !== 'FULLY_PAID',
    );
    if (!candidates.length) return null;
    const pick = candidates.reduce((a, b) =>
      new Date(a.dueDate).getTime() <= new Date(b.dueDate).getTime() ? a : b,
    );
    const title = `${pick.paymentType}${pick.customType ? ' — ' + pick.customType : ''}`;
    return {
      dueDate: pick.dueDate,
      currency: pick.currency || 'LKR',
      amount: pick.amountRemaining ?? 0,
      title,
    };
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  /** Human-readable due date hint vs today */
  dueHint(req: PaymentRequest): string {
    if (!req.dueDate || req.status === 'APPROVED' || req.status === 'FULLY_PAID') return '';
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const due = new Date(req.dueDate);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due.getTime() - start.getTime()) / 86400000);
    if (diffDays < 0) return `${Math.abs(diffDays)} day(s) overdue`;
    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Due tomorrow';
    return `Due in ${diffDays} days`;
  }

  openUpload(
    req: PaymentRequest,
    overrides?: { installmentNumber?: number; suggestedAmount?: number; suggestedDueDate?: string },
  ): void {
    const v = req.studentInstallmentView;
    const installmentNumber =
      overrides?.installmentNumber ??
      (req.installmentAllowed && v?.canUpload ? (v.activeInstallmentNumber ?? undefined) : undefined);
    const suggestedAmount =
      overrides?.suggestedAmount ??
      (req.installmentAllowed && v && !v.allPaid ? v.displayAmount : undefined);
    const suggestedDueDate =
      overrides?.suggestedDueDate ??
      (req.installmentAllowed && v && !v.allPaid ? (v.displayDueDate ?? undefined) : undefined);

    const ref = this.dialog.open(PaymentUploadDialogComponent, {
      width: '480px',
      maxWidth: '96vw',
      data: { request: req, installmentNumber, suggestedAmount, suggestedDueDate },
      disableClose: false,
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });

    ref.afterClosed().subscribe((formData: FormData | null) => {
      if (!formData) return;
      this.api.submitPaymentFormData(formData).subscribe({
        next: () => {
          this.snack.open('Uploaded successfully! Admin will review shortly.', 'OK', { duration: 5000 });
          this.load();
        },
        error: (e) => {
          this.snack.open(e?.error?.message || 'Upload failed. Please try again.', 'Dismiss', { duration: 5000 });
        },
      });
    });
  }

  /** Returns a hint string like "Installment 2 of 3" when applicable */
  installmentHint(req: PaymentRequest): string {
    if (!req.installmentAllowed || !req.studentInstallmentView) return '';
    const view = req.studentInstallmentView;
    if (view.allPaid) return `${view.totalInstallments}/${view.totalInstallments} paid`;
    if (view.activeInstallmentNumber == null) return '';
    if (view.scheduleLocked) {
      return `Part ${view.activeInstallmentNumber} of ${view.totalInstallments} — upload opens ${this.fmtDate(view.displayDueDate)}`;
    }
    return `Part ${view.activeInstallmentNumber} of ${view.totalInstallments}`;
  }

  /** When we show per-installment rows, never collapse the card into the old "hidden" placeholder */
  isInstallmentHidden(req: PaymentRequest): boolean {
    if (req.installmentAllowed && (req.installments?.length ?? 0) > 0) return false;
    if (!req.installmentAllowed || !req.studentInstallmentView) return false;
    const view = req.studentInstallmentView;
    return !view.allPaid && view.activeInstallmentNumber == null;
  }

  sortedInstallments(req: PaymentRequest): InstallmentRow[] {
    return [...(req.installments || [])].sort((a, b) => a.installmentNumber - b.installmentNumber);
  }

  /** Upload allowed only for the current server-marked payable slice */
  canUploadInstallmentRow(req: PaymentRequest, inst: InstallmentRow): boolean {
    const v = req.studentInstallmentView;
    if (!v || v.allPaid || !v.canUpload) return false;
    return v.activeInstallmentNumber === inst.installmentNumber;
  }

  isActiveInstallmentRow(req: PaymentRequest, inst: InstallmentRow): boolean {
    const n = req.studentInstallmentView?.activeInstallmentNumber;
    return n != null && n === inst.installmentNumber;
  }

  openUploadForInstallment(req: PaymentRequest, inst: InstallmentRow): void {
    this.openUpload(req, {
      installmentNumber: inst.installmentNumber,
      suggestedAmount: inst.remainingAmount ?? inst.requestedAmount,
      suggestedDueDate: inst.dueDate,
    });
  }

  installmentStatusClass(status: string): string {
    const map: Record<string, string> = {
      APPROVED: 'pill-green',
      PENDING: 'pill-grey',
      SUBMITTED: 'pill-blue',
      OVERDUE: 'pill-red',
      REJECTED: 'pill-red',
    };
    return map[status] || 'pill-grey';
  }

  /** Tile background: paid (green), overdue (red), otherwise upcoming (yellow) */
  installmentTileClasses(req: PaymentRequest, inst: InstallmentRow): string[] {
    const classes: string[] = [];
    if (this.isInstallmentPartPaid(inst)) classes.push('sp-inst-tile--paid');
    else if (this.isInstallmentPartOverdue(inst)) classes.push('sp-inst-tile--overdue');
    else classes.push('sp-inst-tile--upcoming');
    if (this.isActiveInstallmentRow(req, inst)) classes.push('sp-inst-tile--active');
    return classes;
  }

  isInstallmentPartPaid(inst: InstallmentRow): boolean {
    if (inst.status === 'APPROVED') return true;
    const rem = inst.remainingAmount ?? 0;
    const paid = inst.paidAmount ?? 0;
    return rem <= 0 && paid > 0;
  }

  /** Calendar due date before today, slice not fully settled */
  isInstallmentPartOverdue(inst: InstallmentRow): boolean {
    if (this.isInstallmentPartPaid(inst)) return false;
    if (inst.status === 'OVERDUE') return true;
    if (!inst.dueDate) return false;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const due = new Date(inst.dueDate);
    due.setHours(0, 0, 0, 0);
    return due.getTime() < start.getTime();
  }

  dueHintInstallment(dueDate: string | undefined | null): string {
    if (!dueDate) return '';
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due.getTime() - start.getTime()) / 86400000);
    if (diffDays < 0) return `${Math.abs(diffDays)} day(s) overdue`;
    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Due tomorrow';
    return `Due in ${diffDays} days`;
  }

  getReuploadNote(req: PaymentRequest): string {
    const subs = (req.submissions as Array<{ status: string; reuploadNote?: string }>) || [];
    const sub = subs.find(s => s.status === 'REUPLOAD_REQUIRED');
    return sub?.reuploadNote || 'Please upload a clearer screenshot.';
  }

  prevPage(): void {
    if (this.page > 1) { this.page--; this.load(); }
  }

  nextPage(): void {
    if (this.page * this.pageSize < this.total) { this.page++; this.load(); }
  }

  actionLabel(req: PaymentRequest): string {
    const map: Record<string, string> = {
      REQUESTED: 'Upload Screenshot',
      REJECTED: 'Re-upload',
      OVERDUE: 'Upload Now',
    };
    const subs = (req.submissions as Array<{ status: string }>) || [];
    if (subs.some(s => s.status === 'REUPLOAD_REQUIRED')) return 'Re-upload';
    return map[req.status] || '';
  }

  canUpload(req: PaymentRequest): boolean {
    // Installment plan: only allow upload if the current slice is actionable
    if (req.installmentAllowed) {
      const view = req.studentInstallmentView;
      return !!view && !view.allPaid && view.canUpload;
    }
    const subs = (req.submissions as Array<{ status: string }>) || [];
    if (subs.some(s => s.status === 'REUPLOAD_REQUIRED')) return true;
    return ['REQUESTED', 'REJECTED', 'OVERDUE'].includes(req.status);
  }

  isUrgent(req: PaymentRequest): boolean {
    return req.status === 'OVERDUE';
  }

  statusClass(req: PaymentRequest): string {
    const subs = (req.submissions as Array<{ status: string }>) || [];
    if (subs.some(s => s.status === 'REUPLOAD_REQUIRED')) return 'pill-orange';
    const map: Record<string, string> = {
      REQUESTED: 'pill-grey',
      SUBMITTED: 'pill-blue',
      UNDER_REVIEW: 'pill-amber',
      APPROVED: 'pill-green',
      FULLY_PAID: 'pill-green',
      REJECTED: 'pill-red',
      OVERDUE: 'pill-red',
    };
    return map[req.status] || 'pill-grey';
  }

  displayStatus(req: PaymentRequest): string {
    const subs = (req.submissions as Array<{ status: string }>) || [];
    if (subs.some(s => s.status === 'REUPLOAD_REQUIRED')) return 'REUPLOAD REQUIRED';
    return req.status;
  }

  fmt(val: number | undefined | null): string {
    if (val === undefined || val === null) return '0';
    return val.toLocaleString('en-IN');
  }

  fmtDate(d: string | undefined | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  isPastDue(req: PaymentRequest): boolean {
    if (!req.dueDate) return false;
    return new Date(req.dueDate) < new Date();
  }
}
