import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';
import { AdminImageMatchingQuestion } from '../../../glueck-arena.types';

/** Strip presigned S3 query params so only the stable object URL is stored in the form. */
function canonicalImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('.amazonaws.com')) {
      return `${u.origin}${u.pathname}`;
    }
  } catch { /* not a valid URL — return as-is */ }
  return url;
}

@Component({
  selector: 'app-image-matching-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, MaterialModule],
  template: `
    <div class="im-form">
      <div class="im-form__header">
        <h2>Image Matching Questions</h2>
        <p>Each question displays up to 8 image-word pairs on a page. Students drag words to the matching images.</p>
      </div>

      <div class="im-form__actions">
        <button mat-raised-button color="primary" (click)="addQuestion()">
          <mat-icon>add</mat-icon> Add Question
        </button>
        <button mat-raised-button color="accent" (click)="save()" [disabled]="saving || form.invalid">
          <mat-icon>save</mat-icon> {{ saving ? 'Saving...' : 'Save All' }}
        </button>
      </div>

      <div [formGroup]="form">
        <div class="im-form__questions" formArrayName="questions">
          <div *ngFor="let questionCtrl of questions.controls; let qIdx = index" [formGroupName]="qIdx" class="im-question">
          <div class="im-question__header">
            <span class="im-question__label">Question {{ qIdx + 1 }}</span>
            <button mat-icon-button color="warn" type="button" (click)="removeQuestion(qIdx)" *ngIf="questions.length > 1">
              <mat-icon>delete</mat-icon>
            </button>
          </div>

          <div class="im-question__pairs" formArrayName="pairs">
            <div *ngFor="let pairCtrl of getPairs(qIdx).controls; let pIdx = index" [formGroupName]="pIdx" class="im-pair">
              <div class="im-pair__header">
                <span class="im-pair__label">Pair {{ pIdx + 1 }}</span>
                <button mat-icon-button color="warn" type="button" (click)="removePair(qIdx, pIdx)" *ngIf="getPairs(qIdx).length > 1">
                  <mat-icon>close</mat-icon>
                </button>
              </div>

              <div class="im-pair__image">
                <img *ngIf="getPairImageUrl(qIdx, pIdx)" [src]="getPairImageUrl(qIdx, pIdx)" alt="Pair {{ pIdx + 1 }}">
                <div *ngIf="!getPairImageUrl(qIdx, pIdx)" class="im-pair__placeholder">
                  <mat-icon>image</mat-icon>
                  <span>No image</span>
                </div>
                <button mat-stroked-button type="button" (click)="triggerPairUpload(qIdx, pIdx)">
                  <mat-icon>upload</mat-icon> Upload
                </button>
                <input #pairFileInputs type="file" accept="image/*" style="display:none"
                  (change)="onPairImageSelect($event, qIdx, pIdx)" [id]="'pair-file-' + qIdx + '-' + pIdx">
              </div>

              <div class="im-pair__fields">
                <mat-form-field appearance="outline">
                  <mat-label>Word</mat-label>
                  <input matInput formControlName="word" placeholder="e.g., HUND">
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Hint (optional)</mat-label>
                  <input matInput formControlName="hint" placeholder="Optional hint">
                </mat-form-field>
              </div>
            </div>
          </div>

          <button *ngIf="getPairs(qIdx).length < 8" mat-stroked-button type="button" (click)="addPair(qIdx)" class="im-question__add-pair">
            <mat-icon>add</mat-icon> Add Pair ({{ getPairs(qIdx).length }}/8)
          </button>
        </div>
      </div>

      <div *ngIf="loading" class="im-form__loading">
        <mat-spinner diameter="32"></mat-spinner>
        <span>Loading questions...</span>
      </div>
    </div>
  `,
  styles: [`
    .im-form { padding: 24px; }
    .im-form__header { margin-bottom: 20px; }
    .im-form__header h2 { margin: 0 0 8px; font-size: 20px; color: #1e3a5f; }
    .im-form__header p { margin: 0; color: #64748b; }
    .im-form__actions { display: flex; gap: 12px; margin-bottom: 24px; }

    .im-question {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(64, 89, 128, 0.06);
    }
    .im-question__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .im-question__label { font-weight: 600; color: #1e3a5f; font-size: 16px; }
    .im-question__pairs { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .im-question__add-pair { margin-top: 16px; width: 100%; }

    .im-pair {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
    }
    .im-pair__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .im-pair__label { font-weight: 500; color: #475569; font-size: 13px; }
    .im-pair__image {
      display: flex; flex-direction: column; align-items: center; gap: 6px; margin-bottom: 8px;
    }
    .im-pair__image img {
      width: 100%; height: 80px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0;
    }
    .im-pair__placeholder {
      width: 100%; height: 80px; display: flex; flex-direction: column; align-items: center;
      justify-content: center; background: #fff; border: 2px dashed #e2e8f0; border-radius: 6px;
      color: #94a3b8;
    }
    .im-pair__placeholder mat-icon { font-size: 28px; width: 28px; height: 28px; }
    .im-pair__fields mat-form-field { margin: 0; width: 100%; }
    .im-pair__fields { display: flex; flex-direction: column; gap: 6px; }
    .im-form__loading { display: flex; align-items: center; gap: 12px; padding: 24px; color: #64748b; }
  `]
})

export class ImageMatchingQuestionFormComponent implements OnInit {
  @Input() gameSetId!: string;

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
        const data = (r.questions || []) as AdminImageMatchingQuestion[];
        this.pairImageUrls = [];
        this.pendingPairImages = [];
        this.questions.clear();

        data.forEach(q => {
          const pairsArray = this.fb.array([]) as FormArray;
          const pairImages: (string | null)[] = [];
          const pendingImages: (File | null)[] = [];

          const rawPairs = (q as any).pairs || [];
          if (rawPairs.length > 0) {
            rawPairs.forEach((p: any) => {
              // Store canonical (non-presigned) URL in the form control so saves
              // send the stable object key. Use the presigned URL for display.
              const raw = p.imageUrl || null;
              (pairsArray as FormArray).push(this.fb.group({
                word: [p.word || '', Validators.required],
                hint: [p.hint || ''],
                _id: [null],
                imageUrl: [canonicalImageUrl(raw)],
              }));
              pairImages.push(raw);           // presigned (or canonical) for <img> src
              pendingImages.push(null);
            });
          } else {
            // Legacy: single word/hint on the question root → wrap as one pair
            const raw = (q as any).imageUrl || null;
            (pairsArray as FormArray).push(this.fb.group({
              word: [(q as any).word || '', Validators.required],
              hint: [(q as any).hint || ''],
              _id: [null],
              imageUrl: [canonicalImageUrl(raw)],
            }));
            pairImages.push(raw);            // presigned (or canonical) for <img> src
            pendingImages.push(null);
          }

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
      error: (err) => {
        this.loading = false;
        this.addQuestion();
        this.notify.error(err?.error?.message || err?.message || 'Failed to load questions');
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

  private createPair(word = '', hint = '', imageUrl: string | null = null) {
    return this.fb.group({
      word: [word, Validators.required],
      hint: [hint],
      _id: [null],
      imageUrl: [imageUrl],
    });
  }

  addPair(qIdx: number) {
    const pairs = this.getPairs(qIdx);
    if (pairs.length >= 8) return;
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
    const el = document.getElementById(`pair-file-${qIdx}-${pIdx}`) as HTMLInputElement;
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
        // Send canonical URL from the form control (saved in DB on load),
        // or null for new uploads (blob URLs → uploaded after save).
        const imageUrl = displayUrl && displayUrl.startsWith('blob:')
          ? null
          : (p.imageUrl || null);
        return {
          word: (p.word || '').toUpperCase().trim(),
          hint: p.hint || '',
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
        const savedQuestions = r.questions || [];
        const idMap = new Map<string, { _id: string }>(
          savedQuestions.map((q: any) => [String(q.order), q])
        );

        for (let qIdx = 0; qIdx < this.questions.length; qIdx++) {
          const qCtrl = this.questions.at(qIdx);
          const order = qCtrl.value.order ?? qIdx;
          const saved = idMap.get(String(order));
          if (!saved?._id) continue;
          for (let pIdx = 0; pIdx < (this.pendingPairImages[qIdx]?.length || 0); pIdx++) {
            const file = this.pendingPairImages[qIdx]?.[pIdx];
            if (file) {
              await this.uploadPairImage(saved._id, pIdx, file);
            }
          }
        }

        this.saving = false;
        this.notify.success('Questions saved');
        this.load();
      },
      error: () => {
        this.saving = false;
        this.notify.error('Failed to save questions');
      }
    });
  }

  private uploadPairImage(questionId: string, pairIndex: number, file: File): Promise<void> {
    return new Promise((resolve) => {
      this.svc.adminUploadPairImage(questionId, pairIndex, file).subscribe({
        next: () => resolve(),
        error: () => resolve(),
      });
    });
  }
}
