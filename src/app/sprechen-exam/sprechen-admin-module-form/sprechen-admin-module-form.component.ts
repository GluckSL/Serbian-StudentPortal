import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { SprechenApiService } from '../sprechen-api.service';
import { DgApiService } from '../../dg-bot/dg-api.service';
import { LearningModulesService } from '../../services/learning-modules.service';
import { environment } from '../../../environments/environment';
import { defaultSprechenExamContent } from '../sprechen-exam.defaults';
import { canonicalizeStoredMediaUrl, resolveMediaUrl } from '../../utils/media-url';
import type { DgCharacterDoc } from '../../dg-bot/dg-bot.types';
import type {
  SprechenExamModuleSummary,
  SprechenTeil2Theme,
  SprechenTeil3Round,
} from '../sprechen-exam.types';

interface BatchSummary {
  batchName: string;
}

@Component({
  selector: 'app-sprechen-admin-module-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sprechen-admin-module-form.component.html',
  styleUrls: ['../../dg-bot/dg-admin-module-form/dg-admin-module-form.component.scss'],
})
export class SprechenAdminModuleFormComponent implements OnInit {
  formMode: 'create' | 'edit' = 'edit';
  loading = true;
  saving = false;
  message: string | null = null;
  messageType: 'error' | 'success' | 'info' = 'info';
  missingFields = new Set<string>();

  selected: SprechenExamModuleSummary | null = null;
  characters: DgCharacterDoc[] = [];

  editTitle = '';
  editDescription = '';
  editLevel = 'A1';
  editPassThreshold = 10;
  /** Bound to `<input type="number">` — may be string or number. */
  editCourseDay: string | number | null = '';
  editCharacterId = '';
  editVisible = false;

  keywordsText = '';
  introCardImageUrl = '';
  introCardUploading = false;
  spellPromptsText = '';
  numberPromptsText = '';
  themes: SprechenTeil2Theme[] = [];
  rounds: SprechenTeil3Round[] = [];

  cefrLevels: string[] = [];
  batches: BatchSummary[] = [];
  batchToAdd = '';
  targetBatches: string[] = [];

  /** True after Teil 1–3 or card images change; skips heavy exam payload on metadata-only save. */
  private examContentDirty = false;
  /** Ignores ngModel/input noise while the form is hydrating from the server. */
  private examContentInitialized = false;

  private static readonly SAVE_TIMEOUT_MS = 60_000;

  get isCreateMode(): boolean {
    return this.formMode === 'create';
  }

  constructor(
    private sprechenApi: SprechenApiService,
    private dgApi: DgApiService,
    private router: Router,
    private route: ActivatedRoute,
    private learningModules: LearningModulesService,
    private http: HttpClient,
  ) {}

  async ngOnInit(): Promise<void> {
    this.cefrLevels = this.learningModules.getAvailableLevels();
    const mode = this.route.snapshot.data['sprechenFormMode'] as string | undefined;
    this.formMode = mode === 'create' ? 'create' : 'edit';
    const id = this.route.snapshot.paramMap.get('id');

    this.loading = true;
    try {
      await this.loadBatches();
      const { characters } = await firstValueFrom(this.dgApi.listCharacters());
      this.characters = characters || [];
      if (this.formMode === 'create') {
        this.initNewModule();
      } else if (id) {
        const mod = await firstValueFrom(this.sprechenApi.getAdminModule(id));
        this.hydrateFromModule(mod);
      } else {
        this.messageType = 'error';
        this.message = 'Missing module id.';
      }
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Load failed';
    } finally {
      this.loading = false;
    }
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

  private initNewModule(): void {
    const defaults = defaultSprechenExamContent();
    this.selected = { _id: '', title: '', level: defaults.level };
    this.editTitle = '';
    this.editDescription = 'Goethe A1 Sprechen exam simulation with Olly Tutor.';
    this.editLevel = defaults.level || 'A1';
    this.editPassThreshold = defaults.passThreshold ?? 10;
    this.editCourseDay = '';
    this.editVisible = false;
    this.targetBatches = [];
    this.keywordsText = (defaults.teil1?.keywords || []).join(', ');
    this.introCardImageUrl = defaults.teil1?.introCardImageUrl || '';
    this.spellPromptsText = (defaults.teil1?.spellPrompts || []).join('\n');
    this.numberPromptsText = (defaults.teil1?.numberPrompts || []).join('\n');
    this.themes = JSON.parse(JSON.stringify(defaults.teil2?.themes || []));
    this.rounds = JSON.parse(JSON.stringify(defaults.teil3?.rounds || []));
    const olly = this.characters.find((c) => /olly/i.test(c.name || ''));
    const fallback = this.characters.find((c) => c.isDefault) || this.characters[0];
    this.editCharacterId = olly?._id || fallback?._id || '';
    this.enableExamContentTracking();
  }

  private enableExamContentTracking(): void {
    this.examContentInitialized = false;
    setTimeout(() => {
      this.examContentInitialized = true;
    });
  }

  markExamContentDirty(): void {
    if (!this.examContentInitialized) return;
    this.examContentDirty = true;
  }

  clearIntroCardImage(): void {
    this.introCardImageUrl = '';
    this.markExamContentDirty();
  }

  private applyMetadataFromResponse(meta: Partial<SprechenExamModuleSummary>): void {
    if (!this.selected || !meta) return;
    this.selected = { ...this.selected, ...meta };
    if (meta.title !== undefined) this.editTitle = meta.title || '';
    if (meta.description !== undefined) this.editDescription = meta.description || '';
    if (meta.level !== undefined) this.editLevel = meta.level || 'A1';
    if (meta.passThreshold !== undefined) this.editPassThreshold = meta.passThreshold ?? 10;
    if (meta.courseDay !== undefined) {
      this.editCourseDay = this.courseDayForInput(meta.courseDay);
    }
    if (meta.visibleToStudents !== undefined) this.editVisible = !!meta.visibleToStudents;
    if (meta.targetBatchKeys !== undefined) this.targetBatches = [...(meta.targetBatchKeys || [])];
    if (meta.characterId !== undefined) {
      const char = meta.characterId;
      this.editCharacterId =
        typeof char === 'string' ? char : (char as { _id?: string })?._id || '';
    }
  }

  private hydrateFromModule(mod: SprechenExamModuleSummary): void {
    this.examContentInitialized = false;
    this.examContentDirty = false;
    this.selected = mod;
    this.editTitle = mod.title || '';
    this.editDescription = mod.description || '';
    this.editLevel = mod.level || 'A1';
    this.editPassThreshold = mod.passThreshold ?? 10;
    this.editCourseDay = this.courseDayForInput(mod.courseDay);
    this.editVisible = !!mod.visibleToStudents;
    this.targetBatches = [...(mod.targetBatchKeys || [])];
    const char = mod.characterId;
    this.editCharacterId =
      typeof char === 'string' ? char : (char as { _id?: string })?._id || '';
    this.keywordsText = (mod.teil1?.keywords || []).join(', ');
    this.introCardImageUrl = mod.teil1?.introCardImageUrl || '';
    this.spellPromptsText = (mod.teil1?.spellPrompts || []).join('\n');
    this.numberPromptsText = (mod.teil1?.numberPrompts || []).join('\n');
    this.themes = JSON.parse(JSON.stringify(mod.teil2?.themes || []));
    this.rounds = JSON.parse(JSON.stringify(mod.teil3?.rounds || []));
    this.enableExamContentTracking();
  }

  isInvalid(key: string): boolean {
    return this.missingFields.has(key);
  }

  onFieldInput(key: string): void {
    this.missingFields.delete(key);
  }

  goBack(): void {
    this.router.navigate(['/admin/sprechen-exam']);
  }

  addTheme(): void {
    this.markExamContentDirty();
    this.themes.push({ name: '', studentKeyword: '', botKeyword: '', studentCardImageUrl: '', botCardImageUrl: '' });
  }

  getIntroCardPreviewUrl(): string {
    return resolveMediaUrl(this.introCardImageUrl);
  }

  getCardPreviewUrl(url?: string): string {
    return resolveMediaUrl(url);
  }

  async onIntroCardFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this._uploadToField(
      file,
      (url) => {
        this.introCardImageUrl = url;
        this.markExamContentDirty();
      },
      () => (this.introCardUploading = true),
      () => (this.introCardUploading = false),
    );
  }

  async onThemeImageFile(ev: Event, theme: SprechenTeil2Theme, field: 'studentCardImageUrl' | 'botCardImageUrl'): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this._uploadToField(file, (url) => {
      theme[field] = url;
      this.markExamContentDirty();
    });
  }

  async onRoundImageFile(ev: Event, round: SprechenTeil3Round, which: 'student' | 'bot'): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const card = which === 'student' ? round.studentCard : round.botCard;
    await this._uploadToField(file, (url) => {
      card.imageUrl = url;
      this.markExamContentDirty();
    });
  }

  private async _uploadToField(
    file: File,
    setUrl: (url: string) => void,
    onStart?: () => void,
    onEnd?: () => void,
  ): Promise<void> {
    onStart?.();
    try {
      const res = await firstValueFrom(this.sprechenApi.uploadCardImage(file));
      setUrl(res.url || res.canonicalUrl || '');
      this.messageType = 'success';
      this.message = 'Image uploaded.';
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Image upload failed';
    } finally {
      onEnd?.();
    }
  }

  removeTheme(i: number): void {
    this.markExamContentDirty();
    this.themes.splice(i, 1);
  }

  addRound(): void {
    this.markExamContentDirty();
    this.rounds.push({
      studentCard: { label: '', objectDe: '', imageUrl: '' },
      botCard: { label: '', objectDe: '', imageUrl: '' },
    });
  }

  removeRound(i: number): void {
    this.markExamContentDirty();
    this.rounds.splice(i, 1);
  }

  isBatchSelected(name: string): boolean {
    return this.targetBatches.includes(name);
  }

  toggleBatch(name: string): void {
    const v = String(name || '').trim();
    if (!v) return;
    const idx = this.targetBatches.indexOf(v);
    if (idx >= 0) this.targetBatches.splice(idx, 1);
    else this.targetBatches.push(v);
  }

  onBatchDropdownChange(): void {
    const v = String(this.batchToAdd || '').trim();
    if (v && !this.targetBatches.includes(v)) {
      this.targetBatches = [...this.targetBatches, v];
    }
    this.batchToAdd = '';
  }

  private validate(): boolean {
    this.missingFields.clear();
    if (!this.editTitle.trim()) this.missingFields.add('title');
    if (!this.editDescription.trim()) this.missingFields.add('description');
    if (!this.editLevel.trim()) this.missingFields.add('level');
    if (!this.editCharacterId) this.missingFields.add('characterId');
    return this.missingFields.size === 0;
  }

  /** Normalizes journey day from the number input for API saves. */
  private resolveCourseDayForSave(): number | null {
    const raw = this.editCourseDay;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(200, Math.max(1, Math.floor(n)));
  }

  private courseDayForInput(day: number | null | undefined): string | number {
    if (day == null || day <= 0) return '';
    return day;
  }

  private buildMetadataPayload(): Partial<SprechenExamModuleSummary> {
    const courseDay = this.resolveCourseDayForSave();
    return {
      title: this.editTitle.trim(),
      description: this.editDescription.trim(),
      level: this.editLevel.trim(),
      passThreshold: Number(this.editPassThreshold) || 10,
      visibleToStudents: this.editVisible,
      courseDay: courseDay as unknown as number | undefined,
      targetBatchKeys: [...this.targetBatches],
      characterId: this.editCharacterId,
    };
  }

  private buildFullPayload(): Partial<SprechenExamModuleSummary> {
    const defaults = defaultSprechenExamContent();

    return {
      ...this.buildMetadataPayload(),
      teil1: {
        keywords: this.keywordsText
          .split(/[,;\n]/)
          .map((k) => k.trim())
          .filter(Boolean),
        introCardImageUrl: canonicalizeStoredMediaUrl((this.introCardImageUrl || '').trim()),
        spellPrompts: this.spellPromptsText.split('\n').map((s) => s.trim()).filter(Boolean),
        numberPrompts: this.numberPromptsText.split('\n').map((s) => s.trim()).filter(Boolean),
      },
      teil2: {
        themes: this.themes
          .filter((t) => t.name?.trim())
          .map((t) => ({
            ...t,
            studentCardImageUrl: t.studentCardImageUrl
              ? canonicalizeStoredMediaUrl(t.studentCardImageUrl)
              : t.studentCardImageUrl,
            botCardImageUrl: t.botCardImageUrl
              ? canonicalizeStoredMediaUrl(t.botCardImageUrl)
              : t.botCardImageUrl,
          })),
      },
      teil3: {
        rounds: this.rounds.map((r) => ({
          ...r,
          studentCard: {
            ...r.studentCard,
            imageUrl: r.studentCard?.imageUrl
              ? canonicalizeStoredMediaUrl(r.studentCard.imageUrl)
              : r.studentCard?.imageUrl,
          },
          botCard: {
            ...r.botCard,
            imageUrl: r.botCard?.imageUrl
              ? canonicalizeStoredMediaUrl(r.botCard.imageUrl)
              : r.botCard?.imageUrl,
          },
        })),
      },
      rubric: this.selected?.rubric || defaults.rubric,
    };
  }

  async save(): Promise<void> {
    if (!this.validate()) {
      this.messageType = 'error';
      this.message = 'Please fill in all required fields.';
      return;
    }
    if (this.saving) return;

    this.saving = true;
    this.message = null;
    const includeExamContent = this.isCreateMode || this.examContentDirty;
    try {
      if (this.isCreateMode) {
        const created = await firstValueFrom(
          this.sprechenApi
            .createModule(this.buildFullPayload())
            .pipe(timeout(SprechenAdminModuleFormComponent.SAVE_TIMEOUT_MS)),
        );
        this.router.navigate(['/admin/sprechen-exam'], {
          queryParams: { saved: created._id },
        });
      } else if (this.selected?._id) {
        const id = this.selected._id;
        const updated = await firstValueFrom(
          (includeExamContent
            ? this.sprechenApi.updateModule(id, this.buildFullPayload())
            : this.sprechenApi.patchModuleMetadata(id, this.buildMetadataPayload())
          ).pipe(timeout(SprechenAdminModuleFormComponent.SAVE_TIMEOUT_MS)),
        );
        if (includeExamContent) {
          this.hydrateFromModule(updated as SprechenExamModuleSummary);
        } else {
          this.applyMetadataFromResponse(updated);
        }
        this.messageType = 'success';
        this.message = includeExamContent ? 'Module saved.' : 'Basic settings saved.';
      }
    } catch (e: any) {
      this.messageType = 'error';
      if (e instanceof TimeoutError || e?.name === 'TimeoutError') {
        this.message =
          'Save timed out. Confirm the API server is running (port 4000), then try again.';
      } else {
        this.message = e?.error?.message || e?.message || 'Save failed';
      }
    } finally {
      this.saving = false;
    }
  }

  preview(): void {
    if (!this.selected?._id) return;
    this.router.navigate(['/sprechen-exam', this.selected._id, 'play']);
  }
}
