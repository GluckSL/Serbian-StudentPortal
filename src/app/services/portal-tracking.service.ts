import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, filter, interval } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

const SESSION_STORAGE_KEY = 'portalAnalyticsSessionId';
const ACTIVE_TAB_STORAGE_KEY = 'portalAnalyticsActiveTabId';
const HEARTBEAT_INTERVAL_MS = 10_000;
// Keep counting study/watch time even with low interaction (reading/video playback).
const IDLE_MAX_MS = 5 * 60_000;
const MOUSE_MOVE_THROTTLE_MS = 1000;

@Injectable({ providedIn: 'root' })
export class PortalTrackingService implements OnDestroy {
  private readonly subs = new Subscription();
  private heartbeatSub: Subscription | null = null;
  private sessionId: string | null = null;
  private tabActive = false;
  private starting = false;
  private readonly tabId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}`;
  private lastInteractionAt = Date.now();
  private lastMouseThrottle = 0;
  private readonly boundActivity = this.onUserActivity.bind(this);
  private readonly boundMouse = this.onMouseMoveThrottled.bind(this);

  constructor(
    private http: HttpClient,
    private router: Router,
    private authService: AuthService
  ) {}

  start(): void {
    this.lastInteractionAt = Date.now();
    this.updateTabActiveFromDom();
    this.claimLeadershipIfVisible();
    this.bindActivityCapture();
    this.subs.add(
      this.authService.currentUser$.subscribe((user) => {
        void this.onAuthUser(user);
      })
    );
    this.subs.add(
      this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
        void this.onNavigationEnded();
      })
    );
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('focus', this.onWinFocus);
    window.addEventListener('blur', this.onWinBlur);
    window.addEventListener('pagehide', this.onPageHide);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  stop(): void {
    this.unbindActivityCapture();
    this.stopHeartbeatLoop();
    this.subs.unsubscribe();
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('focus', this.onWinFocus);
    window.removeEventListener('blur', this.onWinBlur);
    window.removeEventListener('pagehide', this.onPageHide);
  }

  async flushEndSessionBeforeLogout(): Promise<void> {
    await this.endSessionIfOpen();
  }

  private bindActivityCapture(): void {
    document.addEventListener('keydown', this.boundActivity, { passive: true });
    document.addEventListener('click', this.boundActivity, { passive: true });
    document.addEventListener('scroll', this.boundActivity, { passive: true, capture: true });
    document.addEventListener('mousemove', this.boundMouse, { passive: true });
  }

  private unbindActivityCapture(): void {
    document.removeEventListener('keydown', this.boundActivity);
    document.removeEventListener('click', this.boundActivity);
    document.removeEventListener('scroll', this.boundActivity, true);
    document.removeEventListener('mousemove', this.boundMouse);
  }

  private onUserActivity(): void {
    this.lastInteractionAt = Date.now();
  }

  private onMouseMoveThrottled(): void {
    const now = Date.now();
    if (now - this.lastMouseThrottle < MOUSE_MOVE_THROTTLE_MS) return;
    this.lastMouseThrottle = now;
    this.lastInteractionAt = now;
  }

  private isRecentlyInteractive(): boolean {
    return Date.now() - this.lastInteractionAt < IDLE_MAX_MS;
  }

  private readLeaderTabId(): string | null {
    try {
      return localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private claimLeadershipIfVisible(): void {
    if (typeof localStorage === 'undefined') return;
    if (document.visibilityState !== 'visible') return;
    try {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, this.tabId);
    } catch {
      /* ignore */
    }
  }

  private isLeaderTab(): boolean {
    return this.readLeaderTabId() === this.tabId;
  }

  private canSendHeartbeat(): boolean {
    return this.isLeaderTab() && this.isRecentlyInteractive();
  }

  private onVis = (): void => {
    this.updateTabActiveFromDom();
    if (document.visibilityState === 'visible') {
      this.claimLeadershipIfVisible();
      this.lastInteractionAt = Date.now();
    }
  };

  private onWinFocus = (): void => {
    this.tabActive = document.visibilityState === 'visible';
    this.claimLeadershipIfVisible();
    this.lastInteractionAt = Date.now();
  };

  private onWinBlur = (): void => {
    this.tabActive = false;
  };

  private onPageHide = (): void => {
    this.sendEndBeacon();
  };

  private updateTabActiveFromDom(): void {
    this.tabActive = document.visibilityState === 'visible' && (typeof document.hasFocus !== 'function' || document.hasFocus());
  }

  private isPublicPath(path: string): boolean {
    const p = path.split('?')[0] || '';
    return p === '/login' || p === '/home' || p === '/' || p === '' || p.startsWith('/signup');
  }

  private shouldTrack(): boolean {
    const user = this.authService.getSnapshotUser();
    if (!user || user.role !== 'STUDENT') return false;
    const path = this.router.url.split('?')[0] || '';
    if (this.isPublicPath(path)) return false;
    return true;
  }

  private currentPageLabel(): string {
    return (this.router.url.split('?')[0] || '/').slice(0, 512);
  }

  private async onAuthUser(user: unknown): Promise<void> {
    const role = (user as { role?: string } | null)?.role;

    if (!user || role !== 'STUDENT') {
      await this.endSessionIfOpen();
      this.sessionId = null;
      this.clearStoredSessionId();
      this.stopHeartbeatLoop();
      return;
    }

    await this.syncTrackingState();
  }

  private async onNavigationEnded(): Promise<void> {
    const user = this.authService.getSnapshotUser();
    if (!user || user.role !== 'STUDENT') return;
    this.lastInteractionAt = Date.now();
    await this.syncTrackingState();
  }

  private async syncTrackingState(): Promise<void> {
    const user = this.authService.getSnapshotUser();
    if (!user || user.role !== 'STUDENT') return;

    if (!this.shouldTrack()) {
      await this.endSessionIfOpen();
      this.sessionId = null;
      this.clearStoredSessionId();
      this.stopHeartbeatLoop();
      return;
    }

    if (!this.isLeaderTab()) {
      this.stopHeartbeatLoop();
      return;
    }

    await this.ensureSession();
    this.startHeartbeatLoop();
  }

  private startHeartbeatLoop(): void {
    if (!this.isLeaderTab()) return;
    this.stopHeartbeatLoop();
    this.heartbeatSub = interval(HEARTBEAT_INTERVAL_MS).subscribe(() => {
      if (!this.shouldTrack() || !this.sessionId) return;
      this.updateTabActiveFromDom();
      if (!this.tabActive) return;
      if (!this.canSendHeartbeat()) return;
      this.sendHeartbeat();
    });
  }

  private stopHeartbeatLoop(): void {
    this.heartbeatSub?.unsubscribe();
    this.heartbeatSub = null;
  }

  private clearStoredSessionId(): void {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  private readStoredSessionId(): string | null {
    try {
      return sessionStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private async ensureSession(): Promise<void> {
    if (!this.isLeaderTab()) return;
    if (this.starting) return;
    this.starting = true;
    try {
      let sid = this.readStoredSessionId();
      if (sid) {
        this.sessionId = sid;
        const alive = await this.tryHeartbeat();
        if (alive) {
          return;
        }
        this.sessionId = null;
        this.clearStoredSessionId();
      }

      const res = await firstValueFrom(
        this.http.post<{ sessionId: string }>(`${environment.apiUrl}/portal/start-session`, {}, { withCredentials: true })
      );
      if (res?.sessionId) {
        this.sessionId = res.sessionId;
        try {
          sessionStorage.setItem(SESSION_STORAGE_KEY, res.sessionId);
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      console.warn('[portal-tracking] ensureSession failed', e);
    } finally {
      this.starting = false;
    }
  }

  private async tryHeartbeat(): Promise<boolean> {
    if (!this.sessionId) return false;
    if (!this.isLeaderTab()) return false;
    if (!this.isRecentlyInteractive()) return true;
    try {
      await firstValueFrom(
        this.http.post(
          `${environment.apiUrl}/portal/heartbeat`,
          { sessionId: this.sessionId, page: this.currentPageLabel() },
          { withCredentials: true }
        )
      );
      return true;
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 410 || status === 404 || status === 401) return false;
      return true;
    }
  }

  private sendHeartbeat(): void {
    if (!this.sessionId) return;
    if (!this.canSendHeartbeat()) return;
    this.http
      .post(
        `${environment.apiUrl}/portal/heartbeat`,
        { sessionId: this.sessionId, page: this.currentPageLabel() },
        { withCredentials: true }
      )
      .subscribe({
        next: () => {},
        error: (err) => {
          if (err?.status === 410 || err?.status === 404) {
            void this.ensureSession();
          }
        }
      });
  }

  private async endSessionIfOpen(): Promise<void> {
    const sid = this.sessionId || this.readStoredSessionId();
    if (!sid) return;
    try {
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/portal/end-session`, { sessionId: sid }, { withCredentials: true })
      );
    } catch {
      /* ignore */
    }
    this.sessionId = null;
    this.clearStoredSessionId();
  }

  private sendEndBeacon(): void {
    let sid: string | null = this.sessionId || this.readStoredSessionId();
    if (!sid || typeof navigator.sendBeacon !== 'function') return;
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}${environment.apiUrl}/portal/end-session`;
    const blob = new Blob([JSON.stringify({ sessionId: sid })], { type: 'application/json' });
    navigator.sendBeacon(url, blob);
  }
}
