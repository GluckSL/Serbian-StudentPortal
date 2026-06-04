import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';

@Component({
  selector: 'app-word-search-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <div class="wsf">
      <div class="wsf__intro">
        <mat-icon>grid_on</mat-icon>
        <div>
          <h3>Word search puzzles</h3>
          <p>Add hidden words for each puzzle. Students tap any letter in a word to highlight the whole word — like Wordwall word search.</p>
        </div>
      </div>

      <div class="wsf__notice" *ngIf="!hasGameSetId">
        <mat-icon>info</mat-icon>
        <p>Save <strong>Game Details</strong> first, then add puzzles here.</p>
      </div>

      <div class="wsf__toolbar" *ngIf="hasGameSetId">
        <button mat-raised-button color="primary" type="button" (click)="addPuzzle()">
          <mat-icon>add</mat-icon> Add puzzle
        </button>
      </div>

      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>

      <form *ngIf="hasGameSetId" [formGroup]="form" (ngSubmit)="save()">
        <div formArrayName="puzzles" class="wsf__list">
          <mat-card class="wsf__card" *ngFor="let puzzle of puzzles.controls; let pi = index" [formGroupName]="pi">
            <mat-card-header>
              <mat-card-title>Puzzle {{ pi + 1 }}</mat-card-title>
              <button type="button" mat-icon-button color="warn" (click)="removePuzzle(pi)">
                <mat-icon>close</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content>
              <div formArrayName="words" class="wsf__words">
                <div class="wsf__word-row" *ngFor="let w of wordsAt(pi).controls; let wi = index" [formGroupName]="wi">
                  <mat-form-field appearance="outline" class="wsf__field">
                    <mat-label>Hidden word {{ wi + 1 }}</mat-label>
                    <input matInput formControlName="text" placeholder="e.g. SCHULE">
                    <mat-error *ngIf="w.get('text')?.hasError('required')">Required</mat-error>
                    <mat-error *ngIf="w.get('text')?.hasError('minlength')">At least 2 letters</mat-error>
                  </mat-form-field>
                  <button type="button" mat-icon-button (click)="removeWord(pi, wi)" [disabled]="wordsAt(pi).length <= 3">
                    <mat-icon>remove_circle_outline</mat-icon>
                  </button>
                </div>
              </div>
              <button type="button" mat-stroked-button (click)="addWord(pi)">
                <mat-icon>add</mat-icon> Add word
              </button>
            </mat-card-content>
          </mat-card>
        </div>

        <div *ngIf="puzzles.length === 0" class="wsf__empty">
          No puzzles yet. Add one with at least 3 hidden words.
        </div>

        <div class="wsf__actions">
          <button type="submit" mat-raised-button color="primary"
            [disabled]="saving || form.invalid || puzzles.length === 0">
            <mat-icon>save</mat-icon> {{ saving ? 'Saving…' : 'Save puzzles' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .wsf { padding: 24px 0; }
    .wsf__intro {
      display: flex; gap: 16px; align-items: flex-start;
      margin-bottom: 20px; padding: 16px 20px;
      background: linear-gradient(135deg, #fef9c3, #ffedd5);
      border-radius: 16px; border: 1px solid #fcd34d;
    }
    .wsf__intro mat-icon { color: #ca8a04; font-size: 36px; width: 36px; height: 36px; flex-shrink: 0; }
    .wsf__intro h3 { margin: 0 0 6px; font-size: 18px; color: #78350f; }
    .wsf__intro p { margin: 0; font-size: 14px; color: #475569; line-height: 1.5; }
    .wsf__notice {
      display: flex; gap: 12px; padding: 14px; background: #e8f4fd; border-radius: 10px;
      border: 1px solid #90caf9; margin-bottom: 16px;
    }
    .wsf__toolbar { display: flex; justify-content: flex-end; margin-bottom: 16px; }
    .wsf__list { display: flex; flex-direction: column; gap: 16px; }
    .wsf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; }
    .wsf__words { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .wsf__word-row { display: flex; align-items: flex-start; gap: 4px; }
    .wsf__field { flex: 1; }
    .wsf__empty { text-align: center; padding: 32px; color: #94a3b8; }
    .wsf__actions { display: flex; justify-content: flex-end; margin-top: 20px; }
  `],
})
export class WordSearchQuestionFormComponent implements OnInit, OnChanges {
  @Input() gameSetId!: string;

  form!: FormGroup;
  loading = false;
  saving = false;

  constructor(
    private fb: FormBuilder,
    private svc: InteractiveGameService,
    private notify: NotificationService,
  ) {}

  get hasGameSetId(): boolean {
    return !!this.gameSetId;
  }

  get puzzles(): FormArray {
    return this.form.get('puzzles') as FormArray;
  }

  wordsAt(puzzleIndex: number): FormArray {
    return this.puzzles.at(puzzleIndex).get('words') as FormArray;
  }

  ngOnInit(): void {
    this.form = this.fb.group({ puzzles: this.fb.array([]) });
    this.load();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['gameSetId'] && !changes['gameSetId'].firstChange && this.form) {
      this.load();
    }
  }

  addPuzzle(): void {
    const words = this.fb.array([
      this.newWordCtrl(''),
      this.newWordCtrl(''),
      this.newWordCtrl(''),
    ]);
    this.puzzles.push(this.fb.group({
      _id: [''],
      order: [this.puzzles.length],
      words,
    }));
  }

  removePuzzle(i: number): void {
    this.puzzles.removeAt(i);
  }

  addWord(puzzleIndex: number): void {
    this.wordsAt(puzzleIndex).push(this.newWordCtrl(''));
  }

  removeWord(puzzleIndex: number, wordIndex: number): void {
    if (this.wordsAt(puzzleIndex).length <= 3) return;
    this.wordsAt(puzzleIndex).removeAt(wordIndex);
  }

  private newWordCtrl(value: string) {
    return this.fb.group({
      text: [value, [Validators.required, Validators.minLength(2)]],
    });
  }

  load(): void {
    if (!this.gameSetId) return;
    this.loading = true;
    this.svc.adminGetQuestions(this.gameSetId).subscribe({
      next: (r) => {
        this.puzzles.clear();
        const qs = (r.questions || []).sort(
          (a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0),
        );
        for (const q of qs) {
          const raw = q as { searchWords?: string[]; word?: string };
          const list = Array.isArray(raw.searchWords) && raw.searchWords.length
            ? raw.searchWords
            : (raw.word ? [raw.word] : []);
          const words = this.fb.array(
            (list.length ? list : ['', '', '']).map(w => this.newWordCtrl(String(w))),
          );
          while (words.length < 3) {
            words.push(this.newWordCtrl(''));
          }
          this.puzzles.push(this.fb.group({
            _id: [q._id || ''],
            order: [q.order ?? 0],
            words,
          }));
        }
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error('Failed to load word search puzzles');
      },
    });
  }

  save(): void {
    if (!this.gameSetId || this.form.invalid || this.puzzles.length === 0) return;
    this.saving = true;
    const questions = this.puzzles.controls.map((ctrl, i) => {
      const v = ctrl.value;
      const searchWords = (v.words || [])
        .map((w: { text: string }) => String(w.text || '').trim().toUpperCase())
        .filter((w: string) => w.length >= 2);
      return {
        _id: v._id || undefined,
        order: i,
        searchWords,
      };
    });
    this.svc.adminUpsertQuestions(this.gameSetId, questions).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success('Word search puzzles saved');
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err?.error?.message || 'Save failed');
      },
    });
  }
}
