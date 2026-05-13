// src/app/components/pdf-exercise-generator/pdf-exercise-generator.component.ts

import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { throwError } from 'rxjs';
import { finalize, switchMap } from 'rxjs/operators';
import { resolveMediaUrl } from '../../utils/media-url';
import { countFillBlankRuns } from '../../utils/fill-blank';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { DigitalExerciseService, ExerciseQuestion } from '../../services/digital-exercise.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';
import { RichTextInputComponent } from '../../shared/rich-text-input/rich-text-input.component';
import { ExerciseStructurePreviewComponent, ExercisePreview } from './exercise-structure-preview.component';

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface ReviewQuestion {
  type:
    | 'mcq'
    | 'matching'
    | 'fill-blank'
    | 'word_bank_fill'
    | 'pronunciation'
    | 'question-answer'
    | 'listening'
    | 'video-pronunciation'
    | 'singular_plural'
    | 'jumble-word'
    | 'rearrange'
    | 'image_pin_match';
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
  /** Shared reading text for multiple true/false items (optional). */
  storyParagraph?: string;
  similarityThreshold?: number;
  scoringMode?: 'full' | 'proportional';
  // Listening
  mediaUrl?: string;
  expectedTranscript?: string;
  attemptMode?: 'typing' | 'typing-or-speech';
  transcribing?: boolean;
  // Jumble Word
  scrambledText?: string;
  boldLetter?: string;
  expectedWord?: string;
  categoryTip?: string;
  // Word bank fill
  wordBank?: string[];
  items?: Array<{ prompt?: string; answer?: string; acceptedAnswers?: string[] }>;
  reusableWords?: boolean;
  // Rearrange
  rearrangePrompt?: string;
  rearrangeAnswer?: string;
  rearrangeTokens?: string[];
  // Video pronunciation
  videoUrl?: string;
  caption?: string;
  secondaryCaption?: string;
  secondaryCaptionAtSeconds?: number;
  // Image pin match (uses `imageUrl` above for background image)
  labels?: Array<{ id: string; text: string; correctPinId: string }>;
  pins?: Array<{ id: string; x: number; y: number }>;
  settings?: { randomizeLabels?: boolean; allowRetry?: boolean };
  // Common
  points: number;
  /** Optional context/passage shown above the question */
  context?: string;
  /** Per-question file (image, audio, PDF, video) */
  attachmentUrl?: string;
  attachmentUploading?: boolean;
  /** When attachment is audio: max play starts per student attempt (empty = unlimited). */
  attachmentAudioMaxPlaysPerAttempt?: number | null;
  /** Teacher explanation in student review (HTML) */
  answerExplanation?: string;
  generatingExplanation?: boolean;
  // Editor state
  expanded?: boolean;
  aiGenerated?: boolean;
  // Sub-questions (additional questions with shared context)
  subQuestions?: any[];
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
  imports: [CommonModule, FormsModule, MaterialModule, RichTextInputComponent, ExerciseStructurePreviewComponent],
  templateUrl: './pdf-exercise-generator.component.html',
  styleUrls: ['./pdf-exercise-generator.component.css']
})
export class PdfExerciseGeneratorComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('listeningFileInput') listeningFileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('attachmentFileInput') attachmentFileInput!: ElementRef<HTMLInputElement>;

  /** Target question for per-question attachment upload */
  currentAttachmentQ: ReviewQuestion | null = null;

  currentStep: WizardStep = 1;

  // ── Step 1: Upload ──────────────────────────────────────────────────────────
  inputMode: 'pdf' | 'text' = 'pdf';
  selectedFile: File | null = null;
  isDragging = false;
  uploading = false;
  aiRescanning = false;
  generatingAnswers = false;
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

  /** Phase 3 normalized exercises (rules pipeline) — admin edits before any downstream save. */
  aiStageExercises: any[] = [];
  /** Snapshot for “Reset to original”. */
  aiStageOriginalExercises: any[] = [];
  /** Deep-cloned exercise shown in the right-hand preview editor. */
  selectedExercise: any = null;
  /** Optional answer key text passed to Phase 3. */
  aiStageAnswerKeyText = '';
  aiStageBusy = false;
  aiStageError = '';

  // Exercise metadata
  exerciseTitle = '';
  exerciseDescription = '';
  category = 'Grammar';
  estimatedDuration = 15;
  customTags = '';
  /** Optional journey day 1–200; empty = general pool */
  courseDayStr = '';
  visibleToStudents = false;
  saving = false;

  // Inline editor state
  addingType = '';

  // ── Bulk Select / Edit ──────────────────────────────────────────────────────
  selectedIndices = new Set<number>();
  selectAllChecked = false;

  /** Which field is being bulk-edited. */
  bulkEditField: 'context' | 'instruction' | 'example' | 'audio' | 'attachment' | '' = '';
  bulkEditValue = '';
  bulkAudioUploading = false;

  /** Bulk type change panel */
  bulkTypeChangeOpen = false;
  bulkTargetType = '';
  bulkConverting = false;
  bulkConvertProgress = 0;
  bulkConvertTotal = 0;

  /** Same catalogue as Digital Exercise Builder so bulk “Change type” lists every format. */
  readonly questionTypes = [
    { value: 'mcq', label: 'Multiple Choice', desc: '4 options, 1 correct answer', icon: 'quiz', color: '#1976d2', bg: '#e8f4fd' },
    { value: 'matching', label: 'Matching', desc: 'Match word / phrase pairs', icon: 'compare_arrows', color: '#7b1fa2', bg: '#f3e5f5' },
    { value: 'fill-blank', label: 'Fill in the Blanks', desc: 'Sentence with _ or ___ gaps', icon: 'text_fields', color: '#388e3c', bg: '#e8f5e9' },
    { value: 'word_bank_fill', label: 'Word Bank Fill', desc: 'Shared word bank with multiple blank prompts', icon: 'format_list_bulleted', color: '#1565c0', bg: '#e3f2fd' },
    { value: 'pronunciation', label: 'Pronunciation', desc: 'Speak a word aloud', icon: 'record_voice_over', color: '#e65100', bg: '#fff3e0' },
    { value: 'question-answer', label: 'Question / Answer', desc: 'Student writes a short answer', icon: 'short_text', color: '#0d9488', bg: '#e0f2f1' },
    { value: 'listening', label: 'Listening', desc: 'Listen to audio and type what you hear', icon: 'headphones', color: '#b45309', bg: '#fef3c7' },
    { value: 'video-pronunciation', label: 'Video Pronunciation', desc: 'Watch a clip and speak the caption', icon: 'videocam', color: '#c2410c', bg: '#ffedd5' },
    { value: 'true-false', label: 'Richtig / Falsch', desc: 'True or false statement', icon: 'toggle_on', color: '#0ea5e9', bg: '#e0f2fe' },
    { value: 'sentence-transformation', label: 'Sentence Transformation', desc: 'Transform the sentence (e.g. statement → question)', icon: 'transform', color: '#9333ea', bg: '#f3e8ff' },
    { value: 'singular_plural', label: 'Singular Plural', desc: 'Singular shown; student writes the plural', icon: 'swap_horiz', color: '#16a34a', bg: '#dcfce7' },
    { value: 'table-profile-fill', label: 'Table / Profile Fill-in', desc: 'Fill values from a table/profile', icon: 'table_rows', color: '#64748b', bg: '#f1f5f9' },
    { value: 'free-writing-own-sentences', label: 'Free Writing / Own Sentences', desc: 'Write your own sentences', icon: 'edit_note', color: '#f97316', bg: '#fff7ed' },
    { value: 'free-writing-profile', label: 'Free Writing – profile', desc: 'Write a short profile (Steckbrief)', icon: 'badge', color: '#db2777', bg: '#fce7f3' },
    { value: 'error-correction', label: 'Error Correction', desc: 'Correct mistakes and write the right sentence', icon: 'error', color: '#dc2626', bg: '#fee2e2' },
    { value: 'jumble-word', label: 'Jumble Word', desc: 'Scrambled letters → form the correct word', icon: 'shuffle', color: '#b45309', bg: '#fef3c7' },
    { value: 'rearrange', label: 'Rearrange', desc: 'Put words in the correct order', icon: 'reorder', color: '#5b21b6', bg: '#ede9fe' },
    { value: 'image_pin_match', label: 'Image Pin Match', desc: 'Match labels to pins on an image', icon: 'place', color: '#0f766e', bg: '#ccfbf1' }
  ];

  readonly levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly difficulties: Array<'Beginner' | 'Intermediate' | 'Advanced'> = ['Beginner', 'Intermediate', 'Advanced'];
  readonly languages = ['German', 'English'];
  readonly nativeLanguages = ['English', 'Tamil', 'Sinhala'];
  readonly categories = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];

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
        this.uploading = false;
        this.applyStructureResponse(res);
      },
      error: (err) => {
        this.uploading = false;
        this.showError(err.error?.error || 'Upload failed. Please try again.');
      }
    });
  }

  rescanPdfStructureWithAi(): void {
    if (!this.uploadResult?.uploadId) {
      this.showError('Please upload a PDF first.');
      return;
    }
    this.aiRescanning = true;
    this.exerciseService.detectPdfStructureWithAi(String(this.uploadResult.uploadId)).subscribe({
      next: (res) => {
        this.aiRescanning = false;
        this.applyStructureResponse(res);
        this.showSuccess('AI structure scan completed.');
      },
      error: (err) => {
        this.aiRescanning = false;
        this.showError(err.error?.error || 'AI structure scan failed.');
      }
    });
  }

  private applyStructureResponse(res: any): void {
    this.uploadResult = {
      ...(this.uploadResult || {}),
      ...(res || {})
    };
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
    if (res.worksheetMode) {
      this.pdfDetectedTypes = true;
    }
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

    const selectedExercises = this.exercises
      .filter(e => e.enabled)
      .map(e => ({
        exerciseId: String(e.exerciseId || '').trim(),
        questionCount: Math.max(0, Math.floor(Number(e.questionCount || 0)))
      }))
      .filter(e => !!e.exerciseId);
    const selectedExerciseIds = selectedExercises.map(e => e.exerciseId);
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
      selectedExerciseIds,
      selectedExercises
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

  /** Run Phases 1→3 (deterministic pipeline). Requires the same PDF file still selected in step 1. */
  runAiStagePipeline(): void {
    if (!this.selectedFile) {
      this.showError('Select a PDF in step 1 first, then run AI Stage here.');
      return;
    }
    this.aiStageBusy = true;
    this.aiStageError = '';
    this.exerciseService
      .runAiStagePhase1(this.selectedFile)
      .pipe(
        switchMap((p1: any) => {
          const blocks = Array.isArray(p1?.blocks) ? p1.blocks : [];
          if (!blocks.length) {
            return throwError(() => new Error('Phase 1 returned no blocks.'));
          }
          return this.exerciseService.runAiStagePhase2(blocks).pipe(
            switchMap((p2: any) => {
              const parsedResults = Array.isArray(p2?.results) ? p2.results : [];
              return this.exerciseService.runAiStagePhase3({
                blocks,
                parsedResults,
                answerKeyText: (this.aiStageAnswerKeyText || '').trim()
              });
            })
          );
        }),
        finalize(() => {
          this.aiStageBusy = false;
        })
      )
      .subscribe({
        next: (p3: any) => {
          const raw = Array.isArray(p3?.exercises) ? p3.exercises : [];
          this.aiStageExercises = raw.map((ex: any) => this.ensureAiStageEditorShape(ex));
          this.aiStageOriginalExercises = JSON.parse(JSON.stringify(this.aiStageExercises));
          this.selectedExercise = null;
          this.showSuccess(`AI Stage: ${this.aiStageExercises.length} exercise(s) ready to review.`);
        },
        error: (err: any) => {
          const msg = err?.error?.error || err?.message || 'AI Stage pipeline failed.';
          this.aiStageError = msg;
          this.showError(msg);
        }
      });
  }

  selectExercise(ex: any): void {
    this.selectedExercise = JSON.parse(JSON.stringify(ex));
  }

  saveEdited(): void {
    if (!this.selectedExercise?.id) return;
    const validated = this.validateAiStageExercise(JSON.parse(JSON.stringify(this.selectedExercise)));
    const index = this.aiStageExercises.findIndex((e) => e.id === validated.id);
    if (index !== -1) {
      this.aiStageExercises[index] = validated;
    }
    this.selectedExercise = null;
  }

  resetSelectedToOriginal(): void {
    if (!this.selectedExercise?.id) return;
    const orig = this.aiStageOriginalExercises.find((e) => e.id === this.selectedExercise.id);
    if (!orig) return;
    this.selectedExercise = JSON.parse(JSON.stringify(orig));
  }

  closeAiStageEditor(): void {
    this.selectedExercise = null;
  }

  getAiStageItemCount(ex: any): number {
    if (!ex) return 0;
    if (ex.type === 'matching' && Array.isArray(ex.pairs)) return ex.pairs.length;
    if (Array.isArray(ex.questions)) return ex.questions.length;
    return 0;
  }

  addAiStagePair(): void {
    if (!this.selectedExercise || this.selectedExercise.type !== 'matching') return;
    if (!Array.isArray(this.selectedExercise.pairs)) this.selectedExercise.pairs = [];
    this.selectedExercise.pairs.push({ left: '', right: '' });
  }

  removeAiStagePair(index: number): void {
    if (!this.selectedExercise?.pairs) return;
    this.selectedExercise.pairs.splice(index, 1);
  }

  addAiStageFillRow(): void {
    if (!this.selectedExercise || this.selectedExercise.type !== 'fill_in_blank') return;
    if (!Array.isArray(this.selectedExercise.questions)) this.selectedExercise.questions = [];
    this.selectedExercise.questions.push({ sentence: '', answer: '' });
  }

  removeAiStageFillRow(index: number): void {
    if (!this.selectedExercise?.questions) return;
    this.selectedExercise.questions.splice(index, 1);
  }

  addAiStageMcqQuestion(): void {
    if (!this.selectedExercise || this.selectedExercise.type !== 'mcq') return;
    if (!Array.isArray(this.selectedExercise.questions)) this.selectedExercise.questions = [];
    this.selectedExercise.questions.push({ question: '', options: ['', ''] });
  }

  removeAiStageMcqQuestion(index: number): void {
    if (!this.selectedExercise?.questions) return;
    this.selectedExercise.questions.splice(index, 1);
  }

  addAiStageMcqOption(qIndex: number): void {
    const q = this.selectedExercise?.questions?.[qIndex];
    if (!q) return;
    if (!Array.isArray(q.options)) q.options = [];
    q.options.push('');
  }

  removeAiStageMcqOption(qIndex: number, optIndex: number): void {
    const q = this.selectedExercise?.questions?.[qIndex];
    if (!q?.options || q.options.length <= 2) return;
    q.options.splice(optIndex, 1);
  }

  addAiStageShortRow(): void {
    if (!this.selectedExercise || this.selectedExercise.type !== 'short_answer') return;
    if (!Array.isArray(this.selectedExercise.questions)) this.selectedExercise.questions = [];
    this.selectedExercise.questions.push({ question: '' });
  }

  removeAiStageShortRow(index: number): void {
    if (!this.selectedExercise?.questions) return;
    this.selectedExercise.questions.splice(index, 1);
  }

  addAiStageErrorRow(): void {
    if (!this.selectedExercise || this.selectedExercise.type !== 'error_correction') return;
    if (!Array.isArray(this.selectedExercise.questions)) this.selectedExercise.questions = [];
    this.selectedExercise.questions.push({ sentence: '', corrected: '' });
  }

  removeAiStageErrorRow(index: number): void {
    if (!this.selectedExercise?.questions) return;
    this.selectedExercise.questions.splice(index, 1);
  }

  addAiStageSingularPluralRow(): void {
    if (!this.selectedExercise || this.selectedExercise.type !== 'singular_plural') return;
    if (!Array.isArray(this.selectedExercise.questions)) this.selectedExercise.questions = [];
    this.selectedExercise.questions.push({ item: '', answer: '' });
  }

  removeAiStageSingularPluralRow(index: number): void {
    if (!this.selectedExercise?.questions) return;
    this.selectedExercise.questions.splice(index, 1);
  }

  /** Strip empty rows (deterministic) before merging back into the list. */
  validateAiStageExercise(ex: any): any {
    const out = ex;
    if (out.type === 'matching' && Array.isArray(out.pairs)) {
      out.pairs = out.pairs.filter((p: any) => (p?.left || '').trim() && (p?.right || '').trim());
    }
    if (out.type === 'fill_in_blank' && Array.isArray(out.questions)) {
      out.questions = out.questions.filter((q: any) => (q?.sentence || '').trim());
    }
    if (out.type === 'mcq' && Array.isArray(out.questions)) {
      out.questions = out.questions
        .map((q: any) => ({
          question: String(q?.question ?? '').trim(),
          options: (Array.isArray(q?.options) ? q.options : []).map((o: any) => String(o ?? '').trim())
        }))
        .filter((q: any) => q.question && q.options.filter((o: string) => o).length >= 2);
    }
    if (out.type === 'short_answer' && Array.isArray(out.questions)) {
      out.questions = out.questions.filter((q: any) => (q?.question || '').trim());
    }
    if (out.type === 'error_correction' && Array.isArray(out.questions)) {
      out.questions = out.questions.filter((q: any) => (q?.sentence || '').trim());
    }
    if (out.type === 'singular_plural' && Array.isArray(out.questions)) {
      out.questions = out.questions.filter((q: any) => (q?.item || '').trim());
    }
    return out;
  }

  private ensureAiStageEditorShape(ex: any): any {
    const e = JSON.parse(JSON.stringify(ex));
    const t = String(e.type || '');
    if (t === 'matching') {
      e.pairs = Array.isArray(e.pairs)
        ? e.pairs.map((p: any) => ({
            left: String(p?.left ?? ''),
            right: String(p?.right ?? '')
          }))
        : [];
      return e;
    }
    if (t === 'fill_in_blank') {
      e.questions = Array.isArray(e.questions)
        ? e.questions.map((q: any) => ({
            sentence: String(q?.sentence ?? ''),
            answer: String(q?.answer ?? '')
          }))
        : [];
      return e;
    }
    if (t === 'mcq') {
      e.questions = Array.isArray(e.questions)
        ? e.questions.map((q: any) => ({
            question: String(q?.question ?? ''),
            options: Array.isArray(q?.options) && q.options.length ? q.options.map((o: any) => String(o ?? '')) : ['', '']
          }))
        : [];
      return e;
    }
    if (t === 'short_answer') {
      e.questions = Array.isArray(e.questions)
        ? e.questions.map((q: any) => ({
            question: String(q?.question ?? '')
          }))
        : [];
      return e;
    }
    if (t === 'error_correction') {
      e.questions = Array.isArray(e.questions)
        ? e.questions.map((q: any) => ({
            sentence: String(q?.sentence ?? ''),
            corrected: String(q?.corrected ?? '')
          }))
        : [];
      return e;
    }
    if (t === 'singular_plural') {
      e.questions = Array.isArray(e.questions)
        ? e.questions.map((q: any) => ({
            item: String(q?.item ?? q?.sentence ?? ''),
            answer: String(q?.answer ?? '')
          }))
        : [];
      return e;
    }
    e.questions = Array.isArray(e.questions) ? e.questions : [];
    return e;
  }

  // ── Step 4: Review & Edit ───────────────────────────────────────────────────

  toggleQuestion(i: number): void {
    this.reviewQuestions[i].expanded = !this.reviewQuestions[i].expanded;
  }

  removeQuestion(i: number): void {
    this.reviewQuestions.splice(i, 1);
    // Rebuild selection: remove deleted index, shift higher indices down
    const updated = new Set<number>();
    for (const idx of this.selectedIndices) {
      if (idx < i) updated.add(idx);
      else if (idx > i) updated.add(idx - 1);
    }
    this.selectedIndices = updated;
    this.selectAllChecked = this.selectedIndices.size === this.reviewQuestions.length && this.reviewQuestions.length > 0;
  }

  moveQuestion(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.reviewQuestions.length) return;
    [this.reviewQuestions[i], this.reviewQuestions[j]] = [this.reviewQuestions[j], this.reviewQuestions[i]];
  }

  applyQuestionRank(fromIndex: number, newRank: number): void {
    const n = this.reviewQuestions.length;
    if (!Number.isFinite(newRank) || newRank < 1 || newRank > n) return;
    const toIndex = Math.round(newRank) - 1;
    if (toIndex === fromIndex) return;
    const [item] = this.reviewQuestions.splice(fromIndex, 1);
    this.reviewQuestions.splice(toIndex, 0, item);
  }

  generateMissingAnswers(): void {
    // Collect questions that are missing answers
    const candidates: Array<{ index: number; q: ReviewQuestion }> = [];
    this.reviewQuestions.forEach((q, i) => {
      if (q.type === 'fill-blank') {
        const blankRuns = countFillBlankRuns((q as any).sentence || '');
        if (blankRuns < 1) return;
        const raw = Array.isArray((q as any).answers) ? (q as any).answers : [];
        const padded = [...raw];
        while (padded.length < blankRuns) padded.push('');
        const anyMissing = padded.slice(0, blankRuns).some((a: string) => !String(a ?? '').trim());
        if (anyMissing) candidates.push({ index: i, q });
      } else if (q.type === 'question-answer') {
        const hasSample = Array.isArray((q as any).sampleAnswers) && (q as any).sampleAnswers.some((a: string) => String(a || '').trim());
        if (!hasSample) candidates.push({ index: i, q });
      } else if ((q.type as any) === 'jumble-word') {
        if (!String((q as any).expectedWord || '').trim()) candidates.push({ index: i, q });
      }
    });

    if (candidates.length === 0) {
      this.showSuccess('All questions already have answers.');
      return;
    }

    this.generatingAnswers = true;
    const payload = candidates.map(({ index, q }) => {
      const base: any = { index, type: q.type };
      if (q.type === 'fill-blank') {
        base.sentence = (q as any).sentence || '';
        base.instruction = (q as any).instruction || '';
        base.hint = (q as any).hint || '';
        base.answers = (q as any).answers || [];
      } else if (q.type === 'question-answer') {
        base.prompt = (q as any).prompt || '';
        base.instruction = (q as any).instruction || '';
        base.sampleAnswers = (q as any).sampleAnswers || [];
      } else if ((q.type as any) === 'jumble-word') {
        base.prompt = (q as any).scrambledText || '';
        base.hint = (q as any).boldLetter || '';
      }
      return base;
    });

    this.exerciseService.generateMissingAnswers(payload).subscribe({
      next: (res) => {
        this.generatingAnswers = false;
        const touched = new Set<number>();
        (res.results || []).forEach((r: any) => {
          const idx = Number(r?.index);
          if (!Number.isFinite(idx) || idx < 0 || idx >= this.reviewQuestions.length) return;
          const q = this.reviewQuestions[idx] as any;
          if (!q) return;
          if (q.type === 'fill-blank' && Array.isArray(r.answers) && r.answers.length) {
            const n = countFillBlankRuns(String(q.sentence || ''));
            const merged: string[] = [];
            for (let j = 0; j < Math.max(n, 1); j++) {
              const ai = String(r.answers[j] ?? '').trim();
              const prev = String((q.answers && q.answers[j]) ?? '').trim();
              merged.push(ai || prev);
            }
            q.answers = merged;
            if (merged.some((x) => String(x || '').trim())) touched.add(idx);
          }
          if (q.type === 'question-answer' && Array.isArray(r.sampleAnswers) && r.sampleAnswers.length) {
            q.sampleAnswers = r.sampleAnswers;
            touched.add(idx);
          }
          if ((q.type as string) === 'jumble-word' && r.expectedWord) {
            q.expectedWord = String(r.expectedWord).trim();
            touched.add(idx);
          }
        });
        const filled = touched.size;
        this.showSuccess(
          filled > 0
            ? `Generated answers for ${filled} question(s).`
            : 'No answers were applied. Try again, or check that blanks use underscores (_) in the sentence.'
        );
      },
      error: (err) => {
        this.generatingAnswers = false;
        this.showError(err.error?.error || 'Failed to generate missing answers.');
      }
    });
  }

  addBlankQuestion(type: string): void {
    // These worksheet categories are represented using the existing question-answer
    // engine, with an extra `worksheetKind` label for UI rendering.
    const q: ReviewQuestion = {
      type: type as any,
      points: 1,
      expanded: true,
      aiGenerated: false,
      context: '',
      instruction: '',
      example: '',
      attachmentUrl: '',
      attachmentUploading: false,
      answerExplanation: '',
      generatingExplanation: false
    };

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
    else if (type === 'jumble-word') Object.assign(q, { scrambledText: '', boldLetter: '', expectedWord: '', categoryTip: '' });
    else if (type === 'word_bank_fill') {
      Object.assign(q, {
        type: 'word_bank_fill',
        instruction: '',
        wordBank: ['', ''],
        items: [
          { prompt: '', answer: '', acceptedAnswers: [] },
          { prompt: '', answer: '', acceptedAnswers: [] }
        ],
        reusableWords: true
      });
    } else if (type === 'rearrange') {
      Object.assign(q, {
        type: 'rearrange',
        rearrangePrompt: 'Put the words in the correct order.',
        rearrangeAnswer: '',
        rearrangeTokens: []
      });
    } else if (type === 'video-pronunciation') {
      Object.assign(q, {
        type: 'video-pronunciation',
        videoUrl: '',
        caption: '',
        secondaryCaption: '',
        secondaryCaptionAtSeconds: 5
      });
    } else if (type === 'image_pin_match') {
      Object.assign(q, {
        type: 'image_pin_match',
        imageUrl: '',
        labels: [
          { id: 'l1', text: '', correctPinId: 'p1' },
          { id: 'l2', text: '', correctPinId: 'p2' }
        ],
        pins: [
          { id: 'p1', x: 30, y: 40 },
          { id: 'p2', x: 70, y: 55 }
        ],
        settings: { randomizeLabels: true, allowRetry: true }
      });
    }

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

  getRearrangeTokensLineText(q: ReviewQuestion): string {
    const raw = q.rearrangeTokens;
    return Array.isArray(raw) ? raw.join('\n') : '';
  }

  onRearrangeTokensLinesChange(q: ReviewQuestion, text: string): void {
    q.rearrangeTokens = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  getWordBankLineText(q: ReviewQuestion): string {
    return (q.wordBank || []).join('\n');
  }

  onWordBankLinesChange(q: ReviewQuestion, text: string): void {
    q.wordBank = text.split(/\n/).map((s) => s.trim()).filter(Boolean);
  }

  addWordBankItem(q: ReviewQuestion): void {
    if (!q.items) q.items = [];
    q.items.push({ prompt: '', answer: '', acceptedAnswers: [] });
  }

  removeWordBankItem(q: ReviewQuestion, i: number): void {
    if (!q.items || q.items.length <= 1) return;
    q.items.splice(i, 1);
  }

  addImagePinLabel(q: ReviewQuestion): void {
    if (!q.labels) q.labels = [];
    const pins = q.pins || [];
    const n = q.labels.length + 1;
    const pid = pins[Math.min(n - 1, pins.length - 1)]?.id || `p${n}`;
    q.labels.push({ id: `l${n}`, text: '', correctPinId: pid });
  }

  removeImagePinLabel(q: ReviewQuestion, i: number): void {
    if (!q.labels || q.labels.length <= 1) return;
    q.labels.splice(i, 1);
  }

  addImagePinPin(q: ReviewQuestion): void {
    if (!q.pins) q.pins = [];
    const n = q.pins.length + 1;
    q.pins.push({ id: `p${n}`, x: 50, y: 50 });
  }

  removeImagePinPin(q: ReviewQuestion, i: number): void {
    if (!q.pins || q.pins.length <= 1) return;
    q.pins.splice(i, 1);
  }

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

  /** True/false worksheet: store correct side as one sample answer (matches player + builder). */
  setTrueFalseAnswer(q: ReviewQuestion, value: boolean): void {
    q.sampleAnswers = [value ? 'true' : 'false'];
  }

  parseTrueFalseAnswer(raw: unknown): boolean | null {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return null;
    if (/\b(true|richtig|wahr|ja|yes|correct)\b/.test(s)) return true;
    if (/\b(false|falsch|unwahr|nein|no|incorrect)\b/.test(s)) return false;
    return null;
  }

  // Sub-questions helpers
  addSubQuestion(q: ReviewQuestion): void {
    if (!q.subQuestions) q.subQuestions = [];
    const type = q.type;
    const sq: any = {
      type: type as any,
      points: 1
    };
    if (type === 'mcq') Object.assign(sq, { question: '', options: ['', '', '', ''], correctAnswerIndex: 0 });
    else if (type === 'matching') Object.assign(sq, { pairs: [{ left: '', right: '' }, { left: '', right: '' }] });
    else if (type === 'fill-blank') Object.assign(sq, { sentence: '', answers: [''], hint: '' });
    else if (type === 'word_bank_fill') Object.assign(sq, { wordBank: [], items: [{ prompt: '', answer: '' }] });
    else if (type === 'question-answer') Object.assign(sq, { prompt: '', sampleAnswers: [''] });
    else if (type === 'pronunciation') Object.assign(sq, { word: '', phonetic: '' });
    else if (type === 'listening') Object.assign(sq, { prompt: '', mediaUrl: '', expectedTranscript: '' });
    else Object.assign(sq, { prompt: '' });
    q.subQuestions.push(sq);
  }

  removeSubQuestion(q: ReviewQuestion, index: number): void {
    if (q.subQuestions && q.subQuestions.length > index) {
      q.subQuestions.splice(index, 1);
    }
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
    input.value = '';
    if (!file) return;

    if ((this as any)._bulkAudioMode) {
      (this as any)._bulkAudioMode = false;
      this.onBulkAudioFileSelected(file);
      return;
    }

    const q = (this as any).currentListeningQ as ReviewQuestion | null;
    (this as any).currentListeningQ = null;
    if (!q) return;
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

  /** True if string has visible text (supports sanitized HTML from rich text). */
  htmlFieldHasContent(s: string | undefined): boolean {
    if (!s) return false;
    const t = s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    return t.length > 0;
  }

  getAttachmentType(url: string | undefined): 'image' | 'audio' | 'video' | 'pdf' | 'other' {
    if (!url) return 'other';
    const lower = url.toLowerCase().split('?')[0];
    if (/\.(jpe?g|jpg|jfif|png|gif|webp|svg|avif|bmp)$/.test(lower)) return 'image';
    if (/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/.test(lower)) return 'audio';
    if (/\.(mp4|mov|avi|mkv)$/.test(lower)) return 'video';
    if (/\.pdf$/.test(lower)) return 'pdf';
    return 'other';
  }

  triggerAttachmentFile(q: ReviewQuestion): void {
    this.currentAttachmentQ = q;
    this.attachmentFileInput?.nativeElement?.click();
  }

  onAttachmentFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const q = this.currentAttachmentQ;
    this.currentAttachmentQ = null;
    input.value = '';
    if (!file || !q) return;
    q.attachmentUploading = true;
    this.exerciseService.uploadQuestionAttachment(file).subscribe({
      next: (res) => {
        q.attachmentUrl = res.url;
        q.attachmentUploading = false;
        if (this.getAttachmentType(res.url) !== 'audio') {
          q.attachmentAudioMaxPlaysPerAttempt = undefined;
        }
        this.showSuccess('File uploaded');
      },
      error: (err: { error?: { error?: string } }) => {
        q.attachmentUploading = false;
        this.showError(err.error?.error || 'Upload failed');
      }
    });
  }

  removeAttachment(q: ReviewQuestion): void {
    q.attachmentUrl = '';
    q.attachmentAudioMaxPlaysPerAttempt = undefined;
  }

  private stripHtmlPlain(s: string): string {
    return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  private getCorrectAnswerTextForReview(q: ReviewQuestion): string {
    if (q.type === 'mcq' && q.options && q.correctAnswerIndex !== undefined) {
      return this.stripHtmlPlain(q.options[q.correctAnswerIndex] || '');
    }
    if (q.type === 'fill-blank' && q.answers?.length) {
      return q.answers.join(', ');
    }
    if (q.type === 'singular_plural' && q.pairs?.length) {
      return q.pairs
        .filter((p) => this.htmlFieldHasContent(p.singular) && this.htmlFieldHasContent(p.plural))
        .map((p) => `${this.stripHtmlPlain(p.singular || '')} → ${this.stripHtmlPlain(p.plural || '')}`)
        .join(' | ');
    }
    if (q.type === 'matching' && q.pairs?.length) {
      return q.pairs
        .filter((p) => this.htmlFieldHasContent(p.left) && this.htmlFieldHasContent(p.right))
        .map((p) => `${this.stripHtmlPlain(p.left || '')} ↔ ${this.stripHtmlPlain(p.right || '')}`)
        .join(' | ');
    }
    if (q.type === 'question-answer' && q.sampleAnswers?.length) {
      return q.sampleAnswers.join(' | ');
    }
    if (q.type === 'listening' && q.expectedTranscript) {
      return q.expectedTranscript;
    }
    if (q.type === 'pronunciation' && q.word) {
      return q.word;
    }
    if ((q.type as string) === 'jumble-word' && (q as { expectedWord?: string }).expectedWord) {
      return String((q as { expectedWord?: string }).expectedWord || '');
    }
    return '';
  }

  useAiExplanation(q: ReviewQuestion): void {
    const questionText =
      this.stripHtmlPlain(q.question || '') ||
      this.stripHtmlPlain(q.prompt || '') ||
      (q.word || '').trim() ||
      (q.sentence || '').trim() ||
      this.stripHtmlPlain(q.instruction || '');
    const contextText = (q.context || '').trim();
    const correctAnswer = this.getCorrectAnswerTextForReview(q);
    const sampleAnswers = (q.sampleAnswers || []).map((x) => String(x || '').trim()).filter(Boolean);
    if (!questionText && !contextText && !correctAnswer && sampleAnswers.length === 0) {
      this.showError('Please fill in the question details first');
      return;
    }
    q.generatingExplanation = true;
    this.exerciseService
      .generateExplanation({
        questionType: (q as { worksheetKind?: string }).worksheetKind || q.type,
        questionText: questionText || this.stripHtmlPlain(q.instruction || ''),
        storyParagraph: '',
        contextText,
        correctAnswer,
        sampleAnswers,
        targetLanguage: this.targetLanguage
      })
      .subscribe({
        next: (res) => {
          q.answerExplanation = res.explanation;
          q.generatingExplanation = false;
        },
        error: (err: { error?: { error?: string } }) => {
          q.generatingExplanation = false;
          this.showError(err.error?.error || 'AI generation failed');
        }
      });
  }

  // Validation
  isQuestionValid(q: ReviewQuestion): boolean {
    if (q.type === 'mcq') {
      return this.htmlFieldHasContent(q.question) && (q.options?.filter((o) => this.htmlFieldHasContent(o)).length ?? 0) >= 2;
    }
    if (q.type === 'matching') {
      return (q.pairs?.filter((p) => this.htmlFieldHasContent(p.left) && this.htmlFieldHasContent(p.right)).length ?? 0) >= 2;
    }
    if (q.type === 'singular_plural') {
      const rows = q.pairs?.filter((p) => this.htmlFieldHasContent(p.singular) && this.htmlFieldHasContent(p.plural)) ?? [];
      return rows.length >= 1;
    }
    if (q.type === 'fill-blank') return !!(q.sentence?.trim()) && this.getBlankCount(q) > 0 && (q.answers?.every(a => a.trim()) ?? false);
    if (q.type === 'pronunciation') return !!(q.word?.trim());
    if (q.type === 'question-answer') {
      if (!this.htmlFieldHasContent(q.prompt)) return false;
      if (q.worksheetKind === 'true-false') {
        return this.parseTrueFalseAnswer(q.sampleAnswers?.[0]) !== null;
      }
      return true;
    }
    if (q.type === 'listening') return !!(q.mediaUrl?.trim()) && !!(q.expectedTranscript?.trim());
    if (q.type === 'word_bank_fill') {
      const words = (q.wordBank || []).filter((w) => String(w || '').trim());
      const rows = (q.items || []).filter((it) => String(it?.prompt || '').trim() && String(it?.answer || '').trim());
      return words.length >= 2 && rows.length >= 1;
    }
    if (q.type === 'rearrange') {
      const promptOk = !!String(q.rearrangePrompt || '').trim();
      const ansOk = !!String(q.rearrangeAnswer || '').trim();
      const toks = q.rearrangeTokens;
      const toksOk = Array.isArray(toks) && toks.filter((t) => String(t || '').trim()).length >= 2;
      return promptOk && (ansOk || toksOk);
    }
    if (q.type === 'video-pronunciation') return !!(q.videoUrl?.trim()) && !!(q.caption?.trim());
    if (q.type === 'image_pin_match') {
      const imageUrl = String(q.imageUrl || '').trim();
      if (!imageUrl || this.getAttachmentType(imageUrl) !== 'image') return false;
      const pins = q.pins || [];
      const labels = q.labels || [];
      if (pins.length < 1 || labels.length < 1) return false;
      return labels.every((l) => String(l.text || '').trim() && String(l.correctPinId || '').trim());
    }
    if (q.type === 'jumble-word') return !!(q.scrambledText?.trim()) && !!(q.expectedWord?.trim());
    return false;
  }

  /** Human-readable reasons why a question is invalid (for tooltips). */
  getQuestionValidationHint(q: ReviewQuestion): string {
    if (this.isQuestionValid(q)) return '';

    const parts: string[] = [];

    if (q.type === 'mcq') {
      if (!this.htmlFieldHasContent(q.question)) parts.push('Add the question text.');
      const filled = q.options?.filter((o) => this.htmlFieldHasContent(o)).length ?? 0;
      if (filled < 2) parts.push(`Need at least 2 filled answer options (currently ${filled}).`);
    } else if (q.type === 'matching') {
      const good = q.pairs?.filter((p) => this.htmlFieldHasContent(p.left) && this.htmlFieldHasContent(p.right)).length ?? 0;
      if (good < 2) parts.push(`Need at least 2 complete pairs with left and right text (currently ${good}).`);
    } else if (q.type === 'singular_plural') {
      const good = q.pairs?.filter((p) => this.htmlFieldHasContent(p.singular) && this.htmlFieldHasContent(p.plural)).length ?? 0;
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
      if (!this.htmlFieldHasContent(q.prompt)) parts.push('Add the question or instruction text.');
      if (q.worksheetKind === 'true-false' && this.parseTrueFalseAnswer(q.sampleAnswers?.[0]) === null) {
        parts.push('Choose whether the statement is Richtig or Falsch.');
      }
    } else if (q.type === 'listening') {
      if (!q.mediaUrl?.trim()) parts.push('Add audio (upload or URL).');
      if (!q.expectedTranscript?.trim()) parts.push('Add the expected transcript.');
    } else if (q.type === 'word_bank_fill') {
      const words = (q.wordBank || []).filter((w) => String(w || '').trim());
      const rows = (q.items || []).filter((it) => String(it?.prompt || '').trim() && String(it?.answer || '').trim());
      if (words.length < 2) parts.push('Add at least two words to the word bank.');
      if (rows.length < 1) parts.push('Add at least one item with prompt and answer.');
    } else if (q.type === 'rearrange') {
      if (!String(q.rearrangePrompt || '').trim()) parts.push('Add the task prompt.');
      const ansOk = !!String(q.rearrangeAnswer || '').trim();
      const toksOk =
        Array.isArray(q.rearrangeTokens) && q.rearrangeTokens.filter((t) => String(t || '').trim()).length >= 2;
      if (!ansOk && !toksOk) parts.push('Add the correct sentence or at least two word tokens in order.');
    } else if (q.type === 'video-pronunciation') {
      if (!q.videoUrl?.trim()) parts.push('Add a video URL.');
      if (!q.caption?.trim()) parts.push('Add the caption line students should speak.');
    } else if (q.type === 'image_pin_match') {
      const imageUrl = String(q.imageUrl || '').trim();
      if (!imageUrl || this.getAttachmentType(imageUrl) !== 'image') parts.push('Add a direct image URL for the background.');
      const labels = q.labels || [];
      const pins = q.pins || [];
      if (pins.length < 1) parts.push('Add at least one pin.');
      if (labels.length < 1) parts.push('Add at least one label.');
      labels.forEach((l, i) => {
        if (!String(l.text || '').trim() || !String(l.correctPinId || '').trim()) {
          parts.push(`Complete label ${i + 1} (text and target pin).`);
        }
      });
    } else if (q.type === 'jumble-word') {
      if (!q.scrambledText?.trim()) parts.push('Add scrambled text.');
      if (!q.expectedWord?.trim()) parts.push('Add the expected word.');
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

  // ── Bulk Select helpers ──────────────────────────────────────────────────────

  toggleSelectQuestion(i: number, event: Event): void {
    event.stopPropagation();
    if (this.selectedIndices.has(i)) {
      this.selectedIndices.delete(i);
    } else {
      this.selectedIndices.add(i);
    }
    this.selectAllChecked = this.selectedIndices.size === this.reviewQuestions.length;
  }

  toggleSelectAll(event: Event): void {
    event.stopPropagation();
    if (this.selectAllChecked) {
      this.selectedIndices.clear();
      this.selectAllChecked = false;
    } else {
      this.reviewQuestions.forEach((_, i) => this.selectedIndices.add(i));
      this.selectAllChecked = true;
    }
  }

  clearSelection(): void {
    this.selectedIndices.clear();
    this.selectAllChecked = false;
    this.bulkEditField = '';
    this.bulkEditValue = '';
    this.bulkTypeChangeOpen = false;
    this.bulkTargetType = '';
  }

  isSelected(i: number): boolean {
    return this.selectedIndices.has(i);
  }

  // ── Bulk Field Edit ──────────────────────────────────────────────────────────

  applyBulkField(): void {
    if (!this.bulkEditField || this.selectedIndices.size === 0) return;
    for (const idx of this.selectedIndices) {
      const q = this.reviewQuestions[idx] as any;
      if (!q) continue;
      if (this.bulkEditField === 'audio') {
        q.mediaUrl = this.bulkEditValue;
      } else if (this.bulkEditField === 'attachment') {
        q.attachmentUrl = this.bulkEditValue;
      } else {
        q[this.bulkEditField] = this.bulkEditValue;
      }
    }
    this.showSuccess(`Applied "${this.bulkEditField}" to ${this.selectedIndices.size} question(s).`);
    this.bulkEditValue = '';
  }

  triggerBulkAudioFile(): void {
    (this as any)._bulkAudioMode = true;
    this.listeningFileInput?.nativeElement?.click();
  }

  onBulkAudioFileSelected(file: File): void {
    this.bulkAudioUploading = true;
    this.exerciseService.uploadListeningMedia(file).subscribe({
      next: (res) => {
        this.bulkAudioUploading = false;
        this.bulkEditValue = res.url;
        this.applyBulkField();
      },
      error: (err) => {
        this.bulkAudioUploading = false;
        this.showError(err.error?.error || 'Audio upload failed');
      }
    });
  }

  // ── Bulk Type Conversion ─────────────────────────────────────────────────────

  convertSelectedTypes(): void {
    if (!this.bulkTargetType || this.selectedIndices.size === 0 || this.bulkConverting) return;
    const indices = Array.from(this.selectedIndices);
    this.bulkConverting = true;
    this.bulkConvertProgress = 0;
    this.bulkConvertTotal = indices.length;

    const convertNext = (pos: number): void => {
      if (pos >= indices.length) {
        this.bulkConverting = false;
        this.showSuccess(`Converted ${indices.length} question(s) to "${this.bulkTargetType}".`);
        this.bulkTypeChangeOpen = false;
        this.bulkTargetType = '';
        return;
      }
      const idx = indices[pos];
      const q = this.reviewQuestions[idx] as any;
      this.exerciseService.convertQuestionType({
        question: q,
        targetType: this.bulkTargetType,
        targetLanguage: this.targetLanguage
      }).subscribe({
        next: (res) => {
          if (res?.question) {
            let conv = { ...res.question, expanded: false, aiGenerated: q.aiGenerated } as ReviewQuestion;
            if (conv.type === 'rearrange' && conv.rearrangeTokens != null && typeof (conv as any).rearrangeTokens === 'string') {
              conv = {
                ...conv,
                rearrangeTokens: String((conv as any).rearrangeTokens)
                  .split(/\s+/)
                  .map((t) => t.trim())
                  .filter(Boolean)
              };
            }
            if (conv.type === 'image_pin_match' && !conv.settings) {
              conv = { ...conv, settings: { randomizeLabels: true, allowRetry: true } };
            }
            this.reviewQuestions[idx] = conv;
          }
          this.bulkConvertProgress = pos + 1;
          convertNext(pos + 1);
        },
        error: (err) => {
          this.showError(err.error?.error || `Conversion failed for question ${idx + 1}.`);
          this.bulkConvertProgress = pos + 1;
          convertNext(pos + 1);
        }
      });
    };

    convertNext(0);
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
    const extraTags = this.customTags
      .split(',')
      .map((t: string) => t.trim())
      .filter((t: string) => !!t);
    const payload = {
      title: this.exerciseTitle.trim(),
      description: this.exerciseDescription.trim(),
      targetLanguage: this.targetLanguage as 'German' | 'English',
      nativeLanguage: this.nativeLanguage as 'English' | 'Tamil' | 'Sinhala',
      level: this.level as any,
      category: this.category as any,
      difficulty: this.difficulty,
      estimatedDuration: this.estimatedDuration,
      courseDay,
      visibleToStudents: publish,
      questions: this.reviewQuestions.filter(q => this.isQuestionValid(q)).map(q => {
        const { expanded, aiGenerated, attachmentUploading, generatingExplanation, ...rest } = q;
        return rest;
      }) as ExerciseQuestion[],
      tags: ['ai-generated', 'pdf-import', ...extraTags]
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
    return (
      this.questionTypes.find((t) => t.value === type) ?? {
        value: type,
        label: type,
        desc: '',
        icon: 'help_outline',
        color: '#64748b',
        bg: '#f1f5f9'
      }
    );
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
