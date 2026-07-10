import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { StudentDocumentsService, StudentDocument } from '../../../services/student-documents.service';
import { AgreementService, StudentAgreement } from '../../../services/agreement.service';
import { MaterialModule } from '../../../shared/material.module';
import { TestAccountBadgeComponent } from '../../../shared/test-account-badge/test-account-badge.component';
import { normalizeStudentObjectId, studentIdFromRef } from '../../../utils/student-id.util';

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

  /** admin_pending | student_pending | all */
  activeTab: 'admin_pending' | 'student_pending' | 'all' = 'admin_pending';

  showVerificationDialog = false;
  verificationAction: 'VERIFIED' | 'REJECTED' | null = null;
  verificationNotes = '';
  verifying = false;
  /** Row being approved/rejected */
  verifyTarget: StudentDocRow | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private documentService: StudentDocumentsService,
    private agreementService: AgreementService,
    private snack: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.studentId = normalizeStudentObjectId(this.route.snapshot.paramMap.get('studentId'));
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
                if (!this.studentId) {
                  const fromDoc = studentIdFromRef(base.studentId);
                  if (fromDoc) this.studentId = fromDoc;
                }
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

  /** Open the Share New Agreement screen for this student (fill template → PDF → checklist). */
  openAgreementWorkspace(): void {
    const id = normalizeStudentObjectId(this.studentId) ||
      this.documents.map((d) => studentIdFromRef(d.studentId)).find((x) => !!x) ||
      '';
    if (!id) {
      this.snack.open('Student ID missing — open this profile from Document Verification student list', 'Close', { duration: 5000 });
      return;
    }
    this.router.navigate(['/admin/agreements/student', id], {
      queryParams: {
        name: this.student.name,
        email: this.student.email,
        studentMongoId: id,
        studentStatus: this.student.studentStatus,
        subscription: this.student.subscription,
        servicesOpted: this.student.servicesOpted
      }
    });
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
      const agMatch = latest
        ? agreements.find(
            (a) =>
              (a.studentDocumentId && String(a.studentDocumentId) === String(latest._id)) ||
              a.displayName === latest.documentName
          )
        : null;
      const isAg =
        !!agMatch ||
        latest?.documentCategory === 'AGREEMENT' ||
        String(req.type || '').startsWith('AGREEMENT_');
      rows.push({
        type: req.type,
        label: req.name || req.label || req.type,
        requirementId: req._id || req.id,
        required: !!(req.required || req.isRequired),
        status: latest ? latest.status : 'NOT_UPLOADED',
        doc: latest,
        uploadedAt: latest?.uploadedAt || null,
        remarks: String(latest?.verificationNotes || latest?.remarks || '').trim(),
        selectedStatus: (latest?.status || 'PENDING') as 'PENDING' | 'VERIFIED' | 'REJECTED',
        isAgreement: isAg,
        agreementId: agMatch?._id,
        agreementStatus: agMatch?.status,
        hasSignedCopy: !!agMatch?.signedFile
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

    // Agreement instances not already linked to a requirement row
    for (const ag of agreements) {
      if (ag.studentDocumentId && rows.some((r) => r.doc && String(r.doc._id) === String(ag.studentDocumentId))) {
        continue;
      }
      const agStatus = this.mapAgreementStatus(ag.status);
      rows.push({
        type: `AGREEMENT_${ag._id}`,
        label: ag.displayName,
        requirementId: undefined,
        required: false,
        status: agStatus,
        doc: ag.studentDocumentId
          ? {
              _id: ag.studentDocumentId,
              documentCategory: 'AGREEMENT',
              agreementId: ag._id,
              fileName: ag.signedFile?.fileName || ag.generatedFile?.fileName,
              filePath: '',
              documentName: ag.displayName
            }
          : null,
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

  viewAgreement(agreementId: string, type: 'generated' | 'signed' = 'generated'): void {
    this.agreementService.downloadInstance(agreementId, type).subscribe({
      next: (blob) => {
        try {
          this.documentService.openBlobInNewTab(blob);
        } catch (e: any) {
          this.snack.open(e?.message || 'Allow popups to view the document', 'Close', { duration: 4000 });
        }
      },
      error: (e) => this.snack.open(e?.error?.message || 'Could not open document', 'Close', { duration: 4000 })
    });
  }

  downloadAgreement(agreementId: string, type: 'generated' | 'signed', fileName?: string): void {
    this.agreementService.downloadInstance(agreementId, type).subscribe({
      next: (blob) => this.documentService.triggerFileDownload(blob, fileName || `agreement-${type}.pdf`),
      error: () => this.snack.open('Download failed', 'Close', { duration: 3000 })
    });
  }

  canReviewRow(row: StudentDocRow): boolean {
    return this.isAdminPending(row);
  }

  /** Uploaded and waiting for admin approve/reject */
  isAdminPending(row: StudentDocRow): boolean {
    if (!row.doc) return false;
    if (row.status === 'NOT_UPLOADED') return false;
    if (row.isAgreement && row.agreementStatus === 'SENT' && !row.hasSignedCopy) return false;
    return row.status === 'PENDING' || row.agreementStatus === 'SIGNED_PENDING';
  }

  /** Student must upload, re-upload, or sign */
  isStudentPending(row: StudentDocRow): boolean {
    if (row.status === 'NOT_UPLOADED' || !row.doc) return true;
    if (row.status === 'REJECTED') return true;
    if (row.isAgreement && row.agreementStatus === 'SENT' && !row.hasSignedCopy) return true;
    return false;
  }

  setTab(tab: 'admin_pending' | 'student_pending' | 'all'): void {
    this.activeTab = tab;
  }

  get filteredRows(): StudentDocRow[] {
    switch (this.activeTab) {
      case 'admin_pending':
        return this.rows.filter((r) => this.isAdminPending(r));
      case 'student_pending':
        return this.rows.filter((r) => this.isStudentPending(r));
      default:
        return this.rows;
    }
  }

  get adminPendingCount(): number {
    return this.rows.filter((r) => this.isAdminPending(r)).length;
  }

  get studentPendingCount(): number {
    return this.rows.filter((r) => this.isStudentPending(r)).length;
  }

  get allCount(): number {
    return this.rows.length;
  }

  getEmptyTabMessage(): string {
    switch (this.activeTab) {
      case 'admin_pending':
        return 'No documents waiting for your review.';
      case 'student_pending':
        return 'Nothing pending from the student — no missing uploads or re-uploads.';
      default:
        return 'No documents found for this student.';
    }
  }

  openVerifyDialog(row: StudentDocRow, action: 'VERIFIED' | 'REJECTED'): void {
    this.verifyTarget = row;
    this.verificationAction = action;
    this.verificationNotes = row.remarks || '';
    this.showVerificationDialog = true;
  }

  closeVerificationDialog(): void {
    this.showVerificationDialog = false;
    this.verifyTarget = null;
    this.verificationAction = null;
    this.verificationNotes = '';
  }

  confirmVerification(): void {
    if (!this.verifyTarget || !this.verificationAction) return;
    const row = this.verifyTarget;
    const action = this.verificationAction;
    const notes =
      action === 'VERIFIED'
        ? (this.verificationNotes.trim() || 'Verified after review by admin')
        : this.verificationNotes.trim();

    if (action === 'REJECTED' && !notes) {
      this.snack.open('Please enter a reason for the student', 'Close', { duration: 3000 });
      return;
    }

    this.verifying = true;

    const done = (msg: string) => {
      this.verifying = false;
      this.snack.open(msg, 'Close', { duration: 4500 });
      this.closeVerificationDialog();
      this.loadData();
    };

    const fail = (e: { error?: { message?: string } }) => {
      this.verifying = false;
      this.snack.open(e.error?.message || 'Update failed', 'Close', { duration: 4000 });
    };

    if (row.isAgreement && row.agreementId) {
      this.agreementService.verifyInstance(row.agreementId, action, notes).subscribe({
        next: (r) => {
          const extra = action === 'REJECTED' && r.emailSent ? ' Email sent to student.' : '';
          done((r.message || `Agreement ${action.toLowerCase()}`) + extra);
        },
        error: fail
      });
      return;
    }

    if (!row.doc?._id) {
      this.verifying = false;
      return;
    }

    this.documentService.verifyDocument(row.doc._id, action, notes).subscribe({
      next: (r) => {
        const extra = action === 'REJECTED' && r.emailSent ? ' Email sent to student.' : '';
        done((r.message || `Document ${action.toLowerCase()}`) + extra);
      },
      error: fail
    });
  }

  openDocumentInNewTab(doc: any): void {
    if (!doc?._id || doc.fileName === 'NO_FILE_UPLOADED') return;
    const url = this.documentService.getPreviewUrl(doc._id);
    window.open(url, '_blank', 'noopener');
  }

  viewRow(row: StudentDocRow): void {
    if (row.isAgreement && row.agreementId) {
      this.viewAgreement(row.agreementId, row.hasSignedCopy ? 'signed' : 'generated');
      return;
    }
    if (row.doc) this.openDocumentInNewTab(row.doc);
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
          if (response.success) {
            const msg = (response as { message?: string }).message || 'Document uploaded for student';
            this.snack.open(msg, 'Close', { duration: 4500 });
            this.loadData();
          }
        },
        error: (e) => this.snack.open(e?.error?.message || 'Upload failed', 'Close', { duration: 4000 })
      });
    };
    input.click();
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
    return new Date(date).toLocaleDateString('sr-Latn-RS', {
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
