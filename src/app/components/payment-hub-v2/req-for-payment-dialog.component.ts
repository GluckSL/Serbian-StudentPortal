import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PaymentHubApiService } from './payment-hub-api.service';

interface DialogData {
  studentId: string;
  studentName?: string;
}

@Component({
  selector: 'app-req-for-payment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatIconModule,
    MatSnackBarModule,
  ],
  template: `
<h2 mat-dialog-title>
  <mat-icon>send</mat-icon>
  Request Payment
  <span *ngIf="data.studentName" class="student-name-chip">{{ data.studentName }}</span>
</h2>

<mat-dialog-content>
  <div class="form-grid">
    <mat-form-field appearance="outline">
      <mat-label>Amount</mat-label>
      <input matInput type="number" [(ngModel)]="amount" placeholder="e.g. 35000" />
    </mat-form-field>

    <mat-form-field appearance="outline">
      <mat-label>Currency</mat-label>
      <mat-select [(ngModel)]="currency">
        <mat-option value="LKR">LKR</mat-option>
        <mat-option value="INR">INR</mat-option>
        <mat-option value="USD">USD</mat-option>
      </mat-select>
    </mat-form-field>

    <mat-form-field appearance="outline">
      <mat-label>Payment Type</mat-label>
      <mat-select [(ngModel)]="paymentType">
        <mat-option value="Monthly Fee">Monthly Fee</mat-option>
        <mat-option value="Registration">Registration</mat-option>
        <mat-option value="Exam Fee">Exam Fee</mat-option>
        <mat-option value="Custom">Custom</mat-option>
        <mat-option value="Other">Other</mat-option>
      </mat-select>
    </mat-form-field>

    <mat-form-field appearance="outline" *ngIf="paymentType === 'Custom'">
      <mat-label>Custom Label</mat-label>
      <input matInput [(ngModel)]="customType" placeholder="e.g. Book Deposit" />
    </mat-form-field>

    <mat-form-field appearance="outline">
      <mat-label>Due Date</mat-label>
      <input matInput [matDatepicker]="picker" [(ngModel)]="dueDate" />
      <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
      <mat-datepicker #picker></mat-datepicker>
    </mat-form-field>
  </div>

  <mat-form-field appearance="outline" class="full-width">
    <mat-label>Description / Purpose</mat-label>
    <textarea matInput rows="3" [(ngModel)]="remarks"
      placeholder="What is this payment for? This will be shown to the student in bold and highlighted."></textarea>
  </mat-form-field>

  <mat-slide-toggle [(ngModel)]="notificationToggle" color="primary" style="margin-top:4px;">
    Send Email Notification to Student
  </mat-slide-toggle>
</mat-dialog-content>

<mat-dialog-actions align="end">
  <button mat-stroked-button [mat-dialog-close]="false">Cancel</button>
  <button mat-flat-button color="primary" (click)="send()" [disabled]="sending">
    <mat-spinner *ngIf="sending" diameter="14" style="display:inline-block;margin-right:6px;"></mat-spinner>
    <mat-icon *ngIf="!sending">send</mat-icon>
    {{ sending ? 'Sending…' : 'Send Request' }}
  </button>
</mat-dialog-actions>
  `,
  styles: [`
    h2[mat-dialog-title] { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; color: #1a237e; }
    .student-name-chip { background: #e8f0fe; color: #1a73e8; border-radius: 20px; padding: 2px 10px; font-size: 13px; font-weight: 600; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .full-width { width: 100%; }
    mat-dialog-content { min-width: 440px; padding-top: 8px; }
  `],
})
export class ReqForPaymentDialogComponent {
  amount: number | null = null;
  currency = 'LKR';
  paymentType = 'Monthly Fee';
  customType = '';
  dueDate: Date | null = null;
  remarks = '';
  notificationToggle = true;
  sending = false;

  constructor(
    public readonly dialogRef: MatDialogRef<ReqForPaymentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: DialogData,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {}

  send(): void {
    if (!this.amount || this.amount <= 0) {
      this.snack.open('Enter a valid amount', 'OK', { duration: 3000 });
      return;
    }
    if (!this.dueDate) {
      this.snack.open('Select a due date', 'OK', { duration: 3000 });
      return;
    }
    if (this.paymentType === 'Custom' && !this.customType.trim()) {
      this.snack.open('Enter a custom label', 'OK', { duration: 3000 });
      return;
    }

    this.sending = true;
    this.api.createBulkRequest({
      studentIds: [this.data.studentId],
      amount: this.amount,
      currency: this.currency,
      paymentType: this.paymentType,
      customType: this.paymentType === 'Custom' ? this.customType : undefined,
      dueDate: this.dueDate.toISOString(),
      remarks: this.remarks || undefined,
      notificationToggle: this.notificationToggle,
    }).subscribe({
      next: () => {
        this.sending = false;
        this.snack.open('Payment request sent!', 'OK', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: (e) => {
        this.sending = false;
        this.snack.open(e?.error?.message || 'Failed to send request', 'Dismiss', { duration: 5000 });
      },
    });
  }
}
