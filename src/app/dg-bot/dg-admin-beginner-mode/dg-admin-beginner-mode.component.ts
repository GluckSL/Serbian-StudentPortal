import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { DgApiService } from '../dg-api.service';
import { environment } from '../../../environments/environment';
import type { DgBeginnerMode, DgBeginnerQuestion, DgModuleSummary } from '../dg-bot.types';

interface BatchSummary {
  batchName: string;
}

function emptyQuestion(order = 0): DgBeginnerQuestion {
  return {
    imageUrl: '',
    questionText: '',
    targetAnswer: '',
    hint: '',
    order,
  };
}

function normalizeQuestionsFromModule(bm: DgBeginnerMode | undefined): DgBeginnerQuestion[] {
  if (!bm) return [];
  if (Array.isArray(bm.questions) && bm.questions.length) {
    return JSON.parse(JSON.stringify(bm.questions)).sort(
      (a: DgBeginnerQuestion, b: DgBeginnerQuestion) => (a.order ?? 0) - (b.order ?? 0),
    );
  }
  const legacy = bm.dialoguePrompts || [];
  if (!legacy.length && !bm.contextImageUrl && !bm.contextText) return [];
  return legacy.map((p, i) => ({
    imageUrl: i === 0 ? bm.contextImageUrl || '' : '',
    questionText: p.promptText || '',
    targetAnswer: p.targetAnswer || '',
    hint: p.hint || '',
    order: i,
  }));
}

@Component({
  selector: 'app-dg-admin-beginner-mode',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './dg-admin-beginner-mode.component.html',
  styleUrls: ['./dg-admin-beginner-mode.component.scss'],
})
export class DgAdminBeginnerModeComponent implements OnInit {
  moduleId = '';
  moduleTitle = '';
  loading = true;
  saving = false;
  message: string | null = null;
  messageType: 'error' | 'success' | 'info' = 'info';

  sessionIntro = '';
  questions: DgBeginnerQuestion[] = [];
  uploadingIndex: number | null = null;
  batches: BatchSummary[] = [];
  batchToAdd = '';
  targetBatches: string[] = [];

  constructor(
    private dgApi: DgApiService,
    private router: Router,
    private route: ActivatedRoute,
    private http: HttpClient,
  ) {}

  async ngOnInit(): Promise<void> {
    this.moduleId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.moduleId) {
      this.loading = false;
      this.messageType = 'error';
      this.message = 'Missing module id.';
      return;
    }
    try {
      const mod = await firstValueFrom(this.dgApi.getAdminModule(this.moduleId));
      await this.loadBatches();
      this.hydrate(mod);
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Failed to load module.';
    } finally {
      this.loading = false;
    }
  }

  private hydrate(mod: DgModuleSummary): void {
    this.moduleTitle = mod.title || 'DG Module';
    this.targetBatches = Array.isArray(mod.targetBatches) ? [...mod.targetBatches] : [];
    const bm = mod.beginnerMode;
    this.sessionIntro =
      bm?.sessionIntro ||
      (bm?.contextText && !bm?.questions?.length ? bm.contextText : '') ||
      '';
    this.questions = normalizeQuestionsFromModule(bm);
  }

  get questionCount(): number {
    return this.questions.length;
  }

  goBack(): void {
    this.router.navigate(['/admin/dg-modules', this.moduleId, 'edit']);
  }

  private async loadBatches(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ batches: BatchSummary[] }>(`${environment.apiUrl}/batch-journey`, {
          withCredentials: true,
        }),
      );
      this.batches = (res?.batches || []).sort((a, b) => a.batchName.localeCompare(b.batchName));
    } catch {
      this.batches = [];
    }
  }

  removeBatch(name: string): void {
    const v = String(name || '').trim();
    if (!v) return;
    this.targetBatches = this.targetBatches.filter((b) => b !== v);
  }

  clearBatches(): void {
    this.targetBatches = [];
  }

  onBatchDropdownChange(): void {
    const v = String(this.batchToAdd || '').trim();
    if (v && !this.targetBatches.includes(v)) {
      this.targetBatches = [...this.targetBatches, v];
    }
    this.batchToAdd = '';
  }

  addQuestion(): void {
    this.questions = [...this.questions, emptyQuestion(this.questions.length)];
  }

  removeQuestion(index: number): void {
    if (!confirm('Remove this question?')) return;
    this.questions.splice(index, 1);
    this.renumber();
  }

  moveQuestion(index: number, dir: -1 | 1): void {
    const next = index + dir;
    if (next < 0 || next >= this.questions.length) return;
    moveItemInArray(this.questions, index, next);
    this.renumber();
  }

  dropQuestion(ev: CdkDragDrop<DgBeginnerQuestion[]>): void {
    moveItemInArray(this.questions, ev.previousIndex, ev.currentIndex);
    this.renumber();
  }

  private renumber(): void {
    this.questions.forEach((q, i) => (q.order = i));
  }

  triggerImagePicker(input: HTMLInputElement, index: number): void {
    if (this.uploadingIndex !== null) return;
    input.dataset['qIndex'] = String(index);
    input.click();
  }

  async onImageSelected(event: Event, index: number): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.messageType = 'error';
      this.message = 'Please choose an image file (JPG, PNG, GIF, WebP).';
      return;
    }
    this.uploadingIndex = index;
    this.message = null;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await firstValueFrom(
        this.http.post<{ url: string }>(`${environment.apiUrl}/dg/modules/upload-context-image`, formData, {
          withCredentials: true,
        }),
      );
      if (this.questions[index]) {
        this.questions[index].imageUrl = res.url || '';
      }
      this.messageType = 'success';
      this.message = 'Image uploaded.';
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Upload failed';
    } finally {
      this.uploadingIndex = null;
    }
  }

  clearImage(index: number): void {
    if (this.questions[index]) {
      this.questions[index].imageUrl = '';
    }
  }

  async save(): Promise<boolean> {
    const validQuestions = this.questions.filter((q) => q.questionText?.trim());
    if (validQuestions.length === 0) {
      this.messageType = 'error';
      this.message = 'Add at least one question with text for Olly to ask.';
      return false;
    }

    this.saving = true;
    this.message = null;
    try {
      const beginnerMode: DgBeginnerMode = {
        enabled: true,
        sessionIntro: this.sessionIntro.trim(),
        questions: validQuestions.map((q, i) => ({
          questionText: q.questionText.trim(),
          imageUrl: (q.imageUrl || '').trim(),
          targetAnswer: (q.targetAnswer || '').trim(),
          hint: (q.hint || '').trim(),
          order: i,
        })),
      };
      await firstValueFrom(
        this.dgApi.updateModule(this.moduleId, {
          beginnerMode,
          targetBatches: this.targetBatches,
        } as Partial<DgModuleSummary>),
      );
      this.questions = validQuestions;
      this.renumber();
      this.messageType = 'success';
      this.message = `Saved ${validQuestions.length} question(s) for Beginner Mode.`;
      return true;
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Save failed';
      return false;
    } finally {
      this.saving = false;
    }
  }

  async saveAndPreview(): Promise<void> {
    const ok = await this.save();
    if (ok) {
      this.router.navigate(['/dg-bot', this.moduleId, 'play']);
    }
  }

  async disableBeginnerMode(): Promise<void> {
    if (!confirm('Turn off Beginner Mode for this module? Questions will be kept but students will use the standard role-play flow.')) {
      return;
    }
    this.saving = true;
    try {
      await firstValueFrom(
        this.dgApi.updateModule(this.moduleId, {
          beginnerMode: { enabled: false, sessionIntro: this.sessionIntro, questions: this.questions },
        } as Partial<DgModuleSummary>),
      );
      this.messageType = 'info';
      this.message = 'Beginner Mode disabled. Standard role-play will be used.';
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Update failed';
    } finally {
      this.saving = false;
    }
  }
}
