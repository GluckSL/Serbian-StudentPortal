import { Component, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { GlueckArenaChartComponent } from '../../../shared/glueck-arena-chart/glueck-arena-chart.component';
import { AdminAnalyticsResponse, StudentArenaStat } from '../../../glueck-arena.types';
import { environment } from '../../../../../../environments/environment';

interface BatchSummary { batchName: string; }

@Component({
  selector: 'app-admin-analytics-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MaterialModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    GlueckArenaChartComponent,
  ],
  template: `
    <div class="ga-page" data-ga-theme>
      <header class="ga-hero">
        <div class="ga-hero__copy">
          <button mat-mini-fab class="ga-hero__back" routerLink="/admin/glueck-arena" aria-label="Back">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <div class="ga-hero__badge"><mat-icon>sports_esports</mat-icon> GlückArena</div>
          <h1>Analytics</h1>
          <p>Track student time, scores, and XP. Filter by batch to see every student in a cohort.</p>
        </div>
      </header>

      <div class="ga-toolbar">
        <div class="ga-toolbar__search">
          <mat-icon>search</mat-icon>
          <input type="search" [(ngModel)]="studentSearch" (ngModelChange)="applyStudentFilter()"
            placeholder="Search students…" aria-label="Search students" [disabled]="loading">
        </div>
        <mat-form-field appearance="outline" class="ga-toolbar__field">
          <mat-label>Batch</mat-label>
          <mat-select [(ngModel)]="batch" (ngModelChange)="load()" [disabled]="loading">
            <mat-option value="">All batches</mat-option>
            <mat-option *ngFor="let b of batches" [value]="b.batchName">{{ b.batchName }}</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="ga-toolbar__field ga-toolbar__field--date">
          <mat-label>From</mat-label>
          <input matInput type="date" [(ngModel)]="dateFrom" (ngModelChange)="load()" [disabled]="loading">
        </mat-form-field>
        <mat-form-field appearance="outline" class="ga-toolbar__field ga-toolbar__field--date">
          <mat-label>To</mat-label>
          <input matInput type="date" [(ngModel)]="dateTo" (ngModelChange)="load()" [disabled]="loading">
        </mat-form-field>
        <mat-form-field appearance="outline" class="ga-toolbar__field">
          <mat-label>Game type</mat-label>
          <mat-select [(ngModel)]="gameType" (ngModelChange)="load()" [disabled]="loading">
            <mat-option value="">All types</mat-option>
            <mat-option value="scramble_rush">Scramble Rush</mat-option>
            <mat-option value="sentence_builder">Sentence Builder</mat-option>
            <mat-option value="matching">Matching</mat-option>
            <mat-option value="flashcards">Flashcards</mat-option>
            <mat-option value="image_matching">Image Matching</mat-option>
            <mat-option value="gender_stack">Gender Stack</mat-option>
            <mat-option value="flapjugation">Flapjugation</mat-option>
            <mat-option value="whackawort">Whack-a-Wort</mat-option>
            <mat-option value="memory">Memory Game</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <!-- Skeleton loading -->
      <ng-container *ngIf="loading">
        <div class="ga-stats" aria-busy="true" aria-label="Loading analytics">
          <div class="ga-stat ga-stat--skeleton" *ngFor="let _ of skeletonStatCards">
            <div class="ga-skeleton ga-skeleton--icon"></div>
            <div class="ga-skeleton ga-skeleton--value"></div>
            <div class="ga-skeleton ga-skeleton--label"></div>
          </div>
        </div>
        <section class="ga-section">
          <div class="ga-section__head">
            <div class="ga-skeleton ga-skeleton--title"></div>
          </div>
          <div class="ga-table-card">
            <div class="ga-skeleton-table">
              <div class="ga-skeleton-table__head">
                <div class="ga-skeleton ga-skeleton--th" *ngFor="let _ of skeletonColumns"></div>
              </div>
              <div class="ga-skeleton-table__row" *ngFor="let _ of skeletonRows">
                <div class="ga-skeleton ga-skeleton--cell ga-skeleton--cell-name"></div>
                <div class="ga-skeleton ga-skeleton--cell" *ngFor="let __ of skeletonColumns.slice(1)"></div>
              </div>
            </div>
          </div>
        </section>
        <div class="ga-charts-row">
          <div class="ga-chart-card ga-chart-card--skeleton" *ngFor="let _ of [0, 1]">
            <div class="ga-skeleton ga-skeleton--chart-title"></div>
            <div class="ga-skeleton ga-skeleton--chart"></div>
          </div>
        </div>
      </ng-container>

      <ng-container *ngIf="data && !loading">
        <div class="ga-stats">
          <div class="ga-stat" *ngFor="let k of kpiCards">
            <mat-icon class="ga-stat__icon">{{ k.icon }}</mat-icon>
            <span class="ga-stat__value">{{ k.value }}</span>
            <span class="ga-stat__label">{{ k.label }}</span>
          </div>
        </div>

        <section class="ga-section">
          <div class="ga-section__head">
            <h2><mat-icon>groups</mat-icon> Student performance</h2>
            <span class="ga-section__meta" *ngIf="batch">
              {{ filteredStudents.length }} of {{ data.kpis.studentsInBatch ?? filteredStudents.length }} in {{ batch }}
            </span>
            <span class="ga-section__meta" *ngIf="!batch">
              Top {{ filteredStudents.length }} active students — select a batch to see full roster
            </span>
          </div>
          <div class="ga-table-card">
            <div class="ga-table-scroll">
            <table mat-table [dataSource]="studentDataSource" matSort class="ga-table">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef mat-sort-header>Student</th>
                <td mat-cell *matCellDef="let r">
                  <div class="ga-student-cell">
                    <span class="ga-student-cell__name">{{ r.name }}</span>
                    <span class="ga-student-cell__batch" *ngIf="!batch && r.batch">{{ r.batch }}</span>
                  </div>
                </td>
              </ng-container>
              <ng-container matColumnDef="totalTimeSeconds">
                <th mat-header-cell *matHeaderCellDef mat-sort-header>Time spent</th>
                <td mat-cell *matCellDef="let r">{{ formatDuration(r.totalTimeSeconds) }}</td>
              </ng-container>
              <ng-container matColumnDef="attempts">
                <th mat-header-cell *matHeaderCellDef mat-sort-header>Attempts</th>
                <td mat-cell *matCellDef="let r">{{ r.attempts }}</td>
              </ng-container>
              <ng-container matColumnDef="completed">
                <th mat-header-cell *matHeaderCellDef mat-sort-header>Completed</th>
                <td mat-cell *matCellDef="let r">{{ r.completed }}</td>
              </ng-container>
              <ng-container matColumnDef="totalScore">
                <th mat-header-cell *matHeaderCellDef mat-sort-header>Score</th>
                <td mat-cell *matCellDef="let r"><span class="ga-score">{{ r.totalScore }}</span></td>
              </ng-container>
              <ng-container matColumnDef="totalXp">
                <th mat-header-cell *matHeaderCellDef mat-sort-header>XP</th>
                <td mat-cell *matCellDef="let r"><span class="ga-xp">{{ r.totalXp }}</span></td>
              </ng-container>
              <ng-container matColumnDef="avgAccuracy">
                <th mat-header-cell *matHeaderCellDef mat-sort-header>Accuracy</th>
                <td mat-cell *matCellDef="let r">
                  <span class="ga-acc" [class.ga-acc--low]="r.avgAccuracy < 50" [class.ga-acc--high]="r.avgAccuracy >= 70">
                    {{ r.avgAccuracy }}%
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="lastActivity">
                <th mat-header-cell *matHeaderCellDef mat-sort-header>Last active</th>
                <td mat-cell *matCellDef="let r">{{ formatLastActive(r.lastActivity) }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="studentColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: studentColumns;" class="ga-table__row"></tr>
              <tr class="ga-table__empty" *matNoDataRow>
                <td [attr.colspan]="studentColumns.length">No students match your search.</td>
              </tr>
            </table>
            </div>
            <mat-paginator
              class="ga-paginator"
              [pageSizeOptions]="pageSizeOptions"
              [pageSize]="pageSize"
              showFirstLastButtons
              aria-label="Student table pagination">
            </mat-paginator>
          </div>
        </section>

        <div class="ga-charts-row">
          <mat-card class="ga-chart-card">
            <mat-card-title>Attempts trend</mat-card-title>
            <app-glueck-arena-chart type="line" [labels]="trendLabels" [datasets]="trendDatasets" [height]="260"></app-glueck-arena-chart>
          </mat-card>
          <mat-card class="ga-chart-card">
            <mat-card-title>Daily active players</mat-card-title>
            <app-glueck-arena-chart type="bar" [labels]="dapLabels" [datasets]="dapDatasets" [height]="260"></app-glueck-arena-chart>
          </mat-card>
        </div>

        <div class="ga-insights-grid">
          <mat-card class="ga-insight-card">
            <mat-card-title>Most played games</mat-card-title>
            <table mat-table [dataSource]="data.mostPlayedGames || []" class="ga-table ga-table--compact">
              <ng-container matColumnDef="title">
                <th mat-header-cell *matHeaderCellDef>Game</th>
                <td mat-cell *matCellDef="let r">{{ r.title || 'Untitled' }}</td>
              </ng-container>
              <ng-container matColumnDef="plays">
                <th mat-header-cell *matHeaderCellDef>Plays</th>
                <td mat-cell *matCellDef="let r">{{ r.plays }}</td>
              </ng-container>
              <ng-container matColumnDef="completed">
                <th mat-header-cell *matHeaderCellDef>Done</th>
                <td mat-cell *matCellDef="let r">{{ r.completed }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="['title','plays','completed']"></tr>
              <tr mat-row *matRowDef="let row; columns: ['title','plays','completed'];"></tr>
            </table>
          </mat-card>
          <mat-card class="ga-insight-card">
            <mat-card-title>Hardest questions</mat-card-title>
            <table mat-table [dataSource]="data.hardestQuestions || []" class="ga-table ga-table--compact">
              <ng-container matColumnDef="content">
                <th mat-header-cell *matHeaderCellDef>Question</th>
                <td mat-cell *matCellDef="let r">{{ r.word || r.correctSentence || '—' }}</td>
              </ng-container>
              <ng-container matColumnDef="errorRate">
                <th mat-header-cell *matHeaderCellDef>Error</th>
                <td mat-cell *matCellDef="let r"><span class="ga-acc ga-acc--low">{{ r.errorRate }}%</span></td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="['content','errorRate']"></tr>
              <tr mat-row *matRowDef="let row; columns: ['content','errorRate'];"></tr>
            </table>
          </mat-card>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    .ga-page {
      padding: 24px 28px 48px; max-width: 1400px; margin: 0 auto;
      background: linear-gradient(180deg, #faf5ff 0%, #f8fafc 120px, #f8fafc 100%);
      min-height: 100%;
    }
    .ga-hero {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; flex-wrap: wrap;
      padding: 28px 32px 28px 88px; border-radius: 24px; margin-bottom: 24px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 45%, #c084fc 100%);
      color: #fff; box-shadow: 0 16px 48px rgba(99, 102, 241, 0.28);
      position: relative; overflow: hidden;
    }
    .ga-hero::before {
      content: ''; position: absolute; top: -40%; right: -8%; width: 280px; height: 280px;
      background: radial-gradient(circle, rgba(251, 191, 36, 0.35) 0%, transparent 70%);
      pointer-events: none;
    }
    .ga-hero__back {
      position: absolute; top: 20px; left: 20px;
      background: rgba(255, 255, 255, 0.2) !important;
      color: #fff !important; box-shadow: none !important;
      border-radius: 50% !important;
      backdrop-filter: blur(8px);
      transition: background 0.2s, transform 0.15s;
    }
    .ga-hero__back:hover { background: rgba(255, 255, 255, 0.32) !important; transform: scale(1.05); }
    .ga-hero__copy { position: relative; z-index: 1; }
    .ga-hero h1 { margin: 8px 0 6px; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
    .ga-hero p { margin: 0; opacity: 0.92; max-width: 560px; line-height: 1.5; font-size: 14px; }
    .ga-hero__badge {
      display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em;
      background: rgba(255, 255, 255, 0.18); padding: 6px 14px; border-radius: 999px;
    }
    .ga-hero__badge mat-icon { font-size: 16px; width: 16px; height: 16px; color: #fde68a; }
    .ga-toolbar {
      display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 20px;
      background: #fff; padding: 14px 18px; border-radius: 20px;
      border: 1px solid #ede9fe; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.06);
    }
    .ga-toolbar__search {
      flex: 1; min-width: 180px; display: flex; align-items: center; gap: 10px;
      padding: 0 18px; height: 48px; border-radius: 999px;
      background: #f5f3ff; border: 1.5px solid #e9d5ff;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .ga-toolbar__search:focus-within {
      border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.2);
    }
    .ga-toolbar__search mat-icon { color: #a78bfa; }
    .ga-toolbar__search input { flex: 1; border: none; background: transparent; outline: none; font-size: 14px; color: #334155; }
    .ga-toolbar__field { margin: 0; min-width: 140px; }
    .ga-toolbar__field--date { min-width: 150px; }
    :host ::ng-deep .ga-toolbar__field .mat-mdc-text-field-wrapper { border-radius: 16px !important; }
    :host ::ng-deep .ga-toolbar__field .mdc-notched-outline__leading { border-radius: 16px 0 0 16px !important; }
    :host ::ng-deep .ga-toolbar__field .mdc-notched-outline__trailing { border-radius: 0 16px 16px 0 !important; }
    .ga-stats {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 14px; margin-bottom: 28px;
    }
    .ga-stat {
      background: #fff; border-radius: 20px; padding: 16px 18px; border: 1px solid #ede9fe;
      box-shadow: 0 4px 16px rgba(99, 102, 241, 0.07); position: relative; padding-top: 36px;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .ga-stat:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(99, 102, 241, 0.12); }
    .ga-stat__icon { position: absolute; top: 12px; left: 14px; font-size: 20px; width: 20px; height: 20px; color: #8b5cf6; opacity: 0.85; }
    .ga-stat__value { display: block; font-size: 24px; font-weight: 800; color: #4338ca; line-height: 1.1; }
    .ga-stat__label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
    .ga-section { margin-bottom: 28px; }
    .ga-section__head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    .ga-section__head h2 {
      margin: 0; font-size: 18px; font-weight: 700; color: #4338ca;
      display: flex; align-items: center; gap: 8px;
    }
    .ga-section__head h2 mat-icon { color: #f59e0b; }
    .ga-section__meta { font-size: 13px; color: #64748b; margin-left: auto; }
    .ga-table-card {
      background: #fff; border-radius: 20px; border: 1px solid #ede9fe;
      overflow: hidden; box-shadow: 0 4px 24px rgba(99, 102, 241, 0.08);
    }
    .ga-table-scroll { overflow-x: auto; }
    .ga-table { width: 100%; }
    .ga-table th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; font-weight: 600; background: #faf5ff; }
    .ga-table__row:hover { background: #f5f3ff; }
    .ga-table__empty td { text-align: center; padding: 32px; color: #94a3b8; }
    .ga-student-cell__name { font-weight: 600; color: #1e293b; }
    .ga-student-cell__batch { display: block; font-size: 12px; color: #94a3b8; }
    .ga-score { font-weight: 700; color: #6366f1; }
    .ga-xp { color: #d97706; font-weight: 700; }
    .ga-acc { font-weight: 600; }
    .ga-acc--high { color: #16a34a; }
    .ga-acc--low { color: #dc2626; }
    .ga-paginator {
      border-top: 1px solid #ede9fe; background: #faf5ff;
      border-radius: 0 0 20px 20px;
    }
    :host ::ng-deep .ga-paginator .mat-mdc-icon-button { border-radius: 50% !important; }
    :host ::ng-deep .ga-paginator .mat-mdc-select-trigger { border-radius: 999px; }
    .ga-charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .ga-chart-card {
      padding: 20px; border-radius: 20px; border: 1px solid #ede9fe;
      box-shadow: 0 4px 16px rgba(99, 102, 241, 0.06);
    }
    :host ::ng-deep .ga-chart-card .mat-mdc-card-title { color: #4338ca; font-weight: 700; }
    .ga-insights-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .ga-insight-card {
      padding: 20px; border-radius: 20px; border: 1px solid #ede9fe;
      box-shadow: 0 4px 16px rgba(99, 102, 241, 0.06);
    }
    :host ::ng-deep .ga-insight-card .mat-mdc-card-title { color: #4338ca; font-weight: 700; }
    .ga-table--compact td, .ga-table--compact th { padding: 10px 12px !important; }

    /* Skeleton loading */
    @keyframes ga-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    .ga-skeleton {
      background: linear-gradient(90deg, #f1f5f9 25%, #e9d5ff 50%, #f1f5f9 75%);
      background-size: 200% 100%;
      animation: ga-shimmer 1.5s ease infinite;
      border-radius: 12px;
    }
    .ga-stat--skeleton { padding-top: 16px; pointer-events: none; }
    .ga-skeleton--icon { width: 24px; height: 24px; border-radius: 8px; margin-bottom: 10px; }
    .ga-skeleton--value { height: 28px; width: 70%; margin-bottom: 8px; border-radius: 10px; }
    .ga-skeleton--label { height: 12px; width: 55%; border-radius: 6px; }
    .ga-skeleton--title { height: 22px; width: 200px; border-radius: 10px; }
    .ga-skeleton-table { padding: 0; }
    .ga-skeleton-table__head {
      display: grid; grid-template-columns: 1.4fr repeat(7, 1fr);
      gap: 12px; padding: 14px 20px; background: #faf5ff; border-bottom: 1px solid #ede9fe;
    }
    .ga-skeleton--th { height: 14px; border-radius: 6px; }
    .ga-skeleton-table__row {
      display: grid; grid-template-columns: 1.4fr repeat(7, 1fr);
      gap: 12px; padding: 16px 20px; border-bottom: 1px solid #f1f5f9;
    }
    .ga-skeleton--cell { height: 16px; border-radius: 8px; }
    .ga-skeleton--cell-name { height: 32px; }
    .ga-chart-card--skeleton { background: #fff; }
    .ga-skeleton--chart-title { height: 20px; width: 160px; margin-bottom: 16px; border-radius: 8px; }
    .ga-skeleton--chart { height: 220px; border-radius: 16px; }

    @media (max-width: 900px) {
      .ga-page { padding: 16px; }
      .ga-hero { padding-left: 32px; padding-top: 72px; }
      .ga-hero__back { top: 16px; left: 16px; }
      .ga-charts-row, .ga-insights-grid { grid-template-columns: 1fr; }
      .ga-toolbar__field { min-width: 100%; flex: 1 1 100%; }
      .ga-skeleton-table__head, .ga-skeleton-table__row {
        grid-template-columns: 1fr 1fr;
      }
    }
  `]
})
export class AdminAnalyticsDashboardComponent implements OnInit, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  loading = false;
  data: AdminAnalyticsResponse | null = null;
  dateFrom = '';
  dateTo = '';
  gameType = '';
  batch = '';
  batches: BatchSummary[] = [];
  studentSearch = '';

  pageSize = 10;
  readonly pageSizeOptions = [10, 25, 50, 100];
  readonly skeletonStatCards = [0, 1, 2, 3, 4, 5, 6];
  readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];
  readonly skeletonColumns = [0, 1, 2, 3, 4, 5, 6, 7];

  kpiCards: { icon: string; label: string; value: string | number }[] = [];
  trendLabels: string[] = [];
  trendDatasets: { label: string; data: number[] }[] = [];
  dapLabels: string[] = [];
  dapDatasets: { label: string; data: number[] }[] = [];

  studentColumns = ['name', 'totalTimeSeconds', 'attempts', 'completed', 'totalScore', 'totalXp', 'avgAccuracy', 'lastActivity'];
  studentDataSource = new MatTableDataSource<StudentArenaStat>([]);
  allStudents: StudentArenaStat[] = [];
  filteredStudents: StudentArenaStat[] = [];

  constructor(
    private svc: InteractiveGameService,
    private http: HttpClient,
  ) {}

  ngOnInit() {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000);
    this.dateTo = to.toISOString().slice(0, 10);
    this.dateFrom = from.toISOString().slice(0, 10);
    this.loadBatches();
    this.load();
  }

  ngAfterViewInit() {
    this.studentDataSource.sort = this.sort;
    this.studentDataSource.paginator = this.paginator;
    this.studentDataSource.sortingDataAccessor = (row, col) => {
      switch (col) {
        case 'name': return row.name;
        case 'totalTimeSeconds': return row.totalTimeSeconds;
        case 'attempts': return row.attempts;
        case 'completed': return row.completed;
        case 'totalScore': return row.totalScore;
        case 'totalXp': return row.totalXp;
        case 'avgAccuracy': return row.avgAccuracy;
        case 'lastActivity': return row.lastActivity ? new Date(row.lastActivity).getTime() : 0;
        default: return '';
      }
    };
  }

  loadBatches() {
    this.http.get<{ batches: BatchSummary[] }>(`${environment.apiUrl}/batch-journey`, { withCredentials: true })
      .subscribe({
        next: (res) => {
          this.batches = (res?.batches || []).sort((a, b) => a.batchName.localeCompare(b.batchName));
        },
        error: () => { this.batches = []; },
      });
  }

  load() {
    this.loading = true;
    const params: Record<string, string> = {};
    if (this.dateFrom) params['dateFrom'] = this.dateFrom;
    if (this.dateTo) params['dateTo'] = this.dateTo;
    if (this.gameType) params['gameType'] = this.gameType;
    if (this.batch) params['batch'] = this.batch;

    this.svc.adminAnalytics(params).subscribe({
      next: (r) => {
        this.data = r;
        this.allStudents = r.studentStats || [];
        this.applyStudentFilter();
        this.buildKpis(r);
        this.buildCharts(r);
        this.loading = false;
        setTimeout(() => {
          if (this.sort) this.studentDataSource.sort = this.sort;
          if (this.paginator) this.studentDataSource.paginator = this.paginator;
        });
      },
      error: () => { this.loading = false; },
    });
  }

  applyStudentFilter() {
    const q = this.studentSearch.trim().toLowerCase();
    this.filteredStudents = q
      ? this.allStudents.filter(s =>
          s.name?.toLowerCase().includes(q) || s.batch?.toLowerCase().includes(q))
      : [...this.allStudents];
    this.studentDataSource.data = this.filteredStudents;
    this.studentDataSource.paginator?.firstPage();
  }

  buildKpis(r: AdminAnalyticsResponse) {
    const k = r.kpis;
    this.kpiCards = [
      { icon: 'groups', label: 'Active students', value: k.uniqueStudents ?? 0 },
      { icon: 'play_circle', label: 'Attempts', value: k.attemptsStarted },
      { icon: 'check_circle', label: 'Completion', value: k.completionRate + '%' },
      { icon: 'track_changes', label: 'Avg accuracy', value: k.averageAccuracy + '%' },
      { icon: 'bolt', label: 'Total XP', value: k.totalXpEarned },
      { icon: 'timer', label: 'Avg session', value: this.formatDuration(k.avgSessionSeconds) },
      { icon: 'mood_bad', label: 'Rage quit', value: k.rageQuitPercent + '%' },
    ];
    if (this.batch && k.studentsInBatch != null) {
      this.kpiCards.unshift({
        icon: 'class',
        label: 'In batch',
        value: k.studentsInBatch,
      });
    }
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

  formatDuration(seconds: number): string {
    if (!seconds || seconds < 60) return seconds ? `${seconds}s` : '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  formatLastActive(d: string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
