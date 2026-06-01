import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

export type PaymentApprovalDecisionMode = 'approve' | 'reject';

export interface PaymentApprovalDecisionDialogData {
  mode: PaymentApprovalDecisionMode;
  studentName: string;
  studentEmail: string;
  accountHolderName: string;
  paymentDateLabel: string;
  currency: string;
  amount: number;
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
export class PaymentApprovalDecisionDialogComponent {
  creditedAmount: number;
  amountEditing = false;
  rejectionReason = '';
  adminRemarks = '';

  constructor(
    private readonly dialogRef: MatDialogRef<PaymentApprovalDecisionDialogComponent, PaymentApprovalDecisionResult | undefined>,
    @Inject(MAT_DIALOG_DATA) public readonly data: PaymentApprovalDecisionDialogData,
  ) {
    this.creditedAmount = data.amount;
    this.adminRemarks = data.adminRemarks ?? '';
  }

  get isApprove(): boolean {
    return this.data.mode === 'approve';
  }

  get title(): string {
    return this.isApprove ? 'Approve payment' : 'Reject payment';
  }

  get accountHolderDisplay(): string {
    const n = (this.data.accountHolderName || '').trim();
    return n || '—';
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }

  toggleAmountEdit(): void {
    this.amountEditing = !this.amountEditing;
    if (!this.amountEditing) {
      const n = Number(this.creditedAmount);
      if (!n || n <= 0 || Number.isNaN(n)) {
        this.creditedAmount = this.data.amount;
      }
    }
  }

  confirm(): void {
    if (this.isApprove) {
      const paidAmount = Number(this.creditedAmount);
      if (!paidAmount || paidAmount <= 0 || Number.isNaN(paidAmount)) {
        return;
      }
      this.dialogRef.close({
        action: 'approve',
        paidAmount,
        adminRemarks: this.adminRemarks.trim() || undefined,
      });
      return;
    }
    const rejectionReason = this.rejectionReason.trim();
    if (!rejectionReason) return;
    this.dialogRef.close({ action: 'reject', rejectionReason });
  }

  fmt(val: number): string {
    return (val ?? 0).toLocaleString('en-IN');
  }
}
