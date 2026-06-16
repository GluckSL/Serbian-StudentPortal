import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../../environments/environment';

interface ArenaMediaConfigResponse {
  success?: boolean;
  r2Configured?: boolean;
  sfx?: {
    correct?: string;
    wrong?: string;
    lost?: string;
    xpGain?: string;
  } | null;
}

/** GlückArena audio — pronunciation, SFX, mute. SFX load from R2 when configured. */
@Injectable({ providedIn: 'root' })
export class GameAudioService {
  private readonly http = inject(HttpClient);
  private muted = false;
  private cache = new Map<string, HTMLAudioElement>();
  private unlocked = false;

  private correctSrc = '/assets/audios/correct.mp3';
  private wrongSrc = '/assets/audios/incorrect.mp3';
  private lostSrc = '/assets/audios/lost.mp3';
  private xpGainSrc = '/assets/audios/xp-gain.mp3';

  /** Cached blob URLs for SFX — avoids any network request on subsequent plays. */
  private blobUrls = new Map<string, string>();

  constructor() {
    this.loadMutePreference();
    this.loadSfxFromApi();
    this.prefetchSfx(this.correctSrc);
    this.prefetchSfx(this.wrongSrc);
    this.prefetchSfx(this.lostSrc);
    this.prefetchSfx(this.xpGainSrc);
  }

  /** Eagerly fetch each SFX file once and store as an in-memory blob URL. */
  private prefetchSfx(src: string): void {
    if (!src || this.blobUrls.has(src)) return;
    fetch(src)
      .then(r => r.blob())
      .then(blob => { this.blobUrls.set(src, URL.createObjectURL(blob)); })
      .catch(() => {});
  }

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

  private loadSfxFromApi(): void {
    const url = `${environment.apiUrl}/interactive-games/media-config`;
    this.http.get<ArenaMediaConfigResponse>(url).subscribe({
      next: (res) => {
        const sfx = res?.sfx;
        if (!sfx) return;
        if (sfx.correct) { this.correctSrc = sfx.correct; this.prefetchSfx(sfx.correct); }
        if (sfx.wrong) { this.wrongSrc = sfx.wrong; this.prefetchSfx(sfx.wrong); }
        if (sfx.lost) { this.lostSrc = sfx.lost; this.prefetchSfx(sfx.lost); }
        if (sfx.xpGain) { this.xpGainSrc = sfx.xpGain; this.prefetchSfx(sfx.xpGain); }
      },
      error: () => { /* keep local /assets fallback for dev without R2 */ },
    });
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

  private playCached(src: string, fallbackFreq: number, fallbackDuration: number): void {
    if (this.muted || !this.unlocked) return;
    const blobUrl = this.blobUrls.get(src);
    if (blobUrl) {
      const a = new Audio(blobUrl);
      a.volume = 0.7;
      a.play().catch(() => this.beep(fallbackFreq, fallbackDuration));
    } else {
      this.prefetchSfx(src);
      const a = new Audio(src);
      a.volume = 0.7;
      a.play().catch(() => this.beep(fallbackFreq, fallbackDuration));
    }
  }

  playCorrect(): void {
    this.playCached(this.correctSrc, 880, 0.12);
  }

  playWrong(): void {
    this.playCached(this.wrongSrc, 220, 0.15);
  }

  playLost(): void {
    this.playCached(this.lostSrc, 180, 0.4);
  }

  playXpGain(): void {
    this.playCached(this.xpGainSrc, 660, 0.2);
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
