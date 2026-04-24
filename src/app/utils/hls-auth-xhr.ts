import { AUTH_STORAGE_KEY } from '../services/auth.service';
import { getApiOriginForCredentials } from './media-url';

/**
 * hls.js loads playlists and segments via XHR — it does not use Angular HttpClient,
 * so the auth token interceptor does not run. For same-origin API URLs we send:
 * - Authorization: Bearer … (from localStorage, same key as authTokenInterceptor)
 * - withCredentials so httpOnly authToken cookie is included when present
 *
 * Presigned R2 segment URLs must not get credentials (CORS).
 */
export function hlsAuthXhrSetup(xhr: XMLHttpRequest, url?: string): void {
  try {
    const apiOrigin = getApiOriginForCredentials();
    const target = new URL(url || '', window.location.href);
    if (target.origin !== apiOrigin) {
      return;
    }
    xhr.withCredentials = true;
    try {
      const token = localStorage.getItem(AUTH_STORAGE_KEY);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
    } catch {
      /* storage blocked */
    }
  } catch {
    /* invalid URL — leave defaults */
  }
}
