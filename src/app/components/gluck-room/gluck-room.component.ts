import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ViewChildren, QueryList, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Room, RoomEvent, RemoteParticipant, Participant, Track, VideoPresets, ParticipantEvent, TrackPublication, VideoTrack, createLocalVideoTrack } from 'livekit-client';
import { MaterialModule } from '../../shared/material.module';
import { GluckRoomService } from '../../services/gluck-room.service';
import { GluckRoomSocketService } from '../../services/gluck-room-socket.service';
import { AuthService } from '../../services/auth.service';

interface ParticipantInfo {
  identity: string;
  name: string;
  role: string;
  isMicOn: boolean;
  isCamOn: boolean;
  hasVideo: boolean;
}

@Component({
  selector: 'app-gluck-room',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  templateUrl: './gluck-room.component.html',
  styleUrls: ['./gluck-room.component.scss']
})
export class GluckRoomRoomComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('mainVideo') mainVideoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('selfVideo') selfVideoEl!: ElementRef<HTMLVideoElement>;
  @ViewChildren('tileVideo') tileVideos!: QueryList<ElementRef<HTMLVideoElement>>;

  session: any = null;
  loading = true;
  error = '';
  userRole = '';
  userId = '';
  hostId = '';

  livekitConnected = false;
  livekitUrl = '';
  roomName = '';
  token = '';

  room: Room | null = null;

  isMicOn = false;
  isCamOn = false;
  isScreenSharing = false;

  mainParticipant: ParticipantInfo | null = null;
  isMainScreenShare = false;

  selfViewStream: MediaStream | null = null;
  selfViewTrack: MediaStreamTrack | null = null;

  showParticipantList = false;
  allParticipants: ParticipantInfo[] = [];
  topFiveParticipants: ParticipantInfo[] = [];

  elapsedSeconds = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private gluckRoomService: GluckRoomService,
    private gluckRoomSocket: GluckRoomSocketService,
    private auth: AuthService,
    private ngZone: NgZone
  ) {}

  get canModerate(): boolean {
    return !this.isStudent;
  }

  get isStudent(): boolean {
    return this.userRole === 'STUDENT';
  }

  get isHostUser(): boolean {
    return this.hostId === this.userId;
  }

  get mainParticipantName(): string {
    return this.mainParticipant?.name || 'Unknown';
  }

  get mainParticipantInitials(): string {
    return this.mainParticipantName.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  }

  ngOnInit(): void {
    const user = this.auth.getSnapshotUser();
    this.userRole = user?.role || '';
    this.userId = user?.userId || user?._id || '';
    this.loadSession();
  }

  ngAfterViewInit(): void {
    this.tileVideos.changes.subscribe(() => {
      if (!this.destroyed) this.attachTileVideos();
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cleanupConnection();
  }

  private cleanupConnection(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.gluckRoomSocket.disconnect();
    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
    if (this.selfViewTrack) {
      this.selfViewTrack.stop();
      this.selfViewTrack = null;
    }
    this.selfViewStream = null;
    this.livekitConnected = false;
  }

  private loadSession(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.error = 'Session ID missing'; this.loading = false; return; }

    this.gluckRoomService.getSession(id).subscribe({
      next: (res) => {
        if (res.success) {
          this.session = res.data;
          const host = res.data.hostId;
          this.hostId = typeof host === 'object' ? host._id : host;
          if (res.data.status === 'active') this.joinSession();
          else this.loading = false;
        } else {
          this.error = res.message || 'Session not found';
          this.loading = false;
        }
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load session';
        this.loading = false;
      }
    });
  }

  private joinSession(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.gluckRoomService.joinSession(id).subscribe({
      next: (res) => {
        if (res.success) {
          this.token = res.data.token;
          this.livekitUrl = res.data.livekitUrl;
          this.roomName = res.data.roomName;
          this.connectToLiveKit();
        } else {
          this.error = res.message || 'Failed to join session';
          this.loading = false;
        }
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to join session';
        this.loading = false;
      }
    });
  }

  private onLocalTrackMute = (pub: TrackPublication): void => {
    this.ngZone.run(() => {
      if (pub.source === Track.Source.Microphone) {
        this.isMicOn = !pub.isMuted;
      }
        if (pub.source === Track.Source.Camera) {
          this.isCamOn = !pub.isMuted;
          if (!pub.isMuted && pub.videoTrack) {
            this.selfViewStream = new MediaStream([pub.videoTrack.mediaStreamTrack]);
            this.selfViewTrack = pub.videoTrack.mediaStreamTrack;
            this.attachStreamToElement(this.selfVideoEl, this.selfViewStream);
          } else if (pub.isMuted) {
            this.selfViewStream = null;
            // Don't stop selfViewTrack — it's the same track published to
            // LiveKit.  Stopping the MediaStreamTrack would prevent unmute
            // from working (the camera would stay black).
            if (this.selfVideoEl?.nativeElement) {
              this.selfVideoEl.nativeElement.pause();
              this.selfVideoEl.nativeElement.srcObject = null;
            }
          }
        }
      this.updateParticipantList();
    });
  };

  private onRemoteTrackMute = (): void => {
    this.ngZone.run(() => {
      this.updateParticipantList();
      this.attachTileVideos();
      this.selectMainParticipant();
    });
  };

  private onRemoteTrackSubscribed = (): void => {
    this.ngZone.run(() => {
      this.updateParticipantList();
      this.attachTileVideos();
      this.selectMainParticipant();
    });
  };

  private async connectToLiveKit(): Promise<void> {
    if (!this.token || !this.livekitUrl) return;

    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    });

    this.room.on('participantConnected', (p) => this.onParticipantConnected(p));
    this.room.on('participantDisconnected', (p) => this.onParticipantDisconnected(p));
    this.room.on('trackPublished', (pub, p) => this.onTrackPublished(pub, p));
    this.room.on('trackUnpublished', (pub, p) => this.onTrackUnpublished(pub, p));
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => this.onActiveSpeakerChanged(speakers));
    this.room.on('connected', () => {
      this.ngZone.run(() => {
        this.livekitConnected = true;
        this.loading = false;
        this.startTimer();
        this.setupSocket();
        this.setupLocalTracks();
        // Register event handlers for already-connected participants
        // (participantConnected only fires for participants who join *after* us)
        this.room?.remoteParticipants.forEach(p => this.onParticipantConnected(p));
        this.updateParticipantList();
        this.selectMainParticipant();
        this.room?.startAudio().catch(() => {});
        setTimeout(() => {
          if (this.selfViewStream) {
            this.attachStreamToElement(this.selfVideoEl, this.selfViewStream);
          }
          this.selectMainParticipant();
          this.attachTileVideos();
        });
      });
    });
    this.room.on('disconnected', () => {
      this.ngZone.run(() => { this.livekitConnected = false; });
    });

    this.room.localParticipant.on(ParticipantEvent.TrackPublished, (pub) => {
      if (pub.source !== Track.Source.ScreenShare && pub.source !== Track.Source.Camera) return;
      this.ngZone.run(() => {
        if (pub.source === Track.Source.ScreenShare) {
          this.isScreenSharing = true;
          this.isMainScreenShare = true;
          this.mainParticipant = {
            identity: this.room!.localParticipant.identity,
            name: this.room!.localParticipant.name || 'Your Screen',
            role: this.getSocketRole(),
            isMicOn: this.isMicOn,
            isCamOn: this.isCamOn,
            hasVideo: true,
          };
          const videoEl = this.mainVideoEl?.nativeElement ?? document.querySelector<HTMLVideoElement>('.main-video');
          const screenTrack = pub.videoTrack ?? (pub.track as any);
          const attached = videoEl && screenTrack && typeof screenTrack.attach === 'function';
          if (attached) {
            videoEl.srcObject = null;
            screenTrack.attach(videoEl);
            videoEl.play().catch(() => {});
          } else {
            this.isMainScreenShare = false;
            this.mainParticipant.hasVideo = false;
          }
          this.updateParticipantList();
          const endedHandler = () => {
            this.ngZone.run(() => {
              this.isScreenSharing = false;
              this.isMainScreenShare = false;
              this.mainParticipant = null;
              const el = this.mainVideoEl?.nativeElement ?? document.querySelector<HTMLVideoElement>('.main-video');
              if (el) { el.srcObject = null; }
              this.updateParticipantList();
            });
          };
          const track = pub.videoTrack ?? (pub.track as any);
          if (track && typeof track.on === 'function') {
            track.on('ended', endedHandler);
          }
        }
        if (pub.source === Track.Source.Camera && pub.videoTrack) {
          this.isCamOn = true;
          this.selfViewStream = new MediaStream([pub.videoTrack.mediaStreamTrack]);
          this.selfViewTrack = pub.videoTrack.mediaStreamTrack;
          this.attachStreamToElement(this.selfVideoEl, this.selfViewStream);
          this.updateParticipantList();
        }
      });
    });
    this.room.localParticipant.on(ParticipantEvent.TrackUnpublished, (pub) => {
      this.ngZone.run(() => {
        if (pub.source === Track.Source.ScreenShare) {
          this.isScreenSharing = false;
          this.isMainScreenShare = false;
          this.selectMainParticipant();
        }
        if (pub.source === Track.Source.Camera) {
          this.isCamOn = false;
          this.selfViewStream = null;
          this.selfViewTrack?.stop();
          this.selfViewTrack = null;
          if (this.selfVideoEl?.nativeElement) {
            this.selfVideoEl.nativeElement.pause();
            this.selfVideoEl.nativeElement.srcObject = null;
          }
          this.updateParticipantList();
        }
      });
    });
    this.room.localParticipant.on(ParticipantEvent.TrackMuted, this.onLocalTrackMute);
    this.room.localParticipant.on(ParticipantEvent.TrackUnmuted, this.onLocalTrackMute);

    try {
      await this.room.connect(this.livekitUrl, this.token);
    } catch (err: any) {
      this.ngZone.run(() => {
        this.error = 'Failed to connect: ' + (err.message || 'unknown error');
        this.loading = false;
      });
    }
  }

  private onParticipantConnected(p: RemoteParticipant): void {
    p.on(ParticipantEvent.TrackMuted, this.onRemoteTrackMute);
    p.on(ParticipantEvent.TrackUnmuted, this.onRemoteTrackMute);
    p.on(ParticipantEvent.TrackSubscribed, this.onRemoteTrackSubscribed);
    p.on(ParticipantEvent.TrackSubscriptionStatusChanged, this.onRemoteTrackMute);
    this.ngZone.run(() => this.updateParticipantList());
    this.selectMainParticipant();
  }

  private onParticipantDisconnected(p: RemoteParticipant): void {
    p.off(ParticipantEvent.TrackMuted, this.onRemoteTrackMute);
    p.off(ParticipantEvent.TrackUnmuted, this.onRemoteTrackMute);
    p.off(ParticipantEvent.TrackSubscribed, this.onRemoteTrackSubscribed);
    p.off(ParticipantEvent.TrackSubscriptionStatusChanged, this.onRemoteTrackMute);
    this.ngZone.run(() => this.updateParticipantList());
    this.selectMainParticipant();
  }

  private onTrackPublished(publication: TrackPublication, participant: RemoteParticipant): void {
    participant.on(ParticipantEvent.TrackSubscribed, this.onRemoteTrackSubscribed);
    participant.on(ParticipantEvent.TrackSubscriptionStatusChanged, this.onRemoteTrackMute);
    this.ngZone.run(() => this.updateParticipantList());
    this.selectMainParticipant();
  }

  private onTrackUnpublished(publication: TrackPublication, participant: RemoteParticipant): void {
    if (publication.source === 'screen_share') {
      this.ngZone.run(() => {
        this.isMainScreenShare = false;
        this.selectMainParticipant();
      });
    }
    this.ngZone.run(() => this.updateParticipantList());
  }

  private onActiveSpeakerChanged(speakers: Participant[]): void {
    if (!this.room) return;
    this.ngZone.run(() => {
      const speakerOrder = speakers.map(s => s.identity);
      this.allParticipants.sort((a, b) => {
        const ai = speakerOrder.indexOf(a.identity);
        const bi = speakerOrder.indexOf(b.identity);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return 0;
      });
      this.updateTopFive();
    });
  }

  private async setupLocalTracks(): Promise<void> {
    // Camera and mic start off — user activates via toggle buttons.
    // No tracks are published here.
  }

  private attachStreamToElement(elRef: ElementRef<HTMLVideoElement> | undefined, stream: MediaStream): void {
    if (!elRef?.nativeElement) return;
    const videoEl = elRef.nativeElement;
    videoEl.srcObject = stream;
    videoEl.play().catch(() => {});
  }

  private setupSocket(): void {
    if (!this.room) return;
    const socket = this.gluckRoomSocket.connect(this.roomName, this.token, this.getSocketRole());
    socket.on('participant-muted', ({ targetUserId }: { targetUserId: string }) => {
      if (targetUserId === this.userId) {
        this.room?.localParticipant.setMicrophoneEnabled(false);
      }
    });
    socket.on('participant-camera-disabled', ({ targetUserId }: { targetUserId: string }) => {
      if (targetUserId === this.userId) {
        this.room?.localParticipant.setCameraEnabled(false);
      }
    });
    socket.on('all-muted', () => {
      this.room?.localParticipant.setMicrophoneEnabled(false);
    });
    socket.on('all-cameras-disabled', () => {
      this.room?.localParticipant.setCameraEnabled(false);
    });
    socket.on('participant-removed', ({ targetUserId }: { targetUserId: string }) => {
      if (targetUserId === this.userId) {
        this.cleanupConnection();
        this.ngZone.run(() => this.router.navigate(['/gluck-room']));
      }
    });
  }

  private getSocketRole(): string {
    if (this.isStudent) return 'student';
    return this.userRole === 'TEACHER' ? 'teacher' : 'admin';
  }

  private selectMainParticipant(): void {
    if (!this.room || this.destroyed) return;

    const local = this.room.localParticipant;
    const localScreenPub = local.getTrackPublication(Track.Source.ScreenShare);

    if (localScreenPub && !this.isStudent) {
      const localTrack = localScreenPub.videoTrack?.mediaStreamTrack;
      if (localTrack) {
        this.ngZone.run(() => {
          this.mainParticipant = {
            identity: local.identity,
            name: local.name || 'Your Screen',
            role: this.getSocketRole(),
            isMicOn: this.isMicOn,
            isCamOn: this.isCamOn,
            hasVideo: true,
          };
          this.isMainScreenShare = true;
          this.attachToMainVideo(localTrack);
        });
        return;
      }
    }

    const teacher = this.findTeacherParticipant();
    if (!teacher) {
      this.ngZone.run(() => {
        this.mainParticipant = null;
        this.isMainScreenShare = false;
        this.attachToMainVideo(null);
      });
      return;
    }

    const teacherScreenShare = this.getScreenSharePub(teacher);
    if (teacherScreenShare?.videoTrack) {
      const ssTrack = teacherScreenShare.videoTrack.mediaStreamTrack;
      this.ngZone.run(() => {
        this.mainParticipant = {
          ...this.participantToInfo(teacher),
          hasVideo: true,
        };
        this.isMainScreenShare = true;
        this.attachToMainVideo(ssTrack);
      });
      return;
    }

    const camPub = teacher.getTrackPublication(Track.Source.Camera);
    if (camPub?.videoTrack) {
      const track = camPub.videoTrack.mediaStreamTrack;
      this.ngZone.run(() => {
        this.mainParticipant = this.participantToInfo(teacher);
        this.isMainScreenShare = false;
        this.attachToMainVideo(track);
      });
      return;
    }

    this.ngZone.run(() => {
      this.mainParticipant = this.participantToInfo(teacher);
      this.isMainScreenShare = false;
      this.attachToMainVideo(null);
    });
  }

  private getMainVideoEl(): HTMLVideoElement | null {
    return this.mainVideoEl?.nativeElement ?? document.querySelector<HTMLVideoElement>('.main-video');
  }

  private attachToMainVideo(track: MediaStreamTrack | null): void {
    const el = this.getMainVideoEl();
    if (!el) return;
    el.srcObject = null;
    if (track) {
      el.srcObject = new MediaStream([track]);
      el.play().catch(() => {});
    }
  }

  private attachTrackToMainVideo(track: VideoTrack): void {
    const el = this.getMainVideoEl();
    if (!el) return;
    el.srcObject = null;
    track.attach(el);
    el.play().catch(() => {});
  }

  private findTeacherParticipant(): RemoteParticipant | null {
    if (!this.room) return null;
    for (const [, p] of this.room.remoteParticipants) {
      if (p.identity === this.hostId) return p;
    }
    return null;
  }

  private getScreenSharePub(p: RemoteParticipant): TrackPublication | undefined {
    for (const [, pub] of p.trackPublications) {
      if (pub.source === Track.Source.ScreenShare) return pub;
      if (pub.source === Track.Source.ScreenShareAudio) continue;
      if (pub.trackName?.includes('screen') && pub.kind === 'video') return pub;
    }
    return undefined;
  }

  private updateParticipantList(): void {
    if (!this.room || this.destroyed) return;
    const list: ParticipantInfo[] = [];
    for (const [, p] of this.room.remoteParticipants) {
      list.push(this.participantToInfo(p));
    }
    list.push({
      identity: this.room.localParticipant.identity,
      name: this.room.localParticipant.name || 'You',
      role: this.getSocketRole(),
      isMicOn: this.isMicOn,
      isCamOn: this.isCamOn,
      hasVideo: this.isCamOn,
    });
    this.allParticipants = list;
    this.updateTopFive();
  }

  private updateTopFive(): void {
    this.topFiveParticipants = this.allParticipants
      .filter(p => p.identity !== this.userId)
      .slice(0, 5);
  }

  private participantToInfo(p: RemoteParticipant): ParticipantInfo {
    const camPub = p.getTrackPublication(Track.Source.Camera);
    const micPub = p.getTrackPublication(Track.Source.Microphone);
    return {
      identity: p.identity,
      name: p.name || p.identity,
      role: 'participant',
      isMicOn: micPub ? !micPub.isMuted : false,
      isCamOn: camPub ? !camPub.isMuted : false,
      hasVideo: !!camPub?.videoTrack && !camPub.isMuted,
    };
  }

  private attachTileVideos(): void {
    if (!this.room || this.destroyed) return;
    const identityToEl = new Map<string, HTMLVideoElement>();
    this.tileVideos.forEach(el => {
      const identity = el.nativeElement.dataset['participant'];
      if (identity) identityToEl.set(identity, el.nativeElement);
    });
    for (const [, p] of this.room.remoteParticipants) {
      const vidEl = identityToEl.get(p.identity);
      if (!vidEl) continue;
      const camPub = p.getTrackPublication(Track.Source.Camera);
      if (camPub?.videoTrack && !camPub.isMuted) {
        const track = camPub.videoTrack.mediaStreamTrack;
        if (vidEl.srcObject instanceof MediaStream) {
          const existing = vidEl.srcObject.getVideoTracks()[0];
          if (existing?.id === track.id) continue;
        }
        const stream = new MediaStream([track]);
        vidEl.srcObject = stream;
        vidEl.play().catch(() => {});
      } else if (vidEl.srcObject) {
        vidEl.pause();
        vidEl.srcObject = null;
      }
    }
  }

  private startTimer(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    const start = this.session?.actualStartTime ? new Date(this.session.actualStartTime).getTime() : Date.now();
    this.elapsedSeconds = Math.floor((Date.now() - start) / 1000);
    this.timerInterval = setInterval(() => {
      if (!this.destroyed) this.elapsedSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
    }, 1000);
  }

  toggleMic(): void {
    if (!this.room) return;
    this.room.localParticipant.setMicrophoneEnabled(!this.isMicOn);
  }

  async toggleCam(): Promise<void> {
    if (!this.room) return;
    const enable = !this.isCamOn;
    if (enable) {
      const existing = this.room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (existing) {
        await existing.unmute();
      } else {
        const track = await createLocalVideoTrack({
          resolution: VideoPresets.h720.resolution,
        });
        const options: any = { source: Track.Source.Camera };
        if (!this.isStudent) {
          options.name = `teacher-camera-${this.userId}`;
        }
        await this.room.localParticipant.publishTrack(track, options);
        this.selfViewStream = new MediaStream([track.mediaStreamTrack]);
        this.selfViewTrack = track.mediaStreamTrack;
        this.attachStreamToElement(this.selfVideoEl, this.selfViewStream);
      }
    } else {
      const pub = this.room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (pub) await pub.mute();
    }
  }

  async toggleScreenShare(): Promise<void> {
    if (!this.room || this.isStudent) return;
    const enabled = !this.isScreenSharing;
    try {
      await this.room.localParticipant.setScreenShareEnabled(enabled);
      if (enabled) {
        const pub = this.room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
        const t = pub?.videoTrack ?? (pub?.track as any);
        const videoEl = this.mainVideoEl?.nativeElement ?? document.querySelector<HTMLVideoElement>('.main-video');
        this.ngZone.run(() => {
          this.isScreenSharing = true;
          this.isMainScreenShare = true;
          if (t && videoEl && typeof t.attach === 'function') {
            videoEl.srcObject = null;
            t.attach(videoEl);
            videoEl.play().catch(() => {});
          }
          this.updateParticipantList();
        });
        if (t && typeof t.on === 'function') {
          const ended = () => {
            this.ngZone.run(() => {
              this.isScreenSharing = false;
              this.isMainScreenShare = false;
              this.mainParticipant = null;
              const el = this.mainVideoEl?.nativeElement ?? document.querySelector<HTMLVideoElement>('.main-video');
              if (el) { el.srcObject = null; }
              this.updateParticipantList();
            });
          };
          t.on('ended', ended);
        }
      }
    } catch {
      this.ngZone.run(() => this.isScreenSharing = false);
    }
  }

  toggleParticipantList(): void {
    this.showParticipantList = !this.showParticipantList;
  }

  muteParticipant(identity: string): void {
    this.gluckRoomSocket.emit('mute-participant', { targetUserId: identity });
  }

  disableCamera(identity: string): void {
    this.gluckRoomSocket.emit('disable-participant-camera', { targetUserId: identity });
  }

  muteAll(): void {
    this.gluckRoomSocket.emit('mute-all', {});
  }

  disableAllCams(): void {
    this.gluckRoomSocket.emit('disable-all-cams', {});
  }

  removeParticipant(identity: string): void {
    if (!confirm('Remove this participant from the session?')) return;
    this.gluckRoomSocket.emit('remove-participant', { targetUserId: identity });
  }

  async leave(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.gluckRoomService.leaveSession(id).subscribe({ next: () => {}, error: () => {} });
    }
    this.cleanupConnection();
    this.router.navigate(['/gluck-room']);
  }

  endSession(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    if (!confirm('End this session for all participants?')) return;
    this.gluckRoomService.endSession(id).subscribe({
      next: (res) => {
        if (res.success) {
          this.cleanupConnection();
          this.router.navigate(['/gluck-room']);
        }
      },
      error: () => {}
    });
  }

  goBack(): void {
    this.leave();
  }

  getParticipantInitials(p: ParticipantInfo): string {
    return p.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  }

  formatDate(d: string | Date): string {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
    });
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = { scheduled: 'Upcoming', active: 'Live', ended: 'Completed', cancelled: 'Cancelled' };
    return map[status] || status;
  }

  isSelf(p: ParticipantInfo): boolean {
    return p.identity === this.userId;
  }

  formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}
