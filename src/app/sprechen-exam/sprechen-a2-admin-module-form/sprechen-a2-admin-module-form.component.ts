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
import { canonicalizeStoredMediaUrl, resolveMediaUrl } from '../../utils/media-url';
import type { DgCharacterDoc } from '../../dg-bot/dg-bot.types';
import type {
  SprechenExamModuleSummary,
  SprechenA2QuestionCard,
  SprechenA2MonologueCard,
  SprechenA2TimetableSlot,
} from '../sprechen-exam.types';

interface BatchSummary { batchName: string; }

@Component({
  selector: 'app-sprechen-a2-admin-module-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sprechen-a2-admin-module-form.component.html',
  styleUrls: ['../../dg-bot/dg-admin-module-form/dg-admin-module-form.component.scss'],
})
export class SprechenA2AdminModuleFormComponent implements OnInit {
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
  editPassThreshold = 10;
  editCourseDay: string | number | null = '';
  editCharacterId = '';
  editVisible = false;
  editWeeklyTestEnabled = false;
  editExamEnabled = false;

  cefrLevels: string[] = [];
  batches: BatchSummary[] = [];
  batchToAdd = '';
  targetBatches: string[] = [];

  // Teil 1
  t1InstructionDe = 'Sie bekommen vier Karten und stellen mit diesen Karten vier Fragen. Ihr Partner/Ihre Partnerin antwortet. Dann stellt Ihr Partner/Ihre Partnerin vier Fragen und Sie antworten.';
  t1Cards: SprechenA2QuestionCard[] = [];
  t1CardUploading: boolean[] = [];

  // Teil 2
  t2InstructionDe = 'Sie bekommen eine Karte und erzählen etwas über Ihr Leben.';
  t2Cards: SprechenA2MonologueCard[] = [];
  t2CardUploading: boolean[] = [];

  // Teil 3
  t3ScenarioDe = '';
  t3DateLabel = '';
  studentTimetableImageUrl = '';
  studentTimetableUploading = false;
  studentSlots: SprechenA2TimetableSlot[] = [];
  botTimetableImageUrl = '';
  botTimetableUploading = false;
  botSlots: SprechenA2TimetableSlot[] = [];

  private examContentDirty = false;
  private examContentInitialized = false;
  private static readonly SAVE_TIMEOUT_MS = 60_000;

  get isCreateMode(): boolean { return this.formMode === 'create'; }

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
    const modeRaw = this.route.snapshot.data['sprechenFormMode'] as string | undefined;
    this.formMode = modeRaw === 'create-a2' ? 'create' : 'edit';
    const id = this.route.snapshot.paramMap.get('id');

    this.loading = true;
    try {
      await this._loadBatches();
      const { characters } = await firstValueFrom(this.dgApi.listCharacters());
      this.characters = characters || [];
      if (this.formMode === 'create') {
        this._initNew();
      } else if (id) {
        const mod = await firstValueFrom(this.sprechenApi.getAdminModule(id));
        this._hydrate(mod);
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

  private async _loadBatches(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ batches: BatchSummary[] }>(`${environment.apiUrl}/batch-journey`, { withCredentials: true }),
      );
      this.batches = (res?.batches || []).sort((a, b) => a.batchName.localeCompare(b.batchName));
    } catch { this.batches = []; }
  }

  private _initNew(): void {
    this.selected = { _id: '', title: '', level: 'A2', examFormat: 'A2' };
    this.editTitle = '';
    this.editDescription = 'Goethe A2 Sprechen exam simulation with Olly Tutor.';
    this.editPassThreshold = 10;
    this.editCourseDay = '';
    this.editVisible = false;
    this.targetBatches = [];
    this.t1Cards = [
      { prompt: 'Geburtstag?', sublabel: 'Fragen zur Person', imageUrl: '' },
      { prompt: 'Wohnort?', sublabel: 'Fragen zur Person', imageUrl: '' },
      { prompt: 'Beruf?', sublabel: 'Fragen zur Person', imageUrl: '' },
      { prompt: 'Hobby?', sublabel: 'Fragen zur Person', imageUrl: '' },
    ];
    this.t1CardUploading = this.t1Cards.map(() => false);
    this.t2Cards = [
      {
        title: 'Was machen Sie mit Ihrem Geld?',
        subPrompts: ['Kleidung?', 'Lebensmittel, Miete?', 'Sparen?', 'Reisen?'],
        imageUrl: '',
      },
    ];
    this.t2CardUploading = this.t2Cards.map(() => false);
    this.t3ScenarioDe = 'Ihr Freund Patrick hat Geburtstag. Sie möchten ein Geschenk für ihn kaufen. Finden Sie einen Termin.';
    this.t3DateLabel = 'Samstag, 17. Mai';
    this.studentSlots = [
      { start: '07:00', end: '10:00', activity: 'lange schlafen', busy: true },
      { start: '11:00', end: '12:00', activity: 'Frühstück bei Mario', busy: true },
      { start: '14:00', end: '15:00', activity: 'Fahrrad abholen', busy: true },
      { start: '16:00', end: '17:00', activity: 'Eltern anrufen', busy: true },
      { start: '18:00', end: '19:00', activity: 'Fußball-Training', busy: true },
    ];
    this.botSlots = [
      { start: '07:00', end: '10:00', activity: 'Großeinkauf', busy: true },
      { start: '11:00', end: '12:00', activity: 'Friseur/Haare schneiden', busy: true },
      { start: '12:00', end: '13:00', activity: 'Essen bei Stefan', busy: true },
      { start: '15:00', end: '16:00', activity: 'Schwimmen', busy: true },
      { start: '18:00', end: '19:00', activity: 'mit dem Hund nach draußen', busy: true },
    ];
    const olly = this.characters.find((c) => /olly/i.test(c.name || ''));
    const fallback = this.characters.find((c) => c.isDefault) || this.characters[0];
    this.editCharacterId = olly?._id || fallback?._id || '';
    this._enableTracking();
  }

  private _hydrate(mod: SprechenExamModuleSummary): void {
    this.examContentInitialized = false;
    this.examContentDirty = false;
    this.selected = mod;
    this.editTitle = mod.title || '';
    this.editDescription = mod.description || '';
    this.editPassThreshold = mod.passThreshold ?? 10;
    this.editCourseDay = this._courseDayForInput(mod.courseDay);
    this.editVisible = !!mod.visibleToStudents;
    this.editWeeklyTestEnabled = !!mod.weeklyTestEnabled;
    this.editExamEnabled = !!mod.examEnabled;
    this.targetBatches = [...(mod.targetBatchKeys || [])];
    const char = mod.characterId;
    this.editCharacterId = typeof char === 'string' ? char : (char as { _id?: string })?._id || '';

    this.t1InstructionDe = mod.a2Teil1?.instructionDe || this.t1InstructionDe;
    this.t1Cards = JSON.parse(JSON.stringify(mod.a2Teil1?.cards || []));
    this.t1CardUploading = this.t1Cards.map(() => false);

    this.t2InstructionDe = mod.a2Teil2?.instructionDe || this.t2InstructionDe;
    this.t2Cards = JSON.parse(JSON.stringify(mod.a2Teil2?.cards || []));
    this.t2CardUploading = this.t2Cards.map(() => false);

    const t3 = mod.a2Teil3 || {};
    this.t3ScenarioDe = t3.scenarioDe || '';
    this.t3DateLabel = t3.dateLabel || '';
    this.studentTimetableImageUrl = t3.studentTimetable?.imageUrl || '';
    this.studentSlots = JSON.parse(JSON.stringify(t3.studentTimetable?.slots || []));
    this.botTimetableImageUrl = t3.botTimetable?.imageUrl || '';
    this.botSlots = JSON.parse(JSON.stringify(t3.botTimetable?.slots || []));

    this._enableTracking();
  }

  private _enableTracking(): void {
    this.examContentInitialized = false;
    setTimeout(() => { this.examContentInitialized = true; });
  }

  markDirty(): void {
    if (!this.examContentInitialized) return;
    this.examContentDirty = true;
  }

  isInvalid(key: string): boolean { return this.missingFields.has(key); }
  onFieldInput(key: string): void { this.missingFields.delete(key); }

  goBack(): void { this.router.navigate(['/admin/sprechen-exam']); }

  // ── Teil 1 card management ─────────────────────────────────────────────────

  addT1Card(): void {
    this.markDirty();
    this.t1Cards.push({ prompt: '', sublabel: 'Fragen zur Person', imageUrl: '' });
    this.t1CardUploading.push(false);
  }

  removeT1Card(i: number): void {
    this.markDirty();
    this.t1Cards.splice(i, 1);
    this.t1CardUploading.splice(i, 1);
  }

  async onT1CardImage(ev: Event, i: number): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.t1CardUploading[i] = true;
    try {
      const res = await firstValueFrom(this.sprechenApi.uploadCardImage(file));
      this.t1Cards[i].imageUrl = res.canonicalUrl || res.url || '';
      this.markDirty();
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Upload failed';
    } finally {
      this.t1CardUploading[i] = false;
    }
  }

  // ── Teil 2 card management ─────────────────────────────────────────────────

  addT2Card(): void {
    this.markDirty();
    this.t2Cards.push({ title: '', subPrompts: ['', '', '', ''], imageUrl: '' });
    this.t2CardUploading.push(false);
  }

  removeT2Card(i: number): void {
    this.markDirty();
    this.t2Cards.splice(i, 1);
    this.t2CardUploading.splice(i, 1);
  }

  addSubPrompt(card: SprechenA2MonologueCard): void {
    this.markDirty();
    card.subPrompts.push('');
  }

  removeSubPrompt(card: SprechenA2MonologueCard, pi: number): void {
    this.markDirty();
    card.subPrompts.splice(pi, 1);
  }

  async onT2CardImage(ev: Event, i: number): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.t2CardUploading[i] = true;
    try {
      const res = await firstValueFrom(this.sprechenApi.uploadCardImage(file));
      this.t2Cards[i].imageUrl = res.canonicalUrl || res.url || '';
      this.markDirty();
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Upload failed';
    } finally {
      this.t2CardUploading[i] = false;
    }
  }

  // ── Teil 3 timetable management ────────────────────────────────────────────

  async onStudentTimetableImage(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.studentTimetableUploading = true;
    try {
      const res = await firstValueFrom(this.sprechenApi.uploadCardImage(file));
      this.studentTimetableImageUrl = res.canonicalUrl || res.url || '';
      this.markDirty();
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Upload failed';
    } finally {
      this.studentTimetableUploading = false;
    }
  }

  async onBotTimetableImage(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.botTimetableUploading = true;
    try {
      const res = await firstValueFrom(this.sprechenApi.uploadCardImage(file));
      this.botTimetableImageUrl = res.canonicalUrl || res.url || '';
      this.markDirty();
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Upload failed';
    } finally {
      this.botTimetableUploading = false;
    }
  }

  addStudentSlot(): void {
    this.markDirty();
    this.studentSlots.push({ start: '', end: '', activity: '', busy: false });
  }

  removeStudentSlot(i: number): void {
    this.markDirty();
    this.studentSlots.splice(i, 1);
  }

  addBotSlot(): void {
    this.markDirty();
    this.botSlots.push({ start: '', end: '', activity: '', busy: true });
  }

  removeBotSlot(i: number): void {
    this.markDirty();
    this.botSlots.splice(i, 1);
  }

  getImagePreviewUrl(url?: string): string { return resolveMediaUrl(url); }

  // ── Batch management ───────────────────────────────────────────────────────

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

  onWeeklyTestToggle(on: boolean): void {
    this.editWeeklyTestEnabled = !!on;
    if (this.editWeeklyTestEnabled) this.editExamEnabled = false;
  }

  onExamToggle(on: boolean): void {
    this.editExamEnabled = !!on;
    if (this.editExamEnabled) this.editWeeklyTestEnabled = false;
  }

  // ── Validation & save ──────────────────────────────────────────────────────

  private _validate(): boolean {
    this.missingFields.clear();
    if (!this.editTitle.trim()) this.missingFields.add('title');
    if (!this.editDescription.trim()) this.missingFields.add('description');
    if (!this.editCharacterId) this.missingFields.add('characterId');
    return this.missingFields.size === 0;
  }

  private _resolveCourseDayForSave(): number | null {
    const raw = this.editCourseDay;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(200, Math.max(1, Math.floor(n)));
  }

  private _courseDayForInput(day: number | null | undefined): string | number {
    if (day == null || day <= 0) return '';
    return day;
  }

  private _buildPayload(): Partial<SprechenExamModuleSummary> {
    const courseDay = this._resolveCourseDayForSave();
    return {
      title: this.editTitle.trim(),
      description: this.editDescription.trim(),
      level: 'A2',
      examFormat: 'A2',
      passThreshold: Number(this.editPassThreshold) || 10,
      visibleToStudents: this.editVisible,
      weeklyTestEnabled: !!this.editWeeklyTestEnabled && !this.editExamEnabled,
      examEnabled: !!this.editExamEnabled && !this.editWeeklyTestEnabled,
      courseDay: courseDay as unknown as number | undefined,
      targetBatchKeys: [...this.targetBatches],
      characterId: this.editCharacterId,
      a2Teil1: {
        instructionDe: this.t1InstructionDe.trim(),
        cards: this.t1Cards
          .filter((c) => c.prompt?.trim())
          .map((c) => ({
            prompt: c.prompt.trim(),
            sublabel: (c.sublabel || '').trim(),
            imageUrl: c.imageUrl ? canonicalizeStoredMediaUrl(c.imageUrl) : '',
          })),
      },
      a2Teil2: {
        instructionDe: this.t2InstructionDe.trim(),
        cards: this.t2Cards
          .filter((c) => c.title?.trim())
          .map((c) => ({
            title: c.title.trim(),
            subPrompts: (c.subPrompts || []).map((s) => s.trim()).filter(Boolean),
            imageUrl: c.imageUrl ? canonicalizeStoredMediaUrl(c.imageUrl) : '',
          })),
      },
      a2Teil3: {
        scenarioDe: this.t3ScenarioDe.trim(),
        dateLabel: this.t3DateLabel.trim(),
        studentTimetable: {
          imageUrl: this.studentTimetableImageUrl ? canonicalizeStoredMediaUrl(this.studentTimetableImageUrl) : '',
          slots: this.studentSlots.map((s) => ({ ...s })),
        },
        botTimetable: {
          imageUrl: this.botTimetableImageUrl ? canonicalizeStoredMediaUrl(this.botTimetableImageUrl) : '',
          slots: this.botSlots.map((s) => ({ ...s })),
        },
      },
    };
  }

  async save(): Promise<void> {
    if (!this._validate()) {
      this.messageType = 'error';
      this.message = 'Please fill in all required fields.';
      return;
    }
    if (this.saving) return;
    this.saving = true;
    this.message = null;

    try {
      if (this.isCreateMode) {
        const created = await firstValueFrom(
          this.sprechenApi
            .createModule(this._buildPayload())
            .pipe(timeout(SprechenA2AdminModuleFormComponent.SAVE_TIMEOUT_MS)),
        );
        this.router.navigate(['/admin/sprechen-exam'], { queryParams: { saved: created._id } });
      } else if (this.selected?._id) {
        const id = this.selected._id;
        const updated = await firstValueFrom(
          (this.examContentDirty
            ? this.sprechenApi.updateModule(id, this._buildPayload())
            : this.sprechenApi.patchModuleMetadata(id, {
                title: this.editTitle.trim(),
                description: this.editDescription.trim(),
                passThreshold: Number(this.editPassThreshold) || 10,
                visibleToStudents: this.editVisible,
                weeklyTestEnabled: !!this.editWeeklyTestEnabled && !this.editExamEnabled,
                examEnabled: !!this.editExamEnabled && !this.editWeeklyTestEnabled,
                courseDay: this._resolveCourseDayForSave() as unknown as number | undefined,
                targetBatchKeys: [...this.targetBatches],
                characterId: this.editCharacterId,
              })
          ).pipe(timeout(SprechenA2AdminModuleFormComponent.SAVE_TIMEOUT_MS)),
        );
        if (this.examContentDirty) {
          this._hydrate(updated as SprechenExamModuleSummary);
        }
        this.messageType = 'success';
        this.message = 'Module saved.';
      }
    } catch (e: any) {
      this.messageType = 'error';
      if (e instanceof TimeoutError || e?.name === 'TimeoutError') {
        this.message = 'Save timed out. Confirm the API server is running, then try again.';
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
