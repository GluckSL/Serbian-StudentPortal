import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../../services/auth.service';
import {
  ClassRecordingsService,
  ClassRecording,
  BatchZoomRecording,
} from '../../../services/class-recordings.service';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

/** Unified shape for displaying both manual and Zoom recordings in the same list */
export interface DisplayRecording {
  type: 'manual' | 'zoom';
  id: string; // _id for manual, meetingLinkId for zoom
  title: string;
  description: string;
  date: string; // ISO date string
  duration: number | null; // seconds
  batch: string;
  teacherName: string;
  attempted: boolean | null;
  attendanceStatus: 'Attended' | 'Not Attended' | 'Not Attempted' | 'Pending' | 'N/A';
  // manual-specific
  videoUrl?: string;
  level?: string;
  plan?: string;
  uploadedBy?: string;
  // zoom-specific
  meetingLinkId?: string;
}

@Component({
  selector: 'app-student-recordings',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './student-recordings.component.html',
  styleUrls: ['./student-recordings.component.css'],
})
export class StudentRecordingsComponent implements OnInit, OnDestroy {
  /** When true, hides the page header (e.g. inside My Course). */
  @Input() embedded = false;

  allRecordings: DisplayRecording[] = [];
  filteredRecordings: DisplayRecording[] = [];
  loading = false;
  searchQuery = '';
  currentUserBatch = '';

  // Player modal state
  showPlayerModal = false;
  playerLoading = false;
  playerError: string | null = null;
  playerKind: 'video' | 'iframe' = 'video';
  playerTitle = '';
  playerVideoUrl: string | null = null;
  playerIframeUrl: SafeResourceUrl | null = null;

  // Optional details modal
  showDetailsModal = false;
  selectedRecording: DisplayRecording | null = null;

  // Manual recording view tracking
  activeViewId: string | null = null;
  activeRecordingId: string | null = null;
  watchStartTime = 0;
  private manualDurationInterval: any = null;
  private activeZoomViewId: string | null = null;
  private zoomWatchStartTime = 0;
  private zoomDurationInterval: any = null;

  constructor(
    private service: ClassRecordingsService,
    private sanitizer: DomSanitizer,
    private snackBar: MatSnackBar,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.loading = true;
    this.currentUserBatch = String(this.serviceUserBatch() || '');

    forkJoin({
      manual: this.service.getRecordings().pipe(catchError(() => of({ success: false, recordings: [] as ClassRecording[] }))),
      zoom: this.service.getMyBatchZoomRecordings().pipe(catchError(() => of({ success: false, recordings: [] as BatchZoomRecording[] }))),
    }).subscribe(({ manual, zoom }) => {
      const manualItems: DisplayRecording[] = (manual.recordings || []).map((r: ClassRecording) => ({
        type: 'manual',
        id: r._id,
        title: r.title,
        description: r.description || '',
        date: r.createdAt,
        duration: null,
        batch: (r.batches || []).join(', '),
        teacherName: r.uploadedBy?.name || 'Teacher',
        attempted: null,
        attendanceStatus: 'N/A',
        videoUrl: r.videoUrl,
        level: r.level,
        plan: r.plan,
        uploadedBy: r.uploadedBy?.name,
      }));

      const zoomItems: DisplayRecording[] = (zoom.recordings || []).map((r: BatchZoomRecording) => ({
        type: 'zoom',
        id: r.meetingLinkId,
        title: r.topic,
        description: '',
        date: r.classDate,
        duration: r.duration,
        batch: r.batch,
        teacherName: r.teacherName || 'Teacher',
        attempted: typeof r.attempted === 'boolean' ? r.attempted : null,
        attendanceStatus: r.attendanceStatus || 'Pending',
        meetingLinkId: r.meetingLinkId,
      }));

      // Merge and sort newest-first
      const merged = [...manualItems, ...zoomItems].filter((r) => this.isSameBatchForStudent(r.batch));
      this.allRecordings = merged.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      this.filteredRecordings = [...this.allRecordings];
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.stopTracking();
    this.stopZoomTracking();
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  applySearch(): void {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) { this.filteredRecordings = [...this.allRecordings]; return; }
    this.filteredRecordings = this.allRecordings.filter(
      (r) => r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.batch.toLowerCase().includes(q)
    );
  }

  // ── Row actions ────────────────────────────────────────────────────────────

  playRecording(recording: DisplayRecording): void {
    this.stopZoomTracking();
    this.playerLoading = true;
    this.playerError = null;
    this.playerTitle = recording.title;
    this.playerVideoUrl = null;
    this.playerIframeUrl = null;
    this.showPlayerModal = true;

    if (recording.type === 'manual') {
      this.startWatching(recording.id);
      const manualUrl = recording.videoUrl || '';
      if (!manualUrl) {
        this.playerLoading = false;
        this.playerError = 'Video URL is missing for this recording.';
        return;
      }
      if (this.isDirectVideoFile(manualUrl)) {
        this.playerKind = 'video';
        this.playerVideoUrl = manualUrl;
      } else {
        this.playerKind = 'iframe';
        this.playerIframeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.getEmbedUrl(manualUrl));
      }
      this.playerLoading = false;
      return;
    }

    if (!recording.meetingLinkId) {
      this.playerLoading = false;
      this.playerError = 'Meeting information is missing.';
      return;
    }

    this.service.getZoomRecordingUrl(recording.meetingLinkId).subscribe({
      next: (res) => {
        this.playerLoading = false;
        this.playerKind = 'video';
        this.playerVideoUrl = res.signedUrl;
        this.startZoomTracking(recording.meetingLinkId!);
      },
      error: (err) => {
        this.playerLoading = false;
        const msg: string = err.error?.message || '';
        if (err.status === 202) {
          this.playerError = 'Recording is still being processed. Please check back shortly.';
        } else if (err.status === 403) {
          this.playerError = 'This recording is hidden or not available for your batch.';
        } else {
          this.playerError = msg || 'Unable to load recording. Please try again.';
        }
      },
    });
  }

  openDetails(recording: DisplayRecording): void {
    this.selectedRecording = recording;
    this.showDetailsModal = true;
  }

  closeDetails(): void {
    this.showDetailsModal = false;
    this.selectedRecording = null;
  }

  openInNewTab(recording: DisplayRecording): void {
    if (recording.type === 'manual') {
      const url = recording.videoUrl || '';
      if (!url) {
        this.snackBar.open('No URL available for this recording.', 'Close', { duration: 2500 });
        return;
      }
      window.open(url, '_blank', 'noopener');
      return;
    }

    if (!recording.meetingLinkId) return;
    this.service.getZoomRecordingUrl(recording.meetingLinkId).subscribe({
      next: (res) => window.open(res.signedUrl, '_blank', 'noopener'),
      error: () => this.snackBar.open('Unable to open this recording in a new tab.', 'Close', { duration: 2500 }),
    });
  }

  copyRecordingLink(recording: DisplayRecording): void {
    if (recording.type === 'manual') {
      const url = recording.videoUrl || '';
      if (!url) {
        this.snackBar.open('No URL available to copy.', 'Close', { duration: 2500 });
        return;
      }
      this.copyText(url);
      return;
    }

    if (!recording.meetingLinkId) return;
    this.service.getZoomRecordingUrl(recording.meetingLinkId).subscribe({
      next: (res) => this.copyText(res.signedUrl),
      error: () => this.snackBar.open('Unable to copy this recording link right now.', 'Close', { duration: 2500 }),
    });
  }

  closePlayer(): void {
    this.stopZoomTracking();
    this.showPlayerModal = false;
    this.playerLoading = false;
    this.playerError = null;
    this.playerVideoUrl = null;
    this.playerIframeUrl = null;
  }

  // ── Manual recording view tracking ────────────────────────────────────────

  startWatching(recordingId: string): void {
    if (this.activeRecordingId === recordingId) return;
    this.stopTracking();
    this.activeRecordingId = recordingId;
    this.watchStartTime = Date.now();
    this.service.startView(recordingId).subscribe({
      next: (res) => {
        this.activeViewId = res.viewId;
        this.manualDurationInterval = setInterval(() => this.updateDuration(), 15000);
      },
      error: () => {},
    });
  }

  private updateDuration(): void {
    if (!this.activeViewId) return;
    const seconds = Math.round((Date.now() - this.watchStartTime) / 1000);
    this.service.updateViewDuration(this.activeViewId, seconds).subscribe({ error: () => {} });
  }

  private stopTracking(): void {
    if (this.activeViewId) this.updateDuration();
    if (this.manualDurationInterval) { clearInterval(this.manualDurationInterval); this.manualDurationInterval = null; }
    this.activeViewId = null;
    this.activeRecordingId = null;
  }

  private startZoomTracking(meetingLinkId: string): void {
    this.stopZoomTracking();
    this.zoomWatchStartTime = Date.now();
    this.service.startZoomView(meetingLinkId).subscribe({
      next: (res) => {
        this.activeZoomViewId = res.viewId;
        this.zoomDurationInterval = setInterval(() => this.updateZoomDuration(), 15000);
      },
      error: () => {},
    });
  }

  private updateZoomDuration(): void {
    if (!this.activeZoomViewId) return;
    const seconds = Math.round((Date.now() - this.zoomWatchStartTime) / 1000);
    this.service.updateZoomViewDuration(this.activeZoomViewId, seconds).subscribe({ error: () => {} });
  }

  private stopZoomTracking(): void {
    if (this.activeZoomViewId) this.updateZoomDuration();
    if (this.zoomDurationInterval) { clearInterval(this.zoomDurationInterval); this.zoomDurationInterval = null; }
    this.activeZoomViewId = null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  getEmbedUrl(url: string): string {
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
    return url;
  }

  isDirectVideoFile(url: string): boolean {
    return /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(url || '');
  }

  getAttemptedLabel(r: DisplayRecording): string {
    if (r.attempted === null) return 'N/A';
    return r.attempted ? 'Yes' : 'No';
  }

  getAttendanceLabel(r: DisplayRecording): string {
    return r.attendanceStatus || 'Pending';
  }

  getAttendanceClass(r: DisplayRecording): string {
    const s = this.getAttendanceLabel(r).toLowerCase();
    if (s === 'attended') return 'sr-attendance sr-attendance--ok';
    if (s === 'not attended' || s === 'not attempted') return 'sr-attendance sr-attendance--warn';
    if (s === 'pending') return 'sr-attendance sr-attendance--pending';
    return 'sr-attendance';
  }

  formatDate(d: string): string {
    return new Date(d).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  formatTime(d: string): string {
    return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatDuration(seconds: number | null): string {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  private serviceUserBatch(): string {
    return String(this.authService.getSnapshotUser()?.batch || '');
  }

  private normalizeBatch(value: string): string {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/^batch\s+/, '')
      .replace(/\s+/g, ' ');
  }

  private isSameBatchForStudent(recordingBatch: string): boolean {
    if (!this.currentUserBatch) return true;
    const a = this.normalizeBatch(this.currentUserBatch);
    const b = this.normalizeBatch(recordingBatch);
    if (!a || !b) return false;
    if (a === b) return true;
    return (
      b.startsWith(`${a} -`) || b.startsWith(`${a}:`) || b.startsWith(`${a} |`) ||
      a.startsWith(`${b} -`) || a.startsWith(`${b}:`) || a.startsWith(`${b} |`)
    );
  }

  private copyText(text: string): void {
    const done = () => this.snackBar.open('Link copied.', 'Close', { duration: 1800 });
    const fail = () => this.snackBar.open('Copy failed. Please copy manually.', 'Close', { duration: 2200 });
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
      return;
    }
    fail();
  }
}
