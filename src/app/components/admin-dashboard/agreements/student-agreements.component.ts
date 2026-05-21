import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
import { AgreementService, AgreementTemplate, StudentAgreement } from '../../../services/agreement.service';

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
  selectedTemplate: AgreementTemplate | null = null;
  fieldValues: Record<string, string> = {};
  displayName = '';
  sendEmail = true;
  sharing = false;

  // Preview
  previewUrl: SafeResourceUrl | null = null;
  previewing = false;

  // Existing agreements list
  agreements: StudentAgreement[] = [];
  loadingAgreements = false;

  // Verify dialog
  verifyDialogAgreement: StudentAgreement | null = null;
  verifyStatus: 'VERIFIED' | 'REJECTED' = 'VERIFIED';
  verifyNotes = '';
  verifying = false;

  constructor(
    private route: ActivatedRoute,
    private svc: AgreementService,
    private snack: MatSnackBar,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.studentId = this.route.snapshot.paramMap.get('studentId') || '';
    const qp = this.route.snapshot.queryParamMap;
    this.studentName = qp.get('name') || '';
    this.studentEmail = qp.get('email') || '';
    this.loadTemplates();
    this.loadAgreements();
  }

  loadTemplates(): void {
    this.svc.getTemplates().subscribe({
      next: r => this.templates = r.templates,
      error: () => this.snack.open('Failed to load templates', 'Close', { duration: 3000 })
    });
  }

  loadAgreements(): void {
    this.loadingAgreements = true;
    this.svc.getInstances(this.studentId).subscribe({
      next: r => { this.agreements = r.agreements; this.loadingAgreements = false; },
      error: () => { this.loadingAgreements = false; }
    });
  }

  onTemplateSelect(): void {
    this.fieldValues = {};
    this.previewUrl = null;
    if (!this.selectedTemplate) return;
    // Prefill common fields from query params
    const prefillMap: Record<string, string> = {
      studentName: this.studentName,
      studentEmail: this.studentEmail,
      name: this.studentName,
      email: this.studentEmail
    };
    for (const f of this.selectedTemplate.dynamicFields) {
      if (prefillMap[f.id]) this.fieldValues[f.id] = prefillMap[f.id];
    }
    this.displayName = `${this.selectedTemplate.name} – ${this.studentName}`;
  }

  previewPdf(): void {
    if (!this.selectedTemplate) return;
    this.previewing = true;
    this.svc.previewInstance(this.selectedTemplate._id, this.fieldValues).subscribe({
      next: (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        this.previewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
        this.previewing = false;
      },
      error: e => { this.previewing = false; this.snack.open(e.error?.message || 'Preview failed', 'Close', { duration: 3000 }); }
    });
  }

  share(sendEmail = this.sendEmail): void {
    if (!this.selectedTemplate || !this.displayName) {
      this.snack.open('Select a template and enter an agreement name', 'Close', { duration: 3000 });
      return;
    }
    this.sendEmail = sendEmail;
    this.sharing = true;
    this.svc.shareInstance({
      templateId: this.selectedTemplate._id,
      studentId: this.studentId,
      fieldValues: this.fieldValues,
      displayName: this.displayName,
      sendEmail
    }).subscribe({
      next: r => {
        this.sharing = false;
        this.snack.open(sendEmail ? 'Agreement saved and emailed!' : 'Agreement saved!', 'Close', { duration: 3000 });
        // Trigger browser download
        const dlUrl = this.svc.getDownloadUrl(r.agreement._id);
        window.open(dlUrl, '_blank');
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
