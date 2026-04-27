import { Component, OnDestroy, OnInit } from '@angular/core';
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
  behaviorFailureThinkFactor,
  behaviorPreSpeakFactor,
  behaviorReactionHoldFactor,
  behaviorSuccessHoldBoost,
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
  humanFailureThinkMs,
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
  loading = true;
  error: string | null = null;
  payload: DgPlayPayload | null = null;
  sessionId: string | null = null;

  index = 0;
  status: DgPlayerStatus = 'idle';
  transcript = '';
  score: number | null = null;
  practicePassed = false;
  displayLine = '';
  displaySub = '';
  highlightWord = '';
  canNext = false;
  practiceRetryTick = 0;

  /** UX: scene shell cross-fade / scale */
  isTransitioning = false;

  dialogueVariant: DgDialogueVariant = 'default';
  showConfetti = false;
  readonly confettiPieces = Array.from({ length: 22 }, (_, i) => i);

  /** Next scene reference for light prefetch / TTS warm-up (data already on client). */
  sceneBuffer: DgScene | null = null;

  private sceneEnteredAt = 0;
  private ttsObjectUrl: string | null = null;
  private destroyAborted = false;
  private pendingAdvance: ReturnType<typeof setTimeout> | null = null;
  private confettiOff: ReturnType<typeof setTimeout> | null = null;
  /**
   * While true, scene/feedback speech owns the character — practice phase must not clobber speaking/reactions.
   */
  private characterSpeechLocked = false;
  /** Pacing: faster flow after consecutive correct practice attempts. */
  private correctStreak = 0;
  /** Pacing: slightly slower beats after a wrong practice attempt until next non-practice scene. */
  private lastPracticeAttemptWrong = false;
  /** Wrong attempts in the current practice scene (reset on advance / correct). */
  private consecutivePracticeFailures = 0;
  /** Behavior preset + variants for the current scene; fixed until next {@link presentScene}. */
  private sceneBehaviorPlan: DgSceneBehaviorPlan | null = null;
  /** Auto-play pacing for non-practice scenes (intro/teach/feedback). */
  private readonly nonPracticeAutoAdvanceMs = 1400;

  // ── Conversation / Role-play state ────────────────────────────────────────
  /** Current turn count within the active practice scene (0 = no exchange yet). */
  conversationTurn = 0;
  /** Maximum AI exchanges per scene before auto-advancing. */
  readonly maxConversationTurns = 3;
  /** Last AI response text (target language) — bound to CC EN toggle. */
  aiResponseText = '';
  /** Tamil translation of the last AI response — bound to CC TA toggle. */
  aiResponseTamil = '';
  /** True while waiting for the AI conversation response (shows "Thinking…"). */
  isAiThinking = false;
  /** Per-scene conversation history sent to backend for context. */
  private conversationHistory: DgConversationMessage[] = [];
  /** Used to compute session countdown for prompt context. */
  private moduleStartedAt = 0;

  constructor(
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

  get scenes(): DgScene[] {
    return this.payload?.module.scenes || [];
  }

  get scene(): DgScene | null {
    return this.scenes[this.index] || null;
  }

  get progressPct(): number {
    if (!this.scenes.length) return 0;
    return Math.round((this.index / this.scenes.length) * 100);
  }

  get goalSteps(): DgGoalStep[] {
    return this.engine.buildGoalSteps({
      scene: this.scene,
      status: this.status,
      practicePassed: this.practicePassed,
    });
  }

  get sceneFlowItems(): DgSceneFlowItem[] {
    return this.scenes.map((s, i) => ({
      type: s.type,
      ix: i + 1,
      label: `${s.type.charAt(0).toUpperCase() + s.type.slice(1)} · ${i + 1}`,
      state: i < this.index ? 'done' : i === this.index ? 'current' : 'upcoming',
    }));
  }

  get pronLanguage(): string {
    const lang = this.payload?.module.language || 'German';
    return lang === 'English' ? 'English' : 'German';
  }

  /** Human-readable status label shown in the UI during active phases. */
  get statusLabel(): string {
    if (this.isAiThinking) return 'Thinking…';
    if (this.status === 'listening') return 'Listening…';
    if (this.status === 'processing') return 'Processing…';
    return '';
  }

  /**
   * Returns true when the current scene should use the AI conversation loop
   * instead of the plain success-then-advance flow.
   * Triggers if the module has a role-play scenario or non-empty vocabulary lists.
   */
  private isConversationScene(): boolean {
    if (this.scene?.type !== 'practice') return false;
    const mod = this.payload?.module;
    if (!mod) return false;
    const hasVocab =
      (mod.allowedVocabulary?.length ?? 0) > 0 ||
      (mod.aiTutorVocabulary?.length ?? 0) > 0;
    const hasScenario = !!(mod.rolePlayScenario?.aiRole);
    return hasVocab || hasScenario;
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('moduleId');
    if (!id) {
      this.error = 'Missing module';
      this.loading = false;
      return;
    }
    this.boot(id);
  }

  ngOnDestroy(): void {
    this.destroyAborted = true;
    this.clearPendingAdvance();
    if (this.confettiOff) {
      clearTimeout(this.confettiOff);
      this.confettiOff = null;
    }
    this.stopAudio();
    this.audioCache.clear();
    this.charState.forceIdle();
  }

  onPracticePhase(p: DgPracticePhase): void {
    if (p === 'listening') {
      this.status = 'listening';
      if (!this.characterSpeechLocked) {
        this.charState.setState('listening');
      }
      return;
    }
    if (p === 'processing') {
      this.status = 'processing';
      if (!this.characterSpeechLocked) {
        this.charState.setState('thinking');
      }
      return;
    }
    if (p === 'countdown') {
      this.status = 'idle';
      if (!this.characterSpeechLocked) {
        this.charState.setState('thinking');
      }
      return;
    }
    this.status = 'idle';
  }

  private async boot(moduleId: string): Promise<void> {
    try {
      this.payload = await firstValueFrom(this.dgApi.getPlay(moduleId));
      const start = await firstValueFrom(this.dgApi.startSession(moduleId));
      this.sessionId = start.sessionId;
      this.moduleStartedAt = Date.now();
      this.index = 0;
      this.correctStreak = 0;
      this.lastPracticeAttemptWrong = false;
      this.consecutivePracticeFailures = 0;
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

  exit(): void {
    const u = this.auth.getSnapshotUser();
    if (u?.role === 'STUDENT') {
      this.router.navigate(['/dg-bot']);
    } else {
      this.router.navigate(['/admin/dg-modules']);
    }
  }

  async replayTts(): Promise<void> {
    this.dgAudioPlayer.stop();
    await this.speakCurrent();
    await dgDelay(380);
  }

  async onNext(): Promise<void> {
    if (!this.canNext) return;
    this.clearPendingAdvance();
    await this.advance();
  }

  async onSkip(): Promise<void> {
    if (!this.sessionId) return;
    this.charState.setState('thinking');
    await firstValueFrom(
      this.dgApi.updateSession({
        sessionId: this.sessionId,
        event: 'silence_failure',
        sceneIndex: this.index,
        silenceFailure: true,
        meta: { reason: 'cant_speak_skip' },
      }),
    );
    this.practicePassed = true;
    await dgDelay(320);
    await this.advance();
  }

  async onEvaluated(ev: PronunciationEvaluateResponse): Promise<void> {
    if (!this.sessionId) return;
    this.status = 'result';
    this.transcript = ev.transcript || '';
    this.score = ev.score;
    const ok = !!ev.isCorrect;

    await firstValueFrom(
      this.dgApi.updateSession({
        sessionId: this.sessionId,
        event: 'practice_attempt',
        sceneIndex: this.index,
        attemptsDelta: 1,
        success: ok,
        transcript: ev.transcript,
        score: ev.score,
        meta: { engine: ev.engine },
      }),
    );
    await firstValueFrom(
      this.dgApi.updateSession({
        sessionId: this.sessionId,
        event: 'practice_result',
        sceneIndex: this.index,
        success: ok,
        transcript: ev.transcript,
        score: ev.score,
      }),
    );

    if (ok) {
      this.correctStreak += 1;
      this.lastPracticeAttemptWrong = false;
      this.consecutivePracticeFailures = 0;

      if (this.isConversationScene()) {
        // ── CONVERSATION MODE ─────────────────────────────────
        // Brief happy beat, then hand off to the AI character response.
        const pace = this.pacingMultiplier();
        const happyEmo = this.emotionSvc.getEmotion('feedback', {
          isCorrect: true,
          confidence: ev.confidence,
        });
        this.charState.setState(happyEmo);
        await humanDelay(320, pace);
        await this.handleConversationTurn(ev);
      } else {
        // ── ORIGINAL SUCCESS FLOW (unchanged) ─────────────────
        this.practicePassed = true;
        this.canNext = true;
        const pace = this.pacingMultiplier();
        const happyEmo = this.emotionSvc.getEmotion('feedback', {
          isCorrect: true,
          confidence: ev.confidence,
        });
        this.charState.setState(happyEmo);
        const plan = this.sceneBehaviorPlan;
        const happyHoldMs = Math.max(
          120,
          humanReactionHoldMs(DG_CHAR_TIMING.successHappyHoldMs, 'happy') *
            (plan ? behaviorReactionHoldFactor(plan, 'happy') * behaviorSuccessHoldBoost(plan) : 1),
        );
        await humanDelay(happyHoldMs, pace);

        this.dialogueVariant = 'success';
        this.showConfetti = true;
        if (this.confettiOff) clearTimeout(this.confettiOff);
        this.confettiOff = setTimeout(() => {
          this.showConfetti = false;
          this.confettiOff = null;
        }, 2400);
        this.audioFx.playSuccessChime();

        const lines = this.engine.feedbackLines(true, false);
        this.displayLine = `Great job! ${lines.en}`;
        this.displaySub = lines.de;

        await this.playFeedbackTts(lines.de, happyEmo);
        const postFb = plan
          ? DG_CHAR_TIMING.postSpeakPauseBeforeReactionMs * behaviorTransitionFactor(plan)
          : DG_CHAR_TIMING.postSpeakPauseBeforeReactionMs;
        await humanDelay(postFb, pace);
        this.charState.setState(happyEmo);
        this.scheduleAutoAdvance(1600);
      }
    } else {
      this.correctStreak = 0;
      this.lastPracticeAttemptWrong = true;
      this.consecutivePracticeFailures += 1;
      const pace = this.pacingMultiplier();
      const plan = this.sceneBehaviorPlan;
      const fbNeg = { isCorrect: false as const, confidence: ev.confidence };
      this.charState.setState('thinking');
      const thinkMs = Math.max(
        80,
        humanFailureThinkMs(DG_CHAR_TIMING.failureThinkBeforeSadMs) *
          (plan
            ? behaviorFailureThinkFactor(plan, this.consecutivePracticeFailures)
            : 1),
      );
      await humanDelay(thinkMs, pace);
      this.charState.setState('sad');
      this.dialogueVariant = 'encourage';
      const lines = this.engine.feedbackLines(false, false);
      this.displayLine = `${lines.en} Try again when you're ready.`;
      this.displaySub = lines.de;
      const postFeedbackEmo = this.emotionSvc.getEmotion('feedback', fbNeg);
      await this.playFeedbackTts(lines.de, postFeedbackEmo);
      const sadHoldMs = Math.max(
        120,
        humanReactionHoldMs(DG_CHAR_TIMING.reactionHoldMs, 'sad') *
          (plan ? behaviorReactionHoldFactor(plan, 'sad') : 1),
      );
      await humanDelay(sadHoldMs, pace);
      this.charState.setState(postFeedbackEmo);
      try {
        await this.speakCurrent();
      } catch {
        /* replay is best-effort */
      }
      const postRetry = plan
        ? DG_CHAR_TIMING.postSpeakPauseBeforeReactionMs * behaviorTransitionFactor(plan)
        : DG_CHAR_TIMING.postSpeakPauseBeforeReactionMs;
      await humanDelay(postRetry, pace);
      this.displayLine = this.scene?.text || '';
      this.displaySub = this.scene?.translation || '';
      this.dialogueVariant = 'default';
      this.canNext = false;
      this.practiceRetryTick += 1;
      this.charState.setState('idle');
    }
  }

  async onSilence(): Promise<void> {
    if (!this.sessionId) return;
    this.charState.setState(this.emotionSvc.getEmotion('feedback', { isSilent: true }));
    this.status = 'result';
    this.dialogueVariant = 'soft';
    await firstValueFrom(
      this.dgApi.updateSession({
        sessionId: this.sessionId,
        event: 'silence_failure',
        sceneIndex: this.index,
        silenceFailure: true,
      }),
    );
    const lines = this.engine.feedbackLines(false, true);
    this.displayLine = lines.en;
    this.displaySub = lines.de;
    await this.playFeedbackTts(lines.de, this.emotionSvc.getEmotion('feedback', { isSilent: true }));
    await dgDelay(400);
    this.dialogueVariant = 'default';
    this.canNext = false;
    this.charState.setState('idle');
  }

  private clearPendingAdvance(): void {
    if (this.pendingAdvance) {
      clearTimeout(this.pendingAdvance);
      this.pendingAdvance = null;
    }
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
    if (this.ttsObjectUrl) {
      URL.revokeObjectURL(this.ttsObjectUrl);
      this.ttsObjectUrl = null;
    }
  }

  private stopAudio(): void {
    this.dgAudioPlayer.stop();
    this.revokeTtsObjectUrl();
  }

  private sceneContentHint(s: DgScene): { hasText: boolean } {
    return { hasText: !!(s.text?.trim() || s.audioUrl) };
  }

  private restoreEmotionAfterSpeech(): void {
    const s = this.scene;
    if (!s) {
      this.charState.setState('idle');
      return;
    }
    this.charState.setState(this.emotionSvc.getEmotion(s.type, undefined, this.sceneContentHint(s)));
  }

  private pacingMultiplier(): number {
    return dgPacingMultiplier({
      lastPracticeWrong: this.lastPracticeAttemptWrong,
      correctStreak: this.correctStreak,
    });
  }

  private speechMood(hold?: DgCharacterAnimState): 'happy' | 'sad' | 'default' {
    if (hold === 'happy') return 'happy';
    if (hold === 'sad') return 'sad';
    return 'default';
  }

  /**
   * Character beat: thinking → speaking → audio → speaking tail → pause → reaction → hold.
   * Coordinates with {@link characterSpeechLocked} so practice mic phases do not override mid-flow.
   */
  private async runSceneSpeech(
    play: () => Promise<void>,
    holdEmotion?: DgCharacterAnimState,
  ): Promise<void> {
    this.characterSpeechLocked = true;
    this.status = 'speaking';
    const pace = this.pacingMultiplier();
    const plan = this.sceneBehaviorPlan;
    const preMul = plan ? behaviorPreSpeakFactor(plan) : 1;
    const transMul = plan ? behaviorTransitionFactor(plan) : 1;
    const reactMul = plan ? behaviorReactionHoldFactor(plan, this.speechMood(holdEmotion)) : 1;
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
          this.restoreEmotionAfterSpeech();
        }
        const holdMs = Math.max(
          120,
          humanReactionHoldMs(DG_CHAR_TIMING.reactionHoldMs, this.speechMood(holdEmotion)) * reactMul,
        );
        await humanDelay(holdMs, pace);
      } finally {
        this.characterSpeechLocked = false;
      }
    }
  }

  /** Pre-generated URL first; on failure/timeout, TTS from fallback text (non-blocking UX). */
  private async playExternal(
    url: string,
    holdEmotion?: DgCharacterAnimState,
    ttsFallback?: string,
  ): Promise<void> {
    const trimmedUrl = url.trim();
    const fb = ttsFallback?.trim();
    this.revokeTtsObjectUrl();
    await this.runSceneSpeech(async () => {
      try {
        await this.dgAudioPlayer.play(trimmedUrl, false);
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
      dgDevLog('tts cache hit');
      src = pre;
    } else {
      const blob = await dgWithOneRetry(() =>
        firstValueFrom(this.dgTts.synthesize(trimmed || text, voice)),
      );
      this.ttsObjectUrl = URL.createObjectURL(blob);
      src = this.ttsObjectUrl;
    }
    await this.runSceneSpeech(() => this.dgAudioPlayer.play(src, false), holdEmotion);
  }

  private async logTts(): Promise<void> {
    if (!this.sessionId) return;
    await firstValueFrom(
      this.dgApi.updateSession({
        sessionId: this.sessionId,
        event: 'tts_play',
        sceneIndex: this.index,
      }),
    );
  }

  private noteSceneEnter(): void {
    this.sceneEnteredAt = Date.now();
    if (!this.sessionId) return;
    firstValueFrom(
      this.dgApi.updateSession({
        sessionId: this.sessionId,
        event: 'scene_enter',
        sceneIndex: this.index,
      }),
    ).catch(() => {});
  }

  private flushSceneTiming(): void {
    if (!this.sessionId || !this.sceneEnteredAt) return;
    const durationMs = Date.now() - this.sceneEnteredAt;
    firstValueFrom(
      this.dgApi.updateSession({
        sessionId: this.sessionId,
        event: 'scene_complete',
        sceneIndex: this.index,
        durationMs,
      }),
    ).catch(() => {});
  }

  private refreshSceneBufferAndPreload(): void {
    this.sceneBuffer = this.scenes[this.index + 1] ?? null;
    const voice = this.payload?.character?.voice || 'alloy';
    const fetchBlob = (t: string, v: string) =>
      dgWithOneRetry(() => firstValueFrom(this.dgTts.synthesize(t, v)));
    this.audioCache.preloadScenesAtIndices(this.scenes, this.index, voice, fetchBlob);
    const urlBatch: string[] = [];
    for (let k = 0; k <= 2; k++) {
      const u = this.scenes[this.index + k]?.audioUrl?.trim();
      if (u) urlBatch.push(u);
    }
    this.dgAudioPlayer.preloadMultiple(urlBatch);
  }

  private updateHighlight(s: DgScene): void {
    if (s.type === 'practice' && s.expectedAnswer) {
      this.highlightWord = s.expectedAnswer;
      return;
    }
    if (s.type === 'teach') {
      const t = s.text?.trim() || '';
      this.highlightWord = t.split(/\s+/).slice(0, 3).join(' ') || t;
      return;
    }
    this.highlightWord = '';
  }

  private async presentScene(): Promise<void> {
    const s = this.scene;
    if (!s || !this.payload) return;
    this.sceneBehaviorPlan = createSceneBehaviorPlan({
      consecutivePracticeFails: this.consecutivePracticeFailures,
      correctStreak: this.correctStreak,
    });
    if (s.type !== 'practice') {
      this.lastPracticeAttemptWrong = false;
    }

    // Reset conversation state for each new scene
    this.conversationTurn = 0;
    this.conversationHistory = [];
    this.aiResponseText = '';
    this.aiResponseTamil = '';
    this.isAiThinking = false;

    this.dialogueVariant = 'default';
    this.showConfetti = false;
    this.practicePassed = false;
    this.transcript = '';
    this.score = null;
    this.canNext = s.type !== 'practice';
    this.updateHighlight(s);
    this.displaySub = s.translation || '';
    this.displayLine = s.text || '';
    this.charState.setState(this.emotionSvc.getEmotion(s.type, undefined, this.sceneContentHint(s)));

    if (s.type === 'practice') {
      this.displayLine = s.text || 'Please repeat.';
      const preGen = s.audioUrl?.trim();
      if (preGen) {
        await this.logTts();
        await this.playExternal(preGen, undefined, this.displayLine);
      } else if (this.displayLine) {
        await this.logTts();
        await this.playTtsBlob(this.displayLine);
      }
      const pace = this.pacingMultiplier();
      const plan = this.sceneBehaviorPlan;
      const transMul = plan ? behaviorTransitionFactor(plan) : 1;
      let practicePad = (200 + DG_CHAR_TIMING.practiceListeningPrimingMs) * transMul;
      const v = Math.random();
      if (v < 0.35) practicePad += 75 + Math.random() * 105;
      else if (v > 0.72) practicePad -= 22 + Math.random() * 48;
      await humanDelay(Math.max(340, practicePad), pace);
      this.charState.setState(this.emotionSvc.getEmotion('practice', undefined, this.sceneContentHint(s)));
      this.status = 'idle';
      this.canNext = false;
      this.refreshSceneBufferAndPreload();
      return;
    }

    const preGenLine = s.audioUrl?.trim();
    if (preGenLine) {
      await this.logTts();
      await this.playExternal(preGenLine, undefined, s.text);
    } else if (s.text) {
      await this.logTts();
      await this.playTtsBlob(s.text);
    }
    const planOut = this.sceneBehaviorPlan;
    const outMul = planOut ? behaviorTransitionFactor(planOut) : 1;
    await humanDelay(120 * outMul, this.pacingMultiplier());
    this.status = 'idle';
    this.canNext = true;
    // Hands-free flow: continue automatically after non-practice narration.
    this.scheduleAutoAdvance(this.nonPracticeAutoAdvanceMs);
    this.refreshSceneBufferAndPreload();
  }

  private async speakCurrent(): Promise<void> {
    const s = this.scene;
    if (!s) return;
    const preGen = s.audioUrl?.trim();
    if (preGen) {
      await this.playExternal(preGen, undefined, s.text || this.displayLine);
    } else if (s.text) {
      await this.playTtsBlob(s.text);
    }
  }

  private async playFeedbackTts(line: string, holdEmotion: DgCharacterAnimState): Promise<void> {
    try {
      await this.logTts();
      await this.playTtsBlob(line, holdEmotion);
    } catch {
      /* ignore TTS errors */
    }
  }

  /**
   * Called on a successful pronunciation attempt when the module is in conversation mode.
   *
   * Flow per turn:
   *  1. Record user message in history
   *  2. Show "Thinking…" while calling the AI
   *  3. Display AI response in the dialogue bubble
   *  4. Speak the AI response via TTS
   *  5a. If scene complete (max turns reached) → advance to next scene
   *  5b. Otherwise → reset practice mic so the student can speak again
   */
  private async handleConversationTurn(ev: PronunciationEvaluateResponse): Promise<void> {
    const scene = this.scene;
    const payload = this.payload;
    if (!scene || !payload || !this.sessionId) return;

    const userText = ev.transcript || '';
    if (!userText.trim()) {
      // No transcript to work with — fall through to normal advance
      this.practicePassed = true;
      this.canNext = true;
      this.scheduleAutoAdvance(1200);
      return;
    }

    // Record user turn in local history
    this.conversationHistory.push({ role: 'user', text: userText });

    // Show thinking state
    this.isAiThinking = true;
    this.charState.setState('thinking');
    this.status = 'speaking'; // block the practice mic while AI responds

    const durationMinutes = payload.module.minimumCompletionTime || 10;
    const totalSeconds = durationMinutes * 60;
    const elapsedSeconds = this.moduleStartedAt
      ? Math.floor((Date.now() - this.moduleStartedAt) / 1000)
      : 0;
    const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);

    try {
      const response = await firstValueFrom(
        this.dgApi.conversationRespond({
          moduleId: payload.module._id,
          sessionId: this.sessionId,
          sceneIndex: this.index,
          userText,
          pronunciationScore: ev.score || 0,
          remainingSeconds,
          turnNumber: this.conversationTurn,
          history: this.conversationHistory.slice(-6),
        }),
      );

      this.isAiThinking = false;

      // Store AI response for CC
      this.aiResponseText = response.text;
      this.aiResponseTamil = response.translatedTamil;
      this.conversationTurn = response.turnNumber;

      // Record AI turn in local history
      this.conversationHistory.push({ role: 'ai', text: response.text });

      // Display AI response in dialogue
      this.displayLine = response.text;
      this.displaySub = '';
      this.dialogueVariant = 'default';

      // Speak the AI response
      try {
        await this.logTts();
        await this.playTtsBlob(response.text);
      } catch {
        /* TTS failure is non-blocking */
      }

      if (response.sceneComplete || this.conversationTurn >= this.maxConversationTurns) {
        // Conversation for this scene is complete — advance
        this.practicePassed = true;
        this.canNext = true;
        await dgDelay(600);
        this.scheduleAutoAdvance(1000);
      } else {
        // Reset for the next student turn — restore scene text and enable mic
        await dgDelay(400);
        this.displayLine = scene.text || '';
        this.displaySub = scene.translation || '';
        this.dialogueVariant = 'default';
        this.practicePassed = false;
        this.canNext = false;
        this.practiceRetryTick += 1;
        this.status = 'idle';
        this.charState.setState('idle');
      }
    } catch (err) {
      // AI call failed — treat as a regular pass and advance
      console.error('[dg-bot-player] conversation respond failed:', err);
      this.isAiThinking = false;
      this.practicePassed = true;
      this.canNext = true;
      this.status = 'idle';
      this.scheduleAutoAdvance(1800);
    }
  }

  private async advance(): Promise<void> {
    this.flushSceneTiming();
    this.stopAudio();
    this.clearPendingAdvance();
    this.consecutivePracticeFailures = 0;
    this.isTransitioning = true;
    await dgDelay(360);
    this.index += 1;
    if (this.index >= this.scenes.length) {
      this.isTransitioning = false;
      await this.finishModule();
      return;
    }
    this.noteSceneEnter();
    await this.presentScene();
    await dgDelay(220);
    this.isTransitioning = false;
  }

  private async finishModule(): Promise<void> {
    if (this.sessionId) {
      const final = this.score != null ? Math.min(100, this.score) : 0;
      await firstValueFrom(this.dgApi.completeSession(this.sessionId, final)).catch(() => {});
    }
    this.charState.forceIdle();
    this.exit();
  }
}
