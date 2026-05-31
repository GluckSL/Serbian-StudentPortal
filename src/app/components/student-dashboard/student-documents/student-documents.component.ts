// src/app/components/student-dashboard/student-documents/student-documents.component.ts
// Component for student document upload and management

import { Component, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  StudentDocumentsService, 
  DocumentRequirement, 
  StudentDocument,
  DocumentStats 
} from '../../../services/student-documents.service';
import { AgreementService, StudentAgreement } from '../../../services/agreement.service';
import { NotificationService } from '../../../services/notification.service';

@Component({
  selector: 'app-student-documents',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './student-documents.component.html',
  styleUrls: ['./student-documents.component.css']
})
export class StudentDocumentsComponent implements OnInit {
  // Data
  requirements: DocumentRequirement[] = [];
  documents: StudentDocument[] = [];
  stats: DocumentStats | null = null;
  
  // Upload form
  selectedFile: File | null = null;
  selectedDocumentType: string = '';
  selectedDocumentTypeId: string = '';
  documentName: string = '';
  documentDescription: string = '';
  
  // UI state
  isLoading = false;
  isUploading = false;
  showUploadForm = false;
  selectedDocument: StudentDocument | null = null;
  showDocumentDetails = false;
  uploadingRequirementType: string | null = null;
  
  // Filters
  filterStatus: string = 'ALL';
  filterType: string = 'ALL';
  searchQuery: string = '';
  
  // Messages
  successMessage: string = '';
  errorMessage: string = '';

  // Agreements
  agreements: StudentAgreement[] = [];
  loadingAgreements = false;
  uploadingAgreementId: string | null = null;
  @ViewChild('signedFileInput') signedFileInput!: ElementRef<HTMLInputElement>;

  constructor(
    private documentService: StudentDocumentsService,
    private agreementService: AgreementService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadData();
    this.loadAgreements();
  }

  async loadData(): Promise<void> {
    this.isLoading = true;
    try {
      await Promise.all([
        this.loadRequirements(),
        this.loadDocuments(),
        this.loadStats()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
      this.showError('Error loading data. Please refresh the page.');
    } finally {
      this.isLoading = false;
    }
  }

  async loadRequirements(): Promise<void> {
    try {
      const response = await this.documentService.getStudentRequirements().toPromise();
      if (response && response.success) {
        this.requirements = response.requirements;
      }
    } catch (error) {
      console.error('Error loading requirements:', error);
    }
  }

  async loadDocuments(): Promise<void> {
    try {
      const response = await this.documentService.getMyDocuments().toPromise();
      if (response && response.success) {
        this.documents = response.documents;
      }
    } catch (error) {
      console.error('Error loading documents:', error);
    }
  }

  async loadStats(): Promise<void> {
    try {
      const response = await this.documentService.getDocumentStats().toPromise();
      if (response && response.success) {
        this.stats = response.stats;
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  loadAgreements(): void {
    this.loadingAgreements = true;
    this.agreementService.getInstances().subscribe({
      next: r => { this.agreements = r.agreements || []; this.loadingAgreements = false; },
      error: () => { this.loadingAgreements = false; }
    });
  }

  isAgreementRequirement(req: DocumentRequirement): boolean {
    return req.category === 'AGREEMENT' || String(req.type || '').startsWith('AGREEMENT_');
  }

  /** Link checklist row to shared agreement instance. */
  getAgreementForRequirement(req: DocumentRequirement): StudentAgreement | null {
    const latest = this.getLatestDocumentForType(req.type);
    if (latest) {
      const byDoc = this.agreements.find(
        (a) => a.studentDocumentId && String(a.studentDocumentId) === String(latest._id)
      );
      if (byDoc) return byDoc;
    }
    const byName = this.agreements.find(
      (a) => latest && (a.displayName === latest.documentName || a.templateName === req.label)
    );
    if (byName) return byName;
    if (this.agreements.length === 1 && this.isAgreementRequirement(req)) return this.agreements[0];
    return null;
  }

  canUploadSignedAgreement(a: StudentAgreement): boolean {
    return a.status === 'SENT' || a.status === 'REJECTED' || a.status === 'SIGNED_PENDING';
  }

  downloadAgreement(a: StudentAgreement, type: 'generated' | 'signed' = 'generated'): void {
    const name =
      type === 'signed' && a.signedFile?.fileName
        ? a.signedFile.fileName
        : a.generatedFile?.fileName || `${a.displayName || 'agreement'}.pdf`;
    this.agreementService.downloadInstance(a._id, type).subscribe({
      next: (blob) => this.documentService.triggerFileDownload(blob, name),
      error: (e) => this.showError(e.error?.message || 'Download failed')
    });
  }

  viewAgreement(a: StudentAgreement): void {
    const type = a.signedFile && a.status !== 'SENT' ? 'signed' : 'generated';
    this.agreementService.downloadInstance(a._id, type).subscribe({
      next: (blob) => {
        try {
          this.documentService.openBlobInNewTab(blob);
        } catch (e: any) {
          this.showError(e?.message || 'Allow popups to view the document');
        }
      },
      error: (e) => this.showError(e.error?.message || 'Could not open agreement')
    });
  }

  viewDocumentFile(doc: StudentDocument): void {
    if (!doc?._id || doc.fileName === 'NO_FILE_UPLOADED') return;
    this.documentService.previewDocument(doc._id).subscribe({
      next: (blob) => {
        try {
          this.documentService.openBlobInNewTab(blob, doc.mimeType || 'application/pdf');
        } catch (e: any) {
          this.showError(e?.message || 'Allow popups to view the document');
        }
      },
      error: () => this.showError('Could not open document preview')
    });
  }

  triggerSignedUpload(agreementId: string): void {
    this.uploadingAgreementId = agreementId;
    this.signedFileInput.nativeElement.click();
  }

  onSignedFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.uploadingAgreementId) return;
    const id = this.uploadingAgreementId;
    this.agreementService.uploadSigned(id, file).subscribe({
      next: () => {
        this.showSuccess('Signed agreement uploaded! Admin will review it shortly.');
        this.loadAgreements();
        this.loadDocuments();
        this.loadStats();
        this.uploadingAgreementId = null;
        input.value = '';
      },
      error: e => {
        this.showError(e.error?.message || 'Upload failed');
        this.uploadingAgreementId = null;
        input.value = '';
      }
    });
  }

  agreementStatusLabel(s: string): string {
    const map: Record<string, string> = {
      SENT: 'Awaiting Your Signature',
      SIGNED_PENDING: 'Under Review',
      VERIFIED: 'Verified',
      REJECTED: 'Rejected'
    };
    return map[s] || s;
  }

  agreementStatusClass(s: string): string {
    const map: Record<string, string> = {
      SENT: 'status-pending', SIGNED_PENDING: 'status-pending',
      VERIFIED: 'status-verified', REJECTED: 'status-rejected'
    };
    return map[s] || '';
  }

  // Document type selection - auto-fill document name
  onDocumentTypeChange(): void {
    if (this.selectedDocumentType) {
      const requirement = this.requirements.find(r => r.type === this.selectedDocumentType);
      if (requirement) {
        this.selectedDocumentTypeId = requirement.id;
        // Auto-fill document name with the label of selected type
        if (!this.documentName) {
        this.documentName = requirement.label;
        }
      }
    }
  }

  // File selection
  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) this.validateAndSetFile(file, event.target);
  }

  onFileDropped(event: DragEvent): void {
    event.preventDefault();
    const droppedFile = event.dataTransfer?.files?.[0];
    if (droppedFile) {
      this.validateAndSetFile(droppedFile);
    }
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  validateAndSetFile(file: File, inputEl?: HTMLInputElement): void {
    const validationError = this.validateFile(file);
    if (validationError) {
      this.showError(validationError);
      if (inputEl) inputEl.value = '';
      return;
    }

    this.selectedFile = file;
  }

  validateFile(file: File): string | null {
    if (file.size > 10 * 1024 * 1024) {
      return 'File size must be less than 10MB';
    }
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (!allowedTypes.includes(file.type)) {
      return 'Invalid file type. Only PDF, JPG, PNG, DOC, and DOCX files are allowed.';
    }
    return null;
  }

  // Upload document
  async uploadDocument(): Promise<void> {
    if (!this.selectedFile || !this.selectedDocumentType || !this.documentName) {
      this.showError('Please fill in all required fields and select a file');
      return;
    }
    
    this.isUploading = true;
    this.clearMessages();
    
    try {
      const formData = new FormData();
      formData.append('document', this.selectedFile);
      formData.append('documentTypeId', this.selectedDocumentTypeId);
      formData.append('documentType', this.selectedDocumentType);
      formData.append('documentName', this.documentName);
      formData.append('description', this.documentDescription);
      
      const response = await this.documentService.uploadDocument(formData).toPromise();
      
      if (response && response.success) {
        this.showSuccess('Document uploaded successfully!');
        this.resetUploadForm();
        await this.loadDocuments();
        await this.loadStats();
      }
    } catch (error: any) {
      console.error('Error uploading document:', error);
      this.showError(error.error?.message || 'Error uploading document. Please try again.');
    } finally {
      this.isUploading = false;
    }
  }

  // Delete document
  deleteDocument(documentId: string): void {
    this.notify.confirm('Delete Document', 'Are you sure you want to delete this document?', 'Yes, Delete', 'Cancel').subscribe(async ok => {
      if (!ok) return;
      try {
        const response = await this.documentService.deleteDocument(documentId).toPromise();
        if (response && response.success) {
          this.showSuccess('Document deleted successfully');
          await this.loadDocuments();
          await this.loadStats();
        }
      } catch (error: any) {
        console.error('Error deleting document:', error);
        this.showError(error.error?.message || 'Error deleting document');
      }
    });
  }

  // Download document
  async downloadDocument(document: StudentDocument): Promise<void> {
    this.documentService.triggerServerDownload(document._id);
  }

  // View document details
  viewDocumentDetails(document: StudentDocument): void {
    this.selectedDocument = document;
    this.showDocumentDetails = true;
  }

  closeDocumentDetails(): void {
    this.showDocumentDetails = false;
    this.selectedDocument = null;
  }

  // Toggle upload form
  toggleUploadForm(): void {
    this.showUploadForm = !this.showUploadForm;
    if (!this.showUploadForm) {
      this.resetUploadForm();
    }
  }

  // Reset upload form
  resetUploadForm(): void {
    this.selectedFile = null;
    this.selectedDocumentType = '';
    this.selectedDocumentTypeId = '';
    this.documentName = '';
    this.documentDescription = '';
    this.showUploadForm = false;
    
    // Reset file input
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  // Get filtered documents
  get filteredDocuments(): StudentDocument[] {
    let filtered = [...this.documents];
    
    // Filter by status
    if (this.filterStatus !== 'ALL') {
      filtered = filtered.filter(doc => doc.status === this.filterStatus);
    }
    
    // Filter by type
    if (this.filterType !== 'ALL') {
      filtered = filtered.filter(doc => doc.documentType === this.filterType);
    }
    
    // Search filter
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(doc =>
        doc.documentName.toLowerCase().includes(query) ||
        doc.documentTypeDisplay.toLowerCase().includes(query) ||
        doc.description.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }

  // Get unique document types from uploaded documents
  get uploadedDocumentTypes(): string[] {
    const types = new Set(this.documents.map(doc => doc.documentType));
    return Array.from(types);
  }

  // Check if a required document type is uploaded
  isRequiredDocumentUploaded(type: string): boolean {
    return this.documents.some(doc => doc.documentType === type);
  }

  getLatestDocumentForType(type: string): StudentDocument | null {
    const docsByType = this.documents
      .filter(doc => doc.documentType === type)
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    return docsByType.length > 0 ? docsByType[0] : null;
  }

  getRequirementStatus(type: string): 'NOT_UPLOADED' | 'PENDING' | 'VERIFIED' | 'REJECTED' {
    const latest = this.getLatestDocumentForType(type);
    if (!latest) return 'NOT_UPLOADED';
    return latest.status;
  }

  startUploadForRequirement(requirement: DocumentRequirement): void {
    this.showUploadForm = true;
    this.selectedDocumentType = requirement.type;
    this.selectedDocumentTypeId = requirement.id;
    this.documentName = requirement.label;
  }

  uploadFromRequirementRow(requirement: DocumentRequirement, isReplace = false): void {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
    picker.onchange = async () => {
      const file = picker.files && picker.files.length > 0 ? picker.files[0] : null;
      if (!file) return;

      const validationError = this.validateFile(file);
      if (validationError) {
        this.showError(validationError);
        return;
      }

      this.uploadingRequirementType = requirement.type;
      this.clearMessages();
      try {
        const latestDoc = this.getLatestDocumentForType(requirement.type);
        const formData = new FormData();
        formData.append('document', file);
        formData.append('documentTypeId', requirement.id);
        formData.append('documentType', requirement.type);
        formData.append('documentName', latestDoc?.documentName || requirement.label);
        formData.append('description', isReplace ? 'Re-uploaded by student as a replacement version' : '');

        const response = await this.documentService.uploadDocument(formData).toPromise();
        if (response?.success) {
          this.showSuccess(isReplace ? 'Document replaced successfully' : 'Document uploaded successfully');
          await this.loadDocuments();
          await this.loadStats();
        }
      } catch (error: any) {
        this.showError(error?.error?.message || 'Failed to upload document');
      } finally {
        this.uploadingRequirementType = null;
      }
    };
    picker.click();
  }

  getRequirementStatusText(type: string): string {
    const status = this.getRequirementStatus(type);
    if (status === 'NOT_UPLOADED') return 'Not Uploaded';
    if (status === 'PENDING') return 'Pending';
    if (status === 'VERIFIED') return 'Verified';
    return 'Rejected';
  }

  getRequirementStatusBadgeClass(type: string): string {
    const status = this.getRequirementStatus(type);
    if (status === 'NOT_UPLOADED') return 'bg-secondary';
    return this.getStatusBadgeClass(status);
  }

  getRequirementReuploadReason(type: string): string {
    const latest = this.getLatestDocumentForType(type);
    if (!latest || latest.status !== 'REJECTED') return '';
    return (latest.verificationNotes || latest.remarks || '').trim();
  }

  // Get document count by type
  getDocumentCountByType(type: string): number {
    return this.documents.filter(doc => doc.documentType === type).length;
  }

  // Get requirement description by type
  getRequirementDescription(type: string): string {
    const requirement = this.requirements.find(r => r.type === type);
    return requirement ? requirement.description : '';
  }

  // Get requirement label by type
  getRequirementLabel(type: string): string {
    const requirement = this.requirements.find(r => r.type === type);
    return requirement ? (requirement.name || requirement.label) : type;
  }

  // Helper methods
  getStatusBadgeClass(status: string): string {
    return this.documentService.getStatusBadgeClass(status);
  }

  getStatusIcon(status: string): string {
    return this.documentService.getStatusIcon(status);
  }

  getFileIcon(mimeType: string): string {
    return this.documentService.getFileIcon(mimeType);
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // Message helpers
  showSuccess(message: string): void {
    this.successMessage = message;
    this.errorMessage = '';
    setTimeout(() => this.successMessage = '', 5000);
  }

  showError(message: string): void {
    this.errorMessage = message;
    this.successMessage = '';
    setTimeout(() => this.errorMessage = '', 5000);
  }

  clearMessages(): void {
    this.successMessage = '';
    this.errorMessage = '';
  }
}
