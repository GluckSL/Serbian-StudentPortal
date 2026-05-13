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

const JOIN_DEBOUNCE_MS = 900;
const SAFETY_RELEASE_JOIN_MS = 28000;

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
  private isJoining = false;
  private activeLaunchRun = 0;
  private lastJoinAttemptAt = 0;

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

  private releaseJoinLock(): void {
    this.isJoining = false;
  }

  private scheduleSafetyRelease(runId: number): void {
    this.scheduleJoinTimer(() => {
      if (runId !== this.activeLaunchRun) return;
      this.releaseJoinLock();
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
    joinFlowLog('join_started', { meetingId });

    if (isRestrictedInAppBrowser()) {
      // Social-media in-app browsers (WhatsApp, Instagram, etc.) — warn user to open in Chrome/Safari.
      this.prefetchJoinThen(meetingId, onError, (body) => {
        const dialogRef = this.dialog.open<
          InAppBrowserWarningComponent,
          InAppBrowserWarningData,
          boolean
        >(InAppBrowserWarningComponent, {
          data: {
            zoomWebUrl: body.zoomUniversalUrl || body.zoomWebUrl || body.redirectUrl || '',
          },
          width: '460px',
          disableClose: false,
        });
        dialogRef.afterClosed().subscribe(() => {
          this.launchZoomFromBody(body, onError, null);
        });
      });
      return;
    }

    // For desktop: open a blank tab NOW while the user-gesture context is still active.
    // window.open() inside setTimeout (after async HTTP) is blocked by popup blockers.
    let preOpenedWin: Window | null = null;
    if (!isMobile() && !isAndroidWebView()) {
      preOpenedWin = window.open('', '_blank');
      if (preOpenedWin) {
        try {
          preOpenedWin.document.write(
            '<!DOCTYPE html><html><head><title>Joining Zoom\u2026</title></head>' +
            '<body style="font-family:sans-serif;text-align:center;padding:80px 20px;color:#444">' +
            '<h2>Joining Zoom\u2026</h2><p>Please wait a moment.</p></body></html>',
          );
          preOpenedWin.document.close();
        } catch { /* ignore CSP restriction */ }
      }
    }

    this.fetchAndOpenZoom(meetingId, onError, preOpenedWin);
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
          const universalUrl = body?.zoomUniversalUrl || '';
          if (!webUrl && !appUrl && !universalUrl) {
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

  private fetchAndOpenZoom(
    meetingId: string,
    onError: ((msg: string) => void) | undefined,
    preOpenedWin: Window | null,
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
          this.launchZoomFromBody(body, onError, preOpenedWin);
        },
        error: (err) => {
          if (preOpenedWin && !preOpenedWin.closed) {
            try { preOpenedWin.close(); } catch { /* ignore */ }
          }
          this.joinError(err, onError);
        },
      });
  }

  private launchZoomFromBody(
    body: JoinClassApiBody,
    onError: ((msg: string) => void) | undefined,
    preOpenedWin: Window | null,
  ): void {
    const universalUrl = body?.zoomUniversalUrl || '';
    const webUrl = body?.zoomWebUrl || body?.redirectUrl || '';
    if (!universalUrl && !webUrl) {
      if (preOpenedWin && !preOpenedWin.closed) {
        try { preOpenedWin.close(); } catch { /* ignore */ }
      }
      this.releaseJoinLock();
      this.joinState$.next({ loading: false, message: '' });
      onError?.(body?.message || body?.msg || 'Could not start join.');
      return;
    }
    this.launchZoom(universalUrl, webUrl, onError, preOpenedWin);
  }

  /**
   * Three clear paths — no cascading timers:
   *
   * 1. Android WebView (Gluck app): intent:// hands off to the Zoom package directly.
   * 2. Mobile browser: navigate current tab to the universal URL.
   *    iOS Universal Links / Android App Links open the Zoom app when installed.
   *    When Zoom is not installed zoom.us shows "Join from Your Browser" — pwd is in the URL so
   *    no passcode entry is needed, and uname pre-fills the name field.
   * 3. Desktop: navigate the pre-opened blank tab to the universal URL (tab was opened
   *    synchronously on click, so popup-blockers never fire). zoom.us auto-launches the
   *    Zoom app if installed; otherwise the user clicks "Join from Your Browser" — again
   *    pwd and uname are already in the URL.
   */
  private launchZoom(
    universalUrl: string,
    webUrl: string,
    onError: ((msg: string) => void) | undefined,
    preOpenedWin: Window | null,
  ): void {
    this.clearJoinTimers();
    this.activeLaunchRun += 1;
    const runId = this.activeLaunchRun;

    const mobile = isMobile();
    const inWebView = isAndroidWebView();
    const targetUrl = universalUrl || webUrl;

    joinFlowLog('join_launch', { runId, mobile, inWebView, targetUrl });

    if (inWebView && universalUrl) {
      // Android WebView: zoommtg:// is blocked; intent:// asks Android to open the Zoom app.
      this.joinState$.next({ loading: true, message: 'Opening Zoom app\u2026' });
      const intentUrl =
        'intent://' +
        universalUrl.replace(/^https?:\/\//, '') +
        '#Intent;scheme=https;package=us.zoom.videomeetings;end';
      joinFlowLog('deep_link_attempted', { runId, method: 'intent_webview' });
      window.location.href = intentUrl;

    } else if (mobile) {
      // Mobile browser: navigate current tab — no user-gesture restriction on plain HTTPS.
      // App Links open the Zoom app when installed; zoom.us handles the fallback to web.
      this.joinState$.next({ loading: true, message: 'Opening Zoom\u2026' });
      joinFlowLog('mobile_navigate', { runId });
      window.location.href = targetUrl;

    } else {
      // Desktop: use the pre-opened tab so popup-blockers never interfere.
      this.joinState$.next({ loading: false, message: '' });
      joinFlowLog('desktop_tab_navigate', { runId, preOpened: !!preOpenedWin });
      if (preOpenedWin && !preOpenedWin.closed) {
        preOpenedWin.location.href = targetUrl;
      } else {
        const win = window.open(targetUrl, '_blank');
        if (!win) {
          // Last resort if popup was still blocked: use current tab.
          joinFlowLog('popup_blocked_fallback', { runId });
          window.location.href = targetUrl;
        }
      }
    }

    this.scheduleJoinTimer(() => {
      if (runId !== this.activeLaunchRun) return;
      this.joinState$.next({ loading: false, message: '' });
      this.releaseJoinLock();
    }, mobile || inWebView ? 4000 : 2000);

    this.scheduleSafetyRelease(runId);
  }
}
