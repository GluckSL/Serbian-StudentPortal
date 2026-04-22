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

  allMeetings: StudentMeeting[] = [];
  upcomingMeetings: StudentMeeting[] = [];
  ongoingMeetings: StudentMeeting[] = [];
  pastMeetings: StudentMeeting[] = [];
  attemptedMeetings: StudentMeeting[] = [];
  activeTab: 'upcoming' | 'live' | 'attempted' = 'upcoming';

  loading = false;
  error = '';
  private meetingsRefreshId: ReturnType<typeof setInterval> | null = null;

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
    this.loadMeetings();
    this.meetingsRefreshId = setInterval(() => this.loadMeetings(), 60000);
  }

  ngOnDestroy(): void {
    if (this.meetingsRefreshId) { clearInterval(this.meetingsRefreshId); this.meetingsRefreshId = null; }
  }

  loadMeetings(): void {
    this.loading = true;
    this.error = '';
    this.zoomService.getStudentMeetings().subscribe({
      next: (response) => {
        if (response.success) { this.allMeetings = response.data; this.categorizeMeetings(); }
        else { this.error = response.message || 'Failed to load meetings'; }
        this.loading = false;
      },
      error: (err) => { console.error('Error loading meetings:', err); this.error = 'Failed to load your meetings'; this.loading = false; }
    });
  }

  categorizeMeetings(): void {
    this.ongoingMeetings = this.allMeetings.filter(m => m.isOngoing);
    this.upcomingMeetings = this.allMeetings.filter(m => !m.isOngoing && !m.hasEnded);
    this.pastMeetings = this.allMeetings.filter(m => m.hasEnded);
    this.attemptedMeetings = this.pastMeetings;
    if (this.ongoingMeetings.length > 0) this.activeTab = 'live';
    else if (this.upcomingMeetings.length > 0) this.activeTab = 'upcoming';
    else this.activeTab = 'attempted';
  }

  joinMeeting(meeting: StudentMeeting): void {
    if (meeting.journeyLocked && meeting.courseDay != null) { this.notify.info(`This class is available only on journey day ${meeting.courseDay}.`); return; }
    if (meeting.canJoin && meeting.joinUrl) {
      this.joinClassFlow.openJoin(meeting, (msg) => this.notify.error(msg));
    }
  }

  upcomingActionLabel(meeting: StudentMeeting): string {
    if (meeting.journeyLocked && meeting.courseDay != null) return `Only day ${meeting.courseDay}`;
    if (meeting.canJoin) return 'Join';
    return this.getTimeUntilStart(meeting);
  }

  upcomingActionDisabled(meeting: StudentMeeting): boolean {
    if (meeting.journeyLocked) return true;
    return !meeting.canJoin;
  }

  splitClassTopic(topic: string | null | undefined): { head: string; rest: string | null } {
    const t = (topic ?? '').trim();
    if (!t) return { head: '', rest: null };
    const m = t.match(/^(Day\s+\d+:\s*.+?\([^)]+\))\s*(.*)$/i);
    if (m) { const rest = m[2]?.trim(); return { head: m[1].trim(), rest: rest || null }; }
    return { head: t, rest: null };
  }

  /** First name (first word) on one line, surname / rest on the next — fits long names on mobile cards. */
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

  /** Scheduled class length in minutes (denominator for progress). */
  getTotalClassMinutes(meeting: StudentMeeting): number {
    return Math.max(0, Math.round(Number(meeting.duration || 0)));
  }

  /** Minutes the student was present (capped at class duration). */
  getAttendedMinutesDisplay(meeting: StudentMeeting): number {
    const total = this.getTotalClassMinutes(meeting);
    if (!meeting.hasEnded || total <= 0) return 0;
    let attended = Math.round(Number(meeting.attendedDurationMinutes ?? meeting.durationMinutes ?? 0));
    if (meeting.attended === true && attended <= 0) attended = total;
    return Math.max(0, Math.min(total, attended));
  }

  /** e.g. "55/60" — attended minutes / total class minutes */
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

  setTab(tab: 'upcoming' | 'live' | 'attempted'): void { this.activeTab = tab; }

  copyMeetingInfo(meeting: StudentMeeting): void {
    const info = `Meeting: ${meeting.topic}\nDate: ${this.formatDate(meeting.startTime)}\nTime: ${this.formatTime(meeting.startTime)}\nDuration: ${this.formatDuration(meeting.duration)}\nJoin URL: ${meeting.joinUrl}\nPassword: ${meeting.password}`;
    navigator.clipboard.writeText(info).then(() => this.notify.success('Copied!'));
  }

  // ── Resources Modal ──
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

  // ── Doubts Modal ──
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

  // ── Submissions Modal ──
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
