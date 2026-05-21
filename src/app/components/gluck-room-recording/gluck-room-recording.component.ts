import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MaterialModule } from '../../shared/material.module';
import { GluckRoomService } from '../../services/gluck-room.service';
import { AuthService } from '../../services/auth.service';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-gluck-room-recording',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  templateUrl: './gluck-room-recording.component.html',
  styleUrls: ['./gluck-room-recording.component.scss']
})
export class GluckRoomRecordingComponent implements OnInit {
  recording: any = null;
  session: any = null;
  playbackUrl: SafeResourceUrl | null = null;
  loading = true;
  error = '';
  userRole = '';
  userId = '';
  togglingPublish = false;

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

  loadRecording(recordingId: string): void {
    this.gluckRoomService.getRecording(recordingId).subscribe({
      next: (res) => {
        if (res.success) {
          this.recording = res.data.recording;
          if (res.data.playbackUrl) {
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
