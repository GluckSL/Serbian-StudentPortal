import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DigitalExerciseService } from '../../services/digital-exercise.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';
import { resolveMediaUrl } from '../../utils/media-url';

interface QuestionTypeDef {
  value: string;
  label: string;
  icon: string;
  description: string;
}

export interface FreeModeItem {
  uid: number;
  kind: 'content' | 'question';
  type?: string;
  worksheetKind?: string | null;
  sectionTitle?: string;
  context?: string;
  instruction?: string;
  example?: string;
  attachmentUrls?: string[];
  question?: string;
  imageUrl?: string;
  options?: string[];
  optionImageUrls?: string[];
  correctAnswerIndex?: number;
  explanation?: string;
  pairs?: Array<{ left?: string; right?: string; singular?: string; plural?: string }>;
  sentence?: string;
  answers?: string[];
  hint?: string;
  caseSensitive?: boolean;
  wordBank?: string[];
  items?: Array<{ prompt: string; answer?: string; acceptedAnswers?: string[] }>;
  reusableWords?: boolean;
  prompt?: string;
  sampleAnswers?: string[];
  storyParagraph?: string;
  similarityThreshold?: number;
  scoringMode?: string;
  aiGradingEnabled?: boolean;
  mediaUrl?: string;
  expectedTranscript?: string;
  attemptMode?: string;
  videoUrl?: string;
  caption?: string;
  secondaryCaption?: string;
  secondaryCaptionAtSeconds?: number;
  scrambledText?: string;
  boldLetter?: string;
  expectedWord?: string;
  categoryTip?: string;
  rearrangePrompt?: string;
  rearrangeAnswer?: string;
  rearrangeTokens?: string[];
  labels?: Array<{ id: string; text: string; correctPinId: string }>;
  pins?: Array<{ id: string; x: number; y: number }>;
  settings?: { randomizeLabels?: boolean; allowRetry?: boolean };
  answerExplanation?: string;
  points?: number;
  tier?: string | null;
}

let nextUid = 1;

@Component({
  selector: 'app-free-mode-exercise-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './free-mode-exercise-builder.component.html',
  styleUrls: ['./free-mode-exercise-builder.component.css']
})
export class FreeModeExerciseBuilderComponent implements OnInit {
  title = '';
  description = '';
  targetLanguage = 'German';
  nativeLanguage = 'English';
  level = 'A1';
  category = 'Grammar';
  difficulty = 'Beginner';
  estimatedDuration = 15;
  courseDay: number | null = null;
  tags = '';
  items: FreeModeItem[] = [];
  saving = false;
  editId: string | null = null;
  loadingExercise = false;
  attachmentUploading = false;
  currentAttachmentItem: FreeModeItem | null = null;

  @ViewChild('attachmentFileInput') attachmentFileInput!: ElementRef<HTMLInputElement>;
  levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  categories = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];
  difficulties = ['Beginner', 'Intermediate', 'Advanced'];
  languages = ['English', 'German'];
  nativeLanguages = ['English', 'Tamil', 'Sinhala'];

  questionTypes: QuestionTypeDef[] = [
    { value: 'mcq',                label: 'Multiple Choice',         icon: 'quiz',                 description: 'Options with one correct answer. Supports images.' },
    { value: 'matching',           label: 'Matching Exercise',       icon: 'compare_arrows',       description: 'Match left items with right items.' },
    { value: 'fill-blank',         label: 'Fill in the Blanks',      icon: 'text_fields',          description: 'Sentences with _ or ___ blanks to fill in.' },
    { value: 'word_bank_fill',     label: 'Word Bank Fill',          icon: 'format_list_bulleted', description: 'Shared word bank with multiple blank prompts.' },
    { value: 'question-answer',    label: 'Question / Answer',       icon: 'short_text',           description: 'Student reads the question and types a free-text answer.' },
    { value: 'listening',          label: 'Listening',               icon: 'headphones',           description: 'Student listens to audio and types the correct answer.' },
    { value: 'true-false',         label: 'Richtig / Falsch',        icon: 'toggle_on',            description: 'Entscheiden Sie, ob eine Aussage richtig oder falsch ist.' },
    { value: 'sentence-transformation', label: 'Sentence Transformation', icon: 'transform',       description: 'Transform a sentence (statement → question, etc.).' },
    { value: 'singular_plural',    label: 'Singular / Plural',       icon: 'swap_horiz',           description: 'Student sees the singular form and types the plural.' },
    { value: 'table-profile-fill', label: 'Table / Profile Fill-in', icon: 'table_rows',           description: 'Fill values in a table/profile.' },
    { value: 'free-writing-own-sentences', label: 'Free Writing / Own Sentences', icon: 'edit_note', description: 'Write your own sentences.' },
    { value: 'free-writing-profile', label: 'Free Writing – profile', icon: 'badge',               description: 'Write a short profile (Steckbrief).' },
    { value: 'error-correction',   label: 'Error Correction',        icon: 'error',                description: 'Correct mistakes and write the right sentence.' },
    { value: 'jumble-word',        label: 'Jumble Word',             icon: 'shuffle',              description: 'Scrambled letters → student forms the correct word.' },
    { value: 'rearrange',          label: 'Rearrange',               icon: 'reorder',              description: 'Student rearranges words into the correct order.' },
    { value: 'image_pin_match',    label: 'Image Pin Match',         icon: 'place',                description: 'Map labels to pins on an image.' },
    { value: 'video-pronunciation', label: 'Video Pronunciation',    icon: 'videocam',             description: 'Watch a video clip and speak the caption.' },
  ];

  constructor(
    private exerciseService: DigitalExerciseService,
    private router: Router,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editId = id;
      this.loadExercise(id);
    }
  }

  private loadExercise(id: string): void {
    this.loadingExercise = true;
    this.exerciseService.getExercise(id).subscribe({
      next: (ex) => {
        this.title = ex.title || '';
        this.description = ex.description || '';
        this.targetLanguage = ex.targetLanguage || 'German';
        this.nativeLanguage = ex.nativeLanguage || 'English';
        this.level = ex.level || 'A1';
        this.category = ex.category || 'Grammar';
        this.difficulty = ex.difficulty || 'Beginner';
        this.estimatedDuration = ex.estimatedDuration || 15;
        this.courseDay = ex.courseDay ?? null;
        this.tags = Array.isArray(ex.tags) ? ex.tags.join(', ') : '';
        this.items = this.questionsToItems(ex.questions || []);
        this.loadingExercise = false;
      },
      error: (err) => {
        this.loadingExercise = false;
        const msg = err?.error?.error || err?.error?.message || err?.message || 'Failed to load exercise';
        this.snackBar.open(msg, 'Close', { duration: 4000, panelClass: ['error-snack'] });
      }
    });
  }

  private questionsToItems(questions: any[]): FreeModeItem[] {
    const items: FreeModeItem[] = [];
    let lastContext = '';
    let lastInstruction = '';
    let lastSectionTitle = '';
    let lastAttachmentUrls: string[] = [];
    let lastExample = '';

    for (const q of questions) {
      const ctxChanged = q.context !== lastContext;
      const instChanged = q.instruction !== lastInstruction;
      const titleChanged = q.sectionTitle !== lastSectionTitle;
      const exChanged = q.example !== lastExample;
      const attChanged = JSON.stringify(q.attachmentUrls || []) !== JSON.stringify(lastAttachmentUrls);

      if (ctxChanged || instChanged || titleChanged || exChanged || attChanged) {
        items.push({
          uid: nextUid++,
          kind: 'content',
          sectionTitle: q.sectionTitle || '',
          context: q.context || '',
          instruction: q.instruction || '',
          example: q.example || '',
          attachmentUrls: q.attachmentUrls || [],
        });
        lastContext = q.context || '';
        lastInstruction = q.instruction || '';
        lastSectionTitle = q.sectionTitle || '';
        lastAttachmentUrls = q.attachmentUrls || [];
        lastExample = q.example || '';
      }

      const base: FreeModeItem = {
        uid: nextUid++,
        kind: 'question',
        type: q.type,
        points: q.points || 1,
        answerExplanation: q.answerExplanation || '',
        question: q.question || '',
        imageUrl: q.imageUrl || '',
        options: q.options || [],
        optionImageUrls: q.optionImageUrls || [],
        correctAnswerIndex: q.correctAnswerIndex,
        explanation: q.explanation || '',
        pairs: q.pairs || [],
        sentence: q.sentence || '',
        answers: q.answers || [],
        hint: q.hint || '',
        caseSensitive: q.caseSensitive || false,
        wordBank: q.wordBank || [],
        items: q.items || [],
        reusableWords: q.reusableWords !== undefined ? q.reusableWords : true,
        prompt: q.prompt || '',
        sampleAnswers: q.sampleAnswers || [],
        storyParagraph: q.storyParagraph || '',
        similarityThreshold: q.similarityThreshold || 70,
        scoringMode: q.scoringMode || 'full',
        aiGradingEnabled: q.aiGradingEnabled !== undefined ? q.aiGradingEnabled : true,
        mediaUrl: q.mediaUrl || '',
        expectedTranscript: q.expectedTranscript || '',
        attemptMode: q.attemptMode || 'typing',
        videoUrl: q.videoUrl || '',
        caption: q.caption || '',
        secondaryCaption: q.secondaryCaption || '',
        secondaryCaptionAtSeconds: q.secondaryCaptionAtSeconds || 5,
        scrambledText: q.scrambledText || '',
        boldLetter: q.boldLetter || '',
        expectedWord: q.expectedWord || '',
        categoryTip: q.categoryTip || '',
        rearrangePrompt: q.rearrangePrompt || '',
        rearrangeAnswer: q.rearrangeAnswer || '',
        rearrangeTokens: q.rearrangeTokens || [],
        labels: q.labels || [],
        pins: q.pins || [],
        settings: q.settings || { randomizeLabels: true, allowRetry: true },
        worksheetKind: q.worksheetKind || null,
        tier: q.tier || null,
      };
      items.push(base);
    }
    return items;
  }

  trackByIndex(index: number): number {
    return index;
  }

  addContentBlock(): void {
    this.items.push({
      uid: nextUid++,
      kind: 'content',
      sectionTitle: '',
      context: '',
      instruction: '',
      example: '',
      attachmentUrls: [],
    });
  }

  addQuestion(type: string): void {
    const base: FreeModeItem = {
      uid: nextUid++,
      kind: 'question',
      type,
      points: 1,
      answerExplanation: '',
    };
    if (['true-false', 'sentence-transformation', 'table-profile-fill', 'free-writing-own-sentences', 'free-writing-profile', 'error-correction'].includes(type)) {
      base.type = 'question-answer';
      base.worksheetKind = type;
      base.prompt = '';
      base.sampleAnswers = [];
    } else if (type === 'mcq') {
      base.question = '';
      base.options = ['', '', '', ''];
      base.correctAnswerIndex = 0;
      base.explanation = '';
    } else if (type === 'matching') {
      base.instruction = '';
      base.pairs = [{ left: '', right: '' }];
    } else if (type === 'fill-blank') {
      base.sentence = '';
      base.answers = [''];
      base.hint = '';
      base.caseSensitive = false;
    } else if (type === 'word_bank_fill') {
      base.wordBank = [''];
      base.items = [{ prompt: '', answer: '' }];
      base.reusableWords = true;
    } else if (type === 'question-answer') {
      base.prompt = '';
      base.sampleAnswers = [''];
      base.similarityThreshold = 70;
      base.scoringMode = 'full';
      base.aiGradingEnabled = true;
    } else if (type === 'listening') {
      base.mediaUrl = '';
      base.expectedTranscript = '';
      base.attemptMode = 'typing';
    } else if (type === 'singular_plural') {
      base.pairs = [{ singular: '', plural: '' }];
    } else if (type === 'jumble-word') {
      base.scrambledText = '';
      base.expectedWord = '';
      base.boldLetter = '';
      base.categoryTip = '';
    } else if (type === 'rearrange') {
      base.rearrangePrompt = '';
      base.rearrangeAnswer = '';
      base.rearrangeTokens = [''];
    } else if (type === 'image_pin_match') {
      base.imageUrl = '';
      base.labels = [{ id: this.uid(), text: '', correctPinId: '' }];
      base.pins = [{ id: this.uid(), x: 50, y: 50 }];
      base.settings = { randomizeLabels: true, allowRetry: true };
    } else if (type === 'video-pronunciation') {
      base.videoUrl = '';
      base.caption = '';
      base.secondaryCaption = '';
      base.secondaryCaptionAtSeconds = 5;
    }
    this.items.push(base);
  }

  private uid(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  deleteItem(uid: number): void {
    this.items = this.items.filter(i => i.uid !== uid);
  }

  moveItem(uid: number, direction: -1 | 1): void {
    const idx = this.items.findIndex(i => i.uid === uid);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= this.items.length) return;
    [this.items[idx], this.items[newIdx]] = [this.items[newIdx], this.items[idx]];
    this.items = [...this.items];
  }

  addPair(item: FreeModeItem): void {
    item.pairs = item.pairs || [];
    if (item.type === 'singular_plural') {
      item.pairs.push({ singular: '', plural: '' });
    } else {
      item.pairs.push({ left: '', right: '' });
    }
  }

  removePair(item: FreeModeItem, idx: number): void {
    item.pairs = item.pairs || [];
    item.pairs.splice(idx, 1);
  }

  addAnswer(item: FreeModeItem): void {
    item.answers = item.answers || [];
    item.answers.push('');
  }

  removeAnswer(item: FreeModeItem, idx: number): void {
    item.answers = item.answers || [];
    item.answers.splice(idx, 1);
  }

  addOption(item: FreeModeItem): void {
    item.options = item.options || [];
    item.options.push('');
  }

  removeOption(item: FreeModeItem, idx: number): void {
    item.options = item.options || [];
    item.options.splice(idx, 1);
  }

  addWordBankItem(item: FreeModeItem): void {
    item.items = item.items || [];
    item.items.push({ prompt: '', answer: '' });
  }

  removeWordBankItem(item: FreeModeItem, idx: number): void {
    item.items = item.items || [];
    item.items.splice(idx, 1);
  }

  addWordBankWord(item: FreeModeItem): void {
    item.wordBank = item.wordBank || [];
    item.wordBank.push('');
  }

  addSampleAnswer(item: FreeModeItem): void {
    item.sampleAnswers = item.sampleAnswers || [];
    item.sampleAnswers.push('');
  }

  removeSampleAnswer(item: FreeModeItem, idx: number): void {
    item.sampleAnswers = item.sampleAnswers || [];
    item.sampleAnswers.splice(idx, 1);
  }

  addToken(item: FreeModeItem): void {
    item.rearrangeTokens = item.rearrangeTokens || [];
    item.rearrangeTokens.push('');
  }

  addLabel(item: FreeModeItem): void {
    item.labels = item.labels || [];
    const id = this.uid();
    item.labels.push({ id, text: '', correctPinId: '' });
  }

  removeLabel(item: FreeModeItem, idx: number): void {
    item.labels = item.labels || [];
    item.labels.splice(idx, 1);
  }

  addPin(item: FreeModeItem): void {
    item.pins = item.pins || [];
    const id = this.uid();
    item.pins.push({ id, x: 50, y: 50 });
  }

  removePin(item: FreeModeItem, idx: number): void {
    item.pins = item.pins || [];
    item.pins.splice(idx, 1);
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

  getMediaFullUrl(relative: string): string {
    if (!relative) return '';
    return resolveMediaUrl(relative);
  }

  triggerAttachmentFile(item: FreeModeItem): void {
    this.currentAttachmentItem = item;
    this.attachmentFileInput?.nativeElement?.click();
  }

  onAttachmentFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (!files.length) return;
    const item = this.currentAttachmentItem;
    this.currentAttachmentItem = null;
    if (!item) return;
    this.uploadAttachmentFiles(item, files);
  }

  private uploadAttachmentFiles(item: FreeModeItem, files: File[]): void {
    if (!files.length) return;
    this.attachmentUploading = true;
    let uploaded = 0;
    let hadError = false;
    const finish = () => {
      this.attachmentUploading = false;
      if (uploaded > 0) {
        this.snackBar.open(uploaded === 1 ? 'File uploaded' : `${uploaded} files uploaded`, 'Close', { duration: 3000 });
      }
    };
    const uploadNext = (index: number) => {
      if (index >= files.length) {
        finish();
        return;
      }
      this.exerciseService.uploadQuestionAttachment(files[index]).subscribe({
        next: (res) => {
          const url = res.canonicalUrl || res.url;
          if (url) {
            item.attachmentUrls = item.attachmentUrls || [];
            if (!item.attachmentUrls.includes(url)) {
              item.attachmentUrls.push(url);
            }
          }
          uploaded += 1;
          uploadNext(index + 1);
        },
        error: (err) => {
          hadError = true;
          this.snackBar.open(err.error?.error || 'Upload failed', 'Close', { duration: 4000, panelClass: ['error-snack'] });
          if (uploaded > 0) finish();
          else this.attachmentUploading = false;
        }
      });
    };
    uploadNext(0);
  }

  removeAttachmentAt(item: FreeModeItem, index: number): void {
    if (!item.attachmentUrls || index < 0 || index >= item.attachmentUrls.length) return;
    item.attachmentUrls.splice(index, 1);
  }

  getTypeLabel(type: string): string {
    const found = this.questionTypes.find(qt => qt.value === type);
    return found ? found.label : type;
  }

  getTypeIcon(type: string): string {
    const found = this.questionTypes.find(qt => qt.value === type);
    return found ? found.icon : 'help';
  }

  hasContentItems(): boolean {
    return this.items.some(i => i.kind === 'content');
  }

  hasQuestionItems(): boolean {
    return this.items.some(i => i.kind === 'question');
  }

  isValid(): boolean {
    return !!this.title.trim() && !!this.description.trim() && this.items.some(i => i.kind === 'question');
  }

  save(): void {
    if (this.saving || !this.isValid()) return;
    this.saving = true;
    const payload = {
      title: this.title.trim(),
      description: this.description.trim(),
      targetLanguage: this.targetLanguage,
      nativeLanguage: this.nativeLanguage,
      level: this.level,
      category: this.category,
      difficulty: this.difficulty,
      estimatedDuration: this.estimatedDuration,
      courseDay: this.courseDay,
      tags: this.tags ? this.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      items: this.items.map(item => {
        const clone: any = { ...item };
        delete clone.uid;
        return clone;
      }),
    };

    const request = this.editId
      ? this.exerciseService.updateFreeModeExercise(this.editId, payload)
      : this.exerciseService.createFreeModeExercise(payload);

    request.subscribe({
      next: () => {
        this.saving = false;
        this.snackBar.open('Exercise saved successfully', 'Close', { duration: 3000, panelClass: ['success-snack'] });
        if (!this.editId) {
          this.resetForm();
        } else {
          this.router.navigate(['/admin/digital-exercises']);
        }
      },
      error: (err) => {
        this.saving = false;
        const msg = err?.error?.error || err?.error?.message || err?.message || 'Failed to save exercise';
        this.snackBar.open(msg, 'Close', { duration: 4000, panelClass: ['error-snack'] });
      }
    });
  }

  private resetForm(): void {
    this.title = '';
    this.description = '';
    this.items = [];
    this.courseDay = null;
    this.tags = '';
  }

  goBack(): void {
    this.router.navigate(['/admin/digital-exercises']);
  }
}
