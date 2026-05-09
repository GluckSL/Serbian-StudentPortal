import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PaymentHubApiService, PaymentRequestItem as PaymentRequest, StudentCatalog, CefrRow, ScheduleStep } from './payment-hub-api.service';
import { PaymentUploadDialogComponent } from './payment-upload-dialog.component';

@Component({
  selector: 'app-payment-hub-student-portal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './payment-hub-student-portal.component.html',
  styleUrls: ['./payment-hub-student-portal.component.scss'],
})
export class PaymentHubStudentPortalComponent implements OnInit {
  loading = true;
  requests: PaymentRequest[] = [];
  total = 0;
  page = 1;
  readonly pageSize = 20;

  catalog: StudentCatalog | null = null;
  loadingCatalog = true;

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
    private readonly dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.load();
    this.loadCatalog();
  }

  loadCatalog(): void {
    this.api.getMyCatalog().subscribe({
      next: (res) => {
        this.catalog = res.data;
        this.loadingCatalog = false;
      },
      error: () => {
        this.loadingCatalog = false;
      },
    });
  }

  get catalogCefrRows(): CefrRow[] {
    return this.catalog?.cefrRows ?? [];
  }

  get scheduleSteps(): ScheduleStep[] {
    return this.catalog?.defaultInstallmentSchedule?.steps ?? [];
  }

  get scheduleTitle(): string {
    return this.catalog?.defaultInstallmentSchedule?.title ?? 'Default payment schedule';
  }

  get scheduleNotes(): string {
    return this.catalog?.defaultInstallmentSchedule?.notes ?? '';
  }

  cefrTotalLkr(): number {
    return this.catalogCefrRows.reduce((sum, r) => sum + (r.lkr || 0), 0);
  }

  cefrTotalInr(): number {
    return this.catalogCefrRows.reduce((sum, r) => sum + (r.inr || 0), 0);
  }

  trackStep(_i: number, _s: ScheduleStep): unknown { return _i; }

  load(): void {
    this.loading = true;
    this.api.getMyRequests({ page: this.page, limit: this.pageSize }).subscribe({
      next: (res) => {
        this.requests = res.data || [];
        this.total = res.total || 0;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snack.open('Could not load your payments', 'Dismiss', { duration: 4000 });
      },
    });
  }

  get reuploadRequests(): PaymentRequest[] {
    return this.requests.filter(r => {
      const subs = (r.submissions as Array<{ status: string; reuploadNote?: string }>) || [];
      return subs.some(s => s.status === 'REUPLOAD_REQUIRED');
    });
  }

  /** Approved / fully paid amounts grouped by currency */
  get paidPerCurrency(): { currency: string; amount: number }[] {
    const map = new Map<string, number>();
    for (const r of this.requests) {
      if (!['APPROVED', 'FULLY_PAID'].includes(r.status)) continue;
      const paid = (r.amount ?? 0) - (r.amountRemaining ?? 0);
      if (paid <= 0) continue;
      const c = r.currency || 'LKR';
      map.set(c, (map.get(c) || 0) + paid);
    }
    return Array.from(map.entries()).map(([currency, amount]) => ({ currency, amount }));
  }

  /** Earliest open request with an amount still to pay */
  get nextPaymentBlock(): { dueDate: string; currency: string; amount: number; title: string } | null {
    const candidates = this.requests.filter(
      r => r.amountRemaining != null && r.amountRemaining > 0 && r.status !== 'FULLY_PAID',
    );
    if (!candidates.length) return null;
    const pick = candidates.reduce((a, b) =>
      new Date(a.dueDate).getTime() <= new Date(b.dueDate).getTime() ? a : b,
    );
    const title = `${pick.paymentType}${pick.customType ? ' — ' + pick.customType : ''}`;
    return {
      dueDate: pick.dueDate,
      currency: pick.currency || 'LKR',
      amount: pick.amountRemaining ?? 0,
      title,
    };
  }

  /** Sum of remaining balances by currency (excludes fully paid) */
  get duePerCurrency(): { currency: string; amount: number }[] {
    const map = new Map<string, number>();
    for (const r of this.requests) {
      if (r.status === 'FULLY_PAID') continue;
      const rem = r.amountRemaining ?? 0;
      if (rem <= 0) continue;
      const c = r.currency || 'LKR';
      map.set(c, (map.get(c) || 0) + rem);
    }
    return Array.from(map.entries()).map(([currency, amount]) => ({ currency, amount }));
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  /** Human-readable due date hint vs today */
  dueHint(req: PaymentRequest): string {
    if (!req.dueDate || req.status === 'APPROVED' || req.status === 'FULLY_PAID') return '';
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const due = new Date(req.dueDate);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due.getTime() - start.getTime()) / 86400000);
    if (diffDays < 0) return `${Math.abs(diffDays)} day(s) overdue`;
    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Due tomorrow';
    return `Due in ${diffDays} days`;
  }

  openUpload(req: PaymentRequest): void {
    const ref = this.dialog.open(PaymentUploadDialogComponent, {
      width: '480px',
      maxWidth: '96vw',
      data: { request: req },
      disableClose: false,
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });

    ref.afterClosed().subscribe((formData: FormData | null) => {
      if (!formData) return;
      this.api.submitPaymentFormData(formData).subscribe({
        next: () => {
          this.snack.open('Uploaded successfully! Admin will review shortly.', 'OK', { duration: 5000 });
          this.load();
        },
        error: (e) => {
          this.snack.open(e?.error?.message || 'Upload failed. Please try again.', 'Dismiss', { duration: 5000 });
        },
      });
    });
  }

  getReuploadNote(req: PaymentRequest): string {
    const subs = (req.submissions as Array<{ status: string; reuploadNote?: string }>) || [];
    const sub = subs.find(s => s.status === 'REUPLOAD_REQUIRED');
    return sub?.reuploadNote || 'Please upload a clearer screenshot.';
  }

  prevPage(): void {
    if (this.page > 1) { this.page--; this.load(); }
  }

  nextPage(): void {
    if (this.page * this.pageSize < this.total) { this.page++; this.load(); }
  }

  actionLabel(req: PaymentRequest): string {
    const map: Record<string, string> = {
      REQUESTED: 'Upload Screenshot',
      REJECTED: 'Re-upload',
      OVERDUE: 'Upload Now',
    };
    const subs = (req.submissions as Array<{ status: string }>) || [];
    if (subs.some(s => s.status === 'REUPLOAD_REQUIRED')) return 'Re-upload';
    return map[req.status] || '';
  }

  canUpload(req: PaymentRequest): boolean {
    const subs = (req.submissions as Array<{ status: string }>) || [];
    if (subs.some(s => s.status === 'REUPLOAD_REQUIRED')) return true;
    return ['REQUESTED', 'REJECTED', 'OVERDUE'].includes(req.status);
  }

  isUrgent(req: PaymentRequest): boolean {
    return req.status === 'OVERDUE';
  }

  statusClass(req: PaymentRequest): string {
    const subs = (req.submissions as Array<{ status: string }>) || [];
    if (subs.some(s => s.status === 'REUPLOAD_REQUIRED')) return 'pill-orange';
    const map: Record<string, string> = {
      REQUESTED: 'pill-grey',
      SUBMITTED: 'pill-blue',
      UNDER_REVIEW: 'pill-amber',
      APPROVED: 'pill-green',
      FULLY_PAID: 'pill-green',
      REJECTED: 'pill-red',
      OVERDUE: 'pill-red',
    };
    return map[req.status] || 'pill-grey';
  }

  displayStatus(req: PaymentRequest): string {
    const subs = (req.submissions as Array<{ status: string }>) || [];
    if (subs.some(s => s.status === 'REUPLOAD_REQUIRED')) return 'REUPLOAD REQUIRED';
    return req.status;
  }

  fmt(val: number | undefined | null): string {
    if (val === undefined || val === null) return '0';
    return val.toLocaleString('en-IN');
  }

  fmtDate(d: string | undefined | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  isPastDue(req: PaymentRequest): boolean {
    if (!req.dueDate) return false;
    return new Date(req.dueDate) < new Date();
  }
}
