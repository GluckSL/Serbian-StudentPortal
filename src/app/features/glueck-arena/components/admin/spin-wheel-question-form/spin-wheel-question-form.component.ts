import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';

@Component({
  selector: 'app-spin-wheel-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <div class="swf">
      <div class="swf__intro">
        <mat-icon>casino</mat-icon>
        <div>
          <h3>Spin Wheel segments</h3>
          <p>Add German sentence fragments or phrases — each becomes one wedge on the wheel. Students spin, then choose <strong>Eliminate</strong> to remove a phrase or <strong>Resume</strong> to keep it.</p>
        </div>
      </div>

      <div class="swf__notice" *ngIf="!hasGameSetId">
        <mat-icon>info</mat-icon>
        <p>Save <strong>Game Details</strong> first, then add wheel segments here.</p>
      </div>

      <div class="swf__toolbar" *ngIf="hasGameSetId">
        <button mat-raised-button color="primary" type="button" (click)="addSegment()">
          <mat-icon>add</mat-icon> Add segment
        </button>
      </div>

      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>

      <form *ngIf="hasGameSetId" [formGroup]="form" (ngSubmit)="save()">
        <div formArrayName="segments" class="swf__list">
          <mat-card class="swf__card" *ngFor="let ctrl of segments.controls; let i = index" [formGroupName]="i">
            <mat-card-header>
              <mat-card-title>Segment #{{ i + 1 }}</mat-card-title>
              <button type="button" mat-icon-button color="warn" (click)="removeSegment(i)">
                <mat-icon>close</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content>
              <mat-form-field appearance="outline" class="swf__field">
                <mat-label>Phrase on wheel *</mat-label>
                <textarea matInput formControlName="phrase" rows="2"
                  placeholder="e.g. What is your name?? — press Enter to split lines"></textarea>
                <mat-error *ngIf="ctrl.get('phrase')?.hasError('required')">Required</mat-error>
              </mat-form-field>
            </mat-card-content>
          </mat-card>
        </div>

        <div *ngIf="segments.length === 0" class="swf__empty">
          No segments yet. Add at least 2 phrases for a playable wheel.
        </div>

        <div class="swf__actions">
          <button type="submit" mat-raised-button color="primary"
            [disabled]="saving || form.invalid || segments.length < 2">
            <mat-icon>save</mat-icon> {{ saving ? 'Saving…' : 'Save segments' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .swf { padding: 24px 0; }
    .swf__intro {
      display: flex; gap: 16px; align-items: flex-start;
      margin-bottom: 20px; padding: 16px 20px;
      background: linear-gradient(135deg, #e0e7ff, #eef2ff);
      border-radius: 16px; border: 1px solid #c7d2fe;
    }
    .swf__intro mat-icon { color: #4f46e5; font-size: 36px; width: 36px; height: 36px; flex-shrink: 0; }
    .swf__intro h3 { margin: 0 0 6px; font-size: 18px; color: #312e81; }
    .swf__intro p { margin: 0; font-size: 14px; color: #475569; line-height: 1.5; }
    .swf__notice {
      display: flex; gap: 12px; padding: 14px; background: #e8f4fd; border-radius: 10px;
      border: 1px solid #90caf9; margin-bottom: 16px;
    }
    .swf__toolbar { display: flex; justify-content: flex-end; margin-bottom: 16px; }
    .swf__list { display: flex; flex-direction: column; gap: 12px; }
    .swf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; }
    .swf__field { width: 100%; }
    .swf__empty { text-align: center; padding: 32px; color: #94a3b8; }
    .swf__actions { display: flex; justify-content: flex-end; margin-top: 20px; }
  `],
})
export class SpinWheelQuestionFormComponent implements OnInit, OnChanges {
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

  get segments(): FormArray {
    return this.form.get('segments') as FormArray;
  }

  ngOnInit(): void {
    this.form = this.fb.group({ segments: this.fb.array([]) });
    this.load();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['gameSetId'] && !changes['gameSetId'].firstChange && this.form) {
      this.load();
    }
  }

  addSegment(): void {
    this.segments.push(this.fb.group({
      _id: [''],
      phrase: ['', Validators.required],
      order: [this.segments.length],
    }));
  }

  removeSegment(i: number): void {
    this.segments.removeAt(i);
  }

  load(): void {
    if (!this.gameSetId) return;
    this.loading = true;
    this.svc.adminGetQuestions(this.gameSetId).subscribe({
      next: (r) => {
        this.segments.clear();
        const qs = (r.questions || []).sort((a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0));
        for (const q of qs) {
          this.segments.push(this.fb.group({
            _id: [q._id || ''],
            phrase: [(q as { hint?: string }).hint || '', Validators.required],
            order: [q.order ?? 0],
          }));
        }
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error('Failed to load segments');
      },
    });
  }

  save(): void {
    if (!this.gameSetId || this.form.invalid || this.segments.length < 2) return;
    this.saving = true;
    const questions = this.segments.controls.map((ctrl, i) => {
      const v = ctrl.value;
      return {
        _id: v._id || undefined,
        order: i,
        hint: String(v.phrase || '').trim(),
      };
    });
    this.svc.adminUpsertQuestions(this.gameSetId, questions).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success('Wheel segments saved');
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err?.error?.message || 'Save failed');
      },
    });
  }
}
