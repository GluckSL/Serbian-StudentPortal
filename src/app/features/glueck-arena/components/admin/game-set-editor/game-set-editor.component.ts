import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';
import { environment } from '../../../../../../environments/environment';
import { GameSet, GameType, AdminGameQuestion, GameLevel } from '../../../glueck-arena.types';

interface BatchSummary { batchName: string; }
import { ScrambleQuestionFormComponent } from '../scramble-question-form/scramble-question-form.component';
import { SentenceQuestionFormComponent } from '../sentence-question-form/sentence-question-form.component';
import { SimpleQuestionFormComponent } from '../simple-question-form/simple-question-form.component';
import { LevelEditorComponent } from '../level-editor/level-editor.component';
import { GameImportPanelComponent } from '../game-import-panel/game-import-panel.component';

@Component({
  selector: 'app-game-set-editor',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, FormsModule, RouterModule, MaterialModule,
    ScrambleQuestionFormComponent, SentenceQuestionFormComponent, SimpleQuestionFormComponent,
    LevelEditorComponent, GameImportPanelComponent
  ],
  template: `
    <div class="ga-editor">
      <div class="ga-editor__header">
        <button mat-icon-button routerLink="/admin/glueck-arena">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <h1>{{ isEdit ? 'Edit Game Set' : 'New Game Set' }}</h1>
      </div>

      <mat-progress-bar *ngIf="saving || loading" mode="indeterminate"></mat-progress-bar>

      <mat-tab-group *ngIf="!loading">
        <!-- Tab 1: Metadata -->
        <mat-tab label="Game Details">
          <form [formGroup]="form" (ngSubmit)="save()" class="ga-editor__form">
            <div class="ga-editor__row">
              <mat-form-field appearance="outline" class="ga-editor__field ga-editor__field--wide">
                <mat-label>Title *</mat-label>
                <input matInput formControlName="title">
                <mat-error *ngIf="form.get('title')?.hasError('required')">Required</mat-error>
              </mat-form-field>

              <mat-form-field appearance="outline" class="ga-editor__field">
                <mat-label>Game Type *</mat-label>
                <mat-select formControlName="gameType" (selectionChange)="onTypeChange()">
                  <mat-option value="scramble_rush">Scramble Rush</mat-option>
                  <mat-option value="sentence_builder">Sentence Builder</mat-option>
                  <mat-option value="matching">Matching</mat-option>
                  <mat-option value="flashcards">Flashcards</mat-option>
                </mat-select>
              </mat-form-field>
            </div>

            <mat-form-field appearance="outline" class="ga-editor__field ga-editor__field--full">
              <mat-label>Description</mat-label>
              <textarea matInput formControlName="description" rows="3"></textarea>
            </mat-form-field>

            <div class="ga-editor__row">
              <mat-form-field appearance="outline" class="ga-editor__field">
                <mat-label>Difficulty *</mat-label>
                <mat-select formControlName="difficulty">
                  <mat-option value="Beginner">Beginner</mat-option>
                  <mat-option value="Intermediate">Intermediate</mat-option>
                  <mat-option value="Advanced">Advanced</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="ga-editor__field">
                <mat-label>CEFR Level</mat-label>
                <mat-select formControlName="level">
                  <mat-option value="">None</mat-option>
                  <mat-option *ngFor="let l of cefrLevels" [value]="l">{{ l }}</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="ga-editor__field">
                <mat-label>Category</mat-label>
                <mat-select formControlName="category">
                  <mat-option *ngFor="let c of categories" [value]="c">{{ c }}</mat-option>
                </mat-select>
              </mat-form-field>
            </div>

            <div class="ga-editor__row">
              <mat-form-field appearance="outline" class="ga-editor__field">
                <mat-label>XP Reward</mat-label>
                <input matInput type="number" formControlName="xpReward" min="0">
              </mat-form-field>

              <mat-form-field appearance="outline" class="ga-editor__field">
                <mat-label>Est. Duration (min)</mat-label>
                <input matInput type="number" formControlName="estimatedDurationMinutes" min="1">
              </mat-form-field>

              <mat-form-field appearance="outline" class="ga-editor__field">
                <mat-label>Material Icon</mat-label>
                <input matInput formControlName="icon" placeholder="sports_esports">
                <mat-icon matSuffix>{{ form.get('icon')?.value }}</mat-icon>
              </mat-form-field>
            </div>

            <!-- Batch assignment -->
            <div class="ga-card">
              <div class="ga-card__head">
                <mat-icon>groups</mat-icon>
                <div>
                  <h3>Target batches</h3>
                  <p>Assign this game to Journey batches. GlückArena appears for students only when their batch has at least one published game.</p>
                </div>
              </div>
              <mat-form-field appearance="outline" class="ga-editor__field ga-editor__field--full">
                <mat-label>Add batch</mat-label>
                <mat-select [(ngModel)]="batchToAdd" [ngModelOptions]="{standalone: true}" (selectionChange)="onBatchDropdownChange()">
                  <mat-option value="">Select batch…</mat-option>
                  <mat-option *ngFor="let b of batches" [value]="b.batchName">{{ b.batchName }}</mat-option>
                </mat-select>
                <mat-hint>Leave empty to allow all batches.</mat-hint>
              </mat-form-field>
              <div *ngIf="targetBatches.length; else noBatches" class="ga-batch-chips">
                <mat-chip-set>
                  <mat-chip *ngFor="let b of targetBatches" (removed)="removeBatch(b)">
                    {{ b }}
                    <button matChipRemove><mat-icon>cancel</mat-icon></button>
                  </mat-chip>
                </mat-chip-set>
                <button type="button" mat-button (click)="clearBatches()">Clear all</button>
              </div>
              <ng-template #noBatches>
                <p class="ga-batch-empty">No batch selected — visible to <strong>all</strong> batches when published.</p>
              </ng-template>
            </div>

            <!-- Journey gating -->
            <div class="ga-card">
              <div class="ga-card__head">
                <mat-icon>route</mat-icon>
                <div>
                  <h3>Journey &amp; visibility</h3>
                  <p>Course day unlock and publish controls.</p>
                </div>
              </div>
            <div class="ga-editor__row">
              <mat-form-field appearance="outline" class="ga-editor__field">
                <mat-label>Course Day (unlock)</mat-label>
                <input matInput type="number" formControlName="courseDay" min="1">
                <mat-hint>Leave empty for no gating</mat-hint>
              </mat-form-field>

              <div class="ga-toggle-group">
                <mat-slide-toggle formControlName="visibleToStudents" color="primary">
                  Visible to Students
                </mat-slide-toggle>
                <mat-slide-toggle formControlName="isPublished" color="accent">
                  Published
                </mat-slide-toggle>
              </div>
            </div>
            </div>

            <!-- Timer settings -->
            <div class="ga-section-title">Timer Settings</div>
            <div class="ga-editor__row">
              <mat-form-field appearance="outline" class="ga-editor__field">
                <mat-label>Session Limit (sec)</mat-label>
                <input matInput type="number" formControlName="sessionLimitSeconds" min="10">
                <mat-hint>Leave empty for no session timer</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline" class="ga-editor__field">
                <mat-label>Per-Question Limit (sec)</mat-label>
                <input matInput type="number" formControlName="perQuestionSeconds" min="5">
                <mat-hint>Leave empty for no per-question timer</mat-hint>
              </mat-form-field>
            </div>

            <!-- Thumbnail -->
            <div class="ga-section-title">Thumbnail</div>
            <div class="ga-thumb-row">
              <img *ngIf="thumbnailPreview" [src]="thumbnailPreview" class="ga-thumb-preview">
              <button type="button" mat-stroked-button (click)="thumbInput.click()">
                <mat-icon>image</mat-icon> Upload Thumbnail
              </button>
              <input #thumbInput type="file" accept="image/*" style="display:none" (change)="onThumbnailFile($event)">
            </div>

            <div class="ga-editor__actions">
              <button type="button" mat-stroked-button routerLink="/admin/glueck-arena">Cancel</button>
              <button type="submit" mat-raised-button color="primary" [disabled]="saving || form.invalid">
                <mat-icon>save</mat-icon> {{ saving ? 'Saving…' : 'Save Game Set' }}
              </button>
            </div>
          </form>
        </mat-tab>

        <!-- Tab 2: Questions -->
        <mat-tab [label]="questionsLabel" [disabled]="!setId">
          <ng-container [ngSwitch]="form.get('gameType')?.value">
            <app-scramble-question-form
              #scrambleForm
              *ngSwitchCase="'scramble_rush'"
              [gameSetId]="setId!"
            ></app-scramble-question-form>
            <app-sentence-question-form
              #sentenceForm
              *ngSwitchCase="'sentence_builder'"
              [gameSetId]="setId!"
            ></app-sentence-question-form>
            <app-simple-question-form
              #simpleForm
              *ngSwitchCase="['matching', 'flashcards'].includes(form.get('gameType')?.value) ? form.get('gameType')?.value : '___never___'"
              [gameSetId]="setId!"
              [gameType]="form.get('gameType')?.value"
            ></app-simple-question-form>
            <div *ngSwitchDefault class="ga-placeholder-tab">
              <mat-icon>construction</mat-icon>
              <p>Question management for <strong>{{ form.get('gameType')?.value }}</strong> coming soon.</p>
            </div>
          </ng-container>
        </mat-tab>

        <!-- Tab 3: Levels (Scramble Rush only) -->
        <mat-tab label="Levels" [disabled]="!setId || form.get('gameType')?.value !== 'scramble_rush'">
          <app-level-editor *ngIf="setId" [gameSetId]="setId!"></app-level-editor>
        </mat-tab>

        <mat-tab label="Import" [disabled]="!setId">
          <app-game-import-panel 
            *ngIf="setId" 
            [gameSetId]="setId!" 
            [gameType]="form.get('gameType')?.value"
            (imported)="refreshQuestions()"
          ></app-game-import-panel>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .ga-editor { max-width: 900px; margin: 0 auto; padding: 24px; }
    .ga-editor__header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .ga-editor__header h1 { margin: 0; font-size: 22px; font-weight: 600; color: #405980; }
    .ga-editor__form { padding: 24px 0; }
    .ga-editor__row { display: flex; gap: 16px; flex-wrap: wrap; }
    .ga-editor__field { flex: 1; min-width: 180px; }
    .ga-editor__field--wide { flex: 2; }
    .ga-editor__field--full { width: 100%; }
    .ga-section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: #888; margin: 20px 0 8px; }
    .ga-toggle-group { display: flex; flex-direction: column; gap: 12px; justify-content: center; padding: 8px 0; }
    .ga-thumb-row { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
    .ga-thumb-preview { width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid #e0e0e0; }
    .ga-editor__actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; }
    .ga-placeholder-tab { text-align: center; padding: 48px; color: #888; }
    .ga-placeholder-tab mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: .4; display: block; margin: 0 auto 12px; }
    .ga-card {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px;
      padding: 20px 22px; margin: 20px 0;
    }
    .ga-card__head { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 16px; }
    .ga-card__head mat-icon { color: #405980; margin-top: 2px; }
    .ga-card__head h3 { margin: 0 0 4px; font-size: 16px; color: #1e3a5f; }
    .ga-card__head p { margin: 0; font-size: 13px; color: #64748b; line-height: 1.45; }
    .ga-batch-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 8px; }
    .ga-batch-empty { margin: 8px 0 0; font-size: 13px; color: #64748b; }
  `]
})
export class GameSetEditorComponent implements OnInit {
  @ViewChild('scrambleForm') scrambleForm?: ScrambleQuestionFormComponent;
  @ViewChild('sentenceForm') sentenceForm?: SentenceQuestionFormComponent;
  @ViewChild('simpleForm') simpleForm?: SimpleQuestionFormComponent;

  form!: FormGroup;
  isEdit = false;
  setId: string | null = null;
  loading = false;
  saving = false;
  thumbnailPreview: string | null = null;
  pendingThumbnail: File | null = null;
  batches: BatchSummary[] = [];
  batchToAdd = '';
  targetBatches: string[] = [];

  cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  categories = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];

  get questionsLabel(): string {
    const count = this.form.get('questionCount')?.value || 0;
    return `Questions (${count})`;
  }

  constructor(
    private fb: FormBuilder,
    private svc: InteractiveGameService,
    private notify: NotificationService,
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.buildForm();
    void this.loadBatches();
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEdit = true;
      this.setId = id;
      this.loadSet(id);
    }
  }

  refreshQuestions() {
    this.scrambleForm?.load();
    this.sentenceForm?.load();
    this.simpleForm?.load();
    if (this.setId) this.loadSet(this.setId);
  }

  private async loadBatches(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ batches: BatchSummary[] }>(`${environment.apiUrl}/batch-journey`, { withCredentials: true })
      );
      this.batches = (res?.batches || []).sort((a, b) => a.batchName.localeCompare(b.batchName));
    } catch {
      this.batches = [];
    }
  }

  onBatchDropdownChange(): void {
    const v = String(this.batchToAdd || '').trim();
    if (v && !this.targetBatches.includes(v)) {
      this.targetBatches = [...this.targetBatches, v];
    }
    this.batchToAdd = '';
  }

  removeBatch(name: string): void {
    this.targetBatches = this.targetBatches.filter((b) => b !== name);
  }

  clearBatches(): void {
    this.targetBatches = [];
  }

  buildForm() {
    this.form = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      gameType: ['scramble_rush', Validators.required],
      difficulty: ['Beginner', Validators.required],
      level: [''],
      category: ['Vocabulary'],
      xpReward: [50, [Validators.min(0)]],
      estimatedDurationMinutes: [10, [Validators.min(1)]],
      icon: ['sports_esports'],
      visibleToStudents: [false],
      isPublished: [false],
      courseDay: [null],
      sessionLimitSeconds: [null],
      perQuestionSeconds: [null],
      questionCount: [0],
    });
  }

  loadSet(id: string) {
    this.loading = true;
    this.svc.adminGetSet(id).subscribe({
      next: (r) => {
        const s: GameSet = r.set;
        this.form.patchValue({
          ...s,
          sessionLimitSeconds: s.timerSettings?.sessionLimitSeconds ?? null,
          perQuestionSeconds: s.timerSettings?.perQuestionSeconds ?? null,
        });
        this.thumbnailPreview = s.thumbnailUrl || null;
        this.targetBatches = Array.isArray(s.targetBatches) ? [...s.targetBatches] : [];
        this.loading = false;
      },
      error: () => { this.loading = false; this.notify.error('Failed to load game set'); }
    });
  }

  onTypeChange() { /* future: reset questions confirmation */ }

  onThumbnailFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.pendingThumbnail = file;
    const reader = new FileReader();
    reader.onload = ev => this.thumbnailPreview = ev.target?.result as string;
    reader.readAsDataURL(file);
  }

  save() {
    if (this.form.invalid) return;
    this.saving = true;

    const v = this.form.value;
    const payload: any = {
      ...v,
      level: v.level || null,
      courseDay: v.courseDay ? Number(v.courseDay) : null,
      targetBatches: this.targetBatches,
      timerSettings: {
        sessionLimitSeconds: v.sessionLimitSeconds ? Number(v.sessionLimitSeconds) : null,
        perQuestionSeconds: v.perQuestionSeconds ? Number(v.perQuestionSeconds) : null,
      },
    };
    delete payload.sessionLimitSeconds;
    delete payload.perQuestionSeconds;

    const obs = this.isEdit
      ? this.svc.adminUpdateSet(this.setId!, payload)
      : this.svc.adminCreateSet(payload);

    obs.subscribe({
      next: (r) => {
        const savedId = r.set._id;
        this.saving = false;
        this.notify.success(this.isEdit ? 'Game set updated!' : 'Game set created!');

        if (this.pendingThumbnail) {
          this.svc.adminUploadThumbnail(savedId, this.pendingThumbnail).subscribe({
            next: (tr) => { this.thumbnailPreview = tr.thumbnailUrl; this.pendingThumbnail = null; }
          });
        }

        if (!this.isEdit) {
          this.isEdit = true;
          this.setId = savedId;
          this.router.navigate(['/admin/glueck-arena', savedId, 'edit'], { replaceUrl: true });
        }
      },
      error: (err) => { this.saving = false; this.notify.error(err?.error?.message || 'Save failed'); }
    });
  }
}
