import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  AfterViewChecked,
  ViewChild,
  ElementRef,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  ClassRecordingsService,
  ZoomRecordingResponse,
} from '../../../services/class-recordings.service';
import { hlsAuthXhrSetup } from '../../../utils/hls-auth-xhr';
import Hls, { ErrorData } from 'hls.js';

@Component({
  selector: 'app-zoom-recording-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './zoom-recording-player.component.html',
  styleUrls: ['./zoom-recording-player.component.css'],
})
export class ZoomRecordingPlayerComponent implements OnInit, OnDestroy, OnChanges, AfterViewChecked {
  @Input() meetingLinkId: string | null = null;

  @ViewChild('videoPlayer') videoPlayerRef!: ElementRef<HTMLVideoElement>;

  /** Set for MP4 (legacy) recordings — bound to [attr.src]. */
  videoSrc: string | null = null;
  /** Set for HLS recordings — hls.js loadSource target. */
  hlsSrc: string | null = null;

  duration: number | null = null;
  createdAt: string | null = null;
  buffering = false;

  loading = false;
  error: string | null = null;
  processingStatus: 'processing' | 'ready' | 'failed' | null = null;

  private hls: Hls | null = null;
  private pendingHlsInit = false;
  private hlsRecoveryAttempts = 0;
  private readonly hlsRecoveryMax = 2;
  private pollingTimer: any = null;
  private readonly POLL_INTERVAL_MS = 10_000;

  constructor(
    private recordingsService: ClassRecordingsService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    if (!this.meetingLinkId) {
      this.meetingLinkId = this.route.snapshot.paramMap.get('meetingLinkId');
    }
    if (this.meetingLinkId) this.loadRecording();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['meetingLinkId'] && !changes['meetingLinkId'].firstChange) {
      this.reset();
      if (this.meetingLinkId) this.loadRecording();
    }
  }

  ngAfterViewChecked(): void {
    if (this.pendingHlsInit && this.videoPlayerRef?.nativeElement) {
      this.pendingHlsInit = false;
      this.initHls(this.videoPlayerRef.nativeElement, this.hlsSrc!, null);
    }
  }

  ngOnDestroy(): void {
    this.destroyHls();
    this.clearPolling();
  }

  loadRecording(): void {
    if (!this.meetingLinkId) return;
    this.hlsRecoveryAttempts = 0;
    this.loading  = true;
    this.error    = null;
    this.videoSrc = null;
    this.hlsSrc   = null;

    this.recordingsService.getZoomRecordingUrl(this.meetingLinkId).subscribe({
      next: (res: ZoomRecordingResponse) => {
        this.loading         = false;
        this.duration        = res.duration;
        this.createdAt       = res.createdAt;
        this.processingStatus = 'ready';
        this.buffering       = true;
        this.clearPolling();

        if (res.hlsMode) {
          this.hlsSrc   = this.recordingsService.getHlsPlaylistUrl(this.meetingLinkId!);
          this.videoSrc = null;
          this.pendingHlsInit = true; // AfterViewChecked will call initHls
        } else {
          this.videoSrc = res.signedUrl;
          this.hlsSrc   = null;
        }
      },
      error: (err) => {
        this.loading  = false;
        const status  = err.status;
        const msg: string = err.error?.message || '';

        if (status === 202) {
          this.processingStatus = 'processing';
          this.error = 'Recording is being processed. This page will refresh automatically.';
          this.startPolling();
        } else if (status === 403) {
          this.error = 'You are not enrolled in this class.';
        } else if (status === 404) {
          this.error = 'No recording is available for this class yet.';
        } else if (status === 500 && msg.toLowerCase().includes('failed')) {
          this.processingStatus = 'failed';
          this.error = 'Recording processing failed. Please contact support.';
        } else {
          this.error = msg || 'Unable to load recording. Please try again later.';
        }
      },
    });
  }

  // ── HLS ───────────────────────────────────────────────────────────────────

  private initHls(video: HTMLVideoElement, url: string, resumeAtSec: number | null): void {
    this.destroyHls();

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
      });
      this.hls.loadSource(url);
      this.hls.attachMedia(video);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.hls!.currentLevel = 0; // lowest quality first
        this.buffering = false;
        if (resumeAtSec != null && resumeAtSec > 0.5) {
          try {
            video.currentTime = resumeAtSec;
          } catch {
            /* ignore */
          }
        }
        video.play().catch(() => {});
      });
      this.hls.on(Hls.Events.FRAG_LOADED, () => {
        if (video.paused) {
          video.play().catch(() => {});
        }
      });
      this.hls.on(Hls.Events.ERROR, (_e: string, data: ErrorData) => {
        if (!data.fatal) {
          if (this.hls) this.hls.startLoad();
          return;
        }
        const resume = video.currentTime;
        const canRetry =
          this.meetingLinkId &&
          this.hlsRecoveryAttempts < this.hlsRecoveryMax &&
          (data.type === Hls.ErrorTypes.NETWORK_ERROR || data.type === Hls.ErrorTypes.MEDIA_ERROR);
        if (canRetry) {
          this.hlsRecoveryAttempts += 1;
          this.destroyHls();
          const base = this.recordingsService.getHlsPlaylistUrl(this.meetingLinkId!);
          const fresh = `${base}${base.includes('?') ? '&' : '?'}cb=${Date.now()}`;
          this.hlsSrc = fresh;
          this.buffering = true;
          this.initHls(video, fresh, Number.isFinite(resume) && resume > 0 ? resume : null);
          return;
        }
        this.buffering = false;
        this.error = 'Playback error. Please refresh and try again.';
        this.hlsSrc = null;
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = url;
      video.addEventListener(
        'canplay',
        () => {
          this.buffering = false;
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
    if (this.hls) { this.hls.destroy(); this.hls = null; }
  }

  // ── MP4 video events ──────────────────────────────────────────────────────

  onVideoCanPlay(): void  { this.buffering = false; this.videoPlayerRef?.nativeElement.play().catch(() => {}); }
  onVideoWaiting(): void  { this.buffering = true; }
  onVideoPlaying(): void  { this.buffering = false; }
  onVideoError(): void    { this.buffering = false; this.error = 'Playback error. Please try again.'; this.videoSrc = null; }

  // ── Polling while processing ──────────────────────────────────────────────

  private startPolling(): void {
    this.clearPolling();
    this.pollingTimer = setInterval(() => {
      if (!this.meetingLinkId) return;
      this.recordingsService.getZoomRecordingStatus(this.meetingLinkId).subscribe({
        next: (res) => {
          if (res.status === 'ready') {
            this.clearPolling();
            this.loadRecording();
          } else if (res.status === 'failed') {
            this.clearPolling();
            this.processingStatus = 'failed';
            this.error = 'Recording processing failed. Please contact support.';
          }
        },
        error: () => {},
      });
    }, this.POLL_INTERVAL_MS);
  }

  private clearPolling(): void {
    if (this.pollingTimer) { clearInterval(this.pollingTimer); this.pollingTimer = null; }
  }

  private reset(): void {
    this.destroyHls();
    this.hlsRecoveryAttempts = 0;
    this.videoSrc         = null;
    this.hlsSrc           = null;
    this.error            = null;
    this.loading          = false;
    this.buffering        = false;
    this.processingStatus = null;
    this.duration         = null;
    this.createdAt        = null;
    this.pendingHlsInit   = false;
    this.clearPolling();
  }

  formatDuration(seconds: number | null): string {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
