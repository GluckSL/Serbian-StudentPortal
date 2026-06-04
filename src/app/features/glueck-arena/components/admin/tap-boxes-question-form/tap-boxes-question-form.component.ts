import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';

@Component({
  selector: 'app-tap-boxes-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <div class="tbf">
      <div class="tbf__intro">
        <mat-icon>grid_view</mat-icon>
        <div>
          <h3>Mystery boxes</h3>
          <p>Add German phrases — each becomes one numbered box. Students tap a box to zoom in and reveal the hidden text (like Wordwall “Boxes”).</p>
        </div>
      </div>

      <div class="tbf__notice" *ngIf="!hasGameSetId">
        <mat-icon>info</mat-icon>
        <p>Save <strong>Game Details</strong> first, then add box content here.</p>
      </div>

      <div class="tbf__toolbar" *ngIf="hasGameSetId">
        <button mat-raised-button color="primary" type="button" (click)="addBox()">
          <mat-icon>add</mat-icon> Add box
        </button>
      </div>

      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>

      <form *ngIf="hasGameSetId" [formGroup]="form" (ngSubmit)="save()">
        <div formArrayName="boxes" class="tbf__list">
          <mat-card class="tbf__card" *ngFor="let ctrl of boxes.controls; let i = index" [formGroupName]="i">
            <mat-card-header>
              <mat-card-title>Box #{{ i + 1 }}</mat-card-title>
              <button type="button" mat-icon-button color="warn" (click)="removeBox(i)">
                <mat-icon>close</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content>
              <mat-form-field appearance="outline" class="tbf__field">
                <mat-label>Hidden phrase *</mat-label>
                <textarea matInput formControlName="phrase" rows="2"
                  placeholder="e.g. jeden Tag Sport machen"></textarea>
                <mat-error *ngIf="ctrl.get('phrase')?.hasError('required')">Required</mat-error>
              </mat-form-field>
            </mat-card-content>
          </mat-card>
        </div>

        <div *ngIf="boxes.length === 0" class="tbf__empty">
          No boxes yet. Add at least 2 phrases for a playable grid.
        </div>

        <div class="tbf__actions">
          <button type="submit" mat-raised-button color="primary"
            [disabled]="saving || form.invalid || boxes.length < 2">
            <mat-icon>save</mat-icon> {{ saving ? 'Saving…' : 'Save boxes' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .tbf { padding: 24px 0; }
    .tbf__intro {
      display: flex; gap: 16px; align-items: flex-start;
      margin-bottom: 20px; padding: 16px 20px;
      background: linear-gradient(135deg, #ccfbf1, #ecfeff);
      border-radius: 16px; border: 1px solid #99f6e4;
    }
    .tbf__intro mat-icon { color: #0d9488; font-size: 36px; width: 36px; height: 36px; flex-shrink: 0; }
    .tbf__intro h3 { margin: 0 0 6px; font-size: 18px; color: #134e4a; }
    .tbf__intro p { margin: 0; font-size: 14px; color: #475569; line-height: 1.5; }
    .tbf__notice {
      display: flex; gap: 12px; padding: 14px; background: #e8f4fd; border-radius: 10px;
      border: 1px solid #90caf9; margin-bottom: 16px;
    }
    .tbf__toolbar { display: flex; justify-content: flex-end; margin-bottom: 16px; }
    .tbf__list { display: flex; flex-direction: column; gap: 12px; }
    .tbf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; }
    .tbf__field { width: 100%; }
    .tbf__empty { text-align: center; padding: 32px; color: #94a3b8; }
    .tbf__actions { display: flex; justify-content: flex-end; margin-top: 20px; }
  `],
})
export class TapBoxesQuestionFormComponent implements OnInit, OnChanges {
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

  get boxes(): FormArray {
    return this.form.get('boxes') as FormArray;
  }

  ngOnInit(): void {
    this.form = this.fb.group({ boxes: this.fb.array([]) });
    this.load();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['gameSetId'] && !changes['gameSetId'].firstChange && this.form) {
      this.load();
    }
  }

  addBox(): void {
    this.boxes.push(this.fb.group({
      _id: [''],
      phrase: ['', Validators.required],
      order: [this.boxes.length],
    }));
  }

  removeBox(i: number): void {
    this.boxes.removeAt(i);
  }

  load(): void {
    if (!this.gameSetId) return;
    this.loading = true;
    this.svc.adminGetQuestions(this.gameSetId).subscribe({
      next: (r) => {
        this.boxes.clear();
        const qs = (r.questions || []).sort((a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0));
        for (const q of qs) {
          this.boxes.push(this.fb.group({
            _id: [q._id || ''],
            phrase: [(q as { hint?: string; phrase?: string }).phrase || (q as { hint?: string }).hint || '', Validators.required],
            order: [q.order ?? 0],
          }));
        }
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error('Failed to load boxes');
      },
    });
  }

  save(): void {
    if (!this.gameSetId || this.form.invalid || this.boxes.length < 2) return;
    this.saving = true;
    const questions = this.boxes.controls.map((ctrl, i) => {
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
        this.notify.success('Boxes saved');
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err?.error?.message || 'Save failed');
      },
    });
  }
}
