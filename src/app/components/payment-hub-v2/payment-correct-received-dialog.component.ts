import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';

import { PaymentHubApiService, StudentTableRow } from './payment-hub-api.service';

export interface CorrectReceivedDialogData {
  row: StudentTableRow;
}

@Component({
  selector: 'app-payment-correct-received-dialog',
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
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDividerModule,
  ],
  templateUrl: './payment-correct-received-dialog.component.html',
  styleUrls: ['./payment-correct-received-dialog.component.scss'],
})
export class PaymentCorrectReceivedDialogComponent {
  readonly currencies = ['LKR', 'INR', 'USD'];
  currency: string;
  currentTotal = 0;
  correctedTotal = 0;
  reason = '';
  saving = false;

  constructor(
    private readonly dialogRef: MatDialogRef<PaymentCorrectReceivedDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: CorrectReceivedDialogData,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {
    const row = data.row;
    this.currency = this.pickPrimaryCurrency(row);
    this.currentTotal = this.paidForCurrency(row, this.currency);
    this.correctedTotal = this.currentTotal;
  }

  get studentName(): string {
    return this.data.row.studentId?.name || 'Student';
  }

  get studentId(): string {
    return this.data.row.studentId?._id || this.data.row._id;
  }

  get delta(): number {
    return this.correctedTotal - this.currentTotal;
  }

  get hasDelta(): boolean {
    return Math.abs(this.delta) >= 0.01;
  }

  onCurrencyChange(): void {
    this.currentTotal = this.paidForCurrency(this.data.row, this.currency);
    this.correctedTotal = this.currentTotal;
  }

  close(saved = false): void {
    this.dialogRef.close(saved);
  }

  save(): void {
    if (!this.reason.trim()) {
      this.snack.open('Please enter a reason for this correction', 'Dismiss', { duration: 4000 });
      return;
    }
    const target = Number(this.correctedTotal);
    if (target < 0 || Number.isNaN(target)) {
      this.snack.open('Enter a valid amount', 'Dismiss', { duration: 4000 });
      return;
    }
    if (Math.abs(target - this.currentTotal) < 0.01) {
      this.snack.open('Amount is unchanged', 'Dismiss', { duration: 4000 });
      return;
    }

    this.saving = true;
    this.api
      .correctStudentTotalPaid(this.studentId, {
        currency: this.currency,
        correctedTotalPaid: target,
        adminRemarks: this.reason.trim(),
      })
      .subscribe({
        next: (res) => {
          this.saving = false;
          this.snack.open(res.message || 'Payment total updated', 'OK', { duration: 5000 });
          this.close(true);
        },
        error: (err) => {
          this.saving = false;
          this.snack.open(err?.error?.message || 'Could not update payment', 'Dismiss', { duration: 6000 });
        },
      });
  }

  fmt(n: number): string {
    return (n ?? 0).toLocaleString('en-IN');
  }

  currencyLabel(currency: string | null | undefined): string {
    return String(currency || '').toUpperCase() === 'USD' ? 'EURO' : String(currency || '');
  }

  private pickPrimaryCurrency(row: StudentTableRow): string {
    const inferred = String(row.inferredCurrency || '').toUpperCase();
    if (inferred === 'LKR' || inferred === 'INR' || inferred === 'USD') return inferred;
    if ((row.totalPaidLKR ?? 0) > 0) return 'LKR';
    if ((row.totalPaidINR ?? 0) > 0) return 'INR';
    if ((row.totalPaidUSD ?? 0) > 0) return 'USD';
    return 'LKR';
  }

  private paidForCurrency(row: StudentTableRow, currency: string): number {
    const c = currency.toUpperCase();
    if (c === 'INR') return row.totalPaidINR ?? 0;
    if (c === 'USD') return row.totalPaidUSD ?? 0;
    return row.totalPaidLKR ?? 0;
  }
}
