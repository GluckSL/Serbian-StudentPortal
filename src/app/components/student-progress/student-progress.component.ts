import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { StudentProgressService } from '../../services/student-progress.service';

@Component({
  selector: 'app-student-progress',
  standalone: true,
  imports: [CommonModule, RouterModule],
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
  get payments() { 
    const p = this.data?.payments || {};
    return { 
      source: p.source || 'invoices',
      currency: p.currency || 'LKR',
      invoices: p.invoices || [], 
      totalPackageAmount: p.totalPackageAmount || p.totalAmount || 0,
      totalAmount: p.totalAmount || p.totalPackageAmount || 0, 
      paidAmount: p.paidAmount || 0,
      pendingAmount: p.pendingAmount || 0,
      paymentHistory: p.payments || []
    }; 
  }
  get visa() { return this.data?.visa || { steps: [], stages: [], currentStep: 0, totalSteps: 0, route: '', finalOutcome: '', finalOutcomeNote: '', history: [], dates: {} }; }
  get attendance() { return this.data?.attendance || { attended: 0, total: 0 }; }
  get botUsage() { return this.data?.botUsage || { todayMinutes: 0, weekMinutes: 0, targetMinutesPerWeek: 180 }; }
  get documents() { return this.data?.documents || []; }
  get docsSummary() { return this.data?.docsSummary || { total: 0, verified: 0, pending: 0, rejected: 0, notUploaded: 0 }; }
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

  get learningPct(): number {
    const lp = this.levelProgression;
    const completed = lp.filter((l: any) => l.status === 'completed').length;
    return lp.length ? Math.round((completed / lp.length) * 100) : 0;
  }

  get docsPct(): number {
    return this.documents.length ? Math.round((this.docsSubmitted / this.documents.length) * 100) : 0;
  }

  get payPct(): number {
    return this.payments.totalAmount ? Math.round((this.payments.paidAmount / this.payments.totalAmount) * 100) : 0;
  }

  get visaPct(): number {
    return this.visa.steps.length > 1 ? Math.round((this.visa.currentStep / (this.visa.steps.length - 1)) * 100) : 0;
  }

  get visaRouteLabel(): string {
    return this.visa.route || 'Not set';
  }

  get visaStageDates(): any[] {
    return (this.visa.stages || [])
      .filter((s: any) => s.stageDate && s.stageDateLabel)
      .map((s: any) => ({ label: s.stageDateLabel, date: s.stageDate }));
  }

  isOverdue(dateStr: string): boolean {
    return new Date() > new Date(dateStr + 'T00:00:00');
  }

  buildAlerts(): void {
    this.alerts = [];
    // Payment alerts
    this.payments.invoices?.forEach((inv: any) => {
      if (inv.paymentStatus === 'unpaid' && inv.dueDate && this.isOverdue(inv.dueDate)) {
        this.alerts.push('Invoice ' + inv.invoiceNumber + ' is overdue (due ' + inv.dueDate + ').');
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
