// src/app/components/audio-visualizer/audio-visualizer.component.ts
//
// Lightweight real-time audio level visualiser (equaliser-style bars).
//
// Takes an AnalyserNode produced by the PronunciationService and paints
// N bars at animation frame rate. When the input is silent the bars sit
// at a resting height and the host element gets the `.av--silent` class
// (so callers can style a "no sound detected" state).
//
// This component is intentionally analyser-only (not stream-only):
// the service owns the AudioContext + analyser graph so we don't fight
// browser autoplay/mic constraints, and the same analyser drives both
// the bars here and the silence detection used for pre-validation.

import {
  Component,
  ChangeDetectionStrategy,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  NgZone,
  ElementRef,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-audio-visualizer',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #wrap
      class="av"
      [class.av--active]="active"
      [class.av--silent]="silent"
      [attr.aria-label]="active ? (silent ? 'No audio detected' : 'Recording audio') : null"
      role="img"
    >
      <span
        *ngFor="let bar of bars; let i = index; trackBy: trackByIndex"
        class="av__bar"
        [attr.data-i]="i"
      ></span>
      <span class="av__hint" *ngIf="active && silent">No sound detected</span>
    </div>
  `,
  styleUrls: ['./audio-visualizer.component.css'],
})
export class AudioVisualizerComponent implements OnChanges, AfterViewInit, OnDestroy {
  /** The AnalyserNode to read from. When null the component renders a flat baseline. */
  @Input() analyser: AnalyserNode | null = null;
  /** When false, stops the RAF loop and clamps bars to their resting height. */
  @Input() active = false;
  /** Number of bars to render (visual density). */
  @Input() barCount = 28;
  /** RMS threshold below which we consider the input "silent". 0..1. */
  @Input() silentThreshold = 0.02;

  bars: number[] = [];
  silent = false;

  private rafId: number | null = null;
  private freqBuffer: Uint8Array = new Uint8Array(0);
  private timeBuffer: Uint8Array = new Uint8Array(0);
  private silentFrames = 0;
  private loudFrames = 0;

  @ViewChild('wrap', { static: false }) private wrapRef?: ElementRef<HTMLDivElement>;

  constructor(private zone: NgZone) {
    this.bars = this.makeBaseline(this.barCount);
  }

  trackByIndex(i: number): number { return i; }

  ngAfterViewInit(): void {
    this.applyBarsToDOM();
    this.maybeStartOrStop();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['barCount']) {
      this.bars = this.makeBaseline(this.barCount);
      this.applyBarsToDOM();
    }
    if (changes['active'] || changes['analyser']) {
      this.maybeStartOrStop();
    }
  }

  ngOnDestroy(): void {
    this.stopLoop();
  }

  private makeBaseline(n: number): number[] {
    return Array.from({ length: n }, () => 0.08);
  }

  private maybeStartOrStop(): void {
    if (this.active && this.analyser) {
      this.startLoop();
    } else {
      this.stopLoop();
      this.bars = this.makeBaseline(this.barCount);
      this.silent = false;
      this.applyBarsToDOM();
    }
  }

  private startLoop(): void {
    if (this.rafId != null || !this.analyser) return;
    // Size buffers once per analyser identity.
    if (this.freqBuffer.length !== this.analyser.frequencyBinCount) {
      this.freqBuffer = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeBuffer = new Uint8Array(this.analyser.fftSize);
    }
    this.silentFrames = 0;
    this.loudFrames = 0;

    // Drive the loop outside Angular — we paint straight to the DOM so
    // we don't need change detection at 60 fps.
    this.zone.runOutsideAngular(() => {
      const tick = () => {
        if (!this.analyser || !this.active) { this.rafId = null; return; }

        // Bars from frequency bins.
        this.analyser.getByteFrequencyData(this.freqBuffer);
        const bins = this.freqBuffer.length;
        const barCount = this.barCount;
        // Focus on speech-relevant band: roughly 80 Hz – 4 kHz.
        // With 44.1 kHz * fftSize/2 bins, the band maps to the lower ~40% of bins.
        const usable = Math.max(barCount * 2, Math.floor(bins * 0.4));
        const step = Math.max(1, Math.floor(usable / barCount));
        for (let b = 0; b < barCount; b++) {
          let sum = 0;
          const start = b * step;
          const end = Math.min(start + step, usable);
          for (let j = start; j < end; j++) sum += this.freqBuffer[j];
          const avg = sum / Math.max(1, end - start); // 0..255
          // Normalise to 0..1 with a gentle curve so small signals still render.
          const norm = Math.min(1, Math.pow(avg / 255, 0.7));
          // Ease toward new value for a smoother animation.
          const prev = this.bars[b] ?? 0.08;
          this.bars[b] = Math.max(0.08, prev * 0.45 + norm * 0.55);
        }

        // RMS from time-domain for silence detection.
        this.analyser.getByteTimeDomainData(this.timeBuffer);
        let sumSq = 0;
        for (let i = 0; i < this.timeBuffer.length; i++) {
          const v = (this.timeBuffer[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / this.timeBuffer.length);
        if (rms < this.silentThreshold) {
          this.silentFrames++;
          this.loudFrames = 0;
        } else {
          this.loudFrames++;
          this.silentFrames = 0;
        }
        const nextSilent = this.silentFrames > 45; // ~750ms at 60fps
        if (nextSilent !== this.silent) {
          this.silent = nextSilent;
          // Rare host-class update — safe to run inside zone.
          this.zone.run(() => { /* triggers CD for [class.av--silent] */ });
        }

        this.applyBarsToDOM();
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    });
  }

  private stopLoop(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** Paint bar heights via transforms — no Angular change detection. */
  private applyBarsToDOM(): void {
    const host = this.wrapRef?.nativeElement;
    if (!host) return;
    const nodes = host.querySelectorAll<HTMLSpanElement>('.av__bar');
    const len = Math.min(nodes.length, this.bars.length);
    for (let i = 0; i < len; i++) {
      // scaleY uses transform-origin: bottom in CSS.
      nodes[i].style.transform = `scaleY(${this.bars[i].toFixed(3)})`;
    }
  }
}
