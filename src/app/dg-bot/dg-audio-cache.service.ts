import { Injectable } from '@angular/core';
import type { DgScene } from './dg-bot.types';
import { dgDevLog } from './dg-dev-log';

/**
 * In-memory preload: next-scene TTS (blob URLs) and next-scene pre-generated audio (HTTP URLs).
 * Playback still uses fresh Audio() / object URLs; preload warms browser cache and decoders.
 */
@Injectable({ providedIn: 'root' })
export class DgAudioCacheService {
  private readonly ttsCache = new Map<string, HTMLAudioElement>();
  private readonly urlPreload = new Map<string, HTMLAudioElement>();

  private makeTtsKey(voice: string, text: string): string {
    return `${voice}\n${text}`;
  }

  /** Returns a blob: or http(s): src if preloaded, else null. */
  getPreloadedSrc(voice: string, text: string): string | null {
    const el = this.ttsCache.get(this.makeTtsKey(voice, text));
    const src = el?.src;
    return src || null;
  }

  /** Warm cache for a fixed audio URL (pre-generated scene audio). */
  preloadUrlAudio(url: string): void {
    const u = url.trim();
    if (!u || this.urlPreload.has(u)) return;
    const audio = new Audio(u);
    audio.preload = 'auto';
    this.urlPreload.set(u, audio);
    try {
      audio.load();
    } catch {
      dgDevLog('audio url preload failed', u.slice(0, 80));
    }
    dgDevLog('audio url preload', u.slice(0, 80));
  }

  /**
   * Preload audio for scenes at centerIndex, centerIndex+1, centerIndex+2 (URLs or TTS).
   */
  preloadScenesAtIndices(
    scenes: DgScene[],
    centerIndex: number,
    voice: string,
    fetchBlob: (text: string, voice: string) => Promise<Blob>,
  ): void {
    for (let k = 0; k <= 2; k++) {
      const i = centerIndex + k;
      if (i < 0 || i >= scenes.length) continue;
      this.preloadNextScene(scenes[i], voice, fetchBlob);
    }
  }

  /**
   * Fire-and-forget: preload the next scene — pre-generated URL if present, else TTS for plain text.
   */
  preloadNextScene(
    scene: DgScene | null,
    voice: string,
    fetchBlob: (text: string, voice: string) => Promise<Blob>,
  ): void {
    if (!scene) return;
    const url = scene.audioUrl?.trim();
    if (url) {
      this.preloadUrlAudio(url);
      return;
    }
    if (!scene.text?.trim()) return;
    const text = scene.text.trim();
    const key = this.makeTtsKey(voice, text);
    if (this.ttsCache.has(key)) return;

    void (async () => {
      try {
        const blob = await fetchBlob(text, voice);
        const blobUrl = URL.createObjectURL(blob);
        const audio = new Audio(blobUrl);
        audio.preload = 'auto';
        try {
          await audio.load();
        } catch {
          /* load() optional in some browsers */
        }
        this.ttsCache.set(key, audio);
        dgDevLog('tts preload', text.slice(0, 48));
      } catch (e) {
        dgDevLog('tts preload failed', e);
      }
    })();
  }

  clear(): void {
    for (const a of this.ttsCache.values()) {
      try {
        a.pause();
        const u = a.src;
        if (u.startsWith('blob:')) URL.revokeObjectURL(u);
        a.src = '';
      } catch {
        /* ignore */
      }
    }
    this.ttsCache.clear();

    for (const a of this.urlPreload.values()) {
      try {
        a.pause();
        a.src = '';
      } catch {
        /* ignore */
      }
    }
    this.urlPreload.clear();
  }
}
