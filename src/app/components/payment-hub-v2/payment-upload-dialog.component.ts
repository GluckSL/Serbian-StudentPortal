import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { PaymentRequestItem as PaymentRequest } from './payment-hub-api.service';

export interface UploadDialogData {
  request: PaymentRequest;
  installmentNumber?: number;
  suggestedAmount?: number;
  suggestedDueDate?: string;
}

@Component({
  selector: 'app-payment-upload-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
  ],
  template: `
    <div class="ud-dialog">
      <h2 class="ud-title">
        <mat-icon>upload_file</mat-icon>
        Otpremi dokaz o uplati
      </h2>
      <p class="ud-subtitle">
        {{ paymentTypeLabel(data.request.paymentType) }}<span *ngIf="data.request.customType"> — {{ data.request.customType }}</span>
        &bull; {{ data.request.currency }} {{ fmt(data.installmentNumber ? (data.suggestedAmount ?? data.request.amount) : data.request.amount) }}
        <ng-container *ngIf="data.installmentNumber">
          &bull; Rata {{ data.installmentNumber }}<ng-container *ngIf="data.request.totalInstallments"> od {{ data.request.totalInstallments }}</ng-container>
        </ng-container>
        &bull; Rok {{ fmtDate(data.installmentNumber && data.suggestedDueDate ? data.suggestedDueDate : data.request.dueDate) }}
      </p>

      <label class="ud-file-zone" [class.ud-file-selected]="selectedFile" for="paymentProofFile" (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
        <input id="paymentProofFile" type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,application/pdf,.pdf,image/*" (change)="onFileSelect($event)" class="ud-file-input-offscreen" />
        <mat-icon class="ud-file-icon">{{ selectedFile ? 'check_circle' : 'cloud_upload' }}</mat-icon>
        <div *ngIf="!selectedFile">
          <div class="ud-file-label">Kliknite ili prevucite dokaz o uplati</div>
          <div class="ud-file-hint">JPG, PNG, HEIC, PDF — najviše 15 MB</div>
        </div>
        <div *ngIf="selectedFile" class="ud-file-name">
          {{ selectedFile.name }} ({{ (selectedFile.size / 1024).toFixed(0) }} KB)
        </div>
      </label>

      <div class="ud-form-row">
        <mat-form-field appearance="outline" class="ud-field">
          <mat-label>Ukupan plaćeni iznos</mat-label>
          <input matInput type="number" [(ngModel)]="paidAmount" min="1" required />
          <mat-hint>Unesite iznos koji ste stvarno uplatili (može delimično)</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="ud-field">
          <mat-label>Valuta</mat-label>
          <mat-select [(ngModel)]="currency">
            <mat-option value="LKR">LKR</mat-option>
            <mat-option value="INR">INR</mat-option>
            <mat-option value="USD">EURO</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <div class="ud-form-row">
        <mat-form-field appearance="outline" class="ud-field">
          <mat-label>Datum i vreme uplate</mat-label>
          <input matInput type="datetime-local" [(ngModel)]="paymentDateTimeLocal" required />
        </mat-form-field>

        <mat-form-field appearance="outline" class="ud-field">
          <mat-label>Ime vlasnika računa</mat-label>
          <input matInput [(ngModel)]="accountHolderName" placeholder="Ime na bankovnom računu / UPI nalogu" required />
        </mat-form-field>
      </div>

      <div class="ud-field-block" (click)="$event.stopPropagation()">
        <label class="ud-native-label" for="udPayMethod">Način plaćanja</label>
        <select id="udPayMethod" class="ud-native-select" name="paymentMethod" [(ngModel)]="paymentMethod">
          <option value="Bank Transfer">Bankovni prenos</option>
          <option value="UPI">UPI</option>
          <option value="Cash">Gotovina</option>
          <option value="Card">Kartica</option>
          <option value="Other">Ostalo</option>
        </select>
        <span class="ud-native-hint">Izaberite način plaćanja.</span>
      </div>

      <mat-form-field appearance="outline" class="ud-full">
        <mat-label>Identifikator transakcije (opcionalno)</mat-label>
        <input matInput [(ngModel)]="transactionId" placeholder="npr. UTR / referentni broj" />
      </mat-form-field>

      <div class="ud-actions">
        <button mat-button type="button" (click)="cancel()">Otkaži</button>
        <button mat-flat-button color="primary" type="button" (click)="submit()" [disabled]="submitting || !selectedFile || !canSubmit">
          {{ submitting ? 'Otpremanje...' : 'Pošalji uplatu' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .ud-dialog {
      padding: 4px 8px 8px;
    }
    .ud-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 4px;
      color: #212121;
      mat-icon { color: #1565c0; }
    }
    .ud-subtitle {
      font-size: 13px;
      color: #757575;
      margin: 0 0 16px;
    }
    .ud-file-zone {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 2px dashed #bdbdbd;
      border-radius: 8px;
      padding: 24px;
      cursor: pointer;
      margin-bottom: 16px;
      background: #fafafa;
      transition: border-color 0.2s, background 0.2s;
      &:hover { border-color: #1565c0; background: #f0f4ff; }
      &.ud-file-selected { border-color: #4caf50; background: #f1f8e9; }
    }
    .ud-file-input-offscreen {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
      opacity: 0;
    }
    .ud-file-icon {
      font-size: 40px; height: 40px; width: 40px;
      color: #9e9e9e;
      .ud-file-selected & { color: #4caf50; }
    }
    .ud-file-label { font-size: 14px; font-weight: 500; color: #424242; }
    .ud-file-hint { font-size: 12px; color: #9e9e9e; }
    .ud-file-name { font-size: 13px; font-weight: 500; color: #2e7d32; }
    .ud-form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 0;
    }
    .ud-field { width: 100%; }
    .ud-full { width: 100%; }
    .ud-field-block {
      width: 100%;
      margin-bottom: 12px;
    }
    .ud-native-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: rgba(0,0,0,0.6);
      margin-bottom: 6px;
    }
    .ud-native-select {
      width: 100%;
      box-sizing: border-box;
      font-size: 15px;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid rgba(0,0,0,0.23);
      background: #fff;
      color: #212121;
      cursor: pointer;
      outline: none;
      transition: border-color 0.2s;
    }
    .ud-native-select:focus {
      border-color: #1976d2;
      box-shadow: 0 0 0 1px #1976d2;
    }
    .ud-native-hint {
      display: block;
      font-size: 11px;
      color: #9e9e9e;
      margin-top: 4px;
    }
    .ud-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
    }
  `],
})
export class PaymentUploadDialogComponent {
  selectedFile: File | null = null;
  paidAmount: number;
  currency: string;
  paymentMethod = 'Bank Transfer';
  transactionId = '';
  paymentDateTimeLocal = '';
  accountHolderName = '';
  submitting = false;

  constructor(
    private readonly dialogRef: MatDialogRef<PaymentUploadDialogComponent, FormData | null>,
    @Inject(MAT_DIALOG_DATA) readonly data: UploadDialogData,
  ) {
    this.paidAmount = data.suggestedAmount ?? data.request.amount;
    this.currency = data.request.currency || 'LKR';
  }

  private static readonly PROOF_MAX_BYTES = 15 * 1024 * 1024;
  private static readonly PROOF_EXT = /\.(jpe?g|png|gif|webp|heic|heif|pdf)$/i;

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    const extOk = PaymentUploadDialogComponent.PROOF_EXT.test(name);
    const typeOk =
      /^image\/(jpeg|jpg|png|gif|webp|heic|heif)/.test(type) ||
      type === 'application/pdf' ||
      (!type && extOk);
    if ((!extOk && !typeOk) || file.size > PaymentUploadDialogComponent.PROOF_MAX_BYTES) {
      this.selectedFile = null;
      input.value = '';
      return;
    }
    this.selectedFile = file;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) this.selectedFile = file;
  }

  get canSubmit(): boolean {
    return Boolean(
      this.selectedFile &&
      this.paidAmount > 0 &&
      this.paymentDateTimeLocal &&
      this.accountHolderName.trim().length >= 2,
    );
  }

  submit(): void {
    if (!this.canSubmit) return;
    const payDt = new Date(this.paymentDateTimeLocal);
    if (Number.isNaN(payDt.getTime())) return;
    const fd = new FormData();
    fd.append('paymentRequestId', String(this.data.request._id));
    fd.append('screenshot', this.selectedFile!);
    fd.append('paidAmount', String(this.paidAmount));
    fd.append('currency', this.currency);
    fd.append('paymentMethod', this.paymentMethod);
    fd.append('paymentDateTime', payDt.toISOString());
    fd.append('accountHolderName', this.accountHolderName.trim());
    if (this.transactionId) fd.append('transactionId', this.transactionId);
    if (this.data.installmentNumber != null) {
      fd.append('installmentNumber', String(this.data.installmentNumber));
    }
    this.dialogRef.close(fd);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  fmt(val: number): string {
    return val?.toLocaleString('en-IN') ?? '0';
  }

  paymentTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      LANGUAGE_FEE: 'Naknada za kurs jezika',
      DOCS_PAYMENT: 'Plaćanje dokumentacije',
      VISA_PAYMENT: 'Plaćanje vize',
      CUSTOM_PAYMENT: 'Drugo plaćanje',
    };
    return labels[type] || type;
  }

  fmtDate(d: string | undefined | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('sr-Latn-RS', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
