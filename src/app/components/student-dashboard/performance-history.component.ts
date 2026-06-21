import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { JourneyMapComponent } from './journey-map.component';

interface Kpis {
  overallCompletionPct: number; overallDone: number; overallTotal: number;
  exerciseCompleted: number; exerciseTotal: number; exercisePct: number;
  classAttended: number; classTotal: number; classPct: number;
  dgBotCompleted: number; dgBotTotal: number; dgBotPct: number;
  sessionCount: number; avgScore: number; totalStudyMinutes: number; totalVocabulary: number;
}

interface DayRow {
  day: number; exercisesDone: number; classesAttended: number; classesTotal: number;
  avgScore: number; sessions: number; studyMinutes: number;
}

interface CatPerf {
  category: string; attempts: number; avgScore: number;
}

interface Day6Test {
  day: number; type: string; id: string; title: string;
  category: string | null; score: number; timeSpentMinutes: number; status: string;
}

interface SummaryResponse {
  student: any;
  kpis: Kpis;
  dayBreakdown: DayRow[];
  categoryPerformance: CatPerf[];
  day6Tests: Day6Test[];
  exercises: any[];
  liveClasses: any[];
  sessions: any[];
  dgBotModules: any[];
}

@Component({
  selector: 'app-performance-history',
  standalone: true,
  imports: [CommonModule, NgChartsModule, JourneyMapComponent],
  templateUrl: './performance-history.component.html',
  styleUrls: ['./performance-history.component.scss']
})
export class PerformanceHistoryComponent implements OnInit {
  isLoading = true;
  data: SummaryResponse | null = null;
  rangeMode: 'overall' | 'weekly' = 'weekly';
  private _activeTable: 'classes' | 'exercises' | 'dg' | 'tests' = 'classes';
  get activeTable() { return this._activeTable; }
  set activeTable(v: 'classes' | 'exercises' | 'dg' | 'tests') { this._activeTable = v; this.detailPage = 0; }

  detailPage = 0;
  readonly detailPageSize = 10;

  lineChartData: ChartConfiguration['data'] = { labels: [], datasets: [] };
  lineChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top' }
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        title: { display: true, text: 'Score %' }
      }
    }
  };

  radarChartData: ChartConfiguration['data'] = { labels: [], datasets: [] };
  radarChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top' }
    },
    scales: {
      r: {
        beginAtZero: true,
        max: 100,
        ticks: { display: false }
      }
    }
  };

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadSummary();
  }

  setRange(mode: 'overall' | 'weekly'): void {
    if (mode === this.rangeMode) return;
    this.rangeMode = mode;
    this.loadSummary();
  }

  loadSummary(): void {
    this.isLoading = true;
    this.http.get<SummaryResponse>(`${environment.apiUrl}/student-progress/performance-summary?range=${this.rangeMode}`, {
      withCredentials: true
    }).subscribe({
      next: (res) => {
        this.data = res;
        this.buildCharts();
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  private buildCharts(): void {
    if (!this.data) return;
    this.buildLineChart();
    this.buildRadarChart();
  }

  private buildLineChart(): void {
    const raw = this.data!.dayBreakdown;

    const bucketSize = this.rangeMode === 'overall' ? Math.max(1, Math.floor(raw.length / 25)) : 1;
    const bucketed: DayRow[] = [];
    if (bucketSize > 1) {
      for (let i = 0; i < raw.length; i += bucketSize) {
        const slice = raw.slice(i, i + bucketSize);
        let totalScore = 0, scoreCount = 0, totalExercises = 0;
        for (const d of slice) {
          if (d.avgScore > 0) { totalScore += d.avgScore; scoreCount++; }
          totalExercises += d.exercisesDone;
        }
        bucketed.push({
          day: slice[0].day,
          exercisesDone: totalExercises,
          classesAttended: 0, classesTotal: 0,
          avgScore: scoreCount ? Math.round(totalScore / scoreCount) : 0,
          sessions: 0, studyMinutes: 0
        });
      }
    }

    const breakdown = bucketSize > 1 ? bucketed : raw;

    this.lineChartData = {
      labels: breakdown.map(d => String(d.day)),
      datasets: [
        {
          label: 'Avg Score',
          data: breakdown.map(d => d.avgScore),
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 2,
          pointHitRadius: 5
        },
        {
          label: 'Exercises Done',
          data: breakdown.map(d => d.exercisesDone),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 2,
          pointHitRadius: 5,
          yAxisID: 'y1'
        }
      ]
    };
    this.lineChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top' }
      },
      scales: {
        x: {
          title: { display: true, text: 'Days' },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 20
          }
        },
        y: {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: 'Score %' },
          position: 'left'
        },
        y1: {
          beginAtZero: true,
          title: { display: true, text: 'Count' },
          position: 'right',
          grid: { drawOnChartArea: false }
        }
      }
    };
  }

  private buildRadarChart(): void {
    const cats = this.data!.categoryPerformance;
    this.radarChartData = {
      labels: cats.map(c => c.category),
      datasets: [
        {
          label: 'Avg Score by Category',
          data: cats.map(c => c.avgScore),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.2)',
          pointBackgroundColor: '#8b5cf6',
          pointRadius: 4
        }
      ]
    };
  }

  formatMinutes(m: number): string {
    if (m < 60) return `${Math.round(m)}m`;
    const h = Math.floor(m / 60);
    const min = Math.round(m % 60);
    return min ? `${h}h ${min}m` : `${h}h`;
  }

  get studentName(): string {
    return this.data?.student?.name || '';
  }

  get currentDay(): number {
    return this.data?.student?.currentCourseDay || 0;
  }

  get currentTableEmpty(): boolean {
    if (!this.data) return true;
    if (this.activeTable === 'classes') return !this.endedClasses.length;
    if (this.activeTable === 'exercises') return !this.data.exercises.length;
    if (this.activeTable === 'dg') return !this.data.dgBotModules?.length;
    if (this.activeTable === 'tests') return !this.data.day6Tests.length;
    return true;
  }

  get endedClasses(): any[] {
    return this.data?.liveClasses?.filter(c => c.hasEnded) || [];
  }

  get detailTotal(): number {
    if (this._activeTable === 'classes') return this.endedClasses.length;
    if (this._activeTable === 'exercises') return this.data?.exercises.length ?? 0;
    if (this._activeTable === 'dg') return this.data?.dgBotModules?.length ?? 0;
    return this.data?.day6Tests.length ?? 0;
  }
  get detailTotalPages(): number { return Math.max(1, Math.ceil(this.detailTotal / this.detailPageSize)); }

  get pagedClasses(): any[] { return this.endedClasses.slice(this.detailPage * this.detailPageSize, (this.detailPage + 1) * this.detailPageSize); }
  get pagedExercises(): any[] { return (this.data?.exercises ?? []).slice(this.detailPage * this.detailPageSize, (this.detailPage + 1) * this.detailPageSize); }
  get pagedDg(): any[] { return (this.data?.dgBotModules ?? []).slice(this.detailPage * this.detailPageSize, (this.detailPage + 1) * this.detailPageSize); }
  get pagedTests(): any[] { return (this.data?.day6Tests ?? []).slice(this.detailPage * this.detailPageSize, (this.detailPage + 1) * this.detailPageSize); }

  prevPage(): void { if (this.detailPage > 0) this.detailPage--; }
  nextPage(): void { if (this.detailPage < this.detailTotalPages - 1) this.detailPage++; }
}
