import { Component, Input, OnChanges, SimpleChanges, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../../services/portal-analytics-api.service';
import { formatPortalDuration } from '../portal-analytics-format';

export interface StudentWiseRow {
  studentId: string;
  studentName: string;
  email: string;
  batch: string;
  journeyDay: number;
  totalSeconds: number;
  sessionsCount: number;
  avgSessionSeconds: number;
  topPage: string;
  topPageSeconds: number;
}

export type StudentSortKey = 'time' | 'sessions' | 'name';
export type SortOrder = 'asc' | 'desc';

@Component({
  selector: 'app-portal-analytics-student-wise',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule
  ],
  templateUrl: './portal-analytics-student-wise.component.html',
  styleUrls: ['./portal-analytics-student-wise.component.scss']
})
export class PortalAnalyticsStudentWiseComponent implements OnChanges {
  @Input({ required: true }) range!: PortalAnalyticsRange;

  readonly pageSize = 12;
  loading = false;
  error = '';
  rows: StudentWiseRow[] = [];
  currentPage = 1;
  sortBy: StudentSortKey = 'time';
  order: SortOrder = 'desc';

  availableBatches: string[] = [];
  selectedBatches: string[] = [];
  studentNameSearch = '';
  isDropdownOpen = false;

  private allRows: StudentWiseRow[] = [];

  constructor(
    private api: PortalAnalyticsApiService,
    private elementRef: ElementRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['range'] && this.range?.from && this.range?.to) {
      this.load();
    }
  }

  formatDuration = formatPortalDuration;

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.rows.length / this.pageSize));
  }

  get pagedRows(): StudentWiseRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.rows.slice(start, start + this.pageSize);
  }

  setSort(key: StudentSortKey): void {
    if (this.sortBy === key) {
      this.order = this.order === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = key;
      this.order = key === 'name' ? 'asc' : 'desc';
    }
    this.load();
  }

  sortIcon(key: StudentSortKey): string {
    if (this.sortBy !== key) return 'unfold_more';
    return this.order === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  prevPage(): void {
    if (this.currentPage <= 1) return;
    this.currentPage--;
  }

  nextPage(): void {
    if (this.currentPage >= this.totalPages) return;
    this.currentPage++;
  }

  private load(): void {
    this.loading = true;
    this.error = '';
    this.api.getStudentWise(this.range, 200, this.sortBy, this.order).subscribe({
      next: (res: unknown) => {
        const body = res as { items?: StudentWiseRow[] };
        this.allRows = body.items || [];
        this.extractBatches();
        this.applyLocalFilters();
        this.currentPage = 1;
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load student data.';
        this.loading = false;
      }
    });
  }

  private extractBatches(): void {
    const batchSet = new Set<string>();
    for (const row of this.allRows) {
      if (row.batch) {
        batchSet.add(row.batch);
      }
    }
    this.availableBatches = Array.from(batchSet).sort();
  }

  private applyLocalFilters(): void {
    let filtered = [...this.allRows];

    if (this.selectedBatches.length > 0) {
      filtered = filtered.filter(r => r.batch && this.selectedBatches.includes(r.batch));
    }

    if (this.studentNameSearch.trim()) {
      const search = this.studentNameSearch.trim().toLowerCase();
      filtered = filtered.filter(r => r.studentName.toLowerCase().includes(search));
    }

    this.rows = filtered;
  }

  applyFilters(): void {
    this.applyLocalFilters();
    this.currentPage = 1;
  }

  clearFilters(): void {
    this.selectedBatches = [];
    this.studentNameSearch = '';
    this.applyLocalFilters();
    this.currentPage = 1;
  }

  toggleDropdown(): void {
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  toggleBatch(batch: string): void {
    if (this.selectedBatches.includes(batch)) {
      this.selectedBatches = this.selectedBatches.filter(b => b !== batch);
    } else {
      this.selectedBatches = [...this.selectedBatches, batch];
    }
    this.applyFilters();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isDropdownOpen = false;
    }
  }

  exportCsv(): void {
    if (!this.rows.length) return;
    const lines: string[] = [];
    lines.push('Student Performance Analytics');
    lines.push(`Range,${this.range.from},${this.range.to}`);
    if (this.selectedBatches.length) {
      lines.push(`Batches,${this.selectedBatches.join('; ')}`);
    }
    if (this.studentNameSearch) {
      lines.push(`Search,${this.studentNameSearch}`);
    }
    lines.push('');
    lines.push('Student Name,Batch,Journey Day,Total Time (min),Sessions,Avg Session (min),Top Page');
    for (const r of this.rows) {
      lines.push(
        [
          this.csvEscape(r.studentName),
          this.csvEscape(r.batch || ''),
          r.journeyDay ?? '',
          this.secondsToMinutes(r.totalSeconds),
          r.sessionsCount,
          this.secondsToMinutes(r.avgSessionSeconds),
          this.csvEscape(r.topPage)
        ].join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `student-analytics-${this.range.from}-${this.range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private csvEscape(s: string): string {
    const v = String(s ?? '');
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }

  /** Convert seconds to minutes for CSV export (one decimal place). */
  private secondsToMinutes(seconds: number): number {
    return Math.round((Math.max(0, seconds || 0) / 60) * 10) / 10;
  }
}
