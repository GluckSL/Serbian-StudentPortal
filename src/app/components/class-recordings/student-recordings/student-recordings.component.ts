import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
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
  id: string;                   // _id for manual, meetingLinkId for zoom
  title: string;
  description: string;
  date: string;                 // ISO date string
  duration: number | null;      // seconds
  batch: string;
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

  // Zoom player state
  activeZoomId: string | null = null;    // meetingLinkId currently loading/playing
  activeZoomUrl: string | null = null;   // presigned URL once fetched
  zoomLoading = false;
  zoomError: string | null = null;

  // Manual recording view tracking
  activeViewId: string | null = null;
  activeRecordingId: string | null = null;
  watchStartTime = 0;
  private durationInterval: any = null;

  constructor(
    private service: ClassRecordingsService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.loading = true;

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
        meetingLinkId: r.meetingLinkId,
      }));

      // Merge and sort newest-first
      this.allRecordings = [...manualItems, ...zoomItems].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      this.filteredRecordings = [...this.allRecordings];
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.stopTracking();
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  applySearch(): void {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) { this.filteredRecordings = [...this.allRecordings]; return; }
    this.filteredRecordings = this.allRecordings.filter(
      (r) => r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.batch.toLowerCase().includes(q)
    );
  }

  // ── Zoom recording playback ────────────────────────────────────────────────

  playZoomRecording(meetingLinkId: string): void {
    if (this.activeZoomId === meetingLinkId && this.activeZoomUrl) return; // already loaded

    this.activeZoomId = meetingLinkId;
    this.activeZoomUrl = null;
    this.zoomLoading = true;
    this.zoomError = null;

    this.service.getZoomRecordingUrl(meetingLinkId).subscribe({
      next: (res) => {
        this.zoomLoading = false;
        this.activeZoomUrl = res.signedUrl;
      },
      error: (err) => {
        this.zoomLoading = false;
        const msg: string = err.error?.message || '';
        if (err.status === 202) {
          this.zoomError = 'Recording is still being processed. Please check back shortly.';
        } else if (err.status === 403) {
          this.zoomError = 'This recording is not available for your batch.';
        } else {
          this.zoomError = msg || 'Unable to load recording. Please try again.';
        }
      },
    });
  }

  closeZoomPlayer(): void {
    this.activeZoomId = null;
    this.activeZoomUrl = null;
    this.zoomError = null;
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
        this.durationInterval = setInterval(() => this.updateDuration(), 15000);
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
    if (this.durationInterval) { clearInterval(this.durationInterval); this.durationInterval = null; }
    this.activeViewId = null;
    this.activeRecordingId = null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  getSafeUrl(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.getEmbedUrl(url));
  }

  getEmbedUrl(url: string): string {
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
    return url;
  }

  isGoogleDrive(url: string): boolean {
    return /drive\.google\.com/.test(url || '');
  }

  getGoogleDriveOpenUrl(url: string): string {
    const match = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return `https://drive.google.com/file/d/${match[1]}/view`;
    return url;
  }

  formatDate(d: string): string {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  formatDuration(seconds: number | null): string {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
}
