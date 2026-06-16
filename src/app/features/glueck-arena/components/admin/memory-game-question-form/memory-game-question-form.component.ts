import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';
import { trimGermanWord } from '../../../utils/german-text';
import type { AdminMemoryGameQuestion } from '../../../glueck-arena.types';

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
  selector: 'app-memory-game-question-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, MaterialModule],
  template: `
    <div class="mg-form">
      <div class="mg-form__header">
        <h2>Memory Game Questions</h2>
        <p>Each question creates a board of face-down cards. Students flip and match picture-word pairs.</p>
      </div>

      <div class="mg-form__actions">
        <button mat-raised-button color="primary" (click)="addQuestion()">
          <mat-icon>add</mat-icon> Add Board
        </button>
        <button mat-raised-button color="accent" (click)="save()" [disabled]="saving || form.invalid">
          <mat-icon>save</mat-icon> {{ saving ? 'Saving...' : 'Save All' }}
        </button>
      </div>

      <div [formGroup]="form">
        <div class="mg-form__boards" formArrayName="questions">
          <div *ngFor="let boardCtrl of questions.controls; let qIdx = index" [formGroupName]="qIdx" class="mg-board">
            <div class="mg-board__header">
              <span class="mg-board__label">Board {{ qIdx + 1 }}</span>
              <button mat-icon-button color="warn" type="button" (click)="removeQuestion(qIdx)" *ngIf="questions.length > 1">
                <mat-icon>delete</mat-icon>
              </button>
            </div>

            <div class="mg-board__pairs" formArrayName="pairs">
              <div *ngFor="let pairCtrl of getPairs(qIdx).controls; let pIdx = index" [formGroupName]="pIdx" class="mg-pair">
                <div class="mg-pair__header">
                  <span class="mg-pair__label">Pair {{ pIdx + 1 }}</span>
                  <button mat-icon-button color="warn" type="button" (click)="removePair(qIdx, pIdx)" *ngIf="getPairs(qIdx).length > 1">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>

                <div class="mg-pair__image">
                  <div class="mg-pair__image-box" (click)="triggerPairUpload(qIdx, pIdx)">
                    <img *ngIf="getPairImageUrl(qIdx, pIdx)" [src]="getPairImageUrl(qIdx, pIdx)" alt="Pair {{ pIdx + 1 }}">
                    <div *ngIf="!getPairImageUrl(qIdx, pIdx)" class="mg-pair__placeholder">
                      <mat-icon>image</mat-icon>
                      <span>No image</span>
                    </div>
                  </div>
                  <input #pairFileInputs type="file" accept="image/*" style="display:none"
                    (change)="onPairImageSelect($event, qIdx, pIdx)" [id]="'mg-pair-file-' + qIdx + '-' + pIdx">
                </div>

                <div class="mg-pair__field">
                  <mat-form-field appearance="outline">
                    <mat-label>Word *</mat-label>
                    <input matInput formControlName="word" placeholder="e.g., HUND">
                  </mat-form-field>
                </div>
              </div>
            </div>

            <button mat-stroked-button type="button" (click)="addPair(qIdx)" class="mg-board__add-pair" [disabled]="getPairs(qIdx).length >= 8">
              <mat-icon>add</mat-icon> Add Pair ({{ getPairs(qIdx).length }} / 8)
            </button>
          </div>
        </div>
      </div>

      <div *ngIf="loading" class="mg-form__loading">
        <mat-spinner diameter="32"></mat-spinner>
        <span>Loading questions...</span>
      </div>
    </div>
  `,
  styles: [`
    .mg-form { padding: 24px; }
    .mg-form__header { margin-bottom: 20px; }
    .mg-form__header h2 { margin: 0 0 8px; font-size: 20px; color: #1e3a5f; }
    .mg-form__header p { margin: 0; color: #64748b; }
    .mg-form__actions { display: flex; gap: 12px; margin-bottom: 24px; }

    .mg-board {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(64, 89, 128, 0.06);
    }
    .mg-board__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .mg-board__label { font-weight: 600; color: #1e3a5f; font-size: 16px; }
    .mg-board__pairs { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .mg-board__add-pair { margin-top: 16px; width: 100%; }

    .mg-pair {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
    }
    .mg-pair__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .mg-pair__label { font-weight: 500; color: #475569; font-size: 13px; }
    .mg-pair__image {
      display: flex; flex-direction: column; align-items: center; gap: 6px; margin-bottom: 8px;
    }
    .mg-pair__image .mg-pair__image-box {
      width: 140px; height: 140px; flex-shrink: 0;
      border-radius: 6px; overflow: hidden; cursor: pointer;
    }
    .mg-pair__image img {
      width: 100%; height: 100%; object-fit: cover;
      border: 1px solid #e2e8f0; background: #f1f5f9;
    }
    .mg-pair__placeholder {
      width: 100%; height: 100%; display: flex; flex-direction: column;
      align-items: center; justify-content: center; background: #fff; border: 2px dashed #e2e8f0;
      border-radius: 6px; color: #94a3b8; box-sizing: border-box;
    }
    .mg-pair__placeholder mat-icon { font-size: 28px; width: 28px; height: 28px; }
    .mg-pair__field mat-form-field { margin: 0; width: 100%; }
    .mg-form__loading { display: flex; align-items: center; gap: 12px; padding: 24px; color: #64748b; }
  `]
})
export class MemoryGameQuestionFormComponent implements OnInit {
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
    this.form = this.fb.group({ questions: this.fb.array([]) as FormArray });
  }

  load() {
    if (!this.gameSetId) {
      this.addQuestion();
      return;
    }
    this.loading = true;
    this.svc.adminGetQuestions(this.gameSetId).subscribe({
      next: (r) => {
        const data = (r.questions || []) as AdminMemoryGameQuestion[];
        this.pairImageUrls = [];
        this.pendingPairImages = [];
        this.questions.clear();

        data.forEach(q => {
          const pairsArray = this.fb.array([]) as FormArray;
          const pairImages: (string | null)[] = [];
          const pendingImages: (File | null)[] = [];
          const rawPairs = (q as any).pairs || [];

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

          this.questions.push(this.fb.group({ _id: [q._id], pairs: pairsArray }));
          this.pairImageUrls.push(pairImages);
          this.pendingPairImages.push(pendingImages);
        });

        if (data.length === 0) this.addQuestion();
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
    this.questions.push(this.fb.group({ _id: [null], pairs: pairsArray }));
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
    const el = document.getElementById(`mg-pair-file-${qIdx}-${pIdx}`) as HTMLInputElement;
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
        const imageUrl = displayUrl && displayUrl.startsWith('blob:') ? null : (p.imageUrl || null);
        return { word: trimGermanWord(p.word || ''), imageUrl };
      });
      return { _id: qCtrl.value._id, order: qIdx, pairs };
    });

    this.svc.adminUpsertQuestions(this.gameSetId, questions).subscribe({
      next: async (r) => {
        const savedQuestions = r.questions || [];
        const idMap = new Map<string, { _id: string }>(
          savedQuestions.map((q: any) => [String(q.order), q])
        );

        for (let qIdx = 0; qIdx < this.questions.length; qIdx++) {
          const saved = idMap.get(String(qIdx));
          if (!saved?._id) continue;
          for (let pIdx = 0; pIdx < (this.pendingPairImages[qIdx]?.length || 0); pIdx++) {
            const file = this.pendingPairImages[qIdx]?.[pIdx];
            if (file) {
              const ok = await this.uploadPairImage(saved._id, qIdx, pIdx, file);
              if (!ok) {
                this.saving = false;
                this.notify.error(`Failed to upload image for board ${qIdx + 1}, pair ${pIdx + 1}`);
                return;
              }
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

  private uploadPairImage(questionId: string, qIdx: number, pairIndex: number, file: File): Promise<boolean> {
    return new Promise((resolve) => {
      this.svc.adminUploadPairImage(questionId, pairIndex, file).subscribe({
        next: (r) => {
          const displayUrl = r.url || r.canonicalUrl;
          const storedUrl = canonicalImageUrl(r.canonicalUrl || r.url);
          if (displayUrl) this.pairImageUrls[qIdx][pairIndex] = displayUrl;
          if (storedUrl) this.getPairs(qIdx).at(pairIndex)?.patchValue({ imageUrl: storedUrl });
          this.pendingPairImages[qIdx][pairIndex] = null;
          resolve(true);
        },
        error: () => resolve(false),
      });
    });
  }
}
