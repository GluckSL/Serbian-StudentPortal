import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of, throwError, forkJoin } from 'rxjs';
import { switchMap, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { getAuthToken } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ClassResourceService {
  private base = `${environment.apiUrl}/class-resources`;
  private readonly maxFileSize = 50 * 1024 * 1024;
  /** Direct R2 PUT + register — allow slow mobile networks but never hang forever. */
  private readonly uploadTimeoutMs = 10 * 60 * 1000;

  constructor(private http: HttpClient) {}

  private getToken(): string {
    return getAuthToken() || '';
  }

  list(meetingId: string): Observable<any> {
    return this.http.get(`${this.base}/${meetingId}`, { withCredentials: true });
  }

  upload(meetingId: string, files: File[]): Observable<any> {
    const tooLarge = files.filter((f) => f.size > this.maxFileSize);
    if (tooLarge.length > 0) {
      return throwError(() => ({
        error: {
          message: `File too large (max 50 MB each): ${tooLarge.map((f) => f.name).join(', ')}`
        }
      }));
    }

    // Direct R2 PUT bypasses nginx proxy timeouts on large mobile uploads.
    return forkJoin(files.map((file) => this.presignAndPut(file))).pipe(
      timeout(this.uploadTimeoutMs),
      switchMap((uploadedFiles) =>
        this.http.post(
          `${this.base}/${meetingId}/register-upload`,
          { files: uploadedFiles },
          { withCredentials: true }
        ).pipe(timeout(60_000))
      )
    );
  }

  private presignAndPut(file: File): Observable<{
    key: string;
    fileUrl: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
  }> {
    const contentType = file.type || 'application/octet-stream';
    return this.http
      .post<{
        uploadUrl: string;
        fileUrl: string;
        key?: string;
        error?: string;
      }>(
        `${environment.apiUrl}/r2/generate-upload-url`,
        {
          filename: file.name,
          contentType,
          prefix: 'class-resources',
        },
        { withCredentials: true }
      )
      .pipe(
        switchMap((res) => {
          const key =
            res?.key ||
            (res?.fileUrl?.includes('class-resources/')
              ? res.fileUrl.slice(res.fileUrl.indexOf('class-resources/'))
              : '');
          if (!res?.uploadUrl || !res?.fileUrl || !key) {
            return throwError(() => ({
              error: { message: res?.error || 'Failed to prepare upload' }
            }));
          }

          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), this.uploadTimeoutMs);

          return from(
            fetch(res.uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': contentType },
              body: file,
              signal: controller.signal,
            }).finally(() => window.clearTimeout(timer))
          ).pipe(
            switchMap((response) => {
              if (!response.ok) {
                return throwError(() => ({
                  error: {
                    message: `Cloud storage upload failed (HTTP ${response.status}). Try again on Wi‑Fi or use a smaller file.`
                  }
                }));
              }
              return of({
                key,
                fileUrl: res.fileUrl,
                originalName: file.name,
                mimeType: contentType,
                fileSize: file.size,
              });
            })
          );
        }),
        timeout(this.uploadTimeoutMs)
      );
  }

  delete(resourceId: string): Observable<any> {
    return this.http.delete(`${this.base}/${resourceId}`, { withCredentials: true });
  }

  getViewUrl(resourceId: string): Observable<any> {
    return this.http.get<{ success?: boolean; url?: string; mode?: string }>(
      `${this.base}/view/${resourceId}`,
      { withCredentials: true }
    );
  }

  viewClassResource(r: { _id?: string; fileUrl?: string; originalName?: string; mimeType?: string }): void {
    const id = r._id != null ? String(r._id) : '';
    const fallbackUrl = r.fileUrl || '';
    if (id) {
      this.http
        .get<{ success?: boolean; url?: string; mode?: 'inline' | 'download' }>(
          `${this.base}/view/${id}`,
          { withCredentials: true }
        )
        .subscribe({
          next: (res) => {
            if (!res?.url) {
              this.viewFallback(fallbackUrl, r.originalName, r.mimeType, id);
              return;
            }
            if (res.mode === 'download') {
              this.triggerServerDownload(id);
              return;
            }
            this.openInBrowser(res.url);
          },
          error: () => this.viewFallback(fallbackUrl, r.originalName, r.mimeType, id)
        });
      return;
    }
    this.viewFallback(fallbackUrl, r.originalName, r.mimeType, '');
  }

  private viewFallback(fileUrl: string, originalName?: string, mimeType?: string, resourceId?: string): void {
    if (!fileUrl) return;
    if (this.shouldDownloadInsteadOfView(originalName, mimeType)) {
      if (resourceId) {
        this.triggerServerDownload(resourceId);
        return;
      }
      this.downloadViaFetchOrOpen(fileUrl, originalName || 'download');
      return;
    }
    this.openInBrowser(fileUrl);
  }

  private shouldDownloadInsteadOfView(originalName?: string, mimeType?: string): boolean {
    const name = (originalName || '').toLowerCase();
    const type = (mimeType || '').toLowerCase();
    if (/\.(zip|docx?|pptx?|xlsx?|rar|7z)$/i.test(name)) return true;
    if (
      type.includes('zip') ||
      type.includes('wordprocessingml') ||
      type.includes('spreadsheetml') ||
      type.includes('presentationml') ||
      type === 'application/msword' ||
      type === 'application/xml' ||
      type === 'text/xml'
    ) {
      return true;
    }
    return false;
  }

  downloadClassResource(r: { _id?: string; fileUrl?: string; originalName?: string }): void {
    const id = r._id != null ? String(r._id) : '';
    const fallbackUrl = r.fileUrl || '';
    const name = (r.originalName || 'download').trim() || 'download';
    if (id) {
      this.triggerServerDownload(id);
      return;
    }
    this.downloadViaFetchOrOpen(fallbackUrl, name);
  }

  private triggerServerDownload(resourceId: string): void {
    const token = encodeURIComponent(this.getToken());
    const url = `${this.base}/download/${resourceId}?token=${token}`;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'display:none;width:0;height:0;border:none;position:fixed';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = url;
    document.body.appendChild(iframe);
    window.setTimeout(() => {
      try {
        iframe.remove();
      } catch {
        /* noop */
      }
    }, 300000);
  }

  private downloadViaFetchOrOpen(fileUrl: string, originalName: string): void {
    if (!fileUrl) return;
    const name = originalName?.trim() || 'download';
    fetch(fileUrl)
      .then((res) => {
        if (!res.ok) throw new Error('fetch failed');
        return res.blob();
      })
      .then((blob) => {
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = name;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
      })
      .catch(() => this.openInBrowser(fileUrl));
  }

  private openInBrowser(fileUrl: string): void {
    if (!fileUrl) return;
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  }
}
