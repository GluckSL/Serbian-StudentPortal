import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { JourneyMapComponent } from './journey-map.component';
import { LoginStreakService, LoginStreakData } from '../../services/login-streak.service';

interface Kpis {
  overallCompletionPct: number; overallDone: number; overallTotal: number;
  resourceCompletionPct: number; resourceDone: number; resourceTotal: number;
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
  loginStreakData: LoginStreakData | null = null;
  rangeMode: 'overall' | 'weekly' = 'weekly';
  private _activeTable: 'classes' | 'exercises' | 'dg' | 'tests' = 'classes';
  get activeTable() { return this._activeTable; }
  set activeTable(v: 'classes' | 'exercises' | 'dg' | 'tests') { this._activeTable = v; this.detailPage = 0; }

  detailPage = 0;
  readonly detailPageSize = 10;
  private overallData: SummaryResponse | null = null;

  barChartData: ChartConfiguration['data'] = { labels: [], datasets: [] };
  barChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Minutes' }
      },
      x: {
        title: { display: true, text: 'Day' }
      }
    }
  };

  timeSpentData: ChartConfiguration['data'] = { labels: [], datasets: [] };
  timeSpentOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Minutes' }
      },
      x: {
        title: { display: true, text: 'Day' }
      }
    }
  };

  constructor(private http: HttpClient, private loginStreakService: LoginStreakService) {}

  ngOnInit(): void {
    this.loadSummary();
    this.fetchOverallForBarChart();
    this.loginStreakService.getLoginStreak().subscribe({
      next: (res) => { this.loginStreakData = res?.data ?? null; },
      error: () => {}
    });
  }

  private fetchOverallForBarChart(): void {
    this.http.get<SummaryResponse>(`${environment.apiUrl}/student-progress/performance-summary?range=overall`, {
      withCredentials: true
    }).subscribe({
      next: (res) => {
        this.overallData = res;
        this.buildBarChart();
        this.buildTimeSpentChart();
      },
      error: () => {}
    });
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
  }

  private buildBarChart(): void {
    const src = this.overallData;
    if (!src) return;
    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const labels: string[] = [];
    const exercisesData: number[] = [];
    const classesData: number[] = [];
    const dgData: number[] = [];

    const currentDay = src.student?.currentCourseDay || 0;
    const dgByDay = new Map<number, number>();
    for (const m of src.dgBotModules || []) {
      if (m.completed) dgByDay.set(m.courseDay, (dgByDay.get(m.courseDay) || 0) + 1);
    }

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const dayStart = d.getTime();
      const dayEnd = next.getTime();

      labels.push(dayNames[d.getDay()]);

      let exCount = 0;
      for (const e of src.exercises) {
        const t = new Date(e.completedAt).getTime();
        if (t >= dayStart && t < dayEnd) exCount++;
      }

      let classCount = 0;
      for (const c of src.liveClasses) {
        if (!c.attended) continue;
        const t = new Date(c.startTime).getTime();
        if (t >= dayStart && t < dayEnd) classCount++;
      }

      const approxCourseDay = currentDay - i;
      const dgCount = dgByDay.get(approxCourseDay) || 0;

      exercisesData.push(exCount);
      classesData.push(classCount);
      dgData.push(dgCount);
    }

    this.barChartData = {
      labels,
      datasets: [
        {
          label: 'Vežbe',
          data: exercisesData,
          backgroundColor: 'rgba(79, 70, 229, 0.75)',
          borderColor: '#4f46e5',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Časovi',
          data: classesData,
          backgroundColor: 'rgba(16, 185, 129, 0.75)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'DG moduli',
          data: dgData,
          backgroundColor: 'rgba(245, 158, 11, 0.75)',
          borderColor: '#f59e0b',
          borderWidth: 1,
          borderRadius: 4,
        }
      ]
    };
    this.barChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top' }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Items Completed' },
          ticks: { stepSize: 1 }
        },
        x: {
          title: { display: true, text: 'Day' }
        }
      }
    };
  }

  private buildTimeSpentChart(): void {
    const src = this.overallData;
    if (!src) return;
    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const labels: string[] = [];
    const data: number[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const dayStart = d.getTime();
      const dayEnd = next.getTime();

      labels.push(dayNames[d.getDay()]);

      let minutes = 0;

      for (const s of src.sessions) {
        const t = new Date(s.createdAt).getTime();
        if (t >= dayStart && t < dayEnd) minutes += s.durationMinutes || 0;
      }
      for (const e of src.exercises) {
        const t = new Date(e.completedAt).getTime();
        if (t >= dayStart && t < dayEnd) minutes += Math.round((e.timeSpentSeconds || 0) / 60);
      }
      for (const c of src.liveClasses) {
        if (!c.hasEnded) continue;
        const t = new Date(c.startTime).getTime();
        if (t >= dayStart && t < dayEnd) minutes += c.duration || 0;
      }

      data.push(minutes);
    }

    this.timeSpentData = {
      labels,
      datasets: [{
        label: 'Utrošeno vreme (min)',
        data,
        backgroundColor: 'rgba(37, 99, 235, 0.7)',
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 6,
      }]
    };
    this.timeSpentOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Minutes' }
        },
        x: {
          title: { display: true, text: 'Day' }
        }
      }
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

  get journeyProgressPct(): number {
    const total = this.data?.student?.journeyLength || 200;
    if (total <= 0) return 0;
    return Math.round((this.currentDay / total) * 100);
  }

  get learningProgressPct(): number {
    const exercises = this.data?.exercises;
    if (!exercises || exercises.length === 0) return 0;
    const total = exercises.reduce((sum, e) => sum + (e.scorePercent || 0), 0);
    return Math.round(total / exercises.length);
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
