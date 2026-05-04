import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DigitalExerciseService } from '../../services/digital-exercise.service';

interface MatchingPair { left: string; right: string; }
interface FillQuestion { sentence: string; answer: string; }
interface McqOption { text: string; }
interface McqQuestion { question: string; options: McqOption[]; correctAnswer: string; }
interface ShortAnswerQuestion { question: string; }
interface ErrorCorrectionQuestion { sentence: string; corrected: string; }
interface SingularPluralRow { singular: string; plural: string; }

export interface AiExercise {
  id: string;
  instruction: string;
  type: string;
  pairs?: MatchingPair[];
  questions?: any[];
  questionCount?: number;
}

@Component({
  selector: 'app-worksheet-ai-builder',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './worksheet-ai-builder.component.html',
  styleUrls: ['./worksheet-ai-builder.component.scss']
})
export class WorksheetAiBuilderComponent implements OnInit {

  // ─── State ───────────────────────────────────────────────────────────────
  selectedFile: File | null = null;
  answerKeyText = '';
  loading = false;
  errorMessage = '';
  successMessage = '';

  exercises: AiExercise[] = [];
  originalExercises: AiExercise[] = [];
  selectedExercise: AiExercise | null = null;
  validationErrors: Record<string, boolean> = {};

  readonly EXERCISE_TYPES = [
    'matching', 'fill_in_blank', 'mcq', 'short_answer',
    'error_correction', 'singular_plural', 'open_writing', 'unknown'
  ];

  constructor(private exerciseService: DigitalExerciseService) {}

  ngOnInit(): void {}

  // ─── Step 1: File selection ───────────────────────────────────────────────
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
      this.errorMessage = '';
    }
  }

  // ─── Step 2: Run pipeline ─────────────────────────────────────────────────
  async runAiPipeline(): Promise<void> {
    if (!this.selectedFile) {
      this.errorMessage = 'Please select a PDF file first.';
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.exercises = [];
    this.selectedExercise = null;

    try {
      const phase1: any = await this.exerciseService.runAiStagePhase1(this.selectedFile).toPromise();
      if (!phase1?.blocks?.length) {
        this.errorMessage = 'Phase 1 returned no exercise blocks. Check your PDF.';
        this.loading = false;
        return;
      }

      // Use auto-detected answer key from PDF if admin hasn't pasted one manually
      const resolvedAnswerKey = this.answerKeyText.trim() || phase1.answerKeyText || '';

      const phase2: any = await this.exerciseService.runAiStagePhase2(phase1.blocks).toPromise();
      if (!phase2?.results?.length) {
        this.errorMessage = 'Phase 2 returned no parsed results.';
        this.loading = false;
        return;
      }

      const phase3: any = await this.exerciseService.runAiStagePhase3({
        blocks: phase1.blocks,
        parsedResults: phase2.results,
        answerKeyText: resolvedAnswerKey
      }).toPromise();

      this.exercises = (phase3?.exercises || []).map((ex: any) => this.ensureShape(ex));
      this.originalExercises = JSON.parse(JSON.stringify(this.exercises));
      this.successMessage = `Extracted ${this.exercises.length} exercise(s) successfully.`;
    } catch (err: any) {
      this.errorMessage = err?.message || 'An error occurred during AI extraction.';
    } finally {
      this.loading = false;
    }
  }

  // ─── Step 3: Select exercise for editing ─────────────────────────────────
  selectExercise(ex: AiExercise): void {
    this.selectedExercise = JSON.parse(JSON.stringify(ex));
    this.validationErrors = {};
    this.ensureEditorShape(this.selectedExercise!);
  }

  closeEditor(): void {
    this.selectedExercise = null;
    this.validationErrors = {};
  }

  // ─── Type-based row helpers ───────────────────────────────────────────────
  addPair(): void {
    if (this.selectedExercise) {
      (this.selectedExercise.pairs = this.selectedExercise.pairs || []).push({ left: '', right: '' });
    }
  }

  removePair(i: number): void {
    this.selectedExercise?.pairs?.splice(i, 1);
  }

  addQuestion(): void {
    if (!this.selectedExercise) return;
    const q = this.selectedExercise.questions || [];
    const type = this.selectedExercise.type;

    if (type === 'fill_in_blank') q.push({ sentence: '', answer: '' });
    else if (type === 'mcq') q.push({ question: '', options: [{ text: '' }, { text: '' }], correctAnswer: '' });
    else if (type === 'short_answer') q.push({ question: '' });
    else if (type === 'error_correction') q.push({ sentence: '', corrected: '' });
    else if (type === 'singular_plural') q.push({ singular: '', plural: '' });

    this.selectedExercise.questions = q;
  }

  removeQuestion(i: number): void {
    this.selectedExercise?.questions?.splice(i, 1);
  }

  addMcqOption(qIdx: number): void {
    const q = this.selectedExercise?.questions?.[qIdx] as McqQuestion;
    if (q) q.options.push({ text: '' });
  }

  removeMcqOption(qIdx: number, oIdx: number): void {
    const q = this.selectedExercise?.questions?.[qIdx] as McqQuestion;
    if (q) q.options.splice(oIdx, 1);
  }

  // ─── Validation ───────────────────────────────────────────────────────────
  validateExercise(ex: AiExercise): AiExercise {
    const clone: AiExercise = JSON.parse(JSON.stringify(ex));

    if (clone.type === 'matching') {
      clone.pairs = (clone.pairs || []).filter(p => p.left?.trim() && p.right?.trim());
    }
    if (clone.type === 'fill_in_blank') {
      clone.questions = (clone.questions || []).filter((q: FillQuestion) => q.sentence?.trim());
    }
    if (clone.type === 'mcq') {
      clone.questions = (clone.questions || []).filter(
        (q: McqQuestion) => q.question?.trim() && q.options?.length >= 2
      );
    }
    return clone;
  }

  private validateSelected(): boolean {
    if (!this.selectedExercise) return false;
    this.validationErrors = {};

    if (!this.selectedExercise.instruction?.trim()) {
      this.validationErrors['instruction'] = true;
    }

    const type = this.selectedExercise.type;
    if (type === 'matching') {
      (this.selectedExercise.pairs || []).forEach((p, i) => {
        if (!p.left?.trim()) this.validationErrors[`pair_left_${i}`] = true;
        if (!p.right?.trim()) this.validationErrors[`pair_right_${i}`] = true;
      });
    } else if (type === 'fill_in_blank') {
      (this.selectedExercise.questions || []).forEach((q: FillQuestion, i: number) => {
        if (!q.sentence?.trim()) this.validationErrors[`fill_sentence_${i}`] = true;
      });
    } else if (type === 'mcq') {
      (this.selectedExercise.questions || []).forEach((q: McqQuestion, i: number) => {
        if (!q.question?.trim()) this.validationErrors[`mcq_q_${i}`] = true;
        if (!q.options || q.options.length < 2) this.validationErrors[`mcq_opts_${i}`] = true;
      });
    }

    return Object.keys(this.validationErrors).length === 0;
  }

  // ─── Save single exercise ─────────────────────────────────────────────────
  saveExercise(): void {
    if (!this.selectedExercise) return;
    if (!this.validateSelected()) return;

    const index = this.exercises.findIndex(e => e.id === this.selectedExercise!.id);
    if (index !== -1) {
      this.exercises[index] = this.validateExercise(this.selectedExercise);
    }
    this.successMessage = `Exercise ${this.selectedExercise.id} saved.`;
    this.selectedExercise = null;
    this.validationErrors = {};
  }

  // ─── Reset single exercise ────────────────────────────────────────────────
  resetExercise(): void {
    if (!this.selectedExercise) return;
    const original = this.originalExercises.find(e => e.id === this.selectedExercise!.id);
    if (original) {
      this.selectedExercise = JSON.parse(JSON.stringify(original));
      this.ensureEditorShape(this.selectedExercise!);
      this.validationErrors = {};
    }
  }

  // ─── Step 4: Save all ─────────────────────────────────────────────────────
  saveAll(): void {
    const cleanData = this.exercises.map(ex => this.validateExercise(ex));
    console.log('FINAL OUTPUT', cleanData);
    this.successMessage = `All ${cleanData.length} exercises saved to console. Hook into save API to persist.`;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  questionCount(ex: AiExercise): number {
    if (ex.type === 'matching') return ex.pairs?.length || 0;
    return ex.questions?.length || 0;
  }

  typeLabel(type: string): string {
    const map: Record<string, string> = {
      matching: 'Matching',
      fill_in_blank: 'Fill in Blank',
      mcq: 'MCQ',
      short_answer: 'Short Answer',
      error_correction: 'Error Correction',
      singular_plural: 'Singular / Plural',
      open_writing: 'Open Writing',
      unknown: 'Unknown'
    };
    return map[type] || type;
  }

  private ensureShape(ex: any): AiExercise {
    if (!ex.pairs) ex.pairs = [];
    if (!ex.questions) ex.questions = [];
    return ex;
  }

  private ensureEditorShape(ex: AiExercise): void {
    if (ex.type === 'matching' && !ex.pairs?.length) ex.pairs = [{ left: '', right: '' }];
    if (['fill_in_blank', 'mcq', 'short_answer', 'error_correction', 'singular_plural'].includes(ex.type)) {
      if (!ex.questions?.length) {
        if (ex.type === 'fill_in_blank') ex.questions = [{ sentence: '', answer: '' }];
        else if (ex.type === 'mcq') ex.questions = [{ question: '', options: [{ text: '' }, { text: '' }], correctAnswer: '' }];
        else if (ex.type === 'short_answer') ex.questions = [{ question: '' }];
        else if (ex.type === 'error_correction') ex.questions = [{ sentence: '', corrected: '' }];
        else if (ex.type === 'singular_plural') ex.questions = [{ singular: '', plural: '' }];
      }
    }
  }

  // Expose castings for template use
  asFillQuestion(q: any): FillQuestion { return q; }
  asMcqQuestion(q: any): McqQuestion { return q; }
  asShortAnswerQuestion(q: any): ShortAnswerQuestion { return q; }
  asErrorQuestion(q: any): ErrorCorrectionQuestion { return q; }
  asSingularPluralRow(q: any): SingularPluralRow { return q; }

  trackByIndex(index: number): number { return index; }
}
