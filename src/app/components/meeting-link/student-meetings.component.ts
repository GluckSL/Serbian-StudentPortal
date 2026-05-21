import { Component, OnInit, OnDestroy, Input, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../shared/material.module';
import { ZoomService } from '../../services/zoom.service';
import { NotificationService } from '../../services/notification.service';
import { ClassResourceService } from '../../services/class-resource.service';
import { ClassDoubtService } from '../../services/class-doubt.service';
import { ClassSubmissionService } from '../../services/class-submission.service';
import { JoinClassFlowService } from '../../services/join-class-flow.service';

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
  imports: [CommonModule, FormsModule, MaterialModule],
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

  constructor(
    private zoomService: ZoomService,
    private notify: NotificationService,
    private resourceService: ClassResourceService,
    private doubtService: ClassDoubtService,
    private submissionService: ClassSubmissionService,
    private joinClassFlow: JoinClassFlowService
  ) {}

  ngOnInit(): void {
    this.loadInitial();
    this.meetingsRefreshId = setInterval(() => this.refreshCurrentTab(), 60000);
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
    this.fetchTab(this.activeTab, page, false, true);
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
          this.error = response?.message || 'Failed to load meetings';
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
        this.error = 'Failed to load your meetings';
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
    } else {
      this.attemptedMeetings = items;
      this.attemptedPage = page;
      this.attemptedTotal = total;
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
    return `Showing ${start}–${end} of ${totalItems}`;
  }

  setTab(tab: ClassTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.fetchTab(tab, this.getPageForTab(tab), false, false);
  }

  joinMeeting(meeting: StudentMeeting): void {
    if (meeting.journeyLocked && meeting.courseDay != null) { this.notify.info(`This class is available only on journey day ${meeting.courseDay}.`); return; }
    const canJoinNow = (meeting.canJoin || meeting.isOngoing) && !!meeting.joinUrl;
    if (canJoinNow) {
      this.joinClassFlow.openJoin(meeting, (msg) => this.notify.error(msg));
    }
  }

  upcomingActionLabel(meeting: StudentMeeting): string {
    if (meeting.journeyLocked && meeting.courseDay != null) return `Only day ${meeting.courseDay}`;
    if (meeting.isOngoing) return 'Join now';
    if (meeting.canJoin) return 'Join';
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
    return new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  }

  getTimeUntilStart(meeting: StudentMeeting): string {
    if (meeting.timeUntilStart <= 0) return 'Now';
    const minutes = Math.floor(meeting.timeUntilStart / 60000);
    const hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
    if (days > 0) return `in ${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `in ${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
    return 'Starting soon';
  }

  getStatusText(meeting: StudentMeeting): string {
    if (meeting.isOngoing) return 'Ongoing';
    if (meeting.hasEnded) return 'Ended';
    if (meeting.canJoin) return 'Ready to Join';
    return 'Upcoming';
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

  getAttendanceStatus(meeting: StudentMeeting): 'Attended' | 'Not Attended' | 'Missed' {
    if (meeting.attended === true) return 'Attended';
    const pct = this.getAttendancePercent(meeting);
    if (pct >= 75) return 'Attended';
    if (meeting.hasEnded && pct > 0) return 'Not Attended';
    return 'Missed';
  }

  getAttendanceBadgeClass(meeting: StudentMeeting): string {
    const s = this.getAttendanceStatus(meeting);
    if (s === 'Attended') return 'badge-attended';
    if (s === 'Not Attended') return 'badge-not-attended';
    return 'badge-missed';
  }

  copyMeetingInfo(meeting: StudentMeeting): void {
    const info = `Meeting: ${meeting.topic}\nDate: ${this.formatDate(meeting.startTime)}\nTime: ${this.formatTime(meeting.startTime)}\nDuration: ${this.formatDuration(meeting.duration)}\nJoin URL: ${meeting.joinUrl}\nPassword: ${meeting.password}`;
    navigator.clipboard.writeText(info).then(() => this.notify.success('Copied!'));
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

  viewResource(r: { fileUrl?: string }): void {
    this.resourceService.openInBrowser(r.fileUrl || '');
  }

  downloadResource(r: { _id?: string; fileUrl?: string; originalName?: string }): void {
    this.resourceService.downloadClassResource(r);
  }

  formatFileSize(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  formatDateShort(d: string | Date | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
        this.notify.success('Answer uploaded successfully!');
      },
      error: (err) => {
        this.uploading = false;
        const msg = err?.error?.message || 'Upload failed. Please try again.';
        this.notify.error(msg);
      }
    });
  }

  submissionFeedbackLabel(sub: any): string {
    const status = sub?.feedback?.status;
    if (status === 'correct') return 'Correct';
    if (status === 'wrong') return 'Wrong';
    return 'Pending';
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
}
