import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ClassFeedbackService,
  BatchFeedbackSetting,
  ClassFeedbackItem,
  FeedbackStatsResponse,
} from '../../services/class-feedback.service';

type AdminTab = 'settings' | 'responses';

interface FilterState {
  batch: string;
  dateFrom: string;
  dateTo: string;
  understanding: string;
  motivation: string;
}

@Component({
  selector: 'app-class-feedback-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './class-feedback-admin.component.html',
  styleUrls: ['./class-feedback-admin.component.scss'],
})
export class ClassFeedbackAdminComponent implements OnInit {
  activeTab: AdminTab = 'settings';

  // ── Batch Settings ──────────────────────────────────────────
  batches: BatchFeedbackSetting[] = [];
  batchesLoading = false;
  batchSaving = false;
  batchSaveMsg = '';
  batchSaveError = '';
  // Track pending changes
  pendingChanges: Record<string, boolean> = {};
  searchBatch = '';

  // ── Feedback Responses ──────────────────────────────────────
  feedbacks: ClassFeedbackItem[] = [];
  responsesLoading = false;
  total = 0;
  page = 1;
  totalPages = 1;
  readonly pageSize = 15;
  readonly Math = Math;

  filters: FilterState = {
    batch: '',
    dateFrom: '',
    dateTo: '',
    understanding: '',
    motivation: '',
  };

  allBatchNames: string[] = [];
  stats: FeedbackStatsResponse | null = null;
  statsLoading = false;

  // Labels
  readonly understandingLabels: Record<string, string> = {
    not_really: '😕 Not really',
    mostly: '🙂 Mostly',
    completely: '😄 Completely',
  };
  readonly paceLabels: Record<string, string> = {
    too_slow: '🐢 Too slow',
    just_right: '👍 Just right',
    too_fast: '🐇 Too fast',
  };
  readonly motivationLabels: Record<string, string> = {
    not_motivated: '😴 Not motivated',
    somewhat_motivated: '🙂 Somewhat motivated',
    very_motivated: '🔥 Very motivated',
  };

  constructor(private feedbackService: ClassFeedbackService) {}

  ngOnInit(): void {
    this.loadBatchSettings();
    this.loadFeedbacks();
    this.loadStats();
  }

  // ── Tab ──────────────────────────────────────────────────────
  setTab(tab: AdminTab): void {
    this.activeTab = tab;
    if (tab === 'responses' && this.feedbacks.length === 0) {
      this.loadFeedbacks();
    }
  }

  // ── Batch Settings ────────────────────────────────────────────
  loadBatchSettings(): void {
    this.batchesLoading = true;
    this.feedbackService.getBatchSettings().subscribe({
      next: (res) => {
        this.batchesLoading = false;
        this.batches = res.data || [];
        this.allBatchNames = this.batches.map((b) => b.batch);
        // Initialize pendingChanges to current values
        this.pendingChanges = {};
        for (const b of this.batches) {
          this.pendingChanges[b.batch] = b.enabled;
        }
      },
      error: () => { this.batchesLoading = false; }
    });
  }

  get filteredBatches(): BatchFeedbackSetting[] {
    if (!this.searchBatch.trim()) return this.batches;
    const q = this.searchBatch.trim().toLowerCase();
    return this.batches.filter((b) => b.batch.toLowerCase().includes(q));
  }

  get enabledCount(): number {
    return Object.values(this.pendingChanges).filter(Boolean).length;
  }

  toggleBatch(batch: string): void {
    this.pendingChanges[batch] = !this.pendingChanges[batch];
  }

  enableAll(): void {
    for (const b of this.batches) this.pendingChanges[b.batch] = true;
  }

  disableAll(): void {
    for (const b of this.batches) this.pendingChanges[b.batch] = false;
  }

  saveSettings(): void {
    this.batchSaving = true;
    this.batchSaveMsg = '';
    this.batchSaveError = '';

    const updates = Object.entries(this.pendingChanges).map(([batch, enabled]) => ({ batch, enabled }));
    this.feedbackService.updateBatchSettings(updates).subscribe({
      next: () => {
        this.batchSaving = false;
        this.batchSaveMsg = 'Settings saved successfully!';
        // Update local state
        for (const b of this.batches) {
          b.enabled = this.pendingChanges[b.batch] ?? b.enabled;
        }
        setTimeout(() => { this.batchSaveMsg = ''; }, 3000);
      },
      error: () => {
        this.batchSaving = false;
        this.batchSaveError = 'Failed to save settings. Please try again.';
      }
    });
  }

  hasPendingChanges(): boolean {
    return this.batches.some((b) => b.enabled !== this.pendingChanges[b.batch]);
  }

  // ── Feedback List ──────────────────────────────────────────────
  loadFeedbacks(): void {
    this.responsesLoading = true;
    this.feedbackService.getFeedbackList({ ...this.filters, page: this.page, limit: this.pageSize }).subscribe({
      next: (res) => {
        this.responsesLoading = false;
        this.feedbacks = res.data || [];
        this.total = res.total || 0;
        this.totalPages = res.totalPages || 1;
      },
      error: () => { this.responsesLoading = false; }
    });
  }

  loadStats(): void {
    this.statsLoading = true;
    const { batch, dateFrom, dateTo } = this.filters;
    this.feedbackService.getStats({ batch, dateFrom, dateTo }).subscribe({
      next: (res) => { this.stats = res; this.statsLoading = false; },
      error: () => { this.statsLoading = false; }
    });
  }

  applyFilters(): void {
    this.page = 1;
    this.loadFeedbacks();
    this.loadStats();
  }

  clearFilters(): void {
    this.filters = { batch: '', dateFrom: '', dateTo: '', understanding: '', motivation: '' };
    this.page = 1;
    this.loadFeedbacks();
    this.loadStats();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.loadFeedbacks();
  }

  exportCsv(): void {
    this.feedbackService.exportCsv(this.filters);
  }

  // ── Display helpers ───────────────────────────────────────────
  formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  formatDateTime(dateStr: string): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  }

  starsDisplay(n: number): string {
    return '⭐'.repeat(n || 0) + '☆'.repeat(3 - (n || 0));
  }

  getUnderstandingBadgeClass(val: string): string {
    const map: Record<string, string> = {
      not_really: 'badge-red',
      mostly: 'badge-amber',
      completely: 'badge-green',
    };
    return map[val] || 'badge-gray';
  }

  getPaceBadgeClass(val: string): string {
    const map: Record<string, string> = {
      too_slow: 'badge-amber',
      just_right: 'badge-green',
      too_fast: 'badge-red',
    };
    return map[val] || 'badge-gray';
  }

  getMotivationBadgeClass(val: string): string {
    const map: Record<string, string> = {
      not_motivated: 'badge-red',
      somewhat_motivated: 'badge-amber',
      very_motivated: 'badge-green',
    };
    return map[val] || 'badge-gray';
  }

  get pageNumbers(): number[] {
    const pages: number[] = [];
    const delta = 2;
    const left = Math.max(1, this.page - delta);
    const right = Math.min(this.totalPages, this.page + delta);
    for (let i = left; i <= right; i++) pages.push(i);
    return pages;
  }

  statPercent(count: number): number {
    if (!this.stats?.total) return 0;
    return Math.round((count / this.stats.total) * 100);
  }
}
