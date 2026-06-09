import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { environment } from '../../../../environments/environment';

export interface StudentJourneyPreview {
  email?: string;
  subscription?: string;
  medium?: string;
  level?: string;
  regNo?: string;
  batch?: string;
  studentStatus?: string;
  servicesOpted?: string;
  enrollmentDate?: string;
  isTestAccount?: boolean;
  teacher?: string;
  currentCourseDay?: number;
  displayPassword?: string | null;
  visaRoute?: string | null;
  levelPath?: string;
  goStatus?: string;
}

@Component({
  selector: 'app-student-journey-detail-modal',
  standalone: true,
  imports: [CommonModule, NgChartsModule],
  templateUrl: './student-journey-detail-modal.component.html',
  styleUrls: ['./student-journey-detail-modal.component.css']
})
export class StudentJourneyDetailModalComponent implements OnChanges {
  @Input() visible = false;
  /** When true, renders inline on a page (no overlay). */
  @Input() embedded = false;
  @Input() studentId = '';
  @Input() studentName = '';
  @Input() preview: StudentJourneyPreview | null = null;
  @Output() closed = new EventEmitter<void>();

  loading = false;
  reloading = false;
  loadError = '';
  journeyData: any = null;
  payTableOpen = false;
  loadedAt: Date | null = null;

  // Detailed data for ld-grid lists
  liveClasses: any[] = [];
  recordings: any[] = [];
  zoomRecordings: any[] = [];
  exercises: any[] = [];
  dgModules: any[] = [];
  arenaGames: any[] = [];
  detailLoading = false;

  radarChartData: ChartConfiguration['data'] = { labels: [], datasets: [] };
  radarChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      r: {
        beginAtZero: true,
        max: 100,
        ticks: { display: false, stepSize: 25 },
        grid: { color: 'rgba(0,0,0,0.06)' },
        angleLines: { color: 'rgba(0,0,0,0.06)' },
        pointLabels: { font: { size: 10, weight: 'bold' }, color: '#64748b' }
      }
    }
  };

  constructor(private http: HttpClient) {}

  ngOnChanges(changes: SimpleChanges): void {
    const shouldLoad = this.studentId && (this.embedded || this.visible);
    if ((changes['visible'] || changes['studentId'] || changes['embedded']) && shouldLoad) {
      this.load();
    }
    if (!this.embedded && changes['visible'] && !this.visible) {
      this.journeyData = null;
      this.loadError = '';
    }
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    if (!this.journeyData) {
      this.journeyData = null;
    }
    this.http.get('/api/student-progress/admin/journey/' + this.studentId).subscribe({
      next: (res) => {
        this.journeyData = res;
        this.loadedAt = new Date();
        this.buildRadarChart();
        this.loading = false;
        this.reloading = false;
        this.loadDetailData();
      },
      error: () => {
        this.loading = false;
        this.reloading = false;
        this.loadError = 'Could not load student details. Please try again.';
      }
    });
  }

  private loadDetailData(): void {
    this.detailLoading = true;
    const isGo = this.isGo;
    const isSinhala = this.preview?.medium?.toLowerCase() === 'sinhala' || 
                       this.journeyData?.profile?.medium?.toLowerCase() === 'sinhala';

    let detailUrl: string;
    if (isGo) {
      const goApiPath = isSinhala ? 'go-students-sinhala' : 'go-students';
      detailUrl = `${environment.apiUrl}/${goApiPath}/${this.studentId}/detail`;
    } else {
      detailUrl = `${environment.apiUrl}/batch-journey/student/${this.studentId}/full-progress`;
    }

    this.http.get<any>(detailUrl, { withCredentials: true }).subscribe({
      next: (res) => {
        if (isGo) {
          this.recordings = res.recordings || [];
          this.zoomRecordings = res.zoomRecordings || [];
          this.exercises = res.exercises || [];
          this.dgModules = res.dgModules || [];
          this.arenaGames = res.arenaGames || [];
        } else {
          this.liveClasses = res.liveClasses || [];
          this.exercises = res.exercises || [];
          this.dgModules = res.modules || [];
        }
        this.detailLoading = false;
      },
      error: () => {
        this.detailLoading = false;
      }
    });
  }

  refresh(): void {
    this.reloading = true;
    this.load();
  }

  close(): void {
    this.closed.emit();
  }

  studentDashboardUrl(): string {
    return `/student/${this.studentId}`;
  }

  mailTo(): string {
    return `mailto:${this.preview?.email || ''}`;
  }

  formatRelativeTime(): string {
    if (!this.loadedAt) return '';
    const diff = Date.now() - this.loadedAt.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 5) return 'Just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    return `${Math.floor(min / 60)}h ago`;
  }

  formatDate(d: string | Date): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  get displayName(): string {
    return this.jProfile.name || this.studentName || 'Student';
  }

  get jProfile() { return this.journeyData?.profile || {}; }
  get jLevelProgression() { return this.journeyData?.levelProgression || []; }
  get jLessonsByLevel() { return this.journeyData?.lessonsByLevel || {}; }
  get jPayments() {
    const p = this.journeyData?.payments || {};
    const hubRequests = p.hubRequests || [];
    const ledgerRows = p.payments || [];
    return {
      source: p.source || 'invoices',
      currency: p.currency || 'LKR',
      invoices: p.invoices || [],
      totalPackageAmount: p.totalPackageAmount || p.totalAmount || 0,
      totalAmount: p.totalAmount || p.totalPackageAmount || 0,
      paidAmount: p.paidAmount || 0,
      pendingAmount: p.pendingAmount || 0,
      totalPaidLKR: p.totalPaidLKR ?? 0,
      totalPaidINR: p.totalPaidINR ?? 0,
      totalPaidUSD: p.totalPaidUSD ?? 0,
      overdueAmountLKR: p.overdueAmountLKR ?? 0,
      overdueAmountINR: p.overdueAmountINR ?? 0,
      overdueAmountUSD: p.overdueAmountUSD ?? 0,
      requestCount: p.requestCount ?? hubRequests.length ?? 0,
      paymentHistory: hubRequests.length ? hubRequests : ledgerRows,
      isHub: p.source === 'payment_hub',
      slotBreakdown: p.slotBreakdown || {},
      overallStatus: p.overallStatus || 'CLEAR',
    };
  }

  paymentHubUrl(): string {
    return this.studentId ? `/admin/payment-hub/student/${this.studentId}` : '/admin/payment-hub';
  }

  formatPayStatus(status: string): string {
    const map: Record<string, string> = {
      FULLY_PAID: 'Fully paid',
      APPROVED: 'Approved',
      SUBMITTED: 'Submitted',
      UNDER_REVIEW: 'Under review',
      REQUESTED: 'Requested',
      OVERDUE: 'Overdue',
      REJECTED: 'Rejected',
    };
    return map[status] || status || '—';
  }

  payStatusClass(status: string): string {
    if (status === 'FULLY_PAID' || status === 'APPROVED') return 'sp-pay-status--ok';
    if (status === 'OVERDUE' || status === 'REJECTED') return 'sp-pay-status--bad';
    if (status === 'SUBMITTED' || status === 'UNDER_REVIEW') return 'sp-pay-status--pending';
    return 'sp-pay-status--neutral';
  }

  hasMultiCurrencyPaid(): boolean {
    const p = this.jPayments;
    const n = [p.totalPaidLKR, p.totalPaidINR, p.totalPaidUSD].filter((v) => v > 0).length;
    return n > 1;
  }
  get jVisa() {
    return this.journeyData?.visa || { steps: [], stages: [], currentStep: 0, totalSteps: 0, route: '', history: [], dates: {} };
  }
  get jAttendance() { return this.journeyData?.attendance || { attended: 0, total: 0 }; }
  get jBotUsage() { return this.journeyData?.botUsage || { todayMinutes: 0, weekMinutes: 0, targetMinutesPerWeek: 180 }; }
  get jDocuments() { return this.journeyData?.documents || []; }
  get jHistory() { return this.journeyData?.history || []; }

  get jLevelPath(): string {
    return this.jLevelProgression.map((l: any) => l.level).join(' → ');
  }
  get jCurrentLevelLabel(): string {
    const cur = this.jLevelProgression.find((l: any) => l.status === 'in-progress');
    return cur ? cur.level + ' in progress' : this.jProfile.currentLevel || this.preview?.level || '';
  }
  get jAttendanceRate(): number {
    return this.jAttendance.total ? Math.round((this.jAttendance.attended / this.jAttendance.total) * 100) : 0;
  }
  get jBotWeekPct(): number {
    return this.jBotUsage.targetMinutesPerWeek
      ? Math.min(100, Math.round((this.jBotUsage.weekMinutes / this.jBotUsage.targetMinutesPerWeek) * 100))
      : 0;
  }
  get jDocsSubmitted(): number {
    return this.jDocuments.filter((d: any) => d.status === 'verified').length;
  }
  get jDocsPct(): number {
    return this.jDocuments.length ? Math.round((this.jDocsSubmitted / this.jDocuments.length) * 100) : 0;
  }
  get jLearningPct(): number {
    const lp = this.jLevelProgression;
    const c = lp.filter((l: any) => l.status === 'completed').length;
    return lp.length ? Math.round((c / lp.length) * 100) : 0;
  }
  get jPayPct(): number {
    const p = this.jPayments;
    if (p.totalAmount > 0) return Math.min(100, Math.round((p.paidAmount / p.totalAmount) * 100));
    if (p.paidAmount > 0 || p.totalPaidLKR > 0 || p.totalPaidINR > 0 || p.totalPaidUSD > 0) return 100;
    return 0;
  }
  get jVisaPct(): number {
    return this.jVisa.steps.length > 1 ? Math.round((this.jVisa.currentStep / (this.jVisa.steps.length - 1)) * 100) : 0;
  }
  get jOverallPct(): number {
    const lp = this.jLevelProgression;
    const learningPct = lp.length ? lp.filter((l: any) => l.status === 'completed').length / lp.length : 0;
    const docsPct = this.jDocuments.length ? this.jDocsSubmitted / this.jDocuments.length : 0;
    const payPct = this.jPayments.totalAmount ? this.jPayments.paidAmount / this.jPayments.totalAmount : 0;
    const visaPct = this.jVisa.steps.length > 1 ? this.jVisa.currentStep / (this.jVisa.steps.length - 1) : 0;
    return Math.round((learningPct * 0.4 + docsPct * 0.2 + payPct * 0.2 + visaPct * 0.2) * 100);
  }

  private buildRadarChart(): void {
    this.radarChartData = {
      labels: ['Learning', 'Documents', 'Payments', 'Visa'],
      datasets: [
        {
          label: 'Progress',
          data: [this.jLearningPct, this.jDocsPct, this.jPayPct, this.jVisaPct],
          borderColor: '#059669',
          backgroundColor: 'rgba(5, 150, 105, 0.15)',
          pointBackgroundColor: '#059669',
          pointBorderColor: '#fff',
          pointBorderWidth: 1,
          pointRadius: 4
        }
      ]
    };
  }

  get isPlatinum(): boolean {
    const sub = this.jProfile.subscription || this.preview?.subscription || '';
    return sub.toUpperCase().includes('PLATINUM');
  }

  get isGo(): boolean {
    const goStatus = this.jProfile.goStatus || (this.preview as any)?.goStatus || '';
    return goStatus.toUpperCase() === 'GO';
  }

  get jExerciseProgress() {
    return this.journeyData?.exerciseProgress || { total: 0, completed: 0, pending: 0 };
  }

  get jDgModuleProgress() {
    return this.journeyData?.dgModuleProgress || { total: 0, completed: 0, pending: 0 };
  }

  get jRecordingProgress() {
    return this.journeyData?.recordingProgress || { total: 0, watched: 0, remaining: 0 };
  }

  get jRecordingPct(): number {
    const r = this.jRecordingProgress;
    return r.total ? Math.round((r.watched / r.total) * 100) : 0;
  }

  get jOverallJourneyDay(): number {
    return this.jProfile.currentCourseDay || 0;
  }

  get jOverallJourneyPct(): number {
    return Math.min(100, Math.round((this.jOverallJourneyDay / 200) * 100));
  }

  get jExamSummary() {
    return this.journeyData?.examSummary || null;
  }

  get jSprechenSummary() {
    return this.jExamSummary?.sprechen || null;
  }

  get jSprechenLastSession() {
    return this.jSprechenSummary?.lastSession || null;
  }

  get jSprechenAggregate() {
    return this.jSprechenSummary?.aggregate || null;
  }

  get jExamPct(): number {
    const e = this.jExamSummary;
    const total = (e?.totalExercises || 0) + (e?.totalDgModules || 0) + (this.jSprechenAggregate?.total || 0);
    const done = (e?.completedExercises || 0) + (e?.completedDgModules || 0) + (this.jSprechenAggregate?.completed || 0);
    return total ? Math.round((done / total) * 100) : 0;
  }

  get jPaymentSlotKeys(): string[] {
    return ['A1', 'A2', 'B1', 'B2', 'DOCS', 'VISA'];
  }

  jPaymentSlotStatus(slot: string): 'paid' | 'partial' | 'pending' | 'none' {
    const s = this.jPayments.slotBreakdown[slot];
    if (!s || s.requestCount === 0) return 'none';
    const paid = s.paid?.LKR || 0;
    const balance = s.balance?.LKR || 0;
    if (balance <= 0 && paid > 0) return 'paid';
    if (paid > 0) return 'partial';
    return 'pending';
  }
}
