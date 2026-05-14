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
import jsPDF from 'jspdf';
import { PaymentHubApiService, PaymentRequestItem as PaymentRequest, StudentCatalog, CefrRow, InstallmentRow, ApprovalQueueItem } from './payment-hub-api.service';
import { PaymentUploadDialogComponent } from './payment-upload-dialog.component';
import { AuthService } from '../../services/auth.service';
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
  /** From catalog API (phone prefix). May disagree with payment-request currency — see reconcileInferredCurrency. */
  private phoneInferredCurrency = 'LKR';
  /** Effective currency for catalog + summary cards (requests win when all share one currency). */
  inferredCurrency = 'LKR';

  userProfile: any = null;
  expandedInstallments = new Set<string>();

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
    private readonly dialog: MatDialog,
    private readonly auth: AuthService,
  ) {}

  ngOnInit(): void {
    this.loadUserProfile();
    this.load();
    this.loadCatalog();
  }

  loadUserProfile(): void {
    this.auth.getUserProfile().subscribe({
      next: (res) => {
        this.userProfile = res;
      },
      error: () => {
        this.userProfile = null;
      },
    });
  }

  loadCatalog(): void {
    this.api.getMyCatalog().subscribe({
      next: (res) => {
        this.catalog = res.data;
        this.phoneInferredCurrency = this.normalizeCurrency(res.data.inferredCurrency);
        this.reconcileInferredCurrency();
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

  getActiveInstallmentCount(): number {
    return this.requests.filter(r => r.installmentAllowed).length;
  }

  toggleInstallments(reqId: string): void {
    if (this.expandedInstallments.has(reqId)) {
      this.expandedInstallments.delete(reqId);
    } else {
      this.expandedInstallments.add(reqId);
    }
  }

  isInstallmentExpanded(reqId: string): boolean {
    return this.expandedInstallments.has(reqId);
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
    if (this.normalizeCurrency(this.inferredCurrency) === 'INR') return { currency: 'INR', amount: this.cefrTotalInr() };
    if (this.normalizeCurrency(this.inferredCurrency) === 'LKR') return { currency: 'LKR', amount: this.cefrTotalLkr() };
    // USD: fall back to LKR as the base (USD pricing not in catalog yet)
    return { currency: 'LKR', amount: this.cefrTotalLkr() };
  }

  /**
   * Paid per normalized request currency from (amount - amountRemaining).
   */
  private buildPaidByCurrency(): Map<string, number> {
    const map = new Map<string, number>();
    for (const r of this.requests) {
      const paid = Math.max(0, (r.amount ?? 0) - (r.amountRemaining ?? 0));
      if (paid <= 0) continue;
      const c = this.normalizeCurrency(r.currency);
      map.set(c, (map.get(c) || 0) + paid);
    }
    return map;
  }

  /**
   * Prefer effective inferred currency; if that bucket is empty but other paid amounts exist
   * (edge case), show those so the card does not flash empty.
   */
  get paidFiltered(): { currency: string; amount: number }[] {
    const map = this.buildPaidByCurrency();
    const inferred = this.normalizeCurrency(this.inferredCurrency);
    const amount = map.get(inferred) ?? 0;
    if (amount > 0) return [{ currency: inferred, amount }];
    const rest = [...map.entries()]
      .filter(([, a]) => a > 0)
      .map(([currency, amt]) => ({ currency, amount: amt }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    return rest;
  }

  /** Balance (catalog - approved) for the catalog fee currency only */
  get catalogBalanceDisplay(): { currency: string; amount: number } | null {
    const fee = this.catalogFeeDisplay;
    if (!fee) return null;
    const paid = this.buildPaidByCurrency().get(fee.currency) ?? 0;
    return { currency: fee.currency, amount: Math.max(0, fee.amount - paid) };
  }

  /**
   * Large "Level X — full payment" + upload CTA: hide once the catalog level fee is fully
   * covered by approved payments (normal uploads or admin-mapped legacy). Still show when
   * pricing cannot be computed (no catalog row) so the empty-state copy remains.
   */
  get showDefaultLevelFeeUploadCard(): boolean {
    if (this.loadingCatalog || !this.catalog?.studentLevel || this.hasActiveInstallmentPlan) {
      return false;
    }
    const bal = this.catalogBalanceDisplay;
    if (bal == null) return true;
    return bal.amount > 0;
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
        this.reconcileInferredCurrency();
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

  /** Active documentation / processing fee requests for this student */
  docsPaymentRequests(): PaymentRequest[] {
    return this.requests.filter((r) => r.paymentType === 'DOCS_PAYMENT');
  }

  private documentationRequestFullyDone(r: PaymentRequest): boolean {
    if (r.status === 'FULLY_PAID') return true;
    const rem = r.amountRemaining ?? 0;
    return rem <= 0 && r.status === 'APPROVED';
  }

  /** True when there is at least one docs request and every one is fully approved */
  get documentationIsPaid(): boolean {
    const list = this.docsPaymentRequests();
    if (!list.length) return false;
    return list.every((r) => this.documentationRequestFullyDone(r));
  }

  /** Total paid documentation amount (all requests settled); prefers inferred currency bucket */
  get documentationPaidLine(): { currency: string; amount: number } | null {
    if (!this.documentationIsPaid) return null;
    const list = this.docsPaymentRequests();
    const inferred = this.normalizeCurrency(this.inferredCurrency);
    const totals = new Map<string, number>();
    for (const r of list) {
      const c = this.normalizeCurrency(r.currency);
      const paid = Math.max(0, (r.amount ?? 0) - (r.amountRemaining ?? 0));
      totals.set(c, (totals.get(c) || 0) + paid);
    }
    const primary = totals.get(inferred);
    if (primary != null && primary > 0) return { currency: inferred, amount: primary };
    const first = [...totals.entries()].find(([, a]) => a > 0);
    return first ? { currency: first[0], amount: first[1] } : { currency: inferred, amount: 0 };
  }

  /**
   * How much has actually been paid (APPROVED), broken down by currency.
   * For installment plans we walk each installment row directly so we don't
   * depend on the top-level amountRemaining being perfectly in sync.
   * For non-installment requests we fall back to (amount - amountRemaining).
   */
  get paidPerCurrency(): { currency: string; amount: number }[] {
    const map = new Map<string, number>();

    for (const r of this.requests) {
      const insts = r.installments;

      if (insts?.length) {
        // Preferred path: sum approved installment rows directly
        let fromRows = 0;
        for (const inst of insts) {
          if (inst.status === 'APPROVED') {
            // use paidAmount when set, else treat the full requestedAmount as paid
            fromRows += inst.paidAmount > 0 ? inst.paidAmount : (inst.requestedAmount ?? 0);
          } else {
            // partial credit for in-progress installments
            fromRows += inst.paidAmount ?? 0;
          }
        }
        // Safety cross-check with request-level amountRemaining
        const fromRequest = Math.max(0, (r.amount ?? 0) - (r.amountRemaining ?? 0));
        const paid = Math.max(fromRows, fromRequest);
        if (paid > 0) {
          const c = this.normalizeCurrency(r.currency);
          map.set(c, (map.get(c) || 0) + paid);
        }
      } else {
        // Non-installment or no breakdown rows yet
        const paid = Math.max(0, (r.amount ?? 0) - (r.amountRemaining ?? 0));
        if (paid > 0) {
          const c = this.normalizeCurrency(r.currency);
          map.set(c, (map.get(c) || 0) + paid);
        }
      }
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

  /**
   * Catalog fee for the student's currency is fully covered by approved payments
   * (same basis as the level-fee upload card hide rule).
   */
  get isCatalogLevelFeeCleared(): boolean {
    const bal = this.catalogBalanceDisplay;
    return bal != null && bal.amount === 0;
  }

  /** Main line on the Next payment card when there is no scheduled slice. */
  get nextPaymentClearValue(): string {
    if (this.isCatalogLevelFeeCleared) return '—';
    return (this.catalog?.studentLevel || '').trim() ? 'Coming soon' : '—';
  }

  /**
   * When there is no concrete next due slice: if the catalog level fee is already cleared,
   * do not imply another A1 payment is coming.
   */
  get nextPaymentClearHint(): string {
    if (this.isCatalogLevelFeeCleared) {
      const level = (this.catalog?.studentLevel || '').trim();
      return level
        ? `Level ${level} fee is cleared — nothing due right now.`
        : 'No open amount due';
    }
    const level = (this.catalog?.studentLevel || '').trim();
    if (level) {
      return `Next payment for Level ${level} — coming soon`;
    }
    return 'No open amount due';
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

  /** Prefer schedule row count, highest part number, and server totals so labels stay consistent when data is partial */
  installmentTotalParts(req: PaymentRequest): number {
    const sorted = this.sortedInstallments(req);
    const fromRows = sorted.length;
    const fromNums = sorted.length ? Math.max(...sorted.map(i => i.installmentNumber)) : 0;
    const fromView = req.studentInstallmentView?.totalInstallments ?? 0;
    const fromReq = req.totalInstallments ?? 0;
    return Math.max(fromRows, fromNums, fromView, fromReq) || fromRows;
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
      PENDING: 'pill-amber',
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
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    return `in ${diffDays} days`;
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

  private static readonly PAYMENT_TYPE_LABELS: Record<string, string> = {
    LANGUAGE_FEE:   'Language Course Fee',
    DOCS_PAYMENT:   'Documentation Payment',
    VISA_PAYMENT:   'Visa Payment',
    CUSTOM_PAYMENT: 'Custom Payment',
  };

  formatPaymentType(type: string, customType?: string): string {
    const label = PaymentHubStudentPortalComponent.PAYMENT_TYPE_LABELS[type] || type;
    return customType ? `${label} — ${customType}` : label;
  }

  private normalizeCurrency(currency: string | null | undefined): string {
    const c = String(currency || '').trim().toUpperCase();
    if (c === 'INR' || c === 'LKR' || c === 'USD') return c;
    return 'LKR';
  }

  /** When every open request uses the same currency, use it for summaries so phone-based inference cannot override LKR payments with INR (etc.). */
  private inferUniformRequestCurrency(): string | null {
    if (!this.requests.length) return null;
    const first = this.normalizeCurrency(this.requests[0].currency);
    return this.requests.every(r => this.normalizeCurrency(r.currency) === first) ? first : null;
  }

  private reconcileInferredCurrency(): void {
    const uniform = this.inferUniformRequestCurrency();
    this.inferredCurrency = uniform ?? this.phoneInferredCurrency;
  }

  private getStatusColor(status: string): number[] {
    const statusUpper = status.toUpperCase();
    switch (statusUpper) {
      case 'APPROVED':
      case 'FULLY_PAID':
        return [22, 160, 133];
      case 'SUBMITTED':
      case 'UNDER_REVIEW':
        return [52, 152, 219];
      case 'REQUESTED':
      case 'PENDING':
        return [243, 156, 18];
      case 'REJECTED':
      case 'OVERDUE':
        return [231, 76, 60];
      case 'REUPLOAD_REQUIRED':
        return [230, 126, 34];
      default:
        return [128, 128, 128];
    }
  }

  private getProgressColor(percent: number): number[] {
    if (percent >= 100) return [22, 160, 133];
    if (percent >= 75) return [46, 204, 113];
    if (percent >= 50) return [52, 152, 219];
    if (percent >= 25) return [243, 156, 18];
    return [231, 76, 60];
  }

  downloadInvoice(req: PaymentRequest): void {
    const student = req.studentId;
    const paidAmount = req.amount - (req.amountRemaining ?? 0);
    const submission = req.submissions?.[0] as ApprovalQueueItem | undefined;
    const paymentDate = (req.status === 'APPROVED' || req.status === 'FULLY_PAID') && submission
      ? (submission as any).approvedAt || submission.submittedAt
      : req.dueDate;

    const statusLabel = this.displayStatus(req);
    const statusColor = this.getStatusColor(req.status);
    const percentPaid = req.amount > 0 ? Math.round((paidAmount / req.amount) * 100) : 0;
    const progressColor = this.getProgressColor(percentPaid);

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = 20;

    const checkPageBreak = (neededSpace: number) => {
      if (y + neededSpace > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
    };

    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40);
    doc.text('INVOICE', pageWidth / 2, y, { align: 'center' });
    y += 12;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text('Gluck Global Education', pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.text('www.gluckglobal.com | info@gluckglobal.com', pageWidth / 2, y, { align: 'center' });
    y += 15;

    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    doc.setFontSize(11);
    doc.setTextColor(60);
    doc.text('INVOICE DETAILS', margin, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text('Invoice Number', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`INV-${req._id.slice(-8).toUpperCase()}`, margin + 45, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Invoice Date', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(new Date().toLocaleDateString('en-GB'), margin + 45, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Status', margin, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
    doc.text(statusLabel, margin + 45, y);
    doc.setTextColor(0);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Request ID', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(req._id, margin + 45, y);
    y += 6;

    if (req.source) {
      doc.setFont('helvetica', 'bold');
      doc.text('Source', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(req.source, margin + 45, y);
      y += 6;
    }

    if (req.isImported) {
      doc.setFont('helvetica', 'bold');
      doc.text('Imported', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text('Yes - Legacy Import', margin + 45, y);
      y += 6;
    }
    y += 8;

    doc.setDrawColor(220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    doc.setFontSize(11);
    doc.setTextColor(60);
    doc.text('STUDENT INFORMATION', margin, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text('Full Name', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(this.userProfile?.name || student?.name || 'N/A', margin + 45, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Email', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(this.userProfile?.email || student?.email || 'N/A', margin + 45, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Registration No.', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(this.userProfile?.regNo || 'N/A', margin + 45, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Level', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(this.userProfile?.level || student?.level || 'N/A', margin + 45, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Batch', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(this.userProfile?.batch || student?.batch || 'N/A', margin + 45, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Student Status', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(this.userProfile?.studentStatus || 'N/A', margin + 45, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Subscription Plan', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(this.userProfile?.subscription || 'N/A', margin + 45, y);
    y += 6;

    if (this.userProfile?.phoneNumber) {
      doc.setFont('helvetica', 'bold');
      doc.text('Phone', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(this.userProfile.phoneNumber, margin + 45, y);
      y += 6;
    }

    if (this.userProfile?.address) {
      doc.setFont('helvetica', 'bold');
      doc.text('Address', margin, y);
      doc.setFont('helvetica', 'normal');
      const addressLines = doc.splitTextToSize(this.userProfile.address, contentWidth - 45);
      doc.text(addressLines, margin + 45, y);
      y += addressLines.length * 5 + 2;
    }

    if (this.userProfile?.servicesOpted) {
      doc.setFont('helvetica', 'bold');
      doc.text('Services Opted', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(this.userProfile.servicesOpted, margin + 45, y);
      y += 6;
    }

    y += 8;
    doc.setDrawColor(220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    doc.setFontSize(11);
    doc.setTextColor(60);
    doc.text('PAYMENT DETAILS', margin, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text('Payment Type', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(this.formatPaymentType(req.paymentType, req.customType), margin + 45, y);
    y += 6;

    if (req.customType) {
      doc.setFont('helvetica', 'bold');
      doc.text('Custom Label', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(req.customType, margin + 45, y);
      y += 6;
    }

    doc.setFont('helvetica', 'bold');
    doc.text('Currency', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(req.currency, margin + 45, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Total Amount (Quoted)', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`${req.currency} ${this.fmt(req.amount)}`, margin + 45, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Amount Paid', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`${req.currency} ${this.fmt(paidAmount)}`, margin + 45, y);
    y += 6;

const balanceColor = percentPaid >= 100 ? [22, 160, 133] : [0, 0, 0];

    doc.setFont('helvetica', 'bold');
    doc.text('Balance Due', margin, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(balanceColor[0], balanceColor[1], balanceColor[2]);
    doc.text(`${req.currency} ${this.fmt(req.amountRemaining ?? 0)}`, margin + 45, y);
    doc.setTextColor(0);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Payment Progress', margin, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(progressColor[0], progressColor[1], progressColor[2]);
    doc.text(`${percentPaid}% paid`, margin + 45, y);
    doc.setTextColor(0);
y += 6;

    const isOverdue = req.status !== 'APPROVED' && req.status !== 'FULLY_PAID' && new Date(req.dueDate) < new Date();
    const dueDateColor = isOverdue ? [231, 76, 60] : [0, 0, 0];

    doc.setFont('helvetica', 'bold');
    doc.text('Due Date', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(dueDateColor[0], dueDateColor[1], dueDateColor[2]);
    const dueDateText = isOverdue ? `${this.fmtDate(req.dueDate)} (Overdue)` : this.fmtDate(req.dueDate);
    doc.text(dueDateText, margin + 45, y);
    doc.setTextColor(0);
    y += 6;

    if (paymentDate && (req.status === 'APPROVED' || req.status === 'FULLY_PAID')) {
      doc.setFont('helvetica', 'bold');
      doc.text('Payment Date', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(this.fmtDate(paymentDate), margin + 45, y);
      y += 6;
    }

    if (req.installmentAllowed) {
      doc.setFont('helvetica', 'bold');
      doc.text('Installments', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(`${req.totalInstallments || 1} parts`, margin + 45, y);
      y += 6;

      if (req.studentInstallmentView) {
        doc.setFont('helvetica', 'bold');
        doc.text('Active Part', margin, y);
        doc.setFont('helvetica', 'normal');
        const view = req.studentInstallmentView;
        doc.text(`${view.activeInstallmentNumber || 'N/A'} of ${view.totalInstallments || req.totalInstallments || 1}`, margin + 45, y);
        y += 6;
      }
    }

    y += 8;
    doc.setDrawColor(220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    if (req.remarks) {
      doc.setFontSize(11);
      doc.setTextColor(60);
      doc.text('PAYMENT PURPOSE / REMARKS', margin, y);
      y += 8;

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0);
      const remarksLines = doc.splitTextToSize(req.remarks, contentWidth);
      doc.text(remarksLines, margin, y);
      y += remarksLines.length * 5 + 8;
    }

    if (submission) {
      checkPageBreak(50);
      doc.setDrawColor(220);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      doc.setFontSize(11);
      doc.setTextColor(60);
      doc.text('PAYMENT SUBMISSION DETAILS', margin, y);
      y += 8;

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text('Submission ID', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(submission._id, margin + 45, y);
      y += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('Payment Method', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(submission.paymentMethod || 'N/A', margin + 45, y);
      y += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('Amount Paid', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(`${submission.currency} ${this.fmt(submission.paidAmount)}`, margin + 45, y);
      y += 6;

      const subStatusColor = this.getStatusColor(submission.status);
      doc.setFont('helvetica', 'bold');
      doc.text('Submission Status', margin, y);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(subStatusColor[0], subStatusColor[1], subStatusColor[2]);
      doc.text(submission.status, margin + 45, y);
      doc.setTextColor(0);
      y += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('Submitted At', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(this.fmtDate(submission.submittedAt), margin + 45, y);
      y += 6;

      if (submission.status === 'APPROVED' && (submission as any).approvedAt) {
        doc.setFont('helvetica', 'bold');
        doc.text('Approved At', margin, y);
        doc.setFont('helvetica', 'normal');
        doc.text(this.fmtDate((submission as any).approvedAt), margin + 45, y);
        y += 6;
      }

      if (submission.transactionId) {
        doc.setFont('helvetica', 'bold');
        doc.text('Transaction ID', margin, y);
        doc.setFont('helvetica', 'normal');
        doc.text(submission.transactionId, margin + 45, y);
        y += 6;
      }

      if (submission.rejectionReason) {
        doc.setFont('helvetica', 'bold');
        doc.text('Rejection Reason', margin, y);
        doc.setFont('helvetica', 'normal');
        const rejectionLines = doc.splitTextToSize(submission.rejectionReason, contentWidth - 45);
        doc.text(rejectionLines, margin + 45, y);
        y += rejectionLines.length * 5 + 2;
      }

      if (submission.reuploadNote) {
        doc.setFont('helvetica', 'bold');
        doc.text('Reupload Note', margin, y);
        doc.setFont('helvetica', 'normal');
        const reuploadLines = doc.splitTextToSize(submission.reuploadNote, contentWidth - 45);
        doc.text(reuploadLines, margin + 45, y);
        y += reuploadLines.length * 5 + 2;
      }

      if (submission.adminRemarks) {
        doc.setFont('helvetica', 'bold');
        doc.text('Admin Remarks', margin, y);
        doc.setFont('helvetica', 'normal');
        const adminLines = doc.splitTextToSize(submission.adminRemarks, contentWidth - 45);
        doc.text(adminLines, margin + 45, y);
        y += adminLines.length * 5 + 2;
      }
    }

    if (req.installments && req.installments.length > 0) {
      checkPageBreak(50);
      y += 5;
      doc.setDrawColor(220);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      doc.setFontSize(11);
      doc.setTextColor(60);
      doc.text('INSTALLMENT SCHEDULE', margin, y);
      y += 8;

      for (const inst of this.sortedInstallments(req)) {
        checkPageBreak(40);

        doc.setFontSize(10);
        doc.setTextColor(60);
        doc.text(`Installment ${inst.installmentNumber}`, margin, y);
        y += 6;

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0);
        doc.text('Part Number', margin, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`${inst.installmentNumber} of ${req.totalInstallments || inst.installmentNumber}`, margin + 45, y);
        y += 5;

        doc.setFont('helvetica', 'bold');
        doc.text('Requested Amount', margin, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`${inst.currency} ${this.fmt(inst.requestedAmount)}`, margin + 45, y);
        y += 5;

        const instStatusColor = this.getStatusColor(inst.status);
        doc.setFont('helvetica', 'bold');
        doc.text('Status', margin, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(instStatusColor[0], instStatusColor[1], instStatusColor[2]);
        doc.text(inst.status, margin + 45, y);
        doc.setTextColor(0);
        y += 5;

        doc.setFont('helvetica', 'bold');
        doc.text('Due Date', margin, y);
        doc.setFont('helvetica', 'normal');
        doc.text(this.fmtDate(inst.dueDate), margin + 45, y);
        y += 5;

        if (inst.paidAmount > 0) {
          doc.setFont('helvetica', 'bold');
          doc.text('Paid Amount', margin, y);
          doc.setFont('helvetica', 'normal');
          doc.text(`${inst.currency} ${this.fmt(inst.paidAmount)}`, margin + 45, y);
          y += 5;
        }

        if (inst.remainingAmount > 0) {
          doc.setFont('helvetica', 'bold');
          doc.text('Remaining Amount', margin, y);
          doc.setFont('helvetica', 'normal');
          doc.text(`${inst.currency} ${this.fmt(inst.remainingAmount)}`, margin + 45, y);
          y += 5;
        }

        y += 5;
      }
    }

    checkPageBreak(30);
    y += 15;
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text('This is a computer-generated invoice.', pageWidth / 2, y, { align: 'center' });
    y += 5;
    doc.text('No signature required. Generated on ' + new Date().toLocaleString('en-IN'), pageWidth / 2, y, { align: 'center' });

    doc.save(`Invoice-${req._id.slice(-8)}.pdf`);
  }
}
