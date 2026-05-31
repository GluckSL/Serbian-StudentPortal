import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { DgAudioCacheService } from './dg-audio-cache.service';

const FADE_MS = 200;
const PLAY_START_TIMEOUT_MS = 1200;
const HAVE_FUTURE_DATA = 3;

function waitForCanPlay(a: HTMLAudioElement): Promise<void> {
  if (a.readyState >= HAVE_FUTURE_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      if (a.readyState >= HAVE_FUTURE_DATA) {
        cleanup();
        resolve();
      }
    };
    const fail = () => {
      cleanup();
      reject(new Error('DG_AUDIO_CANPLAY_FAILED'));
    };
    const cleanup = () => {
      a.removeEventListener('canplay', done);
      a.removeEventListener('canplaythrough', done);
      a.removeEventListener('loadeddata', done);
      a.removeEventListener('error', fail);
    };
    a.addEventListener('canplay', done, { once: true });
    a.addEventListener('canplaythrough', done, { once: true });
    a.addEventListener('loadeddata', done, { once: true });
    a.addEventListener('error', fail, { once: true });
  });
}

/**
 * Single-element DG scene audio playback: no overlap, fade-in, canplay wait, interrupt-safe.
 */
@Injectable({ providedIn: 'root' })
export class DgAudioPlayerService {
  private el: HTMLAudioElement | null = null;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;
  /** Reject in-flight play() when stop() / new play() interrupts. */
  private cancelPlay: (() => void) | null = null;

  currentSrc: string | null = null;

  constructor(private cache: DgAudioCacheService) {}

  private getEl(): HTMLAudioElement {
    if (!this.el) this.el = new Audio();
    return this.el;
  }

  private clearFade(): void {
    if (this.fadeInterval != null) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
  }

  private startFadeIn(a: HTMLAudioElement, ms: number): void {
    this.clearFade();
    a.volume = 0;
    const steps = 10;
    const stepMs = ms / steps;
    let i = 0;
    this.fadeInterval = setInterval(() => {
      i++;
      const v = Math.min(1, i / steps);
      try {
        a.volume = v;
      } catch {
        /* ignore */
      }
      if (i >= steps) {
        this.clearFade();
        try {
          a.volume = 1;
        } catch {
          /* ignore */
        }
      }
    }, stepMs);
  }

  private debugLog(url: string, readyState: number, usedFallback: boolean): void {
    if (environment.production) return;
    const short = url.length > 160 ? `${url.slice(0, 160)}…` : url;
    console.log('DG AUDIO:', { url: short, readyState, usedFallback });
  }

  stop(): void {
    this.cancelPlay?.();
    this.cancelPlay = null;
    this.clearFade();
    const a = this.el;
    if (a) {
      try {
        a.pause();
        a.removeAttribute('src');
        a.load();
      } catch {
        /* ignore */
      }
    }
    this.currentSrc = null;
  }

  /**
   * Warm decode/cache for a URL (delegates to cache; does not touch playback element).
   */
  preload(url: string): void {
    const u = url.trim();
    if (u) this.cache.preloadUrlAudio(u);
  }

  preloadMultiple(urls: string[]): void {
    for (const u of urls) {
      const t = u?.trim();
      if (t) this.cache.preloadUrlAudio(t);
    }
  }

  /**
   * Play one URL/blob URL to completion. Stops any current sound first.
   * Fades in over {@link FADE_MS}. Rejects on error, start timeout, or interrupt.
   */
  async play(url: string, usedFallback = false): Promise<void> {
    const trimmed = url.trim();
    if (!trimmed) return Promise.reject(new Error('DG_AUDIO_EMPTY'));

    this.cancelPlay?.();
    this.cancelPlay = null;
    this.clearFade();

    const a = this.getEl();
    try {
      a.pause();
    } catch {
      /* ignore */
    }
    this.currentSrc = trimmed;
    a.volume = 0;
    a.src = trimmed;
    try {
      a.load();
    } catch {
      /* ignore */
    }

    await waitForCanPlay(a);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        this.cancelPlay = null;
        this.clearFade();
        a.removeEventListener('ended', onEnded);
        a.removeEventListener('error', onError);
        if (err) {
          try {
            a.pause();
          } catch {
            /* ignore */
          }
        }
        try {
          a.volume = 1;
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else resolve();
      };

      this.cancelPlay = () => {
        if (settled) return;
        finish(new Error('DG_AUDIO_STOP'));
      };

      const onEnded = () => finish();
      const onError = () => finish(new Error('DG_AUDIO_ELEMENT_ERROR'));
      a.addEventListener('ended', onEnded);
      a.addEventListener('error', onError);

      const startPlayback = async () => {
        try {
          await Promise.race([
            a.play(),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error('DG_AUDIO_PLAY_TIMEOUT')), PLAY_START_TIMEOUT_MS),
            ),
          ]);
        } catch (e) {
          finish(e instanceof Error ? e : new Error('DG_AUDIO_PLAY_FAILED'));
          return;
        }
        this.debugLog(trimmed, a.readyState, usedFallback);
        this.startFadeIn(a, FADE_MS);
      };

      void startPlayback();
    });
  }
}
