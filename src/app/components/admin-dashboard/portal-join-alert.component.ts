import { Component, OnDestroy, OnInit } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { ZoomService } from '../../services/zoom.service';



type PortalJoinStatusFilter = 'unresolved' | 'viewed' | 'fixed';



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

  durationMinutes: number;

  attendancePercent: number;

  needsManualMapping: boolean;
  hasUnmappedZoomMatch?: boolean;
  clickedButNotInZoom?: boolean;
  suggestedZoomName?: string;
  reviewStatus?: 'viewed' | 'fixed' | null;

  reviewedAt?: string | null;

  reviewedByName?: string;

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

  needsMappingCount = 0;
  notInZoomCount = 0;
  viewedCount = 0;

  fixedCount = 0;

  tableTotal = 0;



  searchQuery = '';

  batchFilter = 'all';

  levelFilter = 'all';

  mappingFilter: 'all' | 'needs_mapping' = 'all';

  statusFilter: PortalJoinStatusFilter = 'unresolved';

  batchOptions: string[] = [];

  levelOptions: string[] = [];



  currentPage = 1;

  readonly pageSize = 10;

  readonly skeletonRows = Array.from({ length: 10 }, (_, i) => i);



  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  private reviewingKeys = new Set<string>();



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

      mapping: this.statusFilter === 'unresolved' ? this.mappingFilter : 'all',

      status: this.statusFilter,

    }).subscribe({

      next: (res) => {

        this.list = (res?.data || []).map((row: PortalJoinAbsentRecord) => ({

          ...row,

          batchLevel: row.batchLevel || '',

          durationMinutes: row.durationMinutes ?? 0,

          attendancePercent: row.attendancePercent ?? 0,

          needsManualMapping: row.needsManualMapping ?? false,
          hasUnmappedZoomMatch: row.hasUnmappedZoomMatch ?? false,
          clickedButNotInZoom: row.clickedButNotInZoom ?? false,
          suggestedZoomName: row.suggestedZoomName || '',
        }));
        this.totalCount = res?.totalUnresolved ?? 0;
        this.needsMappingCount = res?.needsMappingCount ?? 0;
        this.notInZoomCount = res?.notInZoomCount ?? 0;

        this.viewedCount = res?.viewedCount ?? 0;

        this.fixedCount = res?.fixedCount ?? 0;

        this.tableTotal = res?.total ?? this.list.length;

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



  get filteredCount(): number {

    if (this.statusFilter === 'viewed') return this.viewedCount;

    if (this.statusFilter === 'fixed') return this.fixedCount;

    if (this.mappingFilter === 'needs_mapping') return this.needsMappingCount;

    return this.totalCount;

  }



  get totalPages(): number {

    return Math.max(1, Math.ceil(this.tableTotal / this.pageSize));

  }



  get pageStart(): number {

    if (!this.tableTotal) return 0;

    return (this.currentPage - 1) * this.pageSize + 1;

  }



  get pageEnd(): number {

    return Math.min(this.currentPage * this.pageSize, this.tableTotal);

  }



  get isUnresolvedTab(): boolean {

    return this.statusFilter === 'unresolved';

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

    this.mappingFilter = 'all';

    this.statusFilter = 'unresolved';

    this.currentPage = 1;

    this.load();

  }



  showUnresolved(): void {

    this.statusFilter = 'unresolved';

    this.mappingFilter = 'all';

    this.currentPage = 1;

    this.load();

  }



  toggleNeedsMappingFilter(): void {

    this.statusFilter = 'unresolved';

    this.mappingFilter = this.mappingFilter === 'needs_mapping' ? 'all' : 'needs_mapping';

    this.currentPage = 1;

    this.load();

  }



  showViewed(): void {

    this.statusFilter = 'viewed';

    this.mappingFilter = 'all';

    this.currentPage = 1;

    this.load();

  }



  showFixed(): void {

    this.statusFilter = 'fixed';

    this.mappingFilter = 'all';

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



  getAttendancePctClass(pct: number): string {

    if (pct >= 75) return 'pja-attendance pja-attendance--ok';

    if (pct > 0) return 'pja-attendance pja-attendance--low';

    return 'pja-attendance pja-attendance--none';

  }



  getAttendancePctHint(pct: number): string {

    if (pct >= 75) return 'Met 75% threshold — may need manual mapping';

    if (pct > 0) return 'Below 75% — absent is correct';

    return 'No matched Zoom time recorded';

  }



  rowKey(record: PortalJoinAbsentRecord): string {

    return `${record.meetingId}:${record.studentId}`;

  }



  isReviewing(record: PortalJoinAbsentRecord): boolean {

    return this.reviewingKeys.has(this.rowKey(record));

  }



  markViewed(record: PortalJoinAbsentRecord): void {

    this.submitReview(record, 'viewed');

  }



  markFixed(record: PortalJoinAbsentRecord): void {

    this.submitReview(record, 'fixed');

  }



  private submitReview(record: PortalJoinAbsentRecord, action: 'viewed' | 'fixed'): void {

    const key = this.rowKey(record);

    if (this.reviewingKeys.has(key)) return;



    this.reviewingKeys.add(key);

    this.zoomService.reviewPortalJoinAbsentCase({

      meetingId: record.meetingId,

      studentId: record.studentId,

      action,

    }).subscribe({

      next: () => {

        this.reviewingKeys.delete(key);

        this.load();

      },

      error: () => {

        this.reviewingKeys.delete(key);

        this.error = `Failed to mark as ${action}. Please try again.`;

      }

    });

  }



  getZoomStatusClass(record: PortalJoinAbsentRecord): string {
    if (record.hasUnmappedZoomMatch) return 'pja-zoom-status pja-zoom-status--match';
    if (record.clickedButNotInZoom) return 'pja-zoom-status pja-zoom-status--missing';
    return 'pja-zoom-status pja-zoom-status--unknown';
  }

  getZoomStatusLabel(record: PortalJoinAbsentRecord): string {
    if (record.hasUnmappedZoomMatch) {
      return record.suggestedZoomName ? `In Zoom: ${record.suggestedZoomName}` : 'Unmapped in Zoom';
    }
    if (record.clickedButNotInZoom) return 'Not in Zoom list';
    return 'Zoom status unknown';
  }

  getZoomStatusHint(record: PortalJoinAbsentRecord): string {
    if (record.hasUnmappedZoomMatch) return 'Name found in Zoom participants — use Fix to map manually';
    if (record.clickedButNotInZoom) return 'Clicked Join but name not in Zoom — likely never joined. Use Viewed if truly absent.';
    return '';
  }

  openFix(record: PortalJoinAbsentRecord): void {
    const zoomName = record.suggestedZoomName || record.lastZoomDisplayName || undefined;

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

