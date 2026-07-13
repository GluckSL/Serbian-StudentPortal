import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormControl, FormGroup, FormArray, Validators, AbstractControl } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import {
  PaymentHubApiService,
  StudentTableRow,
  MapLegacyPaymentsBody,
  LegacyLineItem,
  LegacyCustomPayment,
} from './payment-hub-api.service';
import { LEVEL_PAYMENT_CONFIG } from './level-payment-config';

@Component({
  selector: 'app-payment-legacy-mapper-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatIconModule,
    MatSnackBarModule,
    MatAutocompleteModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatCardModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './payment-legacy-mapper-dialog.component.html',
  styleUrls: ['./payment-legacy-mapper-dialog.component.scss'],
})
export class PaymentLegacyMapperDialogComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  // Student lookup (initialized in constructor — FormBuilder must run after DI)
  studentSearchCtrl!: FormControl<string | StudentTableRow | null>;
  studentOptions: StudentTableRow[] = [];
  searchingStudents = false;
  selectedStudent: StudentTableRow | null = null;

  // Level config
  readonly levelConfig = LEVEL_PAYMENT_CONFIG;
  readonly currencies = ['LKR', 'INR', 'USD'];

  // Expansion state
  docsExpanded = false;
  visaExpanded = false;
  customExpanded = false;

  // Forms
  languageForm: FormGroup;
  docsArray: FormArray;
  visaArray: FormArray;
  customArray: FormArray;

  saving = false;
  showSummary = false;
  loadingCatalog = false;

  constructor(
    private readonly dialogRef: MatDialogRef<PaymentLegacyMapperDialogComponent>,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
    private readonly fb: FormBuilder,
  ) {
    this.studentSearchCtrl = this.fb.control<string | StudentTableRow | null>('');
    this.languageForm = this.fb.group({
      totalCourseFee: [0, [Validators.required, Validators.min(1)]],
      amountPaid:     [0, [Validators.required, Validators.min(1)]],
      balance:        [{ value: 0, disabled: true }],
      currency:       ['LKR', Validators.required],
      paymentDate:    [null, Validators.required],
      remarks:        [''],
      markFullyPaid:  [false],
    });

    this.docsArray   = this.fb.array([]);
    this.visaArray   = this.fb.array([]);
    this.customArray = this.fb.array([]);
  }

  ngOnInit(): void {
    // Autocomplete: debounce search
    this.studentSearchCtrl.valueChanges.pipe(
      debounceTime(350),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe((val) => {
      if (typeof val === 'string' && val.trim().length >= 2) {
        this.searchStudents(val.trim());
      } else if (!val) {
        this.studentOptions = [];
      }
    });

    // Language: auto-recalculate balance
    this.languageForm.get('totalCourseFee')!.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => this.recalcBalance());
    this.languageForm.get('amountPaid')!.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => this.recalcBalance());
    this.languageForm.get('markFullyPaid')!.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((checked) => {
      if (checked) {
        const fee = Number(this.languageForm.get('totalCourseFee')!.value) || 0;
        this.languageForm.get('amountPaid')!.setValue(fee, { emitEvent: false });
        this.languageForm.get('balance')!.setValue(0);
      } else {
        this.recalcBalance();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Student search ─────────────────────────────────────────────────────────

  private searchStudents(q: string): void {
    this.searchingStudents = true;
    this.api.getStudentTable({ search: q, limit: 12, page: 1 }).subscribe({
      next: (res) => {
        this.studentOptions = res.data || [];
        this.searchingStudents = false;
      },
      error: () => { this.searchingStudents = false; },
    });
  }

  displayFn(row: StudentTableRow | string | null): string {
    if (!row) return '';
    if (typeof row === 'string') return row;
    const s = row.studentId;
    return s ? `${s.name} — ${s.email}` : '';
  }

  /** Template-safe: control value may be plain string while typing or a row after pick. */
  get studentSearchTextLength(): number {
    const v = this.studentSearchCtrl.value;
    return typeof v === 'string' ? v.length : 0;
  }

  onStudentSelected(row: StudentTableRow): void {
    this.selectedStudent = row;
    this.prefillLevelFee(row);
  }

  clearStudent(): void {
    this.selectedStudent = null;
    this.studentSearchCtrl.setValue('');
    this.studentOptions = [];
  }

  private prefillLevelFee(row: StudentTableRow): void {
    const level = (row.studentId.level || '').toUpperCase().trim();
    if (!level) return;

    // Try catalog first; fallback to config constant
    this.loadingCatalog = true;
    this.api.getCatalogSettings().subscribe({
      next: (res) => {
        this.loadingCatalog = false;
        const cefrRow = res.data?.cefrRows?.find(r => r.code === level);
        const fee = cefrRow
          ? (this.languageForm.get('currency')!.value === 'INR' ? cefrRow.inr : cefrRow.lkr)
          : (this.levelConfig[level] ?? 0);
        if (fee > 0) {
          this.languageForm.get('totalCourseFee')!.setValue(fee);
          this.languageForm.get('amountPaid')!.setValue(fee);
        }
      },
      error: () => {
        this.loadingCatalog = false;
        const fee = this.levelConfig[level] ?? 0;
        if (fee > 0) this.languageForm.get('totalCourseFee')!.setValue(fee);
      },
    });
  }

  // ── Language balance ───────────────────────────────────────────────────────

  private recalcBalance(): void {
    const fee  = Number(this.languageForm.get('totalCourseFee')!.value) || 0;
    const paid = Number(this.languageForm.get('amountPaid')!.value) || 0;
    this.languageForm.get('balance')!.setValue(Math.max(0, fee - paid));
  }

  get languageBalance(): number {
    return Number(this.languageForm.get('balance')!.value) || 0;
  }

  // ── Array helpers ──────────────────────────────────────────────────────────

  private lineItemGroup(withType = false): FormGroup {
    const base: Record<string, unknown> = {
      amount:      [0, [Validators.required, Validators.min(1)]],
      currency:    ['LKR', Validators.required],
      paymentDate: [null, Validators.required],
      remarks:     [''],
    };
    if (withType) base['paymentType'] = ['', Validators.required];
    return this.fb.group(base);
  }

  addDocs():   void { this.docsArray.push(this.lineItemGroup());   this.docsExpanded   = true; }
  addVisa():   void { this.visaArray.push(this.lineItemGroup());   this.visaExpanded   = true; }
  addCustom(): void { this.customArray.push(this.lineItemGroup(true)); this.customExpanded = true; }

  removeDocs(i: number):   void { this.docsArray.removeAt(i); }
  removeVisa(i: number):   void { this.visaArray.removeAt(i); }
  removeCustom(i: number): void { this.customArray.removeAt(i); }

  get docsControls():   AbstractControl[] { return this.docsArray.controls; }
  get visaControls():   AbstractControl[] { return this.visaArray.controls; }
  get customControls(): AbstractControl[] { return this.customArray.controls; }

  // ── Summary totals ─────────────────────────────────────────────────────────

  get languagePaid(): number {
    return Number(this.languageForm.get('amountPaid')?.value) || 0;
  }

  get docsPaid(): number {
    return (this.docsArray.value as { amount: number }[]).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  }

  get visaPaid(): number {
    return (this.visaArray.value as { amount: number }[]).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  }

  get customPaid(): number {
    return (this.customArray.value as { amount: number }[]).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  }

  get totalPaid(): number {
    return this.languagePaid + this.docsPaid + this.visaPaid + this.customPaid;
  }

  get hasLanguage(): boolean { return true; /* section always shown */ }

  // ── Form currency ─────────────────────────────────────────────────────────

  groupCurrency(ctrl: AbstractControl): string {
    return (ctrl as FormGroup).get('currency')?.value || 'LKR';
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  private allValid(): boolean {
    const langOk = !this.languageForm.invalid;
    const docsOk = !this.docsArray.invalid;
    const visaOk = !this.visaArray.invalid;
    const custOk = !this.customArray.invalid;
    return langOk && docsOk && visaOk && custOk;
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  openSummary(): void {
    if (!this.selectedStudent) {
      this.snack.open('Please select a student first', 'Dismiss', { duration: 3500 });
      return;
    }
    this.languageForm.markAllAsTouched();
    this.docsArray.markAllAsTouched();
    this.visaArray.markAllAsTouched();
    this.customArray.markAllAsTouched();

    if (!this.allValid()) {
      this.snack.open('Please fix form errors before previewing', 'Dismiss', { duration: 3500 });
      return;
    }
    this.showSummary = true;
  }

  cancelSummary(): void {
    this.showSummary = false;
  }

  save(): void {
    if (!this.selectedStudent) return;

    const lv = this.languageForm.getRawValue();
    const langPay = (lv.amountPaid > 0 || lv.markFullyPaid)
      ? {
          totalCourseFee: Number(lv.totalCourseFee),
          amountPaid:     lv.markFullyPaid ? Number(lv.totalCourseFee) : Number(lv.amountPaid),
          currency:       lv.currency,
          paymentDate:    (lv.paymentDate as Date).toISOString(),
          remarks:        lv.remarks || '',
          markFullyPaid:  Boolean(lv.markFullyPaid),
        }
      : null;

    const toItems = (arr: FormArray): LegacyLineItem[] =>
      (arr.value as { amount: number; currency: string; paymentDate: Date; remarks: string }[]).map(r => ({
        amount:      Number(r.amount),
        currency:    r.currency,
        paymentDate: (r.paymentDate as unknown as Date).toISOString(),
        remarks:     r.remarks || '',
      }));

    const toCustom = (): LegacyCustomPayment[] =>
      (this.customArray.value as { paymentType: string; amount: number; currency: string; paymentDate: Date; remarks: string }[]).map(r => ({
        paymentType: r.paymentType,
        amount:      Number(r.amount),
        currency:    r.currency,
        paymentDate: (r.paymentDate as unknown as Date).toISOString(),
        remarks:     r.remarks || '',
      }));

    const body: MapLegacyPaymentsBody = {
      studentId:      this.selectedStudent.studentId._id,
      languagePayment: langPay,
      docsPayments:   toItems(this.docsArray),
      visaPayments:   toItems(this.visaArray),
      customPayments: toCustom(),
    };

    this.saving = true;
    this.api.mapLegacyPayments(body).subscribe({
      next: () => {
        this.saving = false;
        this.snack.open('Legacy payments saved successfully!', 'OK', { duration: 5000, panelClass: ['snack-success'] });
        this.dialogRef.close(true);
      },
      error: (err: unknown) => {
        this.saving = false;
        const http = err as { error?: { message?: string; msg?: string }; message?: string; status?: number };
        const msg =
          http?.error?.message ||
          http?.error?.msg ||
          (typeof http?.status === 'number' ? `Request failed (${http.status})` : '') ||
          http?.message ||
          'Failed to save legacy payments';
        this.snack.open(msg, 'Dismiss', { duration: 8000 });
        this.showSummary = false;
      },
    });
  }

  close(): void {
    this.dialogRef.close(false);
  }

  // ── Utils ──────────────────────────────────────────────────────────────────

  fmt(n: number | null | undefined): string {
    return (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  currencyLabel(currency: string | null | undefined): string {
    return String(currency || '').toUpperCase() === 'USD' ? 'EURO' : String(currency || '');
  }
}
