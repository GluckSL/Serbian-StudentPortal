import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
import { AgreementService, AgreementTemplate, DynamicField, AiSuggestion } from '../../../services/agreement.service';
import { Subscription, interval } from 'rxjs';
import { takeWhile } from 'rxjs/operators';

type WizardStep = 'list' | 'upload' | 'preview' | 'save';

interface FieldDraft {
  id: string;
  label: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sampleText: string;
  placeholderToken?: string;
  fontSize: number;
  required: boolean;
}

const MAX_FIELDS = 20;

function fieldDraftFromDynamic(f: DynamicField): FieldDraft {
  const token = f.placeholderToken || f.sampleText || '';
  return {
    id: f.id,
    label: f.label,
    page: f.page,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    sampleText: f.sampleText ?? token ?? f.label ?? '',
    placeholderToken: token || undefined,
    fontSize: f.fontSize ?? 11,
    required: f.required !== false
  };
}

function emptyFieldDraft(): FieldDraft {
  return { id: '', label: '', page: 1, x: 0.05, y: 0.2, width: 0.35, height: 0.04, sampleText: '', fontSize: 11, required: true };
}

@Component({
  selector: 'app-agreement-templates',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule, MaterialModule],
  templateUrl: './agreement-templates.component.html',
  styleUrls: ['./agreement-templates.component.css']
})
export class AgreementTemplatesComponent implements OnInit, OnDestroy {
  readonly placeholderExample = '{{level}}';
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('pdfCanvas') pdfCanvasRef!: ElementRef<HTMLCanvasElement>;

  templates: AgreementTemplate[] = [];
  loading = false;
  refreshing = false;
  readonly skeletonCards = [0, 1, 2];
  deletingId: string | null = null;
  menuContext: AgreementTemplate | null = null;
  templateSearch = '';
  step: WizardStep = 'list';

  // Upload step state
  selectedFile: File | null = null;
  uploading = false;
  uploadProgress = 0;
  uploadPhaseLabel = '';
  uploadStatusDetail = '';
  private uploadProgressSub: Subscription | null = null;
  private processingTickSub: Subscription | null = null;
  uploadResult: {
    tempId: string;
    r2Key: string | null;
    docxR2Key?: string;
    fillMode?: 'docx' | 'overlay';
    pageCount: number;
    warning?: string;
  } | null = null;

  // Preview / field step state
  createdTemplateId = '';
  editingFillMode: 'docx' | 'overlay' = 'overlay';
  upgradingDocx = false;
  docxUpgradeFile: File | null = null;
  pdfPreviewUrl: SafeResourceUrl | null = null;
  pdfBlobUrl: string | null = null;
  currentPage = 1;
  totalPages = 0;
  analyzing = false;
  aiSuggestions: AiSuggestion[] = [];
  fields: FieldDraft[] = [];
  editingField: FieldDraft | null = null;
  newField: FieldDraft = emptyFieldDraft();

  // Save step state
  templateName = '';
  templateDescription = '';
  saving = false;
  locatingText = false;

  constructor(
    private svc: AgreementService,
    private snack: MatSnackBar,
    private sanitizer: DomSanitizer,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadTemplates();
  }

  ngOnDestroy(): void {
    this.clearUploadProgressTimers();
  }

  loadTemplates(force = false): void {
    const cached = !force ? this.svc.peekTemplatesList() : null;
    if (cached) {
      this.templates = cached;
      this.loading = false;
      this.refreshing = false;
      return;
    }

    const hasData = this.templates.length > 0;
    if (!hasData) this.loading = true;
    else if (force) this.refreshing = true;

    this.svc.getTemplates({ force }).subscribe({
      next: (r) => {
        this.templates = r.templates;
        this.loading = false;
        this.refreshing = false;
      },
      error: (e) => {
        this.snack.open(e.error?.message || 'Failed to load templates', 'Close', { duration: 3000 });
        this.loading = false;
        this.refreshing = false;
      }
    });
  }

  trackByTemplateId(_index: number, t: AgreementTemplate): string {
    return t._id;
  }

  startCreate(): void {
    this.resetWizard();
    this.step = 'upload';
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) {
      this.selectedFile = null;
      return;
    }
    if (!this.isAllowedTemplateFile(f)) {
      this.snack.open('Please upload a PDF, DOC, or DOCX file', 'Close', { duration: 3000 });
      input.value = '';
      this.selectedFile = null;
      return;
    }
    this.selectedFile = f;
  }

  private static readonly TEMPLATE_ACCEPT = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  private isAllowedTemplateFile(file: File): boolean {
    const name = file.name.toLowerCase();
    if (/\.(pdf|doc|docx)$/.test(name)) return true;
    return AgreementTemplatesComponent.TEMPLATE_ACCEPT.includes(file.type);
  }

  onFileDrop(event: DragEvent): void {
    event.preventDefault();
    const f = event.dataTransfer?.files[0];
    if (f && this.isAllowedTemplateFile(f)) this.selectedFile = f;
    else if (f) this.snack.open('Please upload a PDF, DOC, or DOCX file', 'Close', { duration: 3000 });
  }

  uploadPdf(): void {
    if (!this.selectedFile || !this.templateName.trim()) return;
    this.clearUploadProgressTimers();
    this.uploading = true;
    this.uploadProgress = 0;
    this.uploadPhaseLabel = 'Uploading file…';
    this.uploadStatusDetail = this.formatFileSize(this.selectedFile.size);

    this.uploadProgressSub = this.svc
      .uploadAndCreateTemplate(this.selectedFile, this.templateName, this.templateDescription)
      .subscribe({
        next: (ev) => {
          if (ev.kind === 'progress') {
            this.stopProcessingTick();
            this.uploadProgress = ev.percent;
            this.uploadPhaseLabel = 'Uploading file…';
            if (ev.total) {
              this.uploadStatusDetail = `${this.formatFileSize(ev.loaded)} / ${this.formatFileSize(ev.total)}`;
            }
            if (ev.percent >= 55) this.startProcessingTick();
            return;
          }
          if (ev.kind === 'processing') {
            this.uploadProgress = Math.max(this.uploadProgress, ev.percent);
            this.uploadPhaseLabel = ev.message;
            return;
          }
          if (ev.kind === 'complete') {
            this.finishUploadFromResponse(ev.body);
          }
        },
        error: (e) => this.failUpload(e.error?.message || 'Upload failed')
      });
  }

  private startProcessingTick(): void {
    if (this.processingTickSub) return;
    const messages = [
      'Converting document…',
      'Storing template in cloud…',
      'Preparing preview…'
    ];
    let tick = 0;
    this.uploadPhaseLabel = messages[0];
    this.processingTickSub = interval(900)
      .pipe(takeWhile(() => this.uploading && this.uploadProgress < 95))
      .subscribe(() => {
        tick += 1;
        this.uploadProgress = Math.min(94, this.uploadProgress + 2);
        this.uploadPhaseLabel = messages[Math.min(messages.length - 1, Math.floor(tick / 3))];
        this.uploadStatusDetail = 'Server is processing — large Word files may take a minute';
      });
  }

  private stopProcessingTick(): void {
    this.processingTickSub?.unsubscribe();
    this.processingTickSub = null;
  }

  private clearUploadProgressTimers(): void {
    this.uploadProgressSub?.unsubscribe();
    this.uploadProgressSub = null;
    this.stopProcessingTick();
  }

  private finishUploadFromResponse(r: {
    template: AgreementTemplate;
    tempId: string;
    r2Key: string | null;
    docxR2Key?: string;
    fillMode?: 'docx' | 'overlay';
    pageCount: number;
    conversion?: string;
    warning?: string;
  }): void {
    this.stopProcessingTick();
    this.uploadProgress = 100;
    this.uploadPhaseLabel = 'Complete';
    this.uploadStatusDetail = 'Opening field editor…';

    this.uploadResult = {
      tempId: r.tempId,
      r2Key: r.r2Key,
      docxR2Key: r.docxR2Key,
      fillMode: r.fillMode,
      pageCount: r.pageCount,
      warning: r.warning
    };
    this.totalPages = r.pageCount;

    if (r.warning) this.snack.open(r.warning, 'Close', { duration: 10000 });
    if (r.fillMode === 'docx') {
      this.snack.open('DOCX saved — placeholders will be replaced as real text (not white boxes).', 'Close', { duration: 6000 });
    } else if (r.conversion === 'libreoffice' || r.conversion === 'libreoffice-cli') {
      this.snack.open('Converted with LibreOffice. For real text editing, upload DOCX instead of PDF.', 'Close', { duration: 5000 });
    } else if (r.conversion === 'msword') {
      this.snack.open('Converted with Word. For real text editing, upload DOCX instead of PDF.', 'Close', { duration: 5000 });
    }

    if (!r.r2Key && !r.docxR2Key) {
      this.failUpload('Upload failed — no file stored');
      return;
    }

    this.createdTemplateId = r.template._id;
    this.templateName = r.template.name;
    this.editingFillMode = r.template.fillMode === 'docx' || !!r.template.docxR2Key ? 'docx' : 'overlay';

    setTimeout(() => {
      this.uploading = false;
      this.uploadProgress = 0;
      this.step = 'preview';
      if (r.template.r2Key) this.loadPdfPreview(r.template._id);
      else if (this.editingFillMode === 'docx') {
        this.snack.open(
          'Word file saved. PDF preview unavailable until LibreOffice/Word conversion works — use field preview on Share screen.',
          'Close',
          { duration: 8000 }
        );
        this.autoDetectPlaceholders();
      }
    }, 400);
  }

  private failUpload(message: string): void {
    this.clearUploadProgressTimers();
    this.uploading = false;
    this.uploadProgress = 0;
    this.uploadPhaseLabel = '';
    this.uploadStatusDetail = '';
    this.snack.open(message, 'Close', { duration: 4000 });
  }

  private formatFileSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  loadPdfPreview(id: string): void {
    this.svc.getTemplatePreviewUrl(id).subscribe({
      next: r => {
        if (this.pdfBlobUrl) URL.revokeObjectURL(this.pdfBlobUrl);
        this.pdfPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(r.url);
        this.autoDetectPlaceholders();
      },
      error: () => this.snack.open('Could not load PDF preview', 'Close', { duration: 3000 })
    });
  }

  /** Detect {{fieldName}} markers first; falls back to red text. */
  autoDetectPlaceholders(): void {
    if (!this.createdTemplateId) return;
    this.analyzing = true;
    this.svc.detectPlaceholders(this.createdTemplateId).subscribe({
      next: r => {
        this.analyzing = false;
        if (r.fields?.length) {
          this.fields = r.fields.map(fieldDraftFromDynamic);
          const hint =
            r.source === 'docx'
              ? `Found in DOCX: ${r.fields.map((f) => f.sampleText || f.id).join(', ')}`
              : r.source === 'brace'
                ? `Found {{placeholders}}: ${r.fields.map((f) => f.sampleText || f.id).join(', ')}`
                : `Detected ${r.fields.length} field(s) (PDF overlay mode)`;
          this.snack.open(hint, 'Close', { duration: 6000 });
        } else {
          this.snack.open(
            'No {{placeholders}} found. In Word use {{studentName}}, {{date}}, etc., then re-upload as PDF.',
            'Close',
            { duration: 7000 }
          );
        }
      },
      error: e => {
        this.analyzing = false;
        const msg =
          e.error?.message ||
          (typeof e.error === 'string' ? e.error : null) ||
          'Placeholder detection failed. Restart the server and try again.';
        this.snack.open(msg, 'Close', { duration: 6000 });
      }
    });
  }

  autoDetectRedFields(): void {
    this.autoDetectPlaceholders();
  }

  runAiAnalysis(): void {
    if (!this.createdTemplateId) return;
    this.analyzing = true;
    this.svc.analyzeTemplate(this.createdTemplateId).subscribe({
      next: r => {
        this.analyzing = false;
        if (r.source === 'red' && r.fields?.length) {
          this.fields = r.fields.map(fieldDraftFromDynamic);
          this.aiSuggestions = r.suggestions || [];
          this.snack.open(`Detected ${r.fields.length} red placeholder field(s)`, 'Close', { duration: 4000 });
          return;
        }
        this.aiSuggestions = r.suggestions;
        this.snack.open(`AI suggested ${r.suggestions.length} fields`, 'Close', { duration: 3000 });
      },
      error: e => { this.analyzing = false; this.snack.open(e.error?.message || 'Analysis failed', 'Close', { duration: 3000 }); }
    });
  }

  isFieldAlreadyAdded(id: string): boolean {
    return this.fields.some(f => f.id === id);
  }

  applySuggestion(s: AiSuggestion): void {
    if (this.fields.length >= MAX_FIELDS) { this.snack.open(`Maximum ${MAX_FIELDS} fields allowed`, 'Close', { duration: 2000 }); return; }
    const exists = this.fields.find(f => f.id === s.id);
    if (exists) return;
    const withCoords = s as AiSuggestion & Partial<DynamicField>;
    this.fields.push({
      id: s.id,
      label: s.label,
      page: s.page,
      x: withCoords.x ?? 0.05,
      y: withCoords.y ?? 0.3,
      width: withCoords.width ?? 0.3,
      height: withCoords.height ?? 0.05,
      sampleText: s.sampleText ?? s.label ?? '',
      fontSize: withCoords.fontSize ?? 11,
      required: true
    });
  }

  onNewFieldIdChange(): void {
    const id = (this.newField.id || '').trim();
    if (!id) return;
    if (!this.newField.sampleText?.includes('{{')) {
      this.newField.placeholderToken = `{{${id}}}`;
      this.newField.sampleText = this.newField.placeholderToken;
    }
    if (!this.newField.label) {
      this.newField.label = id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    }
  }

  /** Set {{id}} from Field ID, locate in PDF, then add to list. */
  locateAndAddPlaceholder(): void {
    const id = (this.newField.id || '').trim();
    if (!id) {
      this.snack.open('Enter a Field ID first (e.g. level)', 'Close', { duration: 3000 });
      return;
    }
    this.newField.sampleText = `{{${id}}}`;
    this.newField.placeholderToken = this.newField.sampleText;
    this.locateFromSampleText(true);
  }

  locateFromSampleText(andAdd = false): void {
    if (!this.createdTemplateId || !this.newField.sampleText?.trim()) return;
    this.locatingText = true;
    const query = this.newField.sampleText.trim();
    this.svc.locateTextInTemplate(this.createdTemplateId, query).subscribe({
      next: r => {
        this.locatingText = false;
        const f = r.field;
        if (f.page) this.newField.page = f.page;
        if (f.x != null) this.newField.x = f.x;
        if (f.y != null) this.newField.y = f.y;
        if (f.width != null) this.newField.width = f.width;
        if (f.height != null) this.newField.height = f.height;
        if (f.fontSize) this.newField.fontSize = f.fontSize;
        if (f.sampleText) {
          this.newField.sampleText = f.sampleText;
          this.newField.placeholderToken = f.sampleText;
        }
        if (!this.newField.label) this.newField.label = this.newField.id || f.sampleText || '';
        this.snack.open(`Found "${f.sampleText || query}" in PDF`, 'Close', { duration: 2500 });
        if (andAdd) this.addField();
      },
      error: e => {
        this.locatingText = false;
        this.snack.open(
          e.error?.message || `Could not find "${query}" in PDF. Check spelling/capital letters match the PDF.`,
          'Close',
          { duration: 5000 }
        );
      }
    });
  }

  private slugifyFieldId(label: string): string {
    const words = String(label).trim().replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return 'field';
    return words
      .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join('');
  }

  addField(): void {
    if (this.fields.length >= MAX_FIELDS) { this.snack.open(`Maximum ${MAX_FIELDS} fields allowed`, 'Close', { duration: 2000 }); return; }
    if (!this.newField.id || !this.newField.label) { this.snack.open('Field ID and label are required', 'Close', { duration: 2000 }); return; }
    if (!this.newField.sampleText?.includes('{{')) {
      this.newField.placeholderToken = `{{${this.newField.id}}}`;
      this.newField.sampleText = this.newField.placeholderToken;
    }
    this.fields.push({ ...this.newField });
    this.newField = emptyFieldDraft();
  }

  removeField(idx: number): void {
    this.fields.splice(idx, 1);
  }

  saveFields(): void {
    if (!this.createdTemplateId) return;
    if (this.fields.length === 0) { this.snack.open('Add at least one field', 'Close', { duration: 2000 }); return; }
    this.saving = true;
    const payload = this.fields.map((f) => ({
      ...f,
      placeholderToken: f.placeholderToken || (f.sampleText?.includes('{{') ? f.sampleText : `{{${f.id}}}`),
      sampleText: f.sampleText || f.placeholderToken || `{{${f.id}}}`
    })) as DynamicField[];
    this.svc.saveFields(this.createdTemplateId, payload).subscribe({
      next: () => {
        this.saving = false;
        this.snack.open('Template saved successfully!', 'Close', { duration: 3000 });
        this.step = 'list';
        this.svc.invalidateTemplatesCache();
        this.loadTemplates(true);
        this.resetWizard();
      },
      error: e => { this.saving = false; this.snack.open(e.error?.message || 'Save failed', 'Close', { duration: 3000 }); }
    });
  }

  editTemplate(t: AgreementTemplate): void {
    this.createdTemplateId = t._id;
    this.templateName = t.name;
    this.templateDescription = t.description || '';
    this.totalPages = t.pageCount;
    this.editingFillMode = t.fillMode === 'docx' || !!t.docxR2Key ? 'docx' : 'overlay';
    this.step = 'preview';
    this.pdfPreviewUrl = null;
    this.docxUpgradeFile = null;
    this.fields = [];

    this.svc.getTemplate(t._id).subscribe({
      next: (r) => {
        const full = r.template;
        this.totalPages = full.pageCount;
        this.editingFillMode = full.fillMode === 'docx' || !!full.docxR2Key ? 'docx' : 'overlay';
        this.fields = (full.dynamicFields || []).map(fieldDraftFromDynamic);
        this.loadPdfPreview(full._id);
      },
      error: (e) => {
        this.step = 'list';
        this.snack.open(e.error?.message || 'Could not load template', 'Close', { duration: 3000 });
      }
    });
  }

  onDocxUpgradeSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    if (!/\.docx$/i.test(f.name)) {
      this.snack.open('Please select a .docx file (Word document)', 'Close', { duration: 4000 });
      input.value = '';
      return;
    }
    this.docxUpgradeFile = f;
  }

  uploadDocxSource(): void {
    if (!this.createdTemplateId || !this.docxUpgradeFile) return;
    this.upgradingDocx = true;
    this.svc.uploadTemplateDocx(this.createdTemplateId, this.docxUpgradeFile).subscribe({
      next: r => {
        this.upgradingDocx = false;
        this.editingFillMode = 'docx';
        this.docxUpgradeFile = null;
        if (r.template?.pageCount) this.totalPages = r.template.pageCount;
        if (r.fields?.length) this.fields = r.fields.map(fieldDraftFromDynamic);
        if (r.warning) this.snack.open(r.warning, 'Close', { duration: 10000 });
        if (r.template?.r2Key) this.loadPdfPreview(this.createdTemplateId);
        this.snack.open(r.message || 'DOCX attached — real text editing enabled', 'Close', { duration: 6000 });
        this.loadTemplates();
      },
      error: e => {
        this.upgradingDocx = false;
        this.snack.open(e.error?.message || 'DOCX upload failed', 'Close', { duration: 5000 });
      }
    });
  }

  get filteredTemplates(): AgreementTemplate[] {
    const q = this.templateSearch.trim().toLowerCase();
    if (!q) return this.templates;
    return this.templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.dynamicFields?.some((f) => f.label.toLowerCase().includes(q) || f.id.toLowerCase().includes(q))
    );
  }

  get templateStats(): { total: number; word: number; overlay: number } {
    const word = this.templates.filter((t) => t.fillMode === 'docx' || t.docxR2Key).length;
    return { total: this.templates.length, word, overlay: this.templates.length - word };
  }

  isWordMode(t: AgreementTemplate): boolean {
    return t.fillMode === 'docx' || !!t.docxR2Key;
  }

  visibleFieldLabels(t: AgreementTemplate, max = 6): string[] {
    return (t.dynamicFields || []).slice(0, max).map((f) => f.label || f.id);
  }

  extraFieldCount(t: AgreementTemplate, max = 6): number {
    return Math.max(0, (t.dynamicFields?.length || 0) - max);
  }

  hideTemplate(t: AgreementTemplate, event?: Event): void {
    event?.stopPropagation();
    if (!confirm(`Hide "${t.name}" from the list? Files stay in storage; you can still use existing student agreements.`)) return;
    this.deletingId = t._id;
    this.svc.deleteTemplate(t._id, { soft: true }).subscribe({
      next: () => {
        this.deletingId = null;
        this.snack.open('Template hidden', 'Close', { duration: 2500 });
        this.loadTemplates();
      },
      error: (e) => {
        this.deletingId = null;
        this.snack.open(e.error?.message || 'Failed to hide template', 'Close', { duration: 4000 });
      }
    });
  }

  deleteTemplatePermanent(t: AgreementTemplate, event?: Event): void {
    event?.stopPropagation();
    const msg =
      `Permanently delete "${t.name}"?\n\n` +
      'This removes the template from the database, deletes PDF/DOCX files from R2, ' +
      'and removes any student agreements created from this template (test cleanup).\n\n' +
      'Cannot be undone.';
    if (!confirm(msg)) return;
    this.deletingId = t._id;
    this.svc.deleteTemplate(t._id, { cascade: true }).subscribe({
      next: (r) => {
        this.deletingId = null;
        this.snack.open(r.message || 'Template deleted', 'Close', { duration: 3500 });
        this.loadTemplates();
      },
      error: (e) => {
        this.deletingId = null;
        this.snack.open(e.error?.message || 'Delete failed', 'Close', { duration: 5000 });
      }
    });
  }

  goToStudentAgreements(): void {
    this.router.navigate(['/admin/agreements/templates']);
  }

  private resetWizard(): void {
    this.clearUploadProgressTimers();
    this.selectedFile = null;
    this.uploading = false;
    this.uploadProgress = 0;
    this.uploadPhaseLabel = '';
    this.uploadStatusDetail = '';
    this.uploadResult = null;
    this.createdTemplateId = '';
    this.pdfPreviewUrl = null;
    this.pdfBlobUrl = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.analyzing = false;
    this.aiSuggestions = [];
    this.fields = [];
    this.newField = emptyFieldDraft();
    this.templateName = '';
    this.templateDescription = '';
    this.saving = false;
    this.editingFillMode = 'overlay';
    this.docxUpgradeFile = null;
    this.upgradingDocx = false;
  }
}
