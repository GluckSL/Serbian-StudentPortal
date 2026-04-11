import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PageEvent } from '@angular/material/paginator';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { StudentDocumentsService } from '../../../services/student-documents.service';
import { NotificationService } from '../../../services/notification.service';
import { map, startWith } from 'rxjs/operators';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
import { EMPTY, expand, reduce } from 'rxjs';

interface StudentDocument {
  _id: string;
  studentId: string | Record<string, unknown>;
  studentName: string;
  studentEmail: string;
  documentType: string;
  documentName: string;
  fileName: string;
  fileSize: number;
  formattedFileSize?: string;
  documentTypeDisplay?: string;
  servicesOpted?: string;
  /** Package from Monday CRM (User.subscription) */
  subscription?: string;
  /** Current student status from CRM (User.studentStatus) */
  studentStatus?: string;
  qualifications?: string;
  languageLevelOpted?: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  uploadedAt: Date;
  verifiedAt?: Date;
  verifiedBy?: string;
  verificationNotes?: string;
}

interface DocumentStats {
  totalDocuments: number;
  pendingDocuments: number;
  verifiedDocuments: number;
  rejectedDocuments: number;
  totalStudents: number;
}

@Component({
  selector: 'app-document-verification',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MaterialModule
  ],
  templateUrl: './document-verification.component.html',
  styleUrls: ['./document-verification.component.css']
})
export class DocumentVerificationComponent implements OnInit {
  documents: StudentDocument[] = [];
  filteredDocuments: StudentDocument[] = [];
  paginatedDocuments: StudentDocument[] = [];
  
  stats: DocumentStats = {
    totalDocuments: 0,
    pendingDocuments: 0,
    verifiedDocuments: 0,
    rejectedDocuments: 0,
    totalStudents: 0
  };
  
  // Filters
  selectedStatus: string = 'ALL';
  selectedDocumentType: string = 'ALL';
  selectedServiceOpted: string = 'ALL';
  serviceOptedOptions: string[] = [];
  /** CRM: User.studentStatus (Monday “current status”) */
  selectedCrmStudentStatus: string = 'ALL';
  crmStudentStatusOptions: string[] = [];
  /** CRM: User.subscription (package) */
  selectedPackage: string = 'ALL';
  packageOptions: string[] = [];
  /** CRM: User.qualifications */
  selectedQualification: string = 'ALL';
  qualificationOptions: string[] = [];
  searchQuery: string = '';
  
  // Pagination
  pageSize: number = 10;
  pageIndex: number = 0;
  totalDocuments: number = 0;
  
  // Loading states
  loading: boolean = false;
  
  // Document types - populated dynamically from requirements
  documentTypes: { value: string; label: string }[] = [];
  
  displayedColumns: string[] = [
    'select',
    'studentName',
    'documentType',
    'documentName',
    'fileSize',
    'uploadedAt',
    'status',
    'actions'
  ];
  
  selectedDocument: StudentDocument | null = null;
  verificationNotes: string = '';
  showVerificationDialog: boolean = false;
  verificationAction: 'VERIFIED' | 'REJECTED' | null = null;
  
  // Selection for bulk operations
  selectedDocuments: string[] = [];
  allSelected: boolean = false;
  
  // Bulk upload
  showBulkUploadDialog: boolean = false;
  bulkUploadForm = {
    studentEmail: '',
    documentType: '',
    files: [] as File[]
  };
  students: any[] = [];
  studentSearchControl = new FormControl('');
  filteredStudents: any[] = [];
  
  // Mark as verified without upload
  showMarkVerifiedDialog: boolean = false;
  markVerifiedForm = {
    studentEmail: '',
    documentType: '',
    documentName: '',
    verificationNotes: ''
  };
  markVerifiedStudentControl = new FormControl('');
  markVerifiedFilteredStudents: any[] = [];
  
  // Requirements Management
  requirements: any[] = [];

  // Compact view
  viewMode: 'compact' | 'detailed' = 'compact';
  studentGroups: any[] = [];
  filteredStudentGroups: any[] = [];
  expandedStudentId: string | null = null;

  // Document preview
  showPreviewDialog: boolean = false;
  previewDocument: StudentDocument | null = null;
  previewUrl: SafeResourceUrl | null = null;
  previewRawUrl: string = '';
  previewType: 'pdf' | 'image' | 'unsupported' | 'not-found' = 'unsupported';
  previewLoading: boolean = false;

  showRequirementForm: boolean = false;
  editingRequirement: any = null;
  requirementForm = {
    type: '',
    label: '',
    description: '',
    required: false,
    category: 'OTHER',
    order: 0
  };
  categories = [
    { value: 'ACADEMIC', label: 'Academic' },
    { value: 'IDENTIFICATION', label: 'Identification' },
    { value: 'PROFESSIONAL', label: 'Professional' },
    { value: 'LEGAL', label: 'Legal' },
    { value: 'VISA', label: 'Visa' },
    { value: 'OTHER', label: 'Other' }
  ];

  // Email dialog
  showEmailDialog = false;
  emailForm = { to: '', studentName: '', subject: '', message: '' };
  sendingEmail = false;

  // ========== EXPORT CSV ==========

  exportToCSV(): void {
    if (this.documents.length === 0) {
      this.snackBar.open('No documents to export', 'Close', { duration: 3000 });
      return;
    }

    // Get all unique document types from requirements
    const docTypes = this.requirements.map(r => r.type);
    const docLabels = this.requirements.map(r => r.label);

    // Group documents by student
    const studentMap = new Map<string, any>();
    this.documents.forEach(doc => {
      const id = typeof doc.studentId === 'object' && doc.studentId !== null
        ? (doc.studentId as any)._id : doc.studentId;
      const idStr = String(id);
      if (!studentMap.has(idStr)) {
        const snap = this.getDocCrmSnapshot(doc);
        studentMap.set(idStr, {
          name: doc.studentName,
          email: doc.studentEmail,
          service: snap.servicesOpted || (doc as any).servicesOpted || '',
          crmStatus: snap.studentStatus,
          package: snap.subscription,
          qualification: snap.qualifications,
          docs: new Map<string, string>()
        });
      }
      // Store status for this doc type (latest wins if duplicates)
      studentMap.get(idStr).docs.set(doc.documentType, doc.status);
    });

    // Build CSV header
    const headers = [
      'Student Name',
      'Email',
      'CRM Status',
      'Package',
      'Service Opted',
      'Qualification',
      ...docLabels
    ];
    const rows: string[] = [headers.map(h => `"${h}"`).join(',')];

    // Build rows
    studentMap.forEach(student => {
      const cols = [
        `"${student.name}"`,
        `"${student.email}"`,
        `"${student.crmStatus || ''}"`,
        `"${student.package || ''}"`,
        `"${student.service}"`,
        `"${student.qualification || ''}"`,
      ];
      docTypes.forEach(type => {
        const status = student.docs.get(type) || '';
        cols.push(`"${status}"`);
      });
      rows.push(cols.join(','));
    });

    // Download
    const csvContent = rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `document-status-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    this.snackBar.open('CSV exported successfully', 'Close', { duration: 3000 });
  }

  constructor(
    private documentService: StudentDocumentsService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private sanitizer: DomSanitizer,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    // Load all students so list + stats include everyone (even without uploads)
    this.loadStudents();
    this.loadDocuments(); // This will also call loadStats() after documents are loaded
    this.loadRequirements();
    
    // Setup autocomplete for bulk upload
    this.studentSearchControl.valueChanges.pipe(
      startWith(''),
      map(value => this._filterStudents(value || ''))
    ).subscribe(filtered => {
      this.filteredStudents = filtered;
    });
    
    // Setup autocomplete for mark verified
    this.markVerifiedStudentControl.valueChanges.pipe(
      startWith(''),
      map(value => this._filterStudents(value || ''))
    ).subscribe(filtered => {
      this.markVerifiedFilteredStudents = filtered;
    });
  }
  
  private _filterStudents(value: string): any[] {
    const filterValue = value.toLowerCase();
    return this.students.filter(student => {
      const name = this.getStudentName(student).toLowerCase();
      const email = this.getStudentEmail(student).toLowerCase();
      const regNo = this.getStudentRegNo(student).toLowerCase();
      return name.includes(filterValue) || email.includes(filterValue) || regNo.includes(filterValue);
    });
  }

  private getStudentId(student: any): string {
    return String(
      student?._id ??
      student?.id ??
      student?.studentId ??
      student?.userId ??
      student?.uid ??
      ''
    );
  }

  private getStudentName(student: any): string {
    const name =
      student?.name ??
      student?.studentName ??
      student?.fullName ??
      (student?.firstName && student?.lastName ? `${student.firstName} ${student.lastName}` : null) ??
      student?.firstName ??
      student?.lastName ??
      '';
    return String(name).trim();
  }

  private getStudentEmail(student: any): string {
    return String(student?.email ?? student?.studentEmail ?? student?.mail ?? '').trim();
  }

  private getStudentRegNo(student: any): string {
    return String(student?.regNo ?? student?.registrationNumber ?? student?.registrationNo ?? '').trim();
  }

  private uniqueSortedStrings(values: (string | undefined | null)[]): string[] {
    return [...new Set(values.map(v => String(v ?? '').trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }

  /** Rebuild CRM filter dropdowns from loaded students and documents (Monday-synced fields). */
  refreshCrmFilterOptions(): void {
    const fromStudents = Array.isArray(this.students) ? this.students : [];
    const svc = fromStudents.map((s: any) => s.servicesOpted);
    const pkg = fromStudents.map((s: any) => s.subscription);
    const st = fromStudents.map((s: any) => s.studentStatus);
    const qual = fromStudents.map((s: any) => s.qualifications);

    for (const doc of this.documents) {
      const snap = this.getDocCrmSnapshot(doc);
      svc.push(snap.servicesOpted);
      pkg.push(snap.subscription);
      st.push(snap.studentStatus);
      qual.push(snap.qualifications);
    }

    this.serviceOptedOptions = this.uniqueSortedStrings(svc);
    this.packageOptions = this.uniqueSortedStrings(pkg);
    this.crmStudentStatusOptions = this.uniqueSortedStrings(st);
    this.qualificationOptions = this.uniqueSortedStrings(qual);
  }

  private getDocCrmSnapshot(doc: StudentDocument): {
    studentStatus: string;
    subscription: string;
    servicesOpted: string;
    qualifications: string;
  } {
    const sid = doc.studentId as any;
    if (sid && typeof sid === 'object' && sid._id) {
      return {
        studentStatus: String(sid.studentStatus ?? '').trim(),
        subscription: String(sid.subscription ?? '').trim(),
        servicesOpted: String(sid.servicesOpted ?? doc.servicesOpted ?? '').trim(),
        qualifications: String(sid.qualifications ?? '').trim()
      };
    }
    const idStr = String(sid ?? '');
    const st = this.students.find(s => this.getStudentId(s) === idStr);
    if (st) {
      return {
        studentStatus: String(st.studentStatus ?? '').trim(),
        subscription: String(st.subscription ?? '').trim(),
        servicesOpted: String(st.servicesOpted ?? doc.servicesOpted ?? '').trim(),
        qualifications: String(st.qualifications ?? '').trim()
      };
    }
    return {
      studentStatus: String(doc.studentStatus ?? '').trim(),
      subscription: String(doc.subscription ?? '').trim(),
      servicesOpted: String(doc.servicesOpted ?? '').trim(),
      qualifications: String(doc.qualifications ?? '').trim()
    };
  }

  private studentMatchesCrmFilters(student: any): boolean {
    if (this.selectedCrmStudentStatus !== 'ALL') {
      const s = String(student?.studentStatus ?? '').trim().toUpperCase();
      if (s !== this.selectedCrmStudentStatus.trim().toUpperCase()) return false;
    }
    if (this.selectedPackage !== 'ALL') {
      const p = String(student?.subscription ?? '').trim().toUpperCase();
      if (p !== this.selectedPackage.trim().toUpperCase()) return false;
    }
    if (this.selectedServiceOpted !== 'ALL') {
      const svc = String(student?.servicesOpted ?? '').trim();
      if (svc !== this.selectedServiceOpted.trim()) return false;
    }
    if (this.selectedQualification !== 'ALL') {
      const q = String(student?.qualifications ?? '').trim();
      if (q !== this.selectedQualification.trim()) return false;
    }
    return true;
  }

  private docMatchesCrmFilters(doc: StudentDocument): boolean {
    const snap = this.getDocCrmSnapshot(doc);
    if (this.selectedCrmStudentStatus !== 'ALL') {
      if (snap.studentStatus.toUpperCase() !== this.selectedCrmStudentStatus.trim().toUpperCase()) return false;
    }
    if (this.selectedPackage !== 'ALL') {
      if (snap.subscription.toUpperCase() !== this.selectedPackage.trim().toUpperCase()) return false;
    }
    if (this.selectedServiceOpted !== 'ALL') {
      if (snap.servicesOpted !== this.selectedServiceOpted.trim()) return false;
    }
    if (this.selectedQualification !== 'ALL') {
      if (snap.qualifications !== this.selectedQualification.trim()) return false;
    }
    return true;
  }

  loadDocuments(): void {
    this.loading = true;
    this.documentService.getAllDocuments().subscribe({
      next: (response) => {
        if (response.success) {
          this.documents = response.documents;
          this.refreshCrmFilterOptions();
          this.applyFilters();
          this.loadStats();
          this.loading = false;
        }
      },
      error: (error) => {
        console.error('Error loading documents:', error);
        this.snackBar.open('Error loading documents', 'Close', { duration: 3000 });
        this.loading = false;
      }
    });
  }

  loadStats(): void {
    // Calculate stats from documents
    this.stats.totalDocuments = this.documents.length;
    this.stats.pendingDocuments = this.documents.filter(d => d.status === 'PENDING').length;
    this.stats.verifiedDocuments = this.documents.filter(d => d.status === 'VERIFIED').length;
    this.stats.rejectedDocuments = this.documents.filter(d => d.status === 'REJECTED').length;

    // Prefer real student list count when available (shows students even without uploads)
    if (Array.isArray(this.students) && this.students.length > 0) {
      this.stats.totalStudents = this.students.length;
      return;
    }

    // Fallback: count unique students from documents
    const uniqueStudents = new Set(
      this.documents.map(d => {
        const id = typeof d.studentId === 'object' && d.studentId !== null
          ? (d.studentId as any)._id
          : d.studentId;
        return String(id);
      })
    );
    this.stats.totalStudents = uniqueStudents.size;
  }

  applyFilters(): void {
    let filtered = [...this.documents];
    
    // Status filter
    if (this.selectedStatus !== 'ALL') {
      filtered = filtered.filter(doc => doc.status === this.selectedStatus);
    }
    
    // Document type filter
    if (this.selectedDocumentType !== 'ALL') {
      filtered = filtered.filter(doc => doc.documentType === this.selectedDocumentType);
    }

    // CRM filters (Monday-synced profile on student)
    filtered = filtered.filter(doc => this.docMatchesCrmFilters(doc));
    
    // Search filter
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(doc =>
        doc.studentName.toLowerCase().includes(query) ||
        doc.studentEmail.toLowerCase().includes(query) ||
        doc.documentName.toLowerCase().includes(query)
      );
    }
    
    this.filteredDocuments = filtered;
    this.totalDocuments = filtered.length;
    this.pageIndex = 0;
    this.updatePaginatedDocuments();
    this.buildStudentGroups();
  }

  updatePaginatedDocuments(): void {
    const startIndex = this.pageIndex * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    this.paginatedDocuments = this.filteredDocuments.slice(startIndex, endIndex);
  }

  onPageChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    this.updatePaginatedDocuments();
  }

  clearFilters(): void {
    this.selectedStatus = 'ALL';
    this.selectedDocumentType = 'ALL';
    this.selectedServiceOpted = 'ALL';
    this.selectedCrmStudentStatus = 'ALL';
    this.selectedPackage = 'ALL';
    this.selectedQualification = 'ALL';
    this.searchQuery = '';
    this.applyFilters();
  }

  buildStudentGroups(): void {
    const docsByStudent = new Map<string, StudentDocument[]>();
    for (const doc of this.documents) {
      const id = typeof doc.studentId === 'object' && doc.studentId !== null
        ? (doc.studentId as any)._id
        : doc.studentId;
      const idStr = String(id);
      if (!docsByStudent.has(idStr)) docsByStudent.set(idStr, []);
      docsByStudent.get(idStr)!.push(doc);
    }

    const visibleDocsByStudent = new Map<string, StudentDocument[]>();
    for (const doc of this.filteredDocuments) {
      const id = typeof doc.studentId === 'object' && doc.studentId !== null
        ? (doc.studentId as any)._id
        : doc.studentId;
      const idStr = String(id);
      if (!visibleDocsByStudent.has(idStr)) visibleDocsByStudent.set(idStr, []);
      visibleDocsByStudent.get(idStr)!.push(doc);
    }

    const query = this.searchQuery.trim().toLowerCase();
    const studentMatchesQuery = (student: any): boolean => {
      if (!query) return true;
      const name = this.getStudentName(student).toLowerCase();
      const email = this.getStudentEmail(student).toLowerCase();
      const regNo = this.getStudentRegNo(student).toLowerCase();
      return name.includes(query) || email.includes(query) || regNo.includes(query);
    };

    const groups: any[] = [];

    if (Array.isArray(this.students) && this.students.length > 0) {
      // Build from full student list so everyone is visible (even with 0 docs)
      for (const student of this.students) {
        const studentId = this.getStudentId(student);
        if (!studentId) continue;

        if (!this.studentMatchesCrmFilters(student)) continue;

        const allDocs = docsByStudent.get(studentId) || [];
        const visibleDocs = visibleDocsByStudent.get(studentId) || [];

        if (query) {
          const docMatch = allDocs.some(d => String(d.documentName || '').toLowerCase().includes(query));
          if (!studentMatchesQuery(student) && !docMatch) continue;
        }

        const pending = allDocs.filter(d => d.status === 'PENDING').length;
        const verified = allDocs.filter(d => d.status === 'VERIFIED').length;
        const rejected = allDocs.filter(d => d.status === 'REJECTED').length;

        groups.push({
          studentId,
          studentName: this.getStudentName(student),
          studentEmail: this.getStudentEmail(student),
          studentRegNo: this.getStudentRegNo(student),
          studentObj: student,
          subscription: String(student?.subscription ?? '').trim(),
          studentStatus: String(student?.studentStatus ?? '').trim(),
          servicesOpted: String(student?.servicesOpted ?? '').trim(),
          qualifications: String(student?.qualifications ?? '').trim(),
          languageLevelOpted: String(student?.languageLevelOpted ?? '').trim(),
          documents: visibleDocs,
          totalDocs: allDocs.length,
          pendingDocs: pending,
          verifiedDocs: verified,
          rejectedDocs: rejected
        });
      }
    } else {
      // Fallback to documents only if student list isn't loaded yet
      const groupMap = new Map<string, any>();
      this.filteredDocuments.forEach(doc => {
        const id = typeof doc.studentId === 'object' && doc.studentId !== null
          ? (doc.studentId as any)._id
          : doc.studentId;
        const idStr = String(id);
        const snap = this.getDocCrmSnapshot(doc);

        if (!groupMap.has(idStr)) {
          groupMap.set(idStr, {
            studentId: idStr,
            studentName: doc.studentName,
            studentEmail: doc.studentEmail,
            studentRegNo: '',
            studentObj: null,
            subscription: snap.subscription,
            studentStatus: snap.studentStatus,
            servicesOpted: snap.servicesOpted,
            qualifications: snap.qualifications,
            languageLevelOpted: String((doc as any).languageLevelOpted ?? '').trim(),
            documents: [],
            totalDocs: 0,
            pendingDocs: 0,
            verifiedDocs: 0,
            rejectedDocs: 0
          });
        }
        const group = groupMap.get(idStr);
        group.documents.push(doc);
        group.totalDocs++;
        if (doc.status === 'PENDING') group.pendingDocs++;
        else if (doc.status === 'VERIFIED') group.verifiedDocs++;
        else if (doc.status === 'REJECTED') group.rejectedDocs++;
      });
      groups.push(...Array.from(groupMap.values()));
    }

    // Sort: pending first, then alphabetical
    this.studentGroups = groups.sort((a, b) => {
      const pendingDiff = (b.pendingDocs || 0) - (a.pendingDocs || 0);
      if (pendingDiff !== 0) return pendingDiff;
      return String(a.studentName || '').localeCompare(String(b.studentName || ''), undefined, { sensitivity: 'base' });
    });

    this.filteredStudentGroups = this.studentGroups;
  }

  toggleStudentExpand(studentId: string): void {
    this.expandedStudentId = this.expandedStudentId === studentId ? null : studentId;
  }

  switchView(mode: 'compact' | 'detailed'): void {
    this.viewMode = mode;
  }

  openPreview(doc: StudentDocument): void {
    if (doc.fileName === 'NO_FILE_UPLOADED') return;
    
    this.previewDocument = doc;
    this.previewUrl = null;
    this.previewType = 'pdf';
    this.previewLoading = true;
    this.showPreviewDialog = true;
    
    this.documentService.previewDocument(doc._id).subscribe({
      next: (blob) => {
        this.previewLoading = false;
        const blobType = blob.type || '';
        
        if (blobType.includes('pdf')) {
          this.previewType = 'pdf';
        } else if (blobType.includes('image')) {
          this.previewType = 'image';
        } else {
          const fileName = doc.fileName.toLowerCase();
          if (fileName.endsWith('.pdf')) {
            this.previewType = 'pdf';
          } else if (/\.(jpg|jpeg|png|gif|webp|bmp)$/.test(fileName)) {
            this.previewType = 'image';
          } else {
            this.previewType = 'unsupported';
          }
        }
        
        const objectUrl = URL.createObjectURL(blob);
        this.previewRawUrl = objectUrl;
        this.previewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(objectUrl);
      },
      error: (error) => {
        this.previewLoading = false;
        console.error('Error loading preview:', error);
        this.previewType = 'not-found';
      }
    });
  }

  closePreview(): void {
    this.showPreviewDialog = false;
    this.previewDocument = null;
    // Revoke the object URL to free memory
    if (this.previewRawUrl) {
      URL.revokeObjectURL(this.previewRawUrl);
    }
    this.previewUrl = null;
    this.previewRawUrl = '';
  }

  downloadDocument(doc: StudentDocument): void {
    this.documentService.downloadDocument(doc._id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = doc.documentName || doc.fileName;
        link.click();
        window.URL.revokeObjectURL(url);
        this.snackBar.open('Document downloaded', 'Close', { duration: 2000 });
      },
      error: (error) => {
        console.error('Error downloading document:', error);
        // Try to read error message from blob response
        if (error.error instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const errJson = JSON.parse(reader.result as string);
              this.snackBar.open(errJson.message || 'Error downloading document', 'Close', { duration: 4000 });
            } catch {
              this.snackBar.open('Error downloading document', 'Close', { duration: 3000 });
            }
          };
          reader.readAsText(error.error);
        } else {
          this.snackBar.open('Error downloading document', 'Close', { duration: 3000 });
        }
      }
    });
  }

  openVerificationDialog(document: StudentDocument, action: 'VERIFIED' | 'REJECTED'): void {
    this.selectedDocument = document;
    this.verificationAction = action;
    this.verificationNotes = document.verificationNotes || '';
    this.showVerificationDialog = true;
  }

  closeVerificationDialog(): void {
    this.showVerificationDialog = false;
    this.selectedDocument = null;
    this.verificationAction = null;
    this.verificationNotes = '';
  }

  confirmVerification(): void {
    if (!this.selectedDocument || !this.verificationAction) return;
    
    const action = this.verificationAction; // Store in local variable to avoid null check issues
    
    this.documentService.verifyDocument(
      this.selectedDocument._id,
      action,
      this.verificationNotes
    ).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open(
            `Document ${action.toLowerCase()} successfully`,
            'Close',
            { duration: 3000 }
          );
          this.closeVerificationDialog();
          this.loadDocuments();
          this.loadStats();
        }
      },
      error: (error) => {
        console.error('Error verifying document:', error);
        this.snackBar.open('Error updating document status', 'Close', { duration: 3000 });
      }
    });
  }

  unlockDocument(doc: StudentDocument): void {
    this.notify.confirm(
      'Unlock Document',
      `Unlock "${doc.documentName}" for ${doc.studentName}? This will change the status to PENDING, allowing the student to delete and re-upload this document.`,
      'Yes, Unlock', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      this.documentService.verifyDocument(
        doc._id,
        'REJECTED',
        'Document unlocked by admin for student to update. Please upload a new version if needed.'
      ).subscribe({
        next: (response) => {
          if (response.success) {
            this.snackBar.open(
              'Document unlocked successfully. Student can now update it.',
              'Close',
              { duration: 4000 }
            );
            this.loadDocuments();
          }
        },
        error: (error) => {
          console.error('Error unlocking document:', error);
          this.snackBar.open('Error unlocking document', 'Close', { duration: 3000 });
        }
      });
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

  getStatusIcon(status: string): string {
    switch (status) {
      case 'VERIFIED': return 'check_circle';
      case 'REJECTED': return 'cancel';
      case 'PENDING': return 'schedule';
      default: return 'help';
    }
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
  // ========== BULK OPERATIONS ==========
  
  toggleSelectAll(): void {
    this.allSelected = !this.allSelected;
    if (this.allSelected) {
      this.selectedDocuments = this.paginatedDocuments
        .filter(doc => doc.status === 'PENDING')
        .map(doc => doc._id);
    } else {
      this.selectedDocuments = [];
    }
  }
  
  toggleDocumentSelection(docId: string): void {
    const index = this.selectedDocuments.indexOf(docId);
    if (index > -1) {
      this.selectedDocuments.splice(index, 1);
    } else {
      this.selectedDocuments.push(docId);
    }
    this.updateAllSelectedState();
  }
  
  isDocumentSelected(docId: string): boolean {
    return this.selectedDocuments.includes(docId);
  }
  
  updateAllSelectedState(): void {
    const pendingDocs = this.paginatedDocuments.filter(doc => doc.status === 'PENDING');
    this.allSelected = pendingDocs.length > 0 && 
                       pendingDocs.every(doc => this.selectedDocuments.includes(doc._id));
  }
  
  bulkVerifySelected(): void {
    if (this.selectedDocuments.length === 0) return;
    this.notify.confirm(
      'Bulk Verify',
      `Verify ${this.selectedDocuments.length} selected documents? All selected documents will be marked as VERIFIED.`,
      'Yes, Verify All', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      let completed = 0;
      let failed = 0;
      this.selectedDocuments.forEach(docId => {
        this.documentService.verifyDocument(docId, 'VERIFIED', 'Bulk verified by admin').subscribe({
          next: () => {
            completed++;
            if (completed + failed === this.selectedDocuments.length) {
              this.finishBulkVerification(completed, failed);
            }
          },
          error: () => {
            failed++;
            if (completed + failed === this.selectedDocuments.length) {
              this.finishBulkVerification(completed, failed);
            }
          }
        });
      });
    });
  }
  
  finishBulkVerification(completed: number, failed: number): void {
    this.selectedDocuments = [];
    this.allSelected = false;
    this.loadDocuments();
    
    if (failed === 0) {
      this.snackBar.open(
        `Successfully verified ${completed} documents`,
        'Close',
        { duration: 4000 }
      );
    } else {
      this.snackBar.open(
        `Verified ${completed} documents, ${failed} failed`,
        'Close',
        { duration: 4000 }
      );
    }
  }
  
  openBulkUploadDialog(): void {
    this.loadStudents();
    this.studentSearchControl.setValue('');
    this.showBulkUploadDialog = true;
  }
  
  closeBulkUploadDialog(): void {
    this.showBulkUploadDialog = false;
    this.bulkUploadForm = {
      studentEmail: '',
      documentType: '',
      files: []
    };
    this.studentSearchControl.setValue('');
  }
  
  selectStudent(student: any): void {
    this.bulkUploadForm.studentEmail = this.getStudentEmail(student);
    this.studentSearchControl.setValue(this.getStudentName(student) + ' (' + this.getStudentEmail(student) + ')');
  }
  
  displayStudentFn(student: any): string {
    return student ? `${this.getStudentName(student)} (${this.getStudentEmail(student)})` : '';
  }
  
  loadStudents(): void {
    const pageSize = 100; // backend caps at 100
    let totalFromServer: number | null = null;

    this.documentService.getAllStudents({ page: 1, limit: pageSize }).pipe(
      expand((resp: any) => {
        if (!resp?.success) return EMPTY;
        const pagination = resp?.pagination;
        const page = Number(pagination?.page || 1);
        const pages = Number(pagination?.pages || 1);
        if (totalFromServer === null && Number.isFinite(Number(pagination?.total))) {
          totalFromServer = Number(pagination.total);
        }
        if (page >= pages) return EMPTY;
        return this.documentService.getAllStudents({ page: page + 1, limit: pageSize });
      }),
      reduce((all: any[], resp: any) => {
        const batch = (resp?.data ?? []) as any[];
        return all.concat(batch);
      }, [])
    ).subscribe({
      next: (allStudents: any[]) => {
        this.students = allStudents;
        this.filteredStudents = this.students;
        this.markVerifiedFilteredStudents = this.students;
        this.refreshCrmFilterOptions();
        if (totalFromServer !== null) {
          this.stats.totalStudents = totalFromServer;
        } else {
          this.loadStats();
        }
        this.buildStudentGroups();
      },
      error: (error) => {
        console.error('❌ Error loading students:', error);
        this.snackBar.open('Error loading students list', 'Close', { duration: 3000 });
      }
    });
  }
  
  onBulkFilesSelected(event: any): void {
    const files = Array.from(event.target.files) as File[];
    this.bulkUploadForm.files = files;
  }
  
  uploadBulkDocuments(): void {
    if (!this.bulkUploadForm.studentEmail || !this.bulkUploadForm.documentType || this.bulkUploadForm.files.length === 0) {
      this.snackBar.open('Please fill all fields and select files', 'Close', { duration: 3000 });
      return;
    }
    
    let completed = 0;
    let failed = 0;
    const total = this.bulkUploadForm.files.length;
    
    this.bulkUploadForm.files.forEach((file, index) => {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('studentEmail', this.bulkUploadForm.studentEmail);
      formData.append('documentType', this.bulkUploadForm.documentType);
      formData.append('documentName', file.name);
      formData.append('description', `Uploaded by admin on behalf of student`);
      
      this.documentService.adminUploadDocument(formData).subscribe({
        next: () => {
          completed++;
          if (completed + failed === total) {
            this.finishBulkUpload(completed, failed);
          }
        },
        error: (error) => {
          console.error('Error uploading file:', error);
          failed++;
          if (completed + failed === total) {
            this.finishBulkUpload(completed, failed);
          }
        }
      });
    });
  }
  
  finishBulkUpload(completed: number, failed: number): void {
    this.closeBulkUploadDialog();
    this.loadDocuments();
    
    if (failed === 0) {
      this.snackBar.open(
        `Successfully uploaded ${completed} documents`,
        'Close',
        { duration: 4000 }
      );
    } else {
      this.snackBar.open(
        `Uploaded ${completed} documents, ${failed} failed`,
        'Close',
        { duration: 4000 }
      );
    }
  }
  
  // ========== MARK AS VERIFIED WITHOUT UPLOAD ==========
  
  openMarkVerifiedDialog(): void {
    this.loadStudents();
    this.markVerifiedStudentControl.setValue('');
    this.showMarkVerifiedDialog = true;
  }
  
  closeMarkVerifiedDialog(): void {
    this.showMarkVerifiedDialog = false;
    this.markVerifiedForm = {
      studentEmail: '',
      documentType: '',
      documentName: '',
      verificationNotes: ''
    };
    this.markVerifiedStudentControl.setValue('');
  }
  
  selectMarkVerifiedStudent(student: any): void {
    this.markVerifiedForm.studentEmail = this.getStudentEmail(student);
    this.markVerifiedStudentControl.setValue(this.getStudentName(student) + ' (' + this.getStudentEmail(student) + ')');
  }
  
  markAsVerifiedWithoutUpload(): void {
    if (!this.markVerifiedForm.studentEmail || !this.markVerifiedForm.documentType || !this.markVerifiedForm.documentName) {
      this.snackBar.open('Please fill all required fields', 'Close', { duration: 3000 });
      return;
    }
    
    this.documentService.markDocumentAsVerified(this.markVerifiedForm).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open('Document marked as verified successfully', 'Close', { duration: 4000 });
          this.closeMarkVerifiedDialog();
          this.loadDocuments();
        }
      },
      error: (error) => {
        console.error('Error marking document as verified:', error);
        this.snackBar.open(error.error?.message || 'Error marking document as verified', 'Close', { duration: 3000 });
      }
    });
  }
  
  // ========== REQUIREMENTS MANAGEMENT ==========
  
  loadRequirements(): void {
    this.documentService.getDocumentRequirements().subscribe({
      next: (response) => {
        if (response.success) {
          this.requirements = response.requirements;
          // Build documentTypes dropdown from requirements
          this.documentTypes = this.requirements.map(r => ({
            value: r.type,
            label: r.label
          }));
        }
      },
      error: (error) => {
        console.error('Error loading requirements:', error);
      }
    });
  }
  
  openRequirementForm(requirement?: any): void {
    if (requirement) {
      this.editingRequirement = requirement;
      this.requirementForm = {
        type: requirement.type,
        label: requirement.label,
        description: requirement.description,
        required: requirement.required,
        category: requirement.category,
        order: requirement.order
      };
    } else {
      this.editingRequirement = null;
      this.requirementForm = {
        type: '',
        label: '',
        description: '',
        required: false,
        category: 'OTHER',
        order: this.requirements.length
      };
    }
    this.showRequirementForm = true;
  }
  
  closeRequirementForm(): void {
    this.showRequirementForm = false;
    this.editingRequirement = null;
  }
  
  saveRequirement(): void {
    if (!this.requirementForm.label || !this.requirementForm.description) {
      this.snackBar.open('Please fill in all required fields', 'Close', { duration: 3000 });
      return;
    }
    
    if (this.editingRequirement) {
      // Update existing
      this.documentService.updateDocumentRequirement(
        this.editingRequirement._id,
        this.requirementForm
      ).subscribe({
        next: (response) => {
          if (response.success) {
            this.snackBar.open('Requirement updated successfully', 'Close', { duration: 3000 });
            this.closeRequirementForm();
            this.loadRequirements();
          }
        },
        error: (error) => {
          console.error('Error updating requirement:', error);
          this.snackBar.open('Error updating requirement', 'Close', { duration: 3000 });
        }
      });
    } else {
      // Create new
      if (!this.requirementForm.type) {
        this.requirementForm.type = this.requirementForm.label.toUpperCase().replace(/\s+/g, '_');
      }
      
      this.documentService.createDocumentRequirement(this.requirementForm).subscribe({
        next: (response) => {
          if (response.success) {
            this.snackBar.open('Requirement created successfully', 'Close', { duration: 3000 });
            this.closeRequirementForm();
            this.loadRequirements();
          }
        },
        error: (error) => {
          console.error('Error creating requirement:', error);
          this.snackBar.open(error.error?.message || 'Error creating requirement', 'Close', { duration: 3000 });
        }
      });
    }
  }
  
  deleteRequirement(requirement: any): void {
    this.notify.confirm(
      'Delete Requirement',
      `Delete "${requirement.label}"? This will hide it from students but won't delete existing uploaded documents of this type.`,
      'Yes, Delete', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      this.documentService.deleteDocumentRequirement(requirement._id).subscribe({
        next: (response) => {
          if (response.success) {
            this.snackBar.open('Requirement deleted successfully', 'Close', { duration: 3000 });
            this.loadRequirements();
          }
        },
        error: (error) => {
          console.error('Error deleting requirement:', error);
          this.snackBar.open('Error deleting requirement', 'Close', { duration: 3000 });
        }
      });
    });
  }

  openEmailDialog(studentName: string, studentEmail: string): void {
    this.emailForm = { to: studentEmail, studentName, subject: '', message: '' };
    this.showEmailDialog = true;
  }

  closeEmailDialog(): void {
    this.showEmailDialog = false;
    this.sendingEmail = false;
  }

  sendEmail(): void {
    if (!this.emailForm.subject.trim() || !this.emailForm.message.trim()) {
      this.snackBar.open('Subject and message are required', 'Close', { duration: 3000 });
      return;
    }
    this.sendingEmail = true;
    this.documentService.sendEmailToStudent({
      to: this.emailForm.to,
      subject: this.emailForm.subject,
      message: this.emailForm.message
    }).subscribe({
      next: () => {
        this.snackBar.open(`Email sent to ${this.emailForm.studentName}`, 'Close', { duration: 3000 });
        this.closeEmailDialog();
      },
      error: () => {
        this.snackBar.open('Failed to send email', 'Close', { duration: 3000 });
        this.sendingEmail = false;
      }
    });
  }
}
