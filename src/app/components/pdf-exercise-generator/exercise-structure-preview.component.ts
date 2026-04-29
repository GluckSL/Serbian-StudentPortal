import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface ExercisePreview {
  exerciseId: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard' | string;
  type: string;
  questionCount: number;
  enabled: boolean;
  instruction_de?: string;
  instruction_en?: string;
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
  @Input() progressCurrent = 0;
  @Input() progressTotal = 0;
  @Output() rescan = new EventEmitter<void>();
  @Output() extractAll = new EventEmitter<void>();

  readonly typeOptions = [
    '', 'mcq', 'matching', 'fill_in_blank', 'error_correction', 'open_writing', 'transformation', 'true_false', 'short_answer'
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

  typeLabel(t: string): string {
    if (!t) return 'Unclassified';
    return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

