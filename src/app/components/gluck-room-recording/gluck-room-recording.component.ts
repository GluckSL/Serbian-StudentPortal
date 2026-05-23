import { Component, OnInit, AfterViewChecked, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MaterialModule } from '../../shared/material.module';
import { GluckRoomService } from '../../services/gluck-room.service';
import { AuthService, getAuthToken } from '../../services/auth.service';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import Hls from 'hls.js';
import { hlsAuthXhrSetup } from '../../utils/hls-auth-xhr';

@Component({
  selector: 'app-gluck-room-recording',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  templateUrl: './gluck-room-recording.component.html',
  styleUrls: ['./gluck-room-recording.component.scss']
})
export class GluckRoomRecordingComponent implements OnInit, AfterViewChecked {
  @ViewChild('videoEl') videoEl: ElementRef<HTMLVideoElement> | null = null;

  recording: any = null;
  session: any = null;
  playbackUrl: SafeResourceUrl | null = null;
  loading = true;
  error = '';
  userRole = '';
  userId = '';
  togglingPublish = false;

  hlsMode = false;
  hlsSrc: string | null = null;
  pendingHlsInit = false;
  private hls: Hls | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private gluckRoomService: GluckRoomService,
    private auth: AuthService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    const user = this.auth.getSnapshotUser();
    this.userRole = user?.role || '';
    this.userId = user?.userId || user?._id || '';

    const recordingId = this.route.snapshot.paramMap.get('recordingId');
    if (!recordingId) {
      this.error = 'Recording ID missing';
      this.loading = false;
      return;
    }
    this.loadRecording(recordingId);
  }

  ngAfterViewChecked(): void {
    if (this.pendingHlsInit && this.hlsSrc && this.videoEl) {
      this.pendingHlsInit = false;
      this.initHls(this.videoEl.nativeElement, this.hlsSrc);
    }
  }

  loadRecording(recordingId: string): void {
    this.gluckRoomService.getRecording(recordingId).subscribe({
      next: (res) => {
        if (res.success) {
          this.recording = res.data.recording;
          if (res.data.hlsMode) {
            this.hlsMode = true;
            this.hlsSrc = this.gluckRoomService.getHlsPlaylistUrl(recordingId);
            this.pendingHlsInit = true;
          } else if (res.data.playbackUrl) {
            this.playbackUrl = this.sanitizer.bypassSecurityTrustResourceUrl(res.data.playbackUrl);
          }
          if (this.recording?.sessionId) {
            const sessionId = typeof this.recording.sessionId === 'object'
              ? this.recording.sessionId._id
              : this.recording.sessionId;
            this.gluckRoomService.getSession(sessionId).subscribe({
              next: (sRes) => { if (sRes.success) this.session = sRes.data; }
            });
          }
        } else {
          this.error = res.message || 'Recording not found';
        }
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load recording';
        this.loading = false;
      }
    });
  }

  initHls(video: HTMLVideoElement, url: string): void {
    if (this.hls) this.hls.destroy();

    if (Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: false,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        startLevel: 0,
        backBufferLength: 5,
        xhrSetup: (xhr: XMLHttpRequest) => { hlsAuthXhrSetup(xhr); },
        fetchSetup: (context: any, initParams: any) => {
          if (context.url.includes('X-Amz-Signature')) return new Request(context.url, initParams);
          const token = getAuthToken();
          const headers = new Headers(initParams?.headers || {});
          if (token) headers.set('Authorization', `Bearer ${token}`);
          return new Request(context.url, { ...initParams, headers });
        },
      });
      this.hls.loadSource(url);
      this.hls.attachMedia(video);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    }
  }

  ngOnDestroy(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  togglePublish(): void {
    if (!this.recording) return;
    this.togglingPublish = true;
    this.gluckRoomService.publishRecording(this.recording._id, {
      isPublished: !this.recording.isPublished
    }).subscribe({
      next: (res) => {
        if (res.success) this.recording = res.data;
        this.togglingPublish = false;
      },
      error: () => { this.togglingPublish = false; }
    });
  }

  deleteRecording(): void {
    if (!this.recording || !confirm('Delete this recording?')) return;
    this.gluckRoomService.deleteRecording(this.recording._id).subscribe({
      next: (res) => {
        if (res.success) {
          this.recording = null;
          this.playbackUrl = null;
        }
      }
    });
  }

  isHost(): boolean {
    if (!this.session) return false;
    const hostId = this.session.hostId?._id || this.session.hostId;
    return hostId === this.userId;
  }

  isAdmin(): boolean {
    return ['ADMIN', 'SUB_ADMIN', 'TEACHER_ADMIN'].includes(this.userRole);
  }

  canManage(): boolean {
    return this.isHost() || this.isAdmin();
  }

  goBack(): void {
    this.router.navigate(['/gluck-room']);
  }

  formatDate(d: string | Date): string {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
    });
  }
}
