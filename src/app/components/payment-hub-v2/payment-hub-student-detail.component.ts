import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
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
import { LEVEL_PAYMENT_CONFIG, suggestInrForLevel } from './level-payment-config';

@Component({
  selector: 'app-payment-hub-student-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatSnackBarModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
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
  readonly paymentSlots: Array<{ key: PaymentSlotKey; label: string }> = [
    { key: 'A1', label: 'A1' },
    { key: 'A2', label: 'A2' },
    { key: 'B1', label: 'B1' },
    { key: 'B2', label: 'B2' },
    { key: 'DOCS', label: 'Docs' },
    { key: 'VISA', label: 'Visa' },
  ];
  activeMapSlot: PaymentSlotKey | null = null;
  mappingAmount: number | null = null;
  mappingTotal: number | null = null;
  mappingBalance: number | null = null;
  mappingCurrency: CurrencyKey = 'LKR';
  mappingDate = new Date().toISOString().slice(0, 10);
  mappingRemarks = '';
  mappingSaving = false;

  showAllMappingSlots = false;

  activeFullPaidSlot: LanguageLevelSlot | null = null;
  fullPaidAmount: number | null = null;
  fullPaidCurrency: CurrencyKey = 'LKR';
  fullPaidDate = new Date().toISOString().slice(0, 10);
  fullPaidRemarks = '';
  fullPaidSaving = false;
  private catalogCefrRows: Array<{ code: string; lkr: number; inr: number }> | null = null;

  editingRequestId: string | null = null;
  editSaving = false;
  editForm: {
    amount: number;
    paidAmount: number;
    balance: number;
    currency: CurrencyKey;
    dueDate: string;
    remarks: string;
  } | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.studentId = this.route.snapshot.params['studentId'];
    this.api.getCatalogSettings().subscribe({
      next: (res) => {
        this.catalogCefrRows = res.data?.cefrRows ?? null;
      },
      error: () => {
        this.catalogCefrRows = null;
      },
    });
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.getStudentHistory(this.studentId, { limit: 100, page: 1 }).subscribe({
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

  planLabel(raw: string | undefined | null): string {
    const v = String(raw || '').trim().toUpperCase();
    if (!v) return '—';
    const map: Record<string, string> = {
      SILVER: 'Silver',
      PLATINUM: 'Platinum',
      DOCS_RECOGNITION: 'Docs recognition',
      VISA_DOC: 'Visa doc',
      VISA_DOC_ONLY: 'Visa doc',
      POST_LANDING: 'Post landing',
    };
    return map[v] || raw || '—';
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
    return this.openBalanceForRequest(req);
  }

  /** Same rules as backend openBalanceForRequest / slot Balance rows. */
  private openBalanceForRequest(req: PaymentRequest): number {
    if (req.status === 'REJECTED') return 0;
    const remaining = Number(req.amountRemaining);
    if (Number.isFinite(remaining) && remaining > 0) return remaining;
    const approved = this.getSubmissions(req).filter((s) => s.status === 'APPROVED');
    const paid = approved.reduce((sum, s) => sum + (Number(s.paidAmount) || 0), 0);
    return Math.max(0, (req.amount ?? 0) - paid);
  }

  /** Pending = outstanding balance on mapped payments (same as slot Balance rows). */
  pendingBalanceTotals(): Record<CurrencyKey, number> {
    const fromSlots: Record<CurrencyKey, number> = { LKR: 0, INR: 0, USD: 0 };
    for (const slot of this.paymentSlots) {
      const bal = this.slotSummary(slot.key).balance;
      fromSlots.LKR += bal.LKR;
      fromSlots.INR += bal.INR;
      fromSlots.USD += bal.USD;
    }
    const slotTotal = fromSlots.LKR + fromSlots.INR + fromSlots.USD;
    if (slotTotal > 0) return fromSlots;
    return {
      LKR: this.history?.profile?.pendingApprovalAmountLKR ?? 0,
      INR: this.history?.profile?.pendingApprovalAmountINR ?? 0,
      USD: this.history?.profile?.pendingApprovalAmountUSD ?? 0,
    };
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

  canManageRequest(req: PaymentRequest): boolean {
    return !!(req.isImported || req.source === 'LEGACY_MANUAL_MAPPING');
  }

  paidAmountForRequest(req: PaymentRequest): number {
    const approved = this.getSubmissions(req).filter((s) => s.status === 'APPROVED');
    if (approved.length) {
      return approved.reduce((sum, s) => sum + (Number(s.paidAmount) || 0), 0);
    }
    return Math.max(0, (req.amount || 0) - (req.amountRemaining ?? 0));
  }

  beginEditRequest(req: PaymentRequest): void {
    this.editingRequestId = req._id;
    const paid = this.paidAmountForRequest(req);
    this.editForm = {
      amount: req.amount ?? 0,
      paidAmount: paid,
      balance: req.amountRemaining ?? Math.max(0, (req.amount ?? 0) - paid),
      currency: this.normCurrency(req.currency),
      dueDate: req.dueDate ? new Date(req.dueDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      remarks: req.remarks || '',
    };
  }

  cancelEditRequest(): void {
    this.editingRequestId = null;
    this.editForm = null;
    this.editSaving = false;
  }

  onEditPaidChange(): void {
    if (!this.editForm) return;
    this.editForm.balance = Math.max(0, Number(this.editForm.amount) - Number(this.editForm.paidAmount));
  }

  onEditAmountChange(): void {
    this.onEditPaidChange();
  }

  saveEditRequest(req: PaymentRequest): void {
    if (!this.editForm || !req._id) return;
    const amount = Number(this.editForm.amount);
    const paidAmount = Number(this.editForm.paidAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.snack.open('Enter a valid requested amount', 'Dismiss', { duration: 3500 });
      return;
    }
    if (!this.editForm.dueDate) {
      this.snack.open('Select a due date', 'Dismiss', { duration: 3500 });
      return;
    }
    const dueDate = new Date(this.editForm.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      this.snack.open('Invalid due date', 'Dismiss', { duration: 3500 });
      return;
    }

    this.editSaving = true;
    this.api.updateLegacyPaymentRequest(req._id, {
      amount,
      paidAmount,
      currency: this.editForm.currency,
      dueDate: dueDate.toISOString(),
      remarks: this.editForm.remarks.trim() || undefined,
    }).subscribe({
      next: () => {
        this.editSaving = false;
        this.snack.open('Payment record updated', 'OK', { duration: 3500 });
        this.cancelEditRequest();
        this.load();
      },
      error: (e) => {
        this.editSaving = false;
        this.snack.open(e?.error?.message || 'Could not update payment', 'Dismiss', { duration: 5000 });
      },
    });
  }

  deleteRequest(req: PaymentRequest): void {
    if (!req._id || !this.canManageRequest(req)) return;
    const label = this.formatPaymentType(req.paymentType, req.customType);
    if (!window.confirm(`Remove this payment record (${label})? This cannot be undone.`)) return;

    this.api.archiveRequest(req._id, 'Removed from payment hub by admin').subscribe({
      next: () => {
        this.snack.open('Payment record removed', 'OK', { duration: 3500 });
        if (this.editingRequestId === req._id) this.cancelEditRequest();
        this.load();
      },
      error: (e) => {
        this.snack.open(e?.error?.message || 'Could not remove payment', 'Dismiss', { duration: 5000 });
      },
    });
  }

  slotSummary(slotKey: PaymentSlotKey): PaymentSlotSummary {
    const rows = (this.history?.requests || []).filter((req) => this.slotForRequest(req) === slotKey);
    const summary: PaymentSlotSummary = {
      requestCount: rows.length,
      settledCount: 0,
      requested: { LKR: 0, INR: 0, USD: 0 },
      paid: { LKR: 0, INR: 0, USD: 0 },
      balance: { LKR: 0, INR: 0, USD: 0 },
    };
    for (const req of rows) {
      const currency = this.normCurrency(req.currency);
      const requested = Math.max(0, req.amount ?? 0);
      const balance = this.openBalanceForRequest(req);
      const paid = Math.max(0, requested - balance);
      summary.requested[currency] += requested;
      summary.paid[currency] += paid;
      summary.balance[currency] += balance;
      if (balance === 0) {
        summary.settledCount += 1;
      }
    }
    return summary;
  }

  hasAnySlotPayments(): boolean {
    return this.paymentSlots.some((slot) => this.slotSummary(slot.key).requestCount > 0);
  }

  /** Slots with mapped requests, plus current student level when expanding the grid. */
  visiblePaymentSlots(): Array<{ key: PaymentSlotKey; label: string }> {
    if (this.showAllMappingSlots) return this.paymentSlots;
    const current = this.normalizeLevel(this.history?.student?.level);
    return this.paymentSlots.filter((slot) => {
      if (this.slotSummary(slot.key).requestCount > 0) return true;
      return current && slot.key === current;
    });
  }

  emptyMappingSlotCount(): number {
    return this.paymentSlots.filter((s) => this.slotSummary(s.key).requestCount === 0).length;
  }

  slotStatusKey(slotKey: PaymentSlotKey): 'empty' | 'settled' | 'partial' | 'balance' {
    const s = this.slotSummary(slotKey);
    if (s.requestCount === 0) return 'empty';
    if (s.settledCount === s.requestCount) return 'settled';
    if (s.settledCount > 0) return 'partial';
    return 'balance';
  }

  slotStatusLabel(slotKey: PaymentSlotKey): string {
    const map: Record<string, string> = {
      empty: 'Not mapped',
      settled: 'Settled',
      partial: 'Partial',
      balance: 'Balance due',
    };
    return map[this.slotStatusKey(slotKey)] || '—';
  }

  slotStatusClass(slotKey: PaymentSlotKey): string {
    const map: Record<string, string> = {
      empty: 'sd-slot-status--empty',
      settled: 'sd-slot-status--settled',
      partial: 'sd-slot-status--partial',
      balance: 'sd-slot-status--due',
    };
    return map[this.slotStatusKey(slotKey)] || '';
  }

  canMarkFullPaid(slotKey: PaymentSlotKey): boolean {
    return this.isLevelSlot(slotKey) && this.slotSummary(slotKey).requestCount > 0;
  }

  /** Template handler — narrows level slot before opening full-paid form. */
  onMarkFullPaidClick(slotKey: PaymentSlotKey): void {
    if (!this.isLevelSlot(slotKey)) return;
    this.beginFullPaid(slotKey);
  }

  requestsForSlot(slotKey: PaymentSlotKey): PaymentRequest[] {
    return (this.history?.requests || []).filter((req) => this.slotForRequest(req) === slotKey);
  }

  private slotForRequest(req: PaymentRequest): PaymentSlotKey | null {
    if (req.paymentType === 'DOCS_PAYMENT') return 'DOCS';
    if (req.paymentType === 'VISA_PAYMENT') return 'VISA';
    if (req.paymentType === 'CUSTOM_PAYMENT') return this.normalizeLevel(req.customType);
    if (req.paymentType !== 'LANGUAGE_FEE') return null;
    return this.normalizeLevel(req.customType) || this.normalizeLevel(this.history?.student?.level);
  }

  beginMap(slotKey: PaymentSlotKey): void {
    this.activeFullPaidSlot = null;
    const initialCurrency = this.primaryCurrencyForSlot(slotKey);
    const initial = this.slotAmountsForCurrency(slotKey, initialCurrency);
    this.activeMapSlot = slotKey;
    this.mappingCurrency = initialCurrency;
    this.mappingAmount =
      initial.balance > 0 ? initial.balance : initial.paid > 0 ? initial.paid : null;
    this.mappingTotal = initial.requested > 0 ? initial.requested : null;
    this.mappingBalance = initial.balance > 0 ? initial.balance : null;
    if (this.mappingAmount != null && this.mappingTotal != null && this.mappingTotal > 0) {
      this.mappingBalance = Math.max(0, this.mappingTotal - this.mappingAmount);
    }
    this.mappingDate = new Date().toISOString().slice(0, 10);
    this.mappingRemarks = '';
  }

  cancelMap(): void {
    this.activeMapSlot = null;
    this.mappingSaving = false;
  }

  isLevelSlot(slotKey: PaymentSlotKey): slotKey is LanguageLevelSlot {
    return slotKey === 'A1' || slotKey === 'A2' || slotKey === 'B1' || slotKey === 'B2';
  }

  beginFullPaid(slotKey: LanguageLevelSlot): void {
    this.activeFullPaidSlot = slotKey;
    this.activeMapSlot = null;
    this.fullPaidCurrency = this.primaryCurrencyForSlot(slotKey);
    this.fullPaidAmount = this.suggestFullPaidAmount(slotKey, this.fullPaidCurrency);
    this.fullPaidDate = new Date().toISOString().slice(0, 10);
    this.fullPaidRemarks = 'Full course payment — discounted level fee';
  }

  cancelFullPaid(): void {
    this.activeFullPaidSlot = null;
    this.fullPaidSaving = false;
  }

  onFullPaidCurrencyChange(slotKey: LanguageLevelSlot): void {
    this.fullPaidAmount = this.suggestFullPaidAmount(slotKey, this.fullPaidCurrency);
  }

  saveFullPaid(slotKey: LanguageLevelSlot): void {
    if (!this.history?.student?._id) return;
    const amount = Number(this.fullPaidAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.snack.open('Enter the full paid amount for this level', 'Dismiss', { duration: 3500 });
      return;
    }
    if (!this.fullPaidDate) {
      this.snack.open('Select a payment date', 'Dismiss', { duration: 3500 });
      return;
    }
    const paymentDate = new Date(this.fullPaidDate);
    if (Number.isNaN(paymentDate.getTime())) {
      this.snack.open('Invalid payment date', 'Dismiss', { duration: 3500 });
      return;
    }

    this.fullPaidSaving = true;
    this.api.markLevelSlotFullPaid({
      studentId: this.history.student._id,
      slotKey,
      fullPaidAmount: amount,
      currency: this.fullPaidCurrency,
      paymentDate: paymentDate.toISOString(),
      remarks: this.fullPaidRemarks.trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.fullPaidSaving = false;
        this.snack.open(res.message || `${slotKey} marked full paid`, 'OK', { duration: 4500 });
        this.cancelFullPaid();
        this.load();
      },
      error: (e) => {
        this.fullPaidSaving = false;
        this.snack.open(e?.error?.message || 'Could not save full paid amount', 'Dismiss', { duration: 5000 });
      },
    });
  }

  /** Standard catalog fee for a level (before discount). */
  standardLevelFee(slotKey: LanguageLevelSlot, currency: CurrencyKey): number {
    const code = slotKey.toUpperCase();
    const row = this.catalogCefrRows?.find((r) => String(r.code).toUpperCase() === code);
    if (currency === 'INR') {
      return row?.inr ?? suggestInrForLevel(code);
    }
    if (currency === 'USD') {
      const lkr = row?.lkr ?? LEVEL_PAYMENT_CONFIG[code] ?? LEVEL_PAYMENT_CONFIG['A1'];
      return Math.round(lkr / 300);
    }
    return row?.lkr ?? LEVEL_PAYMENT_CONFIG[code] ?? LEVEL_PAYMENT_CONFIG['A1'];
  }

  /** Suggested full-paid amount (10% course discount on standard fee). */
  suggestFullPaidAmount(slotKey: LanguageLevelSlot, currency: CurrencyKey): number {
    const standard = this.standardLevelFee(slotKey, currency);
    return Math.round(standard * 0.9);
  }

  saveMappedPayment(slotKey: PaymentSlotKey): void {
    if (!this.history?.student?._id) return;
    const amount = Number(this.mappingAmount || 0);
    const quotedTotal = Number(this.mappingTotal ?? 0);
    const isLevelSlot = slotKey === 'A1' || slotKey === 'A2' || slotKey === 'B1' || slotKey === 'B2';
    const quoteOnlySave = isLevelSlot && quotedTotal > 0 && (!Number.isFinite(amount) || amount <= 0);
    if (!quoteOnlySave && (!Number.isFinite(amount) || amount <= 0)) {
      this.snack.open('Enter a valid amount', 'Dismiss', { duration: 3500 });
      return;
    }
    if (quoteOnlySave && quotedTotal <= 0) {
      this.snack.open('Enter the correct Total / Quoted for this level', 'Dismiss', { duration: 3500 });
      return;
    }
    if (!this.mappingDate) {
      this.snack.open('Select a payment date', 'Dismiss', { duration: 3500 });
      return;
    }

    const paymentDate = new Date(this.mappingDate);
    if (Number.isNaN(paymentDate.getTime())) {
      this.snack.open('Invalid payment date', 'Dismiss', { duration: 3500 });
      return;
    }

    const remarks = this.buildMappingRemarks();
    const body: {
      studentId: string;
      languagePayment?: {
        totalCourseFee: number;
        amountPaid: number;
        currency: CurrencyKey;
        paymentDate: string;
        remarks?: string;
        markFullyPaid?: boolean;
      };
      docsPayments?: Array<{ amount: number; currency: CurrencyKey; paymentDate: string; remarks?: string }>;
      visaPayments?: Array<{ amount: number; currency: CurrencyKey; paymentDate: string; remarks?: string }>;
      customPayments?: Array<{
        paymentType: string;
        amount: number;
        quotedTotal?: number;
        currency: CurrencyKey;
        paymentDate: string;
        remarks?: string;
      }>;
    } = {
      studentId: this.history.student._id,
    };

    if (slotKey === 'DOCS') {
      body.docsPayments = [{ amount, currency: this.mappingCurrency, paymentDate: paymentDate.toISOString(), remarks }];
    } else if (slotKey === 'VISA') {
      body.visaPayments = [{ amount, currency: this.mappingCurrency, paymentDate: paymentDate.toISOString(), remarks }];
    } else {
      body.customPayments = [{
        paymentType: slotKey,
        amount: quoteOnlySave ? 0 : amount,
        quotedTotal: quotedTotal > 0 ? quotedTotal : undefined,
        currency: this.mappingCurrency,
        paymentDate: paymentDate.toISOString(),
        remarks: remarks || `Mapped as ${slotKey} advance payment`,
      }];
    }

    this.mappingSaving = true;
    this.api.mapLegacyPayments(body).subscribe({
      next: (res) => {
        this.mappingSaving = false;
        const custom = res.data?.custom?.[0];
        let msg = `${slotKey} payment mapped successfully`;
        if (custom?.reconciled?.updated) {
          const q = custom.reconciled.quotedTotal ?? 0;
          msg = `${slotKey} quote updated to ${this.mappingCurrency} ${this.fmt(q)}`;
          if ((custom.reconciled.amountRemaining ?? 0) <= 0) {
            msg += ' — fully settled';
          }
        } else if (custom?.alreadyMapped) {
          msg = `${slotKey} payment was already on file; totals refreshed`;
        }
        this.snack.open(msg, 'OK', { duration: 4500 });
        this.cancelMap();
        this.load();
      },
      error: (e) => {
        this.mappingSaving = false;
        const msg = e?.error?.message || 'Could not map payment';
        const isDuplicate = e?.status === 409 || String(msg).toLowerCase().includes('duplicate');
        if (isDuplicate) {
          this.load();
        }
        this.snack.open(msg, 'Dismiss', { duration: isDuplicate ? 7000 : 5000 });
      },
    });
  }

  onMapPaidChange(): void {
    const paid = Number(this.mappingAmount ?? 0);
    const total = Number(this.mappingTotal ?? 0);
    if (total > 0) {
      this.mappingBalance = Math.max(0, total - paid);
      return;
    }
    const bal = Number(this.mappingBalance ?? 0);
    if (paid > 0 || bal > 0) this.mappingTotal = paid + bal;
  }

  onMapTotalChange(): void {
    const total = Number(this.mappingTotal ?? 0);
    const paid = Number(this.mappingAmount ?? 0);
    if (total > 0) {
      this.mappingBalance = Math.max(0, total - paid);
    } else {
      this.mappingBalance = null;
    }
  }

  onMapBalanceChange(): void {
    const bal = Number(this.mappingBalance ?? 0);
    const total = Number(this.mappingTotal ?? 0);
    if (total > 0) {
      this.mappingAmount = Math.max(0, total - bal);
      return;
    }
    const paid = Number(this.mappingAmount ?? 0);
    if (paid > 0 || bal > 0) this.mappingTotal = paid + bal;
  }

  onMappingCurrencyChange(slotKey: PaymentSlotKey): void {
    const seeded = this.slotAmountsForCurrency(slotKey, this.mappingCurrency);
    this.mappingAmount =
      seeded.balance > 0 ? seeded.balance : seeded.paid > 0 ? seeded.paid : null;
    this.mappingTotal = seeded.requested > 0 ? seeded.requested : null;
    this.mappingBalance = seeded.balance > 0 ? seeded.balance : null;
    if (this.mappingAmount != null && this.mappingTotal != null && this.mappingTotal > 0) {
      this.mappingBalance = Math.max(0, this.mappingTotal - this.mappingAmount);
    }
  }

  slotCardThemeClass(slotKey: PaymentSlotKey): string {
    const map: Record<PaymentSlotKey, string> = {
      A1: 'sd-slot-card--a1',
      A2: 'sd-slot-card--a2',
      B1: 'sd-slot-card--b1',
      B2: 'sd-slot-card--b2',
      DOCS: 'sd-slot-card--docs',
      VISA: 'sd-slot-card--visa',
    };
    return map[slotKey];
  }

  /** Prefer the currency bucket that still has an outstanding balance for this slot. */
  private primaryCurrencyForSlot(slotKey: PaymentSlotKey): CurrencyKey {
    const all: CurrencyKey[] = ['LKR', 'INR', 'USD'];
    let best: CurrencyKey = 'LKR';
    let bestBalance = 0;
    for (const c of all) {
      const balance = this.slotAmountsForCurrency(slotKey, c).balance;
      if (balance > bestBalance) {
        bestBalance = balance;
        best = c;
      }
    }
    if (bestBalance > 0) return best;
    return this.firstCurrencyWithValues(slotKey);
  }

  private firstCurrencyWithValues(slotKey: PaymentSlotKey): CurrencyKey {
    const all: CurrencyKey[] = ['LKR', 'INR', 'USD'];
    for (const c of all) {
      const v = this.slotAmountsForCurrency(slotKey, c);
      if (v.hasValue) return c;
    }
    return 'LKR';
  }

  private slotAmountsForCurrency(slotKey: PaymentSlotKey, currency: CurrencyKey): {
    requested: number;
    paid: number;
    balance: number;
    hasValue: boolean;
  } {
    const summary = this.slotSummary(slotKey);
    const requested = summary.requested[currency] ?? 0;
    const paid = summary.paid[currency] ?? 0;
    const balance = summary.balance[currency] ?? 0;
    return { requested, paid, balance, hasValue: requested > 0 || paid > 0 || balance > 0 };
  }

  private buildMappingRemarks(): string {
    const userText = (this.mappingRemarks || '').trim();
    const parts: string[] = [];
    if (this.mappingTotal != null && this.mappingTotal > 0) {
      parts.push(`Quoted: ${this.mappingCurrency} ${this.fmt(this.mappingTotal)}`);
    }
    if (this.mappingBalance != null && this.mappingBalance >= 0) {
      parts.push(`Balance: ${this.mappingCurrency} ${this.fmt(this.mappingBalance)}`);
    }
    if (userText) parts.push(userText);
    return parts.join(' · ');
  }

  private normalizeLevel(level: string | undefined | null): LanguageLevelSlot | null {
    const val = String(level || '').trim().toUpperCase();
    if (val === 'A1' || val === 'A2' || val === 'B1' || val === 'B2') return val;
    return null;
  }

  private normCurrency(currency: string | undefined | null): CurrencyKey {
    const c = String(currency || '').trim().toUpperCase();
    if (c === 'INR' || c === 'USD') return c;
    return 'LKR';
  }
}

type LanguageLevelSlot = 'A1' | 'A2' | 'B1' | 'B2';
type PaymentSlotKey = LanguageLevelSlot | 'DOCS' | 'VISA';
type CurrencyKey = 'LKR' | 'INR' | 'USD';

interface PaymentSlotSummary {
  requestCount: number;
  settledCount: number;
  requested: Record<CurrencyKey, number>;
  paid: Record<CurrencyKey, number>;
  balance: Record<CurrencyKey, number>;
}
