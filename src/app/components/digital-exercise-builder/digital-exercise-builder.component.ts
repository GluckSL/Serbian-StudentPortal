// src/app/components/digital-exercise-builder/digital-exercise-builder.component.ts

import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { DigitalExerciseService, DigitalExercise } from '../../services/digital-exercise.service';
import { environment } from '../../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';

interface BuilderQuestion {
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
  audioUrl?: string;
  acceptedVariants?: string[];
  // Question / Answer
  prompt?: string;
  sampleAnswers?: string[];
  similarityThreshold?: number;   // 0-100, default 70
  scoringMode?: 'full' | 'proportional';
  // Listening
  mediaUrl?: string;
  expectedTranscript?: string;
  attemptMode?: 'typing' | 'typing-or-speech';
  transcribing?: boolean;
  // Common
  points: number;
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
  visibleToStudents = false;

  questions: BuilderQuestion[] = [];

  activeTab: 'info' | 'questions' | 'preview' = 'info';
  expandedQuestion = -1;

  @ViewChild('listeningFileInput') listeningFileInput!: ElementRef<HTMLInputElement>;
  currentListeningQ: BuilderQuestion | null = null;

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
    { value: 'listening',       label: 'Listening',          icon: 'headphones',         description: 'Student listens to audio and types or speaks what they hear.' }
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
        this.visibleToStudents = exercise.visibleToStudents || false;
        this.questions = (exercise.questions || []).map(q => this.mapQuestionFromApi(q));
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
        similarityThreshold: q.similarityThreshold ?? 70,
        scoringMode: q.scoringMode || 'full'
      });
    } else if (q.type === 'listening') {
      Object.assign(base, {
        prompt: q.prompt || 'Listen and type what you hear.',
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
    return this.questions[this.questions.length - 1].type;
  }

  /** Add one more question of the same type as the last one. */
  addOneMoreQuestion(): void {
    this.addQuestion(this.lastQuestionType);
  }

  addQuestion(type: string): void {
    const q: BuilderQuestion = {
      type: type as any,
      points: 1
    };
    if (type === 'mcq') {
      q.question = '';
      q.imageUrl = '';
      q.options = ['', '', '', ''];
      q.correctAnswerIndex = 0;
      q.explanation = '';
    } else if (type === 'matching') {
      q.instruction = 'Match the items on the left with their correct pairs on the right.';
      q.pairs = [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }];
    } else if (type === 'fill-blank') {
      q.sentence = '';
      q.answers = [''];
      q.hint = '';
      q.caseSensitive = false;
    } else if (type === 'pronunciation') {
      q.word = '';
      q.phonetic = '';
      q.translation = '';
      q.acceptedVariants = [];
    } else if (type === 'question-answer') {
      q.prompt = '';
      q.sampleAnswers = [''];
      q.similarityThreshold = 70;
      q.scoringMode = 'full';
    } else if (type === 'listening') {
      q.prompt = 'Listen and type what you hear.';
      q.mediaUrl = '';
      q.expectedTranscript = '';
      q.attemptMode = 'typing-or-speech';
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

  generateTranscript(q: BuilderQuestion): void {
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

  getBlankCount(q: BuilderQuestion): number {
    return (q.sentence?.match(/___/g) || []).length;
  }

  getTypeLabel(type: string): string {
    return this.exerciseService.getQuestionTypeLabel(type as any);
  }

  getTypeIcon(type: string): string {
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
    return false;
  }

  save(): void {
    if (!this.isInfoValid()) { this.showError('Please fill in all required exercise info'); this.activeTab = 'info'; return; }
    if (!this.isQuestionsValid()) { this.showError('Please complete all questions'); this.activeTab = 'questions'; return; }

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
      visibleToStudents: this.visibleToStudents,
      questions: this.questions as any
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

  navigateToAiGenerator(): void {
    this.router.navigate(['/admin/digital-exercises/generate-ai']);
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
