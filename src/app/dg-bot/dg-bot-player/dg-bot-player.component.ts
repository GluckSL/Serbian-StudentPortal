import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { DgApiService } from '../dg-api.service';
import { DgTtsService } from '../dg-tts.service';
import { DgSceneEngineService } from '../dg-scene-engine.service';
import { DgCharacterComponent } from '../dg-character/dg-character.component';
import { DgDialogueComponent, type DgDialogueVariant } from '../dg-dialogue/dg-dialogue.component';
import { DgPracticeComponent, type DgPracticePhase } from '../dg-practice/dg-practice.component';
import { DgControlsComponent } from '../dg-controls/dg-controls.component';
import type {
  DgChatMessage,
  DgConversationMessage,
  DgGoalStep,
  DgPlayPayload,
  DgPlayerStatus,
  DgScene,
} from '../dg-bot.types';
import { AuthService } from '../../services/auth.service';
import type { PronunciationEvaluateResponse } from '../../services/pronunciation.service';
import { DgCharacterStateService } from '../dg-character-state.service';
import { DgAudioFeedbackService } from '../dg-audio-feedback.service';
import {
  behaviorPreSpeakFactor,
  behaviorTransitionFactor,
  createSceneBehaviorPlan,
  shouldSkipOccasionalThoughtPause,
  type DgSceneBehaviorPlan,
} from '../dg-player-behavior';
import {
  DG_CHAR_TIMING,
  dgDelay,
  dgPacingMultiplier,
  dgWithOneRetry,
  humanDelay,
  humanReactionHoldMs,
  maybeOccasionalThoughtPause,
} from '../dg-player.util';
import { DgAudioCacheService } from '../dg-audio-cache.service';
import { DgAudioPlayerService } from '../dg-audio-player.service';
import { dgDevLog } from '../dg-dev-log';
import { DgCharacterEmotionService } from '../dg-character-emotion.service';
import type { DgCharacterAnimState } from '../dg-character-state.service';

export interface DgSceneFlowItem {
  type: string;
  ix: number;
  label: string;
  state: 'done' | 'current' | 'upcoming';
}

@Component({
  selector: 'app-dg-bot-player',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    DgCharacterComponent,
    DgDialogueComponent,
    DgPracticeComponent,
    DgControlsComponent,
  ],
  templateUrl: './dg-bot-player.component.html',
  styleUrl: './dg-bot-player.component.scss',
})
export class DgBotPlayerComponent implements OnInit, OnDestroy {
  @ViewChild('chatScroll') private chatScrollRef?: ElementRef<HTMLDivElement>;

  // ── Loading / error ─────────────────────────────────────────────────────────
  loading = true;
  error: string | null = null;
  payload: DgPlayPayload | null = null;
  sessionId: string | null = null;

  // ── Scene state ─────────────────────────────────────────────────────────────
  index = 0;
  status: DgPlayerStatus = 'idle';
  transcript = '';
  score: number | null = null;
  practicePassed = false;
  displayLine = '';
  displaySub = '';
  canNext = false;
  isTransitioning = false;
  showConfetti = false;
  readonly confettiPieces = Array.from({ length: 22 }, (_, i) => i);
  sceneBuffer: DgScene | null = null;
  dialogueVariant: DgDialogueVariant = 'default';

  // ── Conversation mode ────────────────────────────────────────────────────────
  /** True once all intro/briefing scenes have played — activates chat loop. */
  conversationMode = false;
  /** True after the student says "ready/bereit/start". */
  conversationStarted = false;
  /** True when vocab coverage ≥ 80 % or maxTurns reached. */
  conversationComplete = false;
  /** Full visible chat history (AI + student bubbles). */
  chatHistory: DgChatMessage[] = [];
  /** Vocab coverage 0-100 (still updated from API; not shown in UI). */
  vocabCoverage = 0;
  /** Per-bucket coverage from API (for milestone buttons). */
  studentVocabCoverage = 0;
  aiVocabCoverage = 0;
  /** Elapsed seconds since conversation practice started (after "Ready"). */
  sessionElapsedSec = 0;
  private conversationPracticeStartedAt = 0;
  private sessionTimerHandle: ReturnType<typeof setInterval> | null = null;
  /** True while waiting for the student turn input. */
  waitingForUser = false;
  /** Incremented to reset the mic for the next student turn. */
  convRetryTick = 0;
  /** Displayed in the dialogue bubble while waiting for start trigger. */
  waitingForStartText = '';
  /** Debug panel: latest recognized user utterances from mic pipeline. */
  debugSpeechLog: string[] = [];

  isAiThinking = false;
  aiResponseText = '';
  aiResponseTamil = '';
  ccMode: 'none' | 'en' | 'ta' = 'none';
  menuOpen = false;

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  // ── Internals ────────────────────────────────────────────────────────────────
  private sceneEnteredAt = 0;
  private ttsObjectUrl: string | null = null;
  private destroyAborted = false;
  private pendingAdvance: ReturnType<typeof setTimeout> | null = null;
  private confettiOff: ReturnType<typeof setTimeout> | null = null;
  private characterSpeechLocked = false;
  private correctStreak = 0;
  private lastPracticeAttemptWrong = false;
  private consecutivePracticeFailures = 0;
  private sceneBehaviorPlan: DgSceneBehaviorPlan | null = null;
  private conversationHistory: DgConversationMessage[] = [];
  private conversationTurn = 0;
  private maxConversationTurns = 8;
  private usedVocab = new Set<string>();
  private moduleStartedAt = 0;

  constructor(
    private ngZone: NgZone,
    private route: ActivatedRoute,
    private router: Router,
    private dgApi: DgApiService,
    private dgTts: DgTtsService,
    private engine: DgSceneEngineService,
    private auth: AuthService,
    private charState: DgCharacterStateService,
    private audioFx: DgAudioFeedbackService,
    private audioCache: DgAudioCacheService,
    private dgAudioPlayer: DgAudioPlayerService,
    private emotionSvc: DgCharacterEmotionService,
  ) {}

  // ── Getters ──────────────────────────────────────────────────────────────────

  get scenes(): DgScene[] {
    return this.payload?.module.scenes || [];
  }

  get scene(): DgScene | null {
    return this.scenes[this.index] || null;
  }

  get progressPct(): number {
    if (this.conversationMode && this.conversationStarted) {
      const target = this.conversationMinTargetSeconds;
      if (target > 0) {
        return Math.min(100, Math.round((this.sessionElapsedSec / target) * 100));
      }
    }
    if (this.conversationMode) return 0;
    if (!this.scenes.length) return 0;
    return Math.round((this.index / this.scenes.length) * 100);
  }

  /** Minimum practice window from admin (minutes). */
  get conversationMinTargetMinutes(): number {
    const m =
      this.payload?.module.minPracticeMinutes ??
      this.payload?.module.minimumCompletionTime ??
      10;
    const n = Number(m);
    return Number.isFinite(n) && n > 0 ? Math.min(120, Math.max(1, n)) : 10;
  }

  get conversationMinTargetSeconds(): number {
    return this.conversationMinTargetMinutes * 60;
  }

  /** Progress 0–100 toward admin min practice time (for optional bar). */
  get sessionTimerProgressPct(): number {
    const t = this.conversationMinTargetSeconds;
    if (t <= 0) return 0;
    return Math.min(100, Math.round((this.sessionElapsedSec / t) * 100));
  }

  formatMmSs(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  get goalSteps(): DgGoalStep[] {
    return this.engine.buildGoalSteps({
      scene: this.scene,
      status: this.status,
      practicePassed: this.practicePassed,
    });
  }

  get pronLanguage(): string {
    return (this.payload?.module.language || 'German') === 'English' ? 'English' : 'German';
  }

  get statusLabel(): string {
    if (this.isAiThinking) return 'Thinking…';
    if (this.status === 'listening') return 'Listening…';
    if (this.status === 'processing') return 'Processing…';
    return '';
  }

  get showStudentTurnUi(): boolean {
    if (this.conversationComplete) return false;
    if (!this.waitingForUser) return false;
    if (this.isAiThinking) return false;
    return this.status !== 'speaking';
  }

  /** Show Continue / Complete when all admin vocab is covered OR min practice time reached. */
  get showMilestoneActions(): boolean {
    if (!this.conversationStarted || this.conversationComplete) return false;
    const minMet = this.sessionElapsedSec >= this.conversationMinTargetSeconds;
    const vocabDone = this.studentVocabCoverage >= 100 && this.aiVocabCoverage >= 100;
    return vocabDone || minMet;
  }

  get studentDisplayName(): string {
    const name = (this.auth.getSnapshotUser()?.name || '').trim();
    return name || 'Student';
  }

  get botDisplayName(): string {
    return 'Ooly';
  }

  highlightStartCue(text: string): string {
    const raw = String(text || '');
    const escaped = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped.replace(
      /"((?:Bereit|Ready)!?)"/gi,
      '<span class="dg-conv__start-cue">"$1"</span>',
    );
  }

  /** True when the module has conversation content (vocab / role-play scenario). */
  private get hasConversationContent(): boolean {
    const mod = this.payload?.module;
    if (!mod) return false;
    return (
      (mod.allowedVocabulary?.length ?? 0) > 0 ||
      (mod.aiTutorVocabulary?.length ?? 0) > 0 ||
      !!(mod.rolePlayScenario?.aiRole)
    );
  }

  private vocabListForConversation(): string[] {
    const a = this.payload?.module.allowedVocabulary ?? [];
    const b = this.payload?.module.aiTutorVocabulary ?? [];
    const all = [...a, ...b]
      .map((v) => (v.word || '').trim().toLowerCase())
      .filter(Boolean);
    return [...new Set(all)];
  }

  private pushDebugSpeech(text: string): void {
    const t = (text || '').trim();
    if (!t) return;
    this.debugSpeechLog = [`🗣 ${t}`, ...this.debugSpeechLog].slice(0, 24);
  }

  private scrollChatToLatest(): void {
    // Wait for Angular to render the newly added bubble before scrolling.
    setTimeout(() => {
      const el = this.chatScrollRef?.nativeElement;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, 0);
  }

  /**
   * Speaks the suggested German hint only when the user taps the speaker icon (never auto-played).
   */
  async playHintPronunciation(germanText: string): Promise<void> {
    const t = (germanText || '').trim();
    if (!t || this.characterSpeechLocked) return;
    try {
      await this.playTtsBlob(t);
    } catch {
      /* ignore */
    }
  }

  getCcCaption(msg: DgChatMessage): string {
    if (msg.speaker === 'hint') {
      if (this.ccMode === 'en') {
        const en = (msg.translationEn || '').trim();
        const src = (msg.text || '').trim();
        if (!en) return '';
        if (en.toLowerCase() === src.toLowerCase()) return '';
        return en;
      }
      if (this.ccMode === 'ta') return (msg.translation || '').trim();
      return '';
    }
    if (msg.speaker !== 'ai') return '';
    if (this.ccMode === 'en') {
      const en = (msg.translationEn || '').trim();
      const src = (msg.text || '').trim();
      if (!en) return '';
      if (en.toLowerCase() === src.toLowerCase()) return '';
      return en;
    }
    if (this.ccMode === 'ta') return (msg.translation || msg.text || '').trim();
    return '';
  }

  private openMicForUserTurn(): void {
    this.waitingForUser = true;
    this.status = 'idle';
    if (!this.characterSpeechLocked) {
      this.charState.setState('listening');
    }
    this.convRetryTick++;
  }

  private startConversationPracticeTimer(): void {
    if (this.sessionTimerHandle) return;
    this.conversationPracticeStartedAt = Date.now();
    this.sessionElapsedSec = 0;
    this.tickSessionElapsed();
    this.sessionTimerHandle = setInterval(() => this.tickSessionElapsed(), 1000);
  }

  private tickSessionElapsed(): void {
    if (!this.conversationPracticeStartedAt) return;
    const next = Math.floor((Date.now() - this.conversationPracticeStartedAt) / 1000);
    this.ngZone.run(() => {
      this.sessionElapsedSec = Math.max(0, next);
    });
  }

  private stopConversationPracticeTimer(): void {
    if (this.sessionTimerHandle) {
      clearInterval(this.sessionTimerHandle);
      this.sessionTimerHandle = null;
    }
    this.conversationPracticeStartedAt = 0;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    document.addEventListener('click', this.onDocClick, true);
    const id = this.route.snapshot.paramMap.get('moduleId');
    if (!id) { this.error = 'Missing module'; this.loading = false; return; }
    this.boot(id);
  }

  ngOnDestroy(): void {
    this.destroyAborted = true;
    this.stopConversationPracticeTimer();
    this.clearPendingAdvance();
    if (this.confettiOff) { clearTimeout(this.confettiOff); this.confettiOff = null; }
    this.stopAudio();
    this.audioCache.clear();
    this.charState.forceIdle();
    document.removeEventListener('click', this.onDocClick, true);
  }

  private onDocClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.dg-conv__menu-wrap')) {
      this.ngZone.run(() => { this.menuOpen = false; });
    }
  };

  // ── Boot ─────────────────────────────────────────────────────────────────────

  private async boot(moduleId: string): Promise<void> {
    try {
      this.payload = await firstValueFrom(this.dgApi.getPlay(moduleId));

      // Trim scenes to intro + briefing only (conversation handles the rest)
      this.prepareIntroScenes();

      const startRes = await firstValueFrom(this.dgApi.startSession(moduleId));
      this.sessionId = startRes.sessionId;
      this.moduleStartedAt = Date.now();

      // Pre-init conversation state on the backend
      if (this.hasConversationContent && this.sessionId) {
        try {
          const convStart = await firstValueFrom(
            this.dgApi.conversationStart({ moduleId, sessionId: this.sessionId }),
          );
          this.waitingForStartText = convStart.roleMessage || '';
          this.maxConversationTurns = convStart.maxTurns || 12;
        } catch {
          this.waitingForStartText = '';
          this.maxConversationTurns = 12;
        }
      }

      this.index = 0;
      this.correctStreak = 0;
      this.lastPracticeAttemptWrong = false;
      this.consecutivePracticeFailures = 0;
      this.waitingForUser = false;
      this.usedVocab.clear();
      this.debugSpeechLog = [];
      this.loading = false;
      this.noteSceneEnter();
      dgDevLog('module loaded', moduleId, 'scenes', this.scenes.length);
      this.refreshSceneBufferAndPreload();
      await this.presentScene();
    } catch (e: any) {
      this.error = e?.error?.message || e?.message || 'Could not load module';
      this.loading = false;
    }
  }

  /**
   * Keep only intro + teach (briefing) scenes in the array.
   * The practice conversation is handled by the conversation engine,
   * not by hard-coded scene objects.
   */
  private prepareIntroScenes(): void {
    if (!this.payload) return;
    if (!this.hasConversationContent) return;

    const allScenes = this.payload.module.scenes ?? [];
    // Keep non-practice scenes; discard any auto-generated practice scenes
    let introScenes = allScenes.filter((s) => s.type !== 'practice' && s.type !== 'feedback');

    // Ensure we have at least an intro
    if (introScenes.length === 0) {
      introScenes = [{
        type: 'intro',
        text: "Hi! I'm your digital guide. Let's learn together.",
        audioUrl: '', expectedAnswer: '', translation: '', hint: '', order: 0,
      }];
    }

    // Add role briefing if the admin configured it and it isn't already there
    const guidance = this.payload.module.rolePlayScenario?.studentGuidance?.trim();
    if (guidance && !introScenes.some((s) => s.text === guidance)) {
      introScenes.push({
        type: 'teach',
        text: guidance,
        audioUrl: '', expectedAnswer: '', translation: '',
        hint: 'Listen to your role, then speak when ready.',
        order: introScenes.length,
      });
    }

    this.payload.module.scenes = introScenes;
  }

  // ── Event handlers ────────────────────────────────────────────────────────────

  exit(): void {
    const u = this.auth.getSnapshotUser();
    this.router.navigate(u?.role === 'STUDENT' ? ['/dg-bot'] : ['/admin/dg-modules']);
  }

  async replayTts(): Promise<void> {
    if (this.conversationMode) {
      const last = [...this.chatHistory].reverse().find((m) => m.speaker === 'ai');
      if (last) { this.dgAudioPlayer.stop(); await this.playTtsBlob(last.text); }
      return;
    }
    this.dgAudioPlayer.stop();
    await this.speakCurrent();
  }

  async onNext(): Promise<void> {
    if (!this.canNext) return;
    this.clearPendingAdvance();
    await this.advance();
  }

  async onSkip(): Promise<void> {
    if (!this.sessionId) return;
    if (this.conversationMode) {
      // In conversation mode "skip" = pass empty turn to keep flow moving
      await this.handleConversationEval({
        transcript: '(skipped)', score: 0, isCorrect: false,
        engine: 'skip', confidence: 0,
      } as any);
      return;
    }
    this.charState.setState('thinking');
    await firstValueFrom(this.dgApi.updateSession({
      sessionId: this.sessionId,
      event: 'silence_failure',
      sceneIndex: this.index,
      silenceFailure: true,
      meta: { reason: 'cant_speak_skip' },
    }));
    this.practicePassed = true;
    await dgDelay(320);
    await this.advance();
  }

  onPracticePhase(p: DgPracticePhase): void {
    if (p === 'listening') {
      this.status = 'listening';
      if (!this.characterSpeechLocked) this.charState.setState('listening');
      return;
    }
    if (p === 'processing') {
      this.status = 'processing';
      if (!this.characterSpeechLocked) this.charState.setState('thinking');
      return;
    }
    if (p === 'countdown') {
      this.status = 'idle';
      if (!this.characterSpeechLocked) this.charState.setState('thinking');
      return;
    }
    this.status = 'idle';
  }

  /** Called by DgPracticeComponent when pronunciation evaluation is done. */
  async onEvaluated(ev: PronunciationEvaluateResponse): Promise<void> {
    if (!this.sessionId) return;
    this.pushDebugSpeech(ev.transcript || '');

    // ── Conversation mode: always continue regardless of score ────────────────
    if (this.conversationMode) {
      await this.handleConversationEval(ev);
      return;
    }

    // ── Legacy scene-based flow (kept intact for non-conversation modules) ────
    this.status = 'result';
    this.transcript = ev.transcript || '';
    this.score = ev.score;
    const ok = !!ev.isCorrect;

    await firstValueFrom(this.dgApi.updateSession({
      sessionId: this.sessionId,
      event: 'practice_attempt',
      sceneIndex: this.index,
      attemptsDelta: 1,
      success: ok,
      transcript: ev.transcript,
      score: ev.score,
      meta: { engine: ev.engine },
    }));

    if (ok) {
      this.correctStreak += 1;
      this.practicePassed = true;
      this.charState.setState('happy');
      this.dialogueVariant = 'success';
      this.showConfetti = true;
      this.confettiOff = setTimeout(() => { this.showConfetti = false; }, 2400);
      this.audioFx.playSuccessChime();
      const lines = this.engine.feedbackLines(true, false);
      this.displayLine = `Great job! ${lines.en}`;
      this.displaySub = lines.de;
      await this.playFeedbackTts(lines.de, 'happy');
      this.scheduleAutoAdvance(1600);
    } else {
      this.correctStreak = 0;
      this.lastPracticeAttemptWrong = true;
      this.charState.setState('sad');
      this.dialogueVariant = 'encourage';
      const lines = this.engine.feedbackLines(false, false);
      this.displayLine = `${lines.en} Try again when you're ready.`;
      this.displaySub = lines.de;
      await this.playFeedbackTts(lines.de, 'sad');
      this.displayLine = this.scene?.text || '';
      this.displaySub = this.scene?.translation || '';
      this.dialogueVariant = 'default';
      this.canNext = false;
      this.practiceRetryTick += 1;
      this.charState.setState('idle');
    }
  }

  // Keep for legacy scene mode
  private practiceRetryTick = 0;

  async onSilence(): Promise<void> {
    if (!this.sessionId) return;
    this.pushDebugSpeech('(no speech detected)');
    if (this.conversationMode) {
      // Silence in conversation mode — keep waiting for manual push-to-talk
      this.openMicForUserTurn();
      return;
    }
    this.charState.setState(this.emotionSvc.getEmotion('feedback', { isSilent: true }));
    this.status = 'result';
    this.dialogueVariant = 'soft';
    await firstValueFrom(this.dgApi.updateSession({
      sessionId: this.sessionId,
      event: 'silence_failure',
      sceneIndex: this.index,
      silenceFailure: true,
    }));
    const lines = this.engine.feedbackLines(false, true);
    this.displayLine = lines.en;
    this.displaySub = lines.de;
    await this.playFeedbackTts(lines.de, this.emotionSvc.getEmotion('feedback', { isSilent: true }));
    await dgDelay(400);
    this.dialogueVariant = 'default';
    this.canNext = false;
    this.charState.setState('idle');
  }

  // ── Conversation mode ─────────────────────────────────────────────────────────

  /**
   * Enter the free conversation loop.
   * Called by advance() once all intro scenes have played.
   */
  private async enterConversationMode(): Promise<void> {
    this.stopConversationPracticeTimer();
    this.sessionElapsedSec = 0;
    this.conversationMode = true;
    this.conversationStarted = false;
    this.conversationComplete = false;
    this.chatHistory = [];
    this.vocabCoverage = 0;
    this.studentVocabCoverage = 0;
    this.aiVocabCoverage = 0;
    this.usedVocab.clear();
    this.conversationTurn = 0;
    this.convRetryTick = 0;
    this.canNext = false;
    this.isAiThinking = false;
    this.waitingForUser = false;

    const startCue = 'Say "Bereit!" or "Ready!" to start.';
    const withStartCue = (text: string): string => {
      const t = (text || '').trim();
      if (!t) return startCue;
      if (/\b(ready|bereit)\b/i.test(t)) return t;
      const needsPeriod = /[.!?]$/.test(t) ? '' : '.';
      return `${t}${needsPeriod} ${startCue}`;
    };
    const readyMsgBase = this.waitingForStartText ||
      (this.payload?.module.rolePlayScenario?.studentGuidance?.trim()) ||
      '';
    const readyMsg = withStartCue(readyMsgBase || 'Say "Bereit!" or "Ready!" to start the conversation.');
    const readyMsgEnglish = readyMsg;

    // Show the role/start instruction as a visible chat bubble in English.
    this.chatHistory = [
      {
        speaker: 'ai',
        text: readyMsgEnglish,
        // Keep original prompt in Tamil-caption slot as a soft fallback for CC mode.
        translation: readyMsg || undefined,
        translationEn: readyMsgEnglish,
      },
    ];
    this.scrollChatToLatest();

    if (this.sessionId) {
      firstValueFrom(
        this.dgApi.updateSession({
          sessionId: this.sessionId,
          event: 'conv_ai',
          sceneIndex: this.index,
          meta: { text: readyMsgEnglish, kind: 'briefing' },
        }),
      ).catch(() => {});
    }

    // Show + speak the start prompt
    this.displayLine = readyMsg;
    this.displaySub = 'Say "Bereit!" or "Ready!" when you are ready to begin.';
    this.charState.setState('idle');
    await this.logTts();
    await this.playTtsBlob(readyMsg);
    this.openMicForUserTurn();
  }

  /**
   * Core conversation evaluation handler.
   * - If waiting for start: detect trigger → generate opening line
   * - Otherwise: send to AI, render response, loop
   * - Score is shown but NEVER blocks progression
   */
  private async handleConversationEval(ev: PronunciationEvaluateResponse): Promise<void> {
    const transcript = (ev.transcript || '').trim();
    this.waitingForUser = false;

    // No speech at all → just retry mic
    if (!transcript) { this.openMicForUserTurn(); return; }

    this.status = 'result';

    // Add student bubble immediately (score is stored but not displayed in conversation mode)
    this.chatHistory = [
      ...this.chatHistory,
      { speaker: 'student', text: transcript, score: ev.score ?? undefined },
    ];
    this.scrollChatToLatest();
    this.displayLine = transcript;
    this.displaySub = '';

    // Block mic while AI is thinking / speaking
    this.isAiThinking = true;
    this.charState.setState('thinking');

    const moduleId = this.payload!.module._id;
    const durationMin =
      this.payload?.module.minPracticeMinutes ||
      this.payload?.module.minimumCompletionTime ||
      10;
    const elapsedSec = this.moduleStartedAt
      ? Math.floor((Date.now() - this.moduleStartedAt) / 1000) : 0;
    const remainingSeconds = Math.max(0, durationMin * 60 - elapsedSec);

    if (this.sessionId) {
      firstValueFrom(
        this.dgApi.updateSession({
          sessionId: this.sessionId,
          event: 'conv_student',
          sceneIndex: this.index,
          transcript,
          score: ev.score ?? null,
          meta: { mode: 'conversation' },
        }),
      ).catch(() => {});
    }

    try {
      const response = await firstValueFrom(
        this.dgApi.conversationRespond({
          moduleId,
          sessionId: this.sessionId!,
          sceneIndex: 0,
          userText: transcript,
          pronunciationScore: ev.score ?? 0,
          remainingSeconds,
          turnNumber: this.conversationTurn,
          history: this.conversationHistory.slice(-8),
          // Optional signal fields for richer vocab usage planning
          vocabList: this.vocabListForConversation(),
          usedVocab: Array.from(this.usedVocab),
        } as any),
      );

      this.isAiThinking = false;

      // Persist conversation started state + start session timer toward admin min time
      if (response.conversationStarted && !this.conversationStarted) {
        this.conversationStarted = true;
        this.startConversationPracticeTimer();
      }

      if (response.vocabCoverage != null) {
        this.vocabCoverage = response.vocabCoverage;
      }
      if (response.studentVocabCoverage != null) {
        this.studentVocabCoverage = response.studentVocabCoverage;
      }
      if (response.aiVocabCoverage != null) {
        this.aiVocabCoverage = response.aiVocabCoverage;
      }
      for (const w of response.usedVocab || []) {
        const t = String(w || '').trim().toLowerCase();
        if (t) this.usedVocab.add(t);
      }

      // German-only: student used English — show hint, do not advance server dialogue
      if (response.languageHint && response.hintDe) {
        this.conversationTurn = response.turnCount ?? response.turnNumber ?? this.conversationTurn;
        if (this.sessionId) {
          firstValueFrom(
            this.dgApi.updateSession({
              sessionId: this.sessionId,
              event: 'conv_hint',
              sceneIndex: this.index,
              meta: {
                text: response.hintDe,
                instructionEn: (response.hintEn || 'Say this in German to continue.').trim(),
              },
            }),
          ).catch(() => {});
        }
        this.chatHistory = [
          ...this.chatHistory,
          {
            speaker: 'hint',
            text: response.hintDe,
            translation: (response.translatedTamil || '').trim() || undefined,
            translationEn: (response.translatedEnglish || '').trim() || undefined,
            instructionEn: (response.hintEn || 'Say this in German to continue.').trim(),
          },
        ];
        this.scrollChatToLatest();
        this.displayLine = response.hintDe;
        this.displaySub = (response.translatedEnglish || response.hintEn || '').trim();
        this.charState.setState('idle');
        await dgDelay(220);
        this.openMicForUserTurn();
        return;
      }

      this.conversationTurn = response.turnNumber ?? (this.conversationTurn + 1);

      this.conversationHistory = [
        ...this.conversationHistory,
        { role: 'user', text: transcript },
        { role: 'ai', text: response.text },
      ];

      this.chatHistory = [
        ...this.chatHistory,
        {
          speaker: 'ai',
          text: response.text,
          translation: response.translatedTamil || undefined,
          translationEn: response.translatedEnglish || undefined,
        },
      ];
      this.scrollChatToLatest();

      if (this.sessionId && (response.text || '').trim()) {
        firstValueFrom(
          this.dgApi.updateSession({
            sessionId: this.sessionId,
            event: 'conv_ai',
            sceneIndex: this.index,
            meta: { text: (response.text || '').trim() },
          }),
        ).catch(() => {});
      }

      this.aiResponseText = response.text;
      this.aiResponseTamil = response.translatedTamil;
      this.displayLine = response.text;
      this.displaySub = response.translatedTamil || '';
      this.dialogueVariant = 'default';
      this.charState.setState('speaking');

      await this.logTts();
      await this.playTtsBlob(response.text);

      const phase = response.phase || (response.complete ? 'complete' : 'active');

      if (phase === 'complete' || response.complete) {
        this.conversationComplete = true;
        await dgDelay(1500);
        await this.finishModule();
        return;
      }

      await dgDelay(220);
      this.charState.setState('idle');
      this.openMicForUserTurn();

    } catch (err: any) {
      console.error('[dg-player] conversation respond failed:', err);
      this.isAiThinking = false;
      this.charState.setState('idle');
      this.openMicForUserTurn(); // re-open mic even on error
    }
  }

  /** Continue or Complete after milestone (vocab done or min time reached). */
  async postConversationClientAction(action: 'continue' | 'complete'): Promise<void> {
    if (!this.sessionId || !this.payload || this.conversationComplete) return;
    this.waitingForUser = false;
    this.isAiThinking = true;
    this.charState.setState('thinking');
    const moduleId = this.payload.module._id;
    const durationMin =
      this.payload.module.minPracticeMinutes ||
      this.payload.module.minimumCompletionTime ||
      10;
    const elapsedSec = this.moduleStartedAt
      ? Math.floor((Date.now() - this.moduleStartedAt) / 1000)
      : 0;
    const remainingSeconds = Math.max(0, durationMin * 60 - elapsedSec);
    try {
      const response = await firstValueFrom(
        this.dgApi.conversationRespond({
          moduleId,
          sessionId: this.sessionId,
          sceneIndex: 0,
          userText: '',
          pronunciationScore: 0,
          remainingSeconds,
          turnNumber: this.conversationTurn,
          history: this.conversationHistory.slice(-8),
          clientAction: action,
        } as any),
      );
      this.isAiThinking = false;
      if (response.vocabCoverage != null) this.vocabCoverage = response.vocabCoverage;
      if (response.studentVocabCoverage != null) {
        this.studentVocabCoverage = response.studentVocabCoverage;
      }
      if (response.aiVocabCoverage != null) {
        this.aiVocabCoverage = response.aiVocabCoverage;
      }
      for (const w of response.usedVocab || []) {
        const t = String(w || '').trim().toLowerCase();
        if (t) this.usedVocab.add(t);
      }
      const text = (response.text || '').trim();
      if (text) {
        if (this.sessionId) {
          firstValueFrom(
            this.dgApi.updateSession({
              sessionId: this.sessionId,
              event: 'conv_ai',
              sceneIndex: this.index,
              meta: { text, clientAction: action },
            }),
          ).catch(() => {});
        }
        this.conversationHistory = [...this.conversationHistory, { role: 'ai', text }];
        this.chatHistory = [
          ...this.chatHistory,
          {
            speaker: 'ai',
            text,
            translation: response.translatedTamil || undefined,
            translationEn: response.translatedEnglish || undefined,
          },
        ];
        this.scrollChatToLatest();
        this.displayLine = text;
        this.displaySub = response.translatedTamil || '';
        this.charState.setState('speaking');
        await this.logTts();
        await this.playTtsBlob(text);
      }
      if (response.complete) {
        this.conversationComplete = true;
        await dgDelay(1200);
        await this.finishModule();
        return;
      }
      await dgDelay(200);
      this.charState.setState('idle');
      this.openMicForUserTurn();
    } catch (e) {
      console.error('[dg-player] client action failed', e);
      this.isAiThinking = false;
      this.charState.setState('idle');
      this.openMicForUserTurn();
    }
  }

  // ── Scene engine (intro / teach / feedback) ───────────────────────────────────

  private async presentScene(): Promise<void> {
    const s = this.scene;
    if (!s || !this.payload) return;

    this.sceneBehaviorPlan = createSceneBehaviorPlan({
      consecutivePracticeFails: this.consecutivePracticeFailures,
      correctStreak: this.correctStreak,
    });

    this.dialogueVariant = 'default';
    this.showConfetti = false;
    this.practicePassed = false;
    this.transcript = '';
    this.score = null;
    this.canNext = false;
    this.displaySub = s.translation || '';
    this.displayLine = s.text || '';
    this.charState.setState(this.emotionSvc.getEmotion(s.type, undefined, { hasText: !!(s.text?.trim() || s.audioUrl) }));

    const preGen = s.audioUrl?.trim();
    if (preGen) {
      await this.logTts();
      await this.playExternal(preGen, undefined, s.text);
    } else if (s.text) {
      await this.logTts();
      await this.playTtsBlob(s.text);
    }

    const outMul = this.sceneBehaviorPlan ? behaviorTransitionFactor(this.sceneBehaviorPlan) : 1;
    await humanDelay(120 * outMul, this.pacingMultiplier());
    this.status = 'idle';
    this.waitingForUser = true;

    // Conversation modules must wait for user speech; no scene auto-advance.
    if (this.hasConversationContent) {
      await this.enterConversationMode();
      return;
    }

    this.refreshSceneBufferAndPreload();
  }

  private async advance(): Promise<void> {
    if (this.conversationMode) return;
    this.flushSceneTiming();
    this.stopAudio();
    this.clearPendingAdvance();
    this.consecutivePracticeFailures = 0;
    this.isTransitioning = true;
    await dgDelay(300);
    this.index += 1;

    if (this.index >= this.scenes.length) {
      this.isTransitioning = false;
      // All intro/briefing scenes done — enter conversation if module supports it
      if (this.hasConversationContent) {
        await this.enterConversationMode();
      } else {
        await this.finishModule();
      }
      return;
    }

    this.noteSceneEnter();
    await this.presentScene();
    await dgDelay(200);
    this.isTransitioning = false;
  }

  private async finishModule(): Promise<void> {
    this.stopConversationPracticeTimer();
    if (this.sessionId) {
      const finalScore = this.score != null ? Math.min(100, this.score) : 0;
      await firstValueFrom(this.dgApi.completeSession(this.sessionId, finalScore)).catch(() => {});
    }
    this.charState.forceIdle();
    this.exit();
  }

  // ── Audio helpers ─────────────────────────────────────────────────────────────

  private async playExternal(url: string, holdEmotion?: DgCharacterAnimState, ttsFallback?: string): Promise<void> {
    const trimmed = url.trim();
    const fb = ttsFallback?.trim();
    this.revokeTtsObjectUrl();
    await this.runSceneSpeech(async () => {
      try {
        await this.dgAudioPlayer.play(trimmed, false);
      } catch {
        if (!fb) throw new Error('DG_AUDIO_NO_FALLBACK');
        const voice = this.payload?.character?.voice || 'alloy';
        const blob = await dgWithOneRetry(() => firstValueFrom(this.dgTts.synthesize(fb, voice)));
        this.ttsObjectUrl = URL.createObjectURL(blob);
        await this.dgAudioPlayer.play(this.ttsObjectUrl, true);
      }
    }, holdEmotion);
  }

  private async playTtsBlob(text: string, holdEmotion?: DgCharacterAnimState): Promise<void> {
    const voice = this.payload?.character?.voice || 'alloy';
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    this.revokeTtsObjectUrl();
    const pre = this.audioCache.getPreloadedSrc(voice, trimmed);
    let src: string;
    if (pre) {
      src = pre;
    } else {
      const blob = await dgWithOneRetry(() => firstValueFrom(this.dgTts.synthesize(trimmed, voice)));
      this.ttsObjectUrl = URL.createObjectURL(blob);
      src = this.ttsObjectUrl;
    }
    await this.runSceneSpeech(() => this.dgAudioPlayer.play(src, false), holdEmotion);
  }

  private async runSceneSpeech(play: () => Promise<void>, holdEmotion?: DgCharacterAnimState): Promise<void> {
    this.characterSpeechLocked = true;
    this.status = 'speaking';
    const pace = this.pacingMultiplier();
    const plan = this.sceneBehaviorPlan;
    const preMul = plan ? behaviorPreSpeakFactor(plan) : 1;
    const transMul = plan ? behaviorTransitionFactor(plan) : 1;
    const reactMul = plan ? 1 : 1;
    try {
      this.charState.setState('thinking');
      await humanDelay(DG_CHAR_TIMING.preSpeakAnticipationMs * preMul, pace);
      this.charState.setState('speaking');
      await play();
    } finally {
      try {
        await dgDelay(Math.round(DG_CHAR_TIMING.postSpeakSpeakingTailMs * pace));
        this.status = 'idle';
        if (!plan || !shouldSkipOccasionalThoughtPause(plan)) {
          await maybeOccasionalThoughtPause(pace);
        }
        await humanDelay(DG_CHAR_TIMING.postSpeakPauseBeforeReactionMs * transMul, pace);
        if (holdEmotion !== undefined) {
          this.charState.setState(holdEmotion);
        } else {
          this.charState.setState('idle');
        }
        const holdMs = Math.max(120, humanReactionHoldMs(DG_CHAR_TIMING.reactionHoldMs, 'default') * reactMul);
        await humanDelay(holdMs, pace);
      } finally {
        this.characterSpeechLocked = false;
      }
    }
  }

  private async playFeedbackTts(line: string, holdEmotion: DgCharacterAnimState): Promise<void> {
    try { await this.logTts(); await this.playTtsBlob(line, holdEmotion); } catch { /* ignore */ }
  }

  private async speakCurrent(): Promise<void> {
    const s = this.scene;
    if (!s) return;
    if (s.audioUrl?.trim()) await this.playExternal(s.audioUrl.trim(), undefined, s.text || this.displayLine);
    else if (s.text) await this.playTtsBlob(s.text);
  }

  private async logTts(): Promise<void> {
    if (!this.sessionId) return;
    await firstValueFrom(this.dgApi.updateSession({
      sessionId: this.sessionId, event: 'tts_play', sceneIndex: this.index,
    }));
  }

  // ── Misc ──────────────────────────────────────────────────────────────────────

  private clearPendingAdvance(): void {
    if (this.pendingAdvance) { clearTimeout(this.pendingAdvance); this.pendingAdvance = null; }
  }

  private scheduleAutoAdvance(ms: number): void {
    this.clearPendingAdvance();
    this.pendingAdvance = setTimeout(() => {
      this.pendingAdvance = null;
      if (this.destroyAborted || !this.practicePassed) return;
      void this.advance();
    }, ms);
  }

  private revokeTtsObjectUrl(): void {
    if (this.ttsObjectUrl) { URL.revokeObjectURL(this.ttsObjectUrl); this.ttsObjectUrl = null; }
  }

  private stopAudio(): void { this.dgAudioPlayer.stop(); this.revokeTtsObjectUrl(); }

  private pacingMultiplier(): number {
    return dgPacingMultiplier({
      lastPracticeWrong: this.lastPracticeAttemptWrong,
      correctStreak: this.correctStreak,
    });
  }

  private noteSceneEnter(): void {
    this.sceneEnteredAt = Date.now();
    if (!this.sessionId) return;
    firstValueFrom(this.dgApi.updateSession({
      sessionId: this.sessionId, event: 'scene_enter', sceneIndex: this.index,
    })).catch(() => {});
  }

  private flushSceneTiming(): void {
    if (!this.sessionId || !this.sceneEnteredAt) return;
    const durationMs = Date.now() - this.sceneEnteredAt;
    firstValueFrom(this.dgApi.updateSession({
      sessionId: this.sessionId, event: 'scene_complete', sceneIndex: this.index, durationMs,
    })).catch(() => {});
  }

  private refreshSceneBufferAndPreload(): void {
    this.sceneBuffer = this.scenes[this.index + 1] ?? null;
    const voice = this.payload?.character?.voice || 'alloy';
    this.audioCache.preloadScenesAtIndices(
      this.scenes, this.index, voice,
      (t, v) => dgWithOneRetry(() => firstValueFrom(this.dgTts.synthesize(t, v))),
    );
  }
}
