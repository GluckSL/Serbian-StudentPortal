import { Component, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
import { AgreementService, AgreementTemplate, DynamicField, AiSuggestion } from '../../../services/agreement.service';

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
  fontSize: number;
  required: boolean;
}

function fieldDraftFromDynamic(f: DynamicField): FieldDraft {
  return {
    id: f.id,
    label: f.label,
    page: f.page,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    sampleText: f.sampleText ?? f.label ?? '',
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
export class AgreementTemplatesComponent implements OnInit {
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('pdfCanvas') pdfCanvasRef!: ElementRef<HTMLCanvasElement>;

  templates: AgreementTemplate[] = [];
  loading = false;
  step: WizardStep = 'list';

  // Upload step state
  selectedFile: File | null = null;
  uploading = false;
  uploadResult: { tempId: string; r2Key: string; pageCount: number } | null = null;

  // Preview / field step state
  createdTemplateId = '';
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

  loadTemplates(): void {
    this.loading = true;
    this.svc.getTemplates().subscribe({
      next: r => { this.templates = r.templates; this.loading = false; },
      error: e => { this.snack.open(e.error?.message || 'Failed to load templates', 'Close', { duration: 3000 }); this.loading = false; }
    });
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
    if (!this.selectedFile) return;
    this.uploading = true;
    this.svc.uploadTemplatePdf(this.selectedFile).subscribe({
      next: r => {
        this.uploadResult = r;
        this.totalPages = r.pageCount;
        if (r.conversion === 'libreoffice') {
          this.snack.open('Converted with LibreOffice — layout preserved.', 'Close', { duration: 4000 });
        } else if (r.conversion === 'msword') {
          this.snack.open('Converted with Microsoft Word — layout preserved.', 'Close', { duration: 4000 });
        }
        const name = this.templateName || this.selectedFile!.name.replace(/\.(pdf|docx?)$/i, '');
        this.svc.createTemplate({ name, description: this.templateDescription, r2Key: r.r2Key, pageCount: r.pageCount, tempId: r.tempId }).subscribe({
          next: cr => {
            this.createdTemplateId = cr.template._id;
            this.templateName = cr.template.name;
            this.uploading = false;
            this.step = 'preview';
            this.loadPdfPreview(cr.template._id);
          },
          error: e => { this.uploading = false; this.snack.open(e.error?.message || 'Create failed', 'Close', { duration: 3000 }); }
        });
      },
      error: e => { this.uploading = false; this.snack.open(e.error?.message || 'Upload failed', 'Close', { duration: 3000 }); }
    });
  }

  loadPdfPreview(id: string): void {
    this.svc.getTemplatePreviewUrl(id).subscribe({
      next: r => {
        if (this.pdfBlobUrl) URL.revokeObjectURL(this.pdfBlobUrl);
        this.pdfPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(r.url);
        this.autoDetectRedFields();
      },
      error: () => this.snack.open('Could not load PDF preview', 'Close', { duration: 3000 })
    });
  }

  /** Words shown in red in the PDF are treated as dynamic placeholders. */
  autoDetectRedFields(): void {
    if (!this.createdTemplateId) return;
    this.analyzing = true;
    this.svc.detectRedFields(this.createdTemplateId).subscribe({
      next: r => {
        this.analyzing = false;
        if (r.fields?.length) {
          this.fields = r.fields.map(fieldDraftFromDynamic);
          this.snack.open(
            `Detected ${r.fields.length} red placeholder field(s): ${r.fields.map((f) => f.label).join(', ')}`,
            'Close',
            { duration: 5000 }
          );
        } else {
          this.snack.open(
            'No red text detected. Mark placeholders in red in Word/PDF, or use AI Suggest Fields.',
            'Close',
            { duration: 5000 }
          );
        }
      },
      error: e => {
        this.analyzing = false;
        this.snack.open(e.error?.message || 'Red field detection failed', 'Close', { duration: 4000 });
      }
    });
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
    if (this.fields.length >= 7) { this.snack.open('Maximum 7 fields allowed', 'Close', { duration: 2000 }); return; }
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

  locateFromSampleText(): void {
    if (!this.createdTemplateId || !this.newField.sampleText?.trim()) return;
    this.locatingText = true;
    this.svc.locateTextInTemplate(this.createdTemplateId, this.newField.sampleText.trim()).subscribe({
      next: r => {
        this.locatingText = false;
        const f = r.field;
        if (f.page) this.newField.page = f.page;
        if (f.x != null) this.newField.x = f.x;
        if (f.y != null) this.newField.y = f.y;
        if (f.width != null) this.newField.width = f.width;
        if (f.height != null) this.newField.height = f.height;
        if (f.fontSize) this.newField.fontSize = f.fontSize;
        if (f.sampleText) this.newField.sampleText = f.sampleText;
        if (!this.newField.label) this.newField.label = f.sampleText || this.newField.sampleText;
        if (!this.newField.id) this.newField.id = this.slugifyFieldId(this.newField.label);
        this.snack.open('Position found in PDF', 'Close', { duration: 2500 });
      },
      error: e => {
        this.locatingText = false;
        this.snack.open(e.error?.message || 'Could not locate text in PDF', 'Close', { duration: 4000 });
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
    if (this.fields.length >= 7) { this.snack.open('Maximum 7 fields allowed', 'Close', { duration: 2000 }); return; }
    if (!this.newField.id || !this.newField.label) { this.snack.open('Field ID and label are required', 'Close', { duration: 2000 }); return; }
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
    this.svc.saveFields(this.createdTemplateId, this.fields as DynamicField[]).subscribe({
      next: () => {
        this.saving = false;
        this.snack.open('Template saved successfully!', 'Close', { duration: 3000 });
        this.step = 'list';
        this.loadTemplates();
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
    this.fields = (t.dynamicFields || []).map(fieldDraftFromDynamic);
    this.step = 'preview';
    this.pdfPreviewUrl = null;
    this.loadPdfPreview(t._id);
  }

  deleteTemplate(id: string): void {
    if (!confirm('Deactivate this template? Existing agreements will not be affected.')) return;
    this.svc.deleteTemplate(id).subscribe({
      next: () => { this.snack.open('Template deactivated', 'Close', { duration: 2000 }); this.loadTemplates(); },
      error: e => this.snack.open(e.error?.message || 'Delete failed', 'Close', { duration: 3000 })
    });
  }

  goToStudentAgreements(): void {
    this.router.navigate(['/admin/agreements/templates']);
  }

  private resetWizard(): void {
    this.selectedFile = null;
    this.uploading = false;
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
  }
}
