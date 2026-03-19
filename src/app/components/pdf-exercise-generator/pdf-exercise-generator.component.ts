// src/app/components/pdf-exercise-generator/pdf-exercise-generator.component.ts

import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { environment } from '../../../environments/environment';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DigitalExerciseService, ExerciseQuestion } from '../../services/digital-exercise.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';

type WizardStep = 1 | 2 | 3 | 4;

interface ReviewQuestion {
  type: 'mcq' | 'matching' | 'fill-blank' | 'pronunciation' | 'question-answer' | 'listening';
  // MCQ
  question?: string;
  imageUrl?: string;
  options?: string[];
  correctAnswerIndex?: number;
  explanation?: string;
  // Matching
  instruction?: string;
  pairs?: Array<{ left: string; right: string }>;
  // Fill-blank
  sentence?: string;
  answers?: string[];
  hint?: string;
  caseSensitive?: boolean;
  // Pronunciation
  word?: string;
  phonetic?: string;
  translation?: string;
  acceptedVariants?: string[];
  // Question / Answer
  prompt?: string;
  sampleAnswers?: string[];
  similarityThreshold?: number;
  scoringMode?: 'full' | 'proportional';
  // Listening
  mediaUrl?: string;
  expectedTranscript?: string;
  attemptMode?: 'typing' | 'typing-or-speech';
  transcribing?: boolean;
  // Common
  points: number;
  // Editor state
  expanded?: boolean;
  aiGenerated?: boolean;
}

const PROGRESS_MESSAGES = [
  'Reading your PDF...',
  'Analysing content structure...',
  'Detecting existing questions...',
  'Building exercise prompts...',
  'Generating questions with AI...',
  'Structuring answers and feedback...',
  'Finalising your exercises...'
];

@Component({
  selector: 'app-pdf-exercise-generator',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './pdf-exercise-generator.component.html',
  styleUrls: ['./pdf-exercise-generator.component.css']
})
export class PdfExerciseGeneratorComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('listeningFileInput') listeningFileInput!: ElementRef<HTMLInputElement>;

  currentStep: WizardStep = 1;

  // ── Step 1: Upload ──────────────────────────────────────────────────────────
  selectedFile: File | null = null;
  isDragging = false;
  uploading = false;
  uploadResult: any = null;

  // ── Step 2: Configure ───────────────────────────────────────────────────────
  // typeCounts drives everything: selected = count > 0
  typeCounts: Record<string, number> = {
    mcq: 5,
    matching: 0,
    'fill-blank': 0,
    pronunciation: 0,
    'question-answer': 0
  };

  targetLanguage = 'German';
  nativeLanguage = 'English';
  level = 'A1';
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' = 'Beginner';

  // ── Step 3: Processing ──────────────────────────────────────────────────────
  generating = false;
  progressStep = 0;
  progressPercent = 0;
  currentProgressMsg = '';
  progressTimer: any;
  generationError = '';

  // ── Step 4: Review ──────────────────────────────────────────────────────────
  reviewQuestions: ReviewQuestion[] = [];
  generationMeta: any = null;

  // Exercise metadata
  exerciseTitle = '';
  exerciseDescription = '';
  visibleToStudents = false;
  saving = false;

  // Inline editor state
  addingType = '';

  readonly questionTypes = [
    { value: 'mcq',             label: 'Multiple Choice',  desc: '4 options, 1 correct answer',      icon: 'quiz',              color: '#1976d2', bg: '#e8f4fd' },
    { value: 'matching',        label: 'Matching',          desc: 'Match word / phrase pairs',         icon: 'compare_arrows',    color: '#7b1fa2', bg: '#f3e5f5' },
    { value: 'fill-blank',      label: 'Fill in the Blanks',desc: 'Sentence with ___ gaps',            icon: 'text_fields',       color: '#388e3c', bg: '#e8f5e9' },
    { value: 'pronunciation',   label: 'Pronunciation',     desc: 'Speak a word aloud',               icon: 'record_voice_over', color: '#e65100', bg: '#fff3e0' },
    { value: 'question-answer', label: 'Question / Answer', desc: 'Student writes a short answer',    icon: 'short_text',        color: '#0d9488', bg: '#e0f2f1' }
  ];

  readonly levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly difficulties: Array<'Beginner' | 'Intermediate' | 'Advanced'> = ['Beginner', 'Intermediate', 'Advanced'];
  readonly languages = ['German', 'English'];
  readonly nativeLanguages = ['English', 'Tamil', 'Sinhala'];

  constructor(
    private exerciseService: DigitalExerciseService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.clearProgressTimer();
  }

  // ── Step 1: Upload ──────────────────────────────────────────────────────────

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.isDragging = true;
  }

  onDragLeave(): void {
    this.isDragging = false;
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragging = false;
    const file = e.dataTransfer?.files[0];
    if (file) this.selectFile(file);
  }

  onFileSelected(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.selectFile(file);
  }

  selectFile(file: File): void {
    if (file.type !== 'application/pdf') {
      this.showError('Only PDF files are accepted.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      this.showError('File is too large. Maximum size is 15 MB.');
      return;
    }
    this.selectedFile = file;
    this.uploadResult = null;
  }

  uploadPdf(): void {
    if (!this.selectedFile) return;
    this.uploading = true;

    this.exerciseService.uploadPdf(this.selectedFile).subscribe({
      next: (res) => {
        this.uploadResult = res;
        this.uploading = false;
      },
      error: (err) => {
        this.uploading = false;
        this.showError(err.error?.error || 'Upload failed. Please try again.');
      }
    });
  }

  removeFile(): void {
    this.selectedFile = null;
    this.uploadResult = null;
    if (this.fileInput) this.fileInput.nativeElement.value = '';
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // ── Step 2: Configure ───────────────────────────────────────────────────────

  get selectedTypes(): string[] {
    return Object.keys(this.typeCounts).filter(t => (this.typeCounts[t] ?? 0) > 0);
  }

  get maxQuestions(): number {
    return Object.values(this.typeCounts).reduce((s, v) => s + (v > 0 ? v : 0), 0);
  }

  isTypeSelected(type: string): boolean {
    return (this.typeCounts[type] ?? 0) > 0;
  }

  toggleType(type: string): void {
    if (this.isTypeSelected(type)) {
      // Only deselect if at least one other type remains selected
      if (this.selectedTypes.length > 1) {
        this.typeCounts[type] = 0;
      }
    } else {
      this.typeCounts[type] = 5;
    }
  }

  setCount(type: string, raw: any): void {
    const str = String(raw ?? '').trim();
    if (str === '') return; // user is mid-typing (cleared field), don't change
    const v = parseInt(str, 10);
    if (isNaN(v) || v < 0) return; // invalid input, ignore
    this.typeCounts[type] = v;
    // Type deselects only when explicitly set to 0
  }

  incrementCount(type: string): void {
    this.typeCounts[type] = (this.typeCounts[type] ?? 0) + 1;
  }

  decrementCount(type: string): void {
    const cur = this.typeCounts[type] ?? 0;
    if (cur > 0) this.typeCounts[type] = cur - 1;
  }

  // ── Step 3: Generate ────────────────────────────────────────────────────────

  startGeneration(): void {
    this.generating = true;
    this.generationError = '';
    this.progressStep = 0;
    this.progressPercent = 0;
    this.currentProgressMsg = PROGRESS_MESSAGES[0];
    this.startProgressSimulation();

    this.exerciseService.generateFromPdf({
      uploadId: this.uploadResult.uploadId,
      types: this.selectedTypes.length ? this.selectedTypes : ['mcq'],
      typeCounts: { ...this.typeCounts },
      targetLanguage: this.targetLanguage,
      nativeLanguage: this.nativeLanguage,
      level: this.level,
      difficulty: this.difficulty,
      maxQuestions: this.maxQuestions
    }).subscribe({
      next: (res) => {
        this.clearProgressTimer();
        this.progressPercent = 100;
        this.currentProgressMsg = 'Done! Preparing review...';
        this.generating = false;
        this.generationMeta = res;
        this.reviewQuestions = (res.questions || []).map((q: any) => ({
          ...q,
          expanded: false,
          aiGenerated: true
        }));
        // Pre-fill title/description from AI suggestions
        this.exerciseTitle = res.suggestedTitle || '';
        this.exerciseDescription = res.suggestedDescription || '';
        if (res.detectedLevel) this.level = res.detectedLevel;

        setTimeout(() => { this.currentStep = 4; }, 600);
      },
      error: (err) => {
        this.clearProgressTimer();
        this.generating = false;
        this.generationError = err.error?.error || 'AI generation failed. Please try again.';
      }
    });
  }

  private startProgressSimulation(): void {
    let msgIndex = 0;
    this.progressTimer = setInterval(() => {
      msgIndex = Math.min(msgIndex + 1, PROGRESS_MESSAGES.length - 1);
      this.currentProgressMsg = PROGRESS_MESSAGES[msgIndex];
      this.progressPercent = Math.min(this.progressPercent + Math.random() * 12 + 4, 92);
    }, 2200);
  }

  private clearProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  retryGeneration(): void {
    this.generationError = '';
    this.startGeneration();
  }

  // ── Step 4: Review & Edit ───────────────────────────────────────────────────

  toggleQuestion(i: number): void {
    this.reviewQuestions[i].expanded = !this.reviewQuestions[i].expanded;
  }

  removeQuestion(i: number): void {
    this.reviewQuestions.splice(i, 1);
  }

  moveQuestion(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.reviewQuestions.length) return;
    [this.reviewQuestions[i], this.reviewQuestions[j]] = [this.reviewQuestions[j], this.reviewQuestions[i]];
  }

  addBlankQuestion(type: string): void {
    const q: ReviewQuestion = { type: type as any, points: 1, expanded: true, aiGenerated: false };
    if (type === 'mcq') Object.assign(q, { question: '', options: ['', '', '', ''], correctAnswerIndex: 0, explanation: '' });
    else if (type === 'matching') Object.assign(q, { instruction: 'Match the items.', pairs: [{ left: '', right: '' }, { left: '', right: '' }] });
    else if (type === 'fill-blank') Object.assign(q, { sentence: '', answers: [''], hint: '', caseSensitive: false });
    else if (type === 'pronunciation') Object.assign(q, { word: '', phonetic: '', translation: '', acceptedVariants: [] });
    else if (type === 'question-answer') Object.assign(q, { prompt: '', sampleAnswers: [''], similarityThreshold: 70, scoringMode: 'full' });
    else if (type === 'listening') Object.assign(q, { prompt: 'Listen and type what you hear.', mediaUrl: '', expectedTranscript: '', attemptMode: 'typing-or-speech' });
    this.reviewQuestions.push(q);
    this.addingType = '';
  }

  // MCQ helpers
  addOption(q: ReviewQuestion): void { q.options!.push(''); }
  removeOption(q: ReviewQuestion, i: number): void {
    q.options!.splice(i, 1);
    if (q.correctAnswerIndex! >= q.options!.length) q.correctAnswerIndex = 0;
  }

  // Matching helpers
  addPair(q: ReviewQuestion): void { q.pairs!.push({ left: '', right: '' }); }
  removePair(q: ReviewQuestion, i: number): void { if (q.pairs!.length > 2) q.pairs!.splice(i, 1); }

  // Fill-blank
  onSentenceChange(q: ReviewQuestion): void {
    const count = (q.sentence!.match(/___/g) || []).length;
    while (q.answers!.length < count) q.answers!.push('');
    while (q.answers!.length > count) q.answers!.pop();
  }

  /** Insert ___ at cursor (if sentence field was focused) or at end. */
  insertBlank(q: ReviewQuestion): void {
    const blank = '___';
    const el = document.activeElement as HTMLTextAreaElement | null;
    if (el?.tagName === 'TEXTAREA' && typeof el.selectionStart === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd ?? start;
      const s = q.sentence || '';
      q.sentence = s.slice(0, start) + blank + s.slice(end);
      this.onSentenceChange(q);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + blank.length, start + blank.length); }, 0);
    } else {
      const s = (q.sentence || '').trimEnd();
      q.sentence = s + (s ? ' ' : '') + blank;
      this.onSentenceChange(q);
    }
  }

  getBlankCount(q: ReviewQuestion): number {
    return (q.sentence?.match(/___/g) || []).length;
  }

  /** Stable trackBy so option/answer/pair rows are not recreated when text changes; keeps radio selection. */
  trackByIndex(_idx: number): number {
    return _idx;
  }

  // Pronunciation
  addVariant(q: ReviewQuestion): void { q.acceptedVariants!.push(''); }
  removeVariant(q: ReviewQuestion, i: number): void { q.acceptedVariants!.splice(i, 1); }

  // Question-Answer helpers
  addSampleAnswer(q: ReviewQuestion): void { q.sampleAnswers!.push(''); }
  removeSampleAnswer(q: ReviewQuestion, i: number): void {
    if (q.sampleAnswers!.length > 1) q.sampleAnswers!.splice(i, 1);
  }

  setThreshold(q: ReviewQuestion, raw: any): void {
    let v = parseInt(String(raw), 10);
    if (isNaN(v)) return;
    if (v < 0) v = 0;
    if (v > 100) v = 100;
    q.similarityThreshold = v;
  }

  triggerListeningFile(q: ReviewQuestion): void {
    (this as any).currentListeningQ = q;
    this.listeningFileInput?.nativeElement?.click();
  }

  onListeningFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const q = (this as any).currentListeningQ as ReviewQuestion | null;
    (this as any).currentListeningQ = null;
    input.value = '';
    if (!file || !q) return;
    this.exerciseService.uploadListeningMedia(file).subscribe({
      next: (res) => { q.mediaUrl = res.url; this.showSuccess('Audio uploaded'); },
      error: (err) => this.showError(err.error?.error || 'Upload failed')
    });
  }

  fetchListeningFromUrl(q: ReviewQuestion, url: string): void {
    if (!url?.trim()) { this.showError('Enter a valid URL'); return; }
    this.exerciseService.fetchListeningFromUrl(url.trim()).subscribe({
      next: (res) => { q.mediaUrl = res.url; this.showSuccess('Audio fetched'); },
      error: (err) => this.showError(err.error?.error || 'Fetch failed')
    });
  }

  generateListeningTranscript(q: ReviewQuestion): void {
    if (!q.mediaUrl) { this.showError('Upload or add audio URL first'); return; }
    q.transcribing = true;
    this.exerciseService.transcribeListening(q.mediaUrl).subscribe({
      next: (res) => {
        q.expectedTranscript = res.transcript;
        q.transcribing = false;
        this.showSuccess('Transcript generated. Verify and edit if needed.');
      },
      error: (err) => {
        q.transcribing = false;
        this.showError(err.error?.error || 'Transcription failed');
      }
    });
  }

  getMediaFullUrl(relative: string): string {
    if (!relative) return '';
    if (relative.startsWith('http')) return relative;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return base ? base + relative : relative;
  }

  // Validation
  isQuestionValid(q: ReviewQuestion): boolean {
    if (q.type === 'mcq') return !!(q.question?.trim()) && (q.options?.filter(o => o.trim()).length ?? 0) >= 2;
    if (q.type === 'matching') return (q.pairs?.filter(p => p.left.trim() && p.right.trim()).length ?? 0) >= 2;
    if (q.type === 'fill-blank') return !!(q.sentence?.trim()) && this.getBlankCount(q) > 0 && (q.answers?.every(a => a.trim()) ?? false);
    if (q.type === 'pronunciation') return !!(q.word?.trim());
    if (q.type === 'question-answer') return !!(q.prompt?.trim());
    if (q.type === 'listening') return !!(q.mediaUrl?.trim()) && !!(q.expectedTranscript?.trim());
    return false;
  }

  get validCount(): number { return this.reviewQuestions.filter(q => this.isQuestionValid(q)).length; }
  get totalPoints(): number { return this.reviewQuestions.reduce((s, q) => s + (q.points || 1), 0); }
  get canSave(): boolean { return !!(this.exerciseTitle.trim()) && this.validCount > 0; }

  // Save
  saveExercise(publish: boolean): void {
    if (!this.canSave) {
      this.showError('Please add a title and ensure at least one valid question.');
      return;
    }
    this.saving = true;
    const payload = {
      title: this.exerciseTitle.trim(),
      description: this.exerciseDescription.trim(),
      targetLanguage: this.targetLanguage as 'German' | 'English',
      nativeLanguage: this.nativeLanguage as 'English' | 'Tamil' | 'Sinhala',
      level: this.level as any,
      category: 'Grammar' as any,
      difficulty: this.difficulty,
      visibleToStudents: publish,
      questions: this.reviewQuestions.filter(q => this.isQuestionValid(q)).map(q => {
        const { expanded, aiGenerated, ...rest } = q;
        return rest;
      }) as ExerciseQuestion[],
      tags: ['ai-generated', 'pdf-import']
    };

    this.exerciseService.createExercise(payload).subscribe({
      next: () => {
        this.saving = false;
        // Cleanup PDF
        if (this.uploadResult?.uploadId) {
          this.exerciseService.cleanupPdf(this.uploadResult.uploadId).subscribe();
        }
        this.showSuccess(publish ? 'Exercise published!' : 'Exercise saved as draft!');
        setTimeout(() => this.router.navigate(['/admin/digital-exercises']), 1200);
      },
      error: (err) => {
        this.saving = false;
        this.showError(err.error?.error || 'Failed to save exercise.');
      }
    });
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  goToStep(step: number): void {
    if (step < this.currentStep) this.currentStep = step as WizardStep;
  }

  canProceedFrom(step: WizardStep): boolean {
    if (step === 1) return !!this.uploadResult?.success;
    if (step === 2) return this.selectedTypes.length > 0 && this.maxQuestions > 0;
    return true;
  }

  next(): void {
    if (this.currentStep === 2) {
      this.currentStep = 3;
      this.startGeneration();
    } else if (this.currentStep < 4) {
      this.currentStep = (this.currentStep + 1) as WizardStep;
    }
  }

  back(): void {
    if (this.currentStep > 1 && this.currentStep !== 3) {
      this.currentStep = (this.currentStep - 1) as WizardStep;
    }
  }

  cancel(): void {
    this.router.navigate(['/admin/digital-exercises']);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  getTypeInfo(type: string) {
    return this.questionTypes.find(t => t.value === type) || this.questionTypes[0];
  }

  getLevelColor(level: string): string {
    return this.exerciseService.getLevelColor(level);
  }

  getContentTypeLabel(ct: string): string {
    const labels: Record<string, string> = {
      questions_found: '✅ Questions detected in PDF — extracted directly',
      content_only: '📄 Content text — questions generated from material',
      mixed: '🔀 Mixed — some questions found, others generated'
    };
    return labels[ct] || ct;
  }

  private showSuccess(msg: string): void {
    this.snackBar.open(msg, '', { duration: 3000, panelClass: ['success-snack'] });
  }

  private showError(msg: string): void {
    this.snackBar.open(msg, 'Close', { duration: 5000, panelClass: ['error-snack'] });
  }
}
