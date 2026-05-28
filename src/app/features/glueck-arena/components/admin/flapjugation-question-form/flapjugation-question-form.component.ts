import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';

@Component({
  selector: 'app-flapjugation-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <div class="fjqf">
      <div class="fjqf__toolbar">
        <h3>Flapjugation Verbs</h3>
        <button mat-raised-button color="primary" (click)="addItem()">
          <mat-icon>add</mat-icon> Add Verb
        </button>
      </div>

      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>

      <form [formGroup]="form" (ngSubmit)="save()">
        <div formArrayName="items" class="fjqf__list">
          <mat-card class="fjqf__card" *ngFor="let ctrl of items.controls; let i = index" [formGroupName]="i">
            <mat-card-header>
              <mat-card-title>Verb #{{ i + 1 }}</mat-card-title>
              <button type="button" mat-icon-button color="warn" (click)="removeItem(i)">
                <mat-icon>close</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content class="fjqf__content">
              <div class="fjqf__row">
                <mat-form-field appearance="outline" class="fjqf__field fjqf__field--wide">
                  <mat-label>Infinitive *</mat-label>
                  <input matInput formControlName="word" placeholder="spielen">
                  <mat-error *ngIf="ctrl.get('word')?.hasError('required')">Required</mat-error>
                </mat-form-field>
                <mat-form-field appearance="outline" class="fjqf__field fjqf__field--wide">
                  <mat-label>Translation *</mat-label>
                  <input matInput formControlName="translation" placeholder="to play">
                  <mat-error *ngIf="ctrl.get('translation')?.hasError('required')">Required</mat-error>
                </mat-form-field>
              </div>
              <div class="fjqf__pronouns" formArrayName="tokens">
                <div class="fjqf__pronoun" *ngFor="let pCtrl of getPronounCtrls(i); let pIdx = index" [formGroupName]="pIdx">
                  <span class="fjqf__pronoun-label">{{ PRONOUNS[pIdx] }}</span>
                  <mat-form-field appearance="outline" class="fjqf__pronoun-field">
                    <input matInput formControlName="value" [placeholder]="PRONOUN_EXAMPLES[pIdx]">
                  </mat-form-field>
                </div>
              </div>
            </mat-card-content>
          </mat-card>
        </div>
        <div class="fjqf__actions">
          <button type="submit" mat-raised-button color="primary" [disabled]="saving || form.invalid || items.length === 0">
            <mat-icon>save</mat-icon> {{ saving ? 'Saving…' : 'Save Verbs' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .fjqf { padding: 24px 0; }
    .fjqf__toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .fjqf__toolbar h3 { margin: 0; font-size: 18px; color: #405980; }
    .fjqf__list { display: flex; flex-direction: column; gap: 12px; }
    .fjqf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 4px; }
    .fjqf__content { padding-top: 12px !important; display: flex; flex-direction: column; gap: 8px; }
    .fjqf__row { display: flex; gap: 12px; flex-wrap: wrap; }
    .fjqf__field { flex: 1; min-width: 200px; }
    .fjqf__field--wide { flex: 2; }
    .fjqf__pronouns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; padding: 12px; background: #f8faff; border-radius: 8px; border: 1px solid #e2e8f0; }
    .fjqf__pronoun { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 160px; }
    .fjqf__pronoun-label { font-weight: 600; font-size: 13px; color: #475569; min-width: 60px; }
    .fjqf__pronoun-field { flex: 1; }
    .fjqf__actions { margin-top: 20px; }
  `]
})
export class FlapjugationQuestionFormComponent implements OnInit {
  @Input() gameSetId!: string;

  readonly PRONOUNS = ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'Sie'];
  readonly PRONOUN_EXAMPLES = ['spiele', 'spielst', 'spielt', 'spielen', 'spielt', 'spielen'];

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
    const tokensArray = this.fb.array(
      (q.tokens && q.tokens.length === 6 ? q.tokens : ['', '', '', '', '', '']).map(
        (v: string) => this.fb.group({ value: [v, Validators.required] })
      )
    );
    return this.fb.group({
      _id: [q._id || null],
      word: [q.word || '', Validators.required],
      translation: [q.translation || '', Validators.required],
      tokens: tokensArray,
      order: [q.order ?? this.items.length],
    });
  }

  getPronounCtrls(itemIndex: number): FormGroup[] {
    return (this.items.at(itemIndex).get('tokens') as FormArray).controls as FormGroup[];
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
      tokens: item.tokens.map((t: any) => t.value),
      order: i,
    }));
    this.svc.adminUpsertQuestions(this.gameSetId, qs).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success('Verbs saved!');
        this.load();
      },
      error: (err) => { this.saving = false; this.notify.error(err?.error?.message || 'Save failed'); }
    });
  }
}
