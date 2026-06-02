import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';

@Component({
  selector: 'app-simple-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <div class="sqf">
      <div class="sqf__notice" *ngIf="!hasGameSetId">
        <mat-icon>info</mat-icon>
        <p>Save <strong>Game Details</strong> first (title, game type, difficulty). Then you can add matching pairs and use Import.</p>
      </div>

      <div class="sqf__toolbar" *ngIf="hasGameSetId">
        <h3>{{ title }}</h3>
        <button mat-raised-button color="primary" (click)="addItem()">
          <mat-icon>add</mat-icon> Add Pair
        </button>
      </div>

      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>

      <form *ngIf="hasGameSetId" [formGroup]="form" (ngSubmit)="save()">
        <div formArrayName="items" class="sqf__list">
          <mat-card class="sqf__card" *ngFor="let ctrl of items.controls; let i = index" [formGroupName]="i">
            <mat-card-header>
              <mat-card-title>Pair #{{ i + 1 }}</mat-card-title>
              <button type="button" mat-icon-button color="warn" (click)="removeItem(i)">
                <mat-icon>close</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content class="sqf__content">
              <div class="sqf__row">
                <mat-form-field appearance="outline" class="sqf__field">
                  <mat-label>{{ leftLabel }} *</mat-label>
                  <input matInput formControlName="word" [placeholder]="leftPlaceholder">
                  <mat-error *ngIf="ctrl.get('word')?.hasError('required')">Required</mat-error>
                </mat-form-field>

                <mat-form-field appearance="outline" class="sqf__field">
                  <mat-label>{{ rightLabel }} *</mat-label>
                  <input matInput formControlName="hint" [placeholder]="rightPlaceholder">
                  <mat-error *ngIf="ctrl.get('hint')?.hasError('required')">Required</mat-error>
                </mat-form-field>
              </div>

              <div class="sqf__audio" *ngIf="ctrl.get('_id')?.value">
                <button type="button" mat-stroked-button (click)="pickAudio(i)">
                  <mat-icon>mic</mat-icon> Upload Audio
                </button>
                <span *ngIf="ctrl.get('audioUrl')?.value" class="sqf__audio-ok">
                  <mat-icon>check_circle</mat-icon> Audio set
                </span>
              </div>
            </mat-card-content>
          </mat-card>
        </div>

        <div *ngIf="items.length === 0" class="sqf__empty">
          No items yet. Click "Add Pair" to start.
        </div>

        <div class="sqf__actions">
          <button type="submit" mat-raised-button color="primary" [disabled]="saving || form.invalid || items.length === 0">
            <mat-icon>save</mat-icon> {{ saving ? 'Saving…' : 'Save Items' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .sqf { padding: 24px 0; }
    .sqf__notice {
      display: flex; gap: 12px; align-items: flex-start;
      background: #e8f4fd; border: 1px solid #90caf9; border-radius: 10px;
      padding: 14px 16px; margin-bottom: 16px; color: #1565c0;
    }
    .sqf__notice mat-icon { flex-shrink: 0; }
    .sqf__notice p { margin: 0; font-size: 14px; line-height: 1.45; }
    .sqf__toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .sqf__toolbar h3 { margin: 0; font-size: 18px; color: #405980; }
    .sqf__list { display: flex; flex-direction: column; gap: 12px; }
    .sqf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 0; }
    .sqf__content { padding-top: 12px !important; display: flex; flex-direction: column; gap: 8px; }
    .sqf__row { display: flex; gap: 12px; flex-wrap: wrap; }
    .sqf__field { flex: 1; min-width: 200px; }
    .sqf__empty { text-align: center; padding: 32px; color: #aaa; }
    .sqf__actions { display: flex; justify-content: flex-end; margin-top: 20px; }
    .sqf__audio { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
    .sqf__audio-ok { font-size: 13px; color: #2e7d32; display: flex; align-items: center; gap: 4px; }
  `]
})
export class SimpleQuestionFormComponent implements OnInit, OnChanges {
  @Input() gameSetId!: string;
  @Input() gameType!: string;

  form!: FormGroup;
  loading = false;
  saving = false;

  get hasGameSetId(): boolean {
    return !!String(this.gameSetId || '').trim();
  }

  get title(): string { return this.gameType === 'matching' ? 'Matching Pairs' : 'Flashcards'; }
  get leftLabel(): string { return this.gameType === 'matching' ? 'Left Item' : 'Front Side'; }
  get rightLabel(): string { return this.gameType === 'matching' ? 'Right Item' : 'Back Side'; }
  get leftPlaceholder(): string { return this.gameType === 'matching' ? 'Hund' : 'Apfel'; }
  get rightPlaceholder(): string { return this.gameType === 'matching' ? 'Dog' : 'Apple'; }

  constructor(
    private fb: FormBuilder,
    private svc: InteractiveGameService,
    private notify: NotificationService
  ) {}

  get items(): FormArray { return this.form.get('items') as FormArray; }

  ngOnInit() {
    this.form = this.fb.group({ items: this.fb.array([]) });
    this.load();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['gameSetId'] && this.form && this.hasGameSetId) {
      this.load();
    }
  }

  load() {
    if (!this.hasGameSetId) return;
    this.loading = true;
    this.svc.adminGetQuestions(this.gameSetId).subscribe({
      next: (r) => {
        this.items.clear();
        (r.questions || []).forEach((q: any) => this.items.push(this.makeControl(q)));
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  makeControl(q: any = {}): FormGroup {
    return this.fb.group({
      _id: [q._id || null],
      word: [q.word || '', Validators.required],
      hint: [q.hint || '', Validators.required],
      audioUrl: [q.audioUrl || null],
      order: [q.order ?? this.items.length],
    });
  }

  pickAudio(index: number) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = () => {
      const file = input.files?.[0];
      const qid = this.items.at(index).get('_id')?.value;
      if (!file || !qid) return;
      this.svc.adminUploadQuestionAudio(qid, file, 'word').subscribe({
        next: (r) => {
          this.items.at(index).patchValue({ audioUrl: r.audioUrl || r.url });
          this.notify.success('Audio uploaded');
        },
        error: () => this.notify.error('Audio upload failed'),
      });
    };
    input.click();
  }

  addItem() { this.items.push(this.makeControl()); }
  removeItem(i: number) { this.items.removeAt(i); }

  save() {
    if (!this.hasGameSetId) {
      this.notify.error('Save Game Details first, then add questions.');
      return;
    }
    if (this.form.invalid) return;
    this.saving = true;
    const qs = this.items.value.map((item: any, i: number) => ({ ...item, order: i }));
    this.svc.adminUpsertQuestions(this.gameSetId, qs).subscribe({
      next: (res) => {
        this.saving = false;
        this.notify.success('Items saved!');
        if (res?.questions?.length) {
          this.items.clear();
          res.questions.forEach((q: any) => this.items.push(this.makeControl(q)));
        } else {
          this.load();
        }
      },
      error: (err) => {
        this.saving = false;
        const msg = err?.error?.message || err?.error?.error || 'Save failed';
        this.notify.error(msg);
      }
    });
  }
}
