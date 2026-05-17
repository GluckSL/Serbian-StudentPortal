import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { GlueckArenaChartComponent } from '../../../shared/glueck-arena-chart/glueck-arena-chart.component';
import { AdminAnalyticsResponse, GameType } from '../../../glueck-arena.types';

@Component({
  selector: 'app-admin-analytics-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MaterialModule, GlueckArenaChartComponent],
  template: `
    <div class="ga-analytics" data-ga-theme>
      <div class="ga-analytics__header">
        <button mat-icon-button routerLink="/admin/glueck-arena"><mat-icon>arrow_back</mat-icon></button>
        <h1><mat-icon>analytics</mat-icon> GlückArena Analytics</h1>
      </div>

      <div class="ga-analytics__filters">
        <mat-form-field appearance="outline">
          <mat-label>From</mat-label>
          <input matInput type="date" [(ngModel)]="dateFrom" (ngModelChange)="load()">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>To</mat-label>
          <input matInput type="date" [(ngModel)]="dateTo" (ngModelChange)="load()">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Game type</mat-label>
          <mat-select [(ngModel)]="gameType" (ngModelChange)="load()">
            <mat-option value="">All</mat-option>
            <mat-option value="scramble_rush">Scramble Rush</mat-option>
            <mat-option value="sentence_builder">Sentence Builder</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <mat-progress-bar *ngIf="loading" mode="indeterminate"></mat-progress-bar>

      <ng-container *ngIf="data && !loading">
        <div class="ga-kpi-grid">
          <div class="ga-kpi" *ngFor="let k of kpiCards">
            <mat-icon>{{ k.icon }}</mat-icon>
            <span class="ga-kpi__val">{{ k.value }}</span>
            <span class="ga-kpi__lbl">{{ k.label }}</span>
          </div>
        </div>

        <div class="ga-charts-row">
          <mat-card class="ga-chart-card">
            <mat-card-title>Attempts trend</mat-card-title>
            <app-glueck-arena-chart
              type="line"
              [labels]="trendLabels"
              [datasets]="trendDatasets"
              [height]="260"
            ></app-glueck-arena-chart>
          </mat-card>
          <mat-card class="ga-chart-card">
            <mat-card-title>Daily active players</mat-card-title>
            <app-glueck-arena-chart
              type="bar"
              [labels]="dapLabels"
              [datasets]="dapDatasets"
              [height]="260"
            ></app-glueck-arena-chart>
          </mat-card>
        </div>

        <mat-card class="ga-table-card">
          <mat-card-title>Most played games</mat-card-title>
          <table mat-table [dataSource]="data.mostPlayedGames" class="ga-table">
            <ng-container matColumnDef="title">
              <th mat-header-cell *matHeaderCellDef>Game</th>
              <td mat-cell *matCellDef="let r">{{ r.title }}</td>
            </ng-container>
            <ng-container matColumnDef="plays">
              <th mat-header-cell *matHeaderCellDef>Plays</th>
              <td mat-cell *matCellDef="let r">{{ r.plays }}</td>
            </ng-container>
            <ng-container matColumnDef="completed">
              <th mat-header-cell *matHeaderCellDef>Completed</th>
              <td mat-cell *matCellDef="let r">{{ r.completed }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="['title','plays','completed']"></tr>
            <tr mat-row *matRowDef="let row; columns: ['title','plays','completed'];"></tr>
          </table>
        </mat-card>

        <mat-card class="ga-table-card">
          <mat-card-title>Hardest questions</mat-card-title>
          <table mat-table [dataSource]="data.hardestQuestions" class="ga-table">
            <ng-container matColumnDef="content">
              <th mat-header-cell *matHeaderCellDef>Question</th>
              <td mat-cell *matCellDef="let r">{{ r.word || r.correctSentence }}</td>
            </ng-container>
            <ng-container matColumnDef="errorRate">
              <th mat-header-cell *matHeaderCellDef>Error rate</th>
              <td mat-cell *matCellDef="let r">{{ r.errorRate }}%</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="['content','errorRate']"></tr>
            <tr mat-row *matRowDef="let row; columns: ['content','errorRate'];"></tr>
          </table>
        </mat-card>
      </ng-container>
    </div>
  `,
  styles: [`
    .ga-analytics { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .ga-analytics__header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .ga-analytics__header h1 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 22px; color: var(--ga-primary, #405980); }
    .ga-analytics__filters { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .ga-kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .ga-kpi { background: var(--ga-card-bg, #fff); border-radius: 14px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.06); text-align: center; }
    .ga-kpi mat-icon { color: var(--ga-primary, #405980); }
    .ga-kpi__val { display: block; font-size: 22px; font-weight: 800; color: var(--ga-text, #2c3e50); }
    .ga-kpi__lbl { font-size: 11px; color: var(--ga-muted, #888); }
    .ga-charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    @media (max-width: 768px) { .ga-charts-row { grid-template-columns: 1fr; } }
    .ga-chart-card, .ga-table-card { margin-bottom: 16px; padding: 8px; }
    .ga-table { width: 100%; }
  `]
})
export class AdminAnalyticsDashboardComponent implements OnInit {
  loading = false;
  data: AdminAnalyticsResponse | null = null;
  dateFrom = '';
  dateTo = '';
  gameType = '';
  kpiCards: { icon: string; label: string; value: string | number }[] = [];

  trendLabels: string[] = [];
  trendDatasets: { label: string; data: number[] }[] = [];
  dapLabels: string[] = [];
  dapDatasets: { label: string; data: number[] }[] = [];

  constructor(private svc: InteractiveGameService) {}

  ngOnInit() {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000);
    this.dateTo = to.toISOString().slice(0, 10);
    this.dateFrom = from.toISOString().slice(0, 10);
    this.load();
  }

  load() {
    this.loading = true;
    const params: Record<string, string> = {};
    if (this.dateFrom) params['dateFrom'] = this.dateFrom;
    if (this.dateTo) params['dateTo'] = this.dateTo;
    if (this.gameType) params['gameType'] = this.gameType;

    this.svc.adminAnalytics(params).subscribe({
      next: (r) => {
        this.data = r;
        this.buildKpis(r);
        this.buildCharts(r);
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  buildKpis(r: AdminAnalyticsResponse) {
    const k = r.kpis;
    this.kpiCards = [
      { icon: 'play_circle', label: 'Attempts', value: k.attemptsStarted },
      { icon: 'check_circle', label: 'Completion %', value: k.completionRate + '%' },
      { icon: 'track_changes', label: 'Avg accuracy', value: k.averageAccuracy + '%' },
      { icon: 'bolt', label: 'Total XP', value: k.totalXpEarned },
      { icon: 'timer', label: 'Avg session', value: Math.round(k.avgSessionSeconds / 60) + 'm' },
      { icon: 'mood_bad', label: 'Rage quit %', value: k.rageQuitPercent + '%' },
      { icon: 'people', label: 'LB engaged', value: k.leaderboardEngagedPlayers },
    ];
  }

  buildCharts(r: AdminAnalyticsResponse) {
    this.trendLabels = (r.attemptsTrend || []).map(t => t.date);
    this.trendDatasets = [
      { label: 'Attempts', data: (r.attemptsTrend || []).map(t => t.attempts) },
      { label: 'Completed', data: (r.attemptsTrend || []).map(t => t.completed) },
    ];
    this.dapLabels = (r.dailyActivePlayers || []).map(d => d.date);
    this.dapDatasets = [{ label: 'Players', data: (r.dailyActivePlayers || []).map(d => d.count) }];
  }
}
