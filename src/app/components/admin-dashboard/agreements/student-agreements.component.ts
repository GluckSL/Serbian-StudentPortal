import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
import { AgreementService, AgreementTemplate, StudentAgreement } from '../../../services/agreement.service';
import { normalizeStudentObjectId } from '../../../utils/student-id.util';

@Component({
  selector: 'app-student-agreements',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MaterialModule],
  templateUrl: './student-agreements.component.html',
  styleUrls: ['./student-agreements.component.css']
})
export class StudentAgreementsComponent implements OnInit {
  studentId = '';
  studentName = '';
  studentEmail = '';

  // Template picker & share form
  templates: AgreementTemplate[] = [];
  templatesLoading = false;
  selectedTemplate: AgreementTemplate | null = null;
  fieldValues: Record<string, string> = {};
  displayName = '';
  sendEmail = true;
  sharing = false;

  // Preview (manual refetch only — no auto-update on keystroke)
  previewUrl: SafeResourceUrl | null = null;
  private previewBlobUrl: string | null = null;
  previewing = false;
  previewOutdated = false;
  private previewRequestId = 0;

  // Existing agreements list
  agreements: StudentAgreement[] = [];
  loadingAgreements = false;

  // Verify dialog
  verifyDialogAgreement: StudentAgreement | null = null;
  verifyStatus: 'VERIFIED' | 'REJECTED' = 'VERIFIED';
  verifyNotes = '';
  verifying = false;
  studentIdInvalid = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private svc: AgreementService,
    private snack: MatSnackBar,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    this.studentId =
      normalizeStudentObjectId(this.route.snapshot.paramMap.get('studentId')) ||
      normalizeStudentObjectId(qp.get('studentMongoId'));
    this.studentIdInvalid = !this.studentId;
    this.studentName = qp.get('name') || '';
    this.studentEmail = qp.get('email') || '';
    if (this.studentIdInvalid) {
      this.snack.open(
        'Student ID is missing or invalid. Open this page from Document Verification → student profile → Generate Agreement.',
        'Close',
        { duration: 8000 }
      );
    } else {
      this.loadAgreements();
    }
    this.loadTemplates();
  }

  get hasValidStudentId(): boolean {
    return !!this.studentId && !this.studentIdInvalid;
  }

  loadTemplates(): void {
    this.templatesLoading = true;
    this.svc.getTemplates().subscribe({
      next: r => {
        this.templates = (r.templates || []).filter(t => t.isActive !== false);
        this.templatesLoading = false;
      },
      error: () => {
        this.templatesLoading = false;
        this.snack.open('Failed to load templates', 'Close', { duration: 3000 });
      }
    });
  }

  get studentInitials(): string {
    const parts = (this.studentName || '?').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (parts[0]?.[0] || '?').toUpperCase();
  }

  get wizardStep(): 1 | 2 | 3 {
    if (!this.selectedTemplate) return 1;
    if (!this.previewUrl) return 2;
    return 3;
  }

  get canShare(): boolean {
    return !!this.selectedTemplate && !!this.displayName.trim() && Object.keys(this.buildFieldValuesPayload()).length > 0;
  }

  get canRefetchPreview(): boolean {
    return !!this.selectedTemplate && Object.keys(this.buildFieldValuesPayload()).length > 0;
  }

  goBackToDocuments(): void {
    if (!this.studentId) {
      this.router.navigate(['/admin/document-verification']);
      return;
    }
    this.router.navigate(['/admin/document-verification/student', this.studentId], {
      queryParams: {
        name: this.studentName,
        email: this.studentEmail
      }
    });
  }

  isWordTemplate(t: AgreementTemplate): boolean {
    return t.fillMode === 'docx' || !!t.docxR2Key;
  }

  loadAgreements(): void {
    if (!this.hasValidStudentId) return;
    this.loadingAgreements = true;
    this.svc.getInstances(this.studentId).subscribe({
      next: r => { this.agreements = r.agreements; this.loadingAgreements = false; },
      error: () => { this.loadingAgreements = false; }
    });
  }

  onTemplateSelect(): void {
    this.fieldValues = {};
    this.clearPreview();
    if (!this.selectedTemplate?._id) return;

    this.svc.getTemplate(this.selectedTemplate._id).subscribe({
      next: r => {
        this.selectedTemplate = r.template;
        if (!this.selectedTemplate.fillMode && this.selectedTemplate.docxR2Key) {
          this.selectedTemplate.fillMode = 'docx';
        }
        const prefillMap: Record<string, string> = {
          studentName: this.studentName,
          studentEmail: this.studentEmail,
          name: this.studentName,
          email: this.studentEmail
        };
        const values: Record<string, string> = {};
        for (const f of this.selectedTemplate!.dynamicFields || []) {
          values[f.id] = prefillMap[f.id] || '';
        }
        this.fieldValues = values;
        this.displayName = `${this.selectedTemplate!.name} – ${this.studentName}`;
        // One automatic preview when template loads (prefilled student name, etc.)
        if (Object.keys(this.buildFieldValuesPayload()).length > 0) {
          this.refetchPreview();
        } else {
          this.previewOutdated = false;
        }
      },
      error: () => this.snack.open('Failed to load template fields', 'Close', { duration: 3000 })
    });
  }

  onFieldInputChange(): void {
    this.previewOutdated = true;
  }

  refetchPreview(): void {
    this.previewPdf();
  }

  /** Send only template field keys with non-empty values. */
  buildFieldValuesPayload(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of this.templateFields()) {
      const v = this.fieldValues[f.id];
      if (v != null && String(v).trim()) {
        out[f.id] = String(v).trim();
      }
    }
    return out;
  }

  previewPdf(): void {
    if (!this.selectedTemplate?._id) return;
    const payload = this.buildFieldValuesPayload();
    if (!Object.keys(payload).length) {
      this.snack.open('Fill at least one field, then click Update preview', 'Close', { duration: 3000 });
      return;
    }

    const reqId = ++this.previewRequestId;
    this.previewing = true;
    this.svc.previewInstance(this.selectedTemplate._id, payload).subscribe({
      next: (blob: Blob) => {
        if (reqId !== this.previewRequestId) return;
        if (this.previewBlobUrl) URL.revokeObjectURL(this.previewBlobUrl);
        this.previewBlobUrl = URL.createObjectURL(blob);
        this.previewUrl = this.buildPdfViewerUrl(this.previewBlobUrl);
        this.previewOutdated = false;
        this.previewing = false;
      },
      error: e => {
        if (reqId !== this.previewRequestId) return;
        this.previewing = false;
        this.snack.open(e.error?.message || 'Preview failed', 'Close', { duration: 3000 });
      }
    });
  }

  /** Minimal PDF viewer: hide toolbar, thumbnails, and side panes. */
  private buildPdfViewerUrl(blobUrl: string): SafeResourceUrl {
    const params = 'toolbar=0&navpanes=0&statusbar=0&messages=0&scrollbar=1&view=FitH';
    const hash = blobUrl.includes('#') ? '&' + params : '#' + params;
    return this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl + hash);
  }

  private clearPreview(): void {
    this.previewRequestId++;
    if (this.previewBlobUrl) {
      URL.revokeObjectURL(this.previewBlobUrl);
      this.previewBlobUrl = null;
    }
    this.previewUrl = null;
    this.previewOutdated = false;
  }

  share(sendEmail = this.sendEmail): void {
    if (!this.hasValidStudentId) {
      this.snack.open('Cannot save: student ID is invalid. Go back and open from the student document profile.', 'Close', { duration: 5000 });
      return;
    }
    if (!this.selectedTemplate || !this.displayName) {
      this.snack.open('Select a template and enter an agreement name', 'Close', { duration: 3000 });
      return;
    }
    const payload = this.buildFieldValuesPayload();
    if (!Object.keys(payload).length) {
      this.snack.open('Fill in at least one agreement field before saving', 'Close', { duration: 3000 });
      return;
    }
    this.sendEmail = sendEmail;
    this.sharing = true;
    this.svc.shareInstance({
      templateId: this.selectedTemplate._id,
      studentId: this.studentId,
      studentEmail: this.studentEmail,
      fieldValues: payload,
      displayName: this.displayName,
      sendEmail
    }).subscribe({
      next: r => {
        this.sharing = false;
        const msg =
          r.message ||
          (sendEmail
            ? 'Agreement saved to student portal and emailed'
            : 'Agreement saved to student portal — student can view and upload signed copy');
        this.snack.open(msg, 'Close', { duration: 5000 });
        this.loadAgreements();
        this.selectedTemplate = null;
        this.fieldValues = {};
        this.displayName = '';
        this.previewUrl = null;
      },
      error: e => { this.sharing = false; this.snack.open(e.error?.message || 'Share failed', 'Close', { duration: 3000 }); }
    });
  }

  downloadGenerated(a: StudentAgreement): void {
    window.open(this.svc.getDownloadUrl(a._id, 'generated'), '_blank');
  }

  downloadSigned(a: StudentAgreement): void {
    window.open(this.svc.getDownloadUrl(a._id, 'signed'), '_blank');
  }

  openVerifyDialog(a: StudentAgreement): void {
    this.verifyDialogAgreement = a;
    this.verifyStatus = 'VERIFIED';
    this.verifyNotes = '';
  }

  closeVerifyDialog(): void {
    this.verifyDialogAgreement = null;
  }

  submitVerify(): void {
    if (!this.verifyDialogAgreement) return;
    this.verifying = true;
    this.svc.verifyInstance(this.verifyDialogAgreement._id, this.verifyStatus, this.verifyNotes).subscribe({
      next: () => {
        this.verifying = false;
        this.snack.open('Agreement updated', 'Close', { duration: 2000 });
        this.closeVerifyDialog();
        this.loadAgreements();
      },
      error: e => { this.verifying = false; this.snack.open(e.error?.message || 'Failed', 'Close', { duration: 3000 }); }
    });
  }

  statusClass(s: string): string {
    const map: Record<string, string> = {
      SENT: 'status-pending', SIGNED_PENDING: 'status-pending',
      VERIFIED: 'status-verified', REJECTED: 'status-rejected'
    };
    return map[s] || '';
  }

  statusLabel(s: string): string {
    const map: Record<string, string> = {
      SENT: 'Sent (Awaiting Signature)', SIGNED_PENDING: 'Signed – Pending Review',
      VERIFIED: 'Verified', REJECTED: 'Rejected'
    };
    return map[s] || s;
  }

  compareTemplates(a: AgreementTemplate | null, b: AgreementTemplate | null): boolean {
    return a?._id === b?._id;
  }

  templateFields(): any[] {
    return this.selectedTemplate?.dynamicFields || [];
  }
}
