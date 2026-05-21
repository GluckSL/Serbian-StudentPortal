import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

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

  constructor(private http: HttpClient) {}

  // ─── Templates ────────────────────────────────────────────────────────────

  getTemplates(): Observable<{ success: boolean; templates: AgreementTemplate[] }> {
    return this.http.get<any>(`${this.base}/templates`);
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
    return this.http.post<any>(`${this.base}/templates/${templateId}/upload-docx`, fd);
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
    return this.http.put<any>(`${this.base}/templates/${id}/fields`, { fields });
  }

  getTemplatePreviewUrl(id: string): Observable<{ success: boolean; url: string }> {
    return this.http.get<any>(`${this.base}/templates/${id}/preview`);
  }

  deleteTemplate(id: string, options?: { soft?: boolean; cascade?: boolean }): Observable<{ success: boolean; message?: string }> {
    let params = new HttpParams();
    if (options?.soft) params = params.set('soft', 'true');
    if (options?.cascade) params = params.set('cascade', 'true');
    return this.http.delete<{ success: boolean; message?: string }>(`${this.base}/templates/${id}`, { params });
  }

  // ─── Instances ────────────────────────────────────────────────────────────

  previewInstance(templateId: string, fieldValues: Record<string, string>): Observable<Blob> {
    return this.http.post(`${this.base}/instances/preview`, { templateId, fieldValues }, { responseType: 'blob' });
  }

  shareInstance(payload: {
    templateId: string;
    studentId: string;
    fieldValues: Record<string, string>;
    displayName: string;
    sendEmail?: boolean;
  }): Observable<{ success: boolean; agreement: StudentAgreement; downloadUrl: string }> {
    return this.http.post<any>(`${this.base}/instances/share`, payload);
  }

  getInstances(studentId?: string): Observable<{ success: boolean; agreements: StudentAgreement[] }> {
    const params = studentId ? `?studentId=${studentId}` : '';
    return this.http.get<any>(`${this.base}/instances${params}`);
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
    return this.http.post<any>(`${this.base}/instances/${id}/upload-signed`, fd);
  }

  verifyInstance(
    id: string,
    status: 'VERIFIED' | 'REJECTED',
    notes?: string
  ): Observable<{ success: boolean; message?: string; emailSent?: boolean }> {
    return this.http.put<any>(`${this.base}/instances/${id}/verify`, { status, notes: notes || '' });
  }
}
