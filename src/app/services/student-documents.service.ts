// src/app/services/student-documents.service.ts
// Service for student document management

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DocumentRequirement {
  type: string;
  label: string;
  required: boolean;
  description: string;
}

export interface StudentDocument {
  _id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  documentType: string;
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

  // Preview a document inline
  getPreviewUrl(documentId: string): string {
    return `${this.apiUrl}/preview/${documentId}`;
  }

  // Preview a document as blob (sends auth cookie)
  previewDocument(documentId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/preview/${documentId}`, {
      responseType: 'blob',
      withCredentials: true
    });
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
    status: 'VERIFIED' | 'REJECTED',
    verificationNotes?: string
  ): Observable<{
    success: boolean;
    message: string;
    document: StudentDocument;
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
  getAllStudents(): Observable<{
    success: boolean;
    students: any[];
  }> {
    return this.http.get<{
      success: boolean;
      students: any[];
    }>(`${environment.apiUrl}/admin/students`, { withCredentials: true });
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
