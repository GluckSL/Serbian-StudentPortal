import { getAuthToken } from '../services/auth.service';

/**
 * hls.js loads playlists and segments via XHR — it does not use Angular HttpClient,
 * so the auth token interceptor does not run.
 * Always attach Authorization Bearer token for HLS requests.
 */
export function hlsAuthXhrSetup(xhr: XMLHttpRequest, url?: string): void {
  try {
    const token = getAuthToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
  } catch {
    /* storage blocked / unavailable */
  }
}
