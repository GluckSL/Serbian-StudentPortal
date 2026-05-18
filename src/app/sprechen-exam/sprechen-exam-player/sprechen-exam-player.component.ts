import {
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { SprechenApiService } from '../sprechen-api.service';
import { DgCharacterComponent } from '../../dg-bot/dg-character/dg-character.component';
import { DgPracticeComponent, type DgPracticePhase } from '../../dg-bot/dg-practice/dg-practice.component';
import { DgCharacterStateService } from '../../dg-bot/dg-character-state.service';
import { DgTtsService } from '../../dg-bot/dg-tts.service';
import { DgAudioPlayerService } from '../../dg-bot/dg-audio-player.service';
import { dgWithOneRetry } from '../../dg-bot/dg-player.util';
import { ExamCardPanelComponent } from '../exam-card-panel/exam-card-panel.component';
import { ExamProgressComponent } from '../exam-progress/exam-progress.component';
import { ExamSummaryComponent } from '../exam-summary/exam-summary.component';
import type { PronunciationEvaluateResponse } from '../../services/pronunciation.service';
import type {
  SprechenBotMessage,
  SprechenCard,
  SprechenPartNum,
  SprechenPlayPayload,
  SprechenScores,
  SprechenTurnResult,
} from '../sprechen-exam.types';

interface ExamChatMessage {
  speaker: 'ai' | 'student';
  text: string;
  captionEn?: string;
  captionTa?: string;
}

@Component({
  selector: 'app-sprechen-exam-player',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    DgCharacterComponent,
    DgPracticeComponent,
    ExamCardPanelComponent,
    ExamProgressComponent,
    ExamSummaryComponent,
  ],
  templateUrl: './sprechen-exam-player.component.html',
  styleUrls: [
    '../../dg-bot/dg-bot-player/dg-bot-player.component.scss',
    './sprechen-exam-player.component.scss',
  ],
})
export class SprechenExamPlayerComponent implements OnInit, OnDestroy {
  @ViewChild('chatScroll') private chatScrollRef?: ElementRef<HTMLDivElement>;

  private readonly api = inject(SprechenApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly charState = inject(DgCharacterStateService);
  private readonly dgTts = inject(DgTtsService);
  private readonly dgAudioPlayer = inject(DgAudioPlayerService);
  private readonly zone = inject(NgZone);

  loading = true;
  error: string | null = null;
  payload: SprechenPlayPayload | null = null;
  sessionId: string | null = null;

  phase = 'welcome';
  awaitingStudent = false;
  teilNumber: SprechenPartNum = 0;
  currentCard: SprechenCard | null = null;
  chatHistory: ExamChatMessage[] = [];

  botSpeaking = false;
  micProcessing = false;
  micRetryTick = 0;
  mascotSpeechText = '';
  ccMode: 'none' | 'en' | 'ta' = 'none';
  isMobile = false;

  examDone = false;
  finalScores: SprechenScores | null = null;

  private pendingTranscript = '';
  private pendingDurationMs = 0;
  private ttsObjectUrl: string | null = null;
  private destroyed = false;
  private lastSpokenText = '';

  @HostListener('window:resize')
  onResize(): void {
    this.zone.run(() => {
      this.isMobile = window.innerWidth < 900;
    });
  }

  ngOnInit(): void {
    this.isMobile = window.innerWidth < 900;
    const moduleId = this.route.snapshot.paramMap.get('moduleId');
    if (!moduleId) {
      this.error = 'Missing module.';
      this.loading = false;
      return;
    }
    this._initExam(moduleId);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.dgAudioPlayer.stop();
    this.revokeTtsObjectUrl();
  }

  get isWelcomePhase(): boolean {
    return this.phase === 'welcome';
  }

  get characterName(): string {
    return this.payload?.character?.name || 'Olly Tutor';
  }

  get showStudentTurnUi(): boolean {
    return this.awaitingStudent && !this.isWelcomePhase && !this.botSpeaking && !this.micProcessing;
  }

  get statusLabel(): string | null {
    if (this.botSpeaking) return `${this.characterName} spricht…`;
    if (this.micProcessing) return 'Verarbeitung…';
    if (this.showStudentTurnUi) return 'Ihre Antwort';
    if (this.isWelcomePhase && !this.botSpeaking) return 'Bereit?';
    return null;
  }

  getCcCaption(msg: ExamChatMessage): string {
    if (msg.speaker !== 'ai') return '';
    if (this.ccMode === 'en') return (msg.captionEn || '').trim();
    if (this.ccMode === 'ta') return (msg.captionTa || '').trim();
    return '';
  }

  async replayTts(): Promise<void> {
    const last = [...this.chatHistory].reverse().find((m) => m.speaker === 'ai');
    const text = (last?.text || this.lastSpokenText || '').trim();
    if (!text) return;
    this.dgAudioPlayer.stop();
    await this._playTts(text);
  }

  onPracticePhase(p: DgPracticePhase): void {
    if (p === 'listening') {
      this.mascotSpeechText = '';
      this.charState.setState('listening');
      return;
    }
    if (p === 'processing') {
      this.charState.setState('thinking');
      return;
    }
    if (p === 'countdown') {
      this.charState.setState('thinking');
      return;
    }
    this.charState.setState('idle');
  }

  async onReady(): Promise<void> {
    if (!this.sessionId || this.botSpeaking) return;
    this.awaitingStudent = false;
    try {
      const result = await firstValueFrom(this.api.advance(this.sessionId, 'ready'));
      await this._handleTurnResult(result);
    } catch (e: any) {
      this.error = e?.error?.message || 'Advance failed';
    }
  }

  async onEvaluated(ev: PronunciationEvaluateResponse): Promise<void> {
    if (!this.sessionId || !this.awaitingStudent) return;
    this.pendingTranscript = ev.transcript || '';
    this.pendingDurationMs = 0;
    await this._submitTurn();
  }

  onSilence(): void {
    if (this.awaitingStudent && !this.micProcessing) {
      this.micRetryTick++;
    }
  }

  async onRetake(): Promise<void> {
    const moduleId = this.route.snapshot.paramMap.get('moduleId');
    if (moduleId) {
      window.location.href = `/sprechen-exam/${moduleId}/play`;
    }
  }

  onExit(): void {
    this.router.navigate(['/sprechen-exam']);
  }

  private async _initExam(moduleId: string): Promise<void> {
    try {
      this.payload = await firstValueFrom(this.api.getPlay(moduleId));
      const start = await firstValueFrom(this.api.startSession(moduleId));
      this.sessionId = start.sessionId;
      this.loading = false;
      await this._handleTurnResult({
        botMessages: start.botMessages,
        card: start.card,
        phase: start.phase,
        awaitingStudent: start.awaitingStudent,
        done: false,
      });
    } catch (e: any) {
      this.error = e?.error?.message || e?.message || 'Failed to start exam.';
      this.loading = false;
    }
  }

  private async _handleTurnResult(result: SprechenTurnResult): Promise<void> {
    if (this.destroyed) return;

    this.phase = result.phase;
    this.teilNumber = this._inferTeilFromPhase(result.phase);

    if (result.card) {
      this.currentCard = result.card;
    } else if (!result.awaitingStudent) {
      this.currentCard = null;
    }

    for (const msg of result.botMessages) {
      await this._speakBotMessage(msg);
    }

    if (result.done) {
      this.examDone = true;
      this.awaitingStudent = false;
      this.currentCard = null;
      if (result.scores) {
        this.finalScores = result.scores;
      } else if (this.sessionId) {
        try {
          const comp = await firstValueFrom(this.api.completeSession(this.sessionId));
          this.finalScores = comp.scores;
        } catch {
          /* non-fatal */
        }
      }
      return;
    }

    this.awaitingStudent = result.awaitingStudent;
    if (result.awaitingStudent) {
      this.micRetryTick++;
      this.charState.setState('idle');
    }
  }

  private async _speakBotMessage(msg: SprechenBotMessage): Promise<void> {
    const text = (msg.text || '').trim();
    if (!text) return;
    this.chatHistory.push({
      speaker: 'ai',
      text,
      captionEn: msg.captionEn,
      captionTa: msg.captionTa,
    });
    this._scrollChat();
    await this._playTts(text);
  }

  private async _playTts(text: string): Promise<void> {
    if (!text || this.destroyed) return;
    this.lastSpokenText = text;
    this.botSpeaking = true;
    this.mascotSpeechText = text.length > 120 ? `${text.slice(0, 117)}…` : text;
    this.charState.setState('speaking');

    try {
      const voice = this.payload?.character?.voice || 'alloy';
      this.revokeTtsObjectUrl();
      const blob = await dgWithOneRetry(() =>
        firstValueFrom(this.dgTts.synthesize(text, voice)),
      );
      if (this.destroyed) return;
      this.ttsObjectUrl = URL.createObjectURL(blob);
      await this.dgAudioPlayer.play(this.ttsObjectUrl, true);
    } catch {
      /* TTS non-critical */
    } finally {
      if (!this.destroyed) {
        this.botSpeaking = false;
        this.mascotSpeechText = '';
        this.charState.setState('idle');
      }
    }
  }

  private async _submitTurn(): Promise<void> {
    if (!this.sessionId || !this.awaitingStudent) return;

    this.awaitingStudent = false;
    this.micProcessing = true;

    const transcript = this.pendingTranscript;
    this.chatHistory.push({ speaker: 'student', text: transcript });
    this._scrollChat();

    try {
      const result = await firstValueFrom(
        this.api.submitTurn(this.sessionId, transcript, this.pendingDurationMs),
      );
      this.micProcessing = false;
      await this._handleTurnResult(result);
    } catch (e: any) {
      this.micProcessing = false;
      this.error = e?.error?.message || 'Turn submission failed';
    }
  }

  private revokeTtsObjectUrl(): void {
    if (this.ttsObjectUrl) {
      URL.revokeObjectURL(this.ttsObjectUrl);
      this.ttsObjectUrl = null;
    }
  }

  private _inferTeilFromPhase(phase: string): SprechenPartNum {
    if (phase.startsWith('teil1')) return 1;
    if (phase.startsWith('teil2')) return 2;
    if (phase.startsWith('teil3')) return 3;
    return 0;
  }

  private _scrollChat(): void {
    this.zone.runOutsideAngular(() => {
      setTimeout(() => {
        const el = this.chatScrollRef?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, 50);
    });
  }
}
