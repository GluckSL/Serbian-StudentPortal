// src/app/components/digital-exercise-builder/digital-exercise-builder.component.ts

import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { DigitalExerciseService, DigitalExercise, VideoExerciseFeedbackItem } from '../../services/digital-exercise.service';
import { resolveMediaUrl } from '../../utils/media-url';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';

interface BuilderQuestion {
  type: 'mcq' | 'matching' | 'fill-blank' | 'pronunciation' | 'question-answer' | 'listening' | 'video-pronunciation';
  worksheetKind?: string | null;
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
  audioUrl?: string;
  acceptedVariants?: string[];
  // Question / Answer
  prompt?: string;
  sampleAnswers?: string[];
  // Story paragraph for worksheet-style questions (e.g. true-false reading passage).
  storyParagraph?: string;
  similarityThreshold?: number;   // 0-100, default 70
  scoringMode?: 'full' | 'proportional';
  // Listening
  mediaUrl?: string;
  expectedTranscript?: string; // stored as the correct answer text for listening
  attemptMode?: 'typing' | 'typing-or-speech';
  transcribing?: boolean;
  // Video Pronunciation
  videoUrl?: string;
  caption?: string;
  videoUploading?: boolean;
  // Common
  points: number;
}

interface VideoFeedbackAudioRow {
  audioUrl: string;
  caption: string;
  uploading: boolean;
}

@Component({
  selector: 'app-digital-exercise-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
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
  visibleToStudents = false;

  questions: BuilderQuestion[] = [];

  activeTab: 'info' | 'questions' | 'video' | 'preview' = 'info';
  expandedQuestion = -1;

  @ViewChild('listeningFileInput') listeningFileInput!: ElementRef<HTMLInputElement>;
  currentListeningQ: BuilderQuestion | null = null;

  @ViewChild('videoFileInput') videoFileInput!: ElementRef<HTMLInputElement>;
  currentVideoQ: BuilderQuestion | null = null;

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
    { value: 'fill-blank',      label: 'Fill in the Blanks', icon: 'text_fields',       description: 'Sentences with ___ blanks to fill in.' },
    { value: 'pronunciation',   label: 'Pronunciation Check',icon: 'record_voice_over', description: 'Student speaks a word/phrase; system checks pronunciation.' },
    { value: 'question-answer', label: 'Question / Answer',  icon: 'short_text',        description: 'Student reads the question and types a free-text answer.' },
    { value: 'listening',       label: 'Listening',          icon: 'headphones',         description: 'Student listens to audio and types the correct answer.' },
    { value: 'true-false', label: 'Richtig / Falsch', icon: 'toggle_on', description: 'Entscheiden Sie, ob eine Aussage richtig oder falsch ist.' },
    { value: 'sentence-transformation', label: 'Sentence Transformation', icon: 'transform', description: 'Transform a sentence (statement → question, etc.).' },
    { value: 'singular-plural', label: 'Singular → Plural', icon: 'swap_horiz', description: 'Write the plural form.' },
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
    const base: BuilderQuestion = { type: q.type, points: q.points || 1 };
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
        storyParagraph: q.storyParagraph || '',
        similarityThreshold: q.similarityThreshold ?? 70,
        scoringMode: q.scoringMode || 'full',
        worksheetKind: q.worksheetKind || null
      });
    } else if (q.type === 'video-pronunciation') {
      Object.assign(base, {
        videoUrl: q.videoUrl || '',
        caption: q.caption || '',
        acceptedVariants: [...(q.acceptedVariants || [])]
      });
    } else if (q.type === 'listening') {
      Object.assign(base, {
        prompt: q.prompt || '',
        mediaUrl: q.mediaUrl || '',
        expectedTranscript: q.expectedTranscript || '',
        attemptMode: 'typing'
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
      'singular-plural',
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
      worksheetKind: isWorksheetKind ? type : null
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
  addPair(q: BuilderQuestion): void { q.pairs!.push({ left: '', right: '' }); }
  removePair(q: BuilderQuestion, i: number): void { q.pairs!.splice(i, 1); }

  // Fill-blank helpers
  onSentenceChange(q: BuilderQuestion): void {
    const count = (q.sentence!.match(/___/g) || []).length;
    while ((q.answers!.length) < count) q.answers!.push('');
    while ((q.answers!.length) > count) q.answers!.pop();
  }

  /** Insert ___ at cursor (if sentence field was focused) or at end. Click button with sentence focused to insert at cursor. */
  insertBlank(q: BuilderQuestion): void {
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
    if (v < 0) v = 0;
    if (v > 100) v = 100;
    q.similarityThreshold = v;
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
      videoUrl: '',
      caption: '',
      acceptedVariants: [],
      points: 1
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
    return (q.sentence?.match(/___/g) || []).length;
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
    if (q.type === 'matching') return (q.pairs?.filter(p => p.left.trim() && p.right.trim()).length ?? 0) >= 2;
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
      visibleToStudents: this.visibleToStudents,
      questions: this.questions as any,
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

  navigateToAiGenerator(): void {
    this.router.navigate(['/admin/digital-exercises/generate-ai'], {
      queryParams: this.courseDayQueryParams()
    });
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
