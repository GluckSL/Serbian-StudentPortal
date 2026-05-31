import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../../services/portal-analytics-api.service';
import { formatPortalDuration } from '../portal-analytics-format';

export interface PortalOverviewData {
  totalTime: number;
  activeStudents: number;
  avgTimePerStudent: number;
  topPage: { page: string; seconds: number } | null;
  topStudent: { studentId: string; name: string; seconds: number } | null;
}

@Component({
  selector: 'app-portal-analytics-overview',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatProgressSpinnerModule],
  templateUrl: './portal-analytics-overview.component.html',
  styleUrls: ['./portal-analytics-overview.component.scss']
})
export class PortalAnalyticsOverviewComponent implements OnChanges {
  @Input({ required: true }) range!: PortalAnalyticsRange;

  loading = false;
  error = '';
  data: PortalOverviewData | null = null;

  constructor(private api: PortalAnalyticsApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['range'] && this.range?.from && this.range?.to) {
      this.load();
    }
  }

  formatDuration = formatPortalDuration;

  private load(): void {
    this.loading = true;
    this.error = '';
    this.api.getOverview(this.range).subscribe({
      next: (res: unknown) => {
        this.data = res as PortalOverviewData;
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load overview.';
        this.loading = false;
      }
    });
  }
}
