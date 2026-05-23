import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';

import { CommonModule } from '@angular/common';

import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';

import { MaterialModule } from '../../../../../shared/material.module';

import { InteractiveGameService } from '../../../services/interactive-game.service';

import { NotificationService } from '../../../../../services/notification.service';



@Component({

  selector: 'app-scramble-question-form',

  standalone: true,

  imports: [CommonModule, ReactiveFormsModule, MaterialModule],

  template: `

    <div class="sqf">

      <div class="sqf__intro">

        <mat-icon>timer</mat-icon>

        <div>

          <h3>Scramble Rush Words</h3>

          <p>Set how many seconds each word takes to reach the red line. Default is 5 seconds. Easy words: 3–4s. Hard words: 8–10s.</p>

        </div>

      </div>



      <div class="sqf__toolbar">

        <button mat-raised-button color="primary" (click)="addWord()">

          <mat-icon>add</mat-icon> Add Word

        </button>

      </div>



      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>



      <form [formGroup]="form" (ngSubmit)="save()">

        <div formArrayName="words" class="sqf__list">

          <mat-card class="sqf__card" *ngFor="let ctrl of words.controls; let i = index" [formGroupName]="i">

            <mat-card-header>

              <mat-card-title>Word #{{ i + 1 }}</mat-card-title>

              <button type="button" mat-icon-button color="warn" (click)="removeWord(i)">

                <mat-icon>close</mat-icon>

              </button>

            </mat-card-header>

            <mat-card-content>

              <div class="sqf__row">

                <mat-form-field appearance="outline" class="sqf__field sqf__field--word">

                  <mat-label>Word *</mat-label>

                  <input matInput formControlName="word" class="sqf__word-input" placeholder="HAUS">

                  <mat-hint>Uppercase German word</mat-hint>

                  <mat-error *ngIf="ctrl.get('word')?.hasError('required')">Required</mat-error>

                </mat-form-field>



                <mat-form-field appearance="outline" class="sqf__field">

                  <mat-label>Hint</mat-label>

                  <input matInput formControlName="hint" placeholder="A place to live">

                </mat-form-field>

              </div>



              <div class="sqf__duration-row">

                <mat-form-field appearance="outline" class="sqf__field sqf__field--duration">

                  <mat-label>Fall duration (seconds) *</mat-label>

                  <input matInput type="number" formControlName="fallDurationSeconds" min="2" max="30" step="1">

                  <mat-hint>Time until word crosses the red line</mat-hint>

                </mat-form-field>

                <span class="sqf__pace" [ngClass]="getPaceClass(ctrl.get('fallDurationSeconds')?.value)">

                  {{ getPaceLabel(ctrl.get('fallDurationSeconds')?.value) }}

                </span>

              </div>



              <div class="sqf__audio" *ngIf="ctrl.get('_id')?.value">

                <button type="button" mat-stroked-button (click)="pickAudio(i, 'word')">

                  <mat-icon>mic</mat-icon> Upload pronunciation

                </button>

                <span *ngIf="ctrl.get('audioUrl')?.value" class="sqf__audio-ok">

                  <mat-icon>check_circle</mat-icon> Audio set

                </span>

              </div>

            </mat-card-content>

          </mat-card>

        </div>



        <div *ngIf="words.length === 0" class="sqf__empty">

          No words yet. Click "Add Word" to start.

        </div>



        <div class="sqf__actions">

          <button type="submit" mat-raised-button color="primary" [disabled]="saving || form.invalid || words.length === 0">

            <mat-icon>save</mat-icon> {{ saving ? 'Saving…' : 'Save Words' }}

          </button>

        </div>

      </form>

    </div>

  `,

  styles: [`

    .sqf { padding: 24px 0; }

    .sqf__intro {

      display: flex; gap: 16px; align-items: flex-start;

      margin-bottom: 20px; padding: 16px 20px;

      background: linear-gradient(135deg, #fff8e1, #fffde7);

      border-radius: 16px; border: 1px solid #ffe082;

    }

    .sqf__intro mat-icon { color: #f57c00; font-size: 36px; width: 36px; height: 36px; flex-shrink: 0; }

    .sqf__intro h3 { margin: 0 0 6px; font-size: 18px; color: #405980; }

    .sqf__intro p { margin: 0; font-size: 14px; color: #666; line-height: 1.5; }

    .sqf__toolbar { display: flex; justify-content: flex-end; margin-bottom: 16px; }

    .sqf__list { display: flex; flex-direction: column; gap: 12px; }

    .sqf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 0; }

    .sqf__card mat-card-title { font-size: 14px; font-weight: 600; }

    .sqf__row { display: flex; gap: 12px; flex-wrap: wrap; padding-top: 8px; }

    .sqf__duration-row {

      display: flex; flex-wrap: wrap; align-items: center; gap: 16px;

      margin-top: 8px; padding: 12px 16px;

      background: #eef4ff; border-radius: 12px; border: 1px solid #c8d8e8;

    }

    .sqf__field { flex: 1; min-width: 150px; }

    .sqf__field--word { font-weight: 600; }
    .sqf__word-input { text-transform: uppercase; }

    .sqf__field--duration { max-width: 220px; min-width: 180px; }

    .sqf__pace {

      display: inline-block; padding: 8px 14px; border-radius: 20px;

      font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;

    }

    .sqf__pace--easy { background: #e8f5e9; color: #2e7d32; }

    .sqf__pace--normal { background: #e3f2fd; color: #1565c0; }

    .sqf__pace--hard { background: #fce4ec; color: #b71c1c; }

    .sqf__empty { text-align: center; padding: 32px; color: #aaa; }

    .sqf__actions { display: flex; justify-content: flex-end; margin-top: 20px; }

    .sqf__audio { display: flex; align-items: center; gap: 12px; margin-top: 8px; }

    .sqf__audio-ok { font-size: 13px; color: #2e7d32; display: flex; align-items: center; gap: 4px; }

  `]

})

export class ScrambleQuestionFormComponent implements OnInit, OnChanges {

  @Input() gameSetId!: string;



  form!: FormGroup;

  loading = false;

  saving = false;



  constructor(

    private fb: FormBuilder,

    private svc: InteractiveGameService,

    private notify: NotificationService

  ) {}



  get words(): FormArray { return this.form.get('words') as FormArray; }



  ngOnInit() {
    this.form = this.fb.group({ words: this.fb.array([]) });
    this.load();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['gameSetId'] && !changes['gameSetId'].firstChange && this.form) {
      this.load();
    }
  }



  getPaceLabel(seconds: number | null | undefined): string {

    const s = Number(seconds) || 5;

    if (s <= 4) return 'Easy — fast fall';

    if (s >= 8) return 'Hard — slow fall';

    return 'Normal pace';

  }



  getPaceClass(seconds: number | null | undefined): string {

    const s = Number(seconds) || 5;

    if (s <= 4) return 'sqf__pace--easy';

    if (s >= 8) return 'sqf__pace--hard';

    return 'sqf__pace--normal';

  }



  load() {

    if (!this.gameSetId) return;

    this.loading = true;

    this.svc.adminGetQuestions(this.gameSetId).subscribe({

      next: (r) => {

        this.words.clear();

        (r.questions || []).forEach((q: any) => this.words.push(this.makeControl(q)));

        this.loading = false;

      },

      error: () => { this.loading = false; }

    });

  }



  makeControl(q: any = {}): FormGroup {

    return this.fb.group({

      _id: [q._id || null],

      word: [q.word || '', Validators.required],

      hint: [q.hint || ''],

      audioUrl: [q.audioUrl || null],

      difficultyLevel: [q.difficultyLevel || 1],

      fallDurationSeconds: [q.fallDurationSeconds ?? 5, [Validators.required, Validators.min(2), Validators.max(30)]],

      order: [q.order ?? this.words.length],

    });

  }



  pickAudio(index: number, field: 'word' | 'sentence') {

    const input = document.createElement('input');

    input.type = 'file';

    input.accept = 'audio/*';

    input.onchange = () => {

      const file = input.files?.[0];

      const qid = this.words.at(index).get('_id')?.value;

      if (!file || !qid) return;

      this.svc.adminUploadQuestionAudio(qid, file, field).subscribe({

        next: (r) => {

          this.words.at(index).patchValue({ audioUrl: r.audioUrl || r.url });

          this.notify.success('Audio uploaded');

        },

        error: () => this.notify.error('Audio upload failed'),

      });

    };

    input.click();

  }



  addWord() { this.words.push(this.makeControl()); }



  removeWord(i: number) { this.words.removeAt(i); }



  save() {

    if (this.form.invalid) return;

    this.saving = true;

    const qs = this.words.value.map((w: any, i: number) => ({
      ...w,
      word: String(w.word || '').trim().toUpperCase(),
      order: i,
    }));

    this.svc.adminUpsertQuestions(this.gameSetId, qs).subscribe({

      next: () => {

        this.saving = false;

        this.notify.success('Words saved!');

        this.load();

      },

      error: (err) => { this.saving = false; this.notify.error(err?.error?.message || 'Save failed'); }

    });

  }

}

