import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Subject, debounceTime, distinctUntilChanged, forkJoin, takeUntil } from 'rxjs';
import * as XLSX from 'xlsx';

import {
  LanguageTrackingApiService,
  CrucialStudent,
  CrucialStudentsSummary,
  CrucialStudentsSort,
} from './language-tracking-api.service';

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

@Component({
  selector: 'app-crucial-students',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatSelectModule,
    MatFormFieldModule,
  ],
  templateUrl: './crucial-students.component.html',
  styleUrls: ['./crucial-students.component.scss'],
})
export class CrucialStudentsComponent implements OnInit, OnDestroy {
  loading = true;
  sending = false;
  exporting = false;
  error: string | null = null;

  students: CrucialStudent[] = [];
  summary: CrucialStudentsSummary | null = null;
  availableBatches: string[] = [];
  availableLiveClassCounts: number[] = [];

  page = 1;
  limit = 50;
  total = 0;

  searchRaw = '';
  filterBatches: string[] = [];
  filterLiveClasses: number | '' = '';
  sortBy: CrucialStudentsSort = 'lowest';

  readonly sortOptions: { value: CrucialStudentsSort; label: string }[] = [
    { value: 'lowest',       label: 'Lowest time first' },
    { value: 'highest',      label: 'Highest time first' },
    { value: 'nearest_hour', label: 'Nearest to 1 hour' },
  ];

  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  readonly formatDuration = formatDuration;
  readonly skeletonRows = Array(10).fill(0);

  constructor(
    private readonly api: LanguageTrackingApiService,
    private readonly snack: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(350),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => {
      this.page = 1;
      this.load();
    });
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading = true;
    this.error = null;

    this.api.getCrucialStudents(this.currentQueryParams(this.page, this.limit))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.students = res.students;
          this.summary  = res.summary;
          this.total    = res.total;
          this.availableBatches         = res.availableBatches || [];
          this.availableLiveClassCounts = res.availableLiveClassCounts || [];
          this.loading = false;
        },
        error: (err) => {
          this.error   = err?.error?.message || 'Failed to load crucial students';
          this.loading = false;
        },
      });
  }

  onSearchChange(): void { this.searchSubject.next(this.searchRaw); }

  onFilterChange(): void {
    this.page = 1;
    this.load();
  }

  clearFilters(): void {
    this.searchRaw         = '';
    this.filterBatches     = [];
    this.filterLiveClasses = '';
    this.sortBy            = 'lowest';
    this.page              = 1;
    this.load();
  }

  clearSearch(): void {
    this.searchRaw = '';
    this.page = 1;
    this.load();
  }

  get hasActiveFilters(): boolean {
    return !!(
      this.searchRaw.trim() ||
      this.filterBatches.length ||
      this.filterLiveClasses !== '' ||
      this.sortBy !== 'lowest'
    );
  }

  get batchFilterLabel(): string {
    if (!this.filterBatches.length) return 'All batches';
    if (this.filterBatches.length === 1) return this.filterBatches[0];
    return `${this.filterBatches.length} batches`;
  }

  liveAttendedLabel(count: number): string {
    if (count === 0) return 'Missed both';
    if (count === 1) return 'Attended 1';
    return 'Attended 2';
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.load();
  }

  get totalPages(): number { return Math.ceil(this.total / this.limit); }

  get pageNumbers(): number[] {
    const pages: number[] = [];
    const maxVisible = 7;
    const half = Math.floor(maxVisible / 2);
    let start = Math.max(1, this.page - half);
    let end   = Math.min(this.totalPages, start + maxVisible - 1);
    if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  sendEmail(): void {
    if (this.sending) return;
    this.sending = true;
    this.api.sendCrucialStudentsEmail().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.sending = false;
        this.snack.open(`✅ ${res.message}`, 'Dismiss', { duration: 5000, panelClass: ['snack-success'] });
      },
      error: (err) => {
        this.sending = false;
        this.snack.open(`❌ ${err?.error?.message || 'Failed to send email'}`, 'Dismiss', { duration: 5000, panelClass: ['snack-error'] });
      },
    });
  }

  exportReport(): void {
    if (this.exporting || this.loading || this.total === 0) return;
    const exportLimit = 100;
    const pages = Math.max(1, Math.ceil(this.total / exportLimit));
    this.exporting = true;

    const requests = Array.from({ length: pages }, (_, i) =>
      this.api.getCrucialStudents(this.currentQueryParams(i + 1, exportLimit)),
    );

    forkJoin(requests).pipe(takeUntil(this.destroy$)).subscribe({
      next: (responses) => {
        const rows    = responses.flatMap(r => r.students || []);
        const summary = responses[0]?.summary || this.summary;
        this.downloadCrucialStudentsWorkbook(rows, summary);
        this.exporting = false;
        this.snack.open(`Exported ${rows.length} student(s)`, 'OK', { duration: 4000 });
      },
      error: () => {
        this.exporting = false;
        this.snack.open('Failed to export. Please try again.', 'Dismiss', { duration: 5000 });
      },
    });
  }

  exerciseDaysLabel(days: number[]): string {
    return days?.length ? `Days ${days.join(', ')}` : '—';
  }

  private currentQueryParams(page: number, limit: number) {
    return {
      page,
      limit,
      search:      this.searchRaw.trim() || undefined,
      batches:     this.filterBatches.length ? this.filterBatches : undefined,
      sort:        this.sortBy,
      liveClasses: this.filterLiveClasses === '' ? undefined : this.filterLiveClasses as number,
    };
  }

  private downloadCrucialStudentsWorkbook(
    students: CrucialStudent[],
    summary: CrucialStudentsSummary | null,
  ): void {
    const wb = XLSX.utils.book_new();
    const generatedAt = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
    });
    const sortLabel = this.sortOptions.find(o => o.value === this.sortBy)?.label || this.sortBy;

    const summaryRows = [
      ['Crucial Students Report'],
      ['Generated At', generatedAt],
      ['Window', summary?.windowLabel || 'Current week exercise days (positions 2, 4, 5)'],
      ['Total Students (filtered)', students.length],
      ['Avg. Engagement (min)', summary?.avgMinutes ?? ''],
      ['Threshold', 'Less than 1 hour'],
      [],
      ['Applied Filters'],
      ['Search',     this.searchRaw.trim() || '—'],
      ['Batch',      this.filterBatches.length ? this.filterBatches.join(', ') : 'All batches'],
      ['Sort by time', sortLabel],
      ['Live classes attended', this.filterLiveClasses === '' ? 'All' : this.liveAttendedLabel(this.filterLiveClasses as number)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary');

    const studentRows = students.map((s, index) => ({
      '#':                index + 1,
      'Student Name':     s.name  || '',
      Batch:              s.batch || '',
      Phone:              s.phone || '',
      Email:              s.email || '',
      'Journey Day':      s.currentCourseDay || '',
      Week:               `Week ${s.weekNum || ''}`,
      'Exercise Days':    (s.exerciseDays || []).join(', '),
      Level:              s.level || '',
      'Total Time':       formatDuration(s.totalSeconds),
      'Total Seconds':    s.totalSeconds || 0,
      Exercises:          formatDuration(s.exercisesSeconds),
      'DG Bot':           formatDuration(s.digibotSeconds),
      Arena:              formatDuration(s.arenaSeconds),
      'Live Classes (last 2)': `${s.liveClassesAttended ?? 0}/${s.liveClassesTotal ?? 0}`,
      Status:             this.getEngagementLabel(s.totalSeconds),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(studentRows), 'Students');
    XLSX.writeFile(wb, `crucial_students_week_exercise.xlsx`);
  }

  getEngagementLabel(totalSeconds: number): string {
    if (totalSeconds === 0) return 'No Activity';
    if (totalSeconds < 900)  return 'Very Low';
    if (totalSeconds < 1800) return 'Low';
    return 'Below Target';
  }
}
