import { Component, OnInit, OnDestroy, Input, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';
import { NotificationService } from '../../services/notification.service';
import { ClassResourceService } from '../../services/class-resource.service';
import { ClassDoubtService } from '../../services/class-doubt.service';
import { ClassSubmissionService } from '../../services/class-submission.service';
import { JoinClassFlowService } from '../../services/join-class-flow.service';
import { ClassFeedbackService } from '../../services/class-feedback.service';
import { ClassFeedbackModalComponent } from '../class-feedback-modal/class-feedback-modal.component';
import { ResourceViewerComponent } from '../resource-viewer/resource-viewer.component';

interface StudentMeeting {
  _id: string;
  topic: string;
  batch: string;
  startTime: Date;
  duration: number;
  teacher: { name: string; email: string; };
  joinUrl: string;
  password: string;
  status: string;
  currentStatus: string;
  canJoin: boolean;
  isOngoing: boolean;
  hasEnded: boolean;
  timeUntilStart: number;
  agenda?: string;
  attended?: boolean;
  durationMinutes?: number;
  attendedDurationMinutes?: number;
  courseDay?: number | null;
  journeyLocked?: boolean;
  attendanceStatus?: string | null;
}

type ClassTab = 'upcoming' | 'live' | 'attempted';

@Component({
  selector: 'app-student-meetings',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, ClassFeedbackModalComponent, ResourceViewerComponent],
  templateUrl: './student-meetings.component.html',
  styleUrls: ['./student-meetings.component.css']
})
export class StudentMeetingsComponent implements OnInit, OnDestroy {
  @Input() embedded = false;
  @ViewChild('submissionFileInput') private submissionFileRef?: ElementRef<HTMLInputElement>;

  /** Current page slice for each tab (server-paginated). */
  upcomingMeetings: StudentMeeting[] = [];
  ongoingMeetings: StudentMeeting[] = [];
  attemptedMeetings: StudentMeeting[] = [];

  /** Tab totals from server (includeTabCounts). */
  upcomingTotal = 0;
  liveTotal = 0;
  attemptedTotal = 0;

  activeTab: ClassTab = 'upcoming';

  readonly classesPageSize = 7;
  upcomingPage = 1;
  livePage = 1;
  attemptedPage = 1;

  /** Skeleton row placeholders while a tab page loads. */
  readonly skeletonClassRows = [0, 1, 2, 3, 4, 5, 6];

  loading = false;
  tabLoading = false;
  error = '';
  private meetingsRefreshId: ReturnType<typeof setInterval> | null = null;
  private initialTabResolved = false;

  // Resources modal
  showResourceModal = false;
  resourceMeeting: StudentMeeting | null = null;
  resources: any[] = [];
  loadingResources = false;

  // Resource viewer modal
  showViewer = false;
  viewerResource: any = null;

  // Doubts modal
  showDoubtModal = false;
  doubtMeeting: StudentMeeting | null = null;
  doubts: any[] = [];
  loadingDoubts = false;
  showAskForm = false;
  newDoubt = { title: '', explanation: '', visibility: 'public' };
  submittingDoubt = false;

  // Submissions modal
  showSubmissionModal = false;
  submissionMeeting: StudentMeeting | null = null;
  submissions: any[] = [];
  loadingSubmissions = false;
  selectedFile: File | null = null;
  submissionCaption = '';
  uploading = false;

  // Feedback modal
  showFeedbackModal = false;
  feedbackMeeting: StudentMeeting | null = null;
  feedbackBatchEnabled = false;
  submittedFeedbackIds = new Set<string>();
  /** Cached per-batch feedback feature flag from admin settings. */
  private feedbackEnabledBatches = new Map<string, boolean>();

  constructor(
    private zoomService: ZoomService,
    private notify: NotificationService,
    private resourceService: ClassResourceService,
    private doubtService: ClassDoubtService,
    private submissionService: ClassSubmissionService,
    private joinClassFlow: JoinClassFlowService,
    private classFeedbackService: ClassFeedbackService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.loadInitial();
    this.meetingsRefreshId = setInterval(() => this.refreshCurrentTab(), 60000);
    // Handle deep-link: ?feedbackClass=<meetingId>
    this.route.queryParams.subscribe((params) => {
      const classId = params['feedbackClass'];
      if (classId) {
        this.activeTab = 'attempted';
        // Load attempted tab then open feedback modal for the specific class
        this.fetchTab('attempted', 1, false, false);
        // Delay to allow meetings to load
        setTimeout(() => this.openFeedbackById(classId), 1500);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.meetingsRefreshId) { clearInterval(this.meetingsRefreshId); this.meetingsRefreshId = null; }
  }

  /** Retry button in error state (template). */
  loadMeetings(): void {
    this.loadInitial();
  }

  private loadInitial(): void {
    this.loading = true;
    this.error = '';
    this.fetchTab('upcoming', 1, true, true);
  }

  private refreshCurrentTab(): void {
    if (this.loading || this.tabLoading) return;
    const page = this.getPageForTab(this.activeTab);
    this.fetchTab(this.activeTab, page, false, false);
  }

  private fetchTab(tab: ClassTab, page: number, resolveInitialTab: boolean, includeCounts: boolean): void {
    this.tabLoading = true;
    if (resolveInitialTab) this.loading = true;
    this.zoomService.getStudentMeetings({
      tab,
      page,
      limit: this.classesPageSize,
      includeTabCounts: includeCounts
    }).subscribe({
      next: (response) => {
        if (!response?.success) {
          this.error = response?.message || 'Greška pri učitavanju časova';
          this.loading = false;
          this.tabLoading = false;
          return;
        }
        if (response.tabCounts) {
          this.upcomingTotal = Number(response.tabCounts.upcoming) || 0;
          this.liveTotal = Number(response.tabCounts.live) || 0;
          this.attemptedTotal = Number(response.tabCounts.attempted) || 0;
        }
        const items: StudentMeeting[] = Array.isArray(response.data) ? response.data : [];
        const total = Number(response.totalCount ?? response.pagination?.totalItems ?? items.length);
        this.setTabMeetings(tab, items, page, total);

        if (resolveInitialTab && !this.initialTabResolved) {
          this.initialTabResolved = true;
          if (this.liveTotal > 0) {
            this.activeTab = 'live';
            if (tab !== 'live') this.fetchTab('live', 1, false, false);
          } else if (this.upcomingTotal > 0) {
            this.activeTab = 'upcoming';
            if (tab !== 'upcoming') this.fetchTab('upcoming', 1, false, false);
          } else {
            this.activeTab = 'attempted';
            if (tab !== 'attempted') this.fetchTab('attempted', 1, false, false);
          }
        }

        this.loading = false;
        this.tabLoading = false;
      },
      error: (err) => {
        console.error('Error loading meetings:', err);
        this.error = 'Greška pri učitavanju vaših časova';
        this.loading = false;
        this.tabLoading = false;
      }
    });
  }

  private setTabMeetings(tab: ClassTab, items: StudentMeeting[], page: number, total: number): void {
    if (tab === 'upcoming') {
      this.upcomingMeetings = items;
      this.upcomingPage = page;
      this.upcomingTotal = total;
    } else if (tab === 'live') {
      this.ongoingMeetings = items;
      this.livePage = page;
      this.liveTotal = total;
      this.preloadFeedbackBatchStatus(items);
    } else {
      this.attemptedMeetings = items;
      this.attemptedPage = page;
      this.attemptedTotal = total;
      this.preloadFeedbackBatchStatus(items);
    }
  }

  private preloadFeedbackBatchStatus(meetings: StudentMeeting[]): void {
    const batches = [...new Set(meetings.map((m) => m.batch).filter(Boolean))];
    for (const batch of batches) {
      if (this.feedbackEnabledBatches.has(batch)) continue;
      this.feedbackEnabledBatches.set(batch, false);
      this.classFeedbackService.isBatchEnabled(batch).subscribe({
        next: (res) => this.feedbackEnabledBatches.set(batch, !!res.enabled),
        error: () => this.feedbackEnabledBatches.set(batch, false),
      });
    }
  }

  private getPageForTab(tab: ClassTab): number {
    if (tab === 'upcoming') return this.upcomingPage;
    if (tab === 'live') return this.livePage;
    return this.attemptedPage;
  }

  private getTotalForTab(tab: ClassTab): number {
    if (tab === 'upcoming') return this.upcomingTotal;
    if (tab === 'live') return this.liveTotal;
    return this.attemptedTotal;
  }

  get paginatedUpcomingMeetings(): StudentMeeting[] {
    return this.upcomingMeetings;
  }

  get paginatedOngoingMeetings(): StudentMeeting[] {
    return this.ongoingMeetings;
  }

  get paginatedAttemptedMeetings(): StudentMeeting[] {
    return this.attemptedMeetings;
  }

  get upcomingTotalPages(): number {
    return this.totalPagesFor(this.upcomingTotal);
  }

  get liveTotalPages(): number {
    return this.totalPagesFor(this.liveTotal);
  }

  get attemptedTotalPages(): number {
    return this.totalPagesFor(this.attemptedTotal);
  }

  private totalPagesFor(totalItems: number): number {
    return Math.max(1, Math.ceil(totalItems / this.classesPageSize));
  }

  getClassPageNumbers(totalPages: number, currentPage: number): number[] {
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    const pages: number[] = [];
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }

  changeUpcomingPage(page: number): void {
    const p = Math.min(Math.max(1, page), this.upcomingTotalPages);
    if (p === this.upcomingPage && !this.tabLoading) return;
    this.fetchTab('upcoming', p, false, false);
  }

  changeLivePage(page: number): void {
    const p = Math.min(Math.max(1, page), this.liveTotalPages);
    if (p === this.livePage && !this.tabLoading) return;
    this.fetchTab('live', p, false, false);
  }

  changeAttemptedPage(page: number): void {
    const p = Math.min(Math.max(1, page), this.attemptedTotalPages);
    if (p === this.attemptedPage && !this.tabLoading) return;
    this.fetchTab('attempted', p, false, false);
  }

  classPageRangeLabel(page: number, totalItems: number): string {
    if (totalItems === 0) return '';
    const start = (page - 1) * this.classesPageSize + 1;
    const end = Math.min(page * this.classesPageSize, totalItems);
    return `Prikazano ${start}–${end} od ${totalItems}`;
  }

  setTab(tab: ClassTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.fetchTab(tab, this.getPageForTab(tab), false, false);
  }

  joinMeeting(meeting: StudentMeeting): void {
    if (meeting.journeyLocked && meeting.courseDay != null) { this.notify.info(`Ovaj čas je dostupan samo na danu putovanja ${meeting.courseDay}.`); return; }
    const canJoinNow = (meeting.canJoin || meeting.isOngoing) && !!meeting.joinUrl;
    if (canJoinNow) {
      this.joinClassFlow.openJoin(meeting, (msg) => this.notify.error(msg));
    }
  }

  upcomingActionLabel(meeting: StudentMeeting): string {
    if (meeting.journeyLocked && meeting.courseDay != null) return `Samo dan ${meeting.courseDay}`;
    if (meeting.isOngoing) return 'Pridruži se odmah';
    if (meeting.canJoin) return 'Pridruži se';
    return this.getTimeUntilStart(meeting);
  }

  upcomingActionDisabled(meeting: StudentMeeting): boolean {
    if (meeting.journeyLocked) return true;
    return !meeting.canJoin && !meeting.isOngoing;
  }

  splitClassTopic(topic: string | null | undefined): { head: string; rest: string | null } {
    const t = (topic ?? '').trim();
    if (!t) return { head: '', rest: null };
    const m = t.match(/^(Day\s+\d+:\s*.+?\([^)]+\))\s*(.*)$/i);
    if (m) { const rest = m[2]?.trim(); return { head: m[1].trim(), rest: rest || null }; }
    return { head: t, rest: null };
  }

  splitTeacherDisplayName(name: string | null | undefined): { first: string; second: string | null } {
    const raw = (name ?? '').trim();
    if (!raw) return { first: '—', second: null };
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return { first: parts[0], second: null };
    return { first: parts[0], second: parts.slice(1).join(' ') };
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('sr-Latn-RS', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' });
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  }

  getTimeUntilStart(meeting: StudentMeeting): string {
    if (meeting.timeUntilStart <= 0) return 'Odmah';
    const minutes = Math.floor(meeting.timeUntilStart / 60000);
    const hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
    if (days > 0) return `za ${days} dan${days > 1 ? 'a' : ''}`;
    if (hours > 0) return `za ${hours} čas${hours > 1 ? 'a' : ''}`;
    if (minutes > 0) return `za ${minutes} minut${minutes > 1 ? 'a' : ''}`;
    return 'Uskoro počinje';
  }

  getStatusText(meeting: StudentMeeting): string {
    if (meeting.isOngoing) return 'U toku';
    if (meeting.hasEnded) return 'Završeno';
    if (meeting.canJoin) return 'Spreman za ulaz';
    return 'Predstojeći';
  }

  getAttendancePercent(meeting: StudentMeeting): number {
    const total = Number(meeting.duration || 0);
    if (!meeting.hasEnded || total <= 0) return 0;
    const attended = Number(meeting.attendedDurationMinutes ?? meeting.durationMinutes ?? 0);
    if (meeting.attended === true && attended <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((attended / total) * 100)));
  }

  getTotalClassMinutes(meeting: StudentMeeting): number {
    return Math.max(0, Math.round(Number(meeting.duration || 0)));
  }

  getAttendedMinutesDisplay(meeting: StudentMeeting): number {
    const total = this.getTotalClassMinutes(meeting);
    if (!meeting.hasEnded || total <= 0) return 0;
    let attended = Math.round(Number(meeting.attendedDurationMinutes ?? meeting.durationMinutes ?? 0));
    if (meeting.attended === true && attended <= 0) attended = total;
    return Math.max(0, Math.min(total, attended));
  }

  getProgressMinutesLabel(meeting: StudentMeeting): string {
    const total = this.getTotalClassMinutes(meeting);
    if (total <= 0) return '—';
    return `${this.getAttendedMinutesDisplay(meeting)}/${total}`;
  }

  getAttendanceStatus(meeting: StudentMeeting): string {
    if (meeting.attended === true) return 'Prisustvovao';
    const pct = this.getAttendancePercent(meeting);
    if (pct >= 75) return 'Prisustvovao';
    if (meeting.hasEnded && pct > 0) return 'Nije prisustvovao';
    return 'Propustio';
  }

  getAttendanceBadgeClass(meeting: StudentMeeting): string {
    const s = this.getAttendanceStatus(meeting);
    if (s === 'Prisustvovao') return 'badge-attended';
    if (s === 'Nije prisustvovao') return 'badge-not-attended';
    return 'badge-missed';
  }

  copyMeetingInfo(meeting: StudentMeeting): void {
    const info = `Meeting: ${meeting.topic}\nDate: ${this.formatDate(meeting.startTime)}\nTime: ${this.formatTime(meeting.startTime)}\nDuration: ${this.formatDuration(meeting.duration)}\nJoin URL: ${meeting.joinUrl}\nPassword: ${meeting.password}`;
    navigator.clipboard.writeText(info).then(() => this.notify.success('Kopirano!'));
  }

  openResources(m: StudentMeeting): void {
    this.resourceMeeting = m;
    this.showResourceModal = true;
    this.loadingResources = true;
    this.resourceService.list(m._id).subscribe({
      next: (res) => { this.resources = res.data || []; this.loadingResources = false; },
      error: () => { this.resources = []; this.loadingResources = false; }
    });
  }

  closeResourceModal(): void { this.showResourceModal = false; this.resourceMeeting = null; this.resources = []; }

  viewResource(r: any): void {
    this.viewerResource = r;
    this.showViewer = true;
  }

  closeViewer(): void {
    this.showViewer = false;
    this.viewerResource = null;
  }

  formatFileSize(bytes: number): string {
    if (bytes == null || Number.isNaN(bytes)) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  formatDateShort(d: string | Date | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('sr-Latn-RS', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  openDoubts(m: StudentMeeting): void {
    this.doubtMeeting = m;
    this.showDoubtModal = true;
    this.showAskForm = false;
    this.newDoubt = { title: '', explanation: '', visibility: 'public' };
    this.loadingDoubts = true;
    this.doubtService.list(m._id).subscribe({
      next: (res) => { this.doubts = res.data || []; this.loadingDoubts = false; },
      error: () => { this.doubts = []; this.loadingDoubts = false; }
    });
  }

  closeDoubtModal(): void { this.showDoubtModal = false; this.doubtMeeting = null; this.doubts = []; this.showAskForm = false; }

  toggleAskForm(): void { this.showAskForm = !this.showAskForm; }

  submitDoubt(): void {
    if (!this.doubtMeeting || !this.newDoubt.title.trim()) return;
    this.submittingDoubt = true;
    this.doubtService.submit(this.doubtMeeting._id, this.newDoubt).subscribe({
      next: (res) => {
        if (res.data) this.doubts.unshift(res.data);
        this.newDoubt = { title: '', explanation: '', visibility: 'public' };
        this.showAskForm = false;
        this.submittingDoubt = false;
      },
      error: () => { this.submittingDoubt = false; }
    });
  }

  formatDateFull(d: string | Date | null): string {
    if (!d) return '';
    return new Date(d).toLocaleString('sr-Latn-RS', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  isClassEnded(m: StudentMeeting): boolean {
    return m.hasEnded || m.status === 'ended';
  }

  openSubmissions(m: StudentMeeting): void {
    this.submissionMeeting = m;
    this.showSubmissionModal = true;
    this.selectedFile = null;
    this.submissionCaption = '';
    this.loadSubmissions(m._id);
  }

  loadSubmissions(meetingId: string): void {
    this.loadingSubmissions = true;
    this.submissionService.list(meetingId).subscribe({
      next: (res) => { this.submissions = res.data || []; this.loadingSubmissions = false; },
      error: () => { this.submissions = []; this.loadingSubmissions = false; }
    });
  }

  closeSubmissionModal(): void {
    this.showSubmissionModal = false;
    this.submissionMeeting = null;
    this.submissions = [];
    this.selectedFile = null;
    this.submissionCaption = '';
  }

  onSubmissionFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  clearSelectedSubmissionFile(fileInput: HTMLInputElement | null): void {
    this.selectedFile = null;
    if (fileInput) fileInput.value = '';
  }

  uploadSubmission(): void {
    if (!this.submissionMeeting || !this.selectedFile || this.uploading) return;
    const formData = new FormData();
    formData.append('file', this.selectedFile);
    formData.append('caption', this.submissionCaption.trim());
    this.uploading = true;
    this.submissionService.upload(this.submissionMeeting._id, formData).subscribe({
      next: (res) => {
        if (res.data) this.submissions.unshift(res.data);
        this.selectedFile = null;
        this.submissionCaption = '';
        const el = this.submissionFileRef?.nativeElement;
        if (el) el.value = '';
        this.uploading = false;
        this.notify.success('Odgovor je uspešno otpremljen!');
      },
      error: (err) => {
        this.uploading = false;
        const msg = err?.error?.message || 'Otpremanje nije uspelo. Pokušajte ponovo.';
        this.notify.error(msg);
      }
    });
  }

  submissionFeedbackLabel(sub: any): string {
    const status = sub?.feedback?.status;
    if (status === 'correct') return 'Tačno';
    if (status === 'wrong') return 'Pogrešno';
    return 'Na čekanju';
  }

  submissionFeedbackClass(sub: any): string {
    const status = sub?.feedback?.status;
    if (status === 'correct') return 'sub-badge--correct';
    if (status === 'wrong') return 'sub-badge--wrong';
    return 'sub-badge--pending';
  }

  viewSubmissionFile(sub: any): void {
    if (sub?.fileUrl) window.open(sub.fileUrl, '_blank');
  }

  // ── Feedback modal ─────────────────────────────────────────────────────

  openFeedback(m: StudentMeeting): void {
    if (!this.isClassEligibleForFeedback(m)) return;
    this.feedbackMeeting = m;
    this.showFeedbackModal = true;
    this.classFeedbackService.isBatchEnabled(m.batch).subscribe({
      next: (res) => { this.feedbackBatchEnabled = res.enabled; },
      error: () => { this.feedbackBatchEnabled = false; }
    });
  }

  openFeedbackById(meetingId: string): void {
    const found =
      this.attemptedMeetings.find((m) => m._id === meetingId) ||
      this.ongoingMeetings.find((m) => m._id === meetingId);
    if (found) {
      this.openFeedback(found);
    } else {
      // Create a minimal meeting object for the feedback modal using the meeting API
      this.classFeedbackService.getMeetingForFeedback(meetingId).subscribe({
        next: (res) => {
          if (res.success && res.meeting) {
            const m = res.meeting as StudentMeeting;
            m.hasEnded = res.meeting.status === 'ended';
            m.isOngoing = res.meeting.status === 'started';
            m.currentStatus = res.meeting.status === 'started' ? 'live' : res.meeting.status;
            this.feedbackMeeting = m;
            this.feedbackBatchEnabled = true;
            this.showFeedbackModal = true;
          }
        },
        error: () => {}
      });
    }
  }

  closeFeedbackModal(): void {
    this.showFeedbackModal = false;
    this.feedbackMeeting = null;
  }

  onFeedbackSubmitted(): void {
    if (this.feedbackMeeting) {
      this.submittedFeedbackIds.add(this.feedbackMeeting._id);
    }
    setTimeout(() => this.closeFeedbackModal(), 2000);
  }

  /** Live or ended class — not upcoming/scheduled only. */
  isClassEligibleForFeedback(m: StudentMeeting): boolean {
    return !!(
      m.isOngoing ||
      m.hasEnded ||
      m.status === 'started' ||
      m.currentStatus === 'live' ||
      m.currentStatus === 'ongoing'
    );
  }

  hasFeedbackEnabled(m: StudentMeeting): boolean {
    if (this.feedbackEnabledBatches.get(m.batch) !== true) return false;
    return this.isClassEligibleForFeedback(m);
  }
}
