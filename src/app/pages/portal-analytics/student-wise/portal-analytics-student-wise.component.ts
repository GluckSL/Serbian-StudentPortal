import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
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
  imports: [CommonModule, MatProgressSpinnerModule, MatIconModule, MatButtonModule],
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

  constructor(private api: PortalAnalyticsApiService) {}

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
        this.rows = body.items || [];
        this.currentPage = 1;
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load student data.';
        this.loading = false;
      }
    });
  }
}
