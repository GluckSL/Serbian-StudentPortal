import { environment } from '../../environments/environment';

/**
 * Resolves stored paths like `/uploads/listening-media/x.mp3` to a full URL the browser can load.
 *
 * - When `apiUrl` is absolute (`http://localhost:4000/api`), media is loaded from that host (no `/api` prefix).
 * - When `apiUrl` is relative (`/api`), media is loaded from the **current page origin** (`/uploads/...`).
 *   In dev, add a dev-server proxy so `/uploads` forwards to the Node app.
 */
export function resolveMediaUrl(relative: string | null | undefined): string {
  if (relative == null || relative === '') return '';
  const s = String(relative).trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  const path = s.startsWith('/') ? s : `/${s}`;
  const api = environment.apiUrl || '';
  if (api.startsWith('http://') || api.startsWith('https://')) {
    const base = api.replace(/\/api\/?$/, '');
    return `${base}${path}`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}
