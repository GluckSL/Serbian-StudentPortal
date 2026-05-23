import { getAuthToken } from '../services/auth.service';

/**
 * hls.js loads playlists and segments via XHR — it does not use Angular HttpClient,
 * so the auth token interceptor does not run.
 * Only attach Authorization Bearer for non-presigned URLs (our backend).
 * Presigned R2 URLs already carry auth in query params; adding an Authorization header
 * would trigger unnecessary CORS preflights and may cause audio/video failures.
 */
export function hlsAuthXhrSetup(xhr: XMLHttpRequest, url?: string): void {
  if (url && url.includes('X-Amz-Signature')) return;
  try {
    const token = getAuthToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
  } catch {
    /* storage blocked / unavailable */
  }
}
