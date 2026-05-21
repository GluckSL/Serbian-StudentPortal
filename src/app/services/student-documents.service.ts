// src/app/services/student-documents.service.ts
// Service for student document management

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DocumentRequirement {
  id: string;
  type: string;
  name: string;
  label: string;
  required: boolean;
  isRequired: boolean;
  description: string;
  category?: string;
  allowMultiple: boolean;
}

export interface StudentDocument {
  _id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  documentType: string;
  documentTypeId: string;
  documentName: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  formattedFileSize: string;
  mimeType: string;
  description: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verifiedBy?: string;
  verifiedAt?: Date;
  verificationNotes?: string;
  remarks?: string;
  version?: number;
  isCurrent?: boolean;
  documentCategory?: string;
  uploadedAt: Date;
  updatedAt: Date;
  documentTypeDisplay: string;
}

export interface DocumentStats {
  totalDocuments: number;
  verifiedDocuments: number;
  pendingDocuments: number;
  rejectedDocuments: number;
  requiredDocumentsUploaded: number;
  totalRequiredDocuments: number;
  completionPercentage: number;
}

@Injectable({
  providedIn: 'root'
})
export class StudentDocumentsService {
  private apiUrl = `${environment.apiUrl}/student-documents`;

  constructor(private http: HttpClient) {}

  private getAuthToken(): string {
    try {
      return (
        localStorage.getItem('authToken') ||
        localStorage.getItem('token') ||
        localStorage.getItem('jwtToken') ||
        ''
      );
    } catch {
      return '';
    }
  }

  // Get student's documents
  getMyDocuments(): Observable<{
    success: boolean;
    documents: StudentDocument[];
    totalDocuments: number;
  }> {
    return this.http.get<{
      success: boolean;
      documents: StudentDocument[];
      totalDocuments: number;
    }>(`${this.apiUrl}/my-documents`, { withCredentials: true });
  }

  // Upload a document
  uploadDocument(formData: FormData): Observable<{
    success: boolean;
    message: string;
    document: StudentDocument;
  }> {
    return this.http.post<{
      success: boolean;
      message: string;
      document: StudentDocument;
    }>(`${this.apiUrl}/upload`, formData, { withCredentials: true });
  }

  // Replace an existing document with a new version
  replaceDocument(documentId: string, file: File): Observable<{
    success: boolean;
    message: string;
    document: StudentDocument;
  }> {
    const formData = new FormData();
    formData.append('document', file);
    return this.http.post<{
      success: boolean;
      message: string;
      document: StudentDocument;
    }>(`${this.apiUrl}/admin/replace/${documentId}`, formData, { withCredentials: true });
  }

  // Delete a document
  deleteDocument(documentId: string): Observable<{
    success: boolean;
    message: string;
  }> {
    return this.http.delete<{
      success: boolean;
      message: string;
    }>(`${this.apiUrl}/${documentId}`, { withCredentials: true });
  }

  // Download a document
  downloadDocument(documentId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/download/${documentId}`, {
      responseType: 'blob',
      withCredentials: true
    });
  }

  // Download by browser navigation to avoid XHR/CORS false errors on S3 redirects
  triggerServerDownload(documentId: string): void {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    const token = encodeURIComponent(this.getAuthToken());
    const baseUrl = `${this.apiUrl}/download/${encodeURIComponent(documentId)}`;
    iframe.src = token ? `${baseUrl}?token=${token}` : baseUrl;
    document.body.appendChild(iframe);
    setTimeout(() => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }, 30000);
  }

  // Preview a document inline
  getPreviewUrl(documentId: string): string {
    const token = encodeURIComponent(this.getAuthToken());
    const baseUrl = `${this.apiUrl}/preview/${encodeURIComponent(documentId)}`;
    return token ? `${baseUrl}?token=${token}` : baseUrl;
  }

  // Preview a document as blob (sends auth cookie)
  previewDocument(documentId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/preview/${documentId}`, {
      responseType: 'blob',
      withCredentials: true
    });
  }

  // Get document requirements for the logged-in student (filtered by their servicesOpted)
  getStudentRequirements(): Observable<{
    success: boolean;
    requirements: DocumentRequirement[];
  }> {
    return this.http.get<{
      success: boolean;
      requirements: DocumentRequirement[];
    }>(`${this.apiUrl}/requirements`, { withCredentials: true });
  }

  // Get document statistics
  getDocumentStats(): Observable<{
    success: boolean;
    stats: DocumentStats;
  }> {
    return this.http.get<{
      success: boolean;
      stats: DocumentStats;
    }>(`${this.apiUrl}/stats`, { withCredentials: true });
  }

  // Helper method to trigger file download
  triggerFileDownload(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  // Get status badge class
  getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'VERIFIED':
        return 'bg-success';
      case 'REJECTED':
        return 'bg-danger';
      case 'PENDING':
      default:
        return 'bg-warning';
    }
  }

  // Get status icon
  getStatusIcon(status: string): string {
    switch (status) {
      case 'VERIFIED':
        return 'fa-check-circle';
      case 'REJECTED':
        return 'fa-times-circle';
      case 'PENDING':
      default:
        return 'fa-clock';
    }
  }

  // Get file icon based on mime type
  getFileIcon(mimeType: string): string {
    if (mimeType.includes('pdf')) return 'fa-file-pdf text-danger';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'fa-file-word text-primary';
    if (mimeType.includes('image')) return 'fa-file-image text-success';
    return 'fa-file text-secondary';
  }

  // ========== ADMIN METHODS ==========

  // Get all documents (Admin/Teacher only)
  getAllDocuments(filters?: {
    studentId?: string;
    status?: string;
    documentType?: string;
  }): Observable<{
    success: boolean;
    documents: StudentDocument[];
    totalDocuments: number;
  }> {
    let url = `${this.apiUrl}/admin/all`;
    const params: string[] = [];
    
    if (filters) {
      if (filters.studentId) params.push(`studentId=${filters.studentId}`);
      if (filters.status) params.push(`status=${filters.status}`);
      if (filters.documentType) params.push(`documentType=${filters.documentType}`);
    }
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }
    
    return this.http.get<{
      success: boolean;
      documents: StudentDocument[];
      totalDocuments: number;
    }>(url, { withCredentials: true });
  }

  // Verify or reject a document (Admin/Teacher only)
  verifyDocument(
    documentId: string,
    status: 'PENDING' | 'VERIFIED' | 'REJECTED',
    verificationNotes?: string
  ): Observable<{
    success: boolean;
    message: string;
    document: StudentDocument;
    emailSent?: boolean;
  }> {
    return this.http.put<{
      success: boolean;
      message: string;
      document: StudentDocument;
    }>(`${this.apiUrl}/admin/verify/${documentId}`, {
      status,
      verificationNotes: verificationNotes || ''
    }, { withCredentials: true });
  }
  
  // ========== DOCUMENT REQUIREMENTS MANAGEMENT ==========
  
  // Get all document requirements
  getDocumentRequirements(): Observable<{
    success: boolean;
    requirements: any[];
  }> {
    return this.http.get<{
      success: boolean;
      requirements: any[];
    }>(`${environment.apiUrl}/document-requirements`, { withCredentials: true });
  }
  
  // Create new document requirement (Admin only)
  createDocumentRequirement(requirement: any): Observable<{
    success: boolean;
    message: string;
    requirement: any;
  }> {
    return this.http.post<{
      success: boolean;
      message: string;
      requirement: any;
    }>(`${environment.apiUrl}/document-requirements`, requirement, { withCredentials: true });
  }
  
  // Update document requirement (Admin only)
  updateDocumentRequirement(id: string, requirement: any): Observable<{
    success: boolean;
    message: string;
    requirement: any;
  }> {
    return this.http.put<{
      success: boolean;
      message: string;
      requirement: any;
    }>(`${environment.apiUrl}/document-requirements/${id}`, requirement, { withCredentials: true });
  }
  
  // Delete document requirement (Admin only)
  deleteDocumentRequirement(id: string): Observable<{
    success: boolean;
    message: string;
  }> {
    return this.http.delete<{
      success: boolean;
      message: string;
    }>(`${environment.apiUrl}/document-requirements/${id}`, { withCredentials: true });
  }
  
  // Seed default requirements (Admin only)
  seedDocumentRequirements(): Observable<{
    success: boolean;
    message: string;
    created: number;
    skipped: number;
  }> {
    return this.http.post<{
      success: boolean;
      message: string;
      created: number;
      skipped: number;
    }>(`${environment.apiUrl}/document-requirements/seed`, {}, { withCredentials: true });
  }
  
  // ========== BULK OPERATIONS ==========
  
  // Get all students (Admin only)
  getAllStudents(params?: { page?: number; limit?: number }): Observable<{
    success: boolean;
    data: any[];
    pagination?: { total: number; page: number; limit: number; pages: number };
  }> {
    const q: string[] = [];
    if (params?.page) q.push(`page=${encodeURIComponent(String(params.page))}`);
    if (params?.limit) q.push(`limit=${encodeURIComponent(String(params.limit))}`);
    const url = `${environment.apiUrl}/admin/students${q.length ? `?${q.join('&')}` : ''}`;
    return this.http.get<{
      success: boolean;
      data: any[];
      pagination?: { total: number; page: number; limit: number; pages: number };
    }>(url, { withCredentials: true });
  }
  
  // Admin upload document for student (Admin only)
  adminUploadDocument(formData: FormData): Observable<{
    success: boolean;
    message: string;
    document: StudentDocument;
  }> {
    return this.http.post<{
      success: boolean;
      message: string;
      document: StudentDocument;
    }>(`${this.apiUrl}/admin/upload`, formData, { withCredentials: true });
  }
  
  // Mark document as verified without uploading file (Admin only)
  markDocumentAsVerified(data: {
    studentEmail: string;
    documentTypeId?: string;
    documentType: string;
    documentName: string;
    verificationNotes: string;
  }): Observable<{
    success: boolean;
    message: string;
    document: StudentDocument;
  }> {
    return this.http.post<{
      success: boolean;
      message: string;
      document: StudentDocument;
    }>(`${this.apiUrl}/admin/mark-verified`, data, { withCredentials: true });
  }

  // Send custom email to a student (Admin only)
  sendEmailToStudent(data: { to: string; subject: string; message: string }): Observable<{
    success: boolean;
    message: string;
  }> {
    return this.http.post<{
      success: boolean;
      message: string;
    }>(`${this.apiUrl}/admin/send-email`, data, { withCredentials: true });
  }
}
