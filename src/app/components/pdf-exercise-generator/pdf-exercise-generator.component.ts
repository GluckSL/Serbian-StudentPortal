// src/app/components/pdf-exercise-generator/pdf-exercise-generator.component.ts

import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { resolveMediaUrl } from '../../utils/media-url';
import { countFillBlankRuns } from '../../utils/fill-blank';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { DigitalExerciseService, ExerciseQuestion } from '../../services/digital-exercise.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';
import { ExerciseStructurePreviewComponent, ExercisePreview } from './exercise-structure-preview.component';

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface ReviewQuestion {
  type: 'mcq' | 'matching' | 'fill-blank' | 'pronunciation' | 'question-answer' | 'listening' | 'singular_plural';
  worksheetKind?: string | null;
  // MCQ
  question?: string;
  imageUrl?: string;
  options?: string[];
  correctAnswerIndex?: number;
  explanation?: string;
  // Matching / singular–plural (same `pairs` array shape differs by type)
  instruction?: string;
  pairs?: Array<{ left?: string; right?: string; singular?: string; plural?: string }>;
  // Fill-blank
  sentence?: string;
  answers?: string[];
  hint?: string;
  caseSensitive?: boolean;
  /** Worked sample from worksheet (stored as question.example on save). */
  example?: string;
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
  'Analyzing worksheet structure...',
  'Preparing exercise blocks...',
  'Extracting exercises...',
  'Mapping answers from solution key...',
  'Finalizing extracted questions...'
];

@Component({
  selector: 'app-pdf-exercise-generator',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, ExerciseStructurePreviewComponent],
  templateUrl: './pdf-exercise-generator.component.html',
  styleUrls: ['./pdf-exercise-generator.component.css']
})
export class PdfExerciseGeneratorComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('listeningFileInput') listeningFileInput!: ElementRef<HTMLInputElement>;

  currentStep: WizardStep = 1;

  // ── Step 1: Upload ──────────────────────────────────────────────────────────
  inputMode: 'pdf' | 'text' = 'pdf';
  selectedFile: File | null = null;
  isDragging = false;
  uploading = false;
  uploadResult: any = null;

  selectedText = '';
  textInputResult: any = null;

  // ── Step 2: Detected Structure ──────────────────────────────────────────────
  exercises: ExercisePreview[] = [];
  extractionErrors: Array<{ exerciseId: string; error: string }> = [];
  extractionProgress = { current: 0, total: 0 };
  failedExerciseIds: string[] = [];
  extractionSummary = { total: 0, successCount: 0, failedCount: 0 };

  // legacy state kept for compatibility with review/save UI
  // typeCounts drives everything: selected = count > 0
  typeCounts: Record<string, number> = {
    mcq: 0,
    matching: 0,
    'fill-blank': 0,
    pronunciation: 0,
    'question-answer': 0,
    'true-false': 0,
    'sentence-transformation': 0,
    singular_plural: 0,
    'table-profile-fill': 0,
    'free-writing-own-sentences': 0,
    'free-writing-profile': 0,
    'error-correction': 0
  };
  /** True when type counts were auto-detected from uploaded PDF. */
  pdfDetectedTypes = false;

  targetLanguage = 'German';
  nativeLanguage = 'English';
  level = 'A1';
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' = 'Beginner';

  // ── Step 3: Extracting ──────────────────────────────────────────────────────
  generating = false;
  progressStep = 0;
  progressPercent = 0;
  currentProgressMsg = '';
  progressTimer: any;
  extractionPollTimer: any;
  extractionPollBusy = false;
  generationError = '';

  // ── Step 5: Review ──────────────────────────────────────────────────────────
  reviewQuestions: ReviewQuestion[] = [];
  generationMeta: any = null;

  // Exercise metadata
  exerciseTitle = '';
  exerciseDescription = '';
  /** Optional journey day 1–200; empty = general pool */
  courseDayStr = '';
  visibleToStudents = false;
  saving = false;

  // Inline editor state
  addingType = '';

  readonly questionTypes = [
    { value: 'mcq',             label: 'Multiple Choice',  desc: '4 options, 1 correct answer',      icon: 'quiz',              color: '#1976d2', bg: '#e8f4fd' },
    { value: 'matching',        label: 'Matching',          desc: 'Match word / phrase pairs',         icon: 'compare_arrows',    color: '#7b1fa2', bg: '#f3e5f5' },
    { value: 'fill-blank',      label: 'Fill in the Blanks',desc: 'Sentence with _ or ___ gaps',        icon: 'text_fields',       color: '#388e3c', bg: '#e8f5e9' },
    { value: 'pronunciation',   label: 'Pronunciation',     desc: 'Speak a word aloud',               icon: 'record_voice_over', color: '#e65100', bg: '#fff3e0' },
    { value: 'question-answer', label: 'Question / Answer', desc: 'Student writes a short answer',    icon: 'short_text',        color: '#0d9488', bg: '#e0f2f1' },
    { value: 'true-false', label: 'Richtig / Falsch', desc: 'Entscheiden, ob eine Aussage richtig oder falsch ist', icon: 'toggle_on', color: '#0ea5e9', bg: '#e0f2fe' },
    { value: 'sentence-transformation', label: 'Sentence Transformation', desc: 'Transform the sentence (e.g. statement → question)', icon: 'transform', color: '#9333ea', bg: '#f3e8ff' },
    { value: 'singular_plural', label: 'Singular Plural', desc: 'Singular form shown; student writes the plural', icon: 'swap_horiz', color: '#16a34a', bg: '#dcfce7' },
    { value: 'table-profile-fill', label: 'Table / Profile Fill-in', desc: 'Fill values from a table/profile', icon: 'table_rows', color: '#64748b', bg: '#f1f5f9' },
    { value: 'free-writing-own-sentences', label: 'Free Writing / Own Sentences', desc: 'Write your own sentences', icon: 'edit_note', color: '#f97316', bg: '#fff7ed' },
    { value: 'free-writing-profile', label: 'Free Writing – profile', desc: 'Write a short profile (Steckbrief)', icon: 'badge', color: '#db2777', bg: '#fce7f3' },
    { value: 'error-correction', label: 'Error Correction', desc: 'Correct mistakes and write the right sentence', icon: 'error', color: '#dc2626', bg: '#fee2e2' }
  ];

  readonly levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly difficulties: Array<'Beginner' | 'Intermediate' | 'Advanced'> = ['Beginner', 'Intermediate', 'Advanced'];
  readonly languages = ['German', 'English'];
  readonly nativeLanguages = ['English', 'Tamil', 'Sinhala'];

  constructor(
    private exerciseService: DigitalExerciseService,
    private router: Router,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap.get('courseDay');
    if (q == null || q === '') return;
    const p = parseInt(String(q).trim(), 10);
    if (Number.isFinite(p) && p >= 1 && p <= 200) {
      this.courseDayStr = String(p);
    }
  }

  /** Number input binding for course day (empty = any day). */
  get courseDayAsNumber(): number | null {
    const t = this.courseDayStr.trim();
    if (!t) return null;
    const p = parseInt(t, 10);
    if (!Number.isFinite(p)) return null;
    return p;
  }

  onCourseDayNumberInput(v: number | string | null): void {
    if (v === '' || v === null || v === undefined) {
      this.courseDayStr = '';
      return;
    }
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (!Number.isFinite(n)) {
      this.courseDayStr = '';
      return;
    }
    this.courseDayStr = String(Math.min(200, Math.max(1, Math.round(n))));
  }

  ngOnDestroy(): void {
    this.clearProgressTimer();
    this.clearExtractionPollTimer();
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

  setInputMode(mode: 'pdf' | 'text'): void {
    if (this.inputMode === mode) return;
    this.inputMode = mode;

    // Reset other mode state
    this.selectedFile = null;
    this.uploadResult = null;
    this.isDragging = false;
    this.uploading = false;

    this.selectedText = '';
    this.textInputResult = null;

    if (this.fileInput?.nativeElement) this.fileInput.nativeElement.value = '';

    this.pdfDetectedTypes = false;
    // Worksheet-style documents are usually built from matching, fill-blank, and short answers.
    if (mode === 'text') {
      this.typeCounts = {
        mcq: 0,
        matching: 5,
        'fill-blank': 5,
        pronunciation: 0,
        'question-answer': 5,
        'true-false': 0,
        'sentence-transformation': 0,
        singular_plural: 0,
        'table-profile-fill': 0,
        'free-writing-own-sentences': 0,
        'free-writing-profile': 0,
        'error-correction': 0
      };
    } else {
      this.typeCounts = {
        mcq: 0,
        matching: 0,
        'fill-blank': 0,
        pronunciation: 0,
        'question-answer': 0,
        'true-false': 0,
        'sentence-transformation': 0,
        singular_plural: 0,
        'table-profile-fill': 0,
        'free-writing-own-sentences': 0,
        'free-writing-profile': 0,
        'error-correction': 0
      };
    }
  }

  uploadPdf(): void {
    if (!this.selectedFile) return;
    this.uploading = true;

    this.exerciseService.uploadPdf(this.selectedFile).subscribe({
      next: (res) => {
        this.uploadResult = res;
        this.uploading = false;
        this.applyDetectedTypes(res.detectedTypes);
        this.exercises = (res.exercises || []).map((e: any) => {
          const exerciseId = String(e.exerciseId || e.id || '');
          return {
            exerciseId,
            id: String(e.id || exerciseId),
            topic: String(e.topic || ''),
            difficulty: String(e.difficulty || 'easy'),
            type: String(e.type || ''),
            questionCount: Number(e.questionCount || 0),
            instruction: String(e.instruction || e.instruction_de || ''),
            instruction_de: String(e.instruction_de || ''),
            instruction_en: String(e.instruction_en || ''),
            rawText: String(e.rawText ?? e.content ?? ''),
            questions: Array.isArray(e.questions) ? e.questions : [],
            pairs: Array.isArray(e.pairs) ? e.pairs : [],
            extractedItems: [] as any[],
            enabled: true
          };
        });
        // If server detected a worksheet, auto-enable worksheet mode label for display
        if (res.worksheetMode) {
          this.pdfDetectedTypes = true;
        }
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
    this.pdfDetectedTypes = false;
    this.exercises = [];
    this.extractionErrors = [];
    this.extractionProgress = { current: 0, total: 0 };
    this.typeCounts = {
      mcq: 0,
      matching: 0,
      'fill-blank': 0,
      pronunciation: 0,
      'question-answer': 0,
      'true-false': 0,
      'sentence-transformation': 0,
      singular_plural: 0,
      'table-profile-fill': 0,
      'free-writing-own-sentences': 0,
      'free-writing-profile': 0,
      'error-correction': 0
    };
    if (this.fileInput) this.fileInput.nativeElement.value = '';
  }

  private applyDetectedTypes(detected: Record<string, number> | undefined): void {
    if (!detected) return;
    const hasAny = Object.values(detected).some(v => Number(v) > 0);
    if (!hasAny) {
      // Fallback default when no pattern is detected in PDF.
      this.typeCounts = {
        mcq: 5,
        matching: 0,
        'fill-blank': 0,
        pronunciation: 0,
        'question-answer': 0,
        'true-false': 0,
        'sentence-transformation': 0,
        singular_plural: 0,
        'table-profile-fill': 0,
        'free-writing-own-sentences': 0,
        'free-writing-profile': 0,
        'error-correction': 0
      };
      this.pdfDetectedTypes = false;
      return;
    }
    this.typeCounts = {
      mcq: Number(detected['mcq']) || 0,
      matching: Number(detected['matching']) || 0,
      'fill-blank': Number(detected['fill-blank']) || 0,
      pronunciation: Number(detected['pronunciation']) || 0,
      'question-answer': Number(detected['question-answer']) || 0,
      'true-false': Number(detected['true-false']) || 0,
      'sentence-transformation': Number(detected['sentence-transformation']) || 0,
      singular_plural: Number(detected['singular_plural']) || 0,
      'table-profile-fill': Number(detected['table-profile-fill']) || 0,
      'free-writing-own-sentences': Number(detected['free-writing-own-sentences']) || 0,
      'free-writing-profile': Number(detected['free-writing-profile']) || 0,
      'error-correction': Number(detected['error-correction']) || 0
    };
    this.pdfDetectedTypes = true;
  }

  readTextForPreview(): void {
    const cleaned = (this.selectedText || '').trim();
    if (cleaned.length < 20) {
      this.showError('Please paste at least a few lines of text.');
      return;
    }
    this.textInputResult = {
      success: true,
      totalChars: cleaned.length,
      previewText: cleaned.substring(0, 2000),
      hasContent: cleaned.length > 50,
      filename: 'Pasted text'
    };
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
      const detectedCount = this.uploadResult?.detectedTypes?.[type] as number | undefined;
      this.typeCounts[type] = (detectedCount && detectedCount > 0) ? detectedCount : 5;
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

    const selectedExerciseIds = this.exercises.filter(e => e.enabled).map(e => e.exerciseId);
    this.extractionProgress = { current: 0, total: Math.max(selectedExerciseIds.length, this.exercises.length, 1) };
    this.currentProgressMsg = `Extracting exercises (0 / ${this.extractionProgress.total})...`;
    this.exerciseService.generateFromPdf({
      uploadId: this.uploadResult.uploadId,
      types: ['matching'],
      typeCounts: {},
      targetLanguage: this.targetLanguage,
      nativeLanguage: this.nativeLanguage,
      level: this.level,
      difficulty: this.difficulty,
      maxQuestions: 10,
      worksheetMode: true,
      selectedExerciseIds
    }).subscribe({
      next: (res) => {
        if (res?.jobId) {
          this.startExtractionPolling(String(res.jobId));
          return;
        } 
        this.applyExtractionResult(res);
      },
      error: (err) => {
        this.clearProgressTimer();
        this.generating = false;
        this.generationError = err.error?.error || 'Extraction failed. Please try again.';
      }
    });
  }

  /** Map flat review questions back onto worksheet exercise rows (sectionTitle contains exerciseId segment). */
  private attachExtractedQuestionsToExercises(): void {
    const qs = this.reviewQuestions || [];
    this.exercises = this.exercises.map((ex) => {
      const id = String(ex.exerciseId || '').trim();
      const extractedItems =
        !id || !qs.length
          ? []
          : qs.filter((q: any) => {
              const st = String(q.sectionTitle || '').trim();
              if (!st) return false;
              const segments = st.split('|').map((s: string) => s.trim());
              return segments.includes(id);
            });
      return { ...ex, extractedItems };
    });
  }

  private applyExtractionResult(res: any): void {
    this.clearProgressTimer();
    this.clearExtractionPollTimer();
    this.progressPercent = 100;
    this.currentProgressMsg = 'Done! Preparing review...';
    this.generating = false;
    this.generationMeta = res;
    this.failedExerciseIds = Array.isArray(res.failedExercises) ? res.failedExercises.map((x: any) => String(x)) : [];
    this.extractionSummary = {
      total: Number(res.total || this.exercises.length || 0),
      successCount: Number(res.successCount || 0),
      failedCount: Number(res.failedCount || this.failedExerciseIds.length || 0)
    };
    this.extractionErrors = (res.extractionLog || [])
      .filter((x: any) => x.ok === false)
      .map((x: any) => ({ exerciseId: x.exerciseId, error: x.error || 'Extraction failed' }));
    this.extractionProgress = { current: this.extractionProgress.total, total: this.extractionProgress.total };
    this.reviewQuestions = (res.extracted || res.questions || []).map((q: any) => ({
      ...q,
      expanded: false,
      aiGenerated: true
    }));
    this.attachExtractedQuestionsToExercises();
    this.exerciseTitle = res.suggestedTitle || '';
    this.exerciseDescription = res.suggestedDescription || '';
    if (res.detectedLevel) this.level = res.detectedLevel;
    this.currentStep = 4;
    if (this.failedExerciseIds.length === 0) {
      setTimeout(() => { this.currentStep = 5; }, 300);
    }
  }

  private startExtractionPolling(jobId: string): void {
    this.clearExtractionPollTimer();
    this.extractionPollBusy = false;
    const pollStartedAt = Date.now();
    /** Sequential AI extraction needs several minutes per worksheet (many Übungen × OpenAI calls). */
    const total = Math.max(this.extractionProgress.total || 1, 1);
    const maxPollMs = Math.min(60 * 60 * 1000, Math.max(35 * 60 * 1000, total * 5 * 60 * 1000));

    this.extractionPollTimer = setInterval(() => {
      if (this.extractionPollBusy) return;
      this.extractionPollBusy = true;

      this.exerciseService.getExtractionStatus(jobId).subscribe({
        next: (res) => {
          this.extractionPollBusy = false;
          this.clearProgressTimer();

          if (res?.progress) {
            this.extractionProgress = {
              current: res.progress.current ?? this.extractionProgress.current,
              total: res.progress.total || this.extractionProgress.total
            };
            const exId = res.progress.currentExerciseId || '';
            this.currentProgressMsg = `Extracting ${exId} (${this.extractionProgress.current}/${this.extractionProgress.total})`;
          }

          if (res?.status === 'done') {
            clearInterval(this.extractionPollTimer);
            this.extractionPollTimer = null;
            this.clearProgressTimer();
            this.applyExtractionResult(res.result);
            return;
          }

          if (res?.status === 'error') {
            clearInterval(this.extractionPollTimer);
            this.extractionPollTimer = null;
            this.clearProgressTimer();
            this.generating = false;
            this.generationError = res.error || 'Extraction failed.';
            return;
          }

          if (Date.now() - pollStartedAt > maxPollMs) {
            clearInterval(this.extractionPollTimer);
            this.extractionPollTimer = null;
            this.clearProgressTimer();
            this.generating = false;
            this.generationError =
              'Extraction is still running on the server but the browser stopped waiting. ' +
              'Wait a minute and use Try Again, or split the PDF into fewer exercises.';
          }
        },
        error: () => {
          this.extractionPollBusy = false;
        }
      });
    }, 1500);
  }

  private startProgressSimulation(): void {
    let msgIndex = 0;
    this.progressTimer = setInterval(() => {
      msgIndex = Math.min(msgIndex + 1, PROGRESS_MESSAGES.length - 1);
      const current = Math.min(this.extractionProgress.current + 1, this.extractionProgress.total || 1);
      this.extractionProgress.current = current;
      this.currentProgressMsg = `Extracting exercises (${current} / ${this.extractionProgress.total || 1})... ${PROGRESS_MESSAGES[msgIndex]}`;
      this.progressPercent = Math.min(this.progressPercent + Math.random() * 12 + 4, 92);
    }, 2200);
  }
  extractAllExercises(): void {
    this.currentStep = 3;
    this.startGeneration();
  }

  rescanPdfStructure(): void {
    if (!this.uploadResult?.uploadId || !this.selectedFile) {
      this.showError('Please upload a PDF first.');
      return;
    }
    this.uploadPdf();
  }

  private clearProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private clearExtractionPollTimer(): void {
    if (this.extractionPollTimer) {
      clearInterval(this.extractionPollTimer);
      this.extractionPollTimer = null;
    }
  }

  retryGeneration(): void {
    this.generationError = '';
    this.startGeneration();
  }

  retryExerciseExtraction(exerciseId: string): void {
    const ex = this.exercises.find(e => e.exerciseId === exerciseId);
    if (!ex || !this.uploadResult?.previewText) return;
    this.exerciseService.extractSingleExercise({
      topic: ex.topic,
      exerciseId: ex.exerciseId,
      level: ex.difficulty,
      instruction_de: ex.instruction_de || '',
      instruction_en: ex.instruction_en || '',
      content: this.uploadResult.previewText,
      solution_key: ''
    }).subscribe({
      next: (res) => {
        const added = (res.questions || []).map((q: any) => ({ ...q, expanded: false, aiGenerated: true }));
        this.reviewQuestions.push(...added);
        this.extractionErrors = this.extractionErrors.filter(e => e.exerciseId !== exerciseId);
        this.showSuccess(`Recovered ${exerciseId}`);
      },
      error: (err) => this.showError(err.error?.error || `Retry failed for ${exerciseId}`)
    });
  }

  retryFailedExtractions(): void {
    if (!this.uploadResult?.uploadId || this.failedExerciseIds.length === 0) return;
    this.generating = true;
    this.generationError = '';
    this.currentStep = 3;
    const failedSet = new Set(this.failedExerciseIds.map(x => String(x)));
    this.exerciseService.extractExercisesSequential({
      uploadId: this.uploadResult.uploadId,
      targetLanguage: this.targetLanguage,
      nativeLanguage: this.nativeLanguage,
      level: this.level,
      selectedExerciseIds: this.exercises
        .filter(e => failedSet.has(String(e.exerciseId)))
        .map(e => e.exerciseId)
    }).subscribe({
      next: (res) => {
        this.generating = false;
        const added = (res.extracted || res.questions || []).map((q: any) => ({ ...q, expanded: false, aiGenerated: true }));
        this.reviewQuestions.push(...added);
        this.failedExerciseIds = Array.isArray(res.failedExercises) ? res.failedExercises.map((x: any) => String(x)) : [];
        this.extractionSummary = {
          total: Number(res.total || this.extractionSummary.total),
          successCount: Number(res.successCount || this.extractionSummary.successCount),
          failedCount: Number(res.failedCount || this.failedExerciseIds.length)
        };
        this.extractionErrors = (res.extractionLog || [])
          .filter((x: any) => x.ok === false)
          .map((x: any) => ({ exerciseId: x.exerciseId, error: x.error || 'Extraction failed' }));
        this.currentStep = this.failedExerciseIds.length ? 4 : 5;
      },
      error: (err) => {
        this.generating = false;
        this.generationError = err.error?.error || 'Retry failed. Please try again.';
        this.currentStep = 4;
      }
    });
  }

  continueToReview(): void {
    this.currentStep = 5;
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
    // These worksheet categories are represented using the existing question-answer
    // engine, with an extra `worksheetKind` label for UI rendering.
    const q: ReviewQuestion = { type: type as any, points: 1, expanded: true, aiGenerated: false };

    if (type === 'mcq') Object.assign(q, { question: '', options: ['', '', '', ''], correctAnswerIndex: 0, explanation: '' });
    else if (type === 'matching') Object.assign(q, { instruction: 'Match the items.', pairs: [{ left: '', right: '' }, { left: '', right: '' }] });
    else if (type === 'singular_plural') {
      Object.assign(q, {
        instruction: 'Write the correct plural form.',
        pairs: [{ singular: '', plural: '' }, { singular: '', plural: '' }]
      });
    }
    else if (type === 'fill-blank') {
      Object.assign(q, {
        sentence: '',
        answers: [''],
        hint: '',
        caseSensitive: false,
        instruction: '',
        example: ''
      });
    }
    else if (type === 'pronunciation') Object.assign(q, { word: '', phonetic: '', translation: '', acceptedVariants: [] });
    else if (type === 'question-answer') Object.assign(q, { prompt: '', sampleAnswers: [''], similarityThreshold: 70, scoringMode: 'full' });
    else if ([
      'true-false',
      'sentence-transformation',
      'table-profile-fill',
      'free-writing-own-sentences',
      'free-writing-profile',
      'error-correction'
    ].includes(type)) {
      (q as any).type = 'question-answer';
      q.worksheetKind = type;
      let scoringMode: 'full' | 'proportional' = 'full';
      let similarityThreshold = 70;
      if (type === 'free-writing-own-sentences' || type === 'free-writing-profile' || type === 'table-profile-fill') {
        scoringMode = 'proportional';
        similarityThreshold = 60;
      } else if (type === 'true-false') {
        scoringMode = 'full';
        similarityThreshold = 75;
      } else if (type === 'error-correction' || type === 'sentence-transformation') {
        scoringMode = 'full';
        similarityThreshold = 70;
      }
      Object.assign(q, {
        prompt: '',
        sampleAnswers: [''],
        similarityThreshold,
        scoringMode
      });
    }
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
  addPair(q: ReviewQuestion): void {
    if (q.type === 'singular_plural') q.pairs!.push({ singular: '', plural: '' });
    else q.pairs!.push({ left: '', right: '' });
  }
  removePair(q: ReviewQuestion, i: number): void { if (q.pairs!.length > 2) q.pairs!.splice(i, 1); }

  // Fill-blank
  onSentenceChange(q: ReviewQuestion): void {
    const count = countFillBlankRuns(q.sentence || '');
    while (q.answers!.length < count) q.answers!.push('');
    while (q.answers!.length > count) q.answers!.pop();
  }

  /** Insert a blank marker (_) at cursor (if sentence field was focused) or at end. */
  insertBlank(q: ReviewQuestion): void {
    const blank = '_';
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
    return countFillBlankRuns(q.sentence || '');
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
    return resolveMediaUrl(relative);
  }

  // Validation
  isQuestionValid(q: ReviewQuestion): boolean {
    if (q.type === 'mcq') return !!(q.question?.trim()) && (q.options?.filter(o => o.trim()).length ?? 0) >= 2;
    if (q.type === 'matching') return (q.pairs?.filter(p => (p.left || '').trim() && (p.right || '').trim()).length ?? 0) >= 2;
    if (q.type === 'singular_plural') {
      const rows = q.pairs?.filter(p => (p.singular || '').trim() && (p.plural || '').trim()) ?? [];
      return rows.length >= 1;
    }
    if (q.type === 'fill-blank') return !!(q.sentence?.trim()) && this.getBlankCount(q) > 0 && (q.answers?.every(a => a.trim()) ?? false);
    if (q.type === 'pronunciation') return !!(q.word?.trim());
    if (q.type === 'question-answer') return !!(q.prompt?.trim());
    if (q.type === 'listening') return !!(q.mediaUrl?.trim()) && !!(q.expectedTranscript?.trim());
    return false;
  }

  /** Human-readable reasons why a question is invalid (for tooltips). */
  getQuestionValidationHint(q: ReviewQuestion): string {
    if (this.isQuestionValid(q)) return '';

    const parts: string[] = [];

    if (q.type === 'mcq') {
      if (!q.question?.trim()) parts.push('Add the question text.');
      const filled = q.options?.filter(o => o?.trim()).length ?? 0;
      if (filled < 2) parts.push(`Need at least 2 filled answer options (currently ${filled}).`);
    } else if (q.type === 'matching') {
      const good = q.pairs?.filter(p => (p.left || '').trim() && (p.right || '').trim()).length ?? 0;
      if (good < 2) parts.push(`Need at least 2 complete pairs with left and right text (currently ${good}).`);
    } else if (q.type === 'singular_plural') {
      const good = q.pairs?.filter(p => (p.singular || '').trim() && (p.plural || '').trim()).length ?? 0;
      if (good < 1) parts.push('Add at least one row with both singular and plural (expected answer).');
    } else if (q.type === 'fill-blank') {
      if (!q.sentence?.trim()) {
        parts.push('Sentence is empty.');
      } else {
        const blanks = this.getBlankCount(q);
        if (blanks === 0) {
          parts.push('No blanks detected. Use underscore(s) for each gap: one _ per gap, or ___ for a wider gap. You can also click “Insert blank”.');
        } else {
          const answers = q.answers || [];
          const missing: number[] = [];
          for (let i = 0; i < blanks; i++) {
            if (!answers[i]?.trim()) missing.push(i + 1);
          }
          if (missing.length) {
            parts.push(`Fill in answer(s) for blank(s): ${missing.join(', ')}.`);
          }
        }
      }
    } else if (q.type === 'pronunciation') {
      if (!q.word?.trim()) parts.push('Add the word or phrase to pronounce.');
    } else if (q.type === 'question-answer') {
      if (!q.prompt?.trim()) parts.push('Add the question or instruction text.');
    } else if (q.type === 'listening') {
      if (!q.mediaUrl?.trim()) parts.push('Add audio (upload or URL).');
      if (!q.expectedTranscript?.trim()) parts.push('Add the expected transcript.');
    } else {
      parts.push('This question type is incomplete.');
    }

    return parts.join(' ');
  }

  /** Short hint for the “X/Y valid” summary in the header. */
  getInvalidSummaryTooltip(): string {
    const invalid = this.reviewQuestions.length - this.validCount;
    if (invalid <= 0) return '';
    return `${invalid} question(s) need fixes. Hover the warning icon on each row for details.`;
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
    let courseDay: number | null = null;
    const dayTrim = this.courseDayStr.trim();
    if (dayTrim) {
      const p = parseInt(dayTrim, 10);
      if (!Number.isFinite(p) || p < 1 || p > 200) {
        this.saving = false;
        this.showError('Course day must be empty or a number from 1 to 200');
        return;
      }
      courseDay = p;
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
      courseDay,
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
    if (step === 1) {
      return !!this.uploadResult?.success;
    }
    if (step === 2) return this.exercises.some(e => e.enabled);
    return true;
  }

  next(): void {
    if (this.currentStep === 2) {
      this.currentStep = 3;
      this.startGeneration();
    } else if (this.currentStep < 5) {
      this.currentStep = (this.currentStep + 1) as WizardStep;
    }
  }

  back(): void {
    if (this.currentStep === 5) {
      this.currentStep = 2;
      return;
    }
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
