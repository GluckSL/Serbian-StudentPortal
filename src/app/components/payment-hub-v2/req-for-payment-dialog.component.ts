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
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PaymentHubApiService } from './payment-hub-api.service';

interface DialogData {
  studentId: string;
  studentName?: string;
}

interface InstallmentRow {
  amount: number | null;
  dueDate: Date | null;
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
    MatTabsModule,
    MatTooltipModule,
  ],
  template: `
<h2 mat-dialog-title>
  <mat-icon>send</mat-icon>
  Zatraži plaćanje
  <span *ngIf="data.studentName" class="student-name-chip">{{ data.studentName }}</span>
</h2>

<mat-dialog-content>
  <!-- Mode tabs -->
  <div class="mode-tabs">
    <button type="button" class="mode-tab" [class.active]="!installmentMode" (click)="installmentMode = false">
      <mat-icon>payments</mat-icon>Jednokratno plaćanje
    </button>
    <button type="button" class="mode-tab" [class.active]="installmentMode" (click)="setInstallmentMode(true)">
      <mat-icon>date_range</mat-icon>Plan rata
    </button>
  </div>

  <!-- Shared top fields -->
  <div class="form-grid">
    <mat-form-field appearance="outline" *ngIf="!installmentMode">
      <mat-label>Iznos</mat-label>
      <input matInput type="number" [(ngModel)]="amount" placeholder="npr. 35000" min="1" />
    </mat-form-field>

    <mat-form-field appearance="outline" *ngIf="!installmentMode">
      <mat-label>Rok</mat-label>
      <input matInput [matDatepicker]="singlePicker" [(ngModel)]="singleDueDate" />
      <mat-datepicker-toggle matSuffix [for]="singlePicker"></mat-datepicker-toggle>
      <mat-datepicker #singlePicker></mat-datepicker>
    </mat-form-field>

    <mat-form-field appearance="outline">
      <mat-label>Valuta</mat-label>
      <mat-select [(ngModel)]="currency">
        <mat-option value="LKR">LKR</mat-option>
        <mat-option value="INR">INR</mat-option>
        <mat-option value="USD">EURO</mat-option>
      </mat-select>
    </mat-form-field>

    <mat-form-field appearance="outline">
      <mat-label>Vrsta plaćanja</mat-label>
      <mat-select [(ngModel)]="paymentType">
        <mat-option value="Monthly Fee">Mesečna naknada</mat-option>
        <mat-option value="Registration">Registracija</mat-option>
        <mat-option value="Exam Fee">Naknada za ispit</mat-option>
        <mat-option value="Custom">Prilagođeno</mat-option>
        <mat-option value="Other">Ostalo</mat-option>
      </mat-select>
    </mat-form-field>

    <mat-form-field appearance="outline" *ngIf="paymentType === 'Custom'" class="span-two">
      <mat-label>Prilagođena oznaka</mat-label>
      <input matInput [(ngModel)]="customType" placeholder="npr. Depozit za knjige" />
    </mat-form-field>
  </div>

  <!-- Installment rows -->
  <ng-container *ngIf="installmentMode">
    <div class="inst-header">
      <span class="inst-title">Raspored rata</span>
      <span class="inst-total" [class.inst-total--ok]="installmentTotal > 0">
      Ukupno: {{ currency === 'USD' ? 'EURO' : currency }} {{ installmentTotal | number:'1.0-2' }}
      </span>
    </div>

    <div class="inst-row" *ngFor="let row of installmentRows; let i = index">
      <span class="inst-num">{{ i + 1 }}</span>

      <mat-form-field appearance="outline" class="inst-amount">
        <mat-label>Iznos</mat-label>
        <input matInput type="number" [(ngModel)]="row.amount" min="1"
               (ngModelChange)="onInstallmentChange()" placeholder="0" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="inst-date">
        <mat-label>Rok</mat-label>
        <input matInput [matDatepicker]="ip" [(ngModel)]="row.dueDate" />
        <mat-datepicker-toggle matSuffix [for]="ip"></mat-datepicker-toggle>
        <mat-datepicker #ip></mat-datepicker>
      </mat-form-field>

      <button mat-icon-button type="button" color="warn" class="inst-remove"
              [disabled]="installmentRows.length <= 1"
              (click)="removeRow(i)" matTooltip="Ukloni">
        <mat-icon>remove_circle_outline</mat-icon>
      </button>
    </div>

    <button mat-stroked-button type="button" class="add-row-btn" (click)="addRow()">
      <mat-icon>add</mat-icon>Dodaj ratu
    </button>
  </ng-container>

  <mat-form-field appearance="outline" class="full-width">
    <mat-label>Opis / Svrha</mat-label>
    <textarea matInput rows="3" [(ngModel)]="remarks"
      placeholder="Za šta je ovo plaćanje? Ovo će biti prikazano učeniku podebljano i istaknuto."></textarea>
  </mat-form-field>

  <mat-slide-toggle [(ngModel)]="notificationToggle" color="primary" style="margin-top:4px;">
    Pošalji email obaveštenje učeniku
  </mat-slide-toggle>
</mat-dialog-content>

<mat-dialog-actions align="end">
  <button mat-stroked-button [mat-dialog-close]="false">Otkaži</button>
  <button mat-flat-button color="primary" (click)="send()" [disabled]="sending">
    <mat-spinner *ngIf="sending" diameter="14" style="display:inline-block;margin-right:6px;"></mat-spinner>
    <mat-icon *ngIf="!sending">send</mat-icon>
    {{ sending ? 'Slanje…' : (installmentMode ? 'Zakaži ' + installmentRows.length + ' ratu/e' : 'Pošalji zahtev') }}
  </button>
</mat-dialog-actions>
  `,
  styles: [`
    h2[mat-dialog-title] { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; color: #1a237e; }
    .student-name-chip { background: #e8f0fe; color: #1a73e8; border-radius: 20px; padding: 2px 10px; font-size: 13px; font-weight: 600; }
    mat-dialog-content { min-width: 480px; padding-top: 8px; }

    /* Mode tabs */
    .mode-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
    .mode-tab {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 8px; border: 1.5px solid #e0e0e0;
      background: #fafafa; color: #616161; font-size: 14px; font-weight: 500;
      cursor: pointer; transition: all 0.15s;
      mat-icon { font-size: 18px; height: 18px; width: 18px; }
    }
    .mode-tab:hover { border-color: #1976d2; color: #1976d2; }
    .mode-tab.active { border-color: #1976d2; background: #e3f2fd; color: #1565c0; font-weight: 600; }

    /* Shared grid */
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .span-two { grid-column: 1 / -1; }
    .full-width { width: 100%; }

    /* Installment rows */
    .inst-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .inst-title { font-size: 13px; font-weight: 600; color: #424242; }
    .inst-total { font-size: 13px; font-weight: 600; color: #9e9e9e; }
    .inst-total--ok { color: #2e7d32; }
    .inst-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .inst-num { width: 22px; text-align: center; font-size: 13px; font-weight: 700; color: #1565c0; flex-shrink: 0; }
    .inst-amount { flex: 1; min-width: 0; }
    .inst-date { flex: 1.4; min-width: 0; }
    .inst-remove { flex-shrink: 0; }
    .add-row-btn { margin-bottom: 16px; width: 100%; }
  `],
})
export class ReqForPaymentDialogComponent {
  installmentMode = false;

  // Single-payment fields
  amount: number | null = null;
  singleDueDate: Date | null = null;

  // Installment rows
  installmentRows: InstallmentRow[] = [
    { amount: null, dueDate: null },
    { amount: null, dueDate: null },
  ];

  // Shared fields
  currency = 'LKR';
  paymentType = 'Monthly Fee';
  customType = '';
  remarks = '';
  notificationToggle = true;
  sending = false;

  constructor(
    public readonly dialogRef: MatDialogRef<ReqForPaymentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: DialogData,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {}

  setInstallmentMode(on: boolean): void {
    this.installmentMode = on;
  }

  get installmentTotal(): number {
    return this.installmentRows.reduce((s, r) => s + (r.amount ?? 0), 0);
  }

  addRow(): void {
    this.installmentRows = [...this.installmentRows, { amount: null, dueDate: null }];
  }

  removeRow(i: number): void {
    if (this.installmentRows.length <= 1) return;
    this.installmentRows = this.installmentRows.filter((_, idx) => idx !== i);
  }

  onInstallmentChange(): void {
    // trigger getter recalculation — nothing else needed with ngModel
  }

  send(): void {
    if (this.installmentMode) {
      this.sendInstallmentPlan();
    } else {
      this.sendSingle();
    }
  }

  private sendSingle(): void {
    if (!this.amount || this.amount <= 0) {
      this.snack.open('Unesite važeći iznos', 'OK', { duration: 3000 });
      return;
    }
    if (!this.singleDueDate) {
      this.snack.open('Izaberite rok', 'OK', { duration: 3000 });
      return;
    }
    if (this.paymentType === 'Custom' && !this.customType.trim()) {
      this.snack.open('Unesite prilagođenu oznaku', 'OK', { duration: 3000 });
      return;
    }

    this.sending = true;
    this.api.createBulkRequest({
      studentIds: [this.data.studentId],
      amount: this.amount,
      currency: this.currency,
      paymentType: this.paymentType,
      customType: this.paymentType === 'Custom' ? this.customType : undefined,
      dueDate: this.singleDueDate.toISOString(),
      remarks: this.remarks || undefined,
      notificationToggle: this.notificationToggle,
    }).subscribe({
      next: () => {
        this.sending = false;
        this.snack.open('Zahtev za plaćanje poslat!', 'OK', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: (e) => {
        this.sending = false;
        this.snack.open(e?.error?.message || 'Nije uspelo slanje zahteva', 'Zatvori', { duration: 5000 });
      },
    });
  }

  private sendInstallmentPlan(): void {
    // Validate each row
    for (let i = 0; i < this.installmentRows.length; i++) {
      const r = this.installmentRows[i];
      if (!r.amount || r.amount <= 0) {
        this.snack.open(`Rata ${i + 1}: unesite važeći iznos`, 'OK', { duration: 3000 });
        return;
      }
      if (!r.dueDate) {
        this.snack.open(`Rata ${i + 1}: izaberite rok`, 'OK', { duration: 3000 });
        return;
      }
    }
    if (this.paymentType === 'Custom' && !this.customType.trim()) {
      this.snack.open('Unesite prilagođenu oznaku', 'OK', { duration: 3000 });
      return;
    }

    const total = this.installmentTotal;
    const scheduledInstallments = this.installmentRows.map((r) => ({
      amount: r.amount as number,
      dueDate: (r.dueDate as Date).toISOString(),
    }));

    this.sending = true;
    this.api.createBulkRequest({
      studentIds: [this.data.studentId],
      amount: total,
      currency: this.currency,
      paymentType: this.paymentType,
      customType: this.paymentType === 'Custom' ? this.customType : undefined,
      dueDate: scheduledInstallments[0].dueDate,
      remarks: this.remarks || undefined,
      installmentAllowed: true,
      scheduledInstallments,
      notificationToggle: this.notificationToggle,
    }).subscribe({
      next: () => {
        this.sending = false;
        this.snack.open(`Plan rata kreiran (${scheduledInstallments.length} plaćanja)!`, 'OK', { duration: 4000 });
        this.dialogRef.close(true);
      },
      error: (e) => {
        this.sending = false;
        this.snack.open(e?.error?.message || 'Nije uspelo kreiranje plana rata', 'Zatvori', { duration: 5000 });
      },
    });
  }
}
