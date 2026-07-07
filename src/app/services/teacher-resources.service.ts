import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, from, forkJoin, of, throwError } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { getAuthToken } from './auth.service';

export interface TeacherResource {
  _id: string;
  teacherId?: { _id: string; name: string; email?: string } | string;
  /** Assigned teachers (resource visible only to these). */
  teacherIds?: ({ _id: string; name: string; email?: string } | string)[];
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

/** Grouped teacher resources (same upload: title + day + teacher). */
export interface ResourceGroup {
  groupKey: string;
  title: string;
  day: string;
  batch: string;
  level: string;
  plan: string;
  resourceType: string;
  topic: string;
  description: string;
  uploadedAt: string;
  files: TeacherResource[];
  activeFileIndex: number;
}

@Injectable({ providedIn: 'root' })
export class TeacherResourcesService {
  private readonly baseUrl = `${environment.apiUrl}/teacher-resources`;
  private readonly maxFileSize = 50 * 1024 * 1024;

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
    teacherIds: string[];
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
    const tooLarge = payload.files.filter((f) => f.size > this.maxFileSize);
    if (tooLarge.length > 0) {
      return throwError(() => ({
        error: { message: `File too large (max 50 MB each): ${tooLarge.map((f) => f.name).join(', ')}` }
      }));
    }

    // Direct R2 PUT bypasses nginx client_max_body_size limits on production.
    return forkJoin(payload.files.map((file) => this.presignAndPut(file))).pipe(
      switchMap((files) =>
        this.http.post(
          `${this.baseUrl}/register-upload`,
          {
            teacherIds: payload.teacherIds,
            title: payload.title,
            day: payload.day,
            batch: payload.batch || '',
            level: payload.level || '',
            plan: payload.plan || '',
            resourceType: payload.resourceType || '',
            topic: payload.topic || '',
            description: payload.description || '',
            files
          },
          { withCredentials: true }
        )
      )
    );
  }

  update(
    id: string,
    payload: {
      teacherIds?: string[];
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
    if (payload.file) {
      if (payload.file.size > this.maxFileSize) {
        return throwError(() => ({
          error: { message: `File too large (max 50 MB): ${payload.file?.name}` }
        }));
      }

      return this.presignAndPut(payload.file).pipe(
        switchMap((uploadedFile) =>
          this.http.patch(
            `${this.baseUrl}/${id}`,
            {
              teacherIds: payload.teacherIds,
              teacherId: payload.teacherId,
              title: payload.title,
              day: payload.day,
              batch: payload.batch,
              level: payload.level,
              plan: payload.plan,
              resourceType: payload.resourceType,
              topic: payload.topic,
              description: payload.description,
              uploadedFile
            },
            { withCredentials: true }
          )
        )
      );
    }

    const fd = new FormData();
    if (payload.teacherIds !== undefined) fd.append('teacherIds', JSON.stringify(payload.teacherIds));
    else if (payload.teacherId !== undefined) fd.append('teacherId', payload.teacherId);
    if (payload.title !== undefined) fd.append('title', payload.title);
    if (payload.day !== undefined) fd.append('day', payload.day);
    if (payload.batch !== undefined) fd.append('batch', payload.batch);
    if (payload.level !== undefined) fd.append('level', payload.level);
    if (payload.plan !== undefined) fd.append('plan', payload.plan);
    if (payload.resourceType !== undefined) fd.append('resourceType', payload.resourceType);
    if (payload.topic !== undefined) fd.append('topic', payload.topic);
    if (payload.description !== undefined) fd.append('description', payload.description);
    return this.http.patch(`${this.baseUrl}/${id}`, fd, { withCredentials: true });
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
          prefix: 'teacher-resources',
        },
        { withCredentials: true }
      )
      .pipe(
        switchMap((res) => {
          const key =
            res?.key ||
            (res?.fileUrl?.includes('teacher-resources/')
              ? res.fileUrl.slice(res.fileUrl.indexOf('teacher-resources/'))
              : '');
          if (!res?.uploadUrl || !res?.fileUrl || !key) {
            return throwError(() => ({
              error: { message: res?.error || 'Failed to prepare upload' }
            }));
          }
          return from(
            fetch(res.uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': contentType },
              body: file
            }).catch(() => {
              throw new Error('Cloud storage upload failed. Check R2 CORS and try again.');
            })
          ).pipe(
            switchMap((response) => {
              if (!response.ok) {
                return throwError(() => ({
                  error: {
                    message: `Cloud storage upload failed (HTTP ${response.status}). Try again or contact support.`
                  }
                }));
              }
              return of({
                key,
                fileUrl: res.fileUrl,
                originalName: file.name,
                mimeType: contentType,
                fileSize: file.size
              });
            })
          );
        })
      );
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
      name.endsWith('.mkv') ||
      name.endsWith('.m4v') ||
      name.endsWith('.ogv') ||
      name.endsWith('.avi') ||
      name.endsWith('.mpeg') ||
      name.endsWith('.mpg') ||
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

  /** Files that must be served via the API proxy to get correct Content-Type / security headers. */
  requiresApiProxy(fileName: string): boolean {
    const name = (fileName || '').toLowerCase();
    return name.endsWith('.html') || name.endsWith('.htm');
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
      name.endsWith('.mov') ||
      name.endsWith('.mkv') ||
      name.endsWith('.m4v') ||
      name.endsWith('.ogv') ||
      name.endsWith('.avi') ||
      name.endsWith('.mpeg') ||
      name.endsWith('.mpg')
    );
  }
}
