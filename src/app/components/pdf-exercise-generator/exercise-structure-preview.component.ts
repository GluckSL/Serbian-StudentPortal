import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface ExercisePreview {
  exerciseId: string;
  /** Same as exerciseId when provided by API */
  id?: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard' | string;
  type: string;
  questionCount: number;
  enabled: boolean;
  instruction_de?: string;
  instruction_en?: string;
  /** Merged DE/EN banner (set on upload when available) */
  instruction?: string;
  /** Verbatim Übung block from PDF */
  rawText?: string;
  /** Fill-blank rows: { sentence, answer } from deterministic pipeline */
  questions?: Array<{ sentence?: string; answer?: string }>;
  /** Matching rows: { left, right } from deterministic pipeline */
  pairs?: Array<{ left?: string; right?: string }>;
  /** Flattened questions from extraction, matched by sectionTitle */
  extractedItems?: any[];
}

@Component({
  selector: 'app-exercise-structure-preview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './exercise-structure-preview.component.html',
  styleUrls: ['./exercise-structure-preview.component.css']
})
export class ExerciseStructurePreviewComponent implements OnChanges {
  @Input() exercises: ExercisePreview[] = [];
  @Input() extracting = false;
  @Input() aiRescanning = false;
  @Input() progressCurrent = 0;
  @Input() progressTotal = 0;
  @Output() rescan = new EventEmitter<void>();
  @Output() useAiRescan = new EventEmitter<void>();
  @Output() extractAll = new EventEmitter<void>();

  readonly typeOptions = [
    '',
    'mcq',
    'matching',
    'fill_in_blank',
    'singular_plural',
    'jumbled_words',
    'pronunciation',
    'error_correction',
    'open_writing',
    'transformation',
    'true_false',
    'short_answer'
  ];

  grouped: Array<{ topic: string; items: ExercisePreview[] }> = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['exercises']) {
      this.rebuildGrouped();
    }
  }

  private rebuildGrouped(): void {
    const map = new Map<string, ExercisePreview[]>();
    for (const ex of this.exercises) {
      const key = ex.topic?.trim() || 'Untitled Topic';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ex);
    }
    this.grouped = Array.from(map.entries()).map(([topic, items]) => ({ topic, items }));
  }

  get selectedCount(): number {
    return this.exercises.filter(e => e.enabled).length;
  }

  trackByTopic(_: number, g: { topic: string }): string { return g.topic; }
  trackByExId(_: number, ex: ExercisePreview): string { return ex.exerciseId; }

  selectedExercise: ExercisePreview | null = null;
  isPreviewOpen = false;

  openPreview(ex: ExercisePreview): void {
    this.selectedExercise = ex;
    this.isPreviewOpen = true;
  }

  closePreview(): void {
    this.isPreviewOpen = false;
    this.selectedExercise = null;
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeClose(ev: KeyboardEvent): void {
    if (!this.isPreviewOpen) return;
    ev.preventDefault();
    this.closePreview();
  }

  previewTitle(ex: ExercisePreview | null): string {
    if (!ex) return '';
    return String(ex.id || ex.exerciseId || 'Exercise');
  }

  hasExtracted(ex: ExercisePreview | null): boolean {
    const items = ex?.extractedItems;
    return Array.isArray(items) && items.length > 0;
  }

  /** Parsed pairs/questions from upload (answer key + layout), before AI extraction. */
  hasDeterministic(ex: ExercisePreview | null): boolean {
    const p = ex?.pairs;
    const q = ex?.questions;
    return (Array.isArray(p) && p.length > 0) || (Array.isArray(q) && q.length > 0);
  }

  typeLabel(t: string): string {
    if (!t) return 'Unclassified';
    if (t === 'jumbled_words' || t === 'jumble-word') return 'Jumble Word';
    return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  setQuestionCount(ex: ExercisePreview, raw: number | string): void {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    ex.questionCount = Math.max(0, Math.floor(parsed));
  }
}

