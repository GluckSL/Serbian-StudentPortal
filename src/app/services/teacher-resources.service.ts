import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { getAuthToken } from './auth.service';

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

  list(filters?: { teacherId?: string; batch?: string; level?: string; plan?: string }): Observable<{
    success: boolean;
    data: TeacherResource[];
    filters?: { batches?: string[]; levels?: string[]; plans?: string[] };
  }> {
    let params = new HttpParams();
    if (filters?.teacherId) params = params.set('teacherId', filters.teacherId);
    if (filters?.batch) params = params.set('batch', filters.batch);
    if (filters?.level) params = params.set('level', filters.level);
    if (filters?.plan) params = params.set('plan', filters.plan);
    return this.http.get<{
      success: boolean;
      data: TeacherResource[];
      filters?: { batches?: string[]; levels?: string[]; plans?: string[] };
    }>(this.baseUrl, {
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
    files: File[];
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
    for (const f of payload.files) {
      fd.append('files', f);
    }
    return this.http.post(`${this.baseUrl}/upload`, fd, { withCredentials: true });
  }

  update(
    id: string,
    payload: {
      teacherId?: string;
      title?: string;
      day?: string;
      batch?: string;
      level?: string;
      plan?: string;
      resourceType?: string;
      topic?: string;
      description?: string;
      file?: File | null;
    }
  ): Observable<any> {
    const fd = new FormData();
    if (payload.teacherId !== undefined) fd.append('teacherId', payload.teacherId);
    if (payload.title !== undefined) fd.append('title', payload.title);
    if (payload.day !== undefined) fd.append('day', payload.day);
    if (payload.batch !== undefined) fd.append('batch', payload.batch);
    if (payload.level !== undefined) fd.append('level', payload.level);
    if (payload.plan !== undefined) fd.append('plan', payload.plan);
    if (payload.resourceType !== undefined) fd.append('resourceType', payload.resourceType);
    if (payload.topic !== undefined) fd.append('topic', payload.topic);
    if (payload.description !== undefined) fd.append('description', payload.description);
    if (payload.file) fd.append('file', payload.file);
    return this.http.patch(`${this.baseUrl}/${id}`, fd, { withCredentials: true });
  }

  delete(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/${id}`, { withCredentials: true });
  }

  getSecurePreviewUrl(resourceId: string): string {
    const token = getAuthToken();
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${this.baseUrl}/${resourceId}/preview${tokenParam}`;
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
      name.endsWith('.svg') ||
      name.endsWith('.mp4') ||
      name.endsWith('.webm') ||
      name.endsWith('.mov') ||
      name.endsWith('.mp3') ||
      name.endsWith('.wav') ||
      name.endsWith('.ogg') ||
      name.endsWith('.aac') ||
      name.endsWith('.m4a') ||
      name.endsWith('.flac') ||
      name.endsWith('.opus') ||
      name.endsWith('.txt') ||
      name.endsWith('.html') ||
      name.endsWith('.htm')
    );
  }

  isAudioFile(fileName: string): boolean {
    const name = (fileName || '').toLowerCase();
    return (
      name.endsWith('.mp3') ||
      name.endsWith('.wav') ||
      name.endsWith('.ogg') ||
      name.endsWith('.aac') ||
      name.endsWith('.m4a') ||
      name.endsWith('.flac') ||
      name.endsWith('.opus')
    );
  }

  isVideoFile(fileName: string): boolean {
    const name = (fileName || '').toLowerCase();
    return (
      name.endsWith('.mp4') ||
      name.endsWith('.webm') ||
      name.endsWith('.mov')
    );
  }
}
