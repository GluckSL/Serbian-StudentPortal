import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
  fontSize?: number;
  required?: boolean;
}

export interface AgreementTemplate {
  _id: string;
  name: string;
  slug: string;
  description: string;
  r2Key: string;
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

  uploadTemplatePdf(file: File): Observable<{ success: boolean; tempId: string; r2Key: string; pageCount: number; conversion?: string }> {
    const fd = new FormData();
    fd.append('pdf', file);
    return this.http.post<any>(`${this.base}/templates/upload`, fd);
  }

  createTemplate(payload: { name: string; description?: string; r2Key: string; pageCount: number; tempId: string }): Observable<{ success: boolean; template: AgreementTemplate }> {
    return this.http.post<any>(`${this.base}/templates`, payload);
  }

  detectRedFields(id: string): Observable<{ success: boolean; fields: DynamicField[]; count: number }> {
    return this.http.post<any>(`${this.base}/templates/${id}/detect-red-fields`, {});
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

  deleteTemplate(id: string): Observable<{ success: boolean }> {
    return this.http.delete<any>(`${this.base}/templates/${id}`);
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

  uploadSigned(id: string, file: File): Observable<{ success: boolean }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<any>(`${this.base}/instances/${id}/upload-signed`, fd);
  }

  verifyInstance(id: string, status: 'VERIFIED' | 'REJECTED', notes?: string): Observable<{ success: boolean }> {
    return this.http.put<any>(`${this.base}/instances/${id}/verify`, { status, notes: notes || '' });
  }
}
