import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TeacherResource {
  _id: string;
  teacherId: { _id: string; name: string; email?: string } | string;
  title: string;
  day: string;
  batch?: string;
  level?: string;
  plan?: string;
  resourceType?: string;
  topic?: string;
  description?: string;
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

  list(filters?: { teacherId?: string; batch?: string; level?: string; plan?: string }): Observable<{ success: boolean; data: TeacherResource[] }> {
    let params = new HttpParams();
    if (filters?.teacherId) params = params.set('teacherId', filters.teacherId);
    if (filters?.batch) params = params.set('batch', filters.batch);
    if (filters?.level) params = params.set('level', filters.level);
    if (filters?.plan) params = params.set('plan', filters.plan);
    return this.http.get<{ success: boolean; data: TeacherResource[] }>(this.baseUrl, {
      params,
      withCredentials: true
    });
  }

  upload(payload: {
    teacherId: string;
    title: string;
    day: string;
    batch?: string;
    level?: string;
    plan?: string;
    resourceType?: string;
    topic?: string;
    description?: string;
    file: File;
  }): Observable<any> {
    const fd = new FormData();
    fd.append('teacherId', payload.teacherId);
    fd.append('title', payload.title);
    fd.append('day', payload.day);
    fd.append('batch', payload.batch || '');
    fd.append('level', payload.level || '');
    fd.append('plan', payload.plan || '');
    fd.append('resourceType', payload.resourceType || '');
    fd.append('topic', payload.topic || '');
    fd.append('description', payload.description || '');
    fd.append('file', payload.file);
    return this.http.post(`${this.baseUrl}/upload`, fd, { withCredentials: true });
  }

  delete(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/${id}`, { withCredentials: true });
  }

  getSecurePreviewUrl(resourceId: string): string {
    return `${this.baseUrl}/${resourceId}/preview`;
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
