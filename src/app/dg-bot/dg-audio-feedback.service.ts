import { Injectable } from '@angular/core';

/** Lightweight success cue — no asset files, closes AudioContext after use. */
@Injectable({ providedIn: 'root' })
export class DgAudioFeedbackService {
  playSuccessChime(): void {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const now = ctx.currentTime;
      o.type = 'sine';
      o.frequency.setValueAtTime(523.25, now);
      o.frequency.exponentialRampToValueAtTime(783.99, now + 0.06);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.2);
      o.onended = () => {
        ctx.close().catch(() => {});
      };
    } catch {
      /* ignore */
    }
  }
}
