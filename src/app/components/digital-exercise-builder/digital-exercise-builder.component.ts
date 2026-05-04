// src/app/components/digital-exercise-builder/digital-exercise-builder.component.ts

import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { DigitalExerciseService, DigitalExercise, VideoExerciseFeedbackItem } from '../../services/digital-exercise.service';
import { resolveMediaUrl } from '../../utils/media-url';
import { countFillBlankRuns } from '../../utils/fill-blank';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';
import { RichTextInputComponent } from '../../shared/rich-text-input/rich-text-input.component';

interface BuilderQuestion {
  type: 'mcq' | 'matching' | 'fill-blank' | 'pronunciation' | 'question-answer' | 'listening' | 'video-pronunciation' | 'singular_plural';
  worksheetKind?: string | null;
  context?: string;
  // MCQ
  question?: string;
  imageUrl?: string;
  options?: string[];
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
  // Per-question attachment (any file type)
  attachmentUrl?: string;
  attachmentUploading?: boolean;
  // Teacher explanation shown to students in review
  answerExplanation?: string;
  generatingExplanation?: boolean;
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

  @ViewChild('listeningFileInput') listeningFileInput!: ElementRef<HTMLInputElement>;
  currentListeningQ: BuilderQuestion | null = null;

  @ViewChild('videoFileInput') videoFileInput!: ElementRef<HTMLInputElement>;
  currentVideoQ: BuilderQuestion | null = null;

  @ViewChild('attachmentFileInput') attachmentFileInput!: ElementRef<HTMLInputElement>;
  currentAttachmentQ: BuilderQuestion | null = null;

  readonly maxVideoFeedbackClips = 4;
  videoSuccessFeedbackRows: VideoFeedbackAudioRow[] = [];
  videoRetryFeedbackRows: VideoFeedbackAudioRow[] = [];
  @ViewChild('videoFeedbackFileInput') videoFeedbackFileInput!: ElementRef<HTMLInputElement>;
  private videoFeedbackUploadTarget: { kind: 'success' | 'retry'; index: number } | null = null;

  levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  categories = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];
  difficulties: Array<'Beginner' | 'Intermediate' | 'Advanced'> = ['Beginner', 'Intermediate', 'Advanced'];
  languages = ['English', 'German'];
  nativeLanguages = ['English', 'Tamil', 'Sinhala'];

  questionTypes: Array<{ value: string; label: string; icon: string; description: string }> = [
    { value: 'mcq',             label: 'Multiple Choice',   icon: 'quiz',              description: 'Options with one correct answer. Supports images.' },
    { value: 'matching',        label: 'Matching Exercise',  icon: 'compare_arrows',    description: 'Match left items with right items.' },
    { value: 'fill-blank',      label: 'Fill in the Blanks', icon: 'text_fields',       description: 'Sentences with _ or ___ blanks to fill in.' },
    { value: 'pronunciation',   label: 'Pronunciation Check',icon: 'record_voice_over', description: 'Student speaks a word/phrase; system checks pronunciation.' },
    { value: 'question-answer', label: 'Question / Answer',  icon: 'short_text',        description: 'Student reads the question and types a free-text answer.' },
    { value: 'listening',       label: 'Listening',          icon: 'headphones',         description: 'Student listens to audio and types the correct answer.' },
    { value: 'true-false', label: 'Richtig / Falsch', icon: 'toggle_on', description: 'Entscheiden Sie, ob eine Aussage richtig oder falsch ist.' },
    { value: 'sentence-transformation', label: 'Sentence Transformation', icon: 'transform', description: 'Transform a sentence (statement → question, etc.).' },
    { value: 'singular_plural', label: 'Singular / Plural', icon: 'swap_horiz', description: 'Student sees the singular form and types the plural.' },
    { value: 'table-profile-fill', label: 'Table / Profile Fill-in', icon: 'table_rows', description: 'Fill values in a table/profile.' },
    { value: 'free-writing-own-sentences', label: 'Free Writing / Own Sentences', icon: 'edit_note', description: 'Write your own sentences.' },
    { value: 'free-writing-profile', label: 'Free Writing – profile', icon: 'badge', description: 'Write a short profile (Steckbrief).' },
    { value: 'error-correction', label: 'Error Correction', icon: 'error', description: 'Correct mistakes and write the right sentence.' }
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
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.showError('Failed to load exercise');
      }
    });
  }

  private mapQuestionFromApi(q: any): BuilderQuestion {
    const base: BuilderQuestion = {
      type: q.type,
      points: q.points || 1,
      context: q.context || '',
      // Persisted on every question type; shown in player banner (non-matching) and editor.
      instruction: q.instruction || '',
      workedExample: q.example || '',
      attachmentUrl: q.attachmentUrl || '',
      answerExplanation: q.answerExplanation || '',
      worksheetKind: q.worksheetKind || null,
      similarityThreshold: (typeof q.similarityThreshold === 'number')
        ? this.clampThreshold(q.similarityThreshold)
        : this.defaultThresholdForQuestion(q.type),
      scoringMode: q.scoringMode === 'proportional' ? 'proportional' : 'full',
      aiGradingEnabled: q.aiGradingEnabled !== false
    };
    if (q.type === 'mcq') {
      Object.assign(base, {
        question: q.question || '',
        imageUrl: q.imageUrl || '',
        options: [...(q.options || ['', '', '', ''])],
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
        videoUrl: q.videoUrl || '',
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
        attemptMode: q.attemptMode || 'typing'
      });
    }
    return base;
  }

  /** Last question type for "Add one more" button. */
  get lastQuestionType(): string {
    if (this.questions.length === 0) return 'mcq';
    const last = this.questions[this.questions.length - 1];
    if (last.type === 'question-answer' && last.worksheetKind) return last.worksheetKind;
    return last.type;
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
    } else if (qType === 'pronunciation') {
      q.word = '';
      q.phonetic = '';
      q.translation = '';
      q.acceptedVariants = [];
    } else if (qType === 'question-answer') {
      q.prompt = '';
      q.sampleAnswers = [''];
      q.storyParagraph = '';
      // Default grading style:
      // - transformations / true-false / error correction: mostly exact
      // - free writing: proportional
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
    }
    this.questions.push(q);
    this.expandedQuestion = this.questions.length - 1;
    this.activeTab = 'questions';
  }

  removeQuestion(index: number): void {
    this.questions.splice(index, 1);
    if (this.expandedQuestion >= this.questions.length) {
      this.expandedQuestion = this.questions.length - 1;
    }
  }

  moveQuestion(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= this.questions.length) return;
    [this.questions[index], this.questions[target]] = [this.questions[target], this.questions[index]];
    this.expandedQuestion = target;
  }

  toggleExpanded(index: number): void {
    this.expandedQuestion = this.expandedQuestion === index ? -1 : index;
  }

  // MCQ helpers
  addOption(q: BuilderQuestion): void { q.options!.push(''); }
  removeOption(q: BuilderQuestion, i: number): void {
    q.options!.splice(i, 1);
    if (q.correctAnswerIndex! >= q.options!.length) q.correctAnswerIndex = 0;
  }

  // Matching helpers
  addPair(q: BuilderQuestion): void {
    if (q.type === 'singular_plural') q.pairs!.push({ singular: '', plural: '' });
    else q.pairs!.push({ left: '', right: '' });
  }
  removePair(q: BuilderQuestion, i: number): void { q.pairs!.splice(i, 1); }

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
    const q = this.currentAttachmentQ;
    this.currentAttachmentQ = null;
    input.value = '';
    if (!file || !q) return;
    q.attachmentUploading = true;
    this.exerciseService.uploadQuestionAttachment(file).subscribe({
      next: (res) => {
        q.attachmentUrl = res.url;
        q.attachmentUploading = false;
        this.showSuccess('File uploaded');
      },
      error: (err) => {
        q.attachmentUploading = false;
        this.showError(err.error?.error || 'Upload failed');
      }
    });
  }

  removeAttachment(q: BuilderQuestion): void {
    q.attachmentUrl = '';
  }

  getAttachmentType(url: string): 'image' | 'audio' | 'video' | 'pdf' | 'other' {
    if (!url) return 'other';
    const lower = url.toLowerCase().split('?')[0];
    if (/\.(jpe?g|png|gif|webp|svg)$/.test(lower)) return 'image';
    if (/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/.test(lower)) return 'audio';
    if (/\.(mp4|mov|avi|mkv)$/.test(lower)) return 'video';
    if (/\.pdf$/.test(lower)) return 'pdf';
    return 'other';
  }

  // ─── AI explanation helpers ────────────────────────────────────────────────

  useAiExplanation(q: BuilderQuestion): void {
    const questionText =
      q.question || q.prompt || q.word || q.sentence || q.instruction || '';
    const storyParagraph = q.storyParagraph || '';
    const contextText = q.context || '';
    const correctAnswer = this.getCorrectAnswerText(q);
    const sampleAnswers = (q.sampleAnswers || []).map((x) => String(x || '').trim()).filter(Boolean);
    if (!questionText && !storyParagraph && !contextText && !correctAnswer && sampleAnswers.length === 0) {
      this.showError('Please fill in the question details first');
      return;
    }
    q.generatingExplanation = true;
    this.exerciseService.generateExplanation({
      questionType: q.worksheetKind || q.type,
      questionText,
      storyParagraph,
      contextText,
      correctAnswer,
      sampleAnswers,
      targetLanguage: this.targetLanguage
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
  }

  private getCorrectAnswerText(q: BuilderQuestion): string {
    if (q.type === 'mcq' && q.options && q.correctAnswerIndex !== undefined) {
      return q.options[q.correctAnswerIndex] || '';
    }
    if (q.type === 'fill-blank' && q.answers?.length) {
      return q.answers.join(', ');
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
    const q = this.currentListeningQ;
    this.currentListeningQ = null;
    input.value = '';
    if (!file || !q) return;
    this.exerciseService.uploadListeningMedia(file).subscribe({
      next: (res) => {
        q.mediaUrl = res.url;
        this.showSuccess('Audio uploaded');
      },
      error: (err) => this.showError(err.error?.error || 'Upload failed')
    });
  }

  fetchListeningFromUrl(q: BuilderQuestion, url: string): void {
    if (!url?.trim()) { this.showError('Enter a valid URL'); return; }
    this.exerciseService.fetchListeningFromUrl(url.trim()).subscribe({
      next: (res) => {
        q.mediaUrl = res.url;
        this.showSuccess('Audio fetched');
      },
      error: (err) => this.showError(err.error?.error || 'Fetch failed')
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
    this.videoSuccessFeedbackRows.splice(i, 1);
  }

  addVideoRetryFeedbackRow(): void {
    if (this.videoRetryFeedbackRows.length >= this.maxVideoFeedbackClips) return;
    this.videoRetryFeedbackRows.push({ audioUrl: '', caption: '', uploading: false });
  }

  removeVideoRetryFeedbackRow(i: number): void {
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
    return resolveMediaUrl(relative);
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
    return this.questions.every(q => this.isQuestionValid(q));
  }

  isQuestionValid(q: BuilderQuestion): boolean {
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
    if (q.type === 'video-pronunciation') return !!(q.videoUrl?.trim()) && !!(q.caption?.trim());
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
    const normalizedQuestions = this.questions.map((q) => {
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
      return row;
    });

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
      videoRetryFeedback: this.mapVideoFeedbackToApi(this.videoRetryFeedbackRows)
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
    return this.questions.reduce((s, q) => s + (q.points || 1), 0);
  }

  getLevelColor(level: string): string {
    return this.exerciseService.getLevelColor(level);
  }

  private showSuccess(msg: string): void {
    this.snackBar.open(msg, '', { duration: 3000, panelClass: ['success-snack'] });
  }
  private showError(msg: string): void {
    this.snackBar.open(msg, 'Close', { duration: 4000, panelClass: ['error-snack'] });
  }
}
