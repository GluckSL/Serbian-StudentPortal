import { Injectable } from '@angular/core';

/** GlückArena audio — pronunciation, SFX, mute. Mobile-safe unlock via user gesture. */
@Injectable({ providedIn: 'root' })
export class GameAudioService {
  private muted = false;
  private cache = new Map<string, HTMLAudioElement>();
  private unlocked = false;

  readonly correctSrc = '/assets/glueck-arena/sfx/correct.mp3';
  readonly wrongSrc = '/assets/glueck-arena/sfx/wrong.mp3';

  isMuted(): boolean { return this.muted; }

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem('ga_audio_muted', m ? '1' : '0'); } catch { /* ignore */ }
  }

  loadMutePreference(): void {
    try { this.muted = localStorage.getItem('ga_audio_muted') === '1'; } catch { /* ignore */ }
  }

  /** Call once on first user tap (required on iOS). */
  unlock(): void {
    this.unlocked = true;
  }

  preload(url: string): void {
    if (!url || this.muted) return;
    if (!this.cache.has(url)) {
      const a = new Audio(url);
      a.preload = 'auto';
      this.cache.set(url, a);
    }
  }

  playUrl(url: string | null | undefined): void {
    if (!url || this.muted || !this.unlocked) return;
    this.preload(url);
    const base = this.cache.get(url);
    const a = base ? (base.cloneNode(true) as HTMLAudioElement) : new Audio(url);
    a.play().catch(() => { /* autoplay blocked */ });
  }

  playCorrect(): void {
    if (this.muted || !this.unlocked) return;
    new Audio(this.correctSrc).play().catch(() => this.beep(880, 0.12));
  }

  playWrong(): void {
    if (this.muted || !this.unlocked) return;
    new Audio(this.wrongSrc).play().catch(() => this.beep(220, 0.15));
  }

  private beep(freq: number, duration: number): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch { /* ignore */ }
  }
}
