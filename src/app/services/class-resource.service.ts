import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ClassResourceService {
  private base = `${environment.apiUrl}/class-resources`;

  constructor(private http: HttpClient) {}

  list(meetingId: string): Observable<any> {
    return this.http.get(`${this.base}/${meetingId}`, { withCredentials: true });
  }

  upload(meetingId: string, files: File[]): Observable<any> {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    return this.http.post(`${this.base}/${meetingId}/upload`, fd, { withCredentials: true });
  }

  delete(resourceId: string): Observable<any> {
    return this.http.delete(`${this.base}/${resourceId}`, { withCredentials: true });
  }

  /** Open the resource URL in a new tab (inline preview when the browser supports it). */
  openInBrowser(fileUrl: string): void {
    if (!fileUrl) return;
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  }

  /**
   * View a class resource. Uses API presigned URL with correct Content-Type.
   * ZIP/Office files trigger download instead of opening raw XML in the browser.
   */
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
              this.viewFallback(fallbackUrl, r.originalName, r.mimeType);
              return;
            }
            if (res.mode === 'download') {
              this.triggerAttachmentDownload(res.url);
              return;
            }
            this.openInBrowser(res.url);
          },
          error: () => this.viewFallback(fallbackUrl, r.originalName, r.mimeType)
        });
      return;
    }
    this.viewFallback(fallbackUrl, r.originalName, r.mimeType);
  }

  private viewFallback(fileUrl: string, originalName?: string, mimeType?: string): void {
    if (!fileUrl) return;
    if (this.shouldDownloadInsteadOfView(originalName, mimeType)) {
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

  /**
   * Download a class resource. Uses API + S3 presigned URL with Content-Disposition: attachment
   * so the browser saves the file (avoids cross-origin fetch to S3, which usually fails without CORS).
   */
  downloadClassResource(r: { _id?: string; fileUrl?: string; originalName?: string }): void {
    const name = (r.originalName || 'download').trim() || 'download';
    const id = r._id != null ? String(r._id) : '';
    const fallbackUrl = r.fileUrl || '';
    if (id) {
      this.http
        .get<{ success?: boolean; url?: string }>(`${this.base}/download/${id}`, { withCredentials: true })
        .subscribe({
          next: (res) => {
            if (res?.url) {
              this.triggerAttachmentDownload(res.url);
              return;
            }
            this.downloadViaFetchOrOpen(fallbackUrl, name);
          },
          error: () => this.downloadViaFetchOrOpen(fallbackUrl, name)
        });
      return;
    }
    this.downloadViaFetchOrOpen(fallbackUrl, name);
  }

  /** Load URL in a hidden iframe — works with S3 responses that send Content-Disposition: attachment. */
  private triggerAttachmentDownload(url: string): void {
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

  /** Last resort when no resource id or API fails: blob download if CORS allows, else open tab. */
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
}
