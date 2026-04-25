import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
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
    MatSlideToggleModule,
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
  draftFrom = '';
  draftTo = '';
  range: PortalAnalyticsRange = { from: '', to: '' };
  includeHistorical = false;

  ngOnInit(): void {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000);
    this.draftTo = this.toInputDate(to);
    this.draftFrom = this.toInputDate(from);
    this.applyRange();
  }

  applyRange(): void {
    this.range = { from: this.draftFrom, to: this.draftTo };
  }

  onHistoricalToggle(): void {
    this.range = { ...this.range };
  }

  private toInputDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
