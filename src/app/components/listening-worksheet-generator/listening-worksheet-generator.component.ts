import { Component, OnDestroy, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DigitalExerciseService, ExerciseQuestion } from '../../services/digital-exercise.service';
import { environment } from '../../../environments/environment';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

type WizardStep = 1 | 2 | 3 | 4;

type SupportedWorksheetQuestionType = 'mcq' | 'fill-blank' | 'question-answer' | 'pronunciation';

interface ReviewQuestion {
  type: SupportedWorksheetQuestionType;
  points: number;
  expanded?: boolean;
  aiGenerated?: boolean;

  // MCQ
  question?: string;
  options?: string[];
  correctAnswerIndex?: number;
  explanation?: string;

  // Fill blank
  sentence?: string;
  answers?: string[];
  hint?: string;
  caseSensitive?: boolean;

  // Question / answer
  prompt?: string;
  sampleAnswers?: string[];
  similarityThreshold?: number;
  scoringMode?: 'full' | 'proportional';

  // Pronunciation
  word?: string;
  phonetic?: string;
  translation?: string;
  acceptedVariants?: string[];
  audioUrl?: string | null;
}

const PROGRESS_MESSAGES = [
  'Reading your PDF...',
  'Analyzing the worksheet structure...',
  'Extracting questions...',
  'Finalising the exercise...',
  'Preparing review...'
];

@Component({
  selector: 'app-listening-worksheet-generator',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSnackBarModule, MatTooltipModule],
  templateUrl: './listening-worksheet-generator.component.html',
  styleUrls: ['./listening-worksheet-generator.component.css']
})
export class ListeningWorksheetGeneratorComponent implements OnInit, OnDestroy {
  @ViewChild('audioFileInput') audioFileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('pdfFileInput') pdfFileInput!: ElementRef<HTMLInputElement>;

  currentStep: WizardStep = 1;
  readonly steps: WizardStep[] = [1, 2, 3, 4];

  // Audio (single shared audio for the whole exercise)
  selectedAudioFile: File | null = null;
  audioUploading = false;
  sharedAudioUrl = '';

  // PDF
  selectedPdfFile: File | null = null;
  pdfUploading = false;
  uploadResult: any = null;
  isDragging = false;

  // Configuration
  targetLanguage = 'German';
  nativeLanguage = 'English';
  level = 'A1';
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' = 'Beginner';
  maxQuestions = 25;

  // Processing
  generating = false;
  progressStep = 0;
  progressPercent = 0;
  currentProgressMsg = '';
  progressTimer: any;
  generationError = '';

  // Review + save
  reviewQuestions: ReviewQuestion[] = [];
  generationMeta: any = null;
  exerciseTitle = '';
  exerciseDescription = '';
  visibleToStudents = false;
  saving = false;

  questionTypes: Array<{ value: SupportedWorksheetQuestionType; label: string; icon: string }> = [
    { value: 'mcq', label: 'Multiple Choice', icon: 'quiz' },
    { value: 'fill-blank', label: 'Fill in the Blanks', icon: 'text_fields' },
    { value: 'question-answer', label: 'Question / Answer', icon: 'short_text' },
    { value: 'pronunciation', label: 'Pronunciation', icon: 'record_voice_over' }
  ];

  constructor(
    private exerciseService: DigitalExerciseService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.clearProgressTimer();
  }

  // ───────────────────────────────────────────────────────────
  // Step navigation helpers
  // ───────────────────────────────────────────────────────────

  canProceedFrom(step: WizardStep): boolean {
    if (step === 1) {
      return !!this.sharedAudioUrl && !!this.uploadResult?.uploadId;
    }
    if (step === 2) {
      return this.maxQuestions > 0;
    }
    return true;
  }

  next(): void {
    if (this.currentStep === 2) {
      this.currentStep = 3;
      this.startExtraction();
      return;
    }
    if (this.currentStep < 4) this.currentStep = (this.currentStep + 1) as WizardStep;
  }

  back(): void {
    if (this.currentStep > 1 && this.currentStep !== 3) this.currentStep = (this.currentStep - 1) as WizardStep;
  }

  goToStep(step: WizardStep): void {
    if (step < this.currentStep) this.currentStep = step;
  }

  cancel(): void {
    this.router.navigate(['/admin/digital-exercises']);
  }

  // ───────────────────────────────────────────────────────────
  // Audio upload (shared)
  // ───────────────────────────────────────────────────────────

  triggerAudioUpload(): void {
    this.audioFileInputValueReset();
    this.audioFileInput?.nativeElement?.click();
  }

  private audioFileInputValueReset(): void {
    if (this.audioFileInput?.nativeElement) this.audioFileInput.nativeElement.value = '';
  }

  onAudioSelected(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.selectedAudioFile = file;
    this.sharedAudioUrl = '';
    this.uploadResult = this.uploadResult; // keep PDF result
    // Auto-upload immediately after selection.
    this.uploadAudio();
  }

  uploadAudio(): void {
    if (!this.selectedAudioFile) return;
    this.audioUploading = true;
    this.exerciseService.uploadListeningMedia(this.selectedAudioFile).subscribe({
      next: (res) => {
        this.sharedAudioUrl = res.url;
        this.audioUploading = false;
        this.showSuccess('Audio uploaded');
      },
      error: (err) => {
        this.audioUploading = false;
        this.showError(err?.error?.error || 'Audio upload failed');
      }
    });
  }

  // ───────────────────────────────────────────────────────────
  // PDF upload
  // ───────────────────────────────────────────────────────────

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
    const file = e.dataTransfer?.files?.[0];
    if (file) this.selectPdfFile(file);
  }

  onPdfSelected(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.selectPdfFile(file);
  }

  private selectPdfFile(file: File): void {
    if (file.type !== 'application/pdf') {
      this.showError('Only PDF files are accepted.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      this.showError('File is too large. Maximum size is 15 MB.');
      return;
    }
    this.selectedPdfFile = file;
    this.uploadResult = null;
    // Auto-upload immediately after selection.
    this.uploadPdf();
  }

  uploadPdf(): void {
    if (!this.selectedPdfFile) return;
    this.pdfUploading = true;
    this.exerciseService.uploadPdf(this.selectedPdfFile).subscribe({
      next: (res) => {
        this.uploadResult = res;
        this.pdfUploading = false;
        this.showSuccess('PDF read successfully');
      },
      error: (err) => {
        this.pdfUploading = false;
        this.showError(err?.error?.error || 'Upload failed. Please try again.');
      }
    });
  }

  removePdf(): void {
    this.selectedPdfFile = null;
    this.uploadResult = null;
    if (this.pdfFileInput) this.pdfFileInput.nativeElement.value = '';
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  getMediaFullUrl(relative: string): string {
    if (!relative) return '';
    if (relative.startsWith('http')) return relative;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return base ? base + relative : relative;
  }

  // ───────────────────────────────────────────────────────────
  // Extraction (backend call)
  // ───────────────────────────────────────────────────────────

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

  startExtraction(): void {
    this.generating = true;
    this.generationError = '';
    this.progressPercent = 0;
    this.currentProgressMsg = PROGRESS_MESSAGES[0];

    this.startProgressSimulation();

    this.exerciseService
      .generateListeningFromWorksheet({
        uploadId: this.uploadResult.uploadId,
        audioUrl: this.sharedAudioUrl,
        targetLanguage: this.targetLanguage,
        nativeLanguage: this.nativeLanguage,
        level: this.level,
        difficulty: this.difficulty,
        maxQuestions: this.maxQuestions
      })
      .subscribe({
        next: (res) => {
          this.clearProgressTimer();
          this.progressPercent = 100;
          this.generating = false;
          this.generationMeta = res;
          this.exerciseTitle = res.suggestedTitle || '';
          this.exerciseDescription = res.suggestedDescription || '';
          if (res.detectedLevel) this.level = res.detectedLevel;
          this.reviewQuestions = (res.questions || []).map((q: any): ReviewQuestion => {
            const normalized: ReviewQuestion = {
              ...q,
              expanded: false,
              aiGenerated: true,
              points: q.points || 1,
              type: q.type
            };

            if (normalized.type === 'mcq') {
              normalized.options = Array.isArray(normalized.options) && normalized.options.length ? normalized.options : ['', '', '', ''];
              if (normalized.correctAnswerIndex == null) normalized.correctAnswerIndex = 0;
              normalized.explanation = normalized.explanation ?? '';
            }

            if (normalized.type === 'fill-blank') {
              normalized.sentence = normalized.sentence ?? '';
              normalized.answers = Array.isArray(normalized.answers) && normalized.answers.length ? normalized.answers : [''];
              normalized.hint = normalized.hint ?? '';
              normalized.caseSensitive = normalized.caseSensitive ?? false;
            }

            if (normalized.type === 'question-answer') {
              normalized.prompt = normalized.prompt ?? '';
              normalized.sampleAnswers = Array.isArray(normalized.sampleAnswers) && normalized.sampleAnswers.length ? normalized.sampleAnswers : [''];
              normalized.similarityThreshold = normalized.similarityThreshold ?? 70;
              normalized.scoringMode = normalized.scoringMode ?? 'full';
            }

            if (normalized.type === 'pronunciation') {
              normalized.word = normalized.word ?? '';
              normalized.phonetic = normalized.phonetic ?? '';
              normalized.translation = normalized.translation ?? '';
              normalized.acceptedVariants = Array.isArray(normalized.acceptedVariants) ? normalized.acceptedVariants : [];
              normalized.audioUrl = normalized.audioUrl ?? null;
            }

            return normalized;
          });
          this.currentStep = 4;
          this.showSuccess('Questions extracted');
        },
        error: (err) => {
          this.clearProgressTimer();
          this.generating = false;
          this.generationError = err?.error?.error || 'Extraction failed. Please try again.';
        }
      });
  }

  // ───────────────────────────────────────────────────────────
  // Review editor helpers
  // ───────────────────────────────────────────────────────────

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

  trackByIndex(_idx: number): number {
    return _idx;
  }

  getBlankCount(q: ReviewQuestion): number {
    return (q.sentence?.match(/___/g) || []).length;
  }

  onSentenceChange(q: ReviewQuestion): void {
    const count = this.getBlankCount(q);
    if (!q.answers) q.answers = [];
    while (q.answers.length < count) q.answers.push('');
    while (q.answers.length > count) q.answers.pop();
  }

  insertBlank(q: ReviewQuestion): void {
    const blank = '___';
    const el = document.activeElement as HTMLTextAreaElement | null;
    if (el?.tagName === 'TEXTAREA' && typeof el.selectionStart === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd ?? start;
      const s = q.sentence || '';
      q.sentence = s.slice(0, start) + blank + s.slice(end);
      this.onSentenceChange(q);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + blank.length, start + blank.length);
      }, 0);
    } else {
      const s = (q.sentence || '').trimEnd();
      q.sentence = s + (s ? ' ' : '') + blank;
      this.onSentenceChange(q);
    }
  }

  addBlankQuestion(type: SupportedWorksheetQuestionType): void {
    const q: ReviewQuestion = { type, points: 1, expanded: true, aiGenerated: false };
    if (type === 'mcq') Object.assign(q, { question: '', options: ['', '', '', ''], correctAnswerIndex: 0, explanation: '' });
    if (type === 'fill-blank') Object.assign(q, { sentence: '', answers: [''], hint: '', caseSensitive: false });
    if (type === 'question-answer') Object.assign(q, { prompt: '', sampleAnswers: [''], similarityThreshold: 70, scoringMode: 'full' });
    if (type === 'pronunciation') Object.assign(q, { word: '', phonetic: '', translation: '', acceptedVariants: [], audioUrl: null });
    this.reviewQuestions.push(q);
  }

  addOption(q: ReviewQuestion): void {
    q.options = q.options || [];
    q.options.push('');
  }

  removeOption(q: ReviewQuestion, i: number): void {
    q.options = q.options || [];
    q.options.splice(i, 1);
    if (q.correctAnswerIndex != null && q.correctAnswerIndex >= (q.options?.length || 0)) q.correctAnswerIndex = 0;
  }

  addSampleAnswer(q: ReviewQuestion): void {
    q.sampleAnswers = q.sampleAnswers || [];
    q.sampleAnswers.push('');
  }

  removeSampleAnswer(q: ReviewQuestion, i: number): void {
    q.sampleAnswers = q.sampleAnswers || [];
    if (q.sampleAnswers.length > 1) q.sampleAnswers.splice(i, 1);
  }

  addVariant(q: ReviewQuestion): void {
    q.acceptedVariants = q.acceptedVariants || [];
    q.acceptedVariants.push('');
  }

  removeVariant(q: ReviewQuestion, i: number): void {
    q.acceptedVariants = q.acceptedVariants || [];
    q.acceptedVariants.splice(i, 1);
  }

  setThreshold(q: ReviewQuestion, raw: any): void {
    const v = parseInt(String(raw), 10);
    if (!Number.isFinite(v)) return;
    q.similarityThreshold = Math.max(0, Math.min(100, v));
  }

  isQuestionValid(q: ReviewQuestion): boolean {
    if (q.type === 'mcq') return !!(q.question?.trim()) && (q.options?.filter(o => (o || '').trim()).length ?? 0) >= 2;
    if (q.type === 'fill-blank') return !!(q.sentence?.trim()) && this.getBlankCount(q) > 0 && (q.answers?.every(a => (a || '').trim().length > 0) ?? false);
    if (q.type === 'question-answer') return !!(q.prompt?.trim());
    if (q.type === 'pronunciation') return !!(q.word?.trim());
    return false;
  }

  get validCount(): number {
    return this.reviewQuestions.filter(q => this.isQuestionValid(q)).length;
  }

  get totalPoints(): number {
    return this.reviewQuestions.reduce((s, q) => s + (q.points || 1), 0);
  }

  get canSave(): boolean {
    return !!this.exerciseTitle.trim() && this.validCount > 0;
  }

  // ───────────────────────────────────────────────────────────
  // Save
  // ───────────────────────────────────────────────────────────

  saveExercise(publish: boolean): void {
    if (!this.canSave) {
      this.showError('Please add a title and ensure at least one valid question.');
      return;
    }
    this.saving = true;

    const payload: Partial<any> = {
      title: this.exerciseTitle.trim(),
      description: this.exerciseDescription.trim(),
      targetLanguage: this.targetLanguage as 'German' | 'English',
      nativeLanguage: this.nativeLanguage as 'English' | 'Tamil' | 'Sinhala',
      level: this.level as any,
      category: 'Listening',
      difficulty: this.difficulty,
      visibleToStudents: publish,
      sharedAudioUrl: this.sharedAudioUrl,
      tags: ['audio-worksheet', 'pdf-import'],
      questions: this.reviewQuestions
        .filter(q => this.isQuestionValid(q))
        .map(q => {
          const { expanded, aiGenerated, ...rest } = q;
          // For pronunciation questions, use the shared worksheet audio if no per-question audio exists.
          if (rest.type === 'pronunciation' && !rest.audioUrl && this.sharedAudioUrl) {
            (rest as any).audioUrl = this.sharedAudioUrl;
          }
          return rest as ExerciseQuestion;
        })
    };

    this.exerciseService.createExercise(payload).subscribe({
      next: () => {
        this.saving = false;
        if (this.uploadResult?.uploadId) {
          this.exerciseService.cleanupPdf(this.uploadResult.uploadId).subscribe();
        }
        this.showSuccess(publish ? 'Exercise published!' : 'Exercise saved as draft!');
        setTimeout(() => this.router.navigate(['/admin/digital-exercises']), 1200);
      },
      error: (err) => {
        this.saving = false;
        this.showError(err?.error?.error || 'Failed to save exercise.');
      }
    });
  }

  // ───────────────────────────────────────────────────────────
  // Notifications
  // ───────────────────────────────────────────────────────────

  private showSuccess(msg: string): void {
    this.snackBar.open(msg, 'Close', { duration: 3000, panelClass: ['success-snack'] });
  }

  private showError(msg: string): void {
    this.snackBar.open(msg, 'Close', { duration: 5000, panelClass: ['error-snack'] });
  }

  // ───────────────────────────────────────────────────────────
  // Template helpers
  // ───────────────────────────────────────────────────────────

  getQuestionTypeLabel(type: SupportedWorksheetQuestionType): string {
    switch (type) {
      case 'mcq':
        return 'Multiple Choice';
      case 'fill-blank':
        return 'Fill in the Blanks';
      case 'question-answer':
        return 'Question / Answer';
      case 'pronunciation':
        return 'Pronunciation';
    }
  }

  getQuestionTypeIcon(type: SupportedWorksheetQuestionType): string {
    switch (type) {
      case 'mcq':
        return 'quiz';
      case 'fill-blank':
        return 'text_fields';
      case 'question-answer':
        return 'short_text';
      case 'pronunciation':
        return 'record_voice_over';
    }
  }
}

