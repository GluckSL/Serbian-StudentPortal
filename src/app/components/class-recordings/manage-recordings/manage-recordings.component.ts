import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MaterialModule } from '../../../shared/material.module';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PageEvent } from '@angular/material/paginator';
import {
  ClassRecordingsService,
  ClassRecording,
  AdminClassRecording,
  ZoomWebhookAuditRow,
  ManualUploadHistoryRow,
} from '../../../services/class-recordings.service';
import { RecordingAccessRequestService } from '../../../services/recording-access-request.service';
import { NotificationService } from '../../../services/notification.service';
import { forkJoin, of } from 'rxjs';

@Component({
  selector: 'app-manage-recordings',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './manage-recordings.component.html',
  styleUrls: ['./manage-recordings.component.css']
})
export class ManageRecordingsComponent implements OnInit, OnDestroy {
  /** Current page rows from the server (not the full dataset). */
  recordings: AdminClassRecording[] = [];
  totalCount = 0;
  readyTotalCount = 0;
  manualUploadHistory: ManualUploadHistoryRow[] = [];
  manualUploadHistorySummary: Record<string, number> = {};
  manualUploadHistoryLoading = false;
  readonly skeletonRows = Array.from({ length: 10 });
  pageIndex = 0;
  pageSize = 15;
  readonly pageSizeOptions = [10, 15, 25, 50];
  tableLoading = false;
  availableBatches: string[] = [];
  levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  plans = [
    { value: 'ALL', label: 'All Plans' },
    { value: 'SILVER', label: 'Silver' },
    { value: 'PLATINUM', label: 'Platinum' },
    { value: 'VISA_DOC_ONLY', label: 'Visa & Doc Only' }
  ];

  loading = true;
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
  selectedManualRecordingIds: string[] = [];
  saving = false;
  selectedVideoFile: File | null = null;
  private manualUploadPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Modal upload/conversion progress (manual file create). */
  uploadInProgress = false;
  uploadPhase: 'uploading' | 'converting' | null = null;
  uploadPercent = 0;
  uploadLoadedBytes = 0;
  uploadTotalBytes: number | null = null;
  uploadEtaText = '';
  uploadStatusLine = '';
  private uploadStartedAtMs = 0;
  private conversionStartedAtMs = 0;
  private conversionEstimateSec = 20 * 60;
  private modalConversionPollTimer: ReturnType<typeof setInterval> | null = null;
  private modalConversionRecordingId: string | null = null;
  /** XHR used for direct-to-R2 upload so it can be aborted. */
  private directUploadXhr: XMLHttpRequest | null = null;

  form = {
    title: '',
    description: '',
    videoUrl: '',
    zoomMeetingId: '',
    batches: [] as string[],
    level: 'A1',
    plan: 'ALL',
    courseDay: '' as number | '',
  };

  // Filters
  filterLevel = 'ALL';
  filterBatch = 'ALL';
  searchQuery = '';
  appliedSearchQuery = '';

  // Analytics
  analyticsSummary: Record<string, any> = {};
  showViewsModal = false;
  viewsRecording: ClassRecording | null = null;
  viewsList: any[] = [];
  loadingViews = false;
  zoomTeachers: Array<{ _id: string; name: string; email?: string }> = [];
  showZoomEditModal = false;
  zoomEditingMeetingLinkId: string | null = null;
  zoomEditForm = {
    title: '',
    batches: [] as string[],
    level: '',
    plan: 'ALL',
    teacherId: '',
    courseDay: '' as number | '',
  };
  viewsMeta: { totalStudents?: number; watchedCount?: number; notWatchedCount?: number; totalWatchSeconds?: number; videoSizeBytes?: number } = {};

  // ── Recording access requests (count badge; full UI in new tab) ─────────────
  pendingCount = 0;

  constructor(
    private service: ClassRecordingsService,
    private snackBar: MatSnackBar,
    private sanitizer: DomSanitizer,
    private notify: NotificationService,
    private router: Router,
    private recordingReqService: RecordingAccessRequestService
  ) {}

  ngOnInit(): void {
    this.loadRecordings();
    this.loadManualUploadHistory();
    this.loadBatches();
    this.loadZoomTeachers();
    this.startProcessingClock();
    this.loadPendingCount();
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
      // Targeted IDs: force retry (stuck processing/failed). Bulk (no IDs): force HLS migration.
      force: true,
    }).subscribe({
      next: () => {
        // Server responds 202 immediately — begin polling for completion.
        this.backfillStatusMessage = 'Backfill running in background…';
        this.snackBar.open(
          meetingIds.length
            ? `Targeted backfill started for ${meetingIds.length} meeting ID(s) — will retry stuck/failed and re-fetch from Zoom.`
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
            if (s) {
              const parts: string[] = [];
              if (s.pipelineCompleted) parts.push(`✅ ${s.pipelineCompleted} processed`);
              if (s.pipelineFailed) parts.push(`❌ ${s.pipelineFailed} failed`);
              if (s.skippedAlreadyReady) parts.push(`${s.skippedAlreadyReady} already ready`);
              if (s.skippedProcessing) parts.push(`${s.skippedProcessing} still processing`);
              if (s.reclaimedStaleProcessing) parts.push(`${s.reclaimedStaleProcessing} reclaimed stale`);
              if (s.skippedNoRecordingInZoom) parts.push(`${s.skippedNoRecordingInZoom} no Zoom file`);
              if (s.errors) parts.push(`${s.errors} scan errors`);
              this.backfillStatusMessage = parts.length ? `Done — ${parts.join(', ')}` : 'Done — nothing to process';
            } else {
              this.backfillStatusMessage = status.error ? `Backfill error: ${status.error}` : 'Backfill complete';
            }
            this.snackBar.open(this.backfillStatusMessage, 'Close', { duration: 10000 });
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
    this.stopModalConversionPolling();
    if (this.directUploadXhr) { this.directUploadXhr.abort(); this.directUploadXhr = null; }
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

  loadRecordings(resetPage = false): void {
    if (resetPage) this.pageIndex = 0;
    const isInitial = this.loading;
    if (!isInitial) this.tableLoading = true;

    this.service.getAdminRecordingsPage({
      page: this.pageIndex + 1,
      limit: this.pageSize,
      level: this.filterLevel,
      batch: this.filterBatch,
      search: this.appliedSearchQuery,
    }).subscribe({
      next: (res) => {
        this.recordings = (res.recordings || []).map((r: AdminClassRecording) => ({
          ...r,
          isPublished: r.isPublished !== false,
        }));
        this.totalCount = res.total ?? this.recordings.length;
        if (res.summary?.readyTotal != null) {
          this.readyTotalCount = res.summary.readyTotal;
        }
        this.syncPublishSelectionWithCurrentPage();
        if (isInitial) this.loadAnalytics();
        this.loading = false;
        this.tableLoading = false;
      },
      error: () => {
        this.snackBar.open('Error loading recordings', 'Close', { duration: 3000 });
        this.loading = false;
        this.tableLoading = false;
      },
    });
  }

  loadManualUploadHistory(silent = false): void {
    if (!silent) this.manualUploadHistoryLoading = true;
    this.service.getManualUploadHistory(25).subscribe({
      next: (res) => {
        this.manualUploadHistory = res.rows || [];
        this.manualUploadHistorySummary = res.summary || {};
        this.manualUploadHistoryLoading = false;
      },
      error: () => {
        this.manualUploadHistoryLoading = false;
      },
    });
  }

  private syncPublishSelectionWithCurrentPage(): void {
    const currentZoomIds = new Set(
      this.recordings
        .filter((r) => this.isZoomRecording(r) && r.meetingLinkId)
        .map((r) => String(r.meetingLinkId))
    );
    this.selectedZoomMeetingIds = this.selectedZoomMeetingIds.filter((id) => currentZoomIds.has(id));
    const currentManualIds = new Set(
      this.recordings
        .filter((r) => !this.isZoomRecording(r) && r._id)
        .map((r) => String(r._id))
    );
    this.selectedManualRecordingIds = this.selectedManualRecordingIds.filter((id) =>
      currentManualIds.has(id)
    );
  }

  loadBatches(): void {
    this.service.getBatches().subscribe({
      next: (res) => { this.availableBatches = res.batches; },
      error: () => {}
    });
  }

  /** Row has an ingested/stored video (not a Zoom webhook stub still processing). */
  hasRecordingAsset(r: AdminClassRecording): boolean {
    if (this.isZoomRecording(r)) {
      return Boolean(r.r2Key || r.hlsKey);
    }
    if (r.sourceType === 'HLS_UPLOAD') {
      return Boolean(r.hlsKey);
    }
    return Boolean((r.videoUrl || '').trim());
  }

  getMeetingIdDisplay(r: AdminClassRecording): string {
    return r.zoomMeetingId ? String(r.zoomMeetingId) : '—';
  }

  get recordingsWithMediaCount(): number {
    return this.readyTotalCount || this.totalCount;
  }

  get readyToPlayCount(): number {
    return this.readyTotalCount || this.totalCount;
  }

  /** Shown in admin table: stored media and fully processed. */
  isListableRecording(r: AdminClassRecording): boolean {
    return this.hasRecordingAsset(r) && r.status === 'ready';
  }

  canPlayRecording(r: AdminClassRecording): boolean {
    return this.isListableRecording(r);
  }

  getRecordingDurationSeconds(r: AdminClassRecording): number | null {
    const videoSec = Number(r.duration);
    if (Number.isFinite(videoSec) && videoSec > 0) return Math.round(videoSec);
    const classMin = Number(r.classDuration);
    if (Number.isFinite(classMin) && classMin > 0) return Math.round(classMin * 60);
    return null;
  }

  getRecordingDurationDisplay(r: AdminClassRecording): string {
    const sec = this.getRecordingDurationSeconds(r);
    if (sec == null || sec < 1) return '—';
    return this.formatClock(sec);
  }

  trackByRecording(_index: number, r: AdminClassRecording): string {
    return String(r._id || r.meetingLinkId || _index);
  }

  applySearch(): void {
    this.appliedSearchQuery = this.searchQuery.trim();
    this.applyFilters();
  }

  applyFilters(): void {
    this.loadRecordings(true);
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.loadRecordings();
  }

  get paginationStart(): number {
    if (!this.totalCount) return 0;
    return this.pageIndex * this.pageSize + 1;
  }

  get paginationEnd(): number {
    return Math.min((this.pageIndex + 1) * this.pageSize, this.totalCount);
  }

  openForm(recording?: ClassRecording): void {
    this.selectedVideoFile = null;
    if (recording) {
      this.editing = recording;
      this.form = {
        title: recording.title,
        description: recording.description,
        videoUrl: recording.videoUrl,
        zoomMeetingId: recording.zoomMeetingId ? String(recording.zoomMeetingId) : '',
        batches: [...recording.batches],
        level: recording.level,
        plan: recording.plan,
        courseDay: Number.isFinite(Number(recording.courseDay)) ? Number(recording.courseDay) : '',
      };
    } else {
      this.editing = null;
      this.form = {
        title: '',
        description: '',
        videoUrl: '',
        zoomMeetingId: '',
        batches: [],
        level: 'A1',
        plan: 'ALL',
        courseDay: '',
      };
    }
    this.showForm = true;
  }

  closeForm(): void {
    // Block close only while the file is actively transferring to the server/R2.
    if (this.uploadPhase === 'uploading') return;
    // During the server-side conversion phase, let the admin work elsewhere.
    if (this.uploadPhase === 'converting') {
      this.sendToBackground();
      return;
    }
    this.resetUploadProgress();
    this.showForm = false;
    this.editing = null;
    this.selectedVideoFile = null;
    this.saving = false;
  }

  /** Dismiss the modal while conversion runs server-side; notify via snackbar when done. */
  sendToBackground(): void {
    const rid = this.modalConversionRecordingId;
    this.stopModalConversionPolling();
    this.resetUploadProgress();
    this.showForm = false;
    this.editing = null;
    this.selectedVideoFile = null;
    this.saving = false;
    if (rid) {
      this.startManualUploadPolling(rid);
    }
    this.snackBar.open(
      'Video conversion is running in the background. You\'ll be notified when it\'s ready.',
      'OK',
      { duration: 8000 }
    );
    this.loadRecordings();
  }

  /** Cancel an in-progress file upload (aborts the XHR). */
  cancelUpload(): void {
    if (this.directUploadXhr) {
      this.directUploadXhr.abort();
      this.directUploadXhr = null;
    }
    this.saving = false;
    this.resetUploadProgress();
    this.snackBar.open('Upload cancelled.', 'Close', { duration: 3000 });
  }

  private resetUploadProgress(): void {
    this.uploadInProgress = false;
    this.uploadPhase = null;
    this.uploadPercent = 0;
    this.uploadLoadedBytes = 0;
    this.uploadTotalBytes = null;
    this.uploadEtaText = '';
    this.uploadStatusLine = '';
    this.uploadStartedAtMs = 0;
    this.conversionStartedAtMs = 0;
    this.modalConversionRecordingId = null;
    this.directUploadXhr = null;
    this.stopModalConversionPolling();
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
      const uploadCourseDay = this.normalizeCourseDay(this.form.courseDay);
      if (uploadCourseDay != null) fd.append('courseDay', String(uploadCourseDay));
      const meetingId = (this.form.zoomMeetingId || '').trim();
      if (meetingId) fd.append('zoomMeetingId', meetingId);
      fd.append('video', this.selectedVideoFile);

      this.beginFileUpload(fd, this.selectedVideoFile);
      return;
    }

    if (!hasVideoUrl && this.editing?.sourceType !== 'HLS_UPLOAD') {
      this.snackBar.open('Please provide video URL', 'Close', { duration: 3000 });
      return;
    }

    const obs = this.editing
      ? this.service.update(this.editing._id, {
          ...this.form,
          courseDay: this.normalizeCourseDay(this.form.courseDay),
          zoomMeetingId: (this.form.zoomMeetingId || '').trim() || null,
        })
      : this.service.create({
          ...this.form,
          courseDay: this.normalizeCourseDay(this.form.courseDay),
          zoomMeetingId: (this.form.zoomMeetingId || '').trim() || null,
        });

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

  /**
   * Fast upload flow:
   * 1. Ask server for a presigned R2 PUT URL (also creates the DB record).
   * 2. PUT the file directly to R2 via XHR (progress events, no Node bottleneck).
   * 3. Tell the server the file is ready → triggers FFmpeg in the background.
   * 4. Close the modal automatically; conversion continues server-side.
   */
  private beginFileUpload(fd: FormData, file: File): void {
    this.saving = true;
    this.uploadInProgress = true;
    this.uploadPhase = 'uploading';
    this.uploadPercent = 0;
    this.uploadLoadedBytes = 0;
    this.uploadTotalBytes = file.size > 0 ? file.size : null;
    this.uploadEtaText = 'Calculating…';
    this.uploadStatusLine = `Uploading ${file.name}`;
    this.uploadStartedAtMs = Date.now();
    this.conversionEstimateSec = this.estimateConversionSecondsForFile(file);

    // Extract scalar form fields from FormData for the prepare request.
    const prepareData = {
      title: fd.get('title') as string,
      description: (fd.get('description') as string) || '',
      level: fd.get('level') as string,
      plan: (fd.get('plan') as string) || 'ALL',
      batches: ((fd.get('batches') as string) || '').split(',').map((b) => b.trim()).filter(Boolean),
      courseDay: fd.has('courseDay') ? Number(fd.get('courseDay')) || null : null,
      zoomMeetingId: fd.has('zoomMeetingId') ? String(fd.get('zoomMeetingId')).trim() || null : null,
      filename: file.name,
      contentType: file.type || 'video/mp4',
    };

    this.service.prepareDirectUpload(prepareData).subscribe({
      next: ({ recordingId, uploadUrl, r2RawKey }) => {
        this.uploadStatusLine = `Uploading video · ${this.formatBytes(0)} / ${this.formatBytes(file.size)}`;
        this.uploadStartedAtMs = Date.now();
        this.directUploadXhr = this.uploadFileToR2(uploadUrl, file, {
          onProgress: (loaded, total) => {
            this.uploadLoadedBytes = loaded;
            this.uploadTotalBytes = total;
            this.uploadPercent = total > 0 ? Math.min(99, Math.round((100 * loaded) / total)) : 0;
            this.uploadEtaText = this.formatUploadEta(loaded, total);
            const sizeHint = this.formatUploadSizeHint(loaded, total);
            this.uploadStatusLine = `Uploading video${sizeHint ? ` · ${sizeHint}` : ''}`;
          },
          onComplete: () => {
            this.uploadPercent = 100;
            this.uploadEtaText = 'Upload complete — starting conversion…';
            this.directUploadXhr = null;
            this.service.startProcessing(recordingId, r2RawKey).subscribe({
              next: () => this.startModalConversionPhase(recordingId),
              error: (err) => {
                this.saving = false;
                this.resetUploadProgress();
                this.snackBar.open(err.error?.message || 'Failed to start conversion', 'Close', { duration: 5000 });
              },
            });
          },
          onError: (status) => {
            this.directUploadXhr = null;
            this.saving = false;
            this.resetUploadProgress();
            this.snackBar.open(
              status === 0 ? 'Upload cancelled.' : `Upload failed (HTTP ${status})`,
              'Close',
              { duration: 5000 }
            );
          },
        });
      },
      error: (err) => {
        this.saving = false;
        this.resetUploadProgress();
        this.snackBar.open(err.error?.message || 'Failed to prepare upload', 'Close', { duration: 5000 });
      },
    });
  }

  /**
   * PUT a file directly to a presigned URL using XMLHttpRequest.
   * Returns the XHR instance so callers can abort it.
   */
  private uploadFileToR2(
    presignedUrl: string,
    file: File,
    callbacks: {
      onProgress: (loaded: number, total: number) => void;
      onComplete: () => void;
      onError: (status: number) => void;
    }
  ): XMLHttpRequest {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignedUrl, true);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) callbacks.onProgress(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        callbacks.onComplete();
      } else {
        callbacks.onError(xhr.status);
      }
    });
    xhr.addEventListener('error', () => callbacks.onError(xhr.status));
    xhr.addEventListener('abort', () => callbacks.onError(0));
    xhr.send(file);
    return xhr;
  }

  private startModalConversionPhase(recordingId: string): void {
    if (!recordingId) {
      this.finishUploadFlow(false, 'Upload finished but recording id was missing.');
      return;
    }
    this.uploadPhase = 'converting';
    this.conversionStartedAtMs = Date.now();
    this.modalConversionRecordingId = recordingId;
    this.uploadStatusLine = 'File received — converting to HLS on the server (runs in background)';
    this.updateConversionProgressDisplay();
    this.loadRecordings();
    this.loadManualUploadHistory(true);
    this.startModalConversionPolling(recordingId);
    // Auto-send to background after 4 s so the admin can keep working.
    setTimeout(() => {
      if (this.uploadPhase === 'converting') {
        this.sendToBackground();
      }
    }, 4000);
  }

  private startModalConversionPolling(recordingId: string): void {
    this.stopModalConversionPolling();
    const poll = () => {
      this.service.getManualUploadStatus(recordingId).subscribe({
        next: (s) => {
          if (s.status === 'processing') {
            this.updateConversionProgressDisplay();
            return;
          }
          this.stopModalConversionPolling();
          if (s.status === 'ready') {
            this.uploadPercent = 100;
            this.uploadEtaText = 'Complete';
            this.finishUploadFlow(
              true,
              'Video converted to HLS and is ready. Use Publish Selected or the eye icon so students can see it.'
            );
            return;
          }
          this.finishUploadFlow(false, s.errorMessage || 'Video conversion failed.');
        },
        error: () => { /* keep polling */ },
      });
    };
    poll();
    this.modalConversionPollTimer = setInterval(poll, 3000);
  }

  private stopModalConversionPolling(): void {
    if (this.modalConversionPollTimer) {
      clearInterval(this.modalConversionPollTimer);
      this.modalConversionPollTimer = null;
    }
  }

  private finishUploadFlow(success: boolean, message: string): void {
    this.saving = false;
    this.uploadInProgress = false;
    this.uploadPhase = null;
    this.stopModalConversionPolling();
    this.snackBar.open(message, 'Close', { duration: success ? 6000 : 7000 });
    this.modalConversionRecordingId = null;
    this.closeForm();
    this.loadRecordings();
    this.loadManualUploadHistory(true);
  }

  private updateConversionProgressDisplay(): void {
    const elapsedSec = Math.max(
      0,
      Math.floor((Date.now() - this.conversionStartedAtMs) / 1000)
    );
    const estimate = Math.max(60, this.conversionEstimateSec);
    const ratio = Math.min(0.95, elapsedSec / estimate);
    this.uploadPercent = Math.max(this.uploadPercent, Math.round(ratio * 100));
    const remaining = estimate - elapsedSec;
    if (remaining <= 0) {
      this.uploadEtaText = 'Finishing soon…';
    } else {
      this.uploadEtaText = `About ${this.formatClock(remaining)} remaining (estimated)`;
    }
  }

  private formatUploadEta(loaded: number, total: number | null): string {
    if (!total || total <= 0 || loaded <= 0) {
      return 'Calculating time remaining…';
    }
    const elapsedSec = Math.max(0.5, (Date.now() - this.uploadStartedAtMs) / 1000);
    const bytesPerSec = loaded / elapsedSec;
    if (bytesPerSec < 1) return 'Calculating time remaining…';
    const remainingSec = Math.ceil((total - loaded) / bytesPerSec);
    if (remainingSec <= 0) return 'Almost done…';
    return `About ${this.formatClock(remainingSec)} remaining`;
  }

  private formatUploadSizeHint(loaded: number, total: number | null): string {
    if (!total || total <= 0) return `${this.formatBytes(loaded)} uploaded`;
    return `${this.formatBytes(loaded)} / ${this.formatBytes(total)}`;
  }

  private estimateConversionSecondsForFile(file: File): number {
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > 0) {
      return Math.min(75 * 60, Math.max(5 * 60, Math.round(sizeMb * 45)));
    }
    return 20 * 60;
  }

  getUploadPhaseLabel(): string {
    if (this.uploadPhase === 'uploading') return 'Step 1 of 2 — Uploading file';
    if (this.uploadPhase === 'converting') return 'Step 2 of 2 — Converting to HLS';
    return '';
  }

  private startManualUploadPolling(recordingId: string): void {
    this.stopManualUploadPolling();
    this.manualUploadPollTimer = setInterval(() => {
      this.service.getManualUploadStatus(recordingId).subscribe({
        next: (s) => {
          if (s.status === 'processing') {
            this.loadManualUploadHistory(true);
            return;
          }
          this.stopManualUploadPolling();
          if (s.status === 'ready') {
            this.snackBar.open(
              'Video converted to HLS and is ready. Use Publish Selected or the eye icon so students can see it.',
              'Close',
              { duration: 6000 }
            );
          } else {
            this.snackBar.open(s.errorMessage || 'Video conversion failed.', 'Close', { duration: 7000 });
          }
          this.loadRecordings();
          this.loadManualUploadHistory(true);
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
      batches: Array.isArray(r.batches) ? [...r.batches] : [],
      level: r.level && r.level !== 'ZOOM' ? r.level : '',
      plan: r.plan || 'ALL',
      teacherId: r.assignedTeacherId ? String(r.assignedTeacherId) : '',
      courseDay: Number.isFinite(Number(r.courseDay)) ? Number(r.courseDay) : '',
    };
    this.showZoomEditModal = true;
  }

  closeZoomEdit(): void {
    this.showZoomEditModal = false;
    this.zoomEditingMeetingLinkId = null;
    this.zoomEditForm = { title: '', batches: [], level: '', plan: 'ALL', teacherId: '', courseDay: '' };
  }

  saveZoomEdit(): void {
    if (!this.zoomEditingMeetingLinkId) return;
    if (!this.zoomEditForm.title.trim()) {
      this.snackBar.open('Title is required', 'Close', { duration: 2500 });
      return;
    }
    if (!this.zoomEditForm.batches.length) {
      this.snackBar.open('Select at least one batch', 'Close', { duration: 2500 });
      return;
    }
    this.service.updateZoomRecordingMeta(this.zoomEditingMeetingLinkId, {
      title: this.zoomEditForm.title.trim(),
      batches: Array.from(new Set(this.zoomEditForm.batches.map((b) => String(b).trim()).filter(Boolean))),
      level: this.zoomEditForm.level || null,
      plan: this.zoomEditForm.plan || 'ALL',
      teacherId: this.zoomEditForm.teacherId || undefined,
      courseDay: this.normalizeCourseDay(this.zoomEditForm.courseDay),
    }).subscribe({
      next: () => {
        this.snackBar.open('Zoom recording updated', 'Close', { duration: 2500 });
        this.closeZoomEdit();
        this.loadRecordings();
      },
      error: (err) => this.snackBar.open(err.error?.message || 'Failed to update Zoom recording', 'Close', { duration: 3000 }),
    });
  }

  toggleZoomEditBatch(batch: string): void {
    const idx = this.zoomEditForm.batches.indexOf(batch);
    if (idx >= 0) this.zoomEditForm.batches.splice(idx, 1);
    else this.zoomEditForm.batches.push(batch);
  }

  private normalizeCourseDay(value: number | '' | null | undefined): number | null {
    if (value === '' || value == null) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(200, Math.max(1, Math.floor(n)));
  }

  playRecordingAction(r: AdminClassRecording): void {
    if (!this.canPlayRecording(r)) {
      this.snackBar.open('Recording is not ready to play yet.', 'Close', { duration: 2500 });
      return;
    }
    if (this.isZoomRecording(r)) {
      if (!r.meetingLinkId) {
        this.snackBar.open('Meeting link not found for this recording.', 'Close', { duration: 3000 });
        return;
      }
      const url = this.router.serializeUrl(this.router.createUrlTree(['/class-recording', String(r.meetingLinkId)]));
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (r.sourceType === 'HLS_UPLOAD') {
      const playlistUrl = this.service.getManualHlsPlaylistUrl(String(r._id));
      window.open(playlistUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!r.videoUrl) {
      this.snackBar.open('No video URL found for this recording.', 'Close', { duration: 2500 });
      return;
    }
    window.open(r.videoUrl, '_blank', 'noopener,noreferrer');
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

  /** Ready recordings that are still hidden from students (bulk publish selection). */
  isReadyUnpublished(r: AdminClassRecording): boolean {
    return r.status === 'ready' && r.isPublished === false;
  }

  isPublishRowSelected(r: AdminClassRecording): boolean {
    if (this.isZoomRecording(r)) {
      return r.meetingLinkId ? this.selectedZoomMeetingIds.includes(String(r.meetingLinkId)) : false;
    }
    return r._id ? this.selectedManualRecordingIds.includes(String(r._id)) : false;
  }

  togglePublishRowSelection(r: AdminClassRecording): void {
    if (this.isZoomRecording(r)) {
      const meetingLinkId = r.meetingLinkId;
      if (!meetingLinkId) return;
      const id = String(meetingLinkId);
      const index = this.selectedZoomMeetingIds.indexOf(id);
      if (index >= 0) this.selectedZoomMeetingIds.splice(index, 1);
      else this.selectedZoomMeetingIds.push(id);
      return;
    }
    if (!r._id) return;
    const id = String(r._id);
    const index = this.selectedManualRecordingIds.indexOf(id);
    if (index >= 0) this.selectedManualRecordingIds.splice(index, 1);
    else this.selectedManualRecordingIds.push(id);
  }

  selectedPublishCount(): number {
    return this.selectedZoomMeetingIds.length + this.selectedManualRecordingIds.length;
  }

  publishSelectedForStudents(): void {
    const zoomIds = this.selectedZoomMeetingIds;
    const manualIds = this.selectedManualRecordingIds;
    if (this.publishLoading || (!zoomIds.length && !manualIds.length)) return;
    this.publishLoading = true;
    const zoom$ = zoomIds.length
      ? this.service.publishZoomRecordings(zoomIds, true)
      : of({ modified: 0 });
    const manual$ = manualIds.length
      ? this.service.publishManualRecordings(manualIds, true)
      : of({ modified: 0 });
    forkJoin([zoom$, manual$]).subscribe({
      next: ([zr, mr]) => {
        this.publishLoading = false;
        const total = (zr.modified || 0) + (mr.modified || 0);
        this.snackBar.open(`Published ${total} recording(s).`, 'Close', { duration: 4000 });
        this.selectedZoomMeetingIds = [];
        this.selectedManualRecordingIds = [];
        this.loadRecordings();
      },
      error: (err) => {
        this.publishLoading = false;
        this.snackBar.open(err.error?.message || 'Failed to publish recordings', 'Close', { duration: 4000 });
      },
    });
  }

  canToggleStudentVisibility(r: AdminClassRecording): boolean {
    return this.canPlayRecording(r) && (
      this.isZoomRecording(r)
        ? Boolean(r.meetingLinkId)
        : Boolean(String(r._id || '') && !String(r._id).startsWith('zoom-'))
    );
  }

  /** Stable key for disabling the eye button while a publish request is in flight. */
  visibilityActionKey(r: AdminClassRecording): string {
    if (this.isZoomRecording(r) && r.meetingLinkId) {
      return String(r.meetingLinkId);
    }
    return String(r._id || '');
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
    if (!this.canToggleStudentVisibility(r) || this.publishLoadingId) return;

    const nextState = !(r.isPublished !== false);
    const action = nextState ? 'Show to students' : 'Hide from students';
    const busyKey = this.visibilityActionKey(r);
    this.notify.confirm(
      'Student Visibility',
      `${action} for "${r.title}"?`,
      'Yes',
      'Cancel'
    ).subscribe((ok) => {
      if (!ok) return;
      this.publishLoadingId = busyKey;
      const req = this.isZoomRecording(r) && r.meetingLinkId
        ? this.service.publishZoomRecordings([String(r.meetingLinkId)], nextState)
        : this.service.publishManualRecordings([String(r._id)], nextState);
      req.subscribe({
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
    this.appliedSearchQuery = '';
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

  getManualUploadStatusLabel(row: ManualUploadHistoryRow): string {
    if (row.status === 'processing') return 'Converting';
    if (row.status === 'failed') return 'Failed';
    if (row.status === 'ready' && row.isPublished === false) return 'Ready · Hidden';
    return 'Ready';
  }

  getManualUploadStatusClass(row: ManualUploadHistoryRow): string {
    if (row.status === 'processing') return 'cr-upload-chip--processing';
    if (row.status === 'failed') return 'cr-upload-chip--failed';
    if (row.status === 'ready' && row.isPublished === false) return 'cr-upload-chip--hidden';
    return 'cr-upload-chip--ready';
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

  // ── Recording access request approval ───────────────────────────────────────

  loadPendingCount(): void {
    this.recordingReqService.getPendingCount().subscribe({
      next: (res) => { this.pendingCount = res.count || 0; },
      error: () => {}
    });
  }

  openApprovalInNewTab(): void {
    const tree = this.router.createUrlTree(['/class-recordings/approval-requests']);
    const url = `${window.location.origin}${this.router.serializeUrl(tree)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    this.loadPendingCount();
  }

  openAccessRecordingTab(): void {
    const tree = this.router.createUrlTree(['/class-recordings/self-pace']);
    const url = `${window.location.origin}${this.router.serializeUrl(tree)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
