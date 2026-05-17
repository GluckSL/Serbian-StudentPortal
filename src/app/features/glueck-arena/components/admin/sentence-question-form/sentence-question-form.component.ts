import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';

@Component({
  selector: 'app-sentence-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <div class="spf">
      <div class="spf__toolbar">
        <h3>Sentence Builder Questions</h3>
        <button mat-raised-button color="primary" (click)="addSentence()">
          <mat-icon>add</mat-icon> Add Sentence
        </button>
      </div>

      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>

      <form [formGroup]="form" (ngSubmit)="save()">
        <div formArrayName="sentences" class="spf__list">
          <mat-card class="spf__card" *ngFor="let ctrl of sentences.controls; let i = index" [formGroupName]="i">
            <mat-card-header>
              <mat-card-title>Sentence #{{ i + 1 }}</mat-card-title>
              <button type="button" mat-icon-button color="warn" (click)="removeSentence(i)">
                <mat-icon>close</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content class="spf__content">
              <mat-form-field appearance="outline" class="spf__field--full">
                <mat-label>Correct Sentence *</mat-label>
                <input matInput formControlName="correctSentence" placeholder="Ich esse gern Eier.">
                <mat-error *ngIf="ctrl.get('correctSentence')?.hasError('required')">Required</mat-error>
              </mat-form-field>

              <div class="spf__row">
                <mat-form-field appearance="outline" class="spf__field">
                  <mat-label>Translation (optional)</mat-label>
                  <input matInput formControlName="translation" placeholder="I like to eat eggs.">
                </mat-form-field>

                <div class="spf__toggle">
                  <mat-slide-toggle formControlName="randomizeWords" color="primary">
                    Randomize word order
                  </mat-slide-toggle>
                </div>
              </div>

              <div class="spf__audio" *ngIf="ctrl.get('_id')?.value">
                <button type="button" mat-stroked-button (click)="pickAudio(i)">
                  <mat-icon>record_voice_over</mat-icon> Upload sentence audio
                </button>
                <span *ngIf="ctrl.get('sentenceAudioUrl')?.value" class="spf__audio-ok"><mat-icon>check_circle</mat-icon> Audio set</span>
              </div>

              <!-- Token preview -->
              <div class="spf__preview" *ngIf="getTokens(ctrl)?.length">
                <span class="spf__preview__label">Preview tokens:</span>
                <span class="spf__token" *ngFor="let t of getTokens(ctrl)">{{ t }}</span>
              </div>
            </mat-card-content>
          </mat-card>
        </div>

        <div *ngIf="sentences.length === 0" class="spf__empty">
          No sentences yet. Click "Add Sentence" to start.
        </div>

        <div class="spf__actions">
          <button type="submit" mat-raised-button color="primary" [disabled]="saving || form.invalid || sentences.length === 0">
            <mat-icon>save</mat-icon> {{ saving ? 'Saving…' : 'Save Sentences' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .spf { padding: 24px 0; }
    .spf__toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .spf__toolbar h3 { margin: 0; font-size: 18px; color: #405980; }
    .spf__list { display: flex; flex-direction: column; gap: 12px; }
    .spf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 0; }
    .spf__content { padding-top: 12px !important; display: flex; flex-direction: column; gap: 8px; }
    .spf__row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .spf__field { flex: 1; min-width: 200px; }
    .spf__field--full { width: 100%; }
    .spf__toggle { padding: 4px 0; }
    .spf__preview { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 4px; }
    .spf__preview__label { font-size: 12px; color: #888; margin-right: 4px; }
    .spf__token { background: #e3f2fd; color: #1565c0; padding: 3px 10px; border-radius: 16px; font-size: 13px; font-weight: 500; }
    .spf__empty { text-align: center; padding: 32px; color: #aaa; }
    .spf__actions { display: flex; justify-content: flex-end; margin-top: 20px; }
    .spf__audio { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
    .spf__audio-ok { font-size: 13px; color: #2e7d32; display: flex; align-items: center; gap: 4px; }
  `]
})
export class SentenceQuestionFormComponent implements OnInit {
  @Input() gameSetId!: string;

  form!: FormGroup;
  loading = false;
  saving = false;

  constructor(
    private fb: FormBuilder,
    private svc: InteractiveGameService,
    private notify: NotificationService
  ) {}

  get sentences(): FormArray { return this.form.get('sentences') as FormArray; }

  ngOnInit() {
    this.form = this.fb.group({ sentences: this.fb.array([]) });
    this.load();
  }

  load() {
    if (!this.gameSetId) return;
    this.loading = true;
    this.svc.adminGetQuestions(this.gameSetId).subscribe({
      next: (r) => {
        this.sentences.clear();
        (r.questions || []).forEach((q: any) => this.sentences.push(this.makeControl(q)));
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  makeControl(q: any = {}): FormGroup {
    return this.fb.group({
      _id: [q._id || null],
      correctSentence: [q.correctSentence || '', Validators.required],
      translation: [q.translation || ''],
      randomizeWords: [q.randomizeWords !== false],
      sentenceAudioUrl: [q.sentenceAudioUrl || null],
      order: [q.order ?? this.sentences.length],
    });
  }

  pickAudio(index: number) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = () => {
      const file = input.files?.[0];
      const qid = this.sentences.at(index).get('_id')?.value;
      if (!file || !qid) return;
      this.svc.adminUploadQuestionAudio(qid, file, 'sentence').subscribe({
        next: (r) => {
          this.sentences.at(index).patchValue({ sentenceAudioUrl: r.sentenceAudioUrl || r.url });
          this.notify.success('Sentence audio uploaded');
        },
        error: () => this.notify.error('Audio upload failed'),
      });
    };
    input.click();
  }

  addSentence() { this.sentences.push(this.makeControl()); }

  removeSentence(i: number) { this.sentences.removeAt(i); }

  getTokens(ctrl: any): string[] {
    const sentence: string = ctrl.get('correctSentence')?.value || '';
    return sentence.trim().split(/\s+/).filter(Boolean);
  }

  save() {
    if (this.form.invalid) return;
    this.saving = true;
    const qs = this.sentences.value.map((s: any, i: number) => ({ ...s, order: i }));
    this.svc.adminUpsertQuestions(this.gameSetId, qs).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success('Sentences saved!');
        this.load();
      },
      error: (err) => { this.saving = false; this.notify.error(err?.error?.message || 'Save failed'); }
    });
  }
}
