import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TeacherResource {
  _id: string;
  teacherId: { _id: string; name: string; email?: string } | string;
  title: string;
  day: string;
  fileName: string;
  originalName: string;
  fileUrl: string;
  previewUrl?: string;
  mimeType?: string;
  fileSize?: number;
  uploadedAt: string;
  uploadedBy?: { _id: string; name: string };
}

@Injectable({ providedIn: 'root' })
export class TeacherResourcesService {
  private readonly baseUrl = `${environment.apiUrl}/teacher-resources`;

  constructor(private http: HttpClient) {}

  list(teacherId?: string): Observable<{ success: boolean; data: TeacherResource[] }> {
    let params = new HttpParams();
    if (teacherId) params = params.set('teacherId', teacherId);
    return this.http.get<{ success: boolean; data: TeacherResource[] }>(this.baseUrl, {
      params,
      withCredentials: true
    });
  }

  upload(payload: { teacherId: string; title: string; day: string; file: File }): Observable<any> {
    const fd = new FormData();
    fd.append('teacherId', payload.teacherId);
    fd.append('title', payload.title);
    fd.append('day', payload.day);
    fd.append('file', payload.file);
    return this.http.post(`${this.baseUrl}/upload`, fd, { withCredentials: true });
  }

  delete(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/${id}`, { withCredentials: true });
  }

  getOfficeViewerUrl(fileUrl: string): string {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
  }

  isOfficeViewerPreferred(fileName: string): boolean {
    const name = (fileName || '').toLowerCase();
    return (
      name.endsWith('.ppt') ||
      name.endsWith('.pptx') ||
      name.endsWith('.doc') ||
      name.endsWith('.docx') ||
      name.endsWith('.xls') ||
      name.endsWith('.xlsx')
    );
  }

  isDirectPreviewable(fileName: string): boolean {
    const name = (fileName || '').toLowerCase();
    return (
      name.endsWith('.pdf') ||
      name.endsWith('.png') ||
      name.endsWith('.jpg') ||
      name.endsWith('.jpeg') ||
      name.endsWith('.gif') ||
      name.endsWith('.webp') ||
      name.endsWith('.mp4') ||
      name.endsWith('.webm') ||
      name.endsWith('.mp3') ||
      name.endsWith('.wav') ||
      name.endsWith('.ogg') ||
      name.endsWith('.txt') ||
      name.endsWith('.html')
    );
  }
}
