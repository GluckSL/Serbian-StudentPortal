import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { StudentDocumentsService } from '../../../services/student-documents.service';
import { AgreementService, StudentAgreement } from '../../../services/agreement.service';
import { MaterialModule } from '../../../shared/material.module';
import { TestAccountBadgeComponent } from '../../../shared/test-account-badge/test-account-badge.component';

interface StudentDocRow {
  type: string;
  label: string;
  requirementId?: string;
  required: boolean;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'NOT_UPLOADED';
  doc: any | null;
  uploadedAt: Date | null;
  remarks: string;
  selectedStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED';
  // Agreement-specific fields
  isAgreement?: boolean;
  agreementId?: string;
  agreementStatus?: string;
  hasSignedCopy?: boolean;
}

@Component({
  selector: 'app-student-document-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, TestAccountBadgeComponent],
  templateUrl: './student-document-profile.component.html',
  styleUrls: ['./student-document-profile.component.css']
})
export class StudentDocumentProfileComponent implements OnInit {
  loading = false;
  studentId = '';

  student = {
    name: '',
    email: '',
    studentStatus: '',
    subscription: '',
    servicesOpted: '',
    qualifications: '',
    languageLevelOpted: '',
    isTestAccount: false
  };

  requirements: any[] = [];
  documents: any[] = [];
  rows: StudentDocRow[] = [];

  showReuploadDialog = false;
  selectedRowDoc: any | null = null;
  reuploadReason = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private documentService: StudentDocumentsService,
    private agreementService: AgreementService
  ) {}

  ngOnInit(): void {
    this.studentId = this.route.snapshot.paramMap.get('studentId') || '';
    const qp = this.route.snapshot.queryParamMap;
    this.student = {
      name: qp.get('name') || '',
      email: qp.get('email') || '',
      studentStatus: qp.get('studentStatus') || '',
      subscription: qp.get('subscription') || '',
      servicesOpted: qp.get('servicesOpted') || '',
      qualifications: qp.get('qualifications') || '',
      languageLevelOpted: qp.get('languageLevelOpted') || '',
      isTestAccount: qp.get('isTestAccount') === 'true'
    };
    this.loadData();
  }

  loadData(): void {
    if (!this.studentId) return;
    this.loading = true;

    this.documentService.getDocumentRequirements().subscribe({
      next: (reqRes) => {
        if (reqRes.success) {
          this.requirements = reqRes.requirements || [];
        }
        this.documentService.getAllDocuments({ studentId: this.studentId }).subscribe({
          next: (docRes) => {
            if (docRes.success) {
              this.documents = docRes.documents || [];
              if (this.documents.length > 0) {
                const base = this.documents[0];
                this.student.name = this.student.name || base.studentName || '';
                this.student.email = this.student.email || base.studentEmail || '';
                this.student.studentStatus = this.student.studentStatus || base.studentStatus || '';
                this.student.subscription = this.student.subscription || base.subscription || '';
                this.student.servicesOpted = this.student.servicesOpted || base.servicesOpted || '';
                this.student.qualifications = this.student.qualifications || base.qualifications || '';
                this.student.languageLevelOpted = this.student.languageLevelOpted || base.languageLevelOpted || '';
                if (typeof base.isTestAccount === 'boolean') {
                  this.student.isTestAccount = base.isTestAccount;
                }
              }
              // Also load agreement rows then build merged table
              this.agreementService.getInstances(this.studentId).subscribe({
                next: (agRes) => {
                  this.rows = this.createRows(this.documents, agRes.agreements || []);
                  this.loading = false;
                },
                error: () => {
                  this.rows = this.createRows(this.documents, []);
                  this.loading = false;
                }
              });
            } else {
              this.loading = false;
            }
          },
          error: () => {
            this.loading = false;
          }
        });
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  openAgreementWorkspace(): void {
    const url = this.router.createUrlTree(
      ['/admin/agreements/student', this.studentId],
      { queryParams: {
        name: this.student.name,
        email: this.student.email,
        studentStatus: this.student.studentStatus,
        subscription: this.student.subscription,
        servicesOpted: this.student.servicesOpted
      } }
    ).toString();
    window.open(url, '_blank');
  }

  createRows(studentDocs: any[], agreements: StudentAgreement[] = []): StudentDocRow[] {
    const docs = Array.isArray(studentDocs) ? studentDocs : [];
    const rows: StudentDocRow[] = [];

    const sortedRequirements = [...this.requirements].sort(
      (a, b) => Number(a?.order || 0) - Number(b?.order || 0)
    );

    for (const req of sortedRequirements) {
      const docsByType = docs
        .filter((d) => d.documentType === req.type)
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
      const latest = docsByType.length > 0 ? docsByType[0] : null;
      rows.push({
        type: req.type,
        label: req.name || req.label || req.type,
        requirementId: req._id || req.id,
        required: !!(req.required || req.isRequired),
        status: latest ? latest.status : 'NOT_UPLOADED',
        doc: latest,
        uploadedAt: latest?.uploadedAt || null,
        remarks: String(latest?.verificationNotes || latest?.remarks || '').trim(),
        selectedStatus: (latest?.status || 'PENDING') as 'PENDING' | 'VERIFIED' | 'REJECTED'
      });
    }

    for (const doc of docs) {
      if (!rows.some((r) => r.type === doc.documentType)) {
        rows.push({
          type: doc.documentType,
          label: doc.documentTypeDisplay || doc.documentType,
          requirementId: undefined,
          required: false,
          status: doc.status,
          doc,
          uploadedAt: doc.uploadedAt || null,
          remarks: String(doc.verificationNotes || doc.remarks || '').trim(),
          selectedStatus: (doc.status || 'PENDING') as 'PENDING' | 'VERIFIED' | 'REJECTED'
        });
      }
    }

    // Merge agreement rows
    for (const ag of agreements) {
      const agStatus = this.mapAgreementStatus(ag.status);
      rows.push({
        type: `AGREEMENT_${ag._id}`,
        label: ag.displayName,
        requirementId: undefined,
        required: false,
        status: agStatus,
        doc: ag.studentDocumentId ? { _id: ag.studentDocumentId, documentCategory: 'AGREEMENT', agreementId: ag._id, fileName: ag.generatedFile?.fileName, filePath: '' } : null,
        uploadedAt: ag.sentAt ? new Date(ag.sentAt) : null,
        remarks: ag.verificationNotes || '',
        selectedStatus: (agStatus === 'NOT_UPLOADED' ? 'PENDING' : agStatus) as 'PENDING' | 'VERIFIED' | 'REJECTED',
        isAgreement: true,
        agreementId: ag._id,
        agreementStatus: ag.status,
        hasSignedCopy: !!ag.signedFile
      });
    }

    return rows;
  }

  private mapAgreementStatus(agStatus: string): 'PENDING' | 'VERIFIED' | 'REJECTED' | 'NOT_UPLOADED' {
    switch (agStatus) {
      case 'VERIFIED': return 'VERIFIED';
      case 'REJECTED': return 'REJECTED';
      case 'SIGNED_PENDING': return 'PENDING';
      case 'SENT': return 'PENDING';
      default: return 'NOT_UPLOADED';
    }
  }

  downloadAgreement(agreementId: string, type: 'generated' | 'signed'): void {
    const url = this.agreementService.getDownloadUrl(agreementId, type);
    window.open(url, '_blank');
  }

  openDocumentInNewTab(doc: any): void {
    if (!doc || doc.fileName === 'NO_FILE_UPLOADED') return;
    const previewUrl = this.documentService.getPreviewUrl(doc._id);
    window.open(previewUrl, '_blank', 'noopener');
  }

  downloadDocument(doc: any): void {
    this.documentService.triggerServerDownload(doc._id);
  }

  replaceDocument(doc: any): void {
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
    input.onchange = () => {
      const selectedFile = input.files && input.files.length > 0 ? input.files[0] : null;
      if (!selectedFile) return;
      this.documentService.replaceDocument(doc._id, selectedFile).subscribe({
        next: (response) => {
          if (response.success) this.loadData();
        }
      });
    };
    input.click();
  }

  uploadForStudent(row: StudentDocRow): void {
    if (!this.student.email) return;
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
    input.onchange = () => {
      const selectedFile = input.files && input.files.length > 0 ? input.files[0] : null;
      if (!selectedFile) return;
      const formData = new FormData();
      formData.append('document', selectedFile);
      formData.append('studentEmail', this.student.email);
      formData.append('documentType', row.type);
      if (row.requirementId) formData.append('documentTypeId', row.requirementId);
      formData.append('documentName', row.doc?.documentName || row.label);
      formData.append('description', 'Uploaded by admin from Student Document Profile page');
      this.documentService.adminUploadDocument(formData).subscribe({
        next: (response) => {
          if (response.success) this.loadData();
        }
      });
    };
    input.click();
  }

  updateRowStatus(row: StudentDocRow): void {
    if (!row.doc || !row.selectedStatus) return;

    if (row.selectedStatus === 'REJECTED') {
      this.openReuploadDialog(row.doc);
      return;
    }

    const notes = row.selectedStatus === 'VERIFIED' ? 'Verified after review by admin' : 'Moved back to pending review by admin';
    this.documentService.verifyDocument(row.doc._id, row.selectedStatus, notes).subscribe({
      next: (response) => {
        if (response.success) this.loadData();
      }
    });
  }

  openReuploadDialog(doc: any): void {
    this.selectedRowDoc = doc;
    this.reuploadReason = '';
    this.showReuploadDialog = true;
  }

  closeReuploadDialog(): void {
    this.showReuploadDialog = false;
    this.selectedRowDoc = null;
    this.reuploadReason = '';
  }

  submitReuploadRequest(): void {
    if (!this.selectedRowDoc || !this.reuploadReason.trim()) return;
    this.documentService.verifyDocument(this.selectedRowDoc._id, 'REJECTED', this.reuploadReason.trim()).subscribe({
      next: (response) => {
        if (response.success) {
          this.closeReuploadDialog();
          this.loadData();
        }
      }
    });
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'VERIFIED': return 'success';
      case 'REJECTED': return 'warn';
      case 'PENDING': return 'accent';
      default: return 'primary';
    }
  }

  getStatusLabel(status: StudentDocRow['status']): string {
    switch (status) {
      case 'PENDING':
        return 'Pending Review';
      case 'VERIFIED':
        return 'Verified';
      case 'REJECTED':
        return 'Re-upload Requested';
      case 'NOT_UPLOADED':
      default:
        return 'Not Uploaded';
    }
  }

  getStatusBadgeClass(status: StudentDocRow['status']): string {
    switch (status) {
      case 'PENDING':
        return 'status-badge status-pending';
      case 'VERIFIED':
        return 'status-badge status-verified';
      case 'REJECTED':
        return 'status-badge status-rejected';
      case 'NOT_UPLOADED':
      default:
        return 'status-badge status-missing';
    }
  }

  getStatusToneClass(status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'NOT_UPLOADED'): string {
    switch (status) {
      case 'PENDING':
        return 'status-pending';
      case 'VERIFIED':
        return 'status-verified';
      case 'REJECTED':
        return 'status-rejected';
      case 'NOT_UPLOADED':
      default:
        return 'status-missing';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'VERIFIED': return 'check_circle';
      case 'REJECTED': return 'cancel';
      case 'PENDING': return 'schedule';
      default: return 'hourglass_empty';
    }
  }

  formatDate(date?: Date | string | null): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  goBack(): void {
    this.router.navigate(['/admin/document-verification']);
  }

  exportStudentDocumentDetails(): void {
    const headers = [
      'Student Name',
      'Student Email',
      'CRM Status',
      'Package',
      'Service',
      'Qualification',
      'Language Level',
      'Required Document',
      'Requirement Type',
      'Is Required',
      'Is Uploaded',
      'Uploaded File Name',
      'Document Name',
      'Status',
      'Uploaded At',
      'Re-upload Reason',
      'Version'
    ];

    const lines: string[] = [headers.map((h) => this.escapeCsv(h)).join(',')];
    for (const row of this.rows) {
      const status = row.doc ? (row.selectedStatus || row.status) : 'NOT_UPLOADED';
      const uploaded = row.doc ? 'YES' : 'NO';
      const uploadedFile = row.doc?.fileName || '-';
      const documentName = row.doc?.documentName || '-';
      const uploadedAt = row.doc ? this.formatDate(row.uploadedAt) : '-';
      const reason = row.status === 'REJECTED' ? (row.remarks || '-') : '-';
      const version = row.doc?.version != null ? String(row.doc.version) : '-';

      const values = [
        this.student.name || '-',
        this.student.email || '-',
        this.student.studentStatus || '-',
        this.student.subscription || '-',
        this.student.servicesOpted || '-',
        this.student.qualifications || '-',
        this.student.languageLevelOpted || '-',
        row.label || '-',
        row.type || '-',
        row.required ? 'YES' : 'NO',
        uploaded,
        uploadedFile,
        documentName,
        this.getStatusLabel(status as StudentDocRow['status']),
        uploadedAt,
        reason,
        version
      ];

      lines.push(values.map((v) => this.escapeCsv(v)).join(','));
    }

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = this.buildSafeFileName(this.student.name || this.student.email || this.studentId || 'student');
    link.href = url;
    link.download = `${safeName}-document-details-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private escapeCsv(value: string): string {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }

  private buildSafeFileName(input: string): string {
    return String(input)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'student';
  }
}
