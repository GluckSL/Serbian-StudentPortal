import { Component, HostListener, OnInit } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { RouterModule } from '@angular/router';

import {

  BatchLeaderboardService,

  AdminLeaderboardResponse,

  LeaderboardEntry,

  LeaderboardPeriod,

} from '../../../services/batch-leaderboard.service';

import { catchError, of } from 'rxjs';



type Period = LeaderboardPeriod;

type SortField = 'rank' | 'exercisesCompleted' | 'dgSessionsCompleted' | 'averageScore' | 'totalPoints' | 'currentStreak' | 'currentCourseDay' | 'engagementMinutes';



@Component({

  selector: 'app-admin-leaderboard',

  standalone: true,

  imports: [CommonModule, FormsModule, RouterModule],

  templateUrl: './admin-leaderboard.component.html',

  styleUrls: ['./admin-leaderboard.component.scss'],

})

export class AdminLeaderboardComponent implements OnInit {

  batches: string[] = [];

  batchesLoading = false;



  allBatchesSelected = false;

  selectedBatches: string[] = [];

  batchDropdownOpen = false;



  selectedPeriod: Period = 'today';



  data: AdminLeaderboardResponse | null = null;

  loading = false;

  error = '';



  sortField: SortField = 'rank';

  sortAsc = true;

  searchQuery = '';



  page = 1;

  readonly pageSize = 20;

  totalPages = 1;

  totalStudents = 0;



  readonly periods: { value: Period; label: string; icon: string }[] = [

    { value: 'today', label: 'Today', icon: 'today' },

    { value: 'weekly', label: 'This Week', icon: 'date_range' },

    { value: 'overall', label: 'Overall', icon: 'all_inclusive' },

  ];



  constructor(private svc: BatchLeaderboardService) {}



  ngOnInit(): void {

    this.loadBatches();

  }



  @HostListener('document:click')

  onDocumentClick(): void {

    this.batchDropdownOpen = false;

  }



  private loadBatches(): void {

    this.batchesLoading = true;

    this.svc.getAdminBatches()

      .pipe(catchError(() => of(null)))

      .subscribe((res) => {

        this.batchesLoading = false;

        if (res) {
          this.batches = res.batches;
        }
      });
  }



  get batchFilter(): string[] | 'all' {

    return this.allBatchesSelected ? 'all' : this.selectedBatches;

  }



  get batchLabel(): string {

    if (this.allBatchesSelected) return 'All batches';

    if (this.selectedBatches.length === 1) return `Batch ${this.selectedBatches[0]}`;

    if (!this.selectedBatches.length) return 'Select batches…';

    return `${this.selectedBatches.length} batches`;

  }



  get showBatchColumn(): boolean {

    return this.allBatchesSelected || this.selectedBatches.length !== 1;

  }



  get canLoad(): boolean {

    return this.allBatchesSelected || this.selectedBatches.length > 0;

  }



  loadLeaderboard(): void {

    if (!this.canLoad) {

      this.data = null;

      return;

    }

    this.loading = true;

    this.error = '';

    this.svc

      .getAdminLeaderboard(this.batchFilter, this.selectedPeriod, this.page, this.pageSize, this.searchQuery)

      .pipe(catchError(() => of(null)))

      .subscribe((res) => {

        this.loading = false;

        if (!res) {

          this.error = 'Failed to load data. Please try again.';

          return;

        }

        this.data = res;

        this.page = res.page;

        this.totalPages = res.totalPages;

        this.totalStudents = res.totalStudents;

      });

  }



  toggleBatchDropdown(event: Event): void {

    event.stopPropagation();

    this.batchDropdownOpen = !this.batchDropdownOpen;

  }



  selectAllBatches(event: Event): void {
    event.stopPropagation();
    const checked = (event.target as HTMLInputElement).checked;
    this.allBatchesSelected = checked;
    this.selectedBatches = [];
    this.page = 1;
    this.loadLeaderboard();
  }

  toggleBatchSelection(batch: string, event: Event): void {
    event.stopPropagation();
    const checked = (event.target as HTMLInputElement).checked;

    if (checked) {
      this.allBatchesSelected = false;
      if (!this.selectedBatches.includes(batch)) {
        this.selectedBatches = [...this.selectedBatches, batch].sort((a, b) => {
          const na = parseInt(a, 10);
          const nb = parseInt(b, 10);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return a.localeCompare(b);
        });
      }
    } else {
      this.allBatchesSelected = false;
      this.selectedBatches = this.selectedBatches.filter((b) => b !== batch);
    }

    this.page = 1;
    this.loadLeaderboard();
  }



  isBatchChecked(batch: string): boolean {

    return this.allBatchesSelected || this.selectedBatches.includes(batch);

  }



  onPeriodChange(p: Period): void {

    this.selectedPeriod = p;

    this.page = 1;

    this.loadLeaderboard();

  }



  onSearchChange(): void {

    this.page = 1;

    this.loadLeaderboard();

  }



  clearSearch(): void {

    this.searchQuery = '';

    this.onSearchChange();

  }



  goToPage(p: number): void {

    if (p < 1 || p > this.totalPages || p === this.page) return;

    this.page = p;

    this.loadLeaderboard();

  }



  get pageNumbers(): number[] {

    const pages: number[] = [];

    const max = this.totalPages;

    const cur = this.page;

    let start = Math.max(1, cur - 2);

    let end = Math.min(max, start + 4);

    start = Math.max(1, end - 4);

    for (let i = start; i <= end; i++) pages.push(i);

    return pages;

  }



  setSort(field: SortField): void {

    if (this.sortField === field) this.sortAsc = !this.sortAsc;

    else {

      this.sortField = field;

      this.sortAsc = field === 'rank';

    }

  }



  get sortedRows(): LeaderboardEntry[] {

    if (!this.data) return [];

    const list = [...this.data.leaderboard];

    list.sort((a, b) => {

      const va = (a as any)[this.sortField] ?? 0;

      const vb = (b as any)[this.sortField] ?? 0;

      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;

      return this.sortAsc ? cmp : -cmp;

    });

    return list;

  }



  get activeCount(): number { return this.data?.activeCount ?? 0; }

  get loggedTodayCount(): number { return this.data?.loggedTodayCount ?? 0; }

  get batchmates(): number { return this.data?.batchmates ?? 0; }

  get activeRate(): number {

    return this.batchmates > 0 ? Math.round((this.activeCount / this.batchmates) * 100) : 0;

  }



  formatExerciseRatio(entry: LeaderboardEntry): string {
    const total = entry.exercisesTotal ?? 0;
    const done = Math.min(entry.exercisesCompleted ?? 0, total);
    return `${done}/${total}`;
  }

  formatAverageScore(entry: LeaderboardEntry): string {
    return entry.averageScore != null && entry.averageScore > 0 ? `${entry.averageScore}%` : '—';
  }

  formatEngagementMinutes(entry: LeaderboardEntry): string {
    const mins = entry.engagementMinutes ?? 0;
    if (mins <= 0) return '—';
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins} min`;
  }

  getRankMedal(rank: number): string {

    if (rank === 1) return '🥇';

    if (rank === 2) return '🥈';

    if (rank === 3) return '🥉';

    return '';

  }



  getSortIcon(field: SortField): string {

    if (this.sortField !== field) return 'unfold_more';

    return this.sortAsc ? 'arrow_upward' : 'arrow_downward';

  }



  getBarWidth(val: number): number {

    if (!this.data?.leaderboard.length) return 0;

    const max = Math.max(...this.data.leaderboard.map(e => e.totalPoints), 1);

    return Math.round((val / max) * 100);

  }



  get distributionBars(): { label: string; count: number; pct: number; cls: string }[] {

    if (!this.data) return [];

    const total = this.batchmates || 1;
    const active = this.data.activeCount;
    const loggedOnly = this.data.loggedOnlyCount ?? 0;
    const inactive = this.data.inactiveCount ?? Math.max(0, total - active - loggedOnly);
    return [
      { label: 'Active', count: active, pct: Math.round((active / total) * 100), cls: 'bar--active' },
      { label: 'Logged in', count: loggedOnly, pct: Math.round((loggedOnly / total) * 100), cls: 'bar--logged' },
      { label: 'Inactive', count: inactive, pct: Math.round((inactive / total) * 100), cls: 'bar--inactive' },
    ];

  }



  skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

}

