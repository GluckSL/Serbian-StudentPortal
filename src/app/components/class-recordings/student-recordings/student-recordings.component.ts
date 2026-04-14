import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewChecked,
  Input,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
import { AuthService } from '../../../services/auth.service';
import {
  ClassRecordingsService,
  ClassRecording,
  BatchZoomRecording,
} from '../../../services/class-recordings.service';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import Hls, { ErrorData } from 'hls.js';
import { environment } from '../../../../environments/environment';

/** Single active list filter (combined with search text). Uses attendance, not Zoom "attempted". */
export type RecordingListFilter =
  | 'all'
  | 'attended'
  | 'not_attended'
  | 'date_newest'
  | 'date_oldest';

/** Unified shape for displaying both manual and Zoom recordings in the same list */
export interface DisplayRecording {
  type: 'manual' | 'zoom';
  id: string;
  title: string;
  description: string;
  date: string;
  duration: number | null;
  batch: string;
  teacherName: string;
  attempted: boolean | null;
  attendanceStatus: 'Attended' | 'Not Attended' | 'Not Attempted' | 'Pending' | 'N/A';
  videoUrl?: string;
  level?: string;
  plan?: string;
  uploadedBy?: string;
  meetingLinkId?: string;
}

@Component({
  selector: 'app-student-recordings',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './student-recordings.component.html',
  styleUrls: ['./student-recordings.component.css'],
})
export class StudentRecordingsComponent implements OnInit, OnDestroy, AfterViewChecked {
  @Input() embedded = false;

  @ViewChild('srVideoEl') srVideoEl?: ElementRef<HTMLVideoElement>;

  allRecordings: DisplayRecording[] = [];
  filteredRecordings: DisplayRecording[] = [];
  loading = false;
  searchQuery = '';
  /** Filter / sort mode for the recordings list (see filter menu in template). */
  recordingFilter: RecordingListFilter = 'all';
  currentUserBatch = '';

  // ── Player modal state ────────────────────────────────────────────────────
  showPlayerModal  = false;
  playerLoading    = false;
  playerError: string | null = null;
  playerKind: 'video' | 'iframe' = 'video';
  playerTitle      = '';
  /** Set for MP4 (legacy) mode — bound directly to [attr.src] on <video>. */
  playerVideoUrl: string | null = null;
  /** Set for HLS mode — hls.js loadSource() target. */
  playerHlsUrl: string | null = null;
  playerIframeUrl: SafeResourceUrl | null = null;
  videoBuffering   = false;

  // ── hls.js instance ───────────────────────────────────────────────────────
  private hls: Hls | null = null;
  /** Signals AfterViewChecked to call initHlsPlayer once video el is in DOM. */
  private pendingHlsInit = false;

  // ── Manual recording view tracking ────────────────────────────────────────
  activeViewId: string | null = null;
  activeRecordingId: string | null = null;
  watchStartTime = 0;
  private manualDurationInterval: any = null;
  private activeZoomViewId: string | null = null;
  private zoomWatchStartTime = 0;
  private zoomDurationInterval: any = null;

  // Signed-URL cache: meetingLinkId → { url, expiresAt }
  // Stores either the HLS playlist URL (if hlsMode) or MP4 URL (legacy).
  private readonly zoomUrlCache = new Map<string, { url: string; hlsMode: boolean; expiresAt: number }>();
  private readonly warmedHlsUrls = new Set<string>();
  private readonly CACHE_TTL_MS = 13 * 60 * 1000; // 13 min

  constructor(
    private service: ClassRecordingsService,
    private sanitizer: DomSanitizer,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.loading = true;
    this.currentUserBatch = String(this.serviceUserBatch() || '');

    forkJoin({
      manual: this.service.getRecordings().pipe(catchError(() => of({ success: false, recordings: [] as ClassRecording[] }))),
      zoom:   this.service.getMyBatchZoomRecordings().pipe(catchError(() => of({ success: false, recordings: [] as BatchZoomRecording[] }))),
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

      const merged = [...manualItems, ...zoomItems].filter((r) => this.isSameBatchForStudent(r.batch));
      this.allRecordings = merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      this.applyListFilters();
      this.prefetchFirst5Zoom();
      this.loading = false;
    });
  }

  ngAfterViewChecked(): void {
    // When hls init is pending, the <video> element may not yet be in the DOM.
    // AfterViewChecked runs after every Angular change detection cycle,
    // so the element will be available on the cycle after *ngIf renders it.
    if (this.pendingHlsInit && this.srVideoEl?.nativeElement) {
      this.pendingHlsInit = false;
      this.initHlsOnElement(this.srVideoEl.nativeElement, this.playerHlsUrl!);
    }
  }

  ngOnDestroy(): void {
    this.destroyHls();
    this.stopTracking();
    this.stopZoomTracking();
  }

  // ── Search ────────────────────────────────────────────────────────────────

  applySearch(): void {
    this.applyListFilters();
  }

  /** Apply search text + recording filter / date sort to `filteredRecordings`. */
  applyListFilters(): void {
    let list = [...this.allRecordings];
    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.batch.toLowerCase().includes(q)
      );
    }
    switch (this.recordingFilter) {
      case 'attended':
        list = list.filter((r) => this.matchesAttendedFilter(r));
        break;
      case 'not_attended':
        list = list.filter((r) => this.matchesNotAttendedFilter(r));
        break;
      case 'date_newest':
        list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        break;
      case 'date_oldest':
        list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        break;
      default:
        list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        break;
    }
    this.filteredRecordings = list;
  }

  setRecordingFilter(mode: RecordingListFilter): void {
    this.recordingFilter = mode;
    this.applyListFilters();
  }

  /** Normalized attendance label for filtering (API may vary casing). */
  private readAttendanceNorm(r: DisplayRecording): string {
    return (r.attendanceStatus || '').trim().toLowerCase();
  }

  /** Filter: attended classes only. */
  private matchesAttendedFilter(r: DisplayRecording): boolean {
    return this.readAttendanceNorm(r) === 'attended';
  }

  /**
   * Filter: not attended / not completed — everything except "Attended" and bare N/A
   * (manual-only rows stay in "All" only).
   */
  private matchesNotAttendedFilter(r: DisplayRecording): boolean {
    const a = this.readAttendanceNorm(r);
    if (a === 'attended' || a === 'n/a' || a === '') return false;
    return (
      a === 'not attended' ||
      a === 'not attempted' ||
      a === 'pending'
    );
  }

  // ── Hover prefetch ────────────────────────────────────────────────────────
  // When the mouse enters a play button, silently pre-fetch the URL so that
  // by the time the user clicks (~200 ms later) the URL is already cached.

  onPlayButtonHover(recording: DisplayRecording): void {
    if (recording.type !== 'zoom' || !recording.meetingLinkId) return;
    const cached = this.getCachedZoomUrl(recording.meetingLinkId);
    if (cached) {
      if (cached.hlsMode) this.warmHlsPlaylist(cached.url);
      return;
    }
    this.fetchAndCacheZoomUrl(recording.meetingLinkId, false);
  }

  // ── Row actions ───────────────────────────────────────────────────────────

  playRecording(recording: DisplayRecording): void {
    this.destroyHls();
    this.stopZoomTracking();
    this.playerLoading   = true;
    this.playerError     = null;
    this.playerTitle     = recording.title;
    this.playerVideoUrl  = null;
    this.playerHlsUrl    = null;
    this.playerIframeUrl = null;
    this.videoBuffering  = false;
    this.showPlayerModal = true;

    if (recording.type === 'manual') {
      this.startWatching(recording.id);
      const manualUrl = recording.videoUrl || '';
      if (!manualUrl) {
        this.playerLoading = false;
        this.playerError   = 'Video URL is missing for this recording.';
        return;
      }
      if (this.isDirectVideoFile(manualUrl)) {
        this.playerKind     = 'video';
        this.playerVideoUrl = manualUrl;
        this.videoBuffering = true;
      } else {
        this.playerKind      = 'iframe';
        this.playerIframeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.getEmbedUrl(manualUrl));
      }
      this.playerLoading = false;
      return;
    }

    if (!recording.meetingLinkId) {
      this.playerLoading = false;
      this.playerError   = 'Meeting information is missing.';
      return;
    }

    const cached = this.getCachedZoomUrl(recording.meetingLinkId);
    if (cached) {
      this.playerLoading = false;
      this.playerKind    = 'video';
      this.startZoomTracking(recording.meetingLinkId);
      this.applyZoomUrl(cached.url, cached.hlsMode);
      return;
    }

    this.fetchAndCacheZoomUrl(recording.meetingLinkId, true);
  }

  closePlayer(): void {
    this.destroyHls();
    this.stopZoomTracking();
    this.showPlayerModal = false;
    this.playerLoading   = false;
    this.playerError     = null;
    this.playerVideoUrl  = null;
    this.playerHlsUrl    = null;
    this.playerIframeUrl = null;
    this.videoBuffering  = false;
    this.pendingHlsInit  = false;
  }

  // ── HLS player ────────────────────────────────────────────────────────────

  private applyZoomUrl(url: string, hlsMode: boolean): void {
    this.videoBuffering = true;
    if (hlsMode) {
      this.playerHlsUrl   = url;
      this.playerVideoUrl = null;
      // Signal AfterViewChecked to init hls.js once <video> is in the DOM
      this.pendingHlsInit = true;
    } else {
      this.playerVideoUrl = url;
      this.playerHlsUrl   = null;
    }
  }

  private initHlsOnElement(video: HTMLVideoElement, hlsUrl: string): void {
    if (Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: true,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        startLevel: 0,
        startPosition: 0,
        backBufferLength: 5,
        xhrSetup: (xhr: XMLHttpRequest, url?: string) => {
          // Only same-origin API requests need cookies (playlist). Presigned .ts URLs
          // are on R2 — withCredentials there triggers a credentialed CORS mode that
          // R2 will not satisfy → browser reports "CORS error" and playback stalls.
          try {
            const apiOrigin = new URL(environment.apiUrl).origin;
            const target = new URL(url || '', window.location.href);
            if (target.origin === apiOrigin) {
              xhr.withCredentials = true;
            }
          } catch {
            /* leave default (no credentials) for R2 / opaque URLs */
          }
        },
      });

      this.hls.loadSource(hlsUrl);
      this.hls.attachMedia(video);

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.hls!.currentLevel = 0; // lowest quality first
        this.videoBuffering = false;
        video.play().catch(() => {});
      });

      this.hls.on(Hls.Events.FRAG_LOADED, () => {
        if (video.paused) {
          video.play().catch(() => {});
        }
      });

      this.hls.on(Hls.Events.ERROR, (_event: string, data: ErrorData) => {
        if (data.fatal) {
          this.videoBuffering = false;
          this.playerError    = 'Playback error. Please refresh and try again.';
          this.playerHlsUrl   = null;
        }
      });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS support, no hls.js needed
      video.src = hlsUrl;
      video.addEventListener('canplay', () => {
        this.videoBuffering = false;
        video.play().catch(() => {});
      }, { once: true });
    }
  }

  private destroyHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  // ── Video element event handlers (for MP4 mode) ───────────────────────────

  onVideoCanPlay(): void {
    this.videoBuffering = false;
    this.srVideoEl?.nativeElement.play().catch(() => {});
  }

  onVideoWaiting(): void {
    this.videoBuffering = true;
  }

  onVideoPlaying(): void {
    this.videoBuffering = false;
  }

  onVideoError(): void {
    this.videoBuffering = false;
    this.playerError    = 'Unable to play this video. Please try again.';
    this.playerVideoUrl = null;
  }

  // ── Zoom URL fetching + caching ───────────────────────────────────────────

  private fetchAndCacheZoomUrl(meetingLinkId: string, applyToPlayer: boolean): void {
    this.service.getZoomRecordingUrl(meetingLinkId).subscribe({
      next: (res) => {
        const hlsMode = !!res.hlsMode;
        const url = hlsMode
          ? this.service.getHlsPlaylistUrl(meetingLinkId)
          : (res.signedUrl ?? '');

        this.setCachedZoomUrl(meetingLinkId, url, hlsMode);
        if (hlsMode) this.warmHlsPlaylist(url);

        if (!applyToPlayer) return;
        this.playerLoading = false;
        this.playerKind    = 'video';
        this.startZoomTracking(meetingLinkId);
        this.applyZoomUrl(url, hlsMode);
      },
      error: (err) => {
        if (!applyToPlayer) return;
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

  private prefetchFirst5Zoom(): void {
    this.allRecordings
      .filter((r) => r.type === 'zoom' && !!r.meetingLinkId)
      .slice(0, 5)
      .forEach((r) => {
        const id = String(r.meetingLinkId);
        if (!this.getCachedZoomUrl(id)) {
          this.fetchAndCacheZoomUrl(id, false);
        }
      });
  }

  private getCachedZoomUrl(meetingLinkId: string): { url: string; hlsMode: boolean } | null {
    const entry = this.zoomUrlCache.get(meetingLinkId);
    if (!entry || Date.now() >= entry.expiresAt) {
      this.zoomUrlCache.delete(meetingLinkId);
      return null;
    }
    return { url: entry.url, hlsMode: entry.hlsMode };
  }

  private setCachedZoomUrl(meetingLinkId: string, url: string, hlsMode: boolean): void {
    this.zoomUrlCache.set(meetingLinkId, {
      url,
      hlsMode,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });
  }

  /**
   * Warm playlist fetch on hover to prime DNS + TLS + CDN edge cache.
   * Uses credentials because playlist endpoint is session-authenticated.
   */
  private warmHlsPlaylist(hlsUrl: string): void {
    if (this.warmedHlsUrls.has(hlsUrl)) return;
    this.warmedHlsUrls.add(hlsUrl);
    fetch(hlsUrl, { credentials: 'include' }).catch(() => {});
  }

  // ── Manual view tracking ──────────────────────────────────────────────────

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
    this.activeViewId      = null;
    this.activeRecordingId = null;
  }

  // ── Zoom view tracking ────────────────────────────────────────────────────

  private startZoomTracking(meetingLinkId: string): void {
    this.stopZoomTracking();
    this.zoomWatchStartTime = Date.now();
    this.service.startZoomView(meetingLinkId).subscribe({
      next: (res) => {
        this.activeZoomViewId  = res.viewId;
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

  // ── Misc helpers ──────────────────────────────────────────────────────────

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
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
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
    return String(value || '').toLowerCase().trim()
      .replace(/^batch\s+/, '').replace(/\s+/g, ' ');
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
}
