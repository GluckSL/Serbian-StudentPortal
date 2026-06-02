import { AfterViewInit, Component, ElementRef, Inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApprovalQueueItem } from './payment-hub-api.service';

export type PaymentApprovalDecisionMode = 'approve' | 'reject';

export interface PaymentApprovalDecisionDialogData {
  mode: PaymentApprovalDecisionMode;
  submission: ApprovalQueueItem;
  paymentDateLabel: string;
  adminRemarks?: string;
}

export type PaymentApprovalDecisionResult =
  | { action: 'approve'; paidAmount: number; adminRemarks?: string }
  | { action: 'reject'; rejectionReason: string };

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
    MatDividerModule,
    MatTooltipModule,
  ],
  templateUrl: './payment-approval-decision-dialog.component.html',
  styleUrls: ['./payment-approval-decision-dialog.component.scss'],
})
export class PaymentApprovalDecisionDialogComponent implements AfterViewInit {
  @ViewChild('rejectionReasonInput') rejectionReasonInput?: ElementRef<HTMLTextAreaElement>;

  creditedAmount: number;
  amountEditing = false;
  rejectionReason = '';
  adminRemarks = '';

  constructor(
    private readonly dialogRef: MatDialogRef<PaymentApprovalDecisionDialogComponent, PaymentApprovalDecisionResult | undefined>,
    @Inject(MAT_DIALOG_DATA) public readonly data: PaymentApprovalDecisionDialogData,
  ) {
    this.creditedAmount = this.declaredAmount;
    this.adminRemarks = data.adminRemarks ?? '';
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

  get accountHolderDisplay(): string {
    const n = (this.submission.accountHolderName || '').trim();
    return n || '—';
  }

  get currency(): string {
    return this.submission.currency || this.submission.paymentRequestId?.currency || 'INR';
  }

  /** Amount the student declared on this submission. */
  get declaredAmount(): number {
    const n = Number(this.submission.paidAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
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

  toggleAmountEdit(): void {
    this.amountEditing = !this.amountEditing;
    if (!this.amountEditing) {
      const n = Number(this.creditedAmount);
      if (!n || n <= 0 || Number.isNaN(n)) {
        this.creditedAmount = this.declaredAmount;
      }
    }
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
    });
  }

  confirmReject(): void {
    const rejectionReason = this.rejectionReason.trim();
    if (!rejectionReason) return;
    this.dialogRef.close({ action: 'reject', rejectionReason });
  }

  fmt(val: number): string {
    return (val ?? 0).toLocaleString('en-IN');
  }
}
