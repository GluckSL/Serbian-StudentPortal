import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { StudentProgressService } from '../../services/student-progress.service';

@Component({
  selector: 'app-student-progress',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './student-progress.component.html',
  styleUrls: ['./student-progress.component.css']
})
export class StudentProgressComponent implements OnInit {
  isLoading = true;
  data: any = null;
  alerts: string[] = [];

  constructor(private progressService: StudentProgressService) {}

  ngOnInit(): void {
    this.progressService.getStudentJourney().subscribe({
      next: (res) => { this.data = res; this.buildAlerts(); this.isLoading = false; },
      error: () => { this.isLoading = false; }
    });
  }

  get profile() { return this.data?.profile || {}; }
  get levelProgression() { return this.data?.levelProgression || []; }
  get lessonsByLevel() { return this.data?.lessonsByLevel || {}; }
  get payments() { return this.data?.payments || { instalments: [], totalAmount: 0, paidAmount: 0 }; }
  get visa() { return this.data?.visa || { steps: [], currentStep: 0, route: '' }; }
  get attendance() { return this.data?.attendance || { attended: 0, total: 0 }; }
  get botUsage() { return this.data?.botUsage || { todayMinutes: 0, weekMinutes: 0, targetMinutesPerWeek: 180 }; }
  get documents() { return this.data?.documents || []; }
  get history() { return this.data?.history || []; }
  get feedbackByLevel() { return this.data?.feedbackByLevel || {}; }

  get levelPath(): string {
    if (!this.levelProgression.length) return '';
    return this.levelProgression.map((l: any) => l.level).join(' → ');
  }

  get currentLevelLabel(): string {
    const cur = this.levelProgression.find((l: any) => l.status === 'in-progress');
    return cur ? cur.level + ' in progress' : this.profile.currentLevel || '';
  }

  get attendanceRate(): number {
    return this.attendance.total ? Math.round((this.attendance.attended / this.attendance.total) * 100) : 0;
  }

  get botWeekPercent(): number {
    return this.botUsage.targetMinutesPerWeek ? Math.min(100, Math.round((this.botUsage.weekMinutes / this.botUsage.targetMinutesPerWeek) * 100)) : 0;
  }

  get docsSubmitted(): number {
    return this.documents.filter((d: any) => d.status === 'verified').length;
  }

  get docsPercent(): number {
    return this.documents.length ? Math.round((this.docsSubmitted / this.documents.length) * 100) : 0;
  }

  get overallPercent(): number {
    const lp = this.levelProgression;
    const completed = lp.filter((l: any) => l.status === 'completed').length;
    const learningPct = lp.length ? completed / lp.length : 0;
    const docsPct = this.documents.length ? this.docsSubmitted / this.documents.length : 0;
    const payPct = this.payments.totalAmount ? this.payments.paidAmount / this.payments.totalAmount : 0;
    const visaPct = this.visa.steps.length > 1 ? this.visa.currentStep / (this.visa.steps.length - 1) : 0;
    return Math.round((learningPct * 0.4 + docsPct * 0.2 + payPct * 0.2 + visaPct * 0.2) * 100);
  }

  get visaRouteLabel(): string {
    const map: any = { 'D-VISA-LANGUAGE-WORK': 'D-Visa – Language + Work', 'NATIONAL-STUDENT-VISA': 'National student visa' };
    return map[this.visa.route] || this.visa.route || 'Not set';
  }

  isOverdue(dateStr: string): boolean {
    return new Date() > new Date(dateStr + 'T00:00:00');
  }

  buildAlerts(): void {
    this.alerts = [];
    // Payment alerts
    this.payments.instalments?.forEach((p: any) => {
      if (!p.paid && this.isOverdue(p.dueDate)) {
        this.alerts.push('Payment instalment ' + p.installment + ' is overdue (due ' + this.formatDate(p.dueDate) + ').');
      }
    });
    // Attendance alert
    if (this.attendanceRate < 70 && this.attendance.total > 0) {
      this.alerts.push('Attendance dropped below 70% (' + this.attendanceRate + '%).');
    }
  }

  formatDate(d: string | Date): string {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
}
