import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ViewChildren, QueryList, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Room, RoomEvent, RemoteParticipant, Participant, Track, VideoPresets, ParticipantEvent, TrackPublication, VideoTrack, RemoteTrack, RemoteTrackPublication, createLocalVideoTrack } from 'livekit-client';
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

interface BreakoutInfo {
  _id: string;
  name: string;
  livekitRoomName: string;
  assignedParticipants: any[];
  status: string;
}

@Component({
  selector: 'app-gluck-room',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
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

  sidebarOpen = false;
  sidebarTabIndex = 0;
  showSessionEndedOverlay = false;
  progressPercent = 0;
  private closeTimer: ReturnType<typeof setInterval> | null = null;
  allParticipants: ParticipantInfo[] = [];
  topFiveParticipants: ParticipantInfo[] = [];

  elapsedSeconds = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  isEnding = false;
  private isLocallyEnding = false;
  cardActionLoading = false;

  // Breakout rooms
  breakouts: BreakoutInfo[] = [];
  assignedBreakout: BreakoutInfo | null = null;
  activeBreakoutId: string | null = null;
  isConnectingBreakout = false;
  showCreateBreakoutForm = false;
  breakoutCreateCount = 1;
  isCreatingBreakouts = false;
  showAssignPanel: string | null = null;
  tempAssignParticipants: string[] = [];
  isReconnectingToMain = false;

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
    this.loadBreakouts();
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
          this.loading = false;
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

  onJoinClick(): void {
    this.loading = true;
    this.joinSession();
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
    const sessionId = this.session?._id;
    this.ngZone.run(() => {
      if (pub.source === Track.Source.Microphone) {
        this.isMicOn = !pub.isMuted;
        this.gluckRoomSocket.emit('mic-toggled', { userId: this.userId, on: this.isMicOn, sessionId });
      }
        if (pub.source === Track.Source.Camera) {
          this.isCamOn = !pub.isMuted;
          this.gluckRoomSocket.emit('cam-toggled', { userId: this.userId, on: this.isCamOn, sessionId });
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

  private onRemoteTrackSubscribed = (track: RemoteTrack, publication: RemoteTrackPublication): void => {
    this.ngZone.run(() => {
      if (track.kind === 'audio') {
        track.attach();
      }
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
        this.room?.remoteParticipants.forEach(p => {
          this.onParticipantConnected(p);
          // Attach any existing audio tracks from participants already in the room
          p.audioTrackPublications.forEach((pub) => {
            if (pub.track) pub.track.attach();
          });
        });
        this.updateParticipantList();
        this.selectMainParticipant();
        this.room?.startAudio().catch((e) => console.warn('startAudio failed:', e));
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
      if (pub.source !== Track.Source.ScreenShare && pub.source !== Track.Source.Camera && pub.source !== Track.Source.Microphone) return;
      this.ngZone.run(() => {
        if (pub.source === Track.Source.Microphone) {
          this.isMicOn = true;
          this.updateParticipantList();
        } else if (pub.source === Track.Source.ScreenShare) {
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
          this.updateParticipantList();
          const videoEl = this.mainVideoEl?.nativeElement ?? document.querySelector<HTMLVideoElement>('.main-video');
          const screenTrack = pub.videoTrack ?? (pub.track as any);
          if (videoEl && screenTrack && typeof screenTrack.attach === 'function') {
            videoEl.srcObject = null;
            screenTrack.attach(videoEl);
            videoEl.play().catch(() => {});
          }
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
    const socket = this.gluckRoomSocket.connect(this.roomName, this.token, this.getSocketRole(), this.userId);
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
    socket.on('session-ended', () => {
      if (this.isLocallyEnding) return;
      this.ngZone.run(() => {
        this.cleanupConnection();
        this.loadSession();
      });
    });
    socket.on('participant-removed', ({ targetUserId }: { targetUserId: string }) => {
      if (targetUserId === this.userId) {
        this.cleanupConnection();
        this.ngZone.run(() => {
          this.loadSession();
          this.error = 'You have been removed from this session.';
        });
      }
    });

    // Breakout events
    socket.on('breakout-assigned', (data: { breakoutId: string; breakoutName: string }) => {
      this.ngZone.run(() => {
        this.assignedBreakout = {
          _id: data.breakoutId,
          name: data.breakoutName,
          livekitRoomName: '',
          assignedParticipants: [],
          status: 'active',
        } as BreakoutInfo;
      });
    });

    socket.on('breakout-ended', (data: { breakoutId: string }) => {
      this.ngZone.run(() => {
        if (this.activeBreakoutId === data.breakoutId) {
          this.activeBreakoutId = null;
          this.reconnectToMainRoom();
        }
        if (this.assignedBreakout?._id === data.breakoutId) {
          this.assignedBreakout = null;
        }
        this.breakouts = this.breakouts.filter(b => b._id !== data.breakoutId);
      });
    });

    socket.on('breakout-return-to-main', () => {
      this.ngZone.run(() => {
        if (this.activeBreakoutId) {
          this.activeBreakoutId = null;
          this.reconnectToMainRoom();
        }
        this.assignedBreakout = null;
        this.loadBreakouts();
      });
    });

    socket.on('breakouts-updated', () => {
      this.ngZone.run(() => this.loadBreakouts());
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
      this.ngZone.run(() => {
        this.mainParticipant = {
          identity: local.identity,
          name: local.name || 'Your Screen',
          role: this.getSocketRole(),
          isMicOn: this.isMicOn,
          isCamOn: this.isCamOn,
          hasVideo: !!localTrack,
        };
        this.isMainScreenShare = true;
        this.attachToMainVideo(localTrack ?? null);
      });
      return;
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

  async toggleMic(): Promise<void> {
    if (!this.room) return;
    const target = !this.isMicOn;
    this.isMicOn = target;
    try {
      if (target) {
        await this.room.startAudio().catch((e) => console.warn('startAudio in toggleMic:', e));
      }
      await this.room.localParticipant.setMicrophoneEnabled(target);
    } catch {
      this.isMicOn = !target;
    }
  }

  async toggleCam(): Promise<void> {
    if (!this.room) return;
    const enable = !this.isCamOn;
    this.isCamOn = enable;
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
    if (enabled) {
      try {
        await this.room.localParticipant.setScreenShareEnabled(enabled);
        const pub = this.room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
        const t = pub?.videoTrack ?? (pub?.track as any);
        const videoEl = this.mainVideoEl?.nativeElement ?? document.querySelector<HTMLVideoElement>('.main-video');
        this.ngZone.run(() => {
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
      } catch {
        this.ngZone.run(() => this.isScreenSharing = false);
      }
    } else {
      this.room.localParticipant.setScreenShareEnabled(false).catch(() => {});
      this.ngZone.run(() => {
        this.isScreenSharing = false;
        this.isMainScreenShare = false;
        this.mainParticipant = null;
        const el = this.mainVideoEl?.nativeElement ?? document.querySelector<HTMLVideoElement>('.main-video');
        if (el) { el.srcObject = null; }
        this.updateParticipantList();
      });
    }
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

  private showSessionInfoAndClose(): void {
    this.showSessionEndedOverlay = true;
    this.progressPercent = 0;
    this.cleanupConnection();
    const start = Date.now();
    const duration = 10000;
    this.closeTimer = setInterval(() => {
      const elapsed = Date.now() - start;
      this.progressPercent = Math.min(100, (elapsed / duration) * 100);
      if (elapsed >= duration) {
        this.doClose();
      }
    }, 100);
  }

  get remainingSeconds(): number {
    return Math.max(0, 10 - Math.floor(this.progressPercent / 10));
  }

  cancelClose(): void {
    if (this.closeTimer) {
      clearInterval(this.closeTimer);
      this.closeTimer = null;
    }
    this.doClose();
  }

  private doClose(): void {
    if (this.closeTimer) {
      clearInterval(this.closeTimer);
      this.closeTimer = null;
    }
    if (window.opener) {
      try { window.opener.location.reload(); } catch {}
    }
    window.close();
  }

  async leave(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.gluckRoomService.leaveSession(id).subscribe({ next: () => {}, error: () => {} });
    }
    this.showSessionInfoAndClose();
  }

  endSession(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id || this.isEnding) return;
    if (!confirm('End this session for all participants?')) return;
    this.isEnding = true;
    this.isLocallyEnding = true;
    this.gluckRoomService.endSession(id).subscribe({
      next: (res) => {
        this.isEnding = false;
        if (res.success) {
          this.session = res.data;
          this.showSessionInfoAndClose();
        }
      },
      error: () => { this.isEnding = false; this.isLocallyEnding = false; }
    });
  }

  startFromCard(): void {
    const id = this.session?._id;
    if (!id) return;
    if (!confirm('This session is scheduled and will start automatically. Do you want to start it manually now?')) return;
    this.cardActionLoading = true;
    this.gluckRoomService.startSession(id).subscribe({
      next: (res) => {
        this.cardActionLoading = false;
        if (res.success) this.loadSession();
      },
      error: () => { this.cardActionLoading = false; }
    });
  }

  endFromCard(): void {
    const id = this.session?._id;
    if (!id) return;
    this.cardActionLoading = true;
    this.gluckRoomService.endSession(id).subscribe({
      next: (res) => {
        this.cardActionLoading = false;
        if (res.success) this.loadSession();
      },
      error: () => { this.cardActionLoading = false; }
    });
  }

  goBack(): void {
    if (this.livekitConnected) {
      this.leave();
    } else {
      this.cleanupConnection();
      this.router.navigate(['/gluck-room']);
    }
  }

  // ── Breakout Rooms ──

  private disconnectLiveKitRoom(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.selfViewTrack) {
      this.selfViewTrack.stop();
      this.selfViewTrack = null;
    }
    this.selfViewStream = null;
    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
    this.livekitConnected = false;
    this.isMicOn = false;
    this.isCamOn = false;
    this.isScreenSharing = false;
    this.mainParticipant = null;
    this.isMainScreenShare = false;
    this.allParticipants = [];
    this.topFiveParticipants = [];
  }

  private async reconnectToMainRoom(): Promise<void> {
    this.isReconnectingToMain = true;
    this.disconnectLiveKitRoom();
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    try {
      const res: any = await this.gluckRoomService.joinSession(id).toPromise();
      if (res.success) {
        this.token = res.data.token;
        this.livekitUrl = res.data.livekitUrl;
        this.roomName = res.data.roomName;
        await this.connectToLiveKit();
      }
    } catch (err: any) {
      this.error = 'Failed to reconnect: ' + (err.message || '');
    }
    this.isReconnectingToMain = false;
  }

  loadBreakouts(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.gluckRoomService.getBreakouts(id).subscribe({
      next: (res) => {
        if (res.success) {
          this.breakouts = res.data;
          this.assignedBreakout = null;
          for (const b of this.breakouts) {
            const isAssigned = b.assignedParticipants?.some(
              (p: any) => (p._id || p).toString() === this.userId
            );
            if (isAssigned) {
              this.assignedBreakout = b;
              break;
            }
          }
        }
      },
      error: () => {}
    });
  }

  onSidebarTabChange(index: number): void {
    if (index === 2) {
      this.loadBreakouts();
    }
  }

  createBreakoutRooms(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id || this.isCreatingBreakouts) return;
    this.isCreatingBreakouts = true;
    this.gluckRoomService.createBreakouts(id, {
      count: this.breakoutCreateCount,
      namePrefix: 'Room',
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.breakouts = [...this.breakouts, ...res.data];
          this.showCreateBreakoutForm = false;
        }
        this.isCreatingBreakouts = false;
      },
      error: () => { this.isCreatingBreakouts = false; }
    });
  }

  toggleAssignPanel(breakoutId: string): void {
    if (this.showAssignPanel === breakoutId) {
      this.showAssignPanel = null;
      return;
    }
    this.showAssignPanel = breakoutId;
    const breakout = this.breakouts.find(b => b._id === breakoutId);
    if (breakout) {
      this.tempAssignParticipants = (breakout.assignedParticipants || []).map(
        p => typeof p === 'object' ? (p._id || p) : p
      );
    } else {
      this.tempAssignParticipants = [];
    }
  }

  toggleAssignParticipant(participantId: string): void {
    const idx = this.tempAssignParticipants.indexOf(participantId);
    if (idx >= 0) {
      this.tempAssignParticipants.splice(idx, 1);
    } else {
      this.tempAssignParticipants.push(participantId);
    }
  }

  isAssignChecked(participantId: string): boolean {
    return this.tempAssignParticipants.indexOf(participantId) >= 0;
  }

  assignSelectedToBreakout(breakoutId: string): void {
    const pids = [...this.tempAssignParticipants];
    if (pids.length === 0) return;
    console.log('[Breakout] assignSelectedToBreakout called with pids:', pids, 'breakoutId:', breakoutId);
    this.gluckRoomSocket.emit('breakout-assign-batch', { breakoutId, participantIds: pids });
    // Optimistic update so host's assign panel shows correct checks immediately
    const breakout = this.breakouts.find(b => b._id === breakoutId);
    if (breakout) {
      breakout.assignedParticipants = pids;
    }
    this.showAssignPanel = null;
    this.tempAssignParticipants = [];
  }

  async joinBreakoutRoom(breakoutId: string): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id || this.isConnectingBreakout) return;
    this.isConnectingBreakout = true;
    try {
      const res: any = await this.gluckRoomService.joinBreakout(id, breakoutId).toPromise();
      if (res.success) {
        // Disconnect LiveKit room only — keep socket connected to main room
        this.disconnectLiveKitRoom();
        this.activeBreakoutId = breakoutId;
        // Connect to breakout LiveKit room without re-setting up socket
        await this.connectToBreakoutRoom(
          res.data.livekitUrl,
          res.data.token,
          res.data.roomName
        );
      }
    } catch {
      this.activeBreakoutId = null;
    }
    this.isConnectingBreakout = false;
  }

  private async connectToBreakoutRoom(livekitUrl: string, token: string, roomName: string): Promise<void> {
    if (!token || !livekitUrl) return;

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
        // Register event handlers for already-connected participants
        this.room?.remoteParticipants.forEach(p => {
          this.onParticipantConnected(p);
          p.audioTrackPublications.forEach((pub) => {
            if (pub.track) pub.track.attach();
          });
        });
        this.updateParticipantList();
        this.selectMainParticipant();
        this.room?.startAudio().catch((e) => console.warn('startAudio failed:', e));
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
      if (pub.source !== Track.Source.ScreenShare && pub.source !== Track.Source.Camera && pub.source !== Track.Source.Microphone) return;
      this.ngZone.run(() => {
        if (pub.source === Track.Source.Microphone) {
          this.isMicOn = true;
          this.updateParticipantList();
        } else if (pub.source === Track.Source.ScreenShare) {
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
          this.updateParticipantList();
          const videoEl = this.mainVideoEl?.nativeElement ?? document.querySelector<HTMLVideoElement>('.main-video');
          const screenTrack = pub.videoTrack ?? (pub.track as any);
          if (videoEl && screenTrack && typeof screenTrack.attach === 'function') {
            videoEl.srcObject = null;
            screenTrack.attach(videoEl);
            videoEl.play().catch(() => {});
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
      await this.room.connect(livekitUrl, token);
    } catch (err: any) {
      this.ngZone.run(() => {
        this.error = 'Failed to connect to breakout: ' + (err.message || 'unknown error');
        this.loading = false;
        this.activeBreakoutId = null;
      });
    }
  }

  async returnToMainRoom(): Promise<void> {
    if (!this.activeBreakoutId) return;
    const breakoutId = this.activeBreakoutId;
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.gluckRoomService.leaveBreakout(id, breakoutId).subscribe({ next: () => {}, error: () => {} });
    }
    this.activeBreakoutId = null;
    await this.reconnectToMainRoom();
  }

  endBreakoutRoom(breakoutId: string): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.breakouts = this.breakouts.filter(b => b._id !== breakoutId);
    if (this.assignedBreakout?._id === breakoutId) this.assignedBreakout = null;
    this.gluckRoomService.endBreakout(id, breakoutId).subscribe({ next: () => {}, error: () => {} });
  }

  endAllBreakoutRooms(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.breakouts = [];
    this.assignedBreakout = null;
    this.gluckRoomService.endAllBreakouts(id).subscribe({ next: () => {}, error: () => {} });
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

  actualDuration(): string {
    if (!this.session?.actualStartTime || !this.session?.actualEndTime) return '';
    const ms = new Date(this.session.actualEndTime).getTime() - new Date(this.session.actualStartTime).getTime();
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 1) return '< 1 min';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h ? `${h}h ${m}m` : `${m} min`;
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
