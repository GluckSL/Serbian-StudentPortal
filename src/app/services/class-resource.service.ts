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

  /** Save the file locally; falls back to opening in a new tab if fetch/CORS blocks the download. */
  downloadFile(fileUrl: string, originalName: string): void {
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
