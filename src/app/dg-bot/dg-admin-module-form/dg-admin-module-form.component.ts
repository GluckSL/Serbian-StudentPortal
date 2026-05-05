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

  selected: DgModuleSummary | null = null;
  editTitle = '';
  editDescription = '';
  editLevel = '';
  editLanguage = 'German';
  editNativeLanguage = 'English';
  editMinimumCompletionTime = 10;
  editMinPracticeMinutes = 10;
  editMaxPracticeMinutes = '';
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
        this.message = 'Missing module id.';
        this.selected = null;
      }
    } catch (e: any) {
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

  private hydrateFromModule(row: DgModuleSummary): void {
    this.selected = row;
    this.editTitle = row.title;
    this.editDescription = row.description || '';
    this.editLevel = row.level || '';
    this.editLanguage = row.language || 'German';
    this.editNativeLanguage = row.nativeLanguage || 'English';
    this.editMinimumCompletionTime =
      row.minimumCompletionTime != null ? row.minimumCompletionTime : 10;
    this.editMinPracticeMinutes =
      row.minPracticeMinutes != null ? row.minPracticeMinutes : (row.minimumCompletionTime != null ? row.minimumCompletionTime : 10);
    this.editMaxPracticeMinutes =
      row.maxPracticeMinutes != null ? String(row.maxPracticeMinutes) : '';
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
    this.editMinimumCompletionTime = 10;
    this.editMinPracticeMinutes = 10;
    this.editMaxPracticeMinutes = '';
    this.editCourseDay = '';
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
    const mct = Number(this.editMinimumCompletionTime);
    const minPractice = Number(this.editMinPracticeMinutes);
    const maxPracticeRaw = (this.editMaxPracticeMinutes || '').trim();
    const maxPractice = maxPracticeRaw === '' ? null : Number(maxPracticeRaw);
    const cdRaw = (this.editCourseDay || '').trim();
    const courseDayPayload = cdRaw === '' ? null : Number(cdRaw);
    return {
      title: this.editTitle.trim(),
      description: this.editDescription.trim(),
      level: this.editLevel.trim(),
      language: this.editLanguage,
      nativeLanguage: this.editNativeLanguage,
      minimumCompletionTime: mct,
      minPracticeMinutes: minPractice,
      maxPracticeMinutes: maxPractice,
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
    this.message = null;
    const missing: string[] = [];
    if (!this.editTitle?.trim()) missing.push('Module title');
    if (!this.editDescription?.trim()) missing.push('Description');
    if (!this.editLanguage?.trim()) missing.push('Target language');
    if (!this.editNativeLanguage?.trim()) missing.push('Native language');
    if (!this.editLevel?.trim()) missing.push('Level');
    const mct = Number(this.editMinimumCompletionTime);
    if (Number.isNaN(mct) || mct < 5 || mct > 60) {
      missing.push('Minimum completion time (5–60 minutes)');
    }
    const minPractice = Number(this.editMinPracticeMinutes);
    if (Number.isNaN(minPractice) || minPractice < 5 || minPractice > 120) {
      missing.push('Min practice time (5–120 minutes)');
    }
    const maxPracticeRaw = (this.editMaxPracticeMinutes || '').trim();
    if (maxPracticeRaw !== '') {
      const maxPractice = Number(maxPracticeRaw);
      if (Number.isNaN(maxPractice) || maxPractice < 5 || maxPractice > 180) {
        missing.push('Max practice time (5–180 minutes or empty)');
      } else if (!Number.isNaN(minPractice) && maxPractice < minPractice) {
        missing.push('Max practice time must be >= min practice time');
      }
    }
    if (!this.editRolePlay.situation?.trim()) missing.push('Situation');
    if (!this.editRolePlay.studentRole?.trim()) missing.push('Student role');
    if (!this.editRolePlay.aiRole?.trim()) missing.push('AI role');
    if (!this.editCharacterId) missing.push('Character');
    const hasPracticeScene = this.editScenes.some((s) => s.type === 'practice');
    if (!hasPracticeScene) {
      missing.push('At least one Practice scene (for student speaking)');
    }
    const cdRaw = (this.editCourseDay || '').trim();
    if (cdRaw !== '') {
      const cd = Number(cdRaw);
      if (Number.isNaN(cd) || cd < 1 || cd > 200) {
        missing.push('Course day (1–200 or leave empty)');
      }
    }
    if (missing.length) {
      this.message = `Please fix: ${missing.join('; ')}.`;
      return false;
    }

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
        this.message = 'Saved draft for preview.';
      }
      return true;
    } catch (e: any) {
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
      this.message = visible ? 'Published.' : 'Unpublished.';
    } catch (e: any) {
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
      this.message = e?.error?.message || 'Delete failed';
    }
  }

  async createCharacterQuick(): Promise<void> {
    if (!this.newCharName.trim()) {
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
      this.newCharName = '';
      this.newCharAvatar = '';
      this.message = 'Character created.';
    } catch (e: any) {
      this.message = e?.error?.message || 'Character create failed';
    }
  }
}
