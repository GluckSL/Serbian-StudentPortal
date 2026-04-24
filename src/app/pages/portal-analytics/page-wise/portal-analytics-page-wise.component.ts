import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration, ChartType } from 'chart.js';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../../services/portal-analytics-api.service';
import { formatPortalDuration } from '../portal-analytics-format';

export interface PageWiseRow {
  page: string;
  totalSeconds: number;
  uniqueStudents: number;
  avgSecondsPerUser: number;
  pctOfTracked: number;
}

@Component({
  selector: 'app-portal-analytics-page-wise',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, NgChartsModule],
  templateUrl: './portal-analytics-page-wise.component.html',
  styleUrls: ['./portal-analytics-page-wise.component.scss']
})
export class PortalAnalyticsPageWiseComponent implements OnChanges {
  @Input({ required: true }) range!: PortalAnalyticsRange;

  loading = false;
  error = '';
  rows: PageWiseRow[] = [];

  miniType: ChartType = 'doughnut';
  miniData: ChartConfiguration['data'] = { labels: [], datasets: [] };
  miniOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } }
  };

  readonly Math = Math;

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
    this.api.getPageWise(this.range).subscribe({
      next: (res: unknown) => {
        const body = res as { items?: PageWiseRow[] };
        this.rows = body.items || [];
        this.buildMini(this.rows);
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load page data.';
        this.loading = false;
      }
    });
  }

  private buildMini(rows: PageWiseRow[]): void {
    const top = rows.slice(0, 6);
    const labels = top.map((r) => (r.page.length > 28 ? r.page.slice(0, 28) + '…' : r.page));
    const values = top.map((r) => r.totalSeconds);
    const palette = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];
    this.miniData = {
      labels: labels.length ? labels : ['—'],
      datasets: [
        {
          data: values.length ? values : [1],
          backgroundColor: labels.map((_, i) => palette[i % palette.length]),
          borderWidth: 0
        }
      ]
    };
  }
}
