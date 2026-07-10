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
import { RecordingAccessRequestService } from '../../../services/recording-access-request.service';
import {
  GoRecordingResourceService,
  GoRecordingResourceType,
} from '../../../services/go-recording-resource.service';
import Hls, { ErrorData } from 'hls.js';
import { hlsAuthXhrSetup, hlsAuthFetchSetup } from '../../../utils/hls-auth-xhr';

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
  /** Mongo id of RecordingAccessRequest when status is PENDING (for cancel). */
  accessRequestId?: string | null;
  /** When false, show pending UI instead of play (backend-driven). */
  canPlay?: boolean;
  /** 'cross_batch' (legacy) or 'self_pace' when unlocked via attendance-gated mapping. */
  accessSource?: 'cross_batch' | 'self_pace' | null;
  /** Source batch label when accessSource === 'cross_batch'. */
  sharedFromBatch?: string | null;
  sharedFromCourseDay?: number | null;
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
  /** Fired after submit/cancel so parent can refresh quota UI. */
  @Output() recordingRequestChanged = new EventEmitter<void>();
  /** Fired when watch progress is saved (parent can refresh day-completion badge). */
  @Output() watchProgressUpdated = new EventEmitter<void>();

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
  /** Saved playback position (seconds) waiting to be applied to the video element. */
  private pendingResumeSec: number | null = null;

  // Resources modal
  showResourceModal = false;
  resourceRecording: DisplayRecording | null = null;
  resources: any[] = [];
  loadingResources = false;
  cancellingRequestId: string | null = null;

  // Signed-URL cache: meetingLinkId → { url, expiresAt }
  // Stores either the HLS playlist URL (if hlsMode) or MP4 URL (legacy).
  private readonly zoomUrlCache = new Map<string, { url: string; hlsMode: boolean; expiresAt: number }>();
  private readonly warmedHlsUrls = new Set<string>();
  /** Zoom URL hint cache; server uses 7d presigned segments + ~24h playlist cache. */
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private service: ClassRecordingsService,
    private goResourceService: GoRecordingResourceService,
    private recordingAccessService: RecordingAccessRequestService,
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
    if ((changes['courseDayFilter'] && !changes['courseDayFilter'].firstChange) ||
        (changes['refreshToken'] && !changes['refreshToken'].firstChange)) {
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
      accessRequestId: (r['accessRequestId'] as string) || null,
      canPlay: r['canPlay'] !== false,
      accessSource:
        r['accessSource'] === 'cross_batch' || r['accessSource'] === 'self_pace'
          ? (r['accessSource'] as DisplayRecording['accessSource'])
          : null,
      sharedFromBatch: (r['sharedFromBatch'] as string) || null,
      sharedFromCourseDay: r['sharedFromCourseDay'] != null && Number.isFinite(Number(r['sharedFromCourseDay'])) ? Number(r['sharedFromCourseDay']) : null,
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

  /** Waiting for admin to approve/decline the recording access request. */
  isAccessRequestPending(r: DisplayRecording): boolean {
    return r.accessRequestStatus === 'PENDING';
  }

  /** Approved by admin; recording is still uploading or processing in the portal. */
  isRecordingProcessing(r: DisplayRecording): boolean {
    return r.accessRequestStatus === 'APPROVED' && r.canPlay === false;
  }

  isPendingApproval(r: DisplayRecording): boolean {
    return this.isAccessRequestPending(r) || this.isRecordingProcessing(r);
  }

  isDeclinedRequest(r: DisplayRecording): boolean {
    return r.accessRequestStatus === 'DECLINED';
  }

  canCancelRecordingRequest(r: DisplayRecording): boolean {
    return this.isAccessRequestPending(r) && !!(r.accessRequestId || r.meetingLinkId);
  }

  cancelRecordingRequest(r: DisplayRecording, event?: Event): void {
    event?.stopPropagation();
    const requestId = r.accessRequestId;
    const meetingLinkId = r.meetingLinkId;
    const busyKey = requestId || meetingLinkId || '';
    if (!busyKey || this.cancellingRequestId) return;
    this.cancellingRequestId = busyKey;
    const req$ = requestId
      ? this.recordingAccessService.cancelRequest(requestId)
      : meetingLinkId
        ? this.recordingAccessService.cancelPendingByMeeting(meetingLinkId)
        : null;
    if (!req$) {
      this.cancellingRequestId = null;
      return;
    }
    req$.subscribe({
      next: () => {
        this.cancellingRequestId = null;
        this.recordingRequestChanged.emit();
        this.reloadRecordings();
      },
      error: () => {
        this.cancellingRequestId = null;
      },
    });
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

  viewResource(r: { _id?: string; fileUrl?: string; originalName?: string; mimeType?: string }): void {
    this.goResourceService.viewResource(r);
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
    return new Date(d).toLocaleDateString('sr-Latn-RS', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  playRecording(recording: DisplayRecording): void {
    if (!this.canPlayRecording(recording)) return;
    if (!getAuthToken()) {
      this.playerError = 'Sesija je istekla. Prijavite se ponovo.';
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
    this.pendingResumeSec = null;

    if (recording.type === 'manual') {
      this.startWatching(recording.id);
      if (recording.manualSourceType === 'HLS_UPLOAD') {
        if (recording.manualStatus === 'processing') {
          this.playerLoading = false;
          this.playerError = 'Snimak se još obrađuje. Proverite ponovo uskoro.';
          return;
        }
        if (recording.manualStatus === 'failed') {
          this.playerLoading = false;
          this.playerError = recording.manualErrorMessage || 'Konverzija snimka nije uspela. Kontaktirajte podršku.';
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
        this.playerError   = 'URL videa nedostaje za ovaj snimak.';
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
      this.playerError   = 'Informacije o času nedostaju.';
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
    // Flush final watch time + playback position while the video element still exists.
    this.stopTracking();
    this.stopZoomTracking();
    this.destroyHls();
    this.pendingResumeSec = null;
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
      this.playerError = 'Sesija je istekla. Prijavite se ponovo.';
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
        fetchSetup: hlsAuthFetchSetup,
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
        } else {
          this.tryApplyResume();
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
        this.playerError = 'Greška pri reprodukciji. Osvežite stranicu i pokušajte ponovo.';
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
    this.tryApplyResume();
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
    this.playerError    = 'Nije moguće reprodukovati video. Pokušajte ponovo.';
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
          this.playerError = 'Snimak se još obrađuje. Proverite ponovo uskoro.';
        } else if (err.status === 403) {
          this.playerError = 'Ovaj snimak je sakriven ili nije dostupan za vašu grupu.';
        } else {
          this.playerError = msg || 'Nije moguće učitati snimak. Pokušajte ponovo.';
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

  // ── Resume playback ───────────────────────────────────────────────────────

  /** Store the saved position (from the backend) and seek once the video is ready. */
  private setResumePosition(sec: number | undefined | null): void {
    let resume = Math.max(0, Math.floor(Number(sec) || 0));
    const duration = Number(this.currentPlayingRecording?.duration || 0);
    // Already finished (or nearly): restart from the beginning.
    if (duration > 0 && resume >= duration - 15) resume = 0;
    if (resume <= 1) {
      this.pendingResumeSec = null;
      return;
    }
    this.pendingResumeSec = resume;
    this.tryApplyResume();
  }

  /** Seek the video element to the pending resume position when metadata is loaded. */
  private tryApplyResume(): void {
    const video = this.srVideoEl?.nativeElement;
    if (!video || this.pendingResumeSec == null) return;
    if (video.readyState >= 1 /* HAVE_METADATA */) {
      try {
        video.currentTime = this.pendingResumeSec;
      } catch {
        /* seek may throw before buffer ready */
      }
      this.pendingResumeSec = null;
    }
  }

  /** Current playback position of the open player (seconds), for heartbeat saves. */
  private currentVideoPositionSec(): number | null {
    const video = this.srVideoEl?.nativeElement;
    const t = Number(video?.currentTime);
    return Number.isFinite(t) && t >= 0 ? Math.round(t) : null;
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
        this.setResumePosition(res.resumePositionSec);
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
    this.service.updateViewDuration(this.activeViewId, seconds, this.currentVideoPositionSec()).subscribe({
      next: () => this.watchProgressUpdated.emit(),
      error: () => {},
    });
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
        this.setResumePosition(res.resumePositionSec);
        this.zoomDurationInterval = setInterval(() => this.updateZoomDuration(), 15000);
      },
      error: () => {},
    });
  }

  private updateZoomDuration(): void {
    if (!this.activeZoomViewId) return;
    let seconds = Math.round((Date.now() - this.zoomWatchStartTime) / 1000);
    const recDuration = this.currentPlayingRecording?.duration;
    if (recDuration && recDuration > 0) {
      seconds = Math.min(seconds, recDuration);
    }
    this.service.updateZoomViewDuration(this.activeZoomViewId, seconds, this.currentVideoPositionSec()).subscribe({
      next: () => this.watchProgressUpdated.emit(),
      error: () => {},
    });
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

  getCrossBatchLabel(r: DisplayRecording): string | null {
    if (r.accessSource === 'self_pace') {
      return `Self Pace recording — Journey Day ${r.sharedFromCourseDay ?? r.courseDay}`;
    }
    if (r.accessSource === 'cross_batch' && r.sharedFromBatch) {
      return `Shared class recording — Journey Day ${r.sharedFromCourseDay ?? r.courseDay} (Batch ${r.sharedFromBatch})`;
    }
    return null;
  }

  getAttendanceLabel(r: DisplayRecording): string {
    const totalSec = Number(r.duration ?? 0);
    const rawWatchedSec = Math.max(0, Math.round(Number(r.watchedSeconds ?? 0)));
    // Cap to total duration so wall-clock over-runs never inflate the display
    const watchedSec = totalSec > 0 ? Math.min(rawWatchedSec, totalSec) : rawWatchedSec;
    const watchRatio = this.resolveIsSilverStudent() ? 0.9 : 0.75;
    if (totalSec > 0 && watchedSec >= Math.ceil(totalSec * watchRatio)) {
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
    return new Date(d).toLocaleDateString('sr-Latn-RS', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  formatTime(d: string): string {
    return new Date(d).toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' });
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
    const goOk = String(user?.goStatus || '').toUpperCase() === 'GO';
    return goOk && String(user?.subscription || '').toUpperCase() === 'SILVER';
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
