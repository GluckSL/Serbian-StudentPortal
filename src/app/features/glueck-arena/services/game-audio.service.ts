import { Injectable } from '@angular/core';

/** GlückArena audio — pronunciation, SFX, mute. Mobile-safe unlock via user gesture. */
@Injectable({ providedIn: 'root' })
export class GameAudioService {
  private muted = false;
  private cache = new Map<string, HTMLAudioElement>();
  private unlocked = false;

  readonly correctSrc = '/assets/audios/correct.mp3';
  readonly wrongSrc = '/assets/audios/incorrect.mp3';
  readonly lostSrc = '/assets/audios/lost.mp3';
  readonly xpGainSrc = '/assets/audios/xp-gain.mp3';

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

  private createAudio(src: string): HTMLAudioElement {
    const a = new Audio(src);
    a.volume = 0.7;
    return a;
  }

  preload(url: string): void {
    if (!url || this.muted) return;
    if (!this.cache.has(url)) {
      const a = this.createAudio(url);
      a.preload = 'auto';
      this.cache.set(url, a);
    }
  }

  playUrl(url: string | null | undefined): void {
    if (!url || this.muted || !this.unlocked) return;
    this.preload(url);
    const base = this.cache.get(url);
    const a = base ? (base.cloneNode(true) as HTMLAudioElement) : this.createAudio(url);
    a.play().catch(() => { /* autoplay blocked */ });
  }

  playCorrect(): void {
    if (this.muted || !this.unlocked) return;
    this.createAudio(this.correctSrc).play().catch(() => this.beep(880, 0.12));
  }

  playWrong(): void {
    if (this.muted || !this.unlocked) return;
    this.createAudio(this.wrongSrc).play().catch(() => this.beep(220, 0.15));
  }

  playLost(): void {
    if (this.muted || !this.unlocked) return;
    this.createAudio(this.lostSrc).play().catch(() => this.beep(180, 0.4));
  }

  playXpGain(): void {
    if (this.muted || !this.unlocked) return;
    this.createAudio(this.xpGainSrc).play().catch(() => this.beep(660, 0.2));
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
