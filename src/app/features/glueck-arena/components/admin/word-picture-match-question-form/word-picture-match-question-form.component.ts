import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';
import { trimGermanWord } from '../../../utils/german-text';

function canonicalImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('.amazonaws.com') || u.search) {
      return `${u.origin}${u.pathname}`;
    }
  } catch {}
  return url;
}

const MAX_PAIRS = 6;

@Component({
  selector: 'app-word-picture-match-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, MaterialModule],
  template: `
    <div class="wpm-form">
      <div class="wpm-form__header">
        <h2>Word-Picture Match Questions</h2>
        <p>Each board displays up to {{ MAX_PAIRS }} image cards. Students see a word and click the matching picture.</p>
      </div>

      <div class="wpm-form__actions">
        <button mat-raised-button color="primary" (click)="addQuestion()">
          <mat-icon>add</mat-icon> Add Board
        </button>
        <button mat-raised-button color="accent" (click)="save()" [disabled]="saving || form.invalid">
          <mat-icon>save</mat-icon> {{ saving ? 'Saving...' : 'Save All' }}
        </button>
      </div>

      <div [formGroup]="form">
        <div class="wpm-form__questions" formArrayName="questions">
          <div *ngFor="let questionCtrl of questions.controls; let qIdx = index" [formGroupName]="qIdx" class="wpm-question">
          <div class="wpm-question__header">
            <span class="wpm-question__label">Board {{ qIdx + 1 }}</span>
            <button mat-icon-button color="warn" type="button" (click)="removeQuestion(qIdx)" *ngIf="questions.length > 1">
              <mat-icon>delete</mat-icon>
            </button>
          </div>

          <div class="wpm-question__pairs" formArrayName="pairs">
            <div *ngFor="let pairCtrl of getPairs(qIdx).controls; let pIdx = index" [formGroupName]="pIdx" class="wpm-pair">
              <div class="wpm-pair__header">
                <span class="wpm-pair__label">Pair {{ pIdx + 1 }}</span>
                <button mat-icon-button color="warn" type="button" (click)="removePair(qIdx, pIdx)" *ngIf="getPairs(qIdx).length > 1">
                  <mat-icon>close</mat-icon>
                </button>
              </div>

              <div class="wpm-pair__image">
                <div class="wpm-pair__image-box" (click)="triggerPairUpload(qIdx, pIdx)">
                  <img *ngIf="getPairImageUrl(qIdx, pIdx)" [src]="getPairImageUrl(qIdx, pIdx)" alt="Pair {{ pIdx + 1 }}">
                  <div *ngIf="!getPairImageUrl(qIdx, pIdx)" class="wpm-pair__placeholder">
                    <mat-icon>image</mat-icon>
                    <span>No image</span>
                  </div>
                </div>
                <input #pairFileInputs type="file" accept="image/*" style="display:none"
                  (change)="onPairImageSelect($event, qIdx, pIdx)" [id]="'wpm-pair-file-' + qIdx + '-' + pIdx">
              </div>

              <mat-form-field appearance="outline">
                <mat-label>Word *</mat-label>
                <input matInput formControlName="word" placeholder="e.g., HUND">
              </mat-form-field>
            </div>
          </div>

          <button *ngIf="getPairs(qIdx).length < MAX_PAIRS" mat-stroked-button type="button" (click)="addPair(qIdx)" class="wpm-question__add-pair">
            <mat-icon>add</mat-icon> Add Pair ({{ getPairs(qIdx).length }}/{{ MAX_PAIRS }})
          </button>
        </div>
      </div>

      <div *ngIf="loading" class="wpm-form__loading">
        <mat-spinner diameter="32"></mat-spinner>
        <span>Loading boards...</span>
      </div>
    </div>
  `,
  styles: [`
    .wpm-form { padding: 24px; }
    .wpm-form__header { margin-bottom: 20px; }
    .wpm-form__header h2 { margin: 0 0 8px; font-size: 20px; color: #1e3a5f; }
    .wpm-form__header p { margin: 0; color: #64748b; }
    .wpm-form__actions { display: flex; gap: 12px; margin-bottom: 24px; }
    .wpm-question {
      background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(64, 89, 128, 0.06);
    }
    .wpm-question__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .wpm-question__label { font-weight: 600; color: #1e3a5f; font-size: 16px; }
    .wpm-question__pairs { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .wpm-question__add-pair { margin-top: 16px; width: 100%; }
    .wpm-pair {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;
    }
    .wpm-pair__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .wpm-pair__label { font-weight: 500; color: #475569; font-size: 13px; }
    .wpm-pair__image {
      display: flex; flex-direction: column; align-items: center; gap: 6px; margin-bottom: 8px;
    }
    .wpm-pair__image .wpm-pair__image-box {
      width: 140px; height: 140px; flex-shrink: 0;
      border-radius: 6px; overflow: hidden; cursor: pointer;
    }
    .wpm-pair__image img {
      width: 100%; height: 100%; object-fit: cover;
      border: 1px solid #e2e8f0; background: #f1f5f9;
    }
    .wpm-pair__placeholder {
      width: 100%; height: 100%; display: flex; flex-direction: column;
      align-items: center; justify-content: center; background: #fff; border: 2px dashed #e2e8f0;
      border-radius: 6px; color: #94a3b8; box-sizing: border-box;
    }
    .wpm-pair__placeholder mat-icon { font-size: 28px; width: 28px; height: 28px; }
    .wpm-pair mat-form-field { margin: 0; width: 100%; }
    .wpm-form__loading { display: flex; align-items: center; gap: 12px; padding: 24px; color: #64748b; }
  `]
})
export class WordPictureMatchQuestionFormComponent implements OnInit {
  @Input() gameSetId!: string;
  readonly MAX_PAIRS = MAX_PAIRS;

  form!: FormGroup;
  loading = false;
  saving = false;
  pairImageUrls: (string | null)[][] = [];
  pendingPairImages: (File | null)[][] = [];

  constructor(
    private fb: FormBuilder,
    private svc: InteractiveGameService,
    private notify: NotificationService
  ) {}

  ngOnInit() {
    this.buildForm();
    this.load();
  }

  get questions(): FormArray {
    return this.form.get('questions') as FormArray;
  }

  getPairs(qIdx: number): FormArray {
    return this.questions.at(qIdx).get('pairs') as FormArray;
  }

  buildForm() {
    this.form = this.fb.group({
      questions: this.fb.array([]) as FormArray,
    });
  }

  load() {
    if (!this.gameSetId) {
      this.addQuestion();
      return;
    }
    this.loading = true;
    this.svc.adminGetQuestions(this.gameSetId).subscribe({
      next: (r) => {
        const data = (r.questions || []) as any[];
        this.pairImageUrls = [];
        this.pendingPairImages = [];
        this.questions.clear();

        data.forEach((q: any) => {
          const pairsArray = this.fb.array([]) as FormArray;
          const pairImages: (string | null)[] = [];
          const pendingImages: (File | null)[] = [];

          const rawPairs = q.pairs || [];
          rawPairs.forEach((p: any) => {
            const raw = p.imageUrl || null;
            (pairsArray as FormArray).push(this.fb.group({
              word: [p.word || '', Validators.required],
              _id: [null],
              imageUrl: [canonicalImageUrl(raw)],
            }));
            pairImages.push(raw);
            pendingImages.push(null);
          });

          this.questions.push(this.fb.group({
            _id: [q._id],
            pairs: pairsArray,
          }));
          this.pairImageUrls.push(pairImages);
          this.pendingPairImages.push(pendingImages);
        });

        if (data.length === 0) {
          this.addQuestion();
        }
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.addQuestion();
        this.notify.error('Failed to load questions');
      }
    });
  }

  addQuestion() {
    const pairsArray = this.fb.array([]) as FormArray;
    pairsArray.push(this.createPair());
    this.questions.push(this.fb.group({
      _id: [null],
      pairs: pairsArray,
    }));
    this.pairImageUrls.push([]);
    this.pendingPairImages.push([]);
  }

  removeQuestion(index: number) {
    if (this.questions.length <= 1) return;
    this.questions.removeAt(index);
    this.pairImageUrls.splice(index, 1);
    this.pendingPairImages.splice(index, 1);
  }

  private createPair(word = '', imageUrl: string | null = null) {
    return this.fb.group({
      word: [word, Validators.required],
      _id: [null],
      imageUrl: [imageUrl],
    });
  }

  addPair(qIdx: number) {
    const pairs = this.getPairs(qIdx);
    if (pairs.length >= MAX_PAIRS) return;
    pairs.push(this.createPair());
    this.pairImageUrls[qIdx].push(null);
    this.pendingPairImages[qIdx].push(null);
  }

  removePair(qIdx: number, pIdx: number) {
    const pairs = this.getPairs(qIdx);
    if (pairs.length <= 1) return;
    pairs.removeAt(pIdx);
    this.pairImageUrls[qIdx].splice(pIdx, 1);
    this.pendingPairImages[qIdx].splice(pIdx, 1);
  }

  getPairImageUrl(qIdx: number, pIdx: number): string | null {
    return this.pairImageUrls[qIdx]?.[pIdx] || null;
  }

  triggerPairUpload(qIdx: number, pIdx: number) {
    const el = document.getElementById(`wpm-pair-file-${qIdx}-${pIdx}`) as HTMLInputElement;
    if (el) el.click();
  }

  onPairImageSelect(event: Event, qIdx: number, pIdx: number) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.pendingPairImages[qIdx][pIdx] = file;
    this.pairImageUrls[qIdx][pIdx] = URL.createObjectURL(file);
  }

  save() {
    if (this.form.invalid) {
      this.notify.error('Please fill in all required fields');
      return;
    }
    if (!this.gameSetId) {
      this.notify.error('Save the Game Set first in the Game Details tab');
      return;
    }

    this.saving = true;
    const questions = this.questions.controls.map((qCtrl, qIdx) => {
      const pairs = (qCtrl.value.pairs || []).map((p: any, pIdx: number) => {
        const displayUrl = this.pairImageUrls[qIdx]?.[pIdx];
        const imageUrl = displayUrl && displayUrl.startsWith('blob:')
          ? null
          : (p.imageUrl || null);
        return {
          word: trimGermanWord(p.word || ''),
          imageUrl,
        };
      });
      return {
        _id: qCtrl.value._id,
        order: qIdx,
        pairs,
      };
    });

    this.svc.adminUpsertQuestions(this.gameSetId, questions).subscribe({
      next: async (r) => {
        const savedQuestions = [...(r.questions || [])].sort(
          (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)
        );

        for (let qIdx = 0; qIdx < this.questions.length; qIdx++) {
          const saved = savedQuestions[qIdx];
          const questionId = saved?._id ? String(saved._id) : null;
          if (!questionId) {
            this.saving = false;
            this.notify.error(`Could not save board ${qIdx + 1}. Reload and try again.`);
            return;
          }
          for (let pIdx = 0; pIdx < (this.pendingPairImages[qIdx]?.length || 0); pIdx++) {
            const file = this.pendingPairImages[qIdx]?.[pIdx];
            if (file) {
              const result = await this.uploadPairImage(questionId, qIdx, pIdx, file);
              if (!result.ok) {
                this.saving = false;
                this.notify.error(`Failed to upload image for board ${qIdx + 1}, pair ${pIdx + 1}`);
                return;
              }
            }
          }
        }

        this.saving = false;
        this.notify.success('Boards saved');
        this.load();
      },
      error: () => {
        this.saving = false;
        this.notify.error('Failed to save boards');
      }
    });
  }

  private uploadPairImage(
    questionId: string,
    qIdx: number,
    pairIndex: number,
    file: File
  ): Promise<{ ok: boolean }> {
    return new Promise((resolve) => {
      this.svc.adminUploadPairImage(questionId, pairIndex, file).subscribe({
        next: (r) => {
          const displayUrl = r.url || r.canonicalUrl;
          const storedUrl = canonicalImageUrl(r.canonicalUrl || r.url);
          if (displayUrl) {
            this.pairImageUrls[qIdx][pairIndex] = displayUrl;
          }
          if (storedUrl) {
            this.getPairs(qIdx).at(pairIndex)?.patchValue({ imageUrl: storedUrl });
          }
          this.pendingPairImages[qIdx][pairIndex] = null;
          resolve({ ok: true });
        },
        error: () => {
          resolve({ ok: false });
        },
      });
    });
  }
}
