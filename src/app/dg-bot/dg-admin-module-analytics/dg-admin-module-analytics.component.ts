import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DgApiService } from '../dg-api.service';
import type { DgChatTurn, DgModuleSessionInsightsResponse } from '../dg-api.service';

@Component({
  selector: 'app-dg-admin-module-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dg-admin-module-analytics.component.html',
  styleUrls: ['./dg-admin-module-analytics.component.scss'],
})
export class DgAdminModuleAnalyticsComponent implements OnInit {
  loading = true;
  error: string | null = null;
  data: DgModuleSessionInsightsResponse | null = null;
  expandedId: string | null = null;

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
