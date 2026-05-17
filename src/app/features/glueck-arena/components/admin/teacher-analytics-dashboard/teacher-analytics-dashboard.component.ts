import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { GlueckArenaChartComponent } from '../../../shared/glueck-arena-chart/glueck-arena-chart.component';

@Component({
  selector: 'app-teacher-analytics-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MaterialModule, GlueckArenaChartComponent],
  template: `
    <div class="ta" data-ga-theme>
      <div class="ta__header">
        <button mat-icon-button routerLink="/admin/glueck-arena"><mat-icon>arrow_back</mat-icon></button>
        <h1><mat-icon>school</mat-icon> Teacher GlückArena Insights</h1>
      </div>
      <div class="ta__filters">
        <mat-form-field appearance="outline"><mat-label>Batch</mat-label>
          <input matInput [(ngModel)]="batch" (ngModelChange)="load()"></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Course day</mat-label>
          <input matInput type="number" [(ngModel)]="courseDay" (ngModelChange)="load()"></mat-form-field>
      </div>
      <mat-progress-bar *ngIf="loading" mode="indeterminate"></mat-progress-bar>
      <ng-container *ngIf="data && !loading">
        <div class="ta__grid">
          <mat-card><mat-card-title>Accuracy by course day</mat-card-title>
            <app-glueck-arena-chart type="line" [labels]="dayLabels" [datasets]="dayDatasets" [height]="220"></app-glueck-arena-chart>
          </mat-card>
          <mat-card><mat-card-title>Class rankings</mat-card-title>
            <div class="ta__row" *ngFor="let s of data.classRankings?.slice(0,8)">
              <span class="ta__rank">#{{ s.rank }}</span><span>{{ s.name }}</span>
              <span class="ta__acc">{{ s.avgAccuracy }}%</span>
            </div>
          </mat-card>
        </div>
        <div class="ta__grid">
          <mat-card><mat-card-title>Weakest vocabulary</mat-card-title>
            <div *ngFor="let w of data.weakestVocabulary" class="ta__tag">{{ w.word }} ({{ w.misses }} misses)</div>
          </mat-card>
          <mat-card><mat-card-title>Weakest sentences</mat-card-title>
            <div *ngFor="let s of data.weakestSentences" class="ta__sentence">{{ s.sentence }}</div>
          </mat-card>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    .ta { padding: 24px; max-width: 1100px; margin: 0 auto; }
    .ta__header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .ta__filters { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .ta__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    @media (max-width: 768px) { .ta__grid { grid-template-columns: 1fr; } }
    .ta__row { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid #eee; align-items: center; }
    .ta__rank { font-weight: 700; color: #405980; width: 32px; }
    .ta__acc { margin-left: auto; font-weight: 600; color: #2e7d32; }
    .ta__tag { display: inline-block; margin: 4px; padding: 4px 10px; background: #fce4ec; border-radius: 8px; font-size: 13px; }
    .ta__sentence { font-size: 13px; padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
  `]
})
export class TeacherAnalyticsDashboardComponent implements OnInit {
  loading = false;
  data: any = null;
  batch = '';
  courseDay: number | null = null;
  dayLabels: string[] = [];
  dayDatasets: { label: string; data: number[] }[] = [];

  constructor(private svc: InteractiveGameService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    const p: Record<string, string> = {};
    if (this.batch) p['batch'] = this.batch;
    if (this.courseDay) p['courseDay'] = String(this.courseDay);
    this.svc.teacherAnalytics(p).subscribe({
      next: (r) => {
        this.data = r;
        this.dayLabels = (r.accuracyByCourseDay || []).map((d: any) => 'Day ' + d.courseDay);
        this.dayDatasets = [{ label: 'Accuracy %', data: (r.accuracyByCourseDay || []).map((d: any) => d.avgAccuracy) }];
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }
}
