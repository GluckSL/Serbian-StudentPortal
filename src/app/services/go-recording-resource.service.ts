import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type GoRecordingResourceType = 'manual' | 'zoom';

@Injectable({ providedIn: 'root' })
export class GoRecordingResourceService {
  private base = `${environment.apiUrl}/go-recording-resources`;

  constructor(private http: HttpClient) {}

  list(recordingType: GoRecordingResourceType, recordingId: string): Observable<any> {
    return this.http.get(`${this.base}/${recordingType}/${recordingId}`, { withCredentials: true });
  }

  upload(recordingType: GoRecordingResourceType, recordingId: string, files: File[]): Observable<any> {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    return this.http.post(`${this.base}/${recordingType}/${recordingId}/upload`, fd, { withCredentials: true });
  }

  delete(resourceId: string): Observable<any> {
    return this.http.delete(`${this.base}/${resourceId}`, { withCredentials: true });
  }

  openInBrowser(fileUrl: string): void {
    if (!fileUrl) return;
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  }

  downloadResource(r: { _id?: string; fileUrl?: string; originalName?: string }): void {
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
