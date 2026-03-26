// src/app/components/student-dashboard/student-documents/student-documents.component.ts
// Component for student document upload and management

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  StudentDocumentsService, 
  DocumentRequirement, 
  StudentDocument,
  DocumentStats 
} from '../../../services/student-documents.service';

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
  documentName: string = '';
  documentDescription: string = '';
  
  // UI state
  isLoading = false;
  isUploading = false;
  showUploadForm = false;
  selectedDocument: StudentDocument | null = null;
  showDocumentDetails = false;
  
  // Filters
  filterStatus: string = 'ALL';
  filterType: string = 'ALL';
  searchQuery: string = '';
  
  // Messages
  successMessage: string = '';
  errorMessage: string = '';

  constructor(private documentService: StudentDocumentsService) {}

  ngOnInit(): void {
    this.loadData();
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

  // Document type selection - auto-fill document name
  onDocumentTypeChange(): void {
    if (this.selectedDocumentType && !this.documentName) {
      // Auto-fill document name with the label of selected type
      const requirement = this.requirements.find(r => r.type === this.selectedDocumentType);
      if (requirement) {
        this.documentName = requirement.label;
      }
    }
  }

  // File selection
  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        this.showError('File size must be less than 10MB');
        event.target.value = '';
        return;
      }
      
      // Validate file type
      const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      
      if (!allowedTypes.includes(file.type)) {
        this.showError('Invalid file type. Only PDF, JPG, PNG, DOC, and DOCX files are allowed.');
        event.target.value = '';
        return;
      }
      
      this.selectedFile = file;
    }
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
  async deleteDocument(documentId: string): Promise<void> {
    if (!confirm('Are you sure you want to delete this document?')) {
      return;
    }
    
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
  }

  // Download document
  async downloadDocument(document: StudentDocument): Promise<void> {
    try {
      const blob = await this.documentService.downloadDocument(document._id).toPromise();
      if (blob) {
        this.documentService.triggerFileDownload(blob, document.fileName);
      }
    } catch (error) {
      console.error('Error downloading document:', error);
      this.showError('Error downloading document');
    }
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
    return requirement ? requirement.label : type;
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
