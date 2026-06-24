import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { environment } from '../../../environments/environment';
import { BatchPaymentSummaryRow, PaymentHubApiService } from './payment-hub-api.service';
import {
  FinanceCohort,
  formatStudentStatusLabel,
  PortalStudentCounts,
} from './payment-hub-finance-cohort.util';

type BatchLevelStatus = '' | 'A1:ONGOING' | 'A1:COMPLETED' | 'A2:ONGOING' | 'A2:COMPLETED' | 'B1:ONGOING' | 'B1:COMPLETED' | 'B2:ONGOING' | 'B2:COMPLETED';

@Component({
  selector: 'app-payment-hub-finance-overview',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule],
  templateUrl: './payment-hub-finance-overview.component.html',
  styleUrls: ['./payment-hub-finance-overview.component.scss', './payment-hub-insights-page.scss'],
})
export class PaymentHubFinanceOverviewComponent implements OnInit {
  loading = true;
  loadingVisibleBatches = true;
  loadingBatchOptions = true;
  loadingSilverPaymentCount = true;
  silverPaymentCount = 0;
  savingVisibleBatches = false;
  showAddBatchModal = false;
  showManageVisibleBatches = false;
  visibleBatches: string[] = [];
  visibleBatchLevelStatuses: Record<string, string> = {};
  batchRows: BatchPaymentSummaryRow[] = [];
  selectedBatchLevelByName: Record<string, BatchLevelStatus> = {};
  selectedBatches = new Set<string>();
  counts: PortalStudentCounts = {
    portalNonTest: 0,
    ongoingNonTest: 0,
    platinumTotal: 0,
    platinumOngoing: 0,
    platinumStatusBreakdown: [],
    silverTotal: 0,
    silverOngoing: 0,
    silverStatusBreakdown: [],
    visaDocsTotal: 0,
    visaDocsOngoing: 0,
    visaDocsStatusBreakdown: [],
  };

  constructor(
    private readonly http: HttpClient,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.loadCounts();
    this.loadVisibleBatches();
    this.loadBatchOptions();
    this.loadSilverPaymentCount();
  }

  formatStudentStatus = formatStudentStatusLabel;

  readonly batchLevelStatusOptions: ReadonlyArray<{ value: BatchLevelStatus; label: string }> = [
    { value: '', label: 'Select level' },
    { value: 'A1:ONGOING', label: 'A1 ongoing' },
    { value: 'A1:COMPLETED', label: 'A1 completed' },
    { value: 'A2:ONGOING', label: 'A2 ongoing' },
    { value: 'A2:COMPLETED', label: 'A2 completed' },
    { value: 'B1:ONGOING', label: 'B1 ongoing' },
    { value: 'B1:COMPLETED', label: 'B1 completed' },
    { value: 'B2:ONGOING', label: 'B2 ongoing' },
    { value: 'B2:COMPLETED', label: 'B2 completed' },
  ];

  get batchOptions(): string[] {
    return this.batchRows.map((r) => r.batch).filter((b) => b && b !== '—');
  }

  get availableBatchesToAdd(): string[] {
    const visible = new Set(this.visibleBatches);
    return this.batchOptions.filter((b) => !visible.has(b));
  }

  get selectedModalBatchCount(): number {
    return [...this.selectedBatches].filter((b) => this.availableBatchesToAdd.includes(b)).length;
  }

  isBatchSelected(batch: string): boolean {
    return this.selectedBatches.has(batch);
  }

  toggleBatchSelection(batch: string): void {
    if (this.selectedBatches.has(batch)) {
      this.selectedBatches.delete(batch);
    } else {
      this.selectedBatches.add(batch);
    }
  }

  batchesRoute(_cohort: FinanceCohort): string {
    return '/admin/finance-dashboard/batches';
  }

  batchesQuery(cohort: FinanceCohort): { cohort: string; status: string } {
    return { cohort, status: 'ONGOING' };
  }

  studentsRoute(_cohort: FinanceCohort): string {
    return '/admin/finance-dashboard/students';
  }

  studentsQuery(cohort: FinanceCohort, status?: string): Record<string, string> {
    const q: Record<string, string> = { cohort };
    if (status) q['status'] = status;
    return q;
  }

  openAddBatchModal(): void {
    this.pruneSelectedBatchLevels();
    this.showAddBatchModal = true;
  }

  closeAddBatchModal(): void {
    if (this.savingVisibleBatches) return;
    this.showAddBatchModal = false;
  }

  toggleManageVisibleBatches(): void {
    if (!this.visibleBatches.length) return;
    this.showManageVisibleBatches = !this.showManageVisibleBatches;
  }

  addSelectedBatches(): void {
    if (!this.selectedModalBatchCount || this.savingVisibleBatches) return;
    const selected = [...this.selectedBatches].filter((b) => this.availableBatchesToAdd.includes(b));
    const next = [...new Set([...this.visibleBatches, ...selected])];
    const nextLevelStatuses: Record<string, string> = { ...this.visibleBatchLevelStatuses };
    selected.forEach((batch) => {
      const level = this.selectedBatchLevelByName[batch];
      if (level) nextLevelStatuses[batch] = level;
    });
    this.persistVisibleBatches(next, nextLevelStatuses, `Added ${selected.length} batch(es) to the dashboard.`, () => {
      this.showAddBatchModal = false;
      this.selectedBatches = new Set();
      this.selectedBatchLevelByName = {};
    });
  }

  removeVisibleBatch(batch: string): void {
    if (this.savingVisibleBatches) return;
    const next = this.visibleBatches.filter((b) => b !== batch);
    const nextLevelStatuses: Record<string, string> = { ...this.visibleBatchLevelStatuses };
    delete nextLevelStatuses[batch];
    this.persistVisibleBatches(next, nextLevelStatuses, `"${batch}" removed from dashboard.`, () => {
      if (!next.length) this.showManageVisibleBatches = false;
    });
  }

  private persistVisibleBatches(
    batches: string[],
    levelStatuses: Record<string, string>,
    successMessage: string,
    onSuccess?: () => void,
  ): void {
    this.savingVisibleBatches = true;
    this.api.updateFinanceVisibleBatches(batches, levelStatuses).subscribe({
      next: (res) => {
        this.visibleBatches = [...(res.data?.visibleBatches || batches)];
        this.visibleBatchLevelStatuses = { ...(res.data?.visibleBatchLevelStatuses || levelStatuses) };
        this.savingVisibleBatches = false;
        onSuccess?.();
        this.snack.open(successMessage, 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.savingVisibleBatches = false;
        this.snack.open(err?.error?.message || 'Could not update dashboard batches.', 'Dismiss', { duration: 4500 });
      },
    });
  }

  private loadCounts(): void {
    this.loading = true;
    this.http
      .get<{ success: boolean; studentCounts?: PortalStudentCounts }>(
        `${environment.apiUrl}/admin/students/filter-options`,
        { withCredentials: true },
      )
      .subscribe({
        next: (res) => {
          if (res.success && res.studentCounts) {
            this.counts = {
              ...this.counts,
              ...res.studentCounts,
              platinumStatusBreakdown: res.studentCounts.platinumStatusBreakdown ?? [],
              silverStatusBreakdown: res.studentCounts.silverStatusBreakdown ?? [],
              visaDocsStatusBreakdown: res.studentCounts.visaDocsStatusBreakdown ?? [],
            };
          }
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  private loadVisibleBatches(): void {
    this.loadingVisibleBatches = true;
    this.api.getFinanceVisibleBatches().subscribe({
      next: (res) => {
        this.visibleBatches = [...(res.data?.visibleBatches || [])];
        this.visibleBatchLevelStatuses = { ...(res.data?.visibleBatchLevelStatuses || {}) };
        this.loadingVisibleBatches = false;
      },
      error: () => {
        this.visibleBatches = [];
        this.visibleBatchLevelStatuses = {};
        this.loadingVisibleBatches = false;
      },
    });
  }

  private loadBatchOptions(): void {
    this.loadingBatchOptions = true;
    this.api.getBatchPaymentSummary().subscribe({
      next: (summary) => {
        this.batchRows = summary.data?.batches || [];
        this.loadingBatchOptions = false;
        this.pruneSelectedBatchLevels();
      },
      error: () => {
        this.batchRows = [];
        this.loadingBatchOptions = false;
      },
    });
  }

  private loadSilverPaymentCount(): void {
    this.loadingSilverPaymentCount = true;
    this.http
      .get<{ success: boolean; count: number }>(
        `${environment.apiUrl}/new-payments/finance-dashboard/silver-payment/count`,
        { withCredentials: true },
      )
      .subscribe({
        next: (res) => {
          this.silverPaymentCount = res.count ?? 0;
          this.loadingSilverPaymentCount = false;
        },
        error: () => {
          this.loadingSilverPaymentCount = false;
        },
      });
  }

  private pruneSelectedBatchLevels(): void {
    const available = new Set(this.availableBatchesToAdd);
    this.selectedBatches = new Set([...this.selectedBatches].filter((b) => available.has(b)));
    this.selectedBatchLevelByName = Object.fromEntries(
      Object.entries(this.selectedBatchLevelByName).filter(([batch]) => available.has(batch)),
    ) as Record<string, BatchLevelStatus>;
  }
}
