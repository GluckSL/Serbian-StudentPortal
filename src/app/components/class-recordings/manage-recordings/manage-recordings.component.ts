import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  ClassRecordingsService,
  ClassRecording,
  AdminClassRecording,
  ZoomWebhookAuditRow,
} from '../../../services/class-recordings.service';
import { NotificationService } from '../../../services/notification.service';

@Component({
  selector: 'app-manage-recordings',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './manage-recordings.component.html',
  styleUrls: ['./manage-recordings.component.css']
})
export class ManageRecordingsComponent implements OnInit {
  recordings: AdminClassRecording[] = [];
  filteredRecordings: AdminClassRecording[] = [];
  availableBatches: string[] = [];
  levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  plans = [
    { value: 'ALL', label: 'All Plans' },
    { value: 'SILVER', label: 'Silver' },
    { value: 'PLATINUM', label: 'Platinum' },
    { value: 'VISA_DOC_ONLY', label: 'Visa & Doc Only' }
  ];

  loading = false;
  backfillLoading = false;
  publishLoadingId: string | null = null;
  showWebhookAuditModal = false;
  webhookAuditLoading = false;
  webhookAuditRows: ZoomWebhookAuditRow[] = [];
  webhookAuditSummary: Record<string, number> = {};
  showForm = false;
  editing: ClassRecording | null = null;

  form = { title: '', description: '', videoUrl: '', batches: [] as string[], level: 'A1', plan: 'ALL' };

  // Filters
  filterLevel = 'ALL';
  filterBatch = 'ALL';
  searchQuery = '';

  // Analytics
  analyticsSummary: Record<string, any> = {};
  showViewsModal = false;
  viewsRecording: ClassRecording | null = null;
  viewsList: any[] = [];
  loadingViews = false;
  zoomTeachers: Array<{ _id: string; name: string; email?: string }> = [];
  showZoomEditModal = false;
  zoomEditingMeetingLinkId: string | null = null;
  zoomEditForm = { title: '', batch: '', teacherId: '' };
  viewsMeta: { totalStudents?: number; watchedCount?: number; notWatchedCount?: number; totalWatchSeconds?: number; videoSizeBytes?: number } = {};

  constructor(
    private service: ClassRecordingsService,
    private snackBar: MatSnackBar,
    private sanitizer: DomSanitizer,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadRecordings();
    this.loadBatches();
    this.loadAnalytics();
    this.loadZoomTeachers();
  }

  loadZoomTeachers(): void {
    this.service.getZoomTeachers().subscribe({
      next: (res) => { this.zoomTeachers = res.data || []; },
      error: () => { this.zoomTeachers = []; }
    });
  }

  runZoomBackfill(): void {
    if (this.backfillLoading) return;
    this.backfillLoading = true;

    this.service.runZoomBackfill({
      batch: this.filterBatch !== 'ALL' ? this.filterBatch : null,
      limit: 200,
      includeFailed: true,
      force: false,
    }).subscribe({
      next: (res) => {
        this.backfillLoading = false;
        this.snackBar.open(
          `Backfill queued: ${res.queued || 0}, skipped ready: ${res.skippedAlreadyReady || 0}, no recording in Zoom: ${res.skippedNoRecordingInZoom || 0}`,
          'Close',
          { duration: 6000 }
        );

        // Reload after a short delay so newly queued items can appear as processing/ready.
        setTimeout(() => {
          this.loadRecordings();
        }, 2000);
      },
      error: (err) => {
        this.backfillLoading = false;
        this.snackBar.open(err.error?.message || 'Backfill failed', 'Close', { duration: 4000 });
      }
    });
  }

  openWebhookAudit(): void {
    this.showWebhookAuditModal = true;
    this.webhookAuditLoading = true;
    this.webhookAuditRows = [];
    this.webhookAuditSummary = {};

    this.service.getZoomWebhookAudit({ limit: 200 }).subscribe({
      next: (res) => {
        this.webhookAuditRows = res.rows || [];
        this.webhookAuditSummary = res.summary || {};
        this.webhookAuditLoading = false;
      },
      error: () => {
        this.webhookAuditLoading = false;
        this.snackBar.open('Failed to load webhook audit logs', 'Close', { duration: 3000 });
      }
    });
  }

  closeWebhookAudit(): void {
    this.showWebhookAuditModal = false;
    this.webhookAuditRows = [];
    this.webhookAuditSummary = {};
  }

  loadRecordings(): void {
    this.loading = true;
    this.service.getAdminAllRecordings().subscribe({
      next: (res) => {
        this.recordings = (res.recordings || []).map((r: AdminClassRecording) => ({
          ...r,
          isPublished: this.isZoomRecording(r) ? r.isPublished !== false : true,
        }));
        this.applyFilters();
        this.loading = false;
      },
      error: () => { this.snackBar.open('Error loading recordings', 'Close', { duration: 3000 }); this.loading = false; }
    });
  }

  loadBatches(): void {
    this.service.getBatches().subscribe({
      next: (res) => { this.availableBatches = res.batches; },
      error: () => {}
    });
  }

  applyFilters(): void {
    let list = [...this.recordings];
    if (this.filterLevel !== 'ALL') list = list.filter(r => r.level === this.filterLevel);
    if (this.filterBatch !== 'ALL') list = list.filter(r => (r.batches || []).includes(this.filterBatch));
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      );
    }
    this.filteredRecordings = list;
  }

  openForm(recording?: ClassRecording): void {
    if (recording) {
      this.editing = recording;
      this.form = {
        title: recording.title,
        description: recording.description,
        videoUrl: recording.videoUrl,
        batches: [...recording.batches],
        level: recording.level,
        plan: recording.plan
      };
    } else {
      this.editing = null;
      this.form = { title: '', description: '', videoUrl: '', batches: [], level: 'A1', plan: 'ALL' };
    }
    this.showForm = true;
  }

  closeForm(): void { this.showForm = false; this.editing = null; }

  save(): void {
    if (!this.form.title || !this.form.videoUrl || !this.form.level || this.form.batches.length === 0) {
      this.snackBar.open('Please fill title, video URL, level, and select at least one batch', 'Close', { duration: 3000 });
      return;
    }

    const obs = this.editing
      ? this.service.update(this.editing._id, this.form)
      : this.service.create(this.form);

    obs.subscribe({
      next: () => {
        this.snackBar.open(this.editing ? 'Recording updated' : 'Recording created', 'Close', { duration: 3000 });
        this.closeForm();
        this.loadRecordings();
      },
      error: (err) => this.snackBar.open(err.error?.message || 'Error saving', 'Close', { duration: 3000 })
    });
  }

  deleteRecording(r: ClassRecording): void {
    this.notify.confirm('Delete Recording', `Delete "${r.title}"?`, 'Yes, Delete', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.service.delete(r._id).subscribe({
        next: () => { this.snackBar.open('Recording deleted', 'Close', { duration: 3000 }); this.loadRecordings(); },
        error: () => this.snackBar.open('Error deleting', 'Close', { duration: 3000 })
      });
    });
  }

  viewRecordingAction(r: AdminClassRecording): void {
    if (!this.isZoomRecording(r)) {
      this.openViews(r);
      return;
    }
    if (!r.meetingLinkId) {
      this.snackBar.open('Meeting link not found for this recording.', 'Close', { duration: 3000 });
      return;
    }
    this.viewsRecording = r as any;
    this.loadingViews = true;
    this.showViewsModal = true;
    this.viewsMeta = {};
    this.service.getZoomViews(String(r.meetingLinkId)).subscribe({
      next: (res) => {
        this.viewsList = res.views || [];
        this.viewsMeta = res.summary || {};
        this.loadingViews = false;
      },
      error: (err) => {
        this.loadingViews = false;
        this.snackBar.open(err.error?.message || 'Unable to load Zoom analytics', 'Close', { duration: 3000 });
      },
    });
  }

  editRecordingAction(r: AdminClassRecording): void {
    if (!this.isZoomRecording(r)) {
      this.openForm(r);
      return;
    }
    this.openZoomEdit(r);
  }

  deleteRecordingAction(r: AdminClassRecording): void {
    if (!this.isZoomRecording(r)) {
      this.deleteRecording(r);
      return;
    }
    if (!r.meetingLinkId) {
      this.snackBar.open('Meeting link not found for this recording.', 'Close', { duration: 3000 });
      return;
    }
    this.notify.confirm(
      'Delete Zoom Recording',
      `Delete "${r.title}" from recordings list?`,
      'Yes, Delete',
      'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      this.service.deleteZoomRecording(String(r.meetingLinkId)).subscribe({
        next: () => {
          this.snackBar.open('Zoom recording deleted', 'Close', { duration: 3000 });
          this.loadRecordings();
        },
        error: (err) => this.snackBar.open(err.error?.message || 'Failed to delete Zoom recording', 'Close', { duration: 3000 }),
      });
    });
  }

  openZoomEdit(r: AdminClassRecording): void {
    if (!r.meetingLinkId) {
      this.snackBar.open('Meeting link not found for this recording.', 'Close', { duration: 3000 });
      return;
    }
    this.zoomEditingMeetingLinkId = String(r.meetingLinkId);
    this.zoomEditForm = {
      title: r.title || '',
      batch: (r.batches && r.batches[0]) || '',
      teacherId: r.assignedTeacherId ? String(r.assignedTeacherId) : '',
    };
    this.showZoomEditModal = true;
  }

  closeZoomEdit(): void {
    this.showZoomEditModal = false;
    this.zoomEditingMeetingLinkId = null;
    this.zoomEditForm = { title: '', batch: '', teacherId: '' };
  }

  saveZoomEdit(): void {
    if (!this.zoomEditingMeetingLinkId) return;
    if (!this.zoomEditForm.title.trim()) {
      this.snackBar.open('Title is required', 'Close', { duration: 2500 });
      return;
    }
    this.service.updateZoomRecordingMeta(this.zoomEditingMeetingLinkId, {
      title: this.zoomEditForm.title.trim(),
      batch: this.zoomEditForm.batch.trim(),
      teacherId: this.zoomEditForm.teacherId || undefined,
    }).subscribe({
      next: () => {
        this.snackBar.open('Zoom recording updated', 'Close', { duration: 2500 });
        this.closeZoomEdit();
        this.loadRecordings();
      },
      error: (err) => this.snackBar.open(err.error?.message || 'Failed to update Zoom recording', 'Close', { duration: 3000 }),
    });
  }

  getEmbedUrl(url: string): string {
    // Convert YouTube watch URLs to embed
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    // Convert Google Drive share links to embed
    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
    return url;
  }

  formatDate(d: string): string {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  getSafeUrl(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.getEmbedUrl(url));
  }

  toggleBatch(batch: string): void {
    const idx = this.form.batches.indexOf(batch);
    if (idx >= 0) this.form.batches.splice(idx, 1);
    else this.form.batches.push(batch);
  }

  loadAnalytics(): void {
    this.service.getAnalyticsSummary().subscribe({
      next: (res) => { this.analyticsSummary = res.summary; },
      error: () => {}
    });
  }

  getStats(recordingId: string): { views: number; students: number; avgTime: string } {
    const s = this.analyticsSummary[recordingId];
    if (!s) return { views: 0, students: 0, avgTime: '0s' };
    return {
      views: s.totalViews || 0,
      students: s.uniqueStudentCount || 0,
      avgTime: this.formatDuration(s.avgWatchTime || 0)
    };
  }

  isZoomRecording(r: AdminClassRecording): boolean {
    return r.recordingType === 'ZOOM' || r.source === 'ZOOM_AUTO';
  }

  canToggleStudentVisibility(r: AdminClassRecording): boolean {
    return this.isZoomRecording(r) && !!r.meetingLinkId && r.status === 'ready';
  }

  toggleStudentVisibility(r: AdminClassRecording): void {
    if (!this.canToggleStudentVisibility(r) || !r.meetingLinkId || this.publishLoadingId) return;

    const nextState = !(r.isPublished !== false);
    const action = nextState ? 'Show to students' : 'Hide from students';
    this.notify.confirm(
      'Student Visibility',
      `${action} for "${r.title}"?`,
      'Yes',
      'Cancel'
    ).subscribe((ok) => {
      if (!ok) return;
      this.publishLoadingId = String(r.meetingLinkId);
      this.service.publishZoomRecordings([String(r.meetingLinkId)], nextState).subscribe({
        next: () => {
          this.publishLoadingId = null;
          this.snackBar.open(
            nextState ? 'Recording is now visible to students.' : 'Recording is now hidden from students.',
            'Close',
            { duration: 3000 }
          );
          this.loadRecordings();
        },
        error: (err) => {
          this.publishLoadingId = null;
          this.snackBar.open(err.error?.message || 'Failed to update visibility', 'Close', { duration: 3000 });
        }
      });
    });
  }

  openViews(r: ClassRecording): void {
    this.viewsRecording = r;
    this.loadingViews = true;
    this.showViewsModal = true;
    this.service.getViews(r._id).subscribe({
      next: (res) => { this.viewsList = res.views; this.loadingViews = false; },
      error: () => { this.loadingViews = false; }
    });
  }

  closeViews(): void { this.showViewsModal = false; this.viewsRecording = null; this.viewsList = []; this.viewsMeta = {}; }

  clearFilters(): void {
    this.searchQuery = '';
    this.filterLevel = 'ALL';
    this.filterBatch = 'ALL';
    this.applyFilters();
  }

  getTotalViews(): number {
    return Object.values(this.analyticsSummary).reduce((s: number, v: any) => s + (v.totalViews || 0), 0);
  }

  getTotalStudents(): number {
    return Object.values(this.analyticsSummary).reduce((s: number, v: any) => s + (v.uniqueStudentCount || 0), 0);
  }

  formatDuration(seconds: number): string {
    if (!seconds || seconds < 1) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  formatDateTime(d: string): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  formatBytes(bytes?: number): string {
    const b = Number(bytes || 0);
    if (!b) return '—';
    if (b < 1024) return `${b} B`;
    const kb = b / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  }
}
