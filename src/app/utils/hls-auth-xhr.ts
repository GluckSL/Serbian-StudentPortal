import { getAuthToken } from '../services/auth.service';

/** Presigned R2/S3 URLs carry auth in query params — never add Bearer headers. */
export function isPresignedMediaUrl(url?: string): boolean {
  if (!url) return false;
  return url.includes('X-Amz-Signature') || url.includes('X-Amz-Credential');
}

/**
 * hls.js loads playlists and segments via XHR — it does not use Angular HttpClient,
 * so the auth token interceptor does not run.
 * Only attach Authorization Bearer for non-presigned URLs (our backend).
 * Presigned R2 URLs already carry auth in query params; adding an Authorization header
 * would trigger unnecessary CORS preflights and may cause audio/video failures.
 */
export function hlsAuthXhrSetup(xhr: XMLHttpRequest, url?: string): void {
  if (isPresignedMediaUrl(url)) return;
  try {
    const token = getAuthToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
  } catch {
    /* storage blocked / unavailable */
  }
}

/** fetchSetup companion — same presigned-url rule as hlsAuthXhrSetup. */
export function hlsAuthFetchSetup(context: { url: string }, initParams?: RequestInit): Request {
  if (isPresignedMediaUrl(context.url)) {
    return new Request(context.url, initParams);
  }
  try {
    const token = getAuthToken();
    const headers = new Headers(initParams?.headers || {});
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return new Request(context.url, { ...initParams, headers });
  } catch {
    return new Request(context.url, initParams);
  }
}
