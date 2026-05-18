import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Input,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DgCharacterStateService, type DgCharacterAnimState } from '../dg-character-state.service';

/** Fox pack uses full-body assets only (`idlefull.png`, etc.). */
const FOX_POSE = 'full' as const;

/** PNG stems that exist under `assets/dg-bot/fox/`. */
const FOX_FILE_STEMS = new Set(['idle', 'happy', 'sad', 'speaking', 'thinking']);

@Component({
  selector: 'app-dg-character',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dg-character.component.html',
  styleUrl: './dg-character.component.scss',
})
export class DgCharacterComponent implements OnInit {
  private readonly charState = inject(DgCharacterStateService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Bound from centralized character state service. */
  displayState: DgCharacterAnimState = 'idle';

  isBlinking = false;

  private blinkChain: ReturnType<typeof setTimeout> | null = null;
  private blinkOff: ReturnType<typeof setTimeout> | null = null;

  private dead = false;

  @Input() name = 'Fritz';
  /** Unused: all art is full-body fox. Kept for template compatibility. */
  @Input() pose: typeof FOX_POSE = FOX_POSE;
  @Input() animations: Record<string, string> | null = null;
  /** Player layout: hide mood pill + colored stage outline (must live here — parent CSS cannot pierce encapsulation). */
  @Input() minimalChrome = false;

  constructor() {
    this.charState.state$.pipe(takeUntilDestroyed()).subscribe((s) => {
      this.displayState = s;
      this.cdr.markForCheck();
    });

    this.destroyRef.onDestroy(() => {
      this.dead = true;
      this.clearBlinkTimers();
    });
  }

  ngOnInit(): void {
    this.scheduleBlinkLoop();
  }

  moodLabel(): string {
    return this.displayState.charAt(0).toUpperCase() + this.displayState.slice(1);
  }

  /**
   * Fritz fox — always full-body: `assets/dg-bot/fox/{state}full.png`
   * listening → idle, confused → thinking, unknown → idle.
   */
  getImageSrc(): string {
    const mapped = this.mapFoxState(this.displayState);
    return `assets/dg-bot/fox/${mapped}${FOX_POSE}.png`;
  }

  private mapFoxState(state: DgCharacterAnimState): string {
    let s = state as string;
    if (state === 'listening') s = 'idle';
    if (state === 'confused') s = 'thinking';
    if (!FOX_FILE_STEMS.has(s)) s = 'idle';
    return s;
  }

  private scheduleBlinkLoop(): void {
    if (this.dead) return;
    const wait = 3000 + Math.random() * 2000;
    this.blinkChain = setTimeout(() => {
      if (this.dead) return;
      this.isBlinking = true;
      this.cdr.markForCheck();
      this.blinkOff = setTimeout(() => {
        if (this.dead) return;
        this.isBlinking = false;
        this.cdr.markForCheck();
        this.scheduleBlinkLoop();
      }, 120);
    }, wait);
  }

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img) return;
    const fallback = 'assets/dg-bot/lumo.svg';
    if (img.src.includes('lumo.svg') || img.getAttribute('data-fallback') === '1') return;
    img.setAttribute('data-fallback', '1');
    img.src = fallback;
  }
