// src/app/components/digital-exercise-builder/digital-exercise-builder.component.ts

import { Component, OnInit, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import {
  DigitalExerciseService,
  DigitalExercise,
  ExerciseMediaClear,
  VideoExerciseFeedbackItem
} from '../../services/digital-exercise.service';
import { canonicalizeStoredMediaUrl, resolveMediaUrl } from '../../utils/media-url';
import { countFillBlankRuns } from '../../utils/fill-blank';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';
import { RichTextInputComponent } from '../../shared/rich-text-input/rich-text-input.component';

interface BuilderQuestion {
  type: 'mcq' | 'matching' | 'fill-blank' | 'word_bank_fill' | 'pronunciation' | 'question-answer' | 'listening' | 'video-pronunciation' | 'singular_plural' | 'jumble-word' | 'rearrange' | 'image_pin_match';
  worksheetKind?: string | null;
  context?: string;
  // MCQ
  question?: string;
  imageUrl?: string;
  options?: string[];
  optionImageUrls?: string[];
  correctAnswerIndex?: number;
  explanation?: string;
  /** Worked sample banner; persisted on API as `example` (avoid in-memory name `example` for ngModel). */
  workedExample?: string;
  // Matching (instruction reused as generic banner for other types too)
  instruction?: string;
  // Within-day sequence letter (a/b/c…); stored at exercise level, not question level
  // (kept here only for the builder's per-exercise form; not saved on question)
  pairs?: Array<{ left?: string; right?: string; singular?: string; plural?: string }>;
  // Fill-blank
  sentence?: string;
  answers?: string[];
  hint?: string;
  caseSensitive?: boolean;
  // Word bank fill
  wordBank?: string[];
  items?: Array<{ prompt: string; answer: string; acceptedAnswers?: string[] }>;
  reusableWords?: boolean;
  // Pronunciation
  word?: string;
  phonetic?: string;
  translation?: string;
  audioUrl?: string;
  acceptedVariants?: string[];
  // Question / Answer
  prompt?: string;
  sampleAnswers?: string[];
  // Story paragraph for worksheet-style questions (e.g. true-false reading passage).
  storyParagraph?: string;
  similarityThreshold?: number;   // 0-100, default varies by type
  scoringMode?: 'full' | 'proportional';
  aiGradingEnabled?: boolean;
  // Listening
  mediaUrl?: string;
  expectedTranscript?: string; // stored as the correct answer text for listening
  attemptMode?: 'typing' | 'typing-or-speech';
  transcribing?: boolean;
  // Video Pronunciation
  videoUrl?: string;
  caption?: string;
  secondaryCaption?: string;
  secondaryCaptionAtSeconds?: number;
  videoUploading?: boolean;
  // Common
  points: number;
  imagePinImageUploading?: boolean;
  imagePinImageLoadError?: boolean;
  /** Presigned URL for immediate display after upload; falls back to imageUrl on load. */
  imagePinDisplayUrl?: string;
  // Per-question attachment (any file type)
  attachmentUrl?: string;
  /** When attachment is audio: max play starts per student attempt (empty = unlimited). */
  attachmentAudioMaxPlaysPerAttempt?: number | null;
  attachmentUploading?: boolean;
  // Teacher explanation shown to students in review
  answerExplanation?: string;
  generatingExplanation?: boolean;
  // Jumble Word
  scrambledText?: string;
  boldLetter?: string;
  expectedWord?: string;
  categoryTip?: string;
  // Rearrange (builder-only)
  rearrangePrompt?: string;
  rearrangeAnswer?: string;
  /** Newline-separated correct token order (stored to API as string[]) */
  rearrangeTokens?: string;
  // Image pin match
  labels?: Array<{ id: string; text: string; correctPinId: string }>;
  pins?: Array<{ id: string; x: number; y: number }>;
  settings?: { randomizeLabels?: boolean; allowRetry?: boolean };
  // Sub-questions (multiple questions with same context/hints/images)
  subQuestions?: BuilderQuestion[];
}

interface VideoFeedbackAudioRow {
  audioUrl: string;
  caption: string;
  uploading: boolean;
}

@Component({
  selector: 'app-digital-exercise-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, RichTextInputComponent],
  templateUrl: './digital-exercise-builder.component.html',
  styleUrls: ['./digital-exercise-builder.component.css']
})
export class DigitalExerciseBuilderComponent implements OnInit {
  isEditMode = false;
  exerciseId: string | null = null;
  saving = false;
  loading = false;
  mediaRecovering = false;
  /** Explicit media removals this session — server will not restore previous URLs for these fields. */
  private mediaClears: ExerciseMediaClear[] = [];
  /** Presigned S3 URLs for admin preview (canonical URLs remain in question models). */
  private mediaDisplayCache = new Map<string, string>();

  // Exercise metadata
  title = '';
  description = '';
  targetLanguage: 'English' | 'German' = 'German';
  nativeLanguage: 'English' | 'Tamil' | 'Sinhala' = 'English';
  level: string = 'A1';
  category = 'Grammar';
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' = 'Beginner';
  estimatedDuration = 15;
  tags = '';
  /** Empty = not tied to a journey day (visible whenever published + student filters). */
  courseDayStr = '';
  /** Within-day sequence letter (single a–z char). Empty = ungated. */
  sequenceLetter = '';
  visibleToStudents = false;

  questions: BuilderQuestion[] = [];

  activeTab: 'info' | 'questions' | 'video' | 'preview' = 'info';
  expandedQuestion = -1;

  // ── Bulk select / edit (parity with PDF extract review) ──
  selectedIndices = new Set<number>();
  selectAllChecked = false;
  bulkEditField: 'context' | 'instruction' | 'example' | 'audio' | 'attachment' | 'attachment-upload' | '' = '';
  bulkEditValue = '';
  bulkAudioUploading = false;
  bulkAttachmentUploading = false;
  bulkTypeChangeOpen = false;
  bulkTargetType = '';
  bulkConverting = false;
  bulkConvertProgress = 0;
  bulkConvertTotal = 0;
  generatingAnswers = false;

  /** Move selected questions into a new exercise (edit mode only). */
  splitModalOpen = false;
  splitSaving = false;
  splitTitle = '';
  splitDescription = '';
  splitTargetLanguage: 'English' | 'German' = 'German';
  splitNativeLanguage: 'English' | 'Tamil' | 'Sinhala' = 'English';
  splitLevel = 'A1';
  splitCategory = 'Grammar';
  splitDifficulty: 'Beginner' | 'Intermediate' | 'Advanced' = 'Beginner';
  splitEstimatedDuration = 15;
  splitTags = '';
  splitCourseDayStr = '';
  splitSequenceLetter = '';
  splitVisibleToStudents = false;

  @ViewChild('listeningFileInput') listeningFileInput!: ElementRef<HTMLInputElement>;
  currentListeningQ: BuilderQuestion | null = null;

  @ViewChild('videoFileInput') videoFileInput!: ElementRef<HTMLInputElement>;
  currentVideoQ: BuilderQuestion | null = null;

  @ViewChild('attachmentFileInput') attachmentFileInput!: ElementRef<HTMLInputElement>;
  currentAttachmentQ: BuilderQuestion | null = null;
  @ViewChild('imagePinFileInput') imagePinFileInput!: ElementRef<HTMLInputElement>;
  currentImagePinQ: BuilderQuestion | null = null;
  @ViewChild('mcqOptionImageFileInput') mcqOptionImageFileInput!: ElementRef<HTMLInputElement>;
  currentMcqOptionImage: { q: BuilderQuestion; oi: number } | null = null;
  mcqOptionImageUploadingKey: string | null = null;
  mcqOptionUrlExpandedKey: string | null = null;

  readonly maxVideoFeedbackClips = 4;
  videoSuccessFeedbackRows: VideoFeedbackAudioRow[] = [];
  videoRetryFeedbackRows: VideoFeedbackAudioRow[] = [];
  @ViewChild('videoFeedbackFileInput') videoFeedbackFileInput!: ElementRef<HTMLInputElement>;
  private videoFeedbackUploadTarget: { kind: 'success' | 'retry'; index: number } | null = null;
  private draggingPinQuestionIndex: number | null = null;
  private draggingPinId: string | null = null;

  levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  categories = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];
  difficulties: Array<'Beginner' | 'Intermediate' | 'Advanced'> = ['Beginner', 'Intermediate', 'Advanced'];
  languages = ['English', 'German'];
  nativeLanguages = ['English', 'Tamil', 'Sinhala'];

  questionTypes: Array<{ value: string; label: string; icon: string; description: string }> = [
    { value: 'mcq',             label: 'Multiple Choice',   icon: 'quiz',              description: 'Options with one correct answer. Supports images.' },
    { value: 'matching',        label: 'Matching Exercise',  icon: 'compare_arrows',    description: 'Match left items with right items.' },
    { value: 'fill-blank',      label: 'Fill in the Blanks', icon: 'text_fields',       description: 'Sentences with _ or ___ blanks to fill in.' },
    { value: 'word_bank_fill',  label: 'Word Bank Fill',      icon: 'format_list_bulleted', description: 'Shared word bank with multiple blank prompts.' },
    { value: 'pronunciation',   label: 'Pronunciation Check',icon: 'record_voice_over', description: 'Student speaks a word/phrase; system checks pronunciation.' },
    { value: 'question-answer', label: 'Question / Answer',  icon: 'short_text',        description: 'Student reads the question and types a free-text answer.' },
    { value: 'listening',       label: 'Listening',          icon: 'headphones',         description: 'Student listens to audio and types the correct answer.' },
    { value: 'true-false', label: 'Richtig / Falsch', icon: 'toggle_on', description: 'Entscheiden Sie, ob eine Aussage richtig oder falsch ist.' },
    { value: 'sentence-transformation', label: 'Sentence Transformation', icon: 'transform', description: 'Transform a sentence (statement → question, etc.).' },
    { value: 'singular_plural', label: 'Singular / Plural', icon: 'swap_horiz', description: 'Student sees the singular form and types the plural.' },
    { value: 'table-profile-fill', label: 'Table / Profile Fill-in', icon: 'table_rows', description: 'Fill values in a table/profile.' },
    { value: 'free-writing-own-sentences', label: 'Free Writing / Own Sentences', icon: 'edit_note', description: 'Write your own sentences.' },
    { value: 'free-writing-profile', label: 'Free Writing – profile', icon: 'badge', description: 'Write a short profile (Steckbrief).' },
    { value: 'error-correction', label: 'Error Correction', icon: 'error', description: 'Correct mistakes and write the right sentence.' },
    { value: 'jumble-word', label: 'Jumble Word', icon: 'shuffle', description: 'Scrambled letters → student forms the correct word.' },
    { value: 'rearrange', label: 'Rearrange', icon: 'reorder', description: 'Student rearranges words into the correct order (drag-drop or typing).' },
    { value: 'image_pin_match', label: 'Image Pin Match', icon: 'place', description: 'Map labels to pins on an image.' }
  ];

  constructor(
    private exerciseService: DigitalExerciseService,
    private router: Router,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.exerciseId = this.route.snapshot.paramMap.get('id');
    this.isEditMode = !!this.exerciseId;
    if (this.isEditMode) {
      this.loadExercise();
    }
  }

  loadExercise(): void {
    this.loading = true;
    this.exerciseService.getExercise(this.exerciseId!).subscribe({
      next: (exercise) => {
        this.title = exercise.title;
        this.description = exercise.description;
        this.targetLanguage = exercise.targetLanguage;
        this.nativeLanguage = (exercise.nativeLanguage as any) || 'English';
        this.level = exercise.level;
        this.category = exercise.category;
        this.difficulty = exercise.difficulty || 'Beginner';
        this.estimatedDuration = exercise.estimatedDuration || 15;
        this.tags = (exercise.tags || []).join(', ');
        this.courseDayStr =
          exercise.courseDay != null && exercise.courseDay !== undefined
            ? String(exercise.courseDay)
            : '';
        this.sequenceLetter = exercise.sequenceLetter || '';
        this.visibleToStudents = exercise.visibleToStudents || false;
        this.questions = (exercise.questions || []).map(q => this.mapQuestionFromApi(q));
        this.videoSuccessFeedbackRows = (exercise.videoSuccessFeedback || []).map((x) => ({
          audioUrl: x.audioUrl,
          caption: x.caption || '',
          uploading: false
        }));
        this.videoRetryFeedbackRows = (exercise.videoRetryFeedback || []).map((x) => ({
          audioUrl: x.audioUrl,
          caption: x.caption || '',
          uploading: false
        }));
        this.mediaClears = [];
        this.hydrateMediaDisplayUrls();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.showError('Failed to load exercise');
      }
    });
  }

  private collectMediaUrlsForPresign(): string[] {
    const urls: string[] = [];
    const add = (raw: string | null | undefined) => {
      const c = this.canonicalizeMediaField(raw);
      if (c && c.includes('.amazonaws.com/')) urls.push(c);
    };
    for (const q of this.questions) {
      add(q.imageUrl);
      add(q.attachmentUrl);
      add(q.videoUrl);
      if (q.type === 'mcq') {
        for (const u of q.optionImageUrls || []) add(u);
      }
      for (const sq of q.subQuestions || []) {
        add(sq.imageUrl);
        add(sq.attachmentUrl);
        if (sq.type === 'mcq') {
          for (const u of sq.optionImageUrls || []) add(u);
        }
      }
    }
    for (const row of [...this.videoSuccessFeedbackRows, ...this.videoRetryFeedbackRows]) {
      add(row.audioUrl);
    }
    return [...new Set(urls)];
  }

  private hydrateMediaDisplayUrls(): void {
    this.mediaDisplayCache.clear();
    const needPresign = this.collectMediaUrlsForPresign();
    if (!needPresign.length) return;
    this.exerciseService.presignMediaUrls(needPresign).subscribe({
      next: ({ resolutions }) => {
        for (const r of resolutions || []) {
          const original = this.canonicalizeMediaField(r.original);
          if (original && r.url) this.mediaDisplayCache.set(original, r.url);
        }
      },
    });
  }

  /** Scan R2/S3 for stored paths and repair MongoDB links (e.g. Modeltest after redeploy). */
  recoverMediaFromCloud(): void {
    if (!this.isEditMode || !this.exerciseId || this.mediaRecovering) return;
    this.mediaRecovering = true;
    this.exerciseService.recoverExerciseMedia(this.exerciseId).subscribe({
      next: (res) => {
        this.mediaRecovering = false;
        const n = res.updatedCount || 0;
        const miss = res.missing?.length || 0;
        if (n > 0) {
          this.questions = (res.exercise.questions || []).map((q) => this.mapQuestionFromApi(q));
          this.videoSuccessFeedbackRows = (res.exercise.videoSuccessFeedback || []).map((x) => ({
            audioUrl: x.audioUrl,
            caption: x.caption || '',
            uploading: false,
          }));
          this.videoRetryFeedbackRows = (res.exercise.videoRetryFeedback || []).map((x) => ({
            audioUrl: x.audioUrl,
            caption: x.caption || '',
            uploading: false,
          }));
          this.hydrateMediaDisplayUrls();
        }
        if (n > 0 && miss === 0) {
          this.showSuccess(`Recovered ${n} media link(s) from cloud storage.`);
        } else if (n > 0) {
          this.showSuccess(`Recovered ${n} link(s). ${miss} could not be found — re-upload those.`);
        } else if (miss > 0) {
          this.showError(`No files found in cloud for ${miss} stored path(s). Re-upload missing images.`);
        } else {
          this.showSuccess('All media links already point to cloud storage.');
        }
      },
      error: (err) => {
        this.mediaRecovering = false;
        this.showError(err?.error?.error || 'Media recovery failed');
      },
    });
  }

  private canonicalizeMediaField(url: string | null | undefined): string {
    return canonicalizeStoredMediaUrl(url);
  }

  private markMediaCleared(qIndex: number, field: string, subIndex: number | null = null): void {
    this.mediaClears.push({ qIndex, subIndex, field });
  }

  private questionIndexOf(q: BuilderQuestion): number {
    return this.questions.indexOf(q);
  }

  private subQuestionIndexOf(parent: BuilderQuestion, sq: BuilderQuestion): number {
    return (parent.subQuestions || []).indexOf(sq);
  }

  /** Drop builder-only UI fields before persisting to the API. */
  private stripBuilderOnlyFields(row: Record<string, unknown>): void {
    const drop = [
      'workedExample',
      'imagePinDisplayUrl',
      'imagePinImageUploading',
      'imagePinImageLoadError',
      'attachmentUploading',
      'videoUploading',
      'transcribing',
      'generatingExplanation'
    ];
    for (const key of drop) delete row[key];
  }

  private mapQuestionFromApi(q: any): BuilderQuestion {
    const base: BuilderQuestion = {
      type: q.type,
      points: q.points || 1,
      context: q.context || '',
      // Persisted on every question type; shown in player banner (non-matching) and editor.
      instruction: q.instruction || '',
      workedExample: q.example || '',
      attachmentUrl: this.canonicalizeMediaField(q.attachmentUrl),
      attachmentAudioMaxPlaysPerAttempt: this.normalizeAttachmentAudioMaxPlays(
        q.attachmentAudioMaxPlaysPerAttempt
      ),
      answerExplanation: q.answerExplanation || '',
      worksheetKind: q.worksheetKind || null,
      similarityThreshold: (typeof q.similarityThreshold === 'number')
        ? this.clampThreshold(q.similarityThreshold)
        : this.defaultThresholdForQuestion(q.type),
      scoringMode: q.scoringMode === 'proportional' ? 'proportional' : 'full',
      aiGradingEnabled: q.aiGradingEnabled !== false
    };
    if (q.type === 'mcq') {
      const options = [...(q.options || ['', '', '', ''])];
      const rawImages = Array.isArray(q.optionImageUrls) ? q.optionImageUrls.map((u: unknown) => String(u || '').trim()) : [];
      Object.assign(base, {
        question: q.question || '',
        imageUrl: this.canonicalizeMediaField(q.imageUrl),
        options,
        optionImageUrls: options.map((_, i) => this.canonicalizeMediaField(rawImages[i])),
        correctAnswerIndex: q.correctAnswerIndex ?? 0,
        explanation: q.explanation || ''
      });
    } else if (q.type === 'matching') {
      Object.assign(base, {
        instruction: q.instruction || 'Match the items on the left with their correct pairs on the right.',
        pairs: (q.pairs || [{ left: '', right: '' }]).map((p: any) => ({ left: p.left, right: p.right }))
      });
    } else if (q.type === 'singular_plural') {
      Object.assign(base, {
        instruction: q.instruction || 'Write the correct plural form.',
        pairs: (q.pairs || [])
          .map((p: any) => ({
            singular: String(p.singular || '').trim(),
            plural: String(p.plural || '').trim()
          }))
          .filter((p: { singular: string; plural: string }) => p.singular || p.plural)
      });
    } else if (q.type === 'fill-blank') {
      Object.assign(base, {
        sentence: q.sentence || '',
        answers: [...(q.answers || [''])],
        hint: q.hint || '',
        caseSensitive: q.caseSensitive || false
      });
    } else if ((q.type as any) === 'word_bank_fill') {
      Object.assign(base, {
        wordBank: Array.isArray(q.wordBank) ? q.wordBank.map((w: any) => String(w || '').trim()) : [],
        items: Array.isArray(q.items) ? q.items.map((it: any) => {
          const prompt = String(it?.prompt || '');
          const answer = String(it?.answer || '');
          const base: { prompt: string; answer: string; acceptedAnswers?: string[] } = { prompt, answer };
          const alts = Array.isArray(it?.acceptedAnswers)
            ? it.acceptedAnswers.map((a: any) => String(a || '').trim()).filter(Boolean)
            : [];
          if (alts.length) base.acceptedAnswers = alts;
          return base;
        }) : [{ prompt: '', answer: '' }],
        reusableWords: q.reusableWords !== false
      });
    } else if (q.type === 'pronunciation') {
      Object.assign(base, {
        word: q.word || '',
        phonetic: q.phonetic || '',
        translation: q.translation || '',
        audioUrl: q.audioUrl || '',
        acceptedVariants: [...(q.acceptedVariants || [])]
      });
    } else if (q.type === 'question-answer') {
      Object.assign(base, {
        prompt: q.prompt || '',
        sampleAnswers: [...(q.sampleAnswers || [''])],
        storyParagraph: q.storyParagraph || ''
      });
    } else if (q.type === 'video-pronunciation') {
      Object.assign(base, {
        videoUrl: this.canonicalizeMediaField(q.videoUrl),
        caption: q.caption || '',
        secondaryCaption: q.secondaryCaption || '',
        secondaryCaptionAtSeconds: this.normalizeSecondaryCaptionDelaySeconds(q.secondaryCaptionAtSeconds),
        acceptedVariants: [...(q.acceptedVariants || [])]
      });
    } else if (q.type === 'listening') {
      Object.assign(base, {
        prompt: q.prompt || '',
        mediaUrl: q.mediaUrl || '',
        expectedTranscript: q.expectedTranscript || '',
        attemptMode: q.attemptMode === 'typing-or-speech' ? 'typing-or-speech' : 'typing'
      });
    } else if ((q.type as any) === 'jumble-word') {
      Object.assign(base, {
        scrambledText: String(q.scrambledText || ''),
        boldLetter: String(q.boldLetter || ''),
        expectedWord: String(q.expectedWord || ''),
        categoryTip: String(q.categoryTip || '')
      });
    } else if ((q.type as any) === 'rearrange') {
      const rawToks = q.rearrangeTokens;
      const tokensStr = Array.isArray(rawToks)
        ? rawToks.map((t: any) => String(t || '').trim()).filter(Boolean).join('\n')
        : String(rawToks || '');
      Object.assign(base, {
        rearrangePrompt: q.rearrangePrompt || '',
        rearrangeAnswer: q.rearrangeAnswer || '',
        rearrangeTokens: tokensStr
      });
    } else if ((q.type as any) === 'image_pin_match') {
      Object.assign(base, {
        imageUrl: this.canonicalizeMediaField(q.imageUrl),
        labels:
          Array.isArray(q.labels) && q.labels.length
            ? q.labels.map((l: any) => ({
                id: String(l?.id || '').trim(),
                text: String(l?.text || '').trim(),
                correctPinId: String(l?.correctPinId || '').trim()
              }))
            : [
                { id: this.newLabelId(), text: '', correctPinId: '' },
                { id: this.newLabelId(), text: '', correctPinId: '' }
              ],
        pins: Array.isArray(q.pins)
          ? q.pins
              .map((p: any) => ({
                id: String(p?.id || '').trim(),
                x: Math.max(0, Math.min(100, Number(p?.x) || 0)),
                y: Math.max(0, Math.min(100, Number(p?.y) || 0))
              }))
              .filter((p: { id: string }) => p.id)
          : [],
        settings: {
          randomizeLabels: q.settings?.randomizeLabels !== false,
          allowRetry: q.settings?.allowRetry !== false
        }
      });
    }

    if (Array.isArray(q.subQuestions) && q.subQuestions.length) {
      (base as BuilderQuestion).subQuestions = q.subQuestions.map((sq: any) => this.mapQuestionFromApi(sq));
    }

    return base;
  }

  moveQuestion(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.questions.length) return;
    this.moveQuestionToIndex(index, target);
  }

  applyQuestionSequence(currentIndex: number, rawValue: string | number): void {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const desiredIndex = Math.max(0, Math.min(this.questions.length - 1, Math.floor(parsed) - 1));
    if (desiredIndex === currentIndex) return;
    this.moveQuestionToIndex(currentIndex, desiredIndex);
  }

  private moveQuestionToIndex(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const moved = this.questions[fromIndex];
    if (!moved) return;

    this.questions.splice(fromIndex, 1);
    this.questions.splice(toIndex, 0, moved);
    this.syncSelectedIndicesAfterMove(fromIndex, toIndex);

    if (this.expandedQuestion === fromIndex) {
      this.expandedQuestion = toIndex;
      return;
    }
    if (fromIndex < this.expandedQuestion && this.expandedQuestion <= toIndex) {
      this.expandedQuestion -= 1;
      return;
    }
    if (toIndex <= this.expandedQuestion && this.expandedQuestion < fromIndex) {
      this.expandedQuestion += 1;
    }
  }

  /** Add one more question of the same type as the last one. */
  addOneMoreQuestion(): void {
    this.addQuestion(this.lastQuestionType);
  }

  addQuestion(type: string): void {
    const worksheetKinds = [
      'true-false',
      'sentence-transformation',
      'table-profile-fill',
      'free-writing-own-sentences',
      'free-writing-profile',
      'error-correction'
    ];

    const isWorksheetKind = worksheetKinds.includes(type);
    const qType: BuilderQuestion['type'] = (isWorksheetKind ? 'question-answer' : (type as any));

    const q: BuilderQuestion = {
      type: qType as any,
      points: 1,
      context: '',
      instruction: '',
      workedExample: '',
      worksheetKind: isWorksheetKind ? type : null,
      attachmentUrl: '',
      answerExplanation: '',
      similarityThreshold: this.defaultThresholdForQuestion(qType),
      scoringMode: 'full',
      aiGradingEnabled: true
    };

    if (qType === 'mcq') {
      q.question = '';
      q.imageUrl = '';
      q.options = ['', '', '', ''];
      q.optionImageUrls = ['', '', '', ''];
      q.correctAnswerIndex = 0;
      q.explanation = '';
    } else if (qType === 'matching') {
      q.instruction = 'Match the items on the left with their correct pairs on the right.';
      q.pairs = [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }];
    } else if (qType === 'singular_plural') {
      q.instruction = 'Write the correct plural form.';
      q.pairs = [{ singular: '', plural: '' }, { singular: '', plural: '' }];
      q.aiGradingEnabled = false;
      q.scoringMode = 'full';
    } else if (qType === 'fill-blank') {
      q.sentence = '';
      q.answers = [''];
      q.hint = '';
      q.caseSensitive = false;
    } else if ((qType as any) === 'word_bank_fill') {
      q.wordBank = ['', '', '', ''];
      q.items = [{ prompt: '', answer: '' }, { prompt: '', answer: '' }];
      q.reusableWords = true;
    } else if (qType === 'pronunciation') {
      q.word = '';
      q.phonetic = '';
      q.translation = '';
      q.acceptedVariants = [];
    } else if (qType === 'question-answer') {
      q.prompt = '';
      q.sampleAnswers = [''];
      q.storyParagraph = '';
      if (q.worksheetKind === 'free-writing-own-sentences' || q.worksheetKind === 'free-writing-profile' || q.worksheetKind === 'table-profile-fill') {
        q.similarityThreshold = 60;
        q.scoringMode = 'proportional';
      } else if (q.worksheetKind === 'true-false') {
        q.similarityThreshold = 75;
        q.scoringMode = 'full';
      } else {
        q.similarityThreshold = 70;
        q.scoringMode = 'full';
      }
    } else if (type === 'listening') {
      q.prompt = '';
      q.mediaUrl = '';
      q.expectedTranscript = '';
      q.attemptMode = 'typing';
    } else if (type === 'jumble-word') {
      (q as any).scrambledText = '';
      (q as any).boldLetter = '';
      (q as any).expectedWord = '';
      (q as any).categoryTip = '';
      q.instruction = '';
    } else if (type === 'rearrange') {
      (q as any).rearrangePrompt = '';
      (q as any).rearrangeAnswer = '';
      (q as any).rearrangeTokens = '';
    } else if (type === 'image_pin_match') {
      q.imageUrl = '';
      q.labels = [
        { id: this.newLabelId(), text: '', correctPinId: '' },
        { id: this.newLabelId(), text: '', correctPinId: '' }
      ];
      q.pins = [];
      q.settings = { randomizeLabels: true, allowRetry: true };
      q.aiGradingEnabled = true;
      q.scoringMode = 'proportional';
      q.similarityThreshold = 100;
    }
    this.questions.push(q);
    this.expandedQuestion = this.questions.length - 1;
    this.activeTab = 'questions';
  }

  removeQuestion(index: number): void {
    this.questions.splice(index, 1);
    const updated = new Set<number>();
    for (const idx of this.selectedIndices) {
      if (idx < index) updated.add(idx);
      else if (idx > index) updated.add(idx - 1);
    }
    this.selectedIndices = updated;
    this.selectAllChecked = this.selectedIndices.size === this.questions.length && this.questions.length > 0;
    if (this.expandedQuestion >= this.questions.length) {
      this.expandedQuestion = this.questions.length - 1;
    }
  }

  addSubQuestion(parentIndex: number): void {
    const parent = this.questions[parentIndex];
    if (!parent) return;
    if (!parent.subQuestions) {
      parent.subQuestions = [];
    }
    const subQ = this.createSubQuestion(parent);
    parent.subQuestions.push(subQ);
  }

  removeSubQuestion(parentIndex: number, subIndex: number): void {
    const parent = this.questions[parentIndex];
    if (!parent || !parent.subQuestions) return;
    parent.subQuestions.splice(subIndex, 1);
  }

  private createSubQuestion(parent: BuilderQuestion): BuilderQuestion {
    const qType = parent.type;
    const q: BuilderQuestion = {
      type: qType as any,
      points: parent.points || 1,
      context: parent.context || '',
      instruction: parent.instruction || '',
      workedExample: parent.workedExample || '',
      worksheetKind: parent.worksheetKind,
      attachmentUrl: parent.attachmentUrl || '',
      answerExplanation: parent.answerExplanation || '',
      similarityThreshold: parent.similarityThreshold ?? this.defaultThresholdForQuestion(qType),
      scoringMode: parent.scoringMode || 'full',
      aiGradingEnabled: parent.aiGradingEnabled ?? true
    };

    if (qType === 'mcq') {
      q.question = '';
      q.imageUrl = parent.imageUrl || '';
      q.options = ['', '', '', ''];
      q.correctAnswerIndex = 0;
      q.explanation = parent.explanation || '';
    } else if (qType === 'matching') {
      q.instruction = parent.instruction || 'Match the items on the left with their correct pairs on the right.';
      q.pairs = [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }];
    } else if (qType === 'singular_plural') {
      q.instruction = parent.instruction || 'Write the correct plural form.';
      q.pairs = [{ singular: '', plural: '' }, { singular: '', plural: '' }];
      q.aiGradingEnabled = false;
      q.scoringMode = 'full';
    } else if (qType === 'fill-blank') {
      q.sentence = '';
      q.answers = [''];
      q.hint = parent.hint || '';
      q.caseSensitive = parent.caseSensitive || false;
    } else if ((qType as any) === 'word_bank_fill') {
      q.wordBank = [...(parent.wordBank || [])];
      q.items = [{ prompt: '', answer: '' }, { prompt: '', answer: '' }];
      q.reusableWords = parent.reusableWords ?? true;
    } else if (qType === 'pronunciation') {
      q.word = '';
      q.phonetic = parent.phonetic || '';
      q.translation = parent.translation || '';
      q.acceptedVariants = [];
    } else if (qType === 'question-answer') {
      q.prompt = '';
      q.sampleAnswers = [''];
      q.storyParagraph = parent.storyParagraph || '';
      q.similarityThreshold = parent.similarityThreshold ?? 70;
      q.scoringMode = parent.scoringMode || 'full';
    } else if (qType === 'listening') {
      q.prompt = '';
      q.mediaUrl = parent.mediaUrl || '';
      q.expectedTranscript = '';
      q.attemptMode = 'typing';
    } else if ((qType as any) === 'jumble-word') {
      (q as any).scrambledText = '';
      (q as any).boldLetter = '';
      (q as any).expectedWord = '';
      (q as any).categoryTip = '';
      q.instruction = '';
    } else if ((qType as any) === 'rearrange') {
      (q as any).rearrangePrompt = '';
      (q as any).rearrangeAnswer = '';
      (q as any).rearrangeTokens = '';
    } else if ((qType as any) === 'image_pin_match') {
      q.imageUrl = parent.imageUrl || '';
      q.labels = [
        { id: this.newLabelId(), text: '', correctPinId: '' },
        { id: this.newLabelId(), text: '', correctPinId: '' }
      ];
      q.pins = [];
      q.settings = { randomizeLabels: true, allowRetry: true };
      q.aiGradingEnabled = true;
      q.scoringMode = 'proportional';
      q.similarityThreshold = 100;
    } else if (qType === 'video-pronunciation') {
      q.videoUrl = parent.videoUrl || '';
      q.caption = '';
      q.secondaryCaption = '';
      q.secondaryCaptionAtSeconds = 5;
      q.acceptedVariants = [];
    }

    return q;
  }

  /** Last question type for "Add one more" button. */
  get lastQuestionType(): string {
    if (this.questions.length === 0) return 'mcq';
    const last = this.questions[this.questions.length - 1];
    if (last.type === 'question-answer' && last.worksheetKind) return last.worksheetKind;
    return last.type;
  }

  toggleExpanded(index: number): void {
    this.expandedQuestion = this.expandedQuestion === index ? -1 : index;
  }

  // MCQ helpers
  addOption(q: BuilderQuestion): void {
    q.options!.push('');
    this.ensureMcqOptionImages(q);
    q.optionImageUrls!.push('');
  }
  removeOption(q: BuilderQuestion, i: number): void {
    q.options!.splice(i, 1);
    this.ensureMcqOptionImages(q);
    q.optionImageUrls!.splice(i, 1);
    if (q.correctAnswerIndex! >= q.options!.length) q.correctAnswerIndex = 0;
  }

  ensureMcqOptionImages(q: BuilderQuestion): void {
    if (!Array.isArray(q.options)) return;
    if (!Array.isArray(q.optionImageUrls)) {
      q.optionImageUrls = q.options.map(() => '');
      return;
    }
    while (q.optionImageUrls.length < q.options.length) q.optionImageUrls.push('');
    while (q.optionImageUrls.length > q.options.length) q.optionImageUrls.pop();
  }

  mcqOptionKey(q: BuilderQuestion, oi: number): string {
    const idx = this.questions.indexOf(q);
    return `${idx >= 0 ? idx : 'sub'}-${oi}`;
  }

  getMcqOptionImageUrl(q: BuilderQuestion, oi: number): string {
    this.ensureMcqOptionImages(q);
    return String(q.optionImageUrls?.[oi] || '').trim();
  }

  hasMcqOptionImages(q: BuilderQuestion): boolean {
    this.ensureMcqOptionImages(q);
    return (q.optionImageUrls || []).some((u) => !!String(u || '').trim());
  }

  isMcqOptionImageUploading(q: BuilderQuestion, oi: number): boolean {
    return this.mcqOptionImageUploadingKey === this.mcqOptionKey(q, oi);
  }

  toggleMcqOptionUrlInput(q: BuilderQuestion, oi: number): void {
    const key = this.mcqOptionKey(q, oi);
    this.mcqOptionUrlExpandedKey = this.mcqOptionUrlExpandedKey === key ? null : key;
  }

  isMcqOptionUrlExpanded(q: BuilderQuestion, oi: number): boolean {
    return this.mcqOptionUrlExpandedKey === this.mcqOptionKey(q, oi);
  }

  triggerMcqOptionImageFile(q: BuilderQuestion, oi: number): void {
    this.currentMcqOptionImage = { q, oi };
    this.mcqOptionImageFileInput?.nativeElement?.click();
  }

  onMcqOptionImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const target = this.currentMcqOptionImage;
    this.currentMcqOptionImage = null;
    input.value = '';
    if (!file || !target) return;
    if (!String(file.type || '').toLowerCase().startsWith('image/')) {
      this.showError('Please select an image file');
      return;
    }
    const { q, oi } = target;
    const key = this.mcqOptionKey(q, oi);
    this.mcqOptionImageUploadingKey = key;
    this.exerciseService.uploadQuestionAttachment(file).subscribe({
      next: (res) => {
        const canonicalUrl = String(res?.canonicalUrl || res?.url || '').trim();
        if (!canonicalUrl || this.getAttachmentType(canonicalUrl) !== 'image') {
          this.mcqOptionImageUploadingKey = null;
          this.showError('Uploaded file is not a valid image');
          return;
        }
        this.ensureMcqOptionImages(q);
        q.optionImageUrls![oi] = canonicalUrl;
        const displayUrl = String(res?.url || '').trim();
        if (displayUrl) this.mediaDisplayCache.set(canonicalUrl, displayUrl);
        this.mcqOptionImageUploadingKey = null;
        this.mcqOptionUrlExpandedKey = null;
        this.showSuccess('Option image uploaded');
      },
      error: (err) => {
        this.mcqOptionImageUploadingKey = null;
        this.showError(err.error?.error || 'Image upload failed');
      }
    });
  }

  setMcqOptionImageUrl(q: BuilderQuestion, oi: number, raw: string): void {
    this.ensureMcqOptionImages(q);
    q.optionImageUrls![oi] = String(raw || '').trim();
  }

  removeMcqOptionImage(q: BuilderQuestion, oi: number): void {
    this.ensureMcqOptionImages(q);
    const qi = this.questionIndexOf(q);
    if (qi >= 0) this.markMediaCleared(qi, `optionImageUrl:${oi}`);
    q.optionImageUrls![oi] = '';
    if (this.mcqOptionUrlExpandedKey === this.mcqOptionKey(q, oi)) {
      this.mcqOptionUrlExpandedKey = null;
    }
  }

  // Matching helpers
  addPair(q: BuilderQuestion): void {
    if (q.type === 'singular_plural') q.pairs!.push({ singular: '', plural: '' });
    else q.pairs!.push({ left: '', right: '' });
  }
  removePair(q: BuilderQuestion, i: number): void { q.pairs!.splice(i, 1); }
  addWordBankWord(q: BuilderQuestion): void {
    if (!Array.isArray(q.wordBank)) q.wordBank = [];
    q.wordBank.push('');
  }
  removeWordBankWord(q: BuilderQuestion, i: number): void {
    if (!Array.isArray(q.wordBank)) return;
    q.wordBank.splice(i, 1);
  }
  addWordBankItem(q: BuilderQuestion): void {
    if (!Array.isArray(q.items)) q.items = [];
    q.items.push({ prompt: '', answer: '' });
  }
  removeWordBankItem(q: BuilderQuestion, i: number): void {
    if (!Array.isArray(q.items)) return;
    q.items.splice(i, 1);
  }

  setWordBankItemAccepted(raw: string, item: { acceptedAnswers?: string[] }): void {
    const parts = String(raw || '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) delete item.acceptedAnswers;
    else item.acceptedAnswers = parts;
  }

  // Fill-blank helpers
  onSentenceChange(q: BuilderQuestion): void {
    const count = countFillBlankRuns(q.sentence || '');
    while ((q.answers!.length) < count) q.answers!.push('');
    while ((q.answers!.length) > count) q.answers!.pop();
  }

  /** Insert _ at cursor (if sentence field was focused) or at end. Click button with sentence focused to insert at cursor. */
  insertBlank(q: BuilderQuestion): void {
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

  addVariant(q: BuilderQuestion): void { q.acceptedVariants!.push(''); }
  removeVariant(q: BuilderQuestion, i: number): void { q.acceptedVariants!.splice(i, 1); }

  addSampleAnswer(q: BuilderQuestion): void { q.sampleAnswers!.push(''); }
  removeSampleAnswer(q: BuilderQuestion, i: number): void {
    if (q.sampleAnswers!.length > 1) q.sampleAnswers!.splice(i, 1);
  }

  /** True/False worksheet: store admin selection as a single sampleAnswers entry. */
  setTrueFalseAnswer(q: BuilderQuestion, value: boolean): void {
    q.sampleAnswers = [value ? 'true' : 'false'];
  }

  /** Supports both English and worksheet-generated German values (richtig/falsch). */
  parseTrueFalseAnswer(raw: any): boolean | null {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return null;
    if (/\b(true|richtig|wahr|ja|yes|correct)\b/.test(s)) return true;
    if (/\b(false|falsch|unwahr|nein|no|incorrect)\b/.test(s)) return false;
    return null;
  }

  /** True/False worksheet: add another question using the same story paragraph. */
  addMoreTrueFalseForSameParagraph(q: BuilderQuestion): void {
    const paragraph = q.storyParagraph || '';
    this.addQuestion('true-false');
    const newQ = this.questions[this.questions.length - 1];
    newQ.storyParagraph = paragraph;
  }

  setThreshold(q: BuilderQuestion, raw: any): void {
    let v = parseInt(String(raw), 10);
    if (isNaN(v)) return;
    q.similarityThreshold = this.clampThreshold(v);
  }

  private clampThreshold(v: number): number {
    if (v < 0) return 0;
    if (v > 100) return 100;
    return Math.round(v);
  }

  private defaultThresholdForQuestion(type: BuilderQuestion['type']): number {
    // Keep existing behavior baseline for pronunciation/video types.
    if (type === 'video-pronunciation') return 20;
    return 70;
  }

  private normalizeSecondaryCaptionDelaySeconds(raw: any): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 5;
    return Math.max(0, Math.min(600, Math.round(n)));
  }

  // ─── Question attachment helpers ───────────────────────────────────────────

  triggerAttachmentFile(q: BuilderQuestion): void {
    this.currentAttachmentQ = q;
    this.attachmentFileInput?.nativeElement?.click();
  }

  onAttachmentFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if ((this as any)._bulkAttachmentMode) {
      (this as any)._bulkAttachmentMode = false;
      this.onBulkAttachmentFileSelected(file);
      return;
    }
    const q = this.currentAttachmentQ;
    this.currentAttachmentQ = null;
    if (!q) return;
    q.attachmentUploading = true;
    this.exerciseService.uploadQuestionAttachment(file).subscribe({
      next: (res) => {
        const canonicalUrl = this.canonicalizeMediaField(res.canonicalUrl || res.url);
        q.attachmentUrl = canonicalUrl;
        q.attachmentUploading = false;
        if (this.getAttachmentType(canonicalUrl) !== 'audio') {
          q.attachmentAudioMaxPlaysPerAttempt = undefined;
        }
        this.showSuccess('File uploaded');
      },
      error: (err) => {
        q.attachmentUploading = false;
        this.showError(err.error?.error || 'Upload failed');
      }
    });
  }

  removeAttachment(q: BuilderQuestion): void {
    const qi = this.questionIndexOf(q);
    if (qi >= 0) this.markMediaCleared(qi, 'attachmentUrl');
    q.attachmentUrl = '';
    q.attachmentAudioMaxPlaysPerAttempt = undefined;
  }

  /** Valid cap 1–99, otherwise undefined (unlimited). */
  normalizeAttachmentAudioMaxPlays(raw: unknown): number | undefined {
    const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').trim(), 10);
    if (!Number.isFinite(n) || n < 1) return undefined;
    return Math.min(99, Math.floor(n));
  }

  triggerImagePinImageFile(q: BuilderQuestion): void {
    this.currentImagePinQ = q;
    this.imagePinFileInput?.nativeElement?.click();
  }

  onImagePinImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const q = this.currentImagePinQ;
    this.currentImagePinQ = null;
    input.value = '';
    if (!file || !q) return;
    if (!String(file.type || '').toLowerCase().startsWith('image/')) {
      this.showError('Please select an image file');
      return;
    }
    q.imagePinImageUploading = true;
    this.exerciseService.uploadQuestionAttachment(file).subscribe({
      next: (res) => {
        // presignedUrl is used for immediate display; canonicalUrl (raw S3 path) is
        // stored in imageUrl so the database always holds a stable, non-expiring reference.
        const presignedUrl = String(res?.url || '').trim();
        const canonicalUrl = String(res?.canonicalUrl || presignedUrl).trim();
        const checkUrl = canonicalUrl || presignedUrl;
        if (this.getAttachmentType(checkUrl) !== 'image') {
          q.imagePinImageUploading = false;
          this.showError('Uploaded file is not a valid image. Please upload JPG/PNG/WebP/SVG.');
          return;
        }
        q.imageUrl = canonicalUrl;
        q.imagePinDisplayUrl = presignedUrl;
        q.imagePinImageLoadError = false;
        q.imagePinImageUploading = false;
        this.showSuccess('Image uploaded');
      },
      error: (err) => {
        q.imagePinImageUploading = false;
        this.showError(err.error?.error || 'Image upload failed');
      }
    });
  }

  getAttachmentType(url: string): 'image' | 'audio' | 'video' | 'pdf' | 'other' {
    if (!url) return 'other';
    const lower = url.toLowerCase().split('?')[0];
    if (/\.(jpe?g|jpg|jfif|png|gif|webp|svg|avif|bmp)$/.test(lower)) return 'image';
    if (/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/.test(lower)) return 'audio';
    if (/\.(mp4|mov|avi|mkv)$/.test(lower)) return 'video';
    if (/\.pdf$/.test(lower)) return 'pdf';
    return 'other';
  }

  onImagePinImageUrlChanged(q: BuilderQuestion): void {
    q.imagePinImageLoadError = false;
    q.imagePinDisplayUrl = undefined;
  }

  onImagePinImageLoad(q: BuilderQuestion): void {
    q.imagePinImageLoadError = false;
  }

  onImagePinImageError(q: BuilderQuestion): void {
    q.imagePinImageLoadError = true;
  }

  /** Listening audio may live on attachment (preferred) or legacy mediaUrl. */
  hasListeningAudio(q: BuilderQuestion): boolean {
    if (q.type !== 'listening') return false;
    const att = String(q.attachmentUrl || '').trim();
    if (att && this.getAttachmentType(att) === 'audio') return true;
    return !!(q.mediaUrl || '').trim();
  }

  getListeningPreviewAudioUrl(q: BuilderQuestion): string | null {
    const att = String(q.attachmentUrl || '').trim();
    if (att && this.getAttachmentType(att) === 'audio') return att;
    const m = String(q.mediaUrl || '').trim();
    return m || null;
  }

  // ─── AI explanation helpers ────────────────────────────────────────────────

  useAiExplanation(q: BuilderQuestion): void {
    const questionText =
      q.question || q.prompt || q.word || q.sentence || q.instruction || '';
    const storyParagraph = q.storyParagraph || '';
    const contextText = q.context || '';
    const sampleAnswers = (q.sampleAnswers || []).map((x) => String(x || '').trim()).filter(Boolean);
    const audioUrl = this.getExplanationAudioUrl(q);
    const hasTextContext =
      questionText || storyParagraph || contextText || this.getCorrectAnswerText(q) || sampleAnswers.length > 0;

    if (!hasTextContext && !audioUrl) {
      this.showError('Please fill in the question details or attach audio first');
      return;
    }
    if (q.type === 'listening' && !audioUrl) {
      this.showError('Upload listening audio before generating an explanation');
      return;
    }

    q.generatingExplanation = true;

    const runGenerate = (audioTranscript: string) => {
      if (q.type === 'listening' && audioTranscript && !(q.expectedTranscript || '').trim()) {
        q.expectedTranscript = audioTranscript;
      }
      const correctAnswer = this.getCorrectAnswerText(q) || audioTranscript;
      this.exerciseService.generateExplanation({
        questionType: q.worksheetKind || q.type,
        questionText,
        storyParagraph,
        contextText,
        correctAnswer,
        sampleAnswers,
        targetLanguage: this.targetLanguage,
        audioTranscript: audioTranscript || undefined
      }).subscribe({
        next: (res) => {
          q.answerExplanation = res.explanation;
          q.generatingExplanation = false;
        },
        error: (err) => {
          q.generatingExplanation = false;
          this.showError(err.error?.error || 'AI generation failed');
        }
      });
    };

    if (audioUrl) {
      this.exerciseService.transcribeListening(audioUrl).subscribe({
        next: (res) => runGenerate((res.transcript || '').trim()),
        error: (err) => {
          if (q.type === 'listening' || !hasTextContext) {
            q.generatingExplanation = false;
            this.showError(err.error?.error || 'Could not transcribe audio');
            return;
          }
          runGenerate('');
        }
      });
      return;
    }

    runGenerate('');
  }

  /** Audio URL used to ground AI answer explanations (listening + audio attachments). */
  private getExplanationAudioUrl(q: BuilderQuestion): string | null {
    if (q.type === 'listening') return this.getListeningPreviewAudioUrl(q);
    const att = String(q.attachmentUrl || '').trim();
    if (att && this.getAttachmentType(att) === 'audio') return att;
    const media = String(q.mediaUrl || '').trim();
    if (media) return media;
    return null;
  }

  private getCorrectAnswerText(q: BuilderQuestion): string {
    if (q.type === 'mcq' && q.options && q.correctAnswerIndex !== undefined) {
      return q.options[q.correctAnswerIndex] || '';
    }
    if (q.type === 'fill-blank' && q.answers?.length) {
      return q.answers.join(', ');
    }
    if ((q.type as any) === 'word_bank_fill' && q.items?.length) {
      return q.items
        .filter((it) => String(it?.prompt || '').trim() && String(it?.answer || '').trim())
        .map((it) => {
          const alts = (it as any).acceptedAnswers as string[] | undefined;
          const altStr =
            Array.isArray(alts) && alts.length ? ` [${alts.join(', ')}]` : '';
          return `${it.prompt} → ${it.answer}${altStr}`;
        })
        .join(' | ');
    }
    if (q.type === 'singular_plural' && q.pairs?.length) {
      return q.pairs
        .filter((p) => (p.singular || '').trim() && (p.plural || '').trim())
        .map((p) => `${p.singular} → ${p.plural}`)
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
    if (q.type === 'jumble-word' && q.expectedWord) {
      return q.expectedWord;
    }
    if ((q.type as any) === 'rearrange') {
      const toks = String((q as any).rearrangeTokens || '').trim();
      if (toks) return toks.split('\n').map((x) => x.trim()).filter(Boolean).join(' ');
      const ans = String((q as any).rearrangeAnswer || '').trim();
      return ans;
    }
    return '';
  }

  // Listening helpers
  triggerListeningFile(q: BuilderQuestion): void {
    this.currentListeningQ = q;
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
    const q = this.currentListeningQ;
    this.currentListeningQ = null;
    if (!q) return;
    this.exerciseService.uploadListeningMedia(file).subscribe({
      next: (res) => {
        q.mediaUrl = res.url;
        this.showSuccess('Audio uploaded');
      },
      error: (err) => this.showError(err.error?.error || 'Upload failed')
    });
  }

  // Video pronunciation helpers
  get videoQuestions(): BuilderQuestion[] {
    return this.questions.filter(q => q.type === 'video-pronunciation');
  }

  addVideoQuestion(): void {
    const q: BuilderQuestion = {
      type: 'video-pronunciation',
      context: '',
      videoUrl: '',
      caption: '',
      secondaryCaption: '',
      secondaryCaptionAtSeconds: 5,
      acceptedVariants: [],
      points: 1,
      attachmentUrl: '',
      answerExplanation: '',
      similarityThreshold: this.defaultThresholdForQuestion('video-pronunciation'),
      scoringMode: 'full',
      aiGradingEnabled: true
    };
    this.questions.push(q);
    this.activeTab = 'video';
  }

  triggerVideoFile(q: BuilderQuestion): void {
    this.currentVideoQ = q;
    this.videoFileInput?.nativeElement?.click();
  }

  onVideoFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const q = this.currentVideoQ;
    this.currentVideoQ = null;
    input.value = '';
    if (!file || !q) return;
    if (file.size > 200 * 1024 * 1024) {
      this.showError('Video file is too large (max 200 MB)');
      return;
    }
    q.videoUploading = true;
    this.exerciseService.uploadVideoMedia(file).subscribe({
      next: (res) => {
        q.videoUrl = res.url;
        q.videoUploading = false;
        this.showSuccess('Video uploaded');
      },
      error: (err) => {
        q.videoUploading = false;
        this.showError(err.error?.error || 'Video upload failed');
      }
    });
  }

  removeVideoQuestion(index: number): void {
    const globalIndex = this.questions.indexOf(this.videoQuestions[index]);
    if (globalIndex !== -1) this.questions.splice(globalIndex, 1);
  }

  addVideoSuccessFeedbackRow(): void {
    if (this.videoSuccessFeedbackRows.length >= this.maxVideoFeedbackClips) return;
    this.videoSuccessFeedbackRows.push({ audioUrl: '', caption: '', uploading: false });
  }

  removeVideoSuccessFeedbackRow(i: number): void {
    this.markMediaCleared(-1, `videoSuccessFeedback:${i}:audioUrl`);
    this.videoSuccessFeedbackRows.splice(i, 1);
  }

  addVideoRetryFeedbackRow(): void {
    if (this.videoRetryFeedbackRows.length >= this.maxVideoFeedbackClips) return;
    this.videoRetryFeedbackRows.push({ audioUrl: '', caption: '', uploading: false });
  }

  removeVideoRetryFeedbackRow(i: number): void {
    this.markMediaCleared(-1, `videoRetryFeedback:${i}:audioUrl`);
    this.videoRetryFeedbackRows.splice(i, 1);
  }

  triggerVideoFeedbackUpload(kind: 'success' | 'retry', index: number): void {
    this.videoFeedbackUploadTarget = { kind, index };
    this.videoFeedbackFileInput?.nativeElement?.click();
  }

  onVideoFeedbackFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const target = this.videoFeedbackUploadTarget;
    this.videoFeedbackUploadTarget = null;
    input.value = '';
    if (!file || !target) return;
    const rows = target.kind === 'success' ? this.videoSuccessFeedbackRows : this.videoRetryFeedbackRows;
    const row = rows[target.index];
    if (!row) return;
    if (file.size > 40 * 1024 * 1024) {
      this.showError('Audio file too large (max 40 MB)');
      return;
    }
    row.uploading = true;
    this.exerciseService.uploadListeningMedia(file).subscribe({
      next: (res) => {
        row.audioUrl = res.url;
        row.uploading = false;
        this.showSuccess('Audio uploaded');
      },
      error: (err) => {
        row.uploading = false;
        this.showError(err.error?.error || 'Upload failed');
      }
    });
  }

  private mapVideoFeedbackToApi(rows: VideoFeedbackAudioRow[]): VideoExerciseFeedbackItem[] {
    return rows
      .filter((r) => r.audioUrl.trim())
      .map((r) => ({ audioUrl: r.audioUrl.trim(), caption: r.caption.trim() }));
  }

  moveVideoQuestion(vIdx: number, direction: -1 | 1): void {
    const targetVIdx = vIdx + direction;
    const vQuestions = this.videoQuestions;
    if (targetVIdx < 0 || targetVIdx >= vQuestions.length) return;
    const aIdx = this.questions.indexOf(vQuestions[vIdx]);
    const bIdx = this.questions.indexOf(vQuestions[targetVIdx]);
    if (aIdx !== -1 && bIdx !== -1) {
      [this.questions[aIdx], this.questions[bIdx]] = [this.questions[bIdx], this.questions[aIdx]];
    }
  }

  isVideoQuestionsValid(): boolean {
    const vq = this.videoQuestions;
    if (vq.length === 0) return false;
    return vq.every(q => !!(q.videoUrl?.trim()) && !!(q.caption?.trim()));
  }

  getMediaFullUrl(relative: string): string {
    const canonical = this.canonicalizeMediaField(relative);
    if (!canonical) return '';
    return this.mediaDisplayCache.get(canonical) || resolveMediaUrl(canonical);
  }

  getBlankCount(q: BuilderQuestion): number {
    return countFillBlankRuns(q.sentence || '');
  }

  getTypeLabel(type: string): string {
    const worksheetKindLabels: Record<string, string> = {
      'true-false': 'Richtig / Falsch',
      'sentence-transformation': 'Sentence Transformation',
      'singular-plural': 'Singular → Plural',
      'table-profile-fill': 'Table / Profile Fill-in',
      'free-writing-own-sentences': 'Free Writing / Own Sentences',
      'free-writing-profile': 'Free Writing – profile',
      'error-correction': 'Error Correction'
    };
    if (worksheetKindLabels[type]) return worksheetKindLabels[type];
    return this.exerciseService.getQuestionTypeLabel(type as any);
  }

  getTypeIcon(type: string): string {
    const worksheetKindIcons: Record<string, string> = {
      'true-false': 'toggle_on',
      'sentence-transformation': 'transform',
      'singular-plural': 'swap_horiz',
      'table-profile-fill': 'table_rows',
      'free-writing-own-sentences': 'edit_note',
      'free-writing-profile': 'badge',
      'error-correction': 'error'
    };
    if (worksheetKindIcons[type]) return worksheetKindIcons[type];
    return this.exerciseService.getQuestionTypeIcon(type as any);
  }

  /** Stable trackBy so option/answer rows are not recreated when text changes; keeps radio selection. */
  trackByIndex(_idx: number): number {
    return _idx;
  }

  isInfoValid(): boolean {
    return !!this.title.trim() && !!this.description.trim() && !!this.level && !!this.category;
  }

  isQuestionsValid(): boolean {
    if (this.questions.length === 0) return false;
    const mainValid = this.questions.every(q => this.isQuestionValid(q));
    if (!mainValid) return false;
    const subValid = this.questions.every(q => {
      if (!q.subQuestions || q.subQuestions.length === 0) return true;
      return q.subQuestions.every(sq => this.isQuestionValid(sq));
    });
    return subValid;
  }

  isQuestionValid(q: BuilderQuestion): boolean {
    if (q.type === 'mcq') return !!(q.question?.trim()) && (q.options?.filter(o => o.trim()).length ?? 0) >= 2;
    if (q.type === 'matching') return (q.pairs?.filter(p => (p.left || '').trim() && (p.right || '').trim()).length ?? 0) >= 2;
    if (q.type === 'singular_plural') {
      const rows = q.pairs?.filter(p => (p.singular || '').trim() && (p.plural || '').trim()) ?? [];
      return rows.length >= 1;
    }
    if (q.type === 'fill-blank') return !!(q.sentence?.trim()) && this.getBlankCount(q) > 0 && (q.answers?.every(a => a.trim()) ?? false);
    if ((q.type as any) === 'word_bank_fill') {
      const words = (q.wordBank || []).map((w) => String(w || '').trim()).filter(Boolean);
      const rows = (q.items || []).filter((it) => String(it?.prompt || '').trim() && String(it?.answer || '').trim());
      return words.length >= 2 && rows.length >= 1;
    }
    if (q.type === 'pronunciation') return !!(q.word?.trim());
    if (q.type === 'question-answer') return !!(q.prompt?.trim());
    if (q.type === 'listening') return this.hasListeningAudio(q) && !!(q.expectedTranscript?.trim());
    if (q.type === 'video-pronunciation') return !!(q.videoUrl?.trim()) && !!(q.caption?.trim());
    if ((q.type as any) === 'jumble-word') return !!(q as any).scrambledText?.trim() && !!(q as any).expectedWord?.trim();
    if ((q.type as any) === 'rearrange') {
      const promptOk = !!String((q as any).rearrangePrompt || '').trim();
      const ansOk = !!String((q as any).rearrangeAnswer || '').trim();
      const toksOk = !!String((q as any).rearrangeTokens || '').trim();
      return promptOk && (ansOk || toksOk);
    }
    if ((q.type as any) === 'image_pin_match') {
      const imageUrl = String(q.imageUrl || '').trim();
      const imageOk = !!imageUrl && this.getAttachmentType(imageUrl) === 'image';
      const pins = Array.isArray(q.pins) ? q.pins : [];
      const labels = Array.isArray(q.labels) ? q.labels : [];
      if (!imageOk || pins.length < 1 || labels.length < 1) return false;
      return labels.every((l) => String(l.text || '').trim() && String(l.correctPinId || '').trim());
    }
    return false;
  }

  save(): void {
    if (this.videoSuccessFeedbackRows.some((r) => r.uploading) || this.videoRetryFeedbackRows.some((r) => r.uploading)) {
      this.showError('Wait for feedback audio uploads to finish before saving');
      this.activeTab = 'video';
      return;
    }
    if (!this.isInfoValid()) { this.showError('Please fill in all required exercise info'); this.activeTab = 'info'; return; }
    const hasVideoOnly = this.questions.length > 0 && this.questions.every(q => q.type === 'video-pronunciation');
    if (hasVideoOnly) {
      if (!this.isVideoQuestionsValid()) { this.showError('Please complete all video questions (video + caption required)'); this.activeTab = 'video'; return; }
    } else {
      if (!this.isQuestionsValid()) { this.showError('Please complete all questions'); this.activeTab = 'questions'; return; }
    }

    let courseDay: number | null = null;
    const dayTrim = this.courseDayStr.trim();
    if (dayTrim) {
      const p = parseInt(dayTrim, 10);
      if (!Number.isFinite(p) || p < 1 || p > 200) {
        this.showError('Course day must be empty or a number from 1 to 200');
        this.activeTab = 'info';
        return;
      }
      courseDay = p;
    }

    this.saving = true;
    const normalizedQuestions = this.normalizeQuestionsForApi(this.questions);

    // Normalize sequenceLetter: single lowercase letter a-z, or null
    const rawLetter = this.sequenceLetter.trim().toLowerCase();
    const sequenceLetter = /^[a-z]$/.test(rawLetter) ? rawLetter : null;

    const payload: Partial<DigitalExercise> = {
      title: this.title.trim(),
      description: this.description.trim(),
      targetLanguage: this.targetLanguage,
      nativeLanguage: this.nativeLanguage,
      level: this.level as any,
      category: this.category,
      difficulty: this.difficulty,
      estimatedDuration: this.estimatedDuration,
      tags: this.tags.split(',').map(t => t.trim()).filter(Boolean),
      courseDay,
      sequenceLetter,
      visibleToStudents: this.visibleToStudents,
      questions: normalizedQuestions as any,
      videoSuccessFeedback: this.mapVideoFeedbackToApi(this.videoSuccessFeedbackRows),
      videoRetryFeedback: this.mapVideoFeedbackToApi(this.videoRetryFeedbackRows),
      ...(this.isEditMode && this.mediaClears.length
        ? { mediaClears: [...this.mediaClears] }
        : {})
    };

    const request = this.isEditMode
      ? this.exerciseService.updateExercise(this.exerciseId!, payload)
      : this.exerciseService.createExercise(payload);

    request.subscribe({
      next: () => {
        this.saving = false;
        this.showSuccess(this.isEditMode ? 'Exercise updated!' : 'Exercise created!');
        setTimeout(() => this.router.navigate(['/admin/digital-exercises']), 1200);
      },
      error: (err) => {
        this.saving = false;
        this.showError(err.error?.error || 'Failed to save exercise');
      }
    });
  }

  private normalizeQuestionsForApi(questions: BuilderQuestion[]): any[] {
    return questions.map((q) => {
      const row: any = {
        ...q,
        context: String(q.context || '').trim(),
        instruction: String(q.instruction ?? ''),
        example: String(q.workedExample ?? ''),
        secondaryCaption: q.type === 'video-pronunciation' ? String(q.secondaryCaption || '').trim() : q.secondaryCaption,
        secondaryCaptionAtSeconds: q.type === 'video-pronunciation'
          ? this.normalizeSecondaryCaptionDelaySeconds(q.secondaryCaptionAtSeconds)
          : q.secondaryCaptionAtSeconds
      };
      if (q.type === 'singular_plural' && Array.isArray(q.pairs)) {
        row.pairs = q.pairs
          .map((p: { singular?: string; plural?: string }) => ({
            singular: String(p.singular || '').trim(),
            plural: String(p.plural || '').trim()
          }))
          .filter((p: { singular: string; plural: string }) => p.singular && p.plural);
        row.type = 'singular_plural';
        row.worksheetKind = null;
      }
      if (q.type === 'matching' && Array.isArray(q.pairs)) {
        row.pairs = q.pairs.map((p: { left?: string; right?: string }) => ({
          left: String(p.left || '').trim(),
          right: String(p.right || '').trim()
        }));
      }
      if ((q.type as any) === 'word_bank_fill') {
        row.wordBank = (q.wordBank || []).map((w) => String(w || '').trim()).filter(Boolean);
        row.items = (q.items || [])
          .map((item) => {
            const prompt = String(item?.prompt || '').trim();
            const answer = String(item?.answer || '').trim();
            const rawAlts = Array.isArray((item as any)?.acceptedAnswers)
              ? (item as any).acceptedAnswers
              : [];
            const acceptedAnswers = rawAlts
              .map((a: unknown) => String(a || '').trim())
              .filter(Boolean);
            const out: { prompt: string; answer: string; acceptedAnswers?: string[] } = { prompt, answer };
            if (acceptedAnswers.length) out.acceptedAnswers = acceptedAnswers;
            return out;
          })
          .filter((item) => item.prompt && item.answer);
        row.reusableWords = q.reusableWords !== false;
      }
      if ((q.type as any) === 'rearrange') {
        const tokensRaw = String((q as any).rearrangeTokens || '');
        let tokens = tokensRaw
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);
        row.rearrangePrompt = String((q as any).rearrangePrompt || '').trim();
        row.rearrangeAnswer = String((q as any).rearrangeAnswer || '').trim();
        // Convenience: if teacher didn't provide tokens, try splitting prompt like "Lampe / an / die / ist"
        if ((!tokens || tokens.length === 0) && row.rearrangePrompt) {
          const maybe = String(row.rearrangePrompt)
            .split('/')
            .map((x) => x.trim())
            .filter((x) => x && x !== '/');
          if (maybe.length >= 2) tokens = maybe;
        }
        // Remove any bare "/" tokens if present
        tokens = (tokens || []).map((t: string) => String(t).trim()).filter((t: string) => t && t !== '/');
        row.rearrangeTokens = tokens;
      }
      if (q.type === 'mcq') {
        this.ensureMcqOptionImages(q);
        row.options = (q.options || []).map((o: string) => String(o || '').trim());
        row.optionImageUrls = (q.optionImageUrls || [])
          .slice(0, row.options.length)
          .map((u: string) => this.canonicalizeMediaField(u));
        while (row.optionImageUrls.length < row.options.length) row.optionImageUrls.push('');
        row.imageUrl = this.canonicalizeMediaField(q.imageUrl);
      }
      if ((q.type as any) === 'image_pin_match') {
        row.imageUrl = this.canonicalizeMediaField(q.imageUrl);
        row.pins = (Array.isArray(q.pins) ? q.pins : [])
          .map((p) => ({
            id: String(p?.id || '').trim(),
            x: Math.max(0, Math.min(100, Number(p?.x) || 0)),
            y: Math.max(0, Math.min(100, Number(p?.y) || 0))
          }))
          .filter((p) => p.id);
        row.labels = (Array.isArray(q.labels) ? q.labels : [])
          .map((l) => ({
            id: String(l?.id || '').trim(),
            text: String(l?.text || '').trim(),
            correctPinId: String(l?.correctPinId || '').trim()
          }))
          .filter((l) => l.id && l.text);
        row.settings = {
          randomizeLabels: q.settings?.randomizeLabels !== false,
          allowRetry: q.settings?.allowRetry !== false
        };
      }
      row.attachmentUrl = this.canonicalizeMediaField(row.attachmentUrl);
      if (q.type === 'video-pronunciation') {
        row.videoUrl = this.canonicalizeMediaField(q.videoUrl);
      }
      const attUrl = String(row.attachmentUrl || '').trim();
      if (attUrl && this.getAttachmentType(attUrl) === 'audio') {
        const cap = this.normalizeAttachmentAudioMaxPlays(row.attachmentAudioMaxPlaysPerAttempt);
        if (cap !== undefined) {
          row.attachmentAudioMaxPlaysPerAttempt = cap;
        } else {
          delete row.attachmentAudioMaxPlaysPerAttempt;
        }
      } else {
        delete row.attachmentAudioMaxPlaysPerAttempt;
      }

      // Include sub-questions if present
      if (q.subQuestions && q.subQuestions.length > 0) {
        row.subQuestions = q.subQuestions.map((sq: BuilderQuestion) => {
          const subRow: any = { ...sq };
          subRow.type = sq.type;
          subRow.points = sq.points || 1;
          subRow.context = String(sq.context || '').trim();
          subRow.instruction = String(sq.instruction ?? '');
          subRow.example = String(sq.workedExample ?? '');
          subRow.worksheetKind = sq.worksheetKind || null;
          subRow.attachmentUrl = this.canonicalizeMediaField(sq.attachmentUrl);
          subRow.answerExplanation = String(sq.answerExplanation || '');
          subRow.similarityThreshold = sq.similarityThreshold ?? 70;
          subRow.scoringMode = sq.scoringMode || 'full';
          subRow.aiGradingEnabled = sq.aiGradingEnabled ?? true;

          if (sq.type === 'mcq') {
            this.ensureMcqOptionImages(sq);
            subRow.question = String(sq.question || '');
            subRow.imageUrl = this.canonicalizeMediaField(sq.imageUrl);
            subRow.options = (sq.options || []).map((o: string) => String(o || '').trim());
            subRow.optionImageUrls = (sq.optionImageUrls || [])
              .slice(0, subRow.options.length)
              .map((u: string) => this.canonicalizeMediaField(u));
            while (subRow.optionImageUrls.length < subRow.options.length) subRow.optionImageUrls.push('');
            subRow.correctAnswerIndex = sq.correctAnswerIndex ?? 0;
            subRow.explanation = String(sq.explanation || '');
          } else if (sq.type === 'matching' && Array.isArray(sq.pairs)) {
            subRow.pairs = sq.pairs.map((p: { left?: string; right?: string }) => ({
              left: String(p.left || '').trim(),
              right: String(p.right || '').trim()
            }));
          } else if (sq.type === 'singular_plural' && Array.isArray(sq.pairs)) {
            subRow.pairs = sq.pairs.map((p: { singular?: string; plural?: string }) => ({
              singular: String(p.singular || '').trim(),
              plural: String(p.plural || '').trim()
            }));
          } else if (sq.type === 'fill-blank') {
            subRow.sentence = String(sq.sentence || '');
            subRow.answers = (sq.answers || []).map((a: string) => String(a || '').trim()).filter(Boolean);
            subRow.hint = String(sq.hint || '');
            subRow.caseSensitive = sq.caseSensitive || false;
          } else if ((sq.type as any) === 'word_bank_fill') {
            subRow.wordBank = (sq.wordBank || []).map((w: string) => String(w || '').trim()).filter(Boolean);
            subRow.items = (sq.items || [])
              .map((item: any) => ({
                prompt: String(item?.prompt || '').trim(),
                answer: String(item?.answer || '').trim(),
                acceptedAnswers: (item?.acceptedAnswers || []).map((a: string) => String(a || '').trim()).filter(Boolean)
              }))
              .filter((item: any) => item.prompt && item.answer);
            subRow.reusableWords = sq.reusableWords !== false;
          } else if (sq.type === 'pronunciation') {
            subRow.word = String(sq.word || '');
            subRow.phonetic = String(sq.phonetic || '');
            subRow.translation = String(sq.translation || '');
            subRow.audioUrl = String(sq.audioUrl || '');
            subRow.acceptedVariants = (sq.acceptedVariants || []).map((v: string) => String(v || '').trim()).filter(Boolean);
          } else if (sq.type === 'question-answer') {
            subRow.prompt = String(sq.prompt || '');
            subRow.sampleAnswers = (sq.sampleAnswers || []).map((a: string) => String(a || '').trim()).filter(Boolean);
            subRow.storyParagraph = String(sq.storyParagraph || '');
          } else if (sq.type === 'listening') {
            subRow.prompt = String(sq.prompt || '');
            subRow.mediaUrl = String(sq.mediaUrl || '');
            subRow.expectedTranscript = String(sq.expectedTranscript || '');
            subRow.attemptMode = sq.attemptMode || 'typing';
          } else if ((sq.type as any) === 'jumble-word') {
            subRow.scrambledText = String((sq as any).scrambledText || '');
            subRow.boldLetter = String((sq as any).boldLetter || '');
            subRow.expectedWord = String((sq as any).expectedWord || '');
            subRow.categoryTip = String((sq as any).categoryTip || '');
          } else if ((sq.type as any) === 'rearrange') {
            subRow.rearrangePrompt = String((sq as any).rearrangePrompt || '');
            subRow.rearrangeAnswer = String((sq as any).rearrangeAnswer || '');
            const tokensRaw = String((sq as any).rearrangeTokens || '');
            subRow.rearrangeTokens = tokensRaw.split('\n').map((x: string) => x.trim()).filter(Boolean);
          } else if ((sq.type as any) === 'image_pin_match') {
            subRow.imageUrl = this.canonicalizeMediaField(sq.imageUrl);
            subRow.labels = (sq.labels || []).map((l: any) => ({
              id: String(l?.id || ''),
              text: String(l?.text || ''),
              correctPinId: String(l?.correctPinId || '')
            })).filter((l: any) => l.id && l.text);
            subRow.pins = (sq.pins || []).map((p: any) => ({
              id: String(p?.id || ''),
              x: Math.max(0, Math.min(100, Number(p?.x) || 0)),
              y: Math.max(0, Math.min(100, Number(p?.y) || 0))
            })).filter((p: any) => p.id);
            subRow.settings = {
              randomizeLabels: sq.settings?.randomizeLabels !== false,
              allowRetry: sq.settings?.allowRetry !== false
            };
          } else if (sq.type === 'video-pronunciation') {
            subRow.videoUrl = this.canonicalizeMediaField(sq.videoUrl);
            subRow.caption = String(sq.caption || '');
            subRow.secondaryCaption = String(sq.secondaryCaption || '');
            subRow.secondaryCaptionAtSeconds = sq.secondaryCaptionAtSeconds || 5;
          }

          this.stripBuilderOnlyFields(subRow);
          return subRow;
        });
      }

      this.stripBuilderOnlyFields(row);
      return row;
    });
  }

  cancel(): void {
    this.router.navigate(['/admin/digital-exercises']);
  }

  /** For query params when opening AI / Audio wizards (1–200 only). */
  private courseDayQueryParams(): Record<string, string> {
    const t = this.courseDayStr.trim();
    if (!t) return {};
    const p = parseInt(t, 10);
    if (!Number.isFinite(p) || p < 1 || p > 200) return {};
    return { courseDay: String(p) };
  }

  /** Bound to course day number input (empty = any day). */
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

  /** DISABLED: PDF worksheet / AI exercise generator — re-enable app route generate-ai + builder HTML. */
  navigateToAiGenerator(): void {
    // this.router.navigate(['/admin/digital-exercises/generate-ai'], {
    //   queryParams: this.courseDayQueryParams()
    // });
  }

  navigateToListeningGenerator(): void {
    this.router.navigate(['/admin/digital-exercises/generate-listening-manual'], {
      queryParams: this.courseDayQueryParams()
    });
  }

  getTotalPoints(): number {
    return this.questions.reduce((s, q) => {
      let total = s + (q.points || 1);
      if (q.subQuestions && q.subQuestions.length > 0) {
        total += q.subQuestions.reduce((subTotal, sq) => subTotal + (sq.points || 1), 0);
      }
      return total;
    }, 0);
  }

  getTotalQuestionCount(): number {
    return this.questions.reduce((s, q) => {
      let total = 1;
      if (q.subQuestions && q.subQuestions.length > 0) {
        total += q.subQuestions.length;
      }
      return s + total;
    }, 0);
  }

  getLevelColor(level: string): string {
    return this.exerciseService.getLevelColor(level);
  }

  private newPinId(): string {
    return `pin${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
  }

  private newLabelId(): string {
    return `lbl${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
  }

  addImagePinMatchLabel(q: BuilderQuestion): void {
    if (!Array.isArray(q.labels)) q.labels = [];
    q.labels.push({ id: this.newLabelId(), text: '', correctPinId: '' });
  }

  removeImagePinMatchLabel(q: BuilderQuestion, index: number): void {
    if (!Array.isArray(q.labels)) return;
    q.labels.splice(index, 1);
  }

  addImagePinByClick(q: BuilderQuestion, event: MouseEvent): void {
    const host = event.currentTarget as HTMLElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    if (!Array.isArray(q.pins)) q.pins = [];
    q.pins.push({
      id: this.newPinId(),
      x: Math.max(0, Math.min(100, Number(x.toFixed(2)))),
      y: Math.max(0, Math.min(100, Number(y.toFixed(2))))
    });
  }

  removeImagePin(q: BuilderQuestion, pinIndex: number): void {
    if (!Array.isArray(q.pins)) return;
    const pin = q.pins[pinIndex];
    q.pins.splice(pinIndex, 1);
    if (pin?.id && Array.isArray(q.labels)) {
      q.labels = q.labels.map((l) => (l.correctPinId === pin.id ? { ...l, correctPinId: '' } : l));
    }
  }

  /** Add a pin row manually (used when there is no click-to-place editor, e.g. sub-questions). */
  addImagePinRow(q: BuilderQuestion): void {
    if (!Array.isArray(q.pins)) q.pins = [];
    q.pins.push({
      id: this.newPinId(),
      x: 50,
      y: 50
    });
  }

  startImagePinDrag(questionIndex: number, pinId: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.draggingPinQuestionIndex = questionIndex;
    this.draggingPinId = pinId;
  }

  onImagePinEditorMouseMove(q: BuilderQuestion, questionIndex: number, event: MouseEvent): void {
    if (this.draggingPinQuestionIndex !== questionIndex || !this.draggingPinId) return;
    const host = event.currentTarget as HTMLElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const pin = (q.pins || []).find((p) => p.id === this.draggingPinId);
    if (!pin) return;
    pin.x = Math.max(0, Math.min(100, Number(x.toFixed(2))));
    pin.y = Math.max(0, Math.min(100, Number(y.toFixed(2))));
  }

  @HostListener('window:mouseup')
  stopImagePinDrag(): void {
    this.draggingPinQuestionIndex = null;
    this.draggingPinId = null;
  }

  get validQuestionCount(): number {
    return this.questions.filter((q) => this.isQuestionValid(q)).length;
  }

  getInvalidSummaryTooltip(): string {
    const invalid = this.questions.length - this.validQuestionCount;
    if (invalid <= 0) return '';
    return `${invalid} question(s) need fixes. Open each row marked with ! for details.`;
  }

  // ── Bulk select helpers ──────────────────────────────────────────────────────

  toggleSelectQuestion(i: number, event: Event): void {
    event.stopPropagation();
    if (this.selectedIndices.has(i)) {
      this.selectedIndices.delete(i);
    } else {
      this.selectedIndices.add(i);
    }
    this.selectAllChecked = this.selectedIndices.size === this.questions.length && this.questions.length > 0;
  }

  toggleSelectAll(event: Event): void {
    event.stopPropagation();
    if (this.selectAllChecked) {
      this.selectedIndices.clear();
      this.selectAllChecked = false;
    } else {
      this.questions.forEach((_, i) => this.selectedIndices.add(i));
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

  get splitCourseDayAsNumber(): number | null {
    const t = this.splitCourseDayStr.trim();
    if (!t) return null;
    const p = parseInt(t, 10);
    return Number.isFinite(p) ? p : null;
  }

  onSplitCourseDayNumberInput(v: number | string | null): void {
    if (v === '' || v === null || v === undefined) {
      this.splitCourseDayStr = '';
      return;
    }
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (!Number.isFinite(n)) {
      this.splitCourseDayStr = '';
      return;
    }
    this.splitCourseDayStr = String(Math.min(200, Math.max(1, Math.round(n))));
  }

  isSplitFormValid(): boolean {
    return !!this.splitTitle.trim() && !!this.splitDescription.trim() && !!this.splitLevel && !!this.splitCategory;
  }

  openSplitToNewExerciseModal(): void {
    if (!this.isEditMode || !this.exerciseId) {
      this.showError('Save the exercise first, then split questions from the editor');
      return;
    }
    if (this.selectedIndices.size === 0) {
      this.showError('Select at least one question to move');
      return;
    }
    if (this.selectedIndices.size >= this.questions.length) {
      this.showError('Leave at least one question in this exercise');
      return;
    }

    const baseTitle = this.title.trim();
    this.splitTitle = baseTitle ? `${baseTitle} (split)` : 'New exercise';
    this.splitDescription = this.description;
    this.splitTargetLanguage = this.targetLanguage;
    this.splitNativeLanguage = this.nativeLanguage;
    this.splitLevel = this.level;
    this.splitCategory = this.category;
    this.splitDifficulty = this.difficulty;
    this.splitEstimatedDuration = this.estimatedDuration;
    this.splitTags = this.tags;
    this.splitCourseDayStr = this.courseDayStr;
    this.splitSequenceLetter = '';
    this.splitVisibleToStudents = false;
    this.splitModalOpen = true;
  }

  closeSplitModal(): void {
    if (this.splitSaving) return;
    this.splitModalOpen = false;
  }

  confirmSplitToNewExercise(): void {
    if (!this.isEditMode || !this.exerciseId) return;
    if (!this.isSplitFormValid()) {
      this.showError('Please fill in title, description, level, and category for the new exercise');
      return;
    }
    if (this.selectedIndices.size === 0 || this.selectedIndices.size >= this.questions.length) {
      this.showError('Select some questions, but not every question');
      return;
    }

    let courseDay: number | null = null;
    const dayTrim = this.splitCourseDayStr.trim();
    if (dayTrim) {
      const p = parseInt(dayTrim, 10);
      if (!Number.isFinite(p) || p < 1 || p > 200) {
        this.showError('Journey day must be empty or a number from 1 to 200');
        return;
      }
      courseDay = p;
    }

    const rawLetter = this.splitSequenceLetter.trim().toLowerCase();
    const sequenceLetter = /^[a-z]$/.test(rawLetter) ? rawLetter : null;

    const sorted = [...this.selectedIndices].sort((a, b) => a - b);
    const movedCount = sorted.length;
    const remainingQuestions = this.questions.filter((_, i) => !this.selectedIndices.has(i));

    this.splitSaving = true;
    this.exerciseService
      .splitQuestionsToNewExercise(this.exerciseId!, {
        questionIndices: sorted,
        title: this.splitTitle.trim(),
        description: this.splitDescription.trim(),
        targetLanguage: this.splitTargetLanguage,
        nativeLanguage: this.splitNativeLanguage,
        level: this.splitLevel,
        category: this.splitCategory,
        difficulty: this.splitDifficulty,
        estimatedDuration: this.splitEstimatedDuration,
        tags: this.splitTags.split(',').map((t) => t.trim()).filter(Boolean),
        courseDay,
        sequenceLetter,
        visibleToStudents: this.splitVisibleToStudents
      })
      .subscribe({
        next: (res) => {
          this.splitSaving = false;
          this.questions = remainingQuestions;
          this.clearSelection();
          this.splitModalOpen = false;
          if (this.expandedQuestion >= this.questions.length) {
            this.expandedQuestion = Math.max(0, this.questions.length - 1);
          }
          const newId = res.exercise?._id;
          this.showSuccess(
            newId
              ? `Created new exercise with ${movedCount} question(s). This exercise was updated.`
              : `Moved ${movedCount} question(s) to a new exercise.`
          );
        },
        error: (err) => {
          this.splitSaving = false;
          this.showError(err.error?.error || 'Failed to create exercise from selected questions');
        }
      });
  }

  isSelected(i: number): boolean {
    return this.selectedIndices.has(i);
  }

  private syncSelectedIndicesAfterMove(fromIndex: number, toIndex: number): void {
    const updated = new Set<number>();
    for (const idx of this.selectedIndices) {
      if (idx === fromIndex) {
        updated.add(toIndex);
      } else if (fromIndex < toIndex && idx > fromIndex && idx <= toIndex) {
        updated.add(idx - 1);
      } else if (fromIndex > toIndex && idx >= toIndex && idx < fromIndex) {
        updated.add(idx + 1);
      } else {
        updated.add(idx);
      }
    }
    this.selectedIndices = updated;
    this.selectAllChecked = this.selectedIndices.size === this.questions.length && this.questions.length > 0;
  }

  // ── Bulk field edit ──────────────────────────────────────────────────────────

  applyBulkField(): void {
    if (!this.bulkEditField || this.selectedIndices.size === 0) return;
    for (const idx of this.selectedIndices) {
      const q = this.questions[idx];
      if (!q) continue;
      if (this.bulkEditField === 'audio') {
        q.mediaUrl = this.bulkEditValue;
      } else if (this.bulkEditField === 'attachment') {
        q.attachmentUrl = this.bulkEditValue;
      } else if (this.bulkEditField === 'example') {
        q.workedExample = this.bulkEditValue;
      } else if (this.bulkEditField === 'context') {
        q.context = this.bulkEditValue;
      } else if (this.bulkEditField === 'instruction') {
        q.instruction = this.bulkEditValue;
      }
      // attachment-upload is applied via onBulkAttachmentFileSelected, not here
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

  triggerBulkAttachmentFile(): void {
    if (this.selectedIndices.size === 0) return;
    (this as any)._bulkAttachmentMode = true;
    this.attachmentFileInput?.nativeElement?.click();
  }

  onBulkAttachmentFileSelected(file: File): void {
    if (this.selectedIndices.size === 0) return;
    this.bulkAttachmentUploading = true;
    this.exerciseService.uploadQuestionAttachment(file).subscribe({
      next: (res) => {
        this.bulkAttachmentUploading = false;
        const canonicalUrl = this.canonicalizeMediaField(res.canonicalUrl || res.url);
        const attType = this.getAttachmentType(canonicalUrl);
        for (const idx of this.selectedIndices) {
          const q = this.questions[idx];
          if (!q) continue;
          q.attachmentUrl = canonicalUrl;
          if (attType !== 'audio') {
            q.attachmentAudioMaxPlaysPerAttempt = undefined;
          }
        }
        this.showSuccess(`Attachment applied to ${this.selectedIndices.size} question(s).`);
      },
      error: (err) => {
        this.bulkAttachmentUploading = false;
        this.showError(err.error?.error || 'Upload failed');
      }
    });
  }

  generateMissingAnswers(): void {
    const candidates: Array<{ index: number; q: BuilderQuestion }> = [];
    this.questions.forEach((q, i) => {
      if (q.type === 'fill-blank') {
        const blankRuns = countFillBlankRuns(q.sentence || '');
        if (blankRuns < 1) return;
        const raw = Array.isArray(q.answers) ? q.answers : [];
        const padded = [...raw];
        while (padded.length < blankRuns) padded.push('');
        const anyMissing = padded.slice(0, blankRuns).some((a) => !String(a ?? '').trim());
        if (anyMissing) candidates.push({ index: i, q });
      } else if (q.type === 'question-answer') {
        const hasSample = Array.isArray(q.sampleAnswers) && q.sampleAnswers.some((a) => String(a || '').trim());
        if (!hasSample) candidates.push({ index: i, q });
      } else if ((q.type as any) === 'jumble-word') {
        if (!String(q.expectedWord || '').trim()) candidates.push({ index: i, q });
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
        base.sentence = q.sentence || '';
        base.instruction = q.instruction || '';
        base.hint = q.hint || '';
        base.answers = q.answers || [];
      } else if (q.type === 'question-answer') {
        base.prompt = q.prompt || '';
        base.instruction = q.instruction || '';
        base.sampleAnswers = q.sampleAnswers || [];
      } else if ((q.type as any) === 'jumble-word') {
        base.prompt = q.scrambledText || '';
        base.hint = q.boldLetter || '';
      }
      return base;
    });

    this.exerciseService.generateMissingAnswers(payload).subscribe({
      next: (res) => {
        this.generatingAnswers = false;
        const touched = new Set<number>();
        (res.results || []).forEach((r: any) => {
          const idx = Number(r?.index);
          if (!Number.isFinite(idx) || idx < 0 || idx >= this.questions.length) return;
          const q = this.questions[idx];
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

  // ── Bulk type conversion ─────────────────────────────────────────────────────

  private questionPayloadForConvert(q: BuilderQuestion): any {
    const row: any = {
      ...q,
      context: String(q.context || '').trim(),
      instruction: String(q.instruction ?? ''),
      example: String(q.workedExample ?? '')
    };
    if ((q.type as any) === 'rearrange') {
      const tokensRaw = String(q.rearrangeTokens || '');
      row.rearrangeTokens = tokensRaw
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
    }
    return row;
  }

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
      const prev = this.questions[idx];
      this.exerciseService.convertQuestionType({
        question: this.questionPayloadForConvert(prev),
        targetType: this.bulkTargetType,
        targetLanguage: this.targetLanguage
      }).subscribe({
        next: (res) => {
          if (res?.question) {
            const mapped = this.mapQuestionFromApi(res.question);
            mapped.points = prev.points ?? mapped.points;
            if (prev.subQuestions?.length) {
              mapped.subQuestions = prev.subQuestions;
            }
            this.questions[idx] = mapped;
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

  private showSuccess(msg: string): void {
    this.snackBar.open(msg, '', { duration: 3000, panelClass: ['success-snack'] });
  }
  private showError(msg: string): void {
    this.snackBar.open(msg, 'Close', { duration: 4000, panelClass: ['error-snack'] });
  }
}
