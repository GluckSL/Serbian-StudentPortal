import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';
import { AdminGenderStackQuestion, ArticleGender } from '../../../glueck-arena.types';
import { trimGermanWord } from '../../../utils/german-text';

@Component({
  selector: 'app-gender-stack-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <div class="gsqf">
      <div class="gsqf__intro">
        <mat-icon>layers</mat-icon>
        <div>
          <h3>Gender Stack Words</h3>
          <p>Add German nouns with their English translation and correct article (der, die, das). Words fall on a timer; students drag each block into the matching bucket.</p>
        </div>
      </div>

      <div class="gsqf__toolbar">
        <button mat-raised-button color="primary" type="button" (click)="addWord()">
          <mat-icon>add</mat-icon> Add Noun
        </button>
      </div>

      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>

      <form [formGroup]="form" (ngSubmit)="save()">
        <div formArrayName="words" class="gsqf__list">
          <mat-card class="gsqf__card" *ngFor="let ctrl of words.controls; let i = index" [formGroupName]="i">
            <mat-card-header>
              <mat-card-title>Noun #{{ i + 1 }}</mat-card-title>
              <button type="button" mat-icon-button color="warn" (click)="removeWord(i)">
                <mat-icon>close</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content>
              <div class="gsqf__row">
                <mat-form-field appearance="outline" class="gsqf__field">
                  <mat-label>German noun *</mat-label>
                  <input matInput formControlName="word" placeholder="Tisch">
                  <mat-error *ngIf="ctrl.get('word')?.hasError('required')">Required</mat-error>
                </mat-form-field>
                <mat-form-field appearance="outline" class="gsqf__field">
                  <mat-label>English translation *</mat-label>
                  <input matInput formControlName="translation" placeholder="Table">
                  <mat-error *ngIf="ctrl.get('translation')?.hasError('required')">Required</mat-error>
                </mat-form-field>
                <mat-form-field appearance="outline" class="gsqf__field gsqf__field--gender">
                  <mat-label>Article *</mat-label>
                  <mat-select formControlName="articleGender">
                    <mat-option value="der">der (masculine)</mat-option>
                    <mat-option value="die">die (feminine)</mat-option>
                    <mat-option value="das">das (neuter)</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>
            </mat-card-content>
          </mat-card>
        </div>

        <div *ngIf="words.length === 0" class="gsqf__empty">
          No nouns yet. Click "Add Noun" to start.
        </div>

        <div class="gsqf__actions">
          <button type="submit" mat-raised-button color="primary" [disabled]="saving || form.invalid || words.length === 0">
            <mat-icon>save</mat-icon> {{ saving ? 'Saving…' : 'Save Nouns' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .gsqf { padding: 24px 0; }
    .gsqf__intro { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 20px; padding: 16px; background: #eff6ff; border-radius: 12px; border: 1px solid #bfdbfe; }
    .gsqf__intro mat-icon { color: #2563eb; font-size: 32px; width: 32px; height: 32px; }
    .gsqf__intro h3 { margin: 0 0 4px; font-size: 16px; color: #1e3a5f; }
    .gsqf__intro p { margin: 0; font-size: 13px; color: #64748b; line-height: 1.45; }
    .gsqf__toolbar { display: flex; justify-content: flex-end; margin-bottom: 16px; }
    .gsqf__list { display: flex; flex-direction: column; gap: 12px; }
    .gsqf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; }
    .gsqf__row { display: flex; gap: 12px; flex-wrap: wrap; padding-top: 8px; }
    .gsqf__field { flex: 1; min-width: 160px; }
    .gsqf__field--gender { min-width: 140px; max-width: 200px; }
    .gsqf__empty { text-align: center; padding: 32px; color: #94a3b8; }
    .gsqf__actions { margin-top: 20px; display: flex; justify-content: flex-end; }
  `],
})
export class GenderStackQuestionFormComponent implements OnInit {
  @Input() gameSetId = '';

  form!: FormGroup;
  loading = false;
  saving = false;

  constructor(
    private fb: FormBuilder,
    private svc: InteractiveGameService,
    private notify: NotificationService,
  ) {
    this.form = this.fb.group({ words: this.fb.array<FormGroup>([]) });
  }

  get words() { return this.form.get('words') as FormArray<FormGroup>; }

  ngOnInit() {
    if (this.gameSetId) this.load();
  }

  load() {
    if (!this.gameSetId) return;
    this.loading = true;
    this.svc.adminGetQuestions(this.gameSetId).subscribe({
      next: (r) => {
        this.words.clear();
        (r.questions as AdminGenderStackQuestion[] || []).forEach((q) => {
          this.words.push(this.wordGroup(q));
        });
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error('Failed to load questions');
      },
    });
  }

  addWord() {
    this.words.push(this.wordGroup());
  }

  removeWord(i: number) {
    this.words.removeAt(i);
  }

  private wordGroup(q?: Partial<AdminGenderStackQuestion>): FormGroup {
    return this.fb.group({
      _id: [q?._id || ''],
      word: [q?.word || '', Validators.required],
      translation: [q?.translation || '', Validators.required],
      articleGender: [(q?.articleGender || 'der') as ArticleGender, Validators.required],
      audioUrl: [q?.audioUrl || null],
    });
  }

  save() {
    if (this.form.invalid || !this.gameSetId) return;
    this.saving = true;
    const questions = this.words.controls.map((ctrl, i) => {
      const v = ctrl.value;
      return {
        _id: v._id || undefined,
        order: i,
        word: trimGermanWord(v.word),
        translation: String(v.translation || '').trim(),
        articleGender: v.articleGender,
        audioUrl: v.audioUrl || null,
      };
    });

    this.svc.adminUpsertQuestions(this.gameSetId, questions).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success('Nouns saved!');
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err?.error?.message || 'Save failed');
      },
    });
  }
}
