import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { DgApiService } from '../dg-api.service';
import { LearningModulesService } from '../../services/learning-modules.service';
import { environment } from '../../../environments/environment';
import type {
  DgCharacterDoc,
  DgConversationFlowStage,
  DgGrammarEntry,
  DgModuleSummary,
  DgRolePlayScenario,
  DgScene,
  DgSceneType,
  DgVocabEntry,
} from '../dg-bot.types';

interface BatchSummary {
  batchName: string;
}

function emptyRolePlayScenario(): DgRolePlayScenario {
  return {
    situation: '',
    setting: '',
    studentRole: '',
    aiRole: '',
    objective: '',
    aiPersonality: '',
    studentGuidance: '',
    aiOpeningLines: [],
    suggestedStudentResponses: [],
  };
}

@Component({
  selector: 'app-dg-admin-module-form',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './dg-admin-module-form.component.html',
  styleUrls: ['./dg-admin-module-form.component.scss'],
})
export class DgAdminModuleFormComponent implements OnInit {
  formMode: 'create' | 'edit' = 'edit';
  characters: DgCharacterDoc[] = [];
  loading = true;
  saving = false;
  message: string | null = null;
  messageType: 'error' | 'success' | 'info' = 'info';
  missingFields = new Set<string>();
  missingFieldLabels: string[] = [];

  aiSceneCount = 8;
  aiSceneReplace = true;
  aiGenerating = false;

  selected: DgModuleSummary | null = null;
  editTitle = '';
  editDescription = '';
  editLevel = '';
  editLanguage = 'German';
  editNativeLanguage = 'English';
  editMinimumCompletionTime = 5;
  editMaxPracticeMinutes: number | null = null;
  editCourseDay = '';
  editCharacterId = '';
  editVisible = false;
  editScenes: DgScene[] = [];

  cefrLevels: string[] = [];
  targetLanguages: string[] = [];
  nativeLanguages: string[] = [];

  newCharName = '';
  newCharAvatar = '';
  newCharVoice = 'alloy';

  editRolePlay: DgRolePlayScenario = emptyRolePlayScenario();
  allowedVocabulary: DgVocabEntry[] = [];
  aiTutorVocabulary: DgVocabEntry[] = [];
  allowedGrammar: DgGrammarEntry[] = [];
  conversationFlow: DgConversationFlowStage[] = [];

  batches: BatchSummary[] = [];
  batchToAdd = '';
  targetBatches: string[] = [];

  newVocabWord = '';
  newVocabTranslation = '';
  newVocabCategory = '';
  newAiVocabWord = '';
  newAiVocabTranslation = '';
  newAiVocabCategory = '';
  newAiVocabUsage = '';
  newGrammarStructure = '';
  newGrammarExample = '';
  newFlowStage = '';
  newFlowAiPrompt = '';
  newFlowExpectedResponse = '';
  newFlowHelpful = '';
  newAiOpeningLine = '';
  newStudentResponse = '';

  /** True while PDF/DOCX → AI vocabulary import is running */
  aiVocabDocImporting = false;

  sceneTypes: DgSceneType[] = ['intro', 'teach', 'practice', 'feedback'];

  get isCreateMode(): boolean {
    return !this.selected?._id;
  }

  constructor(
    private dgApi: DgApiService,
    private router: Router,
    private route: ActivatedRoute,
    private learningModules: LearningModulesService,
    private http: HttpClient,
  ) {}

  async ngOnInit(): Promise<void> {
    this.cefrLevels = this.learningModules.getAvailableLevels();
    this.targetLanguages = this.learningModules.getAvailableLanguages();
    this.nativeLanguages = this.learningModules.getAvailableNativeLanguages();

    const mode = this.route.snapshot.data['dgFormMode'] as string | undefined;
    this.formMode = mode === 'create' ? 'create' : 'edit';
    const id = this.route.snapshot.paramMap.get('id');

    this.loading = true;
    this.message = null;
    try {
      await this.loadBatches();
      const { characters } = await firstValueFrom(this.dgApi.listCharacters());
      this.characters = characters || [];
      if (this.formMode === 'create') {
        this.initNewModule();
      } else if (id) {
        const mod = await firstValueFrom(this.dgApi.getAdminModule(id));
        this.hydrateFromModule(mod);
      } else {
        this.messageType = 'error';
        this.message = 'Missing module id.';
        this.selected = null;
      }
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Load failed';
      this.selected = null;
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

  goBack(): void {
    this.router.navigate(['/admin/dg-modules']);
  }

  isInvalid(key: string): boolean {
    return this.missingFields.has(key);
  }

  private clearMissingField(key: string): void {
    if (this.missingFields.has(key)) {
      this.missingFields.delete(key);
      if (this.missingFields.size === 0) {
        this.message = null;
        this.missingFieldLabels = [];
      }
    }
  }

  onFieldInput(key: string): void {
    this.clearMissingField(key);
  }

  private scrollToFirstMissingField(): void {
    const first = this.missingFields.values().next().value as string | undefined;
    if (!first) return;
    setTimeout(() => {
      const el =
        (document.querySelector(`[name="${first}"]`) as HTMLElement | null) ||
        (document.getElementById('dg-form-alert') as HTMLElement | null);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof (el as HTMLInputElement).focus === 'function') {
          try {
            (el as HTMLInputElement).focus({ preventScroll: true });
          } catch {
            (el as HTMLInputElement).focus();
          }
        }
      }
    }, 0);
  }

  private hydrateFromModule(row: DgModuleSummary): void {
    this.selected = row;
    this.editTitle = row.title;
    this.editDescription = row.description || '';
    this.editLevel = row.level || '';
    this.editLanguage = row.language || 'German';
    this.editNativeLanguage = row.nativeLanguage || 'English';
    this.editMinimumCompletionTime =
      row.minimumCompletionTime != null ? row.minimumCompletionTime : 5;
    this.editMaxPracticeMinutes =
      row.maxPracticeMinutes != null ? row.maxPracticeMinutes : null;
    this.editCourseDay =
      row.courseDay != null && row.courseDay > 0 ? String(row.courseDay) : '';
    this.editCharacterId =
      typeof row.characterId === 'string' ? row.characterId : (row.characterId as any)?._id || '';
    this.editVisible = !!row.visibleToStudents;
    this.targetBatches = Array.isArray(row.targetBatches) ? [...row.targetBatches] : [];
    this.editScenes = JSON.parse(JSON.stringify(row.scenes || [])).sort(
      (a: DgScene, b: DgScene) => (a.order || 0) - (b.order || 0),
    );
    if (!this.editScenes.length) {
      this.addScene();
    }
    this.loadTeachingFromModule(row);
  }

  private initNewModule(): void {
    this.selected = { _id: '', title: 'New DG module', scenes: [] } as DgModuleSummary;
    this.editTitle = 'New DG module';
    this.editDescription = '';
    this.editLevel = '';
    this.editLanguage = 'German';
    this.editNativeLanguage = 'English';
    this.editMinimumCompletionTime = 5;
    this.editMaxPracticeMinutes = null;
    this.editCharacterId =
      this.characters.find((c) => c.isDefault)?._id || this.characters[0]?._id || '';
    this.editVisible = false;
    this.targetBatches = [];
    this.editScenes = [
      {
        type: 'intro',
        text: "Hi! I'm your digital guide. Let's learn together.",
        expectedAnswer: '',
        translation: '',
        hint: '',
        order: 0,
      },
    ];
    this.loadTeachingFromModule(null);
  }

  private loadTeachingFromModule(row: DgModuleSummary | null): void {
    if (!row) {
      this.editRolePlay = emptyRolePlayScenario();
      this.allowedVocabulary = [];
      this.aiTutorVocabulary = [];
      this.allowedGrammar = [];
      this.conversationFlow = [];
      return;
    }
    this.editRolePlay = JSON.parse(
      JSON.stringify({ ...emptyRolePlayScenario(), ...(row.rolePlayScenario || {}) }),
    ) as DgRolePlayScenario;
    this.editRolePlay.aiOpeningLines = [...(this.editRolePlay.aiOpeningLines || [])];
    this.editRolePlay.suggestedStudentResponses = [
      ...(this.editRolePlay.suggestedStudentResponses || []),
    ];
    this.allowedVocabulary = JSON.parse(JSON.stringify(row.allowedVocabulary || []));
    this.aiTutorVocabulary = JSON.parse(JSON.stringify(row.aiTutorVocabulary || []));
    this.allowedGrammar = JSON.parse(JSON.stringify(row.allowedGrammar || []));
    this.conversationFlow = JSON.parse(JSON.stringify(row.conversationFlow || []));
  }

  addVocabulary(): void {
    if (!this.newVocabWord.trim() || !this.newVocabTranslation.trim()) return;
    this.allowedVocabulary.push({
      word: this.newVocabWord.trim(),
      translation: this.newVocabTranslation.trim(),
      category: this.newVocabCategory.trim() || 'general',
    });
    this.newVocabWord = '';
    this.newVocabTranslation = '';
    this.newVocabCategory = '';
  }

  removeVocabulary(i: number): void {
    this.allowedVocabulary.splice(i, 1);
  }

  addAiVocabulary(): void {
    if (!this.newAiVocabWord.trim() || !this.newAiVocabTranslation.trim()) return;
    this.aiTutorVocabulary.push({
      word: this.newAiVocabWord.trim(),
      translation: this.newAiVocabTranslation.trim(),
      category: this.newAiVocabCategory.trim() || 'general',
      usage: this.newAiVocabUsage.trim() || undefined,
    });
    this.newAiVocabWord = '';
    this.newAiVocabTranslation = '';
    this.newAiVocabCategory = '';
    this.newAiVocabUsage = '';
  }

  removeAiVocabulary(i: number): void {
    this.aiTutorVocabulary.splice(i, 1);
  }

  triggerAiVocabDocumentPicker(input: HTMLInputElement): void {
    if (this.aiVocabDocImporting) return;
    input.click();
  }

  async onAiVocabDocumentSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.aiVocabDocImporting = true;
    this.message = null;
    try {
      const res = await firstValueFrom(
        this.dgApi.importAiTutorVocabularyFromDocument(file, this.editLanguage, this.editNativeLanguage),
      );
      const rows = res?.vocabulary || [];
      let added = 0;
      for (const v of rows) {
        const word = String(v?.word || '').trim();
        const translation = String(v?.translation || '').trim();
        if (!word || !translation) continue;
        const exists = this.aiTutorVocabulary.some((a) => a.word.toLowerCase() === word.toLowerCase());
        if (exists) continue;
        const category = String(v?.category || '').trim() || 'general';
        const usageRaw = v?.usage != null ? String(v.usage).trim() : '';
        this.aiTutorVocabulary.push({
          word,
          translation,
          category,
          ...(usageRaw ? { usage: usageRaw } : {}),
        });
        added++;
      }
      this.messageType = added ? 'success' : 'info';
      this.message = added
        ? `Imported ${added} new word(s) from your document (${rows.length} extracted). Review the list below, then save.`
        : rows.length
          ? 'All words from the document were already in the AI vocabulary list.'
          : 'No vocabulary rows returned. Try a file with a clearer word list or glossary.';
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || e?.message || 'Document import failed';
    } finally {
      this.aiVocabDocImporting = false;
    }
  }

  copyStudentVocabToAi(): void {
    let n = 0;
    for (const v of this.allowedVocabulary) {
      const exists = this.aiTutorVocabulary.some(
        (a) => a.word.toLowerCase() === v.word.toLowerCase(),
      );
      if (!exists) {
        this.aiTutorVocabulary.push({
          word: v.word,
          translation: v.translation,
          category: v.category,
        });
        n++;
      }
    }
    this.messageType = n ? 'success' : 'info';
    this.message = n ? `Copied ${n} word(s) to AI vocabulary.` : 'Nothing to copy (empty or all already present).';
  }

  addGrammar(): void {
    if (!this.newGrammarStructure.trim()) return;
    const existing = this.allowedGrammar.find((g) => g.structure === this.newGrammarStructure.trim());
    if (existing && this.newGrammarExample.trim()) {
      existing.examples.push(this.newGrammarExample.trim());
    } else if (!existing) {
      this.allowedGrammar.push({
        structure: this.newGrammarStructure.trim(),
        examples: this.newGrammarExample.trim() ? [this.newGrammarExample.trim()] : [],
        level: this.editLevel || 'A1',
      });
    }
    this.newGrammarStructure = '';
    this.newGrammarExample = '';
  }

  removeGrammar(i: number): void {
    this.allowedGrammar.splice(i, 1);
  }

  addConversationFlow(): void {
    if (!this.newFlowStage.trim()) return;
    const helpful = this.newFlowHelpful
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    this.conversationFlow.push({
      stage: this.newFlowStage.trim(),
      aiPrompts: this.newFlowAiPrompt.trim() ? [this.newFlowAiPrompt.trim()] : [],
      expectedResponses: this.newFlowExpectedResponse.trim() ? [this.newFlowExpectedResponse.trim()] : [],
      helpfulPhrases: helpful,
    });
    this.newFlowStage = '';
    this.newFlowAiPrompt = '';
    this.newFlowExpectedResponse = '';
    this.newFlowHelpful = '';
  }

  removeConversationFlow(i: number): void {
    this.conversationFlow.splice(i, 1);
  }

  addAiOpeningLine(): void {
    if (!this.newAiOpeningLine.trim()) return;
    this.editRolePlay.aiOpeningLines = this.editRolePlay.aiOpeningLines || [];
    this.editRolePlay.aiOpeningLines.push(this.newAiOpeningLine.trim());
    this.newAiOpeningLine = '';
  }

  removeAiOpeningLine(i: number): void {
    this.editRolePlay.aiOpeningLines?.splice(i, 1);
  }

  addStudentResponse(): void {
    if (!this.newStudentResponse.trim()) return;
    this.editRolePlay.suggestedStudentResponses = this.editRolePlay.suggestedStudentResponses || [];
    this.editRolePlay.suggestedStudentResponses.push(this.newStudentResponse.trim());
    this.newStudentResponse = '';
  }

  removeStudentResponse(i: number): void {
    this.editRolePlay.suggestedStudentResponses?.splice(i, 1);
  }

  addScene(): void {
    const order = this.editScenes.length;
    this.editScenes.push({
      type: 'teach',
      text: '',
      expectedAnswer: '',
      translation: '',
      hint: '',
      order,
    });
  }

  async generateScenesWithAi(): Promise<void> {
    const count = Math.max(2, Math.min(30, Number(this.aiSceneCount) || 8));
    this.aiSceneCount = count;

    const blockingErrors: string[] = [];
    if (!this.editRolePlay.situation?.trim()) blockingErrors.push('Situation');
    if (!this.editRolePlay.studentRole?.trim()) blockingErrors.push('Student role');
    if (!this.editRolePlay.aiRole?.trim()) blockingErrors.push('AI role');
    if (
      this.allowedVocabulary.length === 0 &&
      this.aiTutorVocabulary.length === 0
    ) {
      blockingErrors.push('At least one vocabulary word (Student or AI Tutor)');
    }
    if (blockingErrors.length) {
      this.messageType = 'error';
      this.message =
        'Before AI can build scenes, please fill: ' + blockingErrors.join(', ') + '.';
      return;
    }

    this.aiGenerating = true;
    this.messageType = 'info';
    this.message = `Generating ${count} scene${count === 1 ? '' : 's'} with AI…`;

    try {
      const res = await firstValueFrom(
        this.dgApi.generateScenes({
          count,
          level: this.editLevel,
          language: this.editLanguage,
          nativeLanguage: this.editNativeLanguage,
          rolePlayScenario: this.editRolePlay,
          allowedVocabulary: this.allowedVocabulary,
          aiTutorVocabulary: this.aiTutorVocabulary,
          allowedGrammar: this.allowedGrammar,
        }),
      );
      const generated: DgScene[] = (res?.scenes || []).map((s, i) => ({
        type: (s.type || 'teach') as DgSceneType,
        text: s.text || '',
        expectedAnswer: s.expectedAnswer || '',
        translation: s.translation || '',
        hint: s.hint || '',
        order: i,
      }));
      if (!generated.length) {
        throw new Error('AI returned no scenes.');
      }

      if (this.aiSceneReplace) {
        this.editScenes = generated;
      } else {
        const startOrder = this.editScenes.length;
        this.editScenes = [
          ...this.editScenes,
          ...generated.map((g, i) => ({ ...g, order: startOrder + i })),
        ];
      }
      this.renumber();
      this.messageType = 'success';
      this.message = `Generated ${generated.length} scene${generated.length === 1 ? '' : 's'} from your role-play context.`;
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || e?.message || 'AI scene generation failed.';
    } finally {
      this.aiGenerating = false;
    }
  }

  removeScene(i: number): void {
    this.editScenes.splice(i, 1);
    this.renumber();
  }

  drop(ev: CdkDragDrop<DgScene[]>): void {
    moveItemInArray(this.editScenes, ev.previousIndex, ev.currentIndex);
    this.renumber();
  }

  private renumber(): void {
    this.editScenes.forEach((s, i) => (s.order = i));
  }

  private buildModulePayload() {
    const duration = Number(this.editMinimumCompletionTime);
    const cdRaw = (this.editCourseDay || '').trim();
    const courseDayPayload = cdRaw === '' ? null : Number(cdRaw);
    return {
      title: this.editTitle.trim(),
      description: this.editDescription.trim(),
      level: this.editLevel.trim(),
      language: this.editLanguage,
      nativeLanguage: this.editNativeLanguage,
      minimumCompletionTime: duration,
      minPracticeMinutes: duration,
      maxPracticeMinutes: this.editMaxPracticeMinutes ?? null,
      courseDay: courseDayPayload,
      characterId: this.editCharacterId,
      visibleToStudents: this.editVisible,
      targetBatches: this.targetBatches,
      rolePlayScenario: this.editRolePlay,
      allowedVocabulary: this.allowedVocabulary,
      aiTutorVocabulary: this.aiTutorVocabulary,
      allowedGrammar: this.allowedGrammar,
      conversationFlow: this.conversationFlow,
      scenes: this.editScenes.map((s) => ({
        _id: s._id,
        type: s.type,
        text: s.text,
        audioUrl: s.audioUrl || '',
        expectedAnswer: s.expectedAnswer || '',
        translation: s.translation || '',
        hint: s.hint || '',
        order: s.order,
      })),
    };
  }

  async save(navigateAfterSave = true): Promise<boolean> {
    // #region agent log
    fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'578490'},body:JSON.stringify({sessionId:'578490',location:'dg-admin-module-form.ts:save-entry',message:'save() called',data:{title:this.editTitle,duration:this.editMinimumCompletionTime,charId:this.editCharacterId,level:this.editLevel,saving:this.saving},timestamp:Date.now(),hypothesisId:'H-B,H-C'})}).catch(()=>{});
    // #endregion
    this.message = null;
    this.missingFields = new Set<string>();
    this.missingFieldLabels = [];

    const fail = (key: string, label: string) => {
      this.missingFields.add(key);
      this.missingFieldLabels.push(label);
    };

    if (!this.editTitle?.trim()) fail('title', 'Module title');
    if (!this.editDescription?.trim()) fail('description', 'Description');
    if (!this.editLanguage?.trim()) fail('targetLang', 'Target language');
    if (!this.editNativeLanguage?.trim()) fail('nativeLang', 'Native language');
    if (!this.editLevel?.trim()) fail('cefrLevel', 'Level');
    const duration = Number(this.editMinimumCompletionTime);
    if (Number.isNaN(duration) || duration < 2) {
      fail('duration', 'Duration must be at least 2 minutes');
    }
    if (this.editMaxPracticeMinutes != null) {
      const maxMin = Number(this.editMaxPracticeMinutes);
      if (Number.isNaN(maxMin) || maxMin < 5 || maxMin > 180) {
        fail('maxTime', 'Maximum time must be between 5 and 180 minutes');
      } else if (!Number.isNaN(duration) && maxMin < duration) {
        fail('maxTime', 'Maximum time must be ≥ duration');
      }
    }
    if (!this.editRolePlay.situation?.trim()) fail('rpsSit', 'Situation');
    if (!this.editRolePlay.studentRole?.trim()) fail('rpsSr', 'Student role');
    if (!this.editRolePlay.aiRole?.trim()) fail('rpsAr', 'AI role');
    if (!this.editCharacterId) fail('char', 'Character');
    const cdRaw = (this.editCourseDay || '').trim();
    if (cdRaw !== '') {
      const cd = Number(cdRaw);
      if (Number.isNaN(cd) || cd < 1 || cd > 200) {
        fail('courseDay', 'Course day (1–200 or leave empty)');
      }
    }
    if (this.missingFieldLabels.length) {
      // #region agent log
      fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'578490'},body:JSON.stringify({sessionId:'578490',location:'dg-admin-module-form.ts:validation-blocked',message:'validation blocked save',data:{missingFields:Array.from(this.missingFields),missingLabels:this.missingFieldLabels},timestamp:Date.now(),hypothesisId:'H-A,H-C'})}).catch(()=>{});
      // #endregion
      this.messageType = 'error';
      this.message = 'Please fill in the required fields highlighted below before saving.';
      this.scrollToFirstMissingField();
      return false;
    }

    // #region agent log
    fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'578490'},body:JSON.stringify({sessionId:'578490',location:'dg-admin-module-form.ts:validation-passed',message:'validation passed, proceeding to API call',data:{},timestamp:Date.now(),hypothesisId:'H-D'})}).catch(()=>{});
    // #endregion
    this.saving = true;
    this.renumber();
    const body = this.buildModulePayload();
    try {
      if (!this.selected?._id) {
        const created = await firstValueFrom(this.dgApi.createModule(body as any));
        this.selected = created;
      } else {
        const updated = await firstValueFrom(this.dgApi.updateModule(this.selected._id, body as any));
        this.selected = updated;
      }
      if (navigateAfterSave) {
        this.router.navigate(['/admin/dg-modules'], {
          queryParams: {
            saved: this.selected?._id || '',
            status: 'all',
          },
        });
      } else {
        this.messageType = 'success';
        this.message = 'Saved draft for preview.';
      }
      return true;
    } catch (e: any) {
      // #region agent log
      fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'578490'},body:JSON.stringify({sessionId:'578490',location:'dg-admin-module-form.ts:api-error',message:'API call threw error',data:{status:e?.status,errMsg:e?.error?.message,rawMsg:e?.message},timestamp:Date.now(),hypothesisId:'H-D'})}).catch(()=>{});
      // #endregion
      this.messageType = 'error';
      this.message = e?.error?.message || 'Save failed';
      return false;
    } finally {
      this.saving = false;
    }
  }

  async togglePublish(visible: boolean): Promise<void> {
    if (!this.selected?._id) return;
    try {
      await firstValueFrom(this.dgApi.patchModuleVisibility(this.selected._id, visible));
      this.editVisible = visible;
      this.messageType = 'success';
      this.message = visible ? 'Published.' : 'Unpublished.';
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Update failed';
    }
  }

  /**
   * If the module only has the default intro scene but has vocabulary,
   * auto-generate teach → practice → feedback scenes so the player
   * has content to walk through.
   */
  private ensureScenesFromContent(): void {
    const onlyIntro =
      this.editScenes.length === 1 && this.editScenes[0].type === 'intro';
    if (!onlyIntro || this.allowedVocabulary.length === 0) return;

    const intro = this.editScenes[0];
    const generated: DgScene[] = [intro];

    // Teach scenes — one per vocab word (cap at 8)
    const teachWords = this.allowedVocabulary.slice(0, 8);
    for (const v of teachWords) {
      generated.push({
        type: 'teach',
        text: `${v.word} — ${v.translation}`,
        expectedAnswer: '',
        translation: v.translation,
        hint: '',
        order: generated.length,
      } as DgScene);
    }

    // Practice scenes — first 4 vocab words
    const practiceWords = this.allowedVocabulary.slice(0, Math.min(4, this.allowedVocabulary.length));
    for (const v of practiceWords) {
      generated.push({
        type: 'practice',
        text: `Say: ${v.word}`,
        expectedAnswer: v.word,
        translation: v.translation,
        hint: v.word,
        order: generated.length,
      } as DgScene);
    }

    // Closing feedback scene
    generated.push({
      type: 'feedback',
      text: "Great work! You have completed this lesson.",
      expectedAnswer: '',
      translation: '',
      hint: '',
      order: generated.length,
    } as DgScene);

    this.editScenes = generated;
    this.renumber();
  }

  async preview(): Promise<void> {
    if (!this.selected?._id) return;
    // Auto-build scenes from vocab if the user hasn't added any manually
    this.ensureScenesFromContent();
    const saved = await this.save(false);
    if (!saved || !this.selected?._id) return;
    this.router.navigate(['/dg-bot', this.selected._id, 'play']);
  }

  async removeModule(): Promise<void> {
    if (!this.selected?._id) return;
    if (!confirm('Archive this DG module?')) return;
    try {
      await firstValueFrom(this.dgApi.deleteModule(this.selected._id));
      this.router.navigate(['/admin/dg-modules']);
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Delete failed';
    }
  }

  async createCharacterQuick(): Promise<void> {
    if (!this.newCharName.trim()) {
      this.messageType = 'error';
      this.message = 'Character name required';
      return;
    }
    try {
      const doc = await firstValueFrom(
        this.dgApi.createCharacter({
          name: this.newCharName.trim(),
          avatarUrl: this.newCharAvatar.trim(),
          voice: this.newCharVoice.trim() || 'alloy',
          personality: 'Friendly · Supportive · Encouraging',
          isActive: true,
        }),
      );
      this.characters = [...this.characters, doc].sort((a, b) => a.name.localeCompare(b.name));
      this.editCharacterId = doc._id;
      this.missingFields.delete('char');
      this.newCharName = '';
      this.newCharAvatar = '';
      this.messageType = 'success';
      this.message = 'Character created.';
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || 'Character create failed';
    }
  }
}
