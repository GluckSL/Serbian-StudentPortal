import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewChecked,
  OnChanges,
  SimpleChanges,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MaterialModule } from '../../../shared/material.module';
import { AuthService, getAuthToken } from '../../../services/auth.service';
import { ClassRecordingsService } from '../../../services/class-recordings.service';
import {
  GoRecordingResourceService,
  GoRecordingResourceType,
} from '../../../services/go-recording-resource.service';
import Hls, { ErrorData } from 'hls.js';
import { hlsAuthXhrSetup } from '../../../utils/hls-auth-xhr';

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
  manualSourceType?: 'URL' | 'HLS_UPLOAD';
  manualStatus?: 'processing' | 'ready' | 'failed' | 'missing';
  manualErrorMessage?: string | null;
  /** Set when recording is tagged to a journey day (GO / batch). */
  courseDay?: number | null;
  /** Student watch time for this class recording (minutes), when backend provides it. */
  watchedSeconds?: number | null;
  /** Platinum recording-access request state for this class. */
  accessRequestStatus?: 'PENDING' | 'APPROVED' | 'DECLINED' | null;
  /** When false, show pending UI instead of play (backend-driven). */
  canPlay?: boolean;
}

@Component({
  selector: 'app-student-recordings',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './student-recordings.component.html',
  styleUrls: ['./student-recordings.component.css'],
})
export class StudentRecordingsComponent implements OnInit, OnDestroy, AfterViewChecked, OnChanges {
  @Input() embedded = false;
  /** When set (1–200), only list recordings tagged with this journey `courseDay` (Journey tab / GO). */
  @Input() courseDayFilter: number | null = null;
  /** Platinum students can request access to batch class recordings. */
  @Input() isPlatinumStudent = false;
  /** Increment from parent to reload the list (e.g. after submitting a request). */
  @Input() refreshToken = 0;
  @Output() reqRecordingClick = new EventEmitter<void>();

  @ViewChild('srVideoEl') srVideoEl?: ElementRef<HTMLVideoElement>;

  filteredRecordings: DisplayRecording[] = [];
  readonly recordingsPageSize = 7;
  recordingsPage = 1;
  recordingsTotal = 0;
  recordingsTotalPages = 1;
  loading = false;
  readonly skeletonRecordingRows = [0, 1, 2, 3, 4, 5, 6];
  searchQuery = '';
  /** Filter / sort mode for the recordings list (see filter menu in template). */
  recordingFilter: RecordingListFilter = 'all';
  currentUserBatch = '';
  isSilverStudent = false;

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
  /** Used to refetch a cache-busted playlist after expiring R2 presigns (e.g. 1h). */
  private hlsRefreshContext: { kind: 'zoom'; meetingLinkId: string } | { kind: 'manual'; recordingId: string } | null =
    null;
  private hlsFatalRecoveryAttempts = 0;
  private readonly hlsRecoveryMax = 2;

  // ── Manual recording view tracking ────────────────────────────────────────
  activeViewId: string | null = null;
  activeRecordingId: string | null = null;
  watchStartTime = 0;
  private manualDurationInterval: any = null;
  private activeZoomViewId: string | null = null;
  private zoomWatchStartTime = 0;
  private zoomDurationInterval: any = null;
  private currentPlayingRecording: DisplayRecording | null = null;

  // Resources modal
  showResourceModal = false;
  resourceRecording: DisplayRecording | null = null;
  resources: any[] = [];
  loadingResources = false;

  // Signed-URL cache: meetingLinkId → { url, expiresAt }
  // Stores either the HLS playlist URL (if hlsMode) or MP4 URL (legacy).
  private readonly zoomUrlCache = new Map<string, { url: string; hlsMode: boolean; expiresAt: number }>();
  private readonly warmedHlsUrls = new Set<string>();
  /** Zoom URL hint cache; server uses 7d presigned segments + ~24h playlist cache. */
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private service: ClassRecordingsService,
    private goResourceService: GoRecordingResourceService,
    private sanitizer: DomSanitizer,
    private authService: AuthService,
    private router: Router
  ) {}

  /** True when parent pins this list to a single journey day (hides search / sort chrome). */
  get journeyDayFilterActive(): boolean {
    const d = Number(this.courseDayFilter);
    return Number.isFinite(d) && d >= 1 && d <= 200;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['courseDayFilter'] || changes['refreshToken']) {
      this.recordingsPage = 1;
      this.loadRecordingsPage(1);
    }
  }

  ngOnInit(): void {
    this.currentUserBatch = String(this.serviceUserBatch() || '');
    this.isSilverStudent = this.resolveIsSilverStudent();
    this.loadRecordingsPage(1);
  }

  loadRecordingsPage(page: number): void {
    this.loading = true;
    const courseDay = this.journeyDayFilterActive ? Number(this.courseDayFilter) : null;
    this.service
      .getStudentRecordingsFeed({
        page,
        limit: this.recordingsPageSize,
        search: this.searchQuery,
        filter: this.recordingFilter,
        courseDay,
      })
      .subscribe({
        next: (res) => {
          const rows = Array.isArray(res?.recordings) ? res.recordings : [];
          this.filteredRecordings = rows.map((r) => this.mapFeedRow(r));
          this.recordingsPage = Number(res?.page) || page;
          this.recordingsTotal = Number(res?.total) || 0;
          this.recordingsTotalPages = Math.max(
            1,
            Number(res?.totalPages) || Math.ceil(this.recordingsTotal / this.recordingsPageSize)
          );
          this.prefetchFirst5Zoom();
          this.loading = false;
        },
        error: () => {
          this.filteredRecordings = [];
          this.recordingsTotal = 0;
          this.recordingsTotalPages = 1;
          this.loading = false;
        },
      });
  }

  private mapFeedRow(r: Record<string, unknown>): DisplayRecording {
    const type = r['type'] === 'zoom' ? 'zoom' : 'manual';
    return {
      type,
      id: String(r['id'] ?? ''),
      title: String(r['title'] ?? ''),
      description: String(r['description'] ?? ''),
      date: String(r['date'] ?? ''),
      duration: Number.isFinite(Number(r['duration'])) ? Number(r['duration']) : null,
      batch: String(r['batch'] ?? ''),
      teacherName: String(r['teacherName'] ?? 'Teacher'),
      attempted: typeof r['attempted'] === 'boolean' ? r['attempted'] : null,
      attendanceStatus: (r['attendanceStatus'] as DisplayRecording['attendanceStatus']) || 'N/A',
      videoUrl: r['videoUrl'] as string | undefined,
      level: r['level'] as string | undefined,
      plan: r['plan'] as string | undefined,
      uploadedBy: r['uploadedBy'] as string | undefined,
      meetingLinkId: r['meetingLinkId'] as string | undefined,
      manualSourceType: r['manualSourceType'] as DisplayRecording['manualSourceType'],
      manualStatus: r['manualStatus'] as DisplayRecording['manualStatus'],
      manualErrorMessage: (r['manualErrorMessage'] as string | null) ?? null,
      courseDay: r['courseDay'] != null && Number.isFinite(Number(r['courseDay'])) ? Number(r['courseDay']) : null,
      watchedSeconds: Number.isFinite(Number(r['watchedSeconds'])) ? Number(r['watchedSeconds']) : 0,
      accessRequestStatus: (r['accessRequestStatus'] as DisplayRecording['accessRequestStatus']) || null,
      canPlay: r['canPlay'] !== false,
    };
  }

  /** Reload list from page 1 (called by parent after recording request submit). */
  reloadRecordings(): void {
    this.recordingsPage = 1;
    this.loadRecordingsPage(1);
  }

  canPlayRecording(r: DisplayRecording): boolean {
    if (r.accessRequestStatus === 'PENDING' || r.accessRequestStatus === 'DECLINED') return false;
    return r.canPlay !== false;
  }

  isPendingApproval(r: DisplayRecording): boolean {
    return r.accessRequestStatus === 'PENDING' || (r.accessRequestStatus === 'APPROVED' && r.canPlay === false);
  }

  isDeclinedRequest(r: DisplayRecording): boolean {
    return r.accessRequestStatus === 'DECLINED';
  }

  changeRecordingsPage(page: number): void {
    const p = Math.min(Math.max(1, page), this.recordingsTotalPages);
    if (p === this.recordingsPage && !this.loading) return;
    this.loadRecordingsPage(p);
  }

  getRecordingsPageNumbers(): number[] {
    const total = this.recordingsTotalPages;
    const current = this.recordingsPage;
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    const pages: number[] = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  recordingsPageRangeLabel(): string {
    if (this.recordingsTotal === 0) return '';
    const start = (this.recordingsPage - 1) * this.recordingsPageSize + 1;
    const end = Math.min(this.recordingsPage * this.recordingsPageSize, this.recordingsTotal);
    return `Showing ${start}–${end} of ${this.recordingsTotal}`;
  }

  ngAfterViewChecked(): void {
    // When hls init is pending, the <video> element may not yet be in the DOM.
    // AfterViewChecked runs after every Angular change detection cycle,
    // so the element will be available on the cycle after *ngIf renders it.
    if (this.pendingHlsInit && this.srVideoEl?.nativeElement) {
      this.pendingHlsInit = false;
      this.initHlsOnElement(this.srVideoEl.nativeElement, this.playerHlsUrl!, null);
    }
  }

  ngOnDestroy(): void {
    this.destroyHls();
    this.stopTracking();
    this.stopZoomTracking();
  }

  // ── Search ────────────────────────────────────────────────────────────────

  applySearch(): void {
    this.recordingsPage = 1;
    this.loadRecordingsPage(1);
  }

  setRecordingFilter(mode: RecordingListFilter): void {
    this.recordingFilter = mode;
    this.recordingsPage = 1;
    this.loadRecordingsPage(1);
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

  openResources(recording: DisplayRecording): void {
    this.resourceRecording = recording;
    this.showResourceModal = true;
    this.loadingResources = true;
    const type: GoRecordingResourceType = recording.type === 'zoom' ? 'zoom' : 'manual';
    const id = recording.type === 'zoom' ? String(recording.meetingLinkId || recording.id) : recording.id;
    this.goResourceService.list(type, id).subscribe({
      next: (res) => {
        this.resources = res.data || [];
        this.loadingResources = false;
      },
      error: () => {
        this.resources = [];
        this.loadingResources = false;
      },
    });
  }

  closeResourceModal(): void {
    this.showResourceModal = false;
    this.resourceRecording = null;
    this.resources = [];
  }

  viewResource(r: { fileUrl?: string }): void {
    this.goResourceService.openInBrowser(r.fileUrl || '');
  }

  downloadResource(r: { _id?: string; fileUrl?: string; originalName?: string }): void {
    this.goResourceService.downloadResource(r);
  }

  formatFileSize(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  formatResourceDate(d: string | Date | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  playRecording(recording: DisplayRecording): void {
    if (!this.canPlayRecording(recording)) return;
    if (!getAuthToken()) {
      this.playerError = 'Session expired. Please login again.';
      void this.router.navigate(['/login'], { queryParams: { session: 'expired' } });
      return;
    }
    this.destroyHls();
    this.hlsRefreshContext = null;
    this.hlsFatalRecoveryAttempts = 0;
    this.stopZoomTracking();
    this.playerLoading   = true;
    this.playerError     = null;
    this.playerTitle     = recording.title;
    this.playerVideoUrl  = null;
    this.playerHlsUrl    = null;
    this.playerIframeUrl = null;
    this.videoBuffering  = false;
    this.showPlayerModal = true;
    this.currentPlayingRecording = recording;

    if (recording.type === 'manual') {
      this.startWatching(recording.id);
      if (recording.manualSourceType === 'HLS_UPLOAD') {
        if (recording.manualStatus === 'processing') {
          this.playerLoading = false;
          this.playerError = 'Recording upload is still being processed. Please check again shortly.';
          return;
        }
        if (recording.manualStatus === 'failed') {
          this.playerLoading = false;
          this.playerError = recording.manualErrorMessage || 'Recording conversion failed. Please contact support.';
          return;
        }
        this.playerLoading = false;
        this.playerKind = 'video';
        this.hlsRefreshContext = { kind: 'manual', recordingId: recording.id };
        this.applyZoomUrl(this.service.getManualHlsPlaylistUrl(recording.id), true);
        return;
      }
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
      this.hlsRefreshContext = cached.hlsMode
        ? { kind: 'zoom' as const, meetingLinkId: String(recording.meetingLinkId) }
        : null;
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
    this.hlsRefreshContext = null;
    this.hlsFatalRecoveryAttempts = 0;
    this.currentPlayingRecording = null;
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

  private initHlsOnElement(video: HTMLVideoElement, hlsUrl: string, resumeAtSec: number | null): void {
    if (!getAuthToken()) {
      this.playerError = 'Session expired. Please login again.';
      this.playerHlsUrl = null;
      this.videoBuffering = false;
      void this.router.navigate(['/login'], { queryParams: { session: 'expired' } });
      return;
    }
    if (Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: true,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        startLevel: 0,
        startPosition: 0,
        backBufferLength: 5,
        xhrSetup: (xhr: XMLHttpRequest, url?: string) => {
          hlsAuthXhrSetup(xhr, url);
        },
        fetchSetup: (context: any, initParams: any) => {
          const token = getAuthToken();
          const headers = new Headers(initParams?.headers || {});
          if (token) {
            headers.set('Authorization', `Bearer ${token}`);
          }
          return new Request(context.url, {
            ...initParams,
            headers,
          });
        },
      });

      this.hls.loadSource(hlsUrl);
      this.hls.attachMedia(video);

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.hls!.currentLevel = 0; // lowest quality first
        this.videoBuffering = false;
        if (resumeAtSec != null && resumeAtSec > 0.5) {
          try {
            video.currentTime = resumeAtSec;
          } catch {
            /* seek may throw before buffer ready */
          }
        }
        video.play().catch(() => {});
      });

      this.hls.on(Hls.Events.FRAG_LOADED, () => {
        if (video.paused) {
          video.play().catch(() => {});
        }
      });

      this.hls.on(Hls.Events.ERROR, (_event: string, data: ErrorData) => {
        if (!data.fatal) {
          if (this.hls) this.hls.startLoad();
          return;
        }
        const resume = video.currentTime;
        const ctx = this.hlsRefreshContext;
        const canRetry =
          !!ctx &&
          this.hlsFatalRecoveryAttempts < this.hlsRecoveryMax &&
          (data.type === Hls.ErrorTypes.NETWORK_ERROR || data.type === Hls.ErrorTypes.MEDIA_ERROR);
        if (canRetry && ctx) {
          this.hlsFatalRecoveryAttempts += 1;
          this.destroyHls();
          const base =
            ctx.kind === 'zoom'
              ? this.service.getHlsPlaylistUrl(ctx.meetingLinkId)
              : this.service.getManualHlsPlaylistUrl(ctx.recordingId);
          const fresh = `${base}${base.includes('?') ? '&' : '?'}cb=${Date.now()}`;
          this.playerHlsUrl = fresh;
          this.videoBuffering = true;
          this.initHlsOnElement(video, fresh, Number.isFinite(resume) && resume > 0 ? resume : null);
          return;
        }
        this.videoBuffering = false;
        this.playerError = 'Playback error. Please refresh and try again.';
        this.playerHlsUrl = null;
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS support, no hls.js needed
      video.src = hlsUrl;
      video.addEventListener(
        'canplay',
        () => {
          this.videoBuffering = false;
          if (resumeAtSec != null && resumeAtSec > 0.5) {
            try {
              video.currentTime = resumeAtSec;
            } catch {
              /* ignore */
            }
          }
          video.play().catch(() => {});
        },
        { once: true }
      );
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
    const video = this.srVideoEl?.nativeElement;
    if (video && this.currentPlayingRecording) {
      const sec = Number(video.duration || 0);
      if (Number.isFinite(sec) && sec > 0) {
        const rounded = Math.round(sec);
        this.currentPlayingRecording.duration = rounded;
        if (this.currentPlayingRecording.type === 'manual' && this.currentPlayingRecording.id) {
          const recId = this.currentPlayingRecording.id;
          this.service.updateManualDuration(recId, rounded).subscribe({
            next: () => {},
            error: () => {},
          });
        }
      }
    }
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
        if (hlsMode) {
          this.hlsRefreshContext = { kind: 'zoom', meetingLinkId: String(meetingLinkId) };
          this.hlsFatalRecoveryAttempts = 0;
        } else {
          this.hlsRefreshContext = null;
        }
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
    this.filteredRecordings
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
    const token = getAuthToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    fetch(hlsUrl, { headers }).catch(() => {});
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
    let seconds = Math.round((Date.now() - this.watchStartTime) / 1000);
    const recDuration = this.currentPlayingRecording?.duration;
    if (recDuration && recDuration > 0) {
      seconds = Math.min(seconds, recDuration);
    }
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
    const totalSec = Number(r.duration ?? 0);
    const rawWatchedSec = Math.max(0, Math.round(Number(r.watchedSeconds ?? 0)));
    // Cap to total duration so wall-clock over-runs never inflate the display
    const watchedSec = totalSec > 0 ? Math.min(rawWatchedSec, totalSec) : rawWatchedSec;
    if (totalSec > 0 && watchedSec >= Math.ceil(totalSec * 0.75)) {
      return 'Watched';
    }
    const watched = Math.floor(watchedSec / 60);
    const totalMin = totalSec > 0 ? Math.max(1, Math.round(totalSec / 60)) : 0;
    return `${watched} / ${totalMin} min`;
  }

  getAttendanceClass(r: DisplayRecording): string {
    const s = this.getAttendanceLabel(r).toLowerCase();
    if (s === 'attended' || s === 'watched') return 'sr-attendance sr-attendance--ok';
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

  formatJourneyDay(r: DisplayRecording): string {
    return r.courseDay != null && Number.isFinite(Number(r.courseDay)) ? String(r.courseDay) : '—';
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

  private resolveIsSilverStudent(): boolean {
    const user = this.authService.getSnapshotUser();
    return String(user?.subscription || '').toUpperCase() === 'SILVER';
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
