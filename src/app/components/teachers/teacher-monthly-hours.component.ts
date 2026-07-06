import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { environment } from '../../../environments/environment';
import { getAuthToken } from '../../services/auth.service';

const apiUrl = environment.apiUrl;
const TDS_PERCENT = 10;

interface MonthlyHourBreakdown {
  batch: string;
  level: string;
  studentCount: number;
  meetingCount: number;
  tutorMinutes: number;
  tutorHours: number;
  bonusEligible: boolean;
  bonusHours: number;
  bonusAmount: number;
  attendance: number | null;
}

interface MonthlyHourMeeting {
  _id: string;
  topic: string;
  batch: string;
  level: string;
  startTime: string;
  scheduledMinutes: number;
  durationSource: string;
  present: number;
  late: number;
  absent: number;
  attendanceRate: number | null;
}

interface MonthlyHoursData {
  teacher: {
    _id: string;
    name: string;
    regNo: string;
    email: string;
    medium: string;
    levels: string[];
    levelHourlyRates?: Record<string, number>;
    noTds?: boolean;
  };
  month: string;
  monthLabel: string;
  totals: {
    totalMinutes: number;
    totalHours: number;
    totalMeetings: number;
    totalStudents: number;
    recordedDurationMeetings: number;
    estimatedDurationMeetings: number;
    bonusRate: number;
    bonusThreshold: number;
    totalBonus: number;
  };
  batchBreakdown: MonthlyHourBreakdown[];
  meetings: MonthlyHourMeeting[];
}

@Component({
  selector: 'app-teacher-monthly-hours',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './teacher-monthly-hours.component.html',
  styleUrls: ['./teacher-analytics-overview.component.css'],
})
export class TeacherMonthlyHoursComponent implements OnInit {
  loading = true;
  error = '';
  teacherId = '';
  selectedMonth = this.getCurrentMonth();
  data: MonthlyHoursData | null = null;
  isTeacherSelfView = false;
  private allLevelRates: Record<string, Record<string, number>> = {};

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
  ) {}

  ngOnInit(): void {
    this.teacherId = this.route.snapshot.paramMap.get('id') || '';
    this.isTeacherSelfView = !this.teacherId;
    this.selectedMonth = this.route.snapshot.queryParamMap.get('month') || this.selectedMonth;
    this.loadMonthlyHours();
  }

  loadMonthlyHours(): void {
    this.loading = true;
    this.error = '';

    const token = getAuthToken();
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
    const url = this.isTeacherSelfView
      ? `${apiUrl}/teacher/monthly-hours?month=${encodeURIComponent(this.selectedMonth)}`
      : `${apiUrl}/admin/teachers/${this.teacherId}/monthly-hours?month=${encodeURIComponent(this.selectedMonth)}`;

    this.http
      .get<{ success: boolean; data: MonthlyHoursData }>(url, {
        withCredentials: true,
        headers,
      })
      .subscribe({
        next: (res) => {
          if (res?.success && res.data) {
            this.data = res.data;
            this.selectedMonth = res.data.month;
            const teacherId = res.data.teacher?._id;
            if (teacherId && res.data.teacher.levelHourlyRates) {
              this.allLevelRates[teacherId] = { ...res.data.teacher.levelHourlyRates };
            }
          } else {
            this.error = 'Unable to load monthly hour details.';
          }
          this.loading = false;
        },
        error: (err) => {
          this.data = null;
          this.error = err?.error?.message || 'Unable to load monthly hour details.';
          this.loading = false;
        },
      });
  }

  formatHours(hours: number): string {
    return (hours || 0).toFixed(2);
  }

  formatMinutes(totalMinutes: number): string {
    if (!totalMinutes) return '0 min';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${minutes} min`;
    return minutes ? `${hours} hr ${minutes} min` : `${hours} hr${hours !== 1 ? 's' : ''}`;
  }

  formatAttendance(pct: number | null): string {
    if (pct == null) return '—';
    return `${pct.toFixed(2)}%`;
  }

  formatCurrency(amount: number): string {
    return `₹${Math.round(amount || 0).toLocaleString('en-IN')}`;
  }

  getRateForLevel(level: string): number {
    if (!this.data?.teacher?._id) return 0;
    const rates = this.allLevelRates[this.data.teacher._id] || {};
    const knownLevel = String(level || '').toUpperCase().match(/\b(A1|A2|B1|B2)\b/)?.[1];
    const exactRate = knownLevel ? Number(rates[knownLevel] ?? 0) : 0;
    return exactRate || this.getFallbackRate();
  }

  computeRowTotal(row: MonthlyHourBreakdown): number {
    return (row.tutorHours || 0) * this.getRateForLevel(row.level);
  }

  computeBaseTotal(): number {
    return (this.data?.batchBreakdown || []).reduce((sum, row) => sum + this.computeRowTotal(row), 0);
  }

  computeTDS(): number {
    if (this.data?.teacher?.noTds) return 0;
    return this.computeBaseTotal() * TDS_PERCENT / 100;
  }

  get isNoTds(): boolean {
    return this.data?.teacher?.noTds === true;
  }

  computeFinal(): number {
    return this.computeBaseTotal() - this.computeTDS();
  }

  hasSavedRates(): boolean {
    if (!this.data?.teacher?._id) return false;
    return Object.keys(this.allLevelRates[this.data.teacher._id] || {}).length > 0;
  }

  private getFallbackRate(): number {
    if (!this.data?.teacher?._id) return 0;
    const rates = this.allLevelRates[this.data.teacher._id] || {};
    const teacherLevels = this.data.teacher.levels || [];
    const matchingRates = teacherLevels
      .map((level) => Number(rates[String(level).toUpperCase()] ?? 0))
      .filter((rate) => Number.isFinite(rate) && rate > 0);
    if (matchingRates.length) {
      return matchingRates.reduce((sum, rate) => sum + rate, 0) / matchingRates.length;
    }
    const allRates = Object.values(rates)
      .map((rate) => Number(rate))
      .filter((rate) => Number.isFinite(rate) && rate > 0);
    return allRates.length ? allRates.reduce((sum, rate) => sum + rate, 0) / allRates.length : 0;
  }

  attendanceClass(pct: number | null): string {
    if (pct == null) return '';
    if (pct >= 80) return 'att-good';
    if (pct >= 60) return 'att-warn';
    return 'att-bad';
  }

  printPage(): void {
    window.print();
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
