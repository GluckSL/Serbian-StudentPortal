import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';

@Component({
  selector: 'app-multiple-choice-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <div class="mcqf">
      <div class="mcqf__intro">
        <mat-icon>quiz</mat-icon>
        <div>
          <h3>Multiple-Choice Questions</h3>
          <p>Enter the question text and provide 2–6 answer options. Mark exactly one option as correct. An optional timer can be set in the Game Details tab.</p>
        </div>
      </div>

      <div class="mcqf__toolbar">
        <button mat-raised-button color="primary" (click)="addQuestion()">
          <mat-icon>add</mat-icon> Add Question
        </button>
      </div>

      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>

      <form [formGroup]="form" (ngSubmit)="save()">
        <div formArrayName="questions" class="mcqf__list">
          <mat-card class="mcqf__card" *ngFor="let ctrl of questions.controls; let i = index" [formGroupName]="i">
            <mat-card-header>
              <mat-card-title>Question #{{ i + 1 }}</mat-card-title>
              <button type="button" mat-icon-button color="warn" (click)="removeQuestion(i)">
                <mat-icon>close</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content>
              <div class="mcqf__row">
                <mat-form-field appearance="outline" class="mcqf__field mcqf__field--wide">
                  <mat-label>Question text *</mat-label>
                  <input matInput formControlName="questionText" placeholder="Wie lautet der Imperativ von 'essen'?">
                  <mat-error *ngIf="ctrl.get('questionText')?.hasError('required')">Required</mat-error>
                </mat-form-field>
              </div>

              <div class="mcqf__options-label">Answer Options</div>
              <div formArrayName="options" class="mcqf__options">
                <div class="mcqf__option" *ngFor="let opt of getOptions(i).controls; let j = index" [formGroupName]="j">
                  <button type="button" class="mcqf__correct-btn"
                    [class.mcqf__correct-btn--active]="ctrl.get('correctOption')?.value === j"
                    (click)="ctrl.get('correctOption')?.setValue(j)"
                    title="Mark as correct answer">
                    <mat-icon>{{ ctrl.get('correctOption')?.value === j ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
                  </button>
                  <mat-form-field appearance="outline" class="mcqf__field">
                    <mat-label>Option {{ j + 1 }} *</mat-label>
                    <input matInput formControlName="text" placeholder="iss!">
                    <mat-error *ngIf="opt.get('text')?.hasError('required')">Required</mat-error>
                  </mat-form-field>
                  <button type="button" mat-icon-button color="warn" size="small"
                    (click)="removeOption(i, j)" *ngIf="getOptions(i).length > 2">
                    <mat-icon>remove_circle</mat-icon>
                  </button>
                </div>
              </div>
              <button type="button" mat-stroked-button size="small" (click)="addOption(i)"
                *ngIf="getOptions(i).length < 6">
                <mat-icon>add</mat-icon> Add Option
              </button>
            </mat-card-content>
          </mat-card>
        </div>

        <div *ngIf="questions.length === 0" class="mcqf__empty">
          No questions yet. Click "Add Question" to start.
        </div>

        <div class="mcqf__actions">
          <button type="submit" mat-raised-button color="primary" [disabled]="saving || form.invalid || questions.length === 0">
            <mat-icon>save</mat-icon> {{ saving ? 'Saving\u2026' : 'Save Questions' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .mcqf { padding: 24px 0; }
    .mcqf__intro {
      display: flex; gap: 16px; align-items: flex-start;
      margin-bottom: 20px; padding: 16px 20px;
      background: linear-gradient(135deg, #e0f2fe, #f0f9ff);
      border-radius: 16px; border: 1px solid #bae6fd;
    }
    .mcqf__intro mat-icon { color: #0284c7; font-size: 36px; width: 36px; height: 36px; flex-shrink: 0; }
    .mcqf__intro h3 { margin: 0 0 6px; font-size: 18px; color: #405980; }
    .mcqf__intro p { margin: 0; font-size: 14px; color: #666; }
    .mcqf__toolbar { display: flex; justify-content: flex-end; margin-bottom: 16px; }
    .mcqf__list { display: flex; flex-direction: column; gap: 12px; }
    .mcqf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 0; }
    .mcqf__card mat-card-title { font-size: 14px; font-weight: 600; }
    .mcqf__row { display: flex; gap: 12px; flex-wrap: wrap; padding-top: 8px; }
    .mcqf__field { flex: 1; min-width: 150px; }
    .mcqf__field--wide { min-width: 300px; }
    .mcqf__options-label { font-size: 13px; font-weight: 600; color: #888; margin: 16px 0 8px; text-transform: uppercase; letter-spacing: .5px; }
    .mcqf__options { display: flex; flex-direction: column; gap: 8px; }
    .mcqf__option { display: flex; align-items: center; gap: 8px; }
    .mcqf__correct-btn {
      background: none; border: none; cursor: pointer; padding: 0;
      display: flex; align-items: center; color: #94a3b8; flex-shrink: 0;
      transition: color 0.15s;
    }
    .mcqf__correct-btn:hover { color: #64748b; }
    .mcqf__correct-btn--active { color: #22c55e; }
    .mcqf__correct-btn--active:hover { color: #16a34a; }
    .mcqf__correct-btn mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .mcqf__empty { text-align: center; padding: 32px; color: #aaa; }
    .mcqf__actions { display: flex; justify-content: flex-end; margin-top: 20px; }
  `]
})
export class MultipleChoiceQuestionFormComponent implements OnInit, OnChanges {
  @Input() gameSetId!: string;

  form!: FormGroup;
  loading = false;
  saving = false;

  constructor(
    private fb: FormBuilder,
    private svc: InteractiveGameService,
    private notify: NotificationService
  ) {}

  get questions(): FormArray { return this.form.get('questions') as FormArray; }

  ngOnInit() {
    this.form = this.fb.group({ questions: this.fb.array([]) });
    this.load();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['gameSetId'] && !changes['gameSetId'].firstChange && this.form) {
      this.load();
    }
  }

  load() {
    if (!this.gameSetId) return;
    this.loading = true;
    this.svc.adminGetQuestions(this.gameSetId).subscribe({
      next: (r) => {
        this.questions.clear();
        (r.questions || []).forEach((q: any) => {
          this.questions.push(this.makeControl(q));
        });
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  makeControl(q: any = {}): FormGroup {
    const correctIdx = (q.options || []).findIndex((o: any) => o.isCorrect);
    const optionsArray = this.fb.array(
      (q.options && q.options.length ? q.options : [{ text: '' }, { text: '' }]).map((o: any) =>
        this.fb.group({ text: [o.text || '', Validators.required] })
      )
    );
    return this.fb.group({
      _id: [q._id || null],
      questionText: [q.questionText || '', Validators.required],
      order: [q.order ?? this.questions.length],
      options: optionsArray,
      correctOption: [correctIdx >= 0 ? correctIdx : 0],
    });
  }

  getOptions(qIndex: number): FormArray {
    return this.questions.at(qIndex).get('options') as FormArray;
  }

  addOption(qIndex: number) {
    const options = this.getOptions(qIndex);
    if (options.length >= 6) return;
    options.push(this.fb.group({ text: ['', Validators.required] }));
  }

  removeOption(qIndex: number, optIndex: number) {
    const options = this.getOptions(qIndex);
    if (options.length <= 2) return;
    options.removeAt(optIndex);
    const ctrl = this.questions.at(qIndex).get('correctOption');
    if (ctrl) {
      if (ctrl.value === optIndex) {
        ctrl.setValue(0);
      } else if (ctrl.value > optIndex) {
        ctrl.setValue(ctrl.value - 1);
      }
    }
  }

  addQuestion() {
    this.questions.push(this.makeControl());
  }

  removeQuestion(i: number) {
    this.questions.removeAt(i);
  }

  save() {
    if (this.form.invalid) return;
    this.saving = true;
    const qs = this.questions.value.map((item: any, i: number) => {
      const options = item.options.map((o: any, j: number) => ({
        text: o.text,
        isCorrect: j === item.correctOption,
      }));
      return {
        _id: item._id,
        questionText: item.questionText,
        options,
        order: i,
      };
    });
    this.svc.adminUpsertQuestions(this.gameSetId, qs).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success('Questions saved!');
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err?.error?.message || 'Save failed');
      }
    });
  }
}
