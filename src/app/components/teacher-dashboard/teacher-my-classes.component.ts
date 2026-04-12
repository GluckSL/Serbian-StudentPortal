import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TeacherService } from '../../services/teacher.service';
import { ZoomService } from '../../services/zoom.service';
import { ClassResourceService } from '../../services/class-resource.service';
import { ClassDoubtService } from '../../services/class-doubt.service';
import { ClassSubmissionService } from '../../services/class-submission.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-teacher-my-classes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './teacher-my-classes.component.html',
  styleUrls: ['./teacher-my-classes.component.css']
})
export class TeacherMyClassesComponent implements OnInit {
  meetings: any[] = [];
  batchOptions: string[] = [];
  loading = false;
  loadingBatches = false;
  error = '';

  filters = { batch: '', date: '', plan: '', status: '' };
  /** 'all' = no date filter (show every class for this teacher); 'one' = filter by `filters.date` */
  dateFilterType: 'all' | 'one' = 'all';

  // Resources modal
  showResourceModal = false;
  resourceMeeting: any = null;
  resources: any[] = [];
  loadingResources = false;
  uploadingFiles = false;

  // Doubts modal
  showDoubtModal = false;
  doubtMeeting: any = null;
  doubts: any[] = [];
  loadingDoubts = false;
  replyTexts: Record<string, string> = {};
  replyingId: string | null = null;
  deletingId: string | null = null;

  // Submissions modal
  showSubmissionModal = false;
  submissionMeeting: any = null;
  submissions: any[] = [];
  loadingSubmissions = false;
  reviewingId: string | null = null;
  reviewComments: Record<string, string> = {};
  deletingSubmissionId: string | null = null;

  constructor(
    private teacherService: TeacherService,
    private zoomService: ZoomService,
    private resourceService: ClassResourceService,
    private doubtService: ClassDoubtService,
    private submissionService: ClassSubmissionService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.dateFilterType = 'all';
    this.filters.date = '';
    this.loadBatchOptions();
    this.loadClasses();
  }

  onDateFilterTypeChange(): void {
    if (this.dateFilterType === 'all') {
      this.filters.date = '';
    }
    this.loadClasses();
  }

  loadBatchOptions(): void {
    this.loadingBatches = true;
    this.teacherService.getClassBatches().subscribe({
      next: (res) => { this.batchOptions = res.data || []; this.loadingBatches = false; },
      error: () => { this.batchOptions = []; this.loadingBatches = false; }
    });
  }

  loadClasses(): void {
    this.loading = true;
    this.error = '';
    const f: Record<string, string> = {};
    if (this.dateFilterType === 'one' && this.filters.date) f['date'] = this.filters.date;
    if (this.filters.batch) f['batch'] = this.filters.batch;
    if (this.filters.plan) f['plan'] = this.filters.plan;
    if (this.filters.status) f['status'] = this.filters.status;

    this.zoomService.getAllMeetings(Object.keys(f).length ? f : undefined).subscribe({
      next: (res) => { this.meetings = res.success ? res.data || [] : []; if (!res.success) this.error = res.message || 'Failed'; this.loading = false; },
      error: (err) => { this.meetings = []; this.error = err.error?.message || 'Failed'; this.loading = false; }
    });
  }

  clearFilters(): void {
    this.dateFilterType = 'all';
    this.filters = { batch: '', date: '', plan: '', status: '' };
    this.loadClasses();
  }

  /** Summary line under the count */
  resultsSummaryText(): string {
    const parts: string[] = [];
    if (this.dateFilterType === 'one' && this.filters.date) {
      parts.push('on the selected date');
    } else {
      parts.push('across all dates');
    }
    if (this.filters.batch) parts.push(`batch ${this.filters.batch}`);
    if (this.filters.plan) parts.push(this.filters.plan);
    if (this.filters.status) parts.push(this.filters.status);
    return parts.join(' · ');
  }

  trackById(_i: number, m: any): string { return m._id; }

  formatStart(m: any): string {
    if (!m?.startTime) return '—';
    return new Date(m.startTime).toLocaleString('en-LK', {
      timeZone: 'Asia/Colombo', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  // ── Resources Modal ──
  openResources(m: any): void {
    this.resourceMeeting = m;
    this.showResourceModal = true;
    this.loadResources(m._id);
  }

  closeResourceModal(): void {
    this.showResourceModal = false;
    this.resourceMeeting = null;
    this.resources = [];
  }

  loadResources(meetingId: string): void {
    this.loadingResources = true;
    this.resourceService.list(meetingId).subscribe({
      next: (res) => { this.resources = res.data || []; this.loadingResources = false; },
      error: () => { this.resources = []; this.loadingResources = false; }
    });
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.resourceMeeting) return;
    const files = Array.from(input.files);
    this.uploadingFiles = true;
    this.resourceService.upload(this.resourceMeeting._id, files).subscribe({
      next: (res) => {
        this.uploadingFiles = false;
        const n = Array.isArray(res?.data) ? res.data.length : files.length;
        this.notify.success(n === 1 ? 'File uploaded successfully.' : `${n} files uploaded successfully.`);
        this.loadResources(this.resourceMeeting!._id);
        input.value = '';
      },
      error: (err) => {
        this.uploadingFiles = false;
        this.notify.error(err?.error?.message || 'Upload failed.');
      }
    });
  }

  deleteResource(r: any): void {
    if (!confirm(`Delete "${r.originalName}"?`)) return;
    this.resourceService.delete(r._id).subscribe({
      next: () => {
        this.resources = this.resources.filter(x => x._id !== r._id);
        this.notify.success('Resource removed.');
      },
      error: (err) => {
        this.notify.error(err?.error?.message || 'Could not delete this file.');
      }
    });
  }

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

  formatDate(d: string | Date | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Doubts Modal ──
  openDoubts(m: any): void {
    this.doubtMeeting = m;
    this.showDoubtModal = true;
    this.replyTexts = {};
    this.loadDoubts(m._id);
  }

  closeDoubtModal(): void {
    this.showDoubtModal = false;
    this.doubtMeeting = null;
    this.doubts = [];
  }

  loadDoubts(meetingId: string): void {
    this.loadingDoubts = true;
    this.doubtService.list(meetingId).subscribe({
      next: (res) => { this.doubts = res.data || []; this.loadingDoubts = false; },
      error: () => { this.doubts = []; this.loadingDoubts = false; }
    });
  }

  sendReply(doubt: any): void {
    const text = (this.replyTexts[doubt._id] || '').trim();
    if (!text) return;
    this.replyingId = doubt._id;
    this.doubtService.reply(doubt._id, text).subscribe({
      next: (res) => {
        const idx = this.doubts.findIndex(d => d._id === doubt._id);
        if (idx >= 0 && res.data) this.doubts[idx] = res.data;
        this.replyTexts[doubt._id] = '';
        this.replyingId = null;
      },
      error: () => { this.replyingId = null; }
    });
  }

  /** Normalize Mongo _id for template comparisons (templates cannot use global `String`). */
  doubtId(d: any): string {
    return String(d?._id ?? '');
  }

  deleteDoubt(doubt: any): void {
    const id = String(doubt._id ?? '');
    if (!id || this.deletingId) return;
    if (!confirm('Delete this doubt and all replies?')) return;
    this.deletingId = id;
    this.doubtService.delete(id).subscribe({
      next: () => {
        this.doubts = this.doubts.filter((d) => String(d._id) !== id);
        delete this.replyTexts[id];
        this.deletingId = null;
      },
      error: () => { this.deletingId = null; }
    });
  }

  formatDateFull(d: string | Date | null): string {
    if (!d) return '';
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ── Submissions Modal ──
  openSubmissions(m: any): void {
    this.submissionMeeting = m;
    this.showSubmissionModal = true;
    this.reviewComments = {};
    this.loadSubmissions(m._id);
  }

  closeSubmissionModal(): void {
    this.showSubmissionModal = false;
    this.submissionMeeting = null;
    this.submissions = [];
    this.reviewComments = {};
  }

  loadSubmissions(meetingId: string): void {
    this.loadingSubmissions = true;
    this.submissionService.list(meetingId).subscribe({
      next: (res) => { this.submissions = res.data || []; this.loadingSubmissions = false; },
      error: () => { this.submissions = []; this.loadingSubmissions = false; }
    });
  }

  reviewSubmission(sub: any, status: 'correct' | 'wrong'): void {
    const id = String(sub._id ?? '');
    if (!id || this.reviewingId) return;
    const comment = (this.reviewComments[id] || '').trim();
    this.reviewingId = id;
    this.submissionService.review(id, status, comment).subscribe({
      next: (res) => {
        const idx = this.submissions.findIndex(s => String(s._id) === id);
        if (idx >= 0 && res.data) this.submissions[idx] = res.data;
        this.reviewingId = null;
        this.notify.success(`Marked as ${status}`);
      },
      error: () => { this.reviewingId = null; this.notify.error('Failed to save review'); }
    });
  }

  deleteSubmission(sub: any): void {
    const id = String(sub._id ?? '');
    if (!id || this.deletingSubmissionId) return;
    if (!confirm(`Delete this submission by ${sub.studentId?.name || 'student'}?`)) return;
    this.deletingSubmissionId = id;
    this.submissionService.remove(id).subscribe({
      next: () => {
        this.submissions = this.submissions.filter(s => String(s._id) !== id);
        this.deletingSubmissionId = null;
      },
      error: () => { this.deletingSubmissionId = null; }
    });
  }

  viewSubmission(sub: any): void {
    if (sub?.fileUrl) window.open(sub.fileUrl, '_blank');
  }

  submissionBadgeClass(sub: any): string {
    const s = sub?.feedback?.status;
    if (s === 'correct') return 'sub-badge--correct';
    if (s === 'wrong') return 'sub-badge--wrong';
    return 'sub-badge--pending';
  }

  submissionBadgeLabel(sub: any): string {
    const s = sub?.feedback?.status;
    if (s === 'correct') return 'Correct';
    if (s === 'wrong') return 'Wrong';
    return 'Pending';
  }

  submissionId(sub: any): string {
    return String(sub?._id ?? '');
  }
}
