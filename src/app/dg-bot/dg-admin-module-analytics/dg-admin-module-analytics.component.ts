import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { DgApiService } from '../dg-api.service';
import type { DgChatTurn, DgModuleSessionInsightsResponse, DgSessionInsightRow } from '../dg-api.service';

@Component({
  selector: 'app-dg-admin-module-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule, MatPaginatorModule],
  templateUrl: './dg-admin-module-analytics.component.html',
  styleUrls: ['./dg-admin-module-analytics.component.scss'],
})
export class DgAdminModuleAnalyticsComponent implements OnInit {
  loading = true;
  error: string | null = null;
  data: DgModuleSessionInsightsResponse | null = null;
  expandedId: string | null = null;

  pageIndex = 0;
  pageSize = 10;
  readonly pageSizeOptions = [5, 10, 25, 50];
  /** Row placeholders for the loading skeleton table body. */
  readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private dgApi: DgApiService,
  ) {}

  ngOnInit(): void {
    const moduleId = this.route.snapshot.paramMap.get('moduleId');
    if (!moduleId) {
      this.error = 'Missing module.';
      this.loading = false;
      return;
    }
    this.dgApi.getModuleSessionInsights(moduleId).subscribe({
      next: (d) => {
        this.data = d;
        this.pageIndex = 0;
        this.expandedId = null;
        this.loading = false;
      },
      error: (e: any) => {
        this.error = e?.error?.message || 'Failed to load analytics';
        this.loading = false;
      },
    });
  }

  back(): void {
    this.router.navigate(['/admin/dg-modules'], { queryParams: { status: 'all' } });
  }

  toggleExpand(id: string): void {
    this.expandedId = this.expandedId === id ? null : id;
  }

  get pagedSessions(): DgSessionInsightRow[] {
    if (!this.data?.sessions?.length) return [];
    const start = this.pageIndex * this.pageSize;
    return this.data.sessions.slice(start, start + this.pageSize);
  }

  onPageChange(ev: PageEvent): void {
    this.pageIndex = ev.pageIndex;
    this.pageSize = ev.pageSize;
    this.expandedId = null;
  }

  /** Short initials for avatar chips in the chat transcript. */
  initials(name?: string | null): string {
    const n = name?.trim();
    if (!n) return '?';
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  isOutgoingTurn(t: DgChatTurn): boolean {
    return t.speaker === 'student';
  }

  formatDt(iso: string | undefined): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return String(iso);
    }
  }

  statusLabel(completed: boolean): string {
    return completed ? 'Completed' : 'In progress';
  }

  speakerLabel(turn: DgChatTurn): string {
    if (turn.speaker === 'student') return turn.kind === 'practice' ? 'Student (practice)' : 'Student';
    if (turn.speaker === 'hint') return 'Hint';
    return 'Digital guide';
  }

  trackBySession(_: number, s: { _id: string }): string {
    return s._id;
  }
}
