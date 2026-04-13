import {
  Component,
  Input,
  OnInit,
  OnDestroy,
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

@Component({
  selector: 'app-zoom-recording-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './zoom-recording-player.component.html',
  styleUrls: ['./zoom-recording-player.component.css'],
})
export class ZoomRecordingPlayerComponent implements OnInit, OnDestroy, OnChanges {
  /** MeetingLink _id — can be passed as @Input or read from route params */
  @Input() meetingLinkId: string | null = null;

  @ViewChild('videoPlayer') videoPlayerRef!: ElementRef<HTMLVideoElement>;

  videoSrc: string | null = null;
  duration: number | null = null;
  createdAt: string | null = null;

  loading = false;
  error: string | null = null;
  processingStatus: 'processing' | 'ready' | 'failed' | null = null;

  private pollingTimer: any = null;
  private readonly POLL_INTERVAL_MS = 10_000; // check every 10 s while processing

  constructor(
    private recordingsService: ClassRecordingsService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Support both @Input and route param (e.g. /class-recording/:meetingLinkId)
    if (!this.meetingLinkId) {
      this.meetingLinkId = this.route.snapshot.paramMap.get('meetingLinkId');
    }
    if (this.meetingLinkId) {
      this.loadRecording();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['meetingLinkId'] && !changes['meetingLinkId'].firstChange) {
      this.reset();
      if (this.meetingLinkId) this.loadRecording();
    }
  }

  ngOnDestroy(): void {
    this.clearPolling();
  }

  loadRecording(): void {
    if (!this.meetingLinkId) return;

    this.loading = true;
    this.error = null;
    this.videoSrc = null;

    this.recordingsService.getZoomRecordingUrl(this.meetingLinkId).subscribe({
      next: (res: ZoomRecordingResponse) => {
        this.loading = false;
        this.videoSrc = res.signedUrl;
        this.duration = res.duration;
        this.createdAt = res.createdAt;
        this.processingStatus = 'ready';
        this.clearPolling();
      },
      error: (err) => {
        this.loading = false;
        const status = err.status;
        const msg: string = err.error?.message || '';

        if (status === 202) {
          // Still processing — start polling
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
        error: () => {
          // Silently retry on network errors during polling
        },
      });
    }, this.POLL_INTERVAL_MS);
  }

  private clearPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private reset(): void {
    this.videoSrc = null;
    this.error = null;
    this.loading = false;
    this.processingStatus = null;
    this.duration = null;
    this.createdAt = null;
    this.clearPolling();
  }

  /** Format seconds → h:mm:ss or m:ss */
  formatDuration(seconds: number | null): string {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
