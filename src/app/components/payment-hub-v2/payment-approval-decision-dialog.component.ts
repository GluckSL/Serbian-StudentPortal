import { AfterViewInit, Component, ElementRef, Inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApprovalQueueItem } from './payment-hub-api.service';

export type PaymentApprovalDecisionMode = 'approve' | 'reject';

export interface PaymentReviewUpdates {
  batch?: string;
  level?: string;
  paymentType?: string;
  customType?: string;
  requestAmount?: number;
  balance?: number;
  requestCurrency?: string;
  declaredAmount?: number;
  accountHolderName?: string;
  paymentMethod?: string;
  paymentDateTime?: string;
  remarks?: string;
}

export interface PaymentApprovalDecisionDialogData {
  mode: PaymentApprovalDecisionMode;
  submission: ApprovalQueueItem;
  paymentDateLabel: string;
  adminRemarks?: string;
}

export type PaymentApprovalDecisionResult =
  | { action: 'approve'; paidAmount: number; adminRemarks?: string; reviewUpdates?: PaymentReviewUpdates }
  | { action: 'reject'; rejectionReason: string; reviewUpdates?: PaymentReviewUpdates };

@Component({
  selector: 'app-payment-approval-decision-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  templateUrl: './payment-approval-decision-dialog.component.html',
  styleUrls: ['./payment-approval-decision-dialog.component.scss'],
})
export class PaymentApprovalDecisionDialogComponent implements AfterViewInit {
  @ViewChild('rejectionReasonInput') rejectionReasonInput?: ElementRef<HTMLTextAreaElement>;

  batch = '';
  level = '';
  paymentType = '';
  customType = '';
  /** Student-declared amount for this submission (shown as payment amount). */
  paymentAmount: number | null = null;
  /** Full quoted fee on the payment request (course / invoice total). */
  quotedCourseFee: number | null = null;
  balance: number | null = null;
  currency = 'LKR';
  creditedAmount: number;
  accountHolderName = '';
  paymentMethod = 'Bank Transfer';
  paymentDate = '';
  requestRemarks = '';
  rejectionReason = '';
  adminRemarks = '';

  readonly currencies = ['LKR', 'INR', 'USD'];
  readonly levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly paymentMethods = ['Bank Transfer', 'UPI', 'Cash', 'Card', 'Other'];
  readonly paymentTypes = [
    { value: 'LANGUAGE_FEE', label: 'Language course fee' },
    { value: 'DOCS_PAYMENT', label: 'Documentation payment' },
    { value: 'VISA_PAYMENT', label: 'Visa payment' },
    { value: 'CUSTOM_PAYMENT', label: 'Custom / level slot' },
    { value: 'Monthly Fee', label: 'Monthly fee' },
    { value: 'Registration', label: 'Registration' },
    { value: 'Exam Fee', label: 'Exam fee' },
    { value: 'Custom', label: 'Custom (legacy)' },
    { value: 'Other', label: 'Other' },
  ];

  constructor(
    private readonly dialogRef: MatDialogRef<PaymentApprovalDecisionDialogComponent, PaymentApprovalDecisionResult | undefined>,
    @Inject(MAT_DIALOG_DATA) public readonly data: PaymentApprovalDecisionDialogData,
  ) {
    const sub = data.submission;
    const pr = sub.paymentRequestId;
    const sid = sub.studentId;

    const declared = this.declaredAmountFrom(sub);
    this.creditedAmount = declared;
    this.currency = sub.currency || pr?.currency || 'LKR';
    this.batch = (typeof sid === 'object' && sid?.batch) ? String(sid.batch).trim() : '';
    this.level = (typeof sid === 'object' && sid?.level) ? String(sid.level).trim().toUpperCase() : '';
    this.paymentType = pr?.paymentType || 'LANGUAGE_FEE';
    this.customType = pr?.customType?.trim() || '';
    this.quotedCourseFee = pr?.amount ?? null;
    this.paymentAmount = declared > 0 ? declared : null;
    const remainingBefore = Number(pr?.amountRemaining ?? pr?.amount ?? 0);
    this.balance = Math.max(0, remainingBefore - (declared > 0 ? declared : 0));
    this.accountHolderName = (sub.accountHolderName || '').trim();
    this.paymentMethod = sub.paymentMethod || 'Bank Transfer';
    this.requestRemarks = pr?.remarks?.trim() || '';
    this.adminRemarks = data.adminRemarks ?? '';

    const dt = sub.paymentDateTime || sub.submittedAt;
    if (dt) {
      const d = new Date(dt);
      if (!Number.isNaN(d.getTime())) {
        this.paymentDate = d.toISOString().slice(0, 16);
      }
    }
  }

  get submission(): ApprovalQueueItem {
    return this.data.submission;
  }

  get isApproveIntent(): boolean {
    return this.data.mode === 'approve';
  }

  get title(): string {
    return 'Review payment';
  }

  get studentName(): string {
    const sid = this.submission.studentId;
    if (sid && typeof sid === 'object') {
      return (sid.name || '').trim();
    }
    return '';
  }

  get studentEmail(): string {
    const sid = this.submission.studentId;
    if (sid && typeof sid === 'object') {
      return (sid.email || '').trim();
    }
    return '';
  }

  get showCustomType(): boolean {
    return (
      this.paymentType === 'LANGUAGE_FEE' ||
      this.paymentType === 'CUSTOM_PAYMENT' ||
      this.paymentType === 'Custom'
    );
  }

  get customTypeLabel(): string {
    return this.paymentType === 'LANGUAGE_FEE' ? 'Level (A1–B2)' : 'Category / label';
  }

  get canApprove(): boolean {
    const n = Number(this.creditedAmount);
    return Number.isFinite(n) && n > 0;
  }

  get canReject(): boolean {
    return !!this.rejectionReason.trim();
  }

  ngAfterViewInit(): void {
    if (this.isApproveIntent) return;
    setTimeout(() => this.rejectionReasonInput?.nativeElement?.focus(), 0);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }

  buildReviewUpdates(): PaymentReviewUpdates {
    const updates: PaymentReviewUpdates = {
      batch: this.batch.trim(),
      level: this.level.trim() || undefined,
      paymentType: this.paymentType,
      customType: this.showCustomType ? this.customType.trim() : '',
      requestCurrency: this.currency,
      declaredAmount: Number(this.creditedAmount),
      accountHolderName: this.accountHolderName.trim(),
      paymentMethod: this.paymentMethod,
      remarks: this.requestRemarks.trim(),
    };
    if (this.quotedCourseFee != null && this.quotedCourseFee > 0) {
      updates.requestAmount = Number(this.quotedCourseFee);
    }
    if (this.balance != null && this.balance >= 0) {
      updates.balance = Number(this.balance);
    }
    if (this.paymentDate) {
      updates.paymentDateTime = new Date(this.paymentDate).toISOString();
    }
    return updates;
  }

  confirmApprove(): void {
    const paidAmount = Number(this.creditedAmount);
    if (!paidAmount || paidAmount <= 0 || Number.isNaN(paidAmount)) {
      return;
    }
    this.dialogRef.close({
      action: 'approve',
      paidAmount,
      adminRemarks: this.adminRemarks.trim() || undefined,
      reviewUpdates: this.buildReviewUpdates(),
    });
  }

  confirmReject(): void {
    const rejectionReason = this.rejectionReason.trim();
    if (!rejectionReason) return;
    this.dialogRef.close({
      action: 'reject',
      rejectionReason,
      reviewUpdates: this.buildReviewUpdates(),
    });
  }

  fmt(val: number): string {
    return (val ?? 0).toLocaleString('en-IN');
  }

  currencyLabel(currency: string | null | undefined): string {
    return String(currency || '').toUpperCase() === 'USD' ? 'EURO' : String(currency || '');
  }

  onPaymentAmountChange(): void {
    const pay = Number(this.paymentAmount);
    if (Number.isFinite(pay) && pay > 0) {
      this.creditedAmount = pay;
    }
    this.recalcBalanceAfterCredit();
  }

  onCreditedAmountChange(): void {
    const credit = Number(this.creditedAmount);
    if (Number.isFinite(credit) && credit > 0) {
      this.paymentAmount = credit;
    }
    this.recalcBalanceAfterCredit();
  }

  onQuotedFeeChange(): void {
    this.recalcBalanceAfterCredit();
  }

  private recalcBalanceAfterCredit(): void {
    const quoted = Number(this.quotedCourseFee);
    const remainingBefore = Number.isFinite(quoted) && quoted > 0
      ? (Number(this.submission.paymentRequestId?.amountRemaining ?? quoted) || quoted)
      : 0;
    const pay = Number(this.paymentAmount ?? this.creditedAmount);
    const credit = Number.isFinite(pay) && pay > 0 ? pay : 0;
    this.balance = Math.max(0, remainingBefore - credit);
  }

  private declaredAmountFrom(sub: ApprovalQueueItem): number {
    const n = Number(sub.paidAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
}
