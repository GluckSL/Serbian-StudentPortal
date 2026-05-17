import { Component, Input, OnInit } from '@angular/core';

import { CommonModule } from '@angular/common';

import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';

import { MaterialModule } from '../../../../../shared/material.module';

import { InteractiveGameService } from '../../../services/interactive-game.service';

import { NotificationService } from '../../../../../services/notification.service';



@Component({

  selector: 'app-level-editor',

  standalone: true,

  imports: [CommonModule, ReactiveFormsModule, MaterialModule],

  template: `

    <div class="le">

      <div class="le__intro">

        <mat-icon>sports_esports</mat-icon>

        <div>

          <h3>Scramble Rush Levels</h3>

          <p>Configure how long students have to unscramble each falling word. Slower fall = more time.</p>

        </div>

      </div>



      <div class="le__toolbar">

        <button mat-raised-button color="primary" (click)="addLevel()">

          <mat-icon>add</mat-icon> Add Level

        </button>

      </div>



      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>



      <form [formGroup]="form" (ngSubmit)="save()">

        <div formArrayName="levels" class="le__list">

          <mat-card class="le__card" *ngFor="let ctrl of levels.controls; let i = index" [formGroupName]="i">

            <mat-card-header>

              <mat-card-title>

                <mat-icon>flag</mat-icon>

                Level {{ i + 1 }}

              </mat-card-title>

              <button type="button" mat-icon-button color="warn" (click)="removeLevel(i)" aria-label="Remove level">

                <mat-icon>close</mat-icon>

              </button>

            </mat-card-header>

            <mat-card-content>

              <div class="le__highlight">

                <mat-form-field appearance="outline" class="le__field le__field--primary">

                  <mat-label>Seconds per word attempt</mat-label>

                  <input matInput type="number" formControlName="wordAttemptSeconds" min="3" max="30" step="1">

                  <mat-hint>How long until a word reaches the red line (controls fall speed)</mat-hint>

                </mat-form-field>

                <div class="le__speed-preview">

                  <span [class]="getSpeedClass(ctrl.get('wordAttemptSeconds')?.value)">

                    {{ getSpeedLabel(ctrl.get('wordAttemptSeconds')?.value) }}

                  </span>

                </div>

              </div>



              <div class="le__row">

                <mat-form-field appearance="outline" class="le__field">

                  <mat-label>Lives</mat-label>

                  <input matInput type="number" formControlName="lives" min="1" max="10">

                </mat-form-field>



                <mat-form-field appearance="outline" class="le__field">

                  <mat-label>Level time limit (sec)</mat-label>

                  <input matInput type="number" formControlName="timeLimitSeconds" min="10" max="600">

                  <mat-hint>Total round timer shown in HUD</mat-hint>

                </mat-form-field>



                <mat-form-field appearance="outline" class="le__field">

                  <mat-label>Spawn interval (sec)</mat-label>

                  <input matInput type="number" formControlName="spawnIntervalSeconds" min="1" max="15" step="0.5">

                  <mat-hint>Delay between new falling words</mat-hint>

                </mat-form-field>



                <mat-form-field appearance="outline" class="le__field">

                  <mat-label>Words required</mat-label>

                  <input matInput type="number" formControlName="wordsRequired" min="1">

                </mat-form-field>



                <mat-form-field appearance="outline" class="le__field">

                  <mat-label>Score multiplier</mat-label>

                  <input matInput type="number" formControlName="scoreMultiplier" min="0.5" step="0.5">

                </mat-form-field>

              </div>

            </mat-card-content>

          </mat-card>

        </div>



        <div *ngIf="levels.length === 0" class="le__empty">

          No levels yet. Add at least one level.

        </div>



        <div class="le__actions">

          <button type="submit" mat-raised-button color="primary" [disabled]="saving || form.invalid || levels.length === 0">

            <mat-icon>save</mat-icon> {{ saving ? 'Saving…' : 'Save Levels' }}

          </button>

        </div>

      </form>

    </div>

  `,

  styles: [`

    .le { padding: 24px 0; }

    .le__intro {

      display: flex;

      gap: 16px;

      align-items: flex-start;

      margin-bottom: 20px;

      padding: 16px 20px;

      background: linear-gradient(135deg, #eef4ff, #f8fafc);

      border-radius: 16px;

      border: 1px solid #c8d8e8;

    }

    .le__intro mat-icon { color: #405980; font-size: 36px; width: 36px; height: 36px; flex-shrink: 0; }

    .le__intro h3 { margin: 0 0 6px; font-size: 18px; color: #405980; }

    .le__intro p { margin: 0; font-size: 14px; color: #666; line-height: 1.5; }

    .le__toolbar { display: flex; justify-content: flex-end; margin-bottom: 16px; }

    .le__list { display: flex; flex-direction: column; gap: 16px; }

    .le__card mat-card-header {

      display: flex;

      justify-content: space-between;

      align-items: center;

    }

    .le__card mat-card-title {

      display: flex;

      align-items: center;

      gap: 8px;

      font-size: 16px;

    }

    .le__highlight {

      display: flex;

      flex-wrap: wrap;

      align-items: center;

      gap: 16px;

      padding: 16px;

      margin-bottom: 12px;

      background: #fff8e1;

      border-radius: 12px;

      border: 1px solid #ffe082;

    }

    .le__field--primary { flex: 1; min-width: 220px; }

    .le__speed-preview span {

      display: inline-block;

      padding: 8px 16px;

      border-radius: 20px;

      font-size: 13px;

      font-weight: 700;

      text-transform: uppercase;

      letter-spacing: 0.04em;

    }

    .le__speed--slow { background: #e8f5e9; color: #2e7d32; }

    .le__speed--medium { background: #fff3e0; color: #e65100; }

    .le__speed--fast { background: #fce4ec; color: #b71c1c; }

    .le__row { display: flex; flex-wrap: wrap; gap: 12px; }

    .le__field { flex: 1; min-width: 140px; }

    .le__empty { text-align: center; padding: 32px; color: #aaa; }

    .le__actions { display: flex; justify-content: flex-end; margin-top: 20px; }

  `]

})

export class LevelEditorComponent implements OnInit {

  @Input() gameSetId!: string;



  form!: FormGroup;

  loading = false;

  saving = false;



  constructor(

    private fb: FormBuilder,

    private svc: InteractiveGameService,

    private notify: NotificationService

  ) {}



  get levels(): FormArray { return this.form.get('levels') as FormArray; }



  ngOnInit() {

    this.form = this.fb.group({ levels: this.fb.array([]) });

    this.load();

  }



  getSpeedLabel(seconds: number | null | undefined): string {

    const s = Number(seconds) || 8;

    if (s >= 12) return 'Slow — beginner friendly';

    if (s >= 7) return 'Medium pace';

    return 'Fast — challenging';

  }



  getSpeedClass(seconds: number | null | undefined): string {

    const s = Number(seconds) || 8;

    if (s >= 12) return 'le__speed--slow';

    if (s >= 7) return 'le__speed--medium';

    return 'le__speed--fast';

  }



  load() {

    if (!this.gameSetId) return;

    this.loading = true;

    this.svc.adminGetLevels(this.gameSetId).subscribe({

      next: (r) => {

        this.levels.clear();

        (r.levels || []).forEach((l: any) => this.levels.push(this.makeControl(l)));

        if (!r.levels?.length) this.addDefaultLevels();

        this.loading = false;

      },

      error: () => { this.loading = false; this.addDefaultLevels(); }

    });

  }



  addDefaultLevels() {

    const defaults = [

      { levelNumber: 1, lives: 3, timeLimitSeconds: 90, fallSpeedMs: 12000, spawnIntervalMs: 4000, wordsRequired: 5, scoreMultiplier: 1 },

      { levelNumber: 2, lives: 3, timeLimitSeconds: 75, fallSpeedMs: 9000, spawnIntervalMs: 3000, wordsRequired: 5, scoreMultiplier: 1.5 },

      { levelNumber: 3, lives: 2, timeLimitSeconds: 60, fallSpeedMs: 7000, spawnIntervalMs: 2500, wordsRequired: 5, scoreMultiplier: 2 },

    ];

    defaults.forEach(d => this.levels.push(this.makeControl(d)));

  }



  msToSeconds(ms: number): number {

    return Math.round(Math.max(1000, ms) / 1000);

  }



  makeControl(l: any = {}): FormGroup {

    const fallMs = l.fallSpeedMs ?? (l.wordAttemptSeconds ? l.wordAttemptSeconds * 1000 : 8000);

    const spawnMs = l.spawnIntervalMs ?? (l.spawnIntervalSeconds ? l.spawnIntervalSeconds * 1000 : 3000);

    return this.fb.group({

      levelNumber: [l.levelNumber ?? this.levels.length + 1],

      lives: [l.lives ?? 3, [Validators.min(1), Validators.max(10)]],

      timeLimitSeconds: [l.timeLimitSeconds ?? 60, [Validators.min(10), Validators.max(600)]],

      wordAttemptSeconds: [l.wordAttemptSeconds ?? this.msToSeconds(fallMs), [Validators.min(3), Validators.max(30)]],

      spawnIntervalSeconds: [l.spawnIntervalSeconds ?? this.msToSeconds(spawnMs), [Validators.min(1), Validators.max(15)]],

      wordsRequired: [l.wordsRequired ?? 5, [Validators.min(1)]],

      scoreMultiplier: [l.scoreMultiplier ?? 1, [Validators.min(0.5)]],

    });

  }



  addLevel() {

    const last = this.levels.value.at(-1);

    this.levels.push(this.makeControl({

      levelNumber: (last?.levelNumber ?? 0) + 1,

      lives: last?.lives ?? 3,

      timeLimitSeconds: Math.max(30, (last?.timeLimitSeconds ?? 60) - 10),

      wordAttemptSeconds: Math.max(3, (last?.wordAttemptSeconds ?? 8) - 1),

      spawnIntervalSeconds: Math.max(1, (last?.spawnIntervalSeconds ?? 3) - 0.5),

      wordsRequired: last?.wordsRequired ?? 5,

      scoreMultiplier: Math.min(10, (last?.scoreMultiplier ?? 1) + 0.5),

    }));

  }



  removeLevel(i: number) { this.levels.removeAt(i); }



  save() {

    if (this.form.invalid) return;

    this.saving = true;

    const ls = this.levels.value.map((l: any, i: number) => ({

      levelNumber: i + 1,

      lives: l.lives,

      timeLimitSeconds: l.timeLimitSeconds,

      wordAttemptSeconds: l.wordAttemptSeconds,

      fallSpeedMs: Math.round(l.wordAttemptSeconds * 1000),

      spawnIntervalSeconds: l.spawnIntervalSeconds,

      spawnIntervalMs: Math.round(l.spawnIntervalSeconds * 1000),

      wordsRequired: l.wordsRequired,

      scoreMultiplier: l.scoreMultiplier,

    }));

    this.svc.adminUpsertLevels(this.gameSetId, ls).subscribe({

      next: () => { this.saving = false; this.notify.success('Levels saved!'); this.load(); },

      error: (err) => { this.saving = false; this.notify.error(err?.error?.message || 'Save failed'); }

    });

  }

}

