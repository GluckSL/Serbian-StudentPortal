import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { PronunciationService } from '../../services/pronunciation.service';
import type { PronunciationEvaluateResponse } from '../../services/pronunciation.service';
import { DgCharacterStateService } from '../dg-character-state.service';
import { dgDelay, dgWithOneRetry } from '../dg-player.util';

export type DgPracticePhase = 'idle' | 'countdown' | 'listening' | 'processing';

@Component({
  selector: 'app-dg-practice',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './dg-practice.component.html',
  styleUrl: './dg-practice.component.scss',
})
export class DgPracticeComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('waveCanvas') waveCanvas?: ElementRef<HTMLCanvasElement>;

  @Input() expected = '';
  /** Allow recording even when `expected` is empty (conversation/free-speech mode). */
  @Input() allowFreeSpeech = false;
  /** Skip pre-recording countdown for realtime conversation mode. */
  @Input() instantStart = false;
  @Input() language = 'German';
  @Input() disabled = false;
  @Input() hint = '';
  /** Parent bumps after a failed attempt (reserved for future UX hooks). */
  @Input() retryTick = 0;
  @Input() sceneKey = '';
  /** Hide transcript, word breakdown, and tips (e.g. formal exam mode). */
  @Input() hideFeedback = false;
  /**
   * When true the component is in monologue mode — silence does not emit `silence` or auto-stop.
   * The parent must call `stopAndEvaluate()` (via ViewChild) to finish the turn.
   */
  @Input() monologueMode = false;

  @Output() evaluated = new EventEmitter<PronunciationEvaluateResponse>();
  @Output() silence = new EventEmitter<void>();
  @Output() phaseChange = new EventEmitter<DgPracticePhase>();

  recording = false;
  processing = false;
  /** Shown when server evaluation exceeds ~3s (UX only). */
  processingSlowUi = false;
  lastTranscript = '';
  /** Last server evaluation (word breakdown + hints). */
  lastEval: PronunciationEvaluateResponse | null = null;
  countdownLabel: string | null = null;

  private raf = 0;
  private waveInterval: ReturnType<typeof setInterval> | null = null;
  private processingSlowTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pronunciation = inject(PronunciationService);
  private readonly charState = inject(DgCharacterStateService);

  /** Throttle canvas waveform on narrow / coarse-pointer devices. */
  private readonly useLowFpsWave =
    typeof window !== 'undefined' &&
    (() => {
      try {
        return (
          window.matchMedia('(max-width: 768px)').matches ||
          window.matchMedia('(pointer: coarse)').matches
        );
      } catch {
        return window.innerWidth <= 768;
      }
    })();

  ngAfterViewInit(): void {
    this.resizeCanvas();
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['sceneKey'] && !ch['sceneKey'].firstChange) {
      this.lastTranscript = '';
      this.lastEval = null;
      this.countdownLabel = null;
    }
  }

  ngOnDestroy(): void {
    this.stopWaveVisual();
    if (this.processingSlowTimer) {
      clearTimeout(this.processingSlowTimer);
      this.processingSlowTimer = null;
    }
    if (this.pronunciation.isRecording()) {
      this.pronunciation.cancelRecording();
    }
    this.emitPhase('idle');
  }

  get countdownActive(): boolean {
    return this.countdownLabel !== null;
  }

  private emitPhase(p: DgPracticePhase): void {
    this.phaseChange.emit(p);
  }

  private resizeCanvas(): void {
    const c = this.waveCanvas?.nativeElement;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    c.width = Math.max(320, rect.width * (window.devicePixelRatio || 1));
    c.height = Math.max(48, rect.height * (window.devicePixelRatio || 1));
  }

  private stopWaveVisual(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.waveInterval) {
      clearInterval(this.waveInterval);
      this.waveInterval = null;
    }
  }

  private drawFrame(): void {
    const canvas = this.waveCanvas?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const analyser = this.pronunciation.getAnalyser();
    if (analyser && this.recording) {
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(buf);
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const step = Math.max(1, Math.floor(buf.length / w));
      for (let x = 0; x < w; x++) {
        const v = buf[x * step] / 128 - 1;
        const y = h / 2 + v * (h * 0.45);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(74, 222, 128, 0.2)';
      ctx.fillRect(0, h * 0.45, w, 2);
    }
  }

  private startWaveVisual(): void {
    this.stopWaveVisual();
    if (this.useLowFpsWave) {
      this.waveInterval = setInterval(() => this.drawFrame(), 72);
    } else {
      const loop = (): void => {
        this.drawFrame();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }
  }

  private async runCountdown(): Promise<void> {
    this.emitPhase('countdown');
    this.charState.setState('thinking');
    this.countdownLabel = 'Pripremite se…';
    await dgDelay(550);
    for (const n of [3, 2, 1]) {
      this.countdownLabel = String(n);
      await dgDelay(650);
    }
    this.countdownLabel = 'Govorite sada!';
    await dgDelay(350);
    this.countdownLabel = null;
    this.charState.setState('listening');
    this.emitPhase('listening');
  }

  /** Called by parent (e.g. monologue Fertig button) to stop recording and emit evaluated. */
  async stopAndEvaluate(): Promise<void> {
    if (this.recording) {
      await this.toggleRecord();
    }
  }

  async toggleRecord(): Promise<void> {
    if (this.disabled || this.processing || this.countdownActive) return;
    if (!this.recording) {
      this.lastTranscript = '';
      this.lastEval = null;
      this.resizeCanvas();
      try {
        if (!this.instantStart) {
          await this.runCountdown();
        } else {
          this.countdownLabel = null;
          this.charState.setState('listening');
          this.emitPhase('listening');
        }
        await this.pronunciation.startRecording();
        this.recording = true;
        this.startWaveVisual();
      } catch (e) {
        console.error('[dg-practice] startRecording failed', e);
        this.recording = false;
        this.emitPhase('idle');
      }
      return;
    }
    this.recording = false;
    this.stopWaveVisual();
    try {
      this.processing = true;
      this.processingSlowUi = false;
      if (this.processingSlowTimer) clearTimeout(this.processingSlowTimer);
      this.processingSlowTimer = setTimeout(() => {
        this.processingSlowUi = true;
        this.processingSlowTimer = null;
      }, 3000);
      this.charState.setState('thinking');
      this.emitPhase('processing');
      const result = await this.pronunciation.stopRecording();
      const silence = this.pronunciation.evaluateSilence(
        result.durationMs,
        this.allowFreeSpeech
          ? { minDurationMs: 250, minAverageLevel: 0.0035, minPeakLevel: 0.012 }
          : {},
      );
      if ((this.allowFreeSpeech ? result.durationMs < 220 : !silence.ok) || result.blob.size < 32) {
        this.emitPhase('idle');
        // In monologue mode don't abort — the student may have just paused; let them try again.
        if (!this.monologueMode) {
          this.silence.emit();
        }
        return;
      }
      const evalResult = await dgWithOneRetry(() =>
        firstValueFrom(
          this.pronunciation.evaluateAudio(result.blob, {
            expected: this.expected || 'free speech',
            // Free-speech conversation: omit `language` so the API uses auto-detect
            // (see pronunciationEvaluation.js — forced German was turning English into German text).
            language: this.allowFreeSpeech ? undefined : this.language,
            clientMeta: { source: 'dg-bot', freeSpeech: this.allowFreeSpeech, silenceReason: silence.reason || null },
          }),
        ),
      );
      this.lastTranscript = evalResult.transcript || '';
      this.lastEval = evalResult;
      this.evaluated.emit(evalResult);
    } catch (e) {
      console.error('[dg-practice]', e);
      this.silence.emit();
    } finally {
      if (this.processingSlowTimer) {
        clearTimeout(this.processingSlowTimer);
        this.processingSlowTimer = null;
      }
      this.processingSlowUi = false;
      this.processing = false;
      this.emitPhase('idle');
    }
  }
}
