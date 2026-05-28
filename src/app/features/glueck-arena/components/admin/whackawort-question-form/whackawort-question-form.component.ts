import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';

@Component({
  selector: 'app-whackawort-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <div class="wwqf">
      <div class="wwqf__toolbar">
        <h3>Whack-a-Wort Words</h3>
        <button mat-raised-button color="primary" (click)="addItem()">
          <mat-icon>add</mat-icon> Add Word
        </button>
      </div>

      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>

      <form [formGroup]="form" (ngSubmit)="save()">
        <div formArrayName="items" class="wwqf__list">
          <mat-card class="wwqf__card" *ngFor="let ctrl of items.controls; let i = index" [formGroupName]="i">
            <mat-card-header>
              <mat-card-title>Word #{{ i + 1 }}</mat-card-title>
              <button type="button" mat-icon-button color="warn" (click)="removeItem(i)">
                <mat-icon>close</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content class="wwqf__content">
              <div class="wwqf__row">
                <mat-form-field appearance="outline" class="wwqf__field">
                  <mat-label>German word *</mat-label>
                  <input matInput formControlName="word" placeholder="Apfel">
                  <mat-error *ngIf="ctrl.get('word')?.hasError('required')">Required</mat-error>
                </mat-form-field>
                <mat-form-field appearance="outline" class="wwqf__field">
                  <mat-label>English translation *</mat-label>
                  <input matInput formControlName="translation" placeholder="apple">
                  <mat-error *ngIf="ctrl.get('translation')?.hasError('required')">Required</mat-error>
                </mat-form-field>
                <mat-form-field appearance="outline" class="wwqf__field">
                  <mat-label>Category *</mat-label>
                  <input matInput formControlName="category" placeholder="Food">
                  <mat-error *ngIf="ctrl.get('category')?.hasError('required')">Required</mat-error>
                </mat-form-field>
              </div>
            </mat-card-content>
          </mat-card>
        </div>
        <div class="wwqf__actions">
          <button type="submit" mat-raised-button color="primary" [disabled]="saving || form.invalid || items.length === 0">
            <mat-icon>save</mat-icon> {{ saving ? 'Saving\u2026' : 'Save Words' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .wwqf { padding: 24px 0; }
    .wwqf__toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .wwqf__toolbar h3 { margin: 0; font-size: 18px; color: #405980; }
    .wwqf__list { display: flex; flex-direction: column; gap: 12px; }
    .wwqf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 4px; }
    .wwqf__content { padding-top: 12px !important; display: flex; flex-direction: column; gap: 8px; }
    .wwqf__row { display: flex; gap: 12px; flex-wrap: wrap; }
    .wwqf__field { flex: 1; min-width: 180px; }
    .wwqf__actions { margin-top: 20px; }
  `]
})
export class WhackawortQuestionFormComponent implements OnInit {
  @Input() gameSetId!: string;

  form!: FormGroup;
  loading = false;
  saving = false;

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

  load() {
    if (!this.gameSetId) return;
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
      translation: [q.translation || '', Validators.required],
      category: [q.category || '', Validators.required],
      order: [q.order ?? this.items.length],
    });
  }

  addItem() { this.items.push(this.makeControl()); }

  removeItem(i: number) { this.items.removeAt(i); }

  save() {
    if (this.form.invalid) return;
    this.saving = true;
    const qs = this.items.value.map((item: any, i: number) => ({
      _id: item._id,
      word: item.word,
      translation: item.translation,
      category: item.category,
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
