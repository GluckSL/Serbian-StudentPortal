import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { SignupPendingApplication } from './payment-hub-api.service';

export interface SignupApprovalEditDialogData {
  application: SignupPendingApplication;
  defaultBatch?: string;
}

export interface SignupApprovalEditResult {
  level?: string;
  subscription?: string;
  currency?: string;
  amount?: number;
  proofPaidAmount?: number;
  proofPaymentDateTime?: string;
  proofAccountHolderName?: string;
  batch?: string;
}

@Component({
  selector: 'app-signup-approval-edit-dialog',
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
  ],
  templateUrl: './signup-approval-edit-dialog.component.html',
  styleUrls: ['./payment-approval-decision-dialog.component.scss'],
})
export class SignupApprovalEditDialogComponent {
  batch = '';
  level = '';
  subscription = '';
  currency = 'LKR';
  quotedFee: number | null = null;
  declaredPaid: number | null = null;
  paymentDate = '';
  accountHolderName = '';
  validationError = '';

  readonly levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly currencies = ['LKR', 'INR', 'USD'];
  readonly plans = [
    { value: 'SILVER', label: 'Silver' },
    { value: 'PLATINUM', label: 'Platinum' },
    { value: 'DOCS_RECOGNITION', label: 'Docs recognition' },
    { value: 'VISA_DOC', label: 'Visa doc' },
    { value: 'POST_LANDING', label: 'Post landing' },
    { value: 'VISA_DOC_ONLY', label: 'Visa Doc Only' },
  ];

  constructor(
    private readonly dialogRef: MatDialogRef<SignupApprovalEditDialogComponent, SignupApprovalEditResult | undefined>,
    @Inject(MAT_DIALOG_DATA) private readonly data: SignupApprovalEditDialogData,
  ) {
    const app = data.application;
    this.batch = (data.defaultBatch || '').trim();
    this.level = app.level || '';
    this.subscription = app.subscription || '';
    this.currency = app.currency || 'LKR';
    this.quotedFee = app.amount ?? null;
    this.declaredPaid = app.proofPaidAmount ?? app.amount ?? null;
    this.accountHolderName = app.proofAccountHolderName || app.name || '';
    this.paymentDate = this.toDatetimeLocal(app.proofPaymentDateTime);
  }

  get studentName(): string {
    return this.data.application?.name || '';
  }

  get studentEmail(): string {
    return this.data.application?.email || '';
  }

  private toDatetimeLocal(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }

  save(): void {
    this.validationError = '';
    const quoted = Number(this.quotedFee);
    const paid = Number(this.declaredPaid);
    if (!this.level) {
      this.validationError = 'Molimo izaberite nivo.';
      return;
    }
    if (!this.subscription) {
      this.validationError = 'Molimo izaberite plan.';
      return;
    }
    if (!Number.isFinite(quoted) || quoted <= 0) {
      this.validationError = 'Navedena naknada za kurs mora biti veća od nule.';
      return;
    }
    if (!Number.isFinite(paid) || paid <= 0) {
      this.validationError = 'Plaćeni iznos mora biti veći od nule.';
      return;
    }
    if (!this.accountHolderName.trim()) {
      this.validationError = 'Ime vlasnika računa je obavezno.';
      return;
    }

    let proofPaymentDateTime: string | undefined;
    if (this.paymentDate) {
      const d = new Date(this.paymentDate);
      if (!Number.isNaN(d.getTime())) {
        proofPaymentDateTime = d.toISOString();
      }
    }

    this.dialogRef.close({
      level: this.level,
      subscription: this.subscription,
      currency: this.currency,
      amount: quoted,
      proofPaidAmount: paid,
      proofPaymentDateTime,
      proofAccountHolderName: this.accountHolderName.trim(),
      batch: this.batch.trim() || undefined,
    });
  }
}
