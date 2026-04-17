import { Component, OnInit, OnDestroy } from '@angular/core';
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
export class ManageRecordingsComponent implements OnInit, OnDestroy {
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
  publishLoading = false;
  backfillStatusMessage = '';
  backfillMeetingIdsInput = '';
  private backfillPollTimer: ReturnType<typeof setInterval> | null = null;
  private processingClockTimer: ReturnType<typeof setInterval> | null = null;
  private processingNowMs = Date.now();
  publishLoadingId: string | null = null;
  showWebhookAuditModal = false;
  webhookAuditLoading = false;
  webhookAuditRows: ZoomWebhookAuditRow[] = [];
  webhookAuditSummary: Record<string, number> = {};
  showForm = false;
  editing: ClassRecording | null = null;
  selectedZoomMeetingIds: string[] = [];
  saving = false;
  selectedVideoFile: File | null = null;
  private manualUploadPollTimer: ReturnType<typeof setInterval> | null = null;

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
    this.startProcessingClock();
  }

  loadZoomTeachers(): void {
    this.service.getZoomTeachers().subscribe({
      next: (res) => { this.zoomTeachers = res.data || []; },
      error: () => { this.zoomTeachers = []; }
    });
  }

  runZoomBackfill(): void {
    if (this.backfillLoading) return;
    const meetingIds = this.parseMeetingIdsInput(this.backfillMeetingIdsInput);
    this.backfillLoading = true;
    this.backfillStatusMessage = 'Starting backfill…';

    this.service.runZoomBackfill({
      batch: this.filterBatch !== 'ALL' ? this.filterBatch : null,
      limit: 200,
      includeFailed: true,
      meetingIds,
      // Re-queue recordings that are already "ready" so they run through the
      // current pipeline (HLS) instead of staying on legacy MP4-only objects.
      force: true,
    }).subscribe({
      next: () => {
        // Server responds 202 immediately — begin polling for completion.
        this.backfillStatusMessage = 'Backfill running in background…';
        this.snackBar.open(
          meetingIds.length
            ? `Targeted backfill started for ${meetingIds.length} meeting ID(s).`
            : 'Backfill started (force) — reprocessing may take a while; old MP4 → HLS where Zoom still has the file',
          'Close',
          { duration: 7000 }
        );
        this.startBackfillPolling();
      },
      error: (err) => {
        this.backfillLoading = false;
        this.backfillStatusMessage = '';
        this.snackBar.open(err.error?.message || 'Backfill failed', 'Close', { duration: 4000 });
      }
    });
  }

  private startBackfillPolling(): void {
    this.stopBackfillPolling();
    this.backfillPollTimer = setInterval(() => {
      this.service.getZoomBackfillStatus().subscribe({
        next: (status: any) => {
          if (!status.running) {
            this.stopBackfillPolling();
            this.backfillLoading = false;
            const s = status.summary;
            this.backfillStatusMessage = s
              ? `Done — queued: ${s.queued ?? 0}, skipped ready: ${s.skippedAlreadyReady ?? 0}, no recording: ${s.skippedNoRecordingInZoom ?? 0}, errors: ${s.errors ?? 0}`
              : (status.error ? `Backfill error: ${status.error}` : 'Backfill complete');
            this.snackBar.open(this.backfillStatusMessage, 'Close', { duration: 8000 });
            setTimeout(() => this.loadRecordings(), 1500);
          }
        },
        error: () => { /* silently ignore poll errors */ }
      });
    }, 5000);
  }

  private stopBackfillPolling(): void {
    if (this.backfillPollTimer) {
      clearInterval(this.backfillPollTimer);
      this.backfillPollTimer = null;
    }
  }

  private parseMeetingIdsInput(input: string): string[] {
    const ids = (input || '')
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    return Array.from(new Set(ids));
  }

  ngOnDestroy(): void {
    this.stopBackfillPolling();
    this.stopProcessingClock();
    this.stopManualUploadPolling();
  }

  private startProcessingClock(): void {
    this.stopProcessingClock();
    this.processingClockTimer = setInterval(() => {
      this.processingNowMs = Date.now();
    }, 1000);
  }

  private stopProcessingClock(): void {
    if (this.processingClockTimer) {
      clearInterval(this.processingClockTimer);
      this.processingClockTimer = null;
    }
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
        const currentIds = new Set(
          this.recordings
            .filter((r) => this.isZoomRecording(r) && r.meetingLinkId)
            .map((r) => String(r.meetingLinkId))
        );
        this.selectedZoomMeetingIds = this.selectedZoomMeetingIds.filter((id) => currentIds.has(id));
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
    this.selectedVideoFile = null;
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

  closeForm(): void {
    this.showForm = false;
    this.editing = null;
    this.selectedVideoFile = null;
    this.saving = false;
  }

  onVideoFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    this.selectedVideoFile = file;
    if (file) {
      // Upload flow uses file conversion pipeline; URL is ignored when file is selected.
      this.form.videoUrl = '';
    }
  }

  save(): void {
    if (this.saving) return;
    const isCreate = !this.editing;
    const hasUploadFile = Boolean(this.selectedVideoFile);
    const hasVideoUrl = Boolean((this.form.videoUrl || '').trim());

    if (!this.form.title || !this.form.level || this.form.batches.length === 0) {
      this.snackBar.open('Please fill title, level, and select at least one batch', 'Close', { duration: 3000 });
      return;
    }
    if (isCreate && !hasUploadFile && !hasVideoUrl) {
      this.snackBar.open('Provide either a video URL or upload a video file', 'Close', { duration: 3000 });
      return;
    }

    if (isCreate && hasUploadFile && this.selectedVideoFile) {
      const fd = new FormData();
      fd.append('title', this.form.title);
      fd.append('description', this.form.description || '');
      fd.append('level', this.form.level);
      fd.append('plan', this.form.plan || 'ALL');
      fd.append('batches', this.form.batches.join(','));
      fd.append('video', this.selectedVideoFile);

      this.saving = true;
      this.service.createFromUpload(fd).subscribe({
        next: (res) => {
          this.saving = false;
          this.snackBar.open('Upload started. Video is converting to HLS in background.', 'Close', { duration: 4500 });
          this.closeForm();
          this.loadRecordings();
          if (res.recordingId) this.startManualUploadPolling(res.recordingId);
        },
        error: (err) => {
          this.saving = false;
          this.snackBar.open(err.error?.message || 'Upload failed', 'Close', { duration: 3000 });
        }
      });
      return;
    }

    if (!hasVideoUrl && this.editing?.sourceType !== 'HLS_UPLOAD') {
      this.snackBar.open('Please provide video URL', 'Close', { duration: 3000 });
      return;
    }

    const obs = this.editing
      ? this.service.update(this.editing._id, this.form)
      : this.service.create(this.form);

    this.saving = true;
    obs.subscribe({
      next: () => {
        this.saving = false;
        this.snackBar.open(this.editing ? 'Recording updated' : 'Recording created', 'Close', { duration: 3000 });
        this.closeForm();
        this.loadRecordings();
      },
      error: (err) => {
        this.saving = false;
        this.snackBar.open(err.error?.message || 'Error saving', 'Close', { duration: 3000 });
      }
    });
  }

  private startManualUploadPolling(recordingId: string): void {
    this.stopManualUploadPolling();
    this.manualUploadPollTimer = setInterval(() => {
      this.service.getManualUploadStatus(recordingId).subscribe({
        next: (s) => {
          if (s.status === 'processing') return;
          this.stopManualUploadPolling();
          if (s.status === 'ready') {
            this.snackBar.open('Video converted to HLS and is now ready.', 'Close', { duration: 5000 });
          } else {
            this.snackBar.open(s.errorMessage || 'Video conversion failed.', 'Close', { duration: 7000 });
          }
          this.loadRecordings();
        },
        error: () => { /* ignore poll errors */ }
      });
    }, 5000);
  }

  private stopManualUploadPolling(): void {
    if (this.manualUploadPollTimer) {
      clearInterval(this.manualUploadPollTimer);
      this.manualUploadPollTimer = null;
    }
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

  isZoomReadyUnpublished(r: AdminClassRecording): boolean {
    return this.isZoomRecording(r) && r.status === 'ready' && !r.isPublished;
  }

  isSelectedZoom(meetingLinkId: string | null | undefined): boolean {
    if (!meetingLinkId) return false;
    return this.selectedZoomMeetingIds.includes(String(meetingLinkId));
  }

  toggleZoomSelection(meetingLinkId: string | null | undefined): void {
    if (!meetingLinkId) return;
    const id = String(meetingLinkId);
    const index = this.selectedZoomMeetingIds.indexOf(id);
    if (index >= 0) this.selectedZoomMeetingIds.splice(index, 1);
    else this.selectedZoomMeetingIds.push(id);
  }

  publishSelectedZoom(): void {
    if (!this.selectedZoomMeetingIds.length || this.publishLoading) return;
    this.publishLoading = true;
    this.service.publishZoomRecordings(this.selectedZoomMeetingIds, true).subscribe({
      next: (res) => {
        this.publishLoading = false;
        this.snackBar.open(
          `Published ${res.modified || 0} recording(s).`,
          'Close',
          { duration: 4000 }
        );
        this.selectedZoomMeetingIds = [];
        this.loadRecordings();
      },
      error: (err) => {
        this.publishLoading = false;
        this.snackBar.open(err.error?.message || 'Failed to publish recordings', 'Close', { duration: 4000 });
      },
    });
  }

  canToggleStudentVisibility(r: AdminClassRecording): boolean {
    return this.isZoomRecording(r) && !!r.meetingLinkId && r.status === 'ready';
  }

  isProcessingRecording(r: AdminClassRecording): boolean {
    return r.status === 'processing';
  }

  getProcessingElapsedText(r: AdminClassRecording): string {
    const startedAtMs = this.getProcessingStartMs(r);
    if (!startedAtMs) return 'Processing...';
    const elapsedSec = Math.max(0, Math.floor((this.processingNowMs - startedAtMs) / 1000));
    return `Processing ${this.formatClock(elapsedSec)}`;
  }

  getProcessingEtaText(r: AdminClassRecording): string {
    const startedAtMs = this.getProcessingStartMs(r);
    if (!startedAtMs) return 'ETA unavailable';
    const elapsedSec = Math.max(0, Math.floor((this.processingNowMs - startedAtMs) / 1000));
    const remaining = this.estimateProcessingSeconds(r) - elapsedSec;
    if (remaining <= 0) return 'Finishing soon';
    return `ETA ${this.formatClock(remaining)}`;
  }

  private getProcessingStartMs(r: AdminClassRecording): number | null {
    const candidate = r.createdAt || r.classDate;
    if (!candidate) return null;
    const ms = new Date(candidate).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  private estimateProcessingSeconds(r: AdminClassRecording): number {
    const classMinutes = Number(r.classDuration || 0);
    if (classMinutes > 0) {
      return Math.min(75 * 60, Math.max(5 * 60, Math.round(classMinutes * 25)));
    }
    const videoSeconds = Number(r.duration || 0);
    if (videoSeconds > 0) {
      return Math.min(75 * 60, Math.max(5 * 60, Math.round(videoSeconds * 0.35)));
    }
    return 20 * 60;
  }

  private formatClock(totalSeconds: number): string {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
        },
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
