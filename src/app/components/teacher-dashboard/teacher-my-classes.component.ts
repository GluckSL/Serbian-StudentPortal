import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TeacherService } from '../../services/teacher.service';
import { ZoomService } from '../../services/zoom.service';
import { ClassResourceService } from '../../services/class-resource.service';
import { ClassDoubtService } from '../../services/class-doubt.service';
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

  constructor(
    private teacherService: TeacherService,
    private zoomService: ZoomService,
    private resourceService: ClassResourceService,
    private doubtService: ClassDoubtService,
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
      next: () => { this.resources = this.resources.filter(x => x._id !== r._id); },
      error: () => {}
    });
  }

  viewResource(r: { fileUrl?: string }): void {
    this.resourceService.openInBrowser(r.fileUrl || '');
  }

  downloadResource(r: { fileUrl?: string; originalName?: string }): void {
    this.resourceService.downloadFile(r.fileUrl || '', r.originalName || 'download');
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
}
