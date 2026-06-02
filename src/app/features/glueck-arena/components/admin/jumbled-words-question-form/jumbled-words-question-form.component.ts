import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, FormGroup, Validators } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';
import { germanUppercase } from '../../../utils/german-text';

function canonicalImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('.amazonaws.com') || u.search) {
      return `${u.origin}${u.pathname}`;
    }
  } catch { }
  return url;
}

@Component({
  selector: 'app-jumbled-words-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <div class="jwqf">
      <div class="jwqf__intro">
        <mat-icon>palette</mat-icon>
        <div>
          <h3>Jumbled Words</h3>
          <p>Enter the German word and its hint (English translation). The word will be scrambled in-game and paired with an image.</p>
        </div>
      </div>

      <div class="jwqf__toolbar">
        <button mat-raised-button color="primary" (click)="addWord()">
          <mat-icon>add</mat-icon> Add Word
        </button>
      </div>

      <mat-progress-bar *ngIf="loading || saving" mode="indeterminate"></mat-progress-bar>

      <form [formGroup]="form" (ngSubmit)="save()">
        <div formArrayName="words" class="jwqf__list">
          <mat-card class="jwqf__card" *ngFor="let ctrl of words.controls; let i = index" [formGroupName]="i">
            <mat-card-header>
              <mat-card-title>Word #{{ i + 1 }}</mat-card-title>
              <button type="button" mat-icon-button color="warn" (click)="removeWord(i)">
                <mat-icon>close</mat-icon>
              </button>
            </mat-card-header>
            <mat-card-content>
              <div class="jwqf__row">
                <mat-form-field appearance="outline" class="jwqf__field jwqf__field--word">
                  <mat-label>German word *</mat-label>
                  <input matInput formControlName="word" class="jwqf__word-input" placeholder="HAUS">
                  <mat-hint>Uppercase German word</mat-hint>
                  <mat-error *ngIf="ctrl.get('word')?.hasError('required')">Required</mat-error>
                </mat-form-field>

                <mat-form-field appearance="outline" class="jwqf__field">
                  <mat-label>Hint (translation)</mat-label>
                  <input matInput formControlName="hint" placeholder="house">
                </mat-form-field>
              </div>

              <div class="jwqf__image-section">
                <div class="jwqf__image-preview" *ngIf="imageDisplayUrls[i]">
                  <img [src]="imageDisplayUrls[i]" alt="Word image">
                </div>
                <div *ngIf="!imageDisplayUrls[i]" class="jwqf__image-placeholder">
                  <mat-icon>image</mat-icon>
                  <span>No image</span>
                </div>
                <button mat-stroked-button type="button" (click)="triggerUpload(i)">
                  <mat-icon>upload</mat-icon> {{ imageDisplayUrls[i] ? 'Change' : 'Upload' }} Image
                </button>
                <input #fileInputs type="file" accept="image/*" style="display:none"
                  (change)="onImageSelect($event, i)" [id]="'jw-file-' + i">
              </div>
            </mat-card-content>
          </mat-card>
        </div>

        <div *ngIf="words.length === 0" class="jwqf__empty">
          No words yet. Click "Add Word" to start.
        </div>

        <div class="jwqf__actions">
          <button type="submit" mat-raised-button color="primary" [disabled]="saving || form.invalid || words.length === 0">
            <mat-icon>save</mat-icon> {{ saving ? 'Saving\u2026' : 'Save Words' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .jwqf { padding: 24px 0; }
    .jwqf__intro {
      display: flex; gap: 16px; align-items: flex-start;
      margin-bottom: 20px; padding: 16px 20px;
      background: linear-gradient(135deg, #f3e8ff, #ede9fe);
      border-radius: 16px; border: 1px solid #c4b5fd;
    }
    .jwqf__intro mat-icon { color: #7c3aed; font-size: 36px; width: 36px; height: 36px; flex-shrink: 0; }
    .jwqf__intro h3 { margin: 0 0 6px; font-size: 18px; color: #405980; }
    .jwqf__intro p { margin: 0; font-size: 14px; color: #666; }
    .jwqf__intro code { background: #e4d5f7; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
    .jwqf__toolbar { display: flex; justify-content: flex-end; margin-bottom: 16px; }
    .jwqf__list { display: flex; flex-direction: column; gap: 12px; }
    .jwqf__card mat-card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 0; }
    .jwqf__card mat-card-title { font-size: 14px; font-weight: 600; }
    .jwqf__row { display: flex; gap: 12px; flex-wrap: wrap; padding-top: 8px; }
    .jwqf__field { flex: 1; min-width: 150px; }
    .jwqf__field--word { font-weight: 600; }
    .jwqf__word-input { text-transform: uppercase; }
    .jwqf__image-section { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
    .jwqf__image-preview img { max-width: 120px; max-height: 80px; border-radius: 6px; object-fit: cover; border: 1px solid #e0d4f5; }
    .jwqf__image-placeholder { display: flex; flex-direction: column; align-items: center; gap: 2px; color: #ccc; width: 80px; }
    .jwqf__image-placeholder mat-icon { font-size: 32px; width: 32px; height: 32px; }
    .jwqf__image-placeholder span { font-size: 11px; }
    .jwqf__empty { text-align: center; padding: 32px; color: #aaa; }
    .jwqf__actions { display: flex; justify-content: flex-end; margin-top: 20px; }
  `]
})
export class JumbledWordsQuestionFormComponent implements OnInit, OnChanges {
  @Input() gameSetId!: string;

  form!: FormGroup;
  loading = false;
  saving = false;
  imageDisplayUrls: (string | null)[] = [];
  pendingImages: (File | null)[] = [];

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

  load() {
    if (!this.gameSetId) return;
    this.loading = true;
    this.svc.adminGetQuestions(this.gameSetId).subscribe({
      next: (r) => {
        this.words.clear();
        this.imageDisplayUrls = [];
        this.pendingImages = [];
        (r.questions || []).forEach((q: any) => {
          this.words.push(this.makeControl(q));
          this.imageDisplayUrls.push(q.imageUrl || null);
          this.pendingImages.push(null);
        });
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
      imageUrl: [canonicalImageUrl(q.imageUrl || null)],
      order: [q.order ?? this.words.length],
    });
  }

  triggerUpload(index: number) {
    const el = document.getElementById(`jw-file-${index}`) as HTMLInputElement;
    if (el) el.click();
  }

  onImageSelect(event: Event, index: number) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.pendingImages[index] = file;
    this.imageDisplayUrls[index] = URL.createObjectURL(file);
  }

  addWord() {
    this.words.push(this.makeControl());
    this.imageDisplayUrls.push(null);
    this.pendingImages.push(null);
  }

  removeWord(i: number) {
    this.words.removeAt(i);
    this.imageDisplayUrls.splice(i, 1);
    this.pendingImages.splice(i, 1);
  }

  save() {
    if (this.form.invalid) return;
    this.saving = true;
    const qs = this.words.value.map((item: any, i: number) => {
      const displayUrl = this.imageDisplayUrls[i];
      const imageUrl = displayUrl && displayUrl.startsWith('blob:')
        ? null
        : (item.imageUrl || null);
      return {
        _id: item._id,
        word: item.word,
        hint: item.hint,
        imageUrl,
        order: i,
      };
    });
    this.svc.adminUpsertQuestions(this.gameSetId, qs).subscribe({
      next: async (r) => {
        const savedQuestions = r.questions || [];
        const idMap = new Map<string, { _id: string }>(
          savedQuestions.map((q: any) => [String(q.order), q])
        );

        for (let i = 0; i < this.words.length; i++) {
          const saved = idMap.get(String(i));
          if (!saved?._id) continue;
          const file = this.pendingImages[i];
          if (file) {
            const ok = await this.uploadImage(saved._id, i, file);
            if (!ok) {
              this.saving = false;
              this.notify.error(`Failed to upload image for word ${i + 1}`);
              return;
            }
          }
        }

        this.saving = false;
        this.notify.success('Words saved!');
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err?.error?.message || 'Save failed');
      }
    });
  }

  private uploadImage(questionId: string, index: number, file: File): Promise<boolean> {
    return new Promise((resolve) => {
      this.svc.adminUploadQuestionImage(questionId, file).subscribe({
        next: (r) => {
          const displayUrl = r.url || r.canonicalUrl;
          const storedUrl = canonicalImageUrl(r.canonicalUrl || r.url);
          if (displayUrl) this.imageDisplayUrls[index] = displayUrl;
          if (storedUrl) {
            this.words.at(index)?.patchValue({ imageUrl: storedUrl });
          }
          this.pendingImages[index] = null;
          resolve(true);
        },
        error: () => resolve(false),
      });
    });
  }
}
