import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { PortalAnalyticsRange } from '../../services/portal-analytics-api.service';
import { PortalAnalyticsDashboardComponent } from './dashboard/portal-analytics-dashboard.component';
import { PortalAnalyticsStudentWiseComponent } from './student-wise/portal-analytics-student-wise.component';
import { PortalAnalyticsPageWiseComponent } from './page-wise/portal-analytics-page-wise.component';
import { PortalAnalyticsTimelineComponent } from './timeline/portal-analytics-timeline.component';
import { PortalAnalyticsSessionWiseComponent } from './session-wise/portal-analytics-session-wise.component';
import { PortalAnalyticsLearningComponent } from './learning/portal-analytics-learning.component';

@Component({
  selector: 'app-portal-analytics',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatButtonModule,
    MatTooltipModule,
    PortalAnalyticsDashboardComponent,
    PortalAnalyticsStudentWiseComponent,
    PortalAnalyticsPageWiseComponent,
    PortalAnalyticsTimelineComponent,
    PortalAnalyticsSessionWiseComponent,
    PortalAnalyticsLearningComponent
  ],
  templateUrl: './portal-analytics.component.html',
  styleUrls: ['./portal-analytics.component.scss']
})
export class PortalAnalyticsComponent implements OnInit {
  constructor(private readonly router: Router) {}

  private readonly analyticsTz = 'Asia/Kolkata';
  draftFrom = '';
  draftTo = '';
  range: PortalAnalyticsRange = { from: '', to: '' };
  selectedQuickRange: 'today' | 'lastDate' | 'week' | null = null;
  cohort: 'overall' | 'platinum' | 'go' = 'overall';

  ngOnInit(): void {
    this.setTodayRange();
  }

  applyRange(): void {
    this.selectedQuickRange = null;
    this.range = { from: this.draftFrom, to: this.draftTo, cohort: this.cohort };
  }

  setCohort(c: 'overall' | 'platinum' | 'go'): void {
    this.cohort = c;
    this.range = { ...this.range, cohort: c };
  }

  openDailyLogsInNewTab(): void {
    if (!this.range?.from || !this.range?.to) return;
    const q: Record<string, string> = { from: this.range.from, to: this.range.to };
    if (this.cohort !== 'overall') q['cohort'] = this.cohort;
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/portal-analytics/daily-logs'], { queryParams: q })
    );
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  setTodayRange(): void {
    const today = this.toInputDateInTimeZone(new Date(), this.analyticsTz);
    this.draftFrom = today;
    this.draftTo = today;
    this.selectedQuickRange = 'today';
    this.range = { from: this.draftFrom, to: this.draftTo, cohort: this.cohort };
  }

  setLastDateRange(): void {
    const today = this.toInputDateInTimeZone(new Date(), this.analyticsTz);
    const lastDate = this.addDays(today, -1);
    this.draftFrom = lastDate;
    this.draftTo = lastDate;
    this.selectedQuickRange = 'lastDate';
    this.range = { from: this.draftFrom, to: this.draftTo, cohort: this.cohort };
  }

  setWeekRange(): void {
    const today = this.toInputDateInTimeZone(new Date(), this.analyticsTz);
    this.draftFrom = this.addDays(today, -6);
    this.draftTo = today;
    this.selectedQuickRange = 'week';
    this.range = { from: this.draftFrom, to: this.draftTo, cohort: this.cohort };
  }

  private toInputDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private toInputDateInTimeZone(d: Date, timeZone: string): string {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = fmt.formatToParts(d);
    const year = parts.find((p) => p.type === 'year')?.value || '';
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const day = parts.find((p) => p.type === 'day')?.value || '';
    return `${year}-${month}-${day}`;
  }

  private addDays(ymd: string, days: number): string {
    const date = new Date(`${ymd}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
