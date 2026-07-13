import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PaymentHubApiService, InstallmentRow } from './payment-hub-api.service';

export interface InstallmentScheduleEditData {
  requestId: string;
  currency: string;
  parentAmount: number;
  installments: InstallmentRow[];
}

interface EditableRow {
  installmentNumber: number;
  requestedAmount: number;
  dueDate: Date | null;
}

@Component({
  selector: 'app-installment-schedule-edit-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>edit_calendar</mat-icon>
      Edit instalment schedule
    </h2>
    <mat-dialog-content class="isd-body">
      <p class="isd-hint">
        Amounts must still add up to <strong>{{ data.currency }} {{ fmt(data.parentAmount) }}</strong>.
        You can only change this when there are no payment proofs in progress (only rejected proofs are OK).
      </p>
      <div class="isd-rows">
        <div *ngFor="let row of rows" class="isd-row">
          <span class="isd-part">Part {{ row.installmentNumber }}</span>
          <mat-form-field appearance="outline" class="isd-amt">
            <mat-label>Amount</mat-label>
            <input matInput type="number" min="1" [(ngModel)]="row.requestedAmount" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="isd-due">
            <mat-label>Due date</mat-label>
            <input matInput [matDatepicker]="dp" [(ngModel)]="row.dueDate" />
            <mat-datepicker-toggle matSuffix [for]="dp"></mat-datepicker-toggle>
            <mat-datepicker #dp></mat-datepicker>
          </mat-form-field>
        </div>
      </div>
      <p class="isd-sum" [class.isd-sum-bad]="!sumOk">Sum: {{ data.currency }} {{ fmt(sumAmount) }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="cancel()">Cancel</button>
      <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="saveDisabled">
        <mat-spinner *ngIf="saving" diameter="18"></mat-spinner>
        <span *ngIf="!saving">Save</span>
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2[mat-dialog-title] { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 1.1rem; }
    h2 mat-icon { color: #1565c0; }
    .isd-body { min-width: 320px; max-width: 520px; }
    .isd-hint { font-size: 13px; color: #616161; margin: 0 0 16px; line-height: 1.45; }
    .isd-rows { display: flex; flex-direction: column; gap: 12px; }
    .isd-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #eee; }
    .isd-part { font-weight: 700; color: #37474f; min-width: 72px; }
    .isd-amt { width: 140px; margin: 0; }
    .isd-due { flex: 1; min-width: 200px; margin: 0; }
    .isd-sum { font-size: 13px; font-weight: 600; margin: 12px 0 0; }
    .isd-sum-bad { color: #c62828; }
    mat-spinner { display: inline-block; vertical-align: middle; margin-right: 6px; }
  `],
})
export class InstallmentScheduleEditDialogComponent {
  rows: EditableRow[];
  saving = false;

  constructor(
    private readonly dialogRef: MatDialogRef<InstallmentScheduleEditDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) readonly data: InstallmentScheduleEditData,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {
    const sorted = [...(data.installments || [])].sort((a, b) => a.installmentNumber - b.installmentNumber);
    this.rows = sorted.map((i) => ({
      installmentNumber: i.installmentNumber,
      requestedAmount: i.requestedAmount,
      dueDate: i.dueDate ? new Date(i.dueDate) : null,
    }));
  }

  get sumAmount(): number {
    return this.rows.reduce((s, r) => s + (Number(r.requestedAmount) || 0), 0);
  }

  get sumOk(): boolean {
    return Math.abs(this.sumAmount - Number(this.data.parentAmount)) < 0.02;
  }

  get saveDisabled(): boolean {
    return this.saving || !this.sumOk || this.rows.some((r) => !r.dueDate);
  }

  fmt(v: number): string {
    return (v ?? 0).toLocaleString('en-IN');
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  save(): void {
    if (!this.sumOk || this.rows.some(r => !r.dueDate)) return;
    this.saving = true;
    const body = {
      installments: this.rows.map((r) => ({
        installmentNumber: r.installmentNumber,
        requestedAmount: Number(r.requestedAmount),
        dueDate: r.dueDate!.toISOString(),
      })),
    };
    this.api.updateInstallmentSchedule(this.data.requestId, body).subscribe({
      next: () => {
        this.saving = false;
        this.dialogRef.close(true);
      },
      error: (e) => {
        this.saving = false;
        this.snack.open(e?.error?.message || 'Save failed', 'Dismiss', { duration: 6000 });
      },
    });
  }
}
