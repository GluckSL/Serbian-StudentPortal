import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PaymentHubApiService, DashboardStats, StudentTableRow } from './payment-hub-api.service';
import { StudentLogService } from '../../services/student-log.service';

@Component({
  selector: 'app-payment-hub-all-payments',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './payment-hub-all-payments.component.html',
  styleUrls: ['./payment-hub-all-payments.component.scss'],
})
export class PaymentHubAllPaymentsComponent implements OnInit {
  loadingStats = true;
  loadingTable = true;
  runningOverdue = false;

  stats: DashboardStats | null = null;
  rows: StudentTableRow[] = [];
  total = 0;
  page = 1;
  readonly pageSize = 20;

  // Filters
  filterBatch = '';
  filterLevel = '';
  filterCurrency = '';
  filterDateFrom: Date | null = null;
  filterDateTo: Date | null = null;
  searchQuery = '';

  readonly levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly currencies = ['LKR', 'INR', 'USD'];
  /** Distinct student `batch` values from `/api/studentLog/batch-options` */
  batchOptions: string[] = [];

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
    private readonly studentLog: StudentLogService,
  ) {}

  ngOnInit(): void {
    this.studentLog.getBatchOptions().subscribe({
      next: (r) => {
        this.batchOptions = r.data || [];
      },
      error: () => {
        this.batchOptions = [];
      },
    });
    this.loadStats();
    this.loadTable();
  }

  loadStats(): void {
    this.loadingStats = true;
    const filters = this.buildFilters();
    this.api.getDashboardStats(filters).subscribe({
      next: (r) => {
        this.stats = r.data;
        this.loadingStats = false;
      },
      error: () => {
        this.loadingStats = false;
        this.snack.open('Could not load payment stats', 'Dismiss', { duration: 4000 });
      },
    });
  }

  loadTable(): void {
    this.loadingTable = true;
    const filters = this.buildFilters();
    this.api
      .getStudentTable({ ...filters, page: this.page, limit: this.pageSize, sort: '-lastRebuiltAt', search: this.searchQuery || undefined })
      .subscribe({
        next: (res) => {
          this.rows = res.data || [];
          this.total = res.total || 0;
          this.loadingTable = false;
        },
        error: () => {
          this.loadingTable = false;
          this.snack.open('Could not load student table', 'Dismiss', { duration: 4000 });
        },
      });
  }

  private buildFilters(): Record<string, string | undefined> {
    return {
      batch: this.filterBatch || undefined,
      level: this.filterLevel || undefined,
      currency: this.filterCurrency || undefined,
      dateFrom: this.filterDateFrom ? this.filterDateFrom.toISOString() : undefined,
      dateTo: this.filterDateTo ? this.filterDateTo.toISOString() : undefined,
    };
  }

  applyFilters(): void {
    this.page = 1;
    this.loadStats();
    this.loadTable();
  }

  resetFilters(): void {
    this.filterBatch = '';
    this.filterLevel = '';
    this.filterCurrency = '';
    this.filterDateFrom = null;
    this.filterDateTo = null;
    this.searchQuery = '';
    this.page = 1;
    this.loadStats();
    this.loadTable();
  }

  onSearch(): void {
    this.page = 1;
    this.loadTable();
  }

  prevPage(): void {
    if (this.page > 1) {
      this.page--;
      this.loadTable();
    }
  }

  nextPage(): void {
    if (this.page * this.pageSize < this.total) {
      this.page++;
      this.loadTable();
    }
  }

  openStudentDetail(row: StudentTableRow): void {
    const studentId = row.studentId?._id || row._id;
    window.open(`/admin/payment-hub/student/${studentId}`, '_blank');
  }

  runOverdue(): void {
    this.runningOverdue = true;
    this.api.runOverdueDetection().subscribe({
      next: () => {
        this.runningOverdue = false;
        this.snack.open('Overdue detection finished', 'OK', { duration: 3000 });
        this.loadStats();
        this.loadTable();
      },
      error: () => {
        this.runningOverdue = false;
        this.snack.open('Overdue job failed', 'Dismiss', { duration: 4000 });
      },
    });
  }

  fmt(val: number | undefined | null): string {
    if (val === undefined || val === null) return '0';
    return val.toLocaleString('en-IN');
  }

  studentName(row: StudentTableRow): string {
    return row.studentId?.name || '—';
  }

  studentEmail(row: StudentTableRow): string {
    return row.studentId?.email || '—';
  }

  studentBatch(row: StudentTableRow): string {
    return row.studentId?.batch || '—';
  }

  studentLevel(row: StudentTableRow): string {
    return row.studentId?.level || '—';
  }

  studentDateJoined(row: StudentTableRow): string {
    const d = row.studentId?.dateJoined || row.studentId?.createdAt;
    return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      GOOD_STANDING: 'pill-green',
      FULLY_PAID: 'pill-green',
      PENDING: 'pill-amber',
      OVERDUE: 'pill-red',
      NO_REQUESTS: 'pill-grey',
    };
    return map[status] || 'pill-grey';
  }
}
