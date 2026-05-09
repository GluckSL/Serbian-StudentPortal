import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DgApiService } from '../../dg-bot/dg-api.service';
import { LearningModulesService } from '../../services/learning-modules.service';
import { environment } from '../../../environments/environment';
import type {
  DgConversationFlowStage,
  DgGrammarEntry,
  DgRolePlayScenario,
  DgScene,
  DgVocabEntry,
} from '../../dg-bot/dg-bot.types';

function defaultIntroScene(): DgScene {
  return {
    type: 'intro',
    text: "Hi! I'm your digital guide. Let's learn together.",
    expectedAnswer: '',
    translation: '',
    hint: '',
    order: 0,
  };
}

function emptyRolePlay(): DgRolePlayScenario {
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
  selector: 'app-roleplay-module-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './roleplay-module-form.component.html',
  styleUrls: ['./roleplay-module-form.component.scss'],
})
export class RoleplayModuleFormComponent implements OnInit {
  isEditMode = false;
  moduleId: string | null = null;
  /** True until default character (and module in edit mode) are loaded */
  pageLoading = true;
  saving = false;
  message: string | null = null;
  messageType: 'error' | 'success' | 'info' = 'info';
  missingFields = new Set<string>();
  missingFieldLabels: string[] = [];

  // Form fields
  editTitle = '';
  editDescription = '';
  editLanguage = 'German';
  editNativeLanguage = 'English';
  editLevel = '';
  editMinimumCompletionTime = 10;
  editCourseDay = '';

  // Role-play scenario
  editRolePlay: DgRolePlayScenario = emptyRolePlay();

  // Teaching lists
  allowedVocabulary: DgVocabEntry[] = [];
  aiTutorVocabulary: DgVocabEntry[] = [];
  allowedGrammar: DgGrammarEntry[] = [];
  conversationFlow: DgConversationFlowStage[] = [];

  // Dropdown options
  cefrLevels: string[] = [];
  targetLanguages: string[] = [];
  nativeLanguages: string[] = [];

  // Input staging fields
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
  newAiOpeningLine = '';
  newStudentResponse = '';

  isTranslating = false;
  aiVocabDocImporting = false;

  /** Required by DG API / mongoose schema */
  editCharacterId = '';
  /** Preserved from server on edit; default intro on create */
  editScenes: DgScene[] = [defaultIntroScene()];

  constructor(
    private dgApi: DgApiService,
    private learningModules: LearningModulesService,
    private router: Router,
    private route: ActivatedRoute,
    private http: HttpClient,
  ) {}

  async ngOnInit(): Promise<void> {
    this.cefrLevels = this.learningModules.getAvailableLevels();
    this.targetLanguages = this.learningModules.getAvailableLanguages();
    this.nativeLanguages = this.learningModules.getAvailableNativeLanguages();

    this.pageLoading = true;
    try {
      await this.loadDefaultCharacter();
      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        this.isEditMode = true;
        this.moduleId = id;
        await this.loadModule(id);
      }
    } finally {
      this.pageLoading = false;
    }
  }

  /** DG modules require characterId; use default tutor when none chosen in UI */
  private async loadDefaultCharacter(): Promise<void> {
    try {
      const { characters } = await firstValueFrom(this.dgApi.listCharacters());
      const cid = characters?.find((c) => c.isDefault)?._id || characters?.[0]?._id;
      if (cid) this.editCharacterId = cid;
    } catch {
      // save() will surface a clear validation error if still empty
    }
  }

  private async loadModule(id: string): Promise<void> {
    try {
      const mod = await firstValueFrom(this.dgApi.getAdminModule(id));
      this.editTitle = mod.title || '';
      this.editDescription = mod.description || '';
      this.editLanguage = mod.language || 'German';
      this.editNativeLanguage = mod.nativeLanguage || 'English';
      this.editLevel = mod.level || '';
      this.editMinimumCompletionTime =
        mod.minimumCompletionTime != null ? mod.minimumCompletionTime : 10;
      this.editCourseDay =
        mod.courseDay != null && mod.courseDay > 0 ? String(mod.courseDay) : '';
      this.editCharacterId =
        typeof mod.characterId === 'string'
          ? mod.characterId
          : (mod.characterId as { _id?: string } | undefined)?._id || this.editCharacterId;
      const rawScenes = mod.scenes?.length
        ? (JSON.parse(JSON.stringify(mod.scenes)) as DgScene[])
        : [defaultIntroScene()];
      this.editScenes = rawScenes.sort((a, b) => (a.order || 0) - (b.order || 0));
      this.editRolePlay = JSON.parse(
        JSON.stringify({ ...emptyRolePlay(), ...(mod.rolePlayScenario || {}) }),
      );
      this.editRolePlay.aiOpeningLines = [...(this.editRolePlay.aiOpeningLines || [])];
      this.editRolePlay.suggestedStudentResponses = [
        ...(this.editRolePlay.suggestedStudentResponses || []),
      ];
      this.allowedVocabulary = JSON.parse(JSON.stringify(mod.allowedVocabulary || []));
      this.aiTutorVocabulary = JSON.parse(JSON.stringify(mod.aiTutorVocabulary || []));
      this.allowedGrammar = JSON.parse(JSON.stringify(mod.allowedGrammar || []));
      this.conversationFlow = JSON.parse(JSON.stringify(mod.conversationFlow || []));
    } catch (e: unknown) {
      this.messageType = 'error';
      this.message = this.httpErrorMessage(e) || 'Failed to load module.';
    }
  }

  isInvalid(key: string): boolean {
    return this.missingFields.has(key);
  }

  onFieldInput(key: string): void {
    if (this.missingFields.has(key)) {
      this.missingFields.delete(key);
      if (this.missingFields.size === 0) {
        this.message = null;
        this.missingFieldLabels = [];
      }
    }
  }

  private scrollToAlert(): void {
    setTimeout(() => {
      const el = document.getElementById('rp-form-alert') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }

  async save(): Promise<void> {
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
    const mct = Number(this.editMinimumCompletionTime);
    if (Number.isNaN(mct) || mct < 5 || mct > 60) {
      fail('minComplete', 'Minimum completion time (5–60 min)');
    }
    const cdRaw = (this.editCourseDay || '').trim();
    if (cdRaw !== '') {
      const cd = Number(cdRaw);
      if (Number.isNaN(cd) || cd < 1 || cd > 200) {
        fail('courseDay', 'Course day (1–200 or leave empty)');
      }
    }
    if (!this.editRolePlay.situation?.trim()) fail('rpsSit', 'Situation');
    if (!this.editRolePlay.studentRole?.trim()) fail('rpsSr', 'Student role');
    if (!this.editRolePlay.aiRole?.trim()) fail('rpsAr', 'AI role');
    if (!this.editCharacterId?.trim()) {
      fail('char', 'DG tutor character (none available — ask an admin to configure DG characters)');
    }

    if (this.missingFieldLabels.length) {
      this.messageType = 'error';
      this.message = 'Please fill in the required fields highlighted below before saving.';
      this.scrollToAlert();
      return;
    }

    const courseDayPayload = cdRaw === '' ? null : Number(cdRaw);

    const scenesPayload = this.editScenes.map((s) => ({
      _id: s._id,
      type: s.type,
      text: s.text ?? '',
      audioUrl: s.audioUrl || '',
      expectedAnswer: s.expectedAnswer || '',
      translation: s.translation || '',
      hint: s.hint || '',
      order: s.order ?? 0,
    }));

    const payload = {
      title: this.editTitle.trim(),
      description: this.editDescription.trim(),
      language: this.editLanguage,
      nativeLanguage: this.editNativeLanguage,
      level: this.editLevel,
      characterId: this.editCharacterId,
      minimumCompletionTime: mct,
      minPracticeMinutes: mct,
      maxPracticeMinutes: null as number | null,
      courseDay: courseDayPayload,
      rolePlayScenario: this.editRolePlay,
      allowedVocabulary: this.allowedVocabulary,
      aiTutorVocabulary: this.aiTutorVocabulary,
      allowedGrammar: this.allowedGrammar,
      conversationFlow: this.conversationFlow,
      scenes: scenesPayload,
    };

    this.saving = true;
    try {
      if (this.isEditMode && this.moduleId) {
        await firstValueFrom(this.dgApi.updateModule(this.moduleId, payload));
      } else {
        await firstValueFrom(this.dgApi.createModule(payload));
      }
      this.router.navigate(['/learning-modules']);
    } catch (e: unknown) {
      this.messageType = 'error';
      this.message = this.httpErrorMessage(e);
      this.scrollToAlert();
    } finally {
      this.saving = false;
    }
  }

  private httpErrorMessage(e: unknown): string {
    const err = e as {
      error?: unknown;
      message?: string;
      status?: number;
      statusText?: string;
    };
    const body = err?.error;
    if (typeof body === 'string' && body.trim()) {
      try {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed?.message) return parsed.message;
      } catch {
        return body.trim().slice(0, 500);
      }
    }
    if (body && typeof body === 'object' && 'message' in body) {
      const m = (body as { message?: string }).message;
      if (typeof m === 'string' && m.trim()) return m.trim();
    }
    if (err?.status === 0 || err?.statusText === 'Unknown Error') {
      return 'Network error — could not reach the server. Check your connection and API URL.';
    }
    if (err?.message) return err.message;
    return 'Save failed. Please try again.';
  }

  goBack(): void {
    this.router.navigate(['/learning-modules']);
  }

  // ── Vocabulary (student) ──────────────────────────────────────────────────

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

  onStudentVocabCsvUpload(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const rows = this.parseCsvText(reader.result as string);
      let imported = 0;
      this.isTranslating = true;
      for (const row of rows) {
        if (this.isHeaderRow(row)) continue;
        if (row.length >= 1 && row[0]) {
          const word = row[0];
          const translation = row.length >= 2 && row[1] ? row[1] : await this.autoTranslate(word);
          this.allowedVocabulary.push({
            word,
            translation,
            category: (row.length >= 3 ? row[2] : '') || 'general',
          });
          imported++;
        }
      }
      this.isTranslating = false;
      this.messageType = 'success';
      this.message = `Imported ${imported} words to Student Vocabulary.`;
      (event.target as HTMLInputElement).value = '';
    };
    reader.readAsText(file);
  }

  // ── Vocabulary (AI tutor) ─────────────────────────────────────────────────

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
        this.aiTutorVocabulary.push({ word: v.word, translation: v.translation, category: v.category });
        n++;
      }
    }
    this.messageType = n ? 'success' : 'info';
    this.message = n
      ? `Copied ${n} word(s) to AI vocabulary.`
      : 'Nothing to copy (empty or all already present).';
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
        const usageRaw = v?.usage != null ? String(v.usage).trim() : '';
        this.aiTutorVocabulary.push({
          word,
          translation,
          category: String(v?.category || '').trim() || 'general',
          ...(usageRaw ? { usage: usageRaw } : {}),
        });
        added++;
      }
      this.messageType = added ? 'success' : 'info';
      this.message = added
        ? `Imported ${added} new word(s) from your document. Review the list below, then save.`
        : rows.length
          ? 'All words from the document were already in the AI vocabulary list.'
          : 'No vocabulary rows returned. Try a file with a clearer word list.';
    } catch (e: any) {
      this.messageType = 'error';
      this.message = e?.error?.message || e?.message || 'Document import failed.';
    } finally {
      this.aiVocabDocImporting = false;
    }
  }

  onAiVocabCsvUpload(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const rows = this.parseCsvText(reader.result as string);
      let imported = 0;
      this.isTranslating = true;
      for (const row of rows) {
        if (this.isHeaderRow(row)) continue;
        if (row.length >= 1 && row[0]) {
          const word = row[0];
          const translation = row.length >= 2 && row[1] ? row[1] : await this.autoTranslate(word);
          this.aiTutorVocabulary.push({
            word,
            translation,
            category: (row.length >= 3 ? row[2] : '') || 'general',
            usage: row.length >= 4 ? row[3] : undefined,
          });
          imported++;
        }
      }
      this.isTranslating = false;
      this.messageType = 'success';
      this.message = `Imported ${imported} words to AI Tutor Vocabulary.`;
      (event.target as HTMLInputElement).value = '';
    };
    reader.readAsText(file);
  }

  // ── Grammar ───────────────────────────────────────────────────────────────

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

  onGrammarCsvUpload(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = this.parseCsvText(reader.result as string);
      let imported = 0;
      for (const row of rows) {
        if (this.isHeaderRow(row)) continue;
        if (row.length >= 1 && row[0]) {
          const examples = row.slice(1)
            .join(',')
            .split(';')
            .map((e) => e.trim())
            .filter((e) => e.length > 0);
          this.allowedGrammar.push({
            structure: row[0],
            examples,
            level: this.editLevel || 'A1',
          });
          imported++;
        }
      }
      this.messageType = 'success';
      this.message = `Imported ${imported} grammar structures.`;
      (event.target as HTMLInputElement).value = '';
    };
    reader.readAsText(file);
  }

  // ── Conversation flow ─────────────────────────────────────────────────────

  addConversationFlow(): void {
    if (!this.newFlowStage.trim()) return;
    this.conversationFlow.push({
      stage: this.newFlowStage.trim(),
      aiPrompts: this.newFlowAiPrompt.trim() ? [this.newFlowAiPrompt.trim()] : [],
      expectedResponses: this.newFlowExpectedResponse.trim()
        ? [this.newFlowExpectedResponse.trim()]
        : [],
      helpfulPhrases: [],
    });
    this.newFlowStage = '';
    this.newFlowAiPrompt = '';
    this.newFlowExpectedResponse = '';
  }

  removeConversationFlow(i: number): void {
    this.conversationFlow.splice(i, 1);
  }

  onConversationFlowCsvUpload(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = (reader.result as string).split(/\r?\n/).filter((l) => l.trim());
      const header = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) || [];
      const split = (val: string) =>
        val ? val.split(';').map((s) => s.trim()).filter((s) => s) : [];
      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const stage = cols[header.indexOf('stage')]?.trim() || cols[0]?.trim();
        if (!stage) continue;
        this.conversationFlow.push({
          stage,
          aiPrompts: split(cols[header.indexOf('aiprompts')] || cols[1] || ''),
          expectedResponses: split(cols[header.indexOf('expectedresponses')] || cols[2] || ''),
          helpfulPhrases: split(cols[header.indexOf('helpfulphrases')] || cols[3] || ''),
        });
        imported++;
      }
      this.messageType = 'success';
      this.message = `Imported ${imported} conversation flow stages.`;
      (event.target as HTMLInputElement).value = '';
    };
    reader.readAsText(file);
  }

  downloadConversationFlowTemplate(): void {
    const headers = ['stage', 'aiPrompts', 'expectedResponses', 'helpfulPhrases'];
    const sample = [
      'greeting',
      'Guten Tag! Was möchten Sie?; Willkommen!',
      'Ich möchte bitte...; Ein Bier bitte',
      'Guten Tag; Bitte; Danke',
    ];
    const csv = [headers, sample]
      .map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'conversation-flow-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Opening lines & student responses ────────────────────────────────────

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

  // ── CSV / translate helpers ───────────────────────────────────────────────

  private parseCsvText(text: string): string[][] {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(',').map((cell) => cell.trim()));
  }

  private isHeaderRow(row: string[]): boolean {
    const keywords = ['word', 'translation', 'category', 'usage', 'structure', 'example', 'phrase'];
    return row.some((cell) => keywords.includes(cell.toLowerCase()));
  }

  private async autoTranslate(word: string): Promise<string> {
    try {
      const result: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/translate`, {
          text: word,
          from: this.editLanguage,
          to: this.editNativeLanguage,
        }),
      );
      return (result.translatedText || '').replace(/^💬\s*/, '').trim();
    } catch {
      return '';
    }
  }
}
