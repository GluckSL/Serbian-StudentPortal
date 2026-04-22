import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';

function meetingIdFromJoinClassUrl(joinUrl: string): string {
  const m = String(joinUrl).match(/join-class\/([a-f0-9]{24})/i);
  return m ? m[1] : '';
}

/**
 * Student "Join class" hits /api/join-class/:id with Bearer (interceptor).
 * The API returns JSON { redirectUrl } for XHR so we open Zoom in a new tab — raw /api/join-class links cannot send localStorage JWT.
 */
@Injectable({ providedIn: 'root' })
export class JoinClassFlowService {
  constructor(private http: HttpClient) {}

  /**
   * If joinUrl is the portal join-class endpoint, fetch Zoom URL with auth; else open join/start URL directly (e.g. teacher Zoom links).
   */
  openJoin(
    meeting: { _id?: string; joinUrl?: string; startUrl?: string | null },
    onError?: (message: string) => void
  ): void {
    const joinUrl = String(meeting.joinUrl || '');
    const startUrl = String(meeting.startUrl || '');
    let meetingId = meeting._id != null ? String(meeting._id).trim() : '';
    if (!meetingId && joinUrl.includes('join-class')) {
      meetingId = meetingIdFromJoinClassUrl(joinUrl);
    }

    const isPortalJoin = meetingId.length > 0 && joinUrl.length > 0 && joinUrl.includes('join-class');

    if (!isPortalJoin) {
      const url = joinUrl || startUrl;
      if (url) {
        window.open(url, '_blank');
      } else {
        onError?.('No join link available.');
      }
      return;
    }

    const headers = new HttpHeaders({
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    });

    this.http
      .get<{ success?: boolean; redirectUrl?: string; message?: string; msg?: string }>(
        `${environment.apiUrl}/join-class/${encodeURIComponent(meetingId)}`,
        { headers }
      )
      .subscribe({
        next: (body) => {
          const zoom = body?.redirectUrl;
          if (zoom) {
            window.open(zoom, '_blank');
          } else {
            onError?.(body?.message || body?.msg || 'Could not start join.');
          }
        },
        error: (err) => {
          const e = err?.error;
          const msg =
            (e && typeof e.message === 'string' && e.message) ||
            (e && typeof e.msg === 'string' && e.msg) ||
            (typeof e === 'string' ? e : null) ||
            'Join failed. Sign in on the portal and try again.';
          onError?.(msg);
        },
      });
  }
}
