import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpEventType, HttpParams } from '@angular/common/http';
import { concat, Observable, of } from 'rxjs';
import { filter, finalize, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export type TemplateUploadProgressEvent =
  | { kind: 'progress'; percent: number; loaded: number; total: number | null; phase: 'upload' }
  | { kind: 'processing'; percent: number; phase: 'processing'; message: string }
  | {
      kind: 'complete';
      body: {
        success: boolean;
        template: AgreementTemplate;
        tempId: string;
        r2Key: string | null;
        docxR2Key?: string;
        fillMode?: 'docx' | 'overlay';
        pageCount: number;
        conversion?: string;
        warning?: string;
      };
    };

export interface DynamicField {
  id: string;
  label: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sampleText?: string;
  placeholderToken?: string;
  fontSize?: number;
  required?: boolean;
  source?: string;
}

export interface AgreementTemplate {
  _id: string;
  name: string;
  slug: string;
  description: string;
  r2Key: string;
  docxR2Key?: string;
  fillMode?: 'docx' | 'overlay';
  pageCount: number;
  dynamicFields: DynamicField[];
  aiSuggestions?: any[];
  isActive: boolean;
  createdAt: string;
}

export interface AiSuggestion {
  id: string;
  label: string;
  page: number;
  sampleText: string;
  confidence: string;
}

export interface StudentAgreement {
  _id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  templateId: string | AgreementTemplate;
  templateName: string;
  displayName: string;
  fieldValues: Record<string, string>;
  generatedFile?: { s3Key: string; fileName: string; fileSize: number };
  signedFile?: { s3Key: string; fileName: string; fileSize: number };
  studentDocumentId?: string;
  status: 'SENT' | 'SIGNED_PENDING' | 'VERIFIED' | 'REJECTED';
  verificationNotes?: string;
  sentAt: string;
  verifiedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class AgreementService {
  private base = `${environment.apiUrl}/agreements`;
  private templatesListCache: AgreementTemplate[] | null = null;
  private templatesListCachedAt = 0;
  private readonly templatesListCacheMs = 45_000;
  private readonly instancesCache = new Map<string, {
    value?: { success: boolean; agreements: StudentAgreement[] };
    updatedAt: number;
    inflight$?: Observable<{ success: boolean; agreements: StudentAgreement[] }>;
  }>();
  private readonly instancesCacheMs = 45_000;

  constructor(private http: HttpClient) {}

  invalidateTemplatesCache(): void {
    this.templatesListCache = null;
    this.templatesListCachedAt = 0;
  }

  /** Warm list for instant paint when navigating back within the cache window. */
  peekTemplatesList(): AgreementTemplate[] | null {
    if (
      this.templatesListCache &&
      Date.now() - this.templatesListCachedAt < this.templatesListCacheMs
    ) {
      return this.templatesListCache;
    }
    return null;
  }

  // ─── Templates ────────────────────────────────────────────────────────────

  /**
   * @param options.summary — lean list payload (id/label only per field); use getTemplate() before edit.
   * @param options.force — bypass in-memory cache.
   */
  getTemplates(options?: {
    force?: boolean;
    summary?: boolean;
  }): Observable<{ success: boolean; templates: AgreementTemplate[] }> {
    const summary = options?.summary !== false;
    const cacheKey = summary ? 'summary' : 'full';
    const now = Date.now();
    if (
      !options?.force &&
      cacheKey === 'summary' &&
      this.templatesListCache &&
      now - this.templatesListCachedAt < this.templatesListCacheMs
    ) {
      return of({ success: true, templates: this.templatesListCache });
    }
    let params = new HttpParams();
    if (summary) params = params.set('summary', '1');
    return this.http.get<any>(`${this.base}/templates`, { params }).pipe(
      tap((r) => {
        if (summary && r?.templates) {
          this.templatesListCache = r.templates;
          this.templatesListCachedAt = Date.now();
        }
      })
    );
  }

  getTemplate(id: string): Observable<{ success: boolean; template: AgreementTemplate }> {
    return this.http.get<any>(`${this.base}/templates/${id}`);
  }

  /** Attach .docx source to an existing template (enables real text fill). */
  uploadTemplateDocx(templateId: string, file: File): Observable<{
    success: boolean;
    template: AgreementTemplate;
    fillMode: 'docx';
    fields?: DynamicField[];
    source?: string;
    message?: string;
    warning?: string;
  }> {
    const fd = new FormData();
    fd.append('docx', file);
    return this.http.post<any>(`${this.base}/templates/${templateId}/upload-docx`, fd).pipe(
      tap(() => this.invalidateTemplatesCache())
    );
  }

  uploadTemplatePdf(file: File): Observable<{
    success: boolean;
    tempId: string;
    r2Key: string | null;
    docxR2Key?: string;
    fillMode?: 'docx' | 'overlay';
    pageCount: number;
    conversion?: string;
    warning?: string;
  }> {
    const fd = new FormData();
    fd.append('pdf', file);
    return this.http.post<any>(`${this.base}/templates/upload`, fd);
  }

  /**
   * Single request: upload file + create template (faster than upload then create).
   * Reports byte upload progress, then processing phase until the server responds.
   */
  uploadAndCreateTemplate(
    file: File,
    name: string,
    description?: string
  ): Observable<TemplateUploadProgressEvent> {
    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('name', name.trim());
    if (description?.trim()) fd.append('description', description.trim());

    let uploadDone = false;

    return this.http
      .post<any>(`${this.base}/templates/upload-and-create`, fd, {
        reportProgress: true,
        observe: 'events'
      })
      .pipe(
        map((event: HttpEvent<any>): TemplateUploadProgressEvent | null => {
          if (event.type === HttpEventType.UploadProgress) {
            const loaded = event.loaded ?? 0;
            const total = event.total ?? null;
            const raw = total && total > 0 ? Math.round((100 * loaded) / total) : 0;
            const percent = Math.min(55, Math.round(raw * 0.55));
            if (loaded > 0 && total && loaded >= total) uploadDone = true;
            return { kind: 'progress', percent, loaded, total, phase: 'upload' };
          }
          if (event.type === HttpEventType.Response && event.body) {
            return { kind: 'complete', body: event.body };
          }
          if (uploadDone && event.type === HttpEventType.Sent) {
            return {
              kind: 'processing',
              percent: 60,
              phase: 'processing',
              message: 'Converting and saving…'
            };
          }
          return null;
        }),
        filter((e): e is TemplateUploadProgressEvent => e != null)
      );
  }

  createTemplate(payload: {
    name: string;
    description?: string;
    r2Key: string;
    docxR2Key?: string;
    fillMode?: string;
    pageCount: number;
    tempId: string;
  }): Observable<{ success: boolean; template: AgreementTemplate }> {
    return this.http.post<any>(`${this.base}/templates`, payload);
  }

  detectRedFields(id: string): Observable<{ success: boolean; fields: DynamicField[]; count: number; source?: string }> {
    return this.http.post<any>(`${this.base}/templates/${id}/detect-red-fields`, {});
  }

  /** Prefer {{fieldName}} markers in the document. */
  detectPlaceholders(id: string): Observable<{ success: boolean; fields: DynamicField[]; count: number; source?: string }> {
    return this.http.post<any>(`${this.base}/templates/${id}/detect-placeholders`, {});
  }

  locateTextInTemplate(id: string, sampleText: string): Observable<{ success: boolean; field: Partial<DynamicField> }> {
    return this.http.post<any>(`${this.base}/templates/${id}/locate-text`, { sampleText });
  }

  analyzeTemplate(id: string): Observable<{ success: boolean; suggestions: AiSuggestion[]; fields?: DynamicField[]; source?: string }> {
    return this.http.post<any>(`${this.base}/templates/${id}/analyze`, {});
  }

  saveFields(id: string, fields: DynamicField[]): Observable<{ success: boolean; template: AgreementTemplate }> {
    return this.http.put<any>(`${this.base}/templates/${id}/fields`, { fields }).pipe(
      tap(() => this.invalidateTemplatesCache())
    );
  }

  getTemplatePreviewUrl(id: string): Observable<{ success: boolean; url: string }> {
    return this.http.get<any>(`${this.base}/templates/${id}/preview`);
  }

  deleteTemplate(id: string, options?: { soft?: boolean; cascade?: boolean }): Observable<{ success: boolean; message?: string }> {
    let params = new HttpParams();
    if (options?.soft) params = params.set('soft', 'true');
    if (options?.cascade) params = params.set('cascade', 'true');
    return this.http
      .delete<{ success: boolean; message?: string }>(`${this.base}/templates/${id}`, { params })
      .pipe(tap(() => this.invalidateTemplatesCache()));
  }

  // ─── Instances ────────────────────────────────────────────────────────────

  previewInstance(templateId: string, fieldValues: Record<string, string>): Observable<Blob> {
    return this.http.post(`${this.base}/instances/preview`, { templateId, fieldValues }, { responseType: 'blob' });
  }

  shareInstance(payload: {
    templateId: string;
    studentId: string;
    studentEmail?: string;
    fieldValues: Record<string, string>;
    displayName: string;
    sendEmail?: boolean;
  }): Observable<{ success: boolean; agreement: StudentAgreement; downloadUrl: string; message?: string }> {
    return this.http.post<any>(`${this.base}/instances/share`, payload).pipe(
      tap(() => this.invalidateInstancesCache())
    );
  }

  getInstances(
    studentId?: string,
    options?: { summary?: boolean; force?: boolean; staleMs?: number }
  ): Observable<{ success: boolean; agreements: StudentAgreement[] }> {
    let params = new HttpParams();
    if (studentId) params = params.set('studentId', studentId);
    if (options?.summary) params = params.set('summary', '1');

    const cacheKey = JSON.stringify({
      studentId: studentId || 'self',
      summary: !!options?.summary
    });
    const staleMs = options?.staleMs ?? this.instancesCacheMs;
    const cached = this.instancesCache.get(cacheKey);
    const now = Date.now();

    if (!options?.force && cached?.value && now - cached.updatedAt < staleMs) {
      return of(cached.value);
    }

    if (!options?.force && cached?.value) {
      return concat(of(cached.value), this.fetchInstances(cacheKey, params));
    }

    return this.fetchInstances(cacheKey, params);
  }

  invalidateInstancesCache(studentId?: string): void {
    if (!studentId) {
      this.instancesCache.clear();
      return;
    }
    for (const key of this.instancesCache.keys()) {
      if (key.includes(`"studentId":"${studentId}"`)) {
        this.instancesCache.delete(key);
      }
    }
  }

  getDownloadUrl(id: string, type: 'generated' | 'signed' = 'generated'): string {
    return `${this.base}/instances/${id}/download?type=${type}`;
  }

  /** Download agreement PDF with auth (for student download button). */
  downloadInstance(id: string, type: 'generated' | 'signed' = 'generated'): Observable<Blob> {
    return this.http.get(`${this.base}/instances/${id}/download`, {
      params: { type },
      responseType: 'blob'
    });
  }

  uploadSigned(id: string, file: File): Observable<{ success: boolean; message?: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<any>(`${this.base}/instances/${id}/upload-signed`, fd).pipe(
      tap(() => this.invalidateInstancesCache())
    );
  }

  verifyInstance(
    id: string,
    status: 'VERIFIED' | 'REJECTED',
    notes?: string
  ): Observable<{ success: boolean; message?: string; emailSent?: boolean }> {
    return this.http.put<any>(`${this.base}/instances/${id}/verify`, { status, notes: notes || '' }).pipe(
      tap(() => this.invalidateInstancesCache())
    );
  }

  private fetchInstances(
    cacheKey: string,
    params: HttpParams
  ): Observable<{ success: boolean; agreements: StudentAgreement[] }> {
    const cached = this.instancesCache.get(cacheKey);
    if (cached?.inflight$) {
      return cached.inflight$;
    }

    const request$ = this.http
      .get<{ success: boolean; agreements: StudentAgreement[] }>(`${this.base}/instances`, { params })
      .pipe(
        tap((response) => {
          this.instancesCache.set(cacheKey, {
            value: response,
            updatedAt: Date.now()
          });
        }),
        finalize(() => {
          const latest = this.instancesCache.get(cacheKey);
          if (latest?.inflight$) {
            this.instancesCache.set(cacheKey, {
              value: latest.value,
              updatedAt: latest.updatedAt
            });
          }
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );

    this.instancesCache.set(cacheKey, {
      value: cached?.value,
      updatedAt: cached?.updatedAt || 0,
      inflight$: request$
    });

    return request$;
  }
}
