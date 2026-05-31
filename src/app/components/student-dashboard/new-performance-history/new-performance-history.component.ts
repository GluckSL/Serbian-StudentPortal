import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

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
  selector: 'app-new-performance-history',
  standalone: true,
  imports: [CommonModule, NgChartsModule],
  templateUrl: './new-performance-history.component.html',
  styleUrls: ['./new-performance-history.component.scss']
})
export class NewPerformanceHistoryComponent implements OnInit {
  isLoading = true;
  data: SummaryResponse | null = null;
  rangeMode: 'overall' | 'weekly' = 'overall';
  activeTable: 'classes' | 'exercises' | 'dg' | 'tests' = 'classes';

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
    const breakdown = this.data!.dayBreakdown;
    this.lineChartData = {
      labels: breakdown.map(d => String(d.day)),
      datasets: [
        {
          label: 'Avg Score',
          data: breakdown.map(d => d.avgScore),
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3
        },
        {
          label: 'Exercises Done',
          data: breakdown.map(d => d.exercisesDone),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
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
}
