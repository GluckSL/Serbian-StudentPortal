import { Injectable, NgZone } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { environment } from '../../environments/environment';
import { getAuthToken } from './auth.service';
import { isRestrictedInAppBrowser, isAndroidWebView, isMobile } from '../utils/in-app-browser.util';
import {
  InAppBrowserWarningComponent,
  InAppBrowserWarningData,
} from '../shared/in-app-browser-warning/in-app-browser-warning.component';

/** Primary fallback after zoommtg:// — conservative for slow devices (ms). */
function primaryFallbackMs(): number {
  return 2200 + Math.floor(Math.random() * 901);
}

/** Secondary delay mobile: universal → wc (ms). */
function secondaryFallbackMs(): number {
  return 2200 + Math.floor(Math.random() * 801);
}

const JOIN_DEBOUNCE_MS = 900;
const SAFETY_RELEASE_JOIN_MS = 28000;

const JOIN_FLOW_FAIL_MSG =
  'Unable to open Zoom automatically. Please ensure Zoom is installed or open the class in Chrome/Safari.';

function meetingIdFromJoinClassUrl(joinUrl: string): string {
  const m = String(joinUrl).match(/join-class\/([a-f0-9]{24})/i);
  return m ? m[1] : '';
}

/**
 * Safe internal-only return-URL validator: must start with '/' and not be an external URL.
 * Excludes login routes to avoid redirect loops after session expiry.
 */
export function isSafeReturnUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('/')) return false;
  if (url.startsWith('//')) return false;
  try {
    const parsed = new URL(url, 'https://portal.internal');
    if (parsed.hostname !== 'portal.internal') return false;
    const path = parsed.pathname || '';
    if (path === '/login' || path === '/auth/login') return false;
    return true;
  } catch {
    return false;
  }
}

function getValidJwt(): { exp?: number } | null {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const decoded = jwtDecode<{ exp?: number }>(token);
    const exp = decoded?.exp;
    if (exp != null && Date.now() / 1000 >= exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

export interface JoinState {
  loading: boolean;
  message: string;
}

interface JoinClassApiBody {
  success?: boolean;
  zoomAppUrl?: string;
  zoomUniversalUrl?: string;
  zoomWebUrl?: string;
  redirectUrl?: string;
  displayName?: string;
  message?: string;
  msg?: string;
}

/**
 * Discrete client-side join funnel logs (low volume). Use log aggregation in production.
 */
function joinFlowLog(event: string, detail?: Record<string, unknown>): void {
  const payload = detail ? { ...detail } : undefined;
  if (payload) {
    console.info('[JoinFlow]', event, payload);
  } else {
    console.info('[JoinFlow]', event);
  }
}

@Injectable({ providedIn: 'root' })
export class JoinClassFlowService {
  readonly joinState$ = new BehaviorSubject<JoinState>({ loading: false, message: '' });
  private joinTimers: ReturnType<typeof setTimeout>[] = [];
  /** True while a portal join is in flight (HTTP, dialog, or scheduled fallbacks). */
  private isJoining = false;
  /** Monotonic id for the active launch; stale callbacks no-op. */
  private activeLaunchRun = 0;
  private lastJoinAttemptAt = 0;

  private visibilityListener: (() => void) | null = null;
  private pageHideListener: (() => void) | null = null;
  private blurListener: (() => void) | null = null;
  private blurDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private http: HttpClient,
    private router: Router,
    private dialog: MatDialog,
    private ngZone: NgZone,
  ) {}

  private clearJoinTimers(): void {
    for (const t of this.joinTimers) {
      clearTimeout(t);
    }
    this.joinTimers = [];
  }

  private scheduleJoinTimer(fn: () => void, ms: number): void {
    const id = setTimeout(() => this.ngZone.run(fn), ms);
    this.joinTimers.push(id);
  }

  private detachLifecycleGuards(): void {
    if (this.visibilityListener) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
    if (this.pageHideListener) {
      window.removeEventListener('pagehide', this.pageHideListener);
      this.pageHideListener = null;
    }
    if (this.blurListener) {
      window.removeEventListener('blur', this.blurListener);
      this.blurListener = null;
    }
    if (this.blurDebounceTimer != null) {
      clearTimeout(this.blurDebounceTimer);
      this.blurDebounceTimer = null;
    }
  }

  /**
   * Heuristic: tab hidden / page unloading often means Zoom or another app took focus.
   * Cancels remaining same-tab navigations to reduce duplicate loads / extra tabs.
   */
  private attachLifecycleGuards(runId: number): void {
    this.detachLifecycleGuards();

    this.visibilityListener = () => {
      if (runId !== this.activeLaunchRun) return;
      if (document.visibilityState === 'hidden') {
        this.cancelRemainingFallbacks(runId, 'visibility_hidden');
      }
    };

    this.pageHideListener = () => {
      if (runId !== this.activeLaunchRun) return;
      this.cancelRemainingFallbacks(runId, 'pagehide');
    };

    this.blurListener = () => {
      if (runId !== this.activeLaunchRun) return;
      if (this.blurDebounceTimer != null) {
        clearTimeout(this.blurDebounceTimer);
      }
      this.blurDebounceTimer = setTimeout(() => {
        this.blurDebounceTimer = null;
        if (runId !== this.activeLaunchRun) return;
        if (document.visibilityState === 'hidden') {
          this.cancelRemainingFallbacks(runId, 'blur_then_hidden');
        }
      }, 200);
    };

    document.addEventListener('visibilitychange', this.visibilityListener);
    window.addEventListener('pagehide', this.pageHideListener);
    window.addEventListener('blur', this.blurListener);
  }

  private cancelRemainingFallbacks(runId: number, reason: string): void {
    if (runId !== this.activeLaunchRun) return;
    this.clearJoinTimers();
    joinFlowLog('join_cancelled', { reason });
    this.detachLifecycleGuards();
    this.releaseJoinLock();
    this.joinState$.next({ loading: false, message: '' });
  }

  private releaseJoinLock(): void {
    this.isJoining = false;
  }

  private scheduleSafetyRelease(runId: number): void {
    this.scheduleJoinTimer(() => {
      if (runId !== this.activeLaunchRun) return;
      this.releaseJoinLock();
      this.detachLifecycleGuards();
    }, SAFETY_RELEASE_JOIN_MS);
  }

  private shouldIgnoreDuplicateTap(): boolean {
    if (this.isJoining) {
      joinFlowLog('duplicate_join_prevented', { reason: 'already_joining' });
      return true;
    }
    const now = Date.now();
    if (this.lastJoinAttemptAt > 0 && now - this.lastJoinAttemptAt < JOIN_DEBOUNCE_MS) {
      joinFlowLog('duplicate_join_prevented', { reason: 'debounce', msSinceLast: now - this.lastJoinAttemptAt });
      return true;
    }
    this.lastJoinAttemptAt = now;
    return false;
  }

  openJoin(
    meeting: { _id?: string; joinUrl?: string; startUrl?: string | null },
    onError?: (message: string) => void,
  ): void {
    const joinUrl = String(meeting.joinUrl || '');
    const startUrl = String(meeting.startUrl || '');
    let meetingId = meeting._id != null ? String(meeting._id).trim() : '';
    if (!meetingId && joinUrl.includes('join-class')) {
      meetingId = meetingIdFromJoinClassUrl(joinUrl);
    }

    const isPortalJoin =
      meetingId.length > 0 && joinUrl.length > 0 && joinUrl.includes('join-class');

    if (!isPortalJoin) {
      const url = joinUrl || startUrl;
      if (url) {
        window.open(url, '_blank');
      } else {
        onError?.('No join link available.');
      }
      return;
    }

    if (!getValidJwt()) {
      const returnUrl = this.router.url;
      this.router.navigate(['/login'], {
        queryParams: isSafeReturnUrl(returnUrl)
          ? { returnUrl, session: 'expired' }
          : { session: 'expired' },
      });
      return;
    }

    if (this.shouldIgnoreDuplicateTap()) {
      return;
    }

    this.isJoining = true;
    this.clearJoinTimers();
    this.detachLifecycleGuards();
    joinFlowLog('join_started', { meetingId });

    if (isRestrictedInAppBrowser()) {
      // Social-media in-app browsers (WhatsApp, Instagram, etc.) — warn user to open in Chrome/Safari first.
      this.prefetchJoinThen(meetingId, onError, (body) => {
        const webUrl = body.zoomWebUrl || body.redirectUrl || '';
        const dialogRef = this.dialog.open<
          InAppBrowserWarningComponent,
          InAppBrowserWarningData,
          boolean
        >(InAppBrowserWarningComponent, {
          data: { zoomWebUrl: webUrl },
          width: '460px',
          disableClose: false,
        });
        dialogRef.afterClosed().subscribe(() => {
          this.launchZoomFromBody(body, onError);
        });
      });
      return;
    }

    // Regular browser or Gluck app WebView — proceed with direct Zoom launch.
    this.fetchAndOpenZoom(meetingId, onError);
  }

  private prefetchJoinThen(
    meetingId: string,
    onError: ((msg: string) => void) | undefined,
    onOk: (body: JoinClassApiBody) => void,
  ): void {
    this.joinState$.next({ loading: true, message: '' });
    joinFlowLog('join_fetch_started', { meetingId });
    const headers = new HttpHeaders({
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    });
    this.http
      .get<JoinClassApiBody>(`${environment.apiUrl}/join-class/${encodeURIComponent(meetingId)}`, {
        headers,
      })
      .subscribe({
        next: (body) => {
          this.joinState$.next({ loading: false, message: '' });
          const webUrl = body?.zoomWebUrl || body?.redirectUrl || '';
          const appUrl = body?.zoomAppUrl || '';
          if (!webUrl && !appUrl) {
            this.releaseJoinLock();
            onError?.(body?.message || body?.msg || 'Could not start join.');
            return;
          }
          onOk(body);
        },
        error: (err) => this.joinError(err, onError),
      });
  }

  private joinError(err: unknown, onError?: (msg: string) => void): void {
    this.clearJoinTimers();
    this.detachLifecycleGuards();
    this.releaseJoinLock();
    this.joinState$.next({ loading: false, message: '' });
    const e = (err as { error?: { message?: string; msg?: string } })?.error;
    const msg =
      (e && typeof e.message === 'string' && e.message) ||
      (e && typeof e.msg === 'string' && e.msg) ||
      (typeof e === 'string' ? e : null) ||
      'Join failed. Sign in on the portal and try again.';
    onError?.(msg);
  }

  private fetchAndOpenZoom(meetingId: string, onError?: (msg: string) => void): void {
    this.joinState$.next({ loading: true, message: '' });
    joinFlowLog('join_fetch_started', { meetingId });
    const headers = new HttpHeaders({
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    });
    this.http
      .get<JoinClassApiBody>(`${environment.apiUrl}/join-class/${encodeURIComponent(meetingId)}`, {
        headers,
      })
      .subscribe({
        next: (body) => {
          this.launchZoomFromBody(body, onError);
        },
        error: (err) => this.joinError(err, onError),
      });
  }

  private launchZoomFromBody(body: JoinClassApiBody, onError?: (msg: string) => void): void {
    const appUrl = body?.zoomAppUrl || '';
    const universalUrl = body?.zoomUniversalUrl || '';
    const webUrl = body?.zoomWebUrl || body?.redirectUrl || '';
    if (!webUrl && !appUrl) {
      this.releaseJoinLock();
      this.joinState$.next({ loading: false, message: '' });
      onError?.(body?.message || body?.msg || 'Could not start join.');
      return;
    }
    this.launchZoom(appUrl, universalUrl, webUrl, onError);
  }

  /**
   * Mobile: zoommtg → universal → wc (same tab, guarded + cancellable).
   * Desktop: zoommtg → wc in new tab (popup-block detection).
   */
  private launchZoom(
    appUrl: string,
    universalUrl: string,
    webUrl: string,
    onError?: (msg: string) => void,
  ): void {
    this.clearJoinTimers();
    this.detachLifecycleGuards();
    this.activeLaunchRun += 1;
    const runId = this.activeLaunchRun;

    const mobile = isMobile();
    const inWebView = isAndroidWebView();
    const d1 = primaryFallbackMs();
    this.attachLifecycleGuards(runId);
    joinFlowLog('join_launch_scheduled', { runId, mobile, inWebView, d1 });

    if (appUrl || (inWebView && universalUrl)) {
      this.joinState$.next({ loading: true, message: 'Opening Zoom app\u2026' });
      if (inWebView && universalUrl) {
        // In an Android WebView (e.g. Gluck app), zoommtg:// is blocked by default.
        // Use intent:// to tell Android to open the Zoom app directly.
        const intentUrl =
          'intent://' +
          universalUrl.replace(/^https?:\/\//, '') +
          '#Intent;scheme=https;package=us.zoom.videomeetings;end';
        joinFlowLog('deep_link_attempted', { runId, method: 'intent_webview' });
        window.location.href = intentUrl;
      } else {
        joinFlowLog('deep_link_attempted', { runId, method: 'zoommtg' });
        window.location.href = appUrl;
      }
    } else {
      this.joinState$.next({ loading: true, message: 'Opening Zoom\u2026' });
    }

    if (mobile && universalUrl && webUrl) {
      if (inWebView) {
        // In a WebView the universal URL just navigates inside the WebView — skip it.
        // After d1, fall back to the Zoom web client directly.
        this.scheduleJoinTimer(() => {
          if (runId !== this.activeLaunchRun) return;
          joinFlowLog('wc_fallback_used', { runId, path: 'webview_fallback' });
          this.joinState$.next({ loading: false, message: 'Opening Zoom in browser\u2026' });
          window.location.href = webUrl;
          this.scheduleJoinTimer(() => {
            if (runId !== this.activeLaunchRun) return;
            this.joinState$.next({ loading: false, message: '' });
            this.releaseJoinLock();
            this.detachLifecycleGuards();
          }, 2000);
        }, d1);
      } else {
        this.scheduleJoinTimer(() => {
          if (runId !== this.activeLaunchRun) return;
          joinFlowLog('universal_fallback_used', { runId });
          this.joinState$.next({ loading: true, message: 'Opening Zoom link\u2026' });
          window.location.href = universalUrl;
        }, d1);
        const d2 = secondaryFallbackMs();
        this.scheduleJoinTimer(() => {
          if (runId !== this.activeLaunchRun) return;
          joinFlowLog('wc_fallback_used', { runId });
          this.joinState$.next({ loading: false, message: 'Opening Zoom in browser\u2026' });
          window.location.href = webUrl;
          this.scheduleJoinTimer(() => {
            if (runId !== this.activeLaunchRun) return;
            this.joinState$.next({ loading: false, message: '' });
            this.releaseJoinLock();
            this.detachLifecycleGuards();
          }, 2000);
        }, d1 + d2);
      }
      this.scheduleSafetyRelease(runId);
      return;
    }

    if (webUrl) {
      this.scheduleJoinTimer(() => {
        if (runId !== this.activeLaunchRun) return;
        this.joinState$.next({ loading: false, message: 'Opening Zoom\u2026' });
        if (mobile) {
          joinFlowLog('wc_fallback_used', { runId, path: 'mobile_same_tab' });
          window.location.href = webUrl;
        } else {
          joinFlowLog('wc_fallback_used', { runId, path: 'desktop_new_tab' });
          const win = window.open(webUrl, '_blank');
          if (win == null) {
            joinFlowLog('join_failed', { runId, reason: 'popup_blocked' });
            onError?.(JOIN_FLOW_FAIL_MSG);
            this.releaseJoinLock();
            this.detachLifecycleGuards();
            this.joinState$.next({ loading: false, message: '' });
            return;
          }
        }
        this.scheduleJoinTimer(() => {
          if (runId !== this.activeLaunchRun) return;
          this.joinState$.next({ loading: false, message: '' });
          this.releaseJoinLock();
          this.detachLifecycleGuards();
        }, 2000);
      }, appUrl ? d1 : 0);
      this.scheduleSafetyRelease(runId);
    } else {
      this.releaseJoinLock();
      this.detachLifecycleGuards();
      this.joinState$.next({ loading: false, message: '' });
    }
  }
}
