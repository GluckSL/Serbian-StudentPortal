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
/** How long the join lock holds after launching Zoom — prevents re-tapping within the same browser session. */
const JOIN_LOCK_TIMEOUT_MS = 15_000;
const SAFETY_RELEASE_JOIN_MS = JOIN_LOCK_TIMEOUT_MS + 3_000; // fallback a few ms after normal release

/** sessionStorage key for persisting the per-meeting lock across mobile navigation (back button). */
const JOIN_LOCK_STORAGE_KEY = 'gluck_join_lock';

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
    if (
      path === '/login' ||
      path === '/auth/login' ||
      path === '/register' ||
      path === '/forgot-password' ||
      path === '/signup/apply'
    ) {
      return false;
    }
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

/** Extract student id from the current JWT for logging (no sensitive data exposed). */
function getStudentIdFromJwt(): string {
  const token = getAuthToken();
  if (!token) return 'unknown';
  try {
    const decoded = jwtDecode<{ id?: string; sub?: string }>(token);
    return decoded?.id || decoded?.sub || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Minimal, stable device context for join-flow logs. */
function buildDeviceContext(): Record<string, unknown> {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const inWebView = /wv\)|; wv;/i.test(ua);
  const browser = /WhatsApp/i.test(ua) ? 'WhatsApp'
    : /Instagram/i.test(ua) ? 'Instagram'
    : /FBAN|FBAV/i.test(ua) ? 'Facebook'
    : /Telegram/i.test(ua) ? 'Telegram'
    : /Chrome/i.test(ua) ? 'Chrome'
    : /Safari/i.test(ua) ? 'Safari'
    : 'other';
  return { mobile, inWebView, browser, ts: new Date().toISOString() };
}

/** Persist a per-meeting join lock that survives mobile back-navigation within the same tab. */
function setJoinLock(meetingId: string): void {
  try {
    sessionStorage.setItem(JOIN_LOCK_STORAGE_KEY, JSON.stringify({ meetingId, lockedAt: Date.now() }));
  } catch { /* ignore quota/CSP issues */ }
}

function getJoinLock(): { meetingId: string; lockedAt: number } | null {
  try {
    const raw = sessionStorage.getItem(JOIN_LOCK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearJoinLock(): void {
  try { sessionStorage.removeItem(JOIN_LOCK_STORAGE_KEY); } catch { /* ignore */ }
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
    clearJoinLock();
  }

  private scheduleSafetyRelease(runId: number): void {
    this.scheduleJoinTimer(() => {
      if (runId !== this.activeLaunchRun) return;
      this.releaseJoinLock();
    }, SAFETY_RELEASE_JOIN_MS);
  }

  /**
   * Two-layer duplicate-join prevention:
   * 1. In-memory `isJoining` flag — guards same Angular instance (concurrent taps, desktop).
   * 2. sessionStorage per-meeting lock — survives mobile back-navigation within the same tab.
   * 3. 900 ms UI debounce — swallows accidental double-taps.
   */
  private shouldIgnoreDuplicateTap(meetingId: string): boolean {
    if (this.isJoining) {
      joinFlowLog('duplicate_join_prevented', { reason: 'already_joining', meetingId, ...buildDeviceContext() });
      return true;
    }

    const lock = getJoinLock();
    if (lock && lock.meetingId === meetingId && Date.now() - lock.lockedAt < JOIN_LOCK_TIMEOUT_MS) {
      joinFlowLog('duplicate_join_prevented', {
        reason: 'per_meeting_lock',
        meetingId,
        msSinceLock: Date.now() - lock.lockedAt,
        ...buildDeviceContext(),
      });
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

    if (this.shouldIgnoreDuplicateTap(meetingId)) {
      return;
    }

    this.isJoining = true;
    this.clearJoinTimers();
    joinFlowLog('join_started', {
      meetingId,
      studentId: getStudentIdFromJwt(),
      ts: new Date().toISOString(),
      ...buildDeviceContext(),
    });

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
          this.launchZoomFromBody(body, onError, null, meetingId);
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
    joinFlowLog('join_fetch_started', { meetingId, studentId: getStudentIdFromJwt() });
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
    joinFlowLog('join_fetch_started', { meetingId, studentId: getStudentIdFromJwt() });
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
          this.launchZoomFromBody(body, onError, preOpenedWin, meetingId);
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
    meetingId: string,
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
    this.launchZoom(universalUrl, webUrl, onError, preOpenedWin, meetingId);
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
    meetingId: string,
  ): void {
    this.clearJoinTimers();
    this.activeLaunchRun += 1;
    const runId = this.activeLaunchRun;

    const mobile = isMobile();
    const inWebView = isAndroidWebView();
    const targetUrl = universalUrl || webUrl;

    // Persist the lock BEFORE navigating — survives back-button on mobile.
    setJoinLock(meetingId);

    joinFlowLog('join_launch', {
      runId,
      meetingId,
      studentId: getStudentIdFromJwt(),
      method: inWebView ? 'intent_webview' : mobile ? 'mobile_navigate' : 'desktop_tab',
      targetUrl,
      ts: new Date().toISOString(),
      ...buildDeviceContext(),
    });

    if (inWebView && universalUrl) {
      // Android WebView: zoommtg:// is blocked; intent:// hands off to the Zoom app package.
      this.joinState$.next({ loading: true, message: 'Opening Zoom app\u2026' });
      const intentUrl =
        'intent://' +
        universalUrl.replace(/^https?:\/\//, '') +
        '#Intent;scheme=https;package=us.zoom.videomeetings;end';
      window.location.href = intentUrl;

    } else if (mobile) {
      // Mobile browser: navigate current tab.
      // iOS Universal Links / Android App Links open the Zoom app when installed.
      this.joinState$.next({ loading: true, message: 'Opening Zoom\u2026' });
      window.location.href = targetUrl;

    } else {
      // Desktop: navigate the pre-opened blank tab (opened synchronously on click,
      // so popup-blockers never fire).
      this.joinState$.next({ loading: false, message: '' });
      if (preOpenedWin && !preOpenedWin.closed) {
        preOpenedWin.location.href = targetUrl;
      } else {
        const win = window.open(targetUrl, '_blank');
        if (!win) {
          // Last resort if popup was still blocked.
          joinFlowLog('popup_blocked_fallback', { runId, meetingId });
          window.location.href = targetUrl;
        }
      }
    }

    // Single cleanup timer — 15 s matches JOIN_LOCK_TIMEOUT_MS.
    // Prevents re-join button from firing again within that window.
    this.scheduleJoinTimer(() => {
      if (runId !== this.activeLaunchRun) return;
      this.joinState$.next({ loading: false, message: '' });
      this.releaseJoinLock();
    }, JOIN_LOCK_TIMEOUT_MS);

    this.scheduleSafetyRelease(runId);
  }
}
