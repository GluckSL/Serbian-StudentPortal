import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ZoomService } from '../../services/zoom.service';

interface PortalJoinAbsentRecord {
  studentId: string;
  studentName: string;
  studentEmail: string;
  batch: string;
  batchLevel: string;
  classTopic: string;
  classDate: string;
  classDuration: number;
  meetingId: string;
  portalClickCount: number;
  lastZoomDisplayName: string;
}

@Component({
  selector: 'app-portal-join-alert',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './portal-join-alert.component.html',
  styleUrls: ['./portal-join-alert.component.css'],
})
export class PortalJoinAlertComponent implements OnInit, OnDestroy {
  list: PortalJoinAbsentRecord[] = [];
  loading = true;
  error = '';
  daysFilter = 30;
  totalCount = 0;

  searchQuery = '';
  batchFilter = 'all';
  levelFilter = 'all';
  batchOptions: string[] = [];
  levelOptions: string[] = [];

  currentPage = 1;
  readonly pageSize = 10;
  readonly skeletonRows = Array.from({ length: 10 }, (_, i) => i);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private zoomService: ZoomService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    const days = Number(this.route.snapshot.queryParamMap.get('days'));
    if ([7, 14, 30, 60, 90].includes(days)) {
      this.daysFilter = days;
    }
    this.load();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.zoomService.getPortalJoinAbsentStudents({
      days: this.daysFilter,
      page: this.currentPage,
      limit: this.pageSize,
      search: this.searchQuery.trim(),
      batch: this.batchFilter,
      level: this.levelFilter,
    }).subscribe({
      next: (res) => {
        this.list = (res?.data || []).map((row: PortalJoinAbsentRecord) => ({
          ...row,
          batchLevel: row.batchLevel || '',
        }));
        this.totalCount = res?.total ?? this.list.length;
        this.currentPage = res?.page ?? this.currentPage;
        this.batchOptions = res?.batchOptions || [];
        this.levelOptions = res?.levelOptions || [];
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load data. Please try again.';
        this.loading = false;
      }
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  get pageStart(): number {
    if (!this.totalCount) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalCount);
  }

  onDaysChange(): void {
    this.currentPage = 1;
    this.load();
  }

  onFilterChange(): void {
    this.currentPage = 1;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 300);
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.batchFilter = 'all';
    this.levelFilter = 'all';
    this.currentPage = 1;
    this.load();
  }

  prevPage(): void {
    if (this.currentPage <= 1) return;
    this.currentPage--;
    this.load();
  }

  nextPage(): void {
    if (this.currentPage >= this.totalPages) return;
    this.currentPage++;
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.currentPage = page;
    this.load();
  }

  goBack(): void {
    this.router.navigate(['/admin/zoom-reports']);
  }

  openFix(record: PortalJoinAbsentRecord): void {
    const zoomName = record.lastZoomDisplayName || undefined;
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/teacher/meetings', record.meetingId, 'attendance'], {
        queryParams: {
          from: 'portal-join-alert',
          studentEmail: record.studentEmail,
          studentName: record.studentName,
          zoomName
        }
      })
    );
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
