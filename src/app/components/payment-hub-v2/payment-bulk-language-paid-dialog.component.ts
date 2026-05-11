import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

import { PaymentHubApiService, StudentTableRow, BulkLegacyLanguageRow, CefrRow } from './payment-hub-api.service';
import { LEVEL_PAYMENT_CONFIG, suggestInrForLevel } from './level-payment-config';

export interface BulkLanguagePaidDialogData {
  rows: StudentTableRow[];
}

export interface BulkLanguageEditRow {
  studentId: string;
  name: string;
  level: string;
  currency: string;
  amount: number;
  totalPaid: number;
}

@Component({
  selector: 'app-payment-bulk-language-paid-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  templateUrl: './payment-bulk-language-paid-dialog.component.html',
  styleUrls: ['./payment-bulk-language-paid-dialog.component.scss'],
})
export class PaymentBulkLanguagePaidDialogComponent implements OnInit {
  editRows: BulkLanguageEditRow[] = [];
  previewMode = false;
  loading = true;
  saving = false;
  sharedPaymentDate: Date = new Date();
  sharedRemarks = '';
  readonly currencies = ['LKR', 'INR', 'USD'];

  constructor(
    private readonly dialogRef: MatDialogRef<PaymentBulkLanguagePaidDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: BulkLanguagePaidDialogData,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.api.getCatalogSettings().subscribe({
      next: (res) => {
        this.editRows = (this.data.rows || []).map((row) => this.buildRow(row, res.data?.cefrRows ?? null));
        this.loading = false;
      },
      error: () => {
        this.editRows = (this.data.rows || []).map((row) => this.buildRow(row, null));
        this.loading = false;
      },
    });
  }

  private buildRow(row: StudentTableRow, cefrRows: CefrRow[] | null): BulkLanguageEditRow {
    const inferred = (row.inferredCurrency || 'LKR').toUpperCase();
    const level = (row.studentId.level || 'A1').toUpperCase().trim();
    const cefr = cefrRows?.find((r) => r.code === level);

    let currency = inferred;
    let amount: number;

    if (cefr) {
      if (inferred === 'INR') {
        amount = cefr.inr || suggestInrForLevel(level);
      } else if (inferred === 'USD') {
        amount = cefr.lkr;
        currency = 'LKR';
      } else {
        amount = cefr.lkr;
      }
    } else if (inferred === 'INR') {
      amount = suggestInrForLevel(level);
    } else if (inferred === 'USD') {
      amount = LEVEL_PAYMENT_CONFIG[level] ?? LEVEL_PAYMENT_CONFIG['A1'];
      currency = 'LKR';
    } else {
      amount = LEVEL_PAYMENT_CONFIG[level] ?? LEVEL_PAYMENT_CONFIG['A1'];
    }

    return {
      studentId: row.studentId._id,
      name: row.studentId.name,
      level: row.studentId.level || '—',
      currency,
      amount,
      totalPaid: row.totalPaid ?? 0,
    };
  }

  balanceHint(row: BulkLanguageEditRow): number {
    return Math.max(0, row.amount - row.totalPaid);
  }

  togglePreview(): void {
    this.previewMode = !this.previewMode;
  }

  fmt(n: number): string {
    return (n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  close(ok: boolean): void {
    this.dialogRef.close(ok);
  }

  applyPayments(): void {
    if (!this.sharedPaymentDate) {
      this.snack.open('Choose a payment date', 'Dismiss', { duration: 3500 });
      return;
    }
    for (const r of this.editRows) {
      if (!r.amount || r.amount <= 0) {
        this.snack.open(`Invalid amount for ${r.name}`, 'Dismiss', { duration: 4000 });
        return;
      }
    }

    const iso = this.sharedPaymentDate.toISOString();
    const remark = this.sharedRemarks.trim() || 'Bulk language fee — balance cleared';
    const rows: BulkLegacyLanguageRow[] = this.editRows.map((r) => ({
      studentId: r.studentId,
      totalCourseFee: r.amount,
      amountPaid: r.amount,
      currency: r.currency,
      paymentDate: iso,
      remarks: remark,
    }));

    this.saving = true;
    this.api.mapLegacyBulkLanguagePaid({ rows }).subscribe({
      next: (res) => {
        this.saving = false;
        const { succeeded, failed } = res.data;
        if (failed?.length) {
          this.snack.open(`${res.message} Check console for details.`, 'Dismiss', { duration: 8000 });
          console.warn('[Bulk language paid] failures', failed);
        } else {
          this.snack.open(res.message || 'Payments recorded.', 'OK', { duration: 5000 });
        }
        this.close(true);
      },
      error: (err: unknown) => {
        this.saving = false;
        const http = err as { error?: { message?: string; msg?: string }; message?: string; status?: number };
        const msg =
          http?.error?.message ||
          http?.error?.msg ||
          (typeof http?.status === 'number' ? `Request failed (${http.status})` : '') ||
          http?.message ||
          'Bulk save failed';
        this.snack.open(msg, 'Dismiss', { duration: 8000 });
      },
    });
  }
}
