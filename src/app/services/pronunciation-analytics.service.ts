// src/app/services/pronunciation-analytics.service.ts
//
// Thin analytics/optimization layer that sits next to PronunciationService.
//
//   - Learns each user's typical mic volume from their last N successful
//     attempts and returns *adaptive* silence thresholds.
//   - Applies device-specific tuning (mobile + iOS Safari are quieter).
//   - Tracks consecutive failure counts for smart retry assist.
//   - Reports standalone telemetry events (silent rejects, network errors)
//     so backend insights stay accurate even without an audio upload.
//
// Deliberately keeps its own state — no shared globals — so it can be
// reset in tests and so individual components pull in just what they need.

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { CapabilityInfo } from './pronunciation.service';

export interface AudioSample {
  average: number;
  peak: number;
  durationMs: number;
  timestamp: number;
}

export interface AdaptiveThresholds {
  minAverageLevel: number;
  minPeakLevel: number;
  minDurationMs: number;
  /** Was the threshold derived from the user's profile, or fallback defaults? */
  source: 'default' | 'adaptive';
  /** How many successful samples fed the calculation (0 = defaults). */
  sampleCount: number;
  /** True when device tuning tweaked the values (mobile / iOS Safari). */
  deviceTuned: boolean;
}

export type DeviceType = 'mobile' | 'desktop';

export interface DeviceInfo {
  deviceType: DeviceType;
  browser: string;
  isIOS: boolean;
  isSafari: boolean;
  isFirefox: boolean;
  isChromium: boolean;
}

export interface TelemetryEvent {
  requestId?: string;
  language?: string;
  silenceRejected?: boolean;
  silenceReason?: 'too-short' | 'too-quiet' | null;
  networkError?: boolean;
  assistedMode?: boolean;
  retryCount?: number;
  confidence?: 'low' | 'medium' | 'high';
  audioPeak?: number;
  audioAverage?: number;
  recordingDuration?: number;
  engine?: string;
}

/** Profile storage (last N successful attempts). */
const PROFILE_KEY = 'pronunciation:user-audio-profile:v1';
const MAX_PROFILE_SAMPLES = 5;

/** Default silence thresholds — match PronunciationService.evaluateSilence(). */
const DEFAULT_MIN_AVG = 0.01;
const DEFAULT_MIN_PEAK = 0.04;
const DEFAULT_MIN_DURATION_MS = 800;

@Injectable({ providedIn: 'root' })
export class PronunciationAnalyticsService {
  private readonly apiUrl = `${environment.apiUrl}/pronunciation`;

  /** Per-question consecutive failure counter. Key is caller-provided. */
  private failCounts: Record<string, number> = {};

  constructor(private http: HttpClient) {}

  // ── Device / browser detection ───────────────────────────────────────

  getDeviceInfo(caps: CapabilityInfo | null | undefined): DeviceInfo {
    const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
    const deviceType: DeviceType =
      /Mobi|Android|iPhone|iPad|iPod|Tablet/i.test(ua) ? 'mobile' : 'desktop';
    const browser = this.detectBrowser(ua);
    return {
      deviceType,
      browser,
      isIOS: !!caps?.isIOS,
      isSafari: !!caps?.isSafari,
      isFirefox: !!caps?.isFirefox,
      isChromium: !!caps?.isChromium,
    };
  }

  private detectBrowser(ua: string): string {
    const lc = ua.toLowerCase();
    if (/edg\//.test(lc)) return 'edge';
    if (/opr\/|opera/.test(lc)) return 'opera';
    if (/firefox|fxios/.test(lc)) return 'firefox';
    if (/chrome|crios/.test(lc)) return 'chrome';
    if (/safari/.test(lc)) return 'safari';
    return 'other';
  }

  // ── User audio profile (last 5 successful samples) ───────────────────

  recordSuccessfulAttempt(sample: Omit<AudioSample, 'timestamp'>): void {
    if (!sample || !Number.isFinite(sample.average) || !Number.isFinite(sample.peak)) return;
    if (sample.average <= 0 && sample.peak <= 0) return;
    const next: AudioSample = { ...sample, timestamp: Date.now() };
    const samples = this.loadProfile();
    samples.push(next);
    while (samples.length > MAX_PROFILE_SAMPLES) samples.shift();
    this.saveProfile(samples);
  }

  getProfileSamples(): AudioSample[] {
    return this.loadProfile();
  }

  clearProfile(): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(PROFILE_KEY);
    } catch { /* ignore */ }
  }

  /**
   * Compute silence pre-validation thresholds using the user's recent
   * behaviour + device tuning. Safe to call every recording.
   */
  getAdaptiveThresholds(device: DeviceInfo): AdaptiveThresholds {
    const samples = this.loadProfile();

    let minAverageLevel = DEFAULT_MIN_AVG;
    let minPeakLevel = DEFAULT_MIN_PEAK;
    let minDurationMs = DEFAULT_MIN_DURATION_MS;
    let source: 'default' | 'adaptive' = 'default';

    // Need at least 3 samples to trust the mean.
    if (samples.length >= 3) {
      const avgLevel = mean(samples.map((s) => s.average));
      const avgPeak = mean(samples.map((s) => s.peak));
      if (avgLevel > 0 && avgPeak > 0) {
        minAverageLevel = avgLevel * 0.5;
        minPeakLevel = avgPeak * 0.5;
        source = 'adaptive';
      }
    }

    // Device tuning — sympathetic to softer mics.
    let deviceTuned = false;
    if (device.deviceType === 'mobile') {
      // Mobile mics are noisier and users often hold the phone awkwardly.
      minDurationMs = 650;
      minAverageLevel *= 0.8;
      minPeakLevel *= 0.85;
      deviceTuned = true;
    }
    if (device.isIOS || device.isSafari) {
      // iOS/Safari capture is systematically quieter than Chrome on the
      // same hardware — relax the peak gate a bit more.
      minPeakLevel *= 0.7;
      deviceTuned = true;
    }

    // Guard against pathological zeros (e.g. the user whispers a bunch of
    // times and we end up with tiny thresholds).
    const MIN_FLOOR_AVG = 0.004;
    const MIN_FLOOR_PEAK = 0.015;
    minAverageLevel = Math.max(MIN_FLOOR_AVG, minAverageLevel);
    minPeakLevel = Math.max(MIN_FLOOR_PEAK, minPeakLevel);

    return {
      minAverageLevel,
      minPeakLevel,
      minDurationMs,
      source,
      sampleCount: samples.length,
      deviceTuned,
    };
  }

  private loadProfile(): AudioSample[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((s) => s && typeof s === 'object')
        .map((s: any) => ({
          average: Number(s.average) || 0,
          peak: Number(s.peak) || 0,
          durationMs: Number(s.durationMs) || 0,
          timestamp: Number(s.timestamp) || 0,
        }))
        .filter((s) => s.average > 0 || s.peak > 0);
    } catch {
      return [];
    }
  }

  private saveProfile(samples: AudioSample[]): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(PROFILE_KEY, JSON.stringify(samples));
    } catch { /* localStorage quota / private mode — ignore */ }
  }

  // ── Retry / assisted mode state ──────────────────────────────────────

  getFailCount(key: string): number {
    return this.failCounts[key] || 0;
  }

  recordAttemptOutcome(key: string, passed: boolean): number {
    if (passed) {
      this.failCounts[key] = 0;
      return 0;
    }
    const next = (this.failCounts[key] || 0) + 1;
    this.failCounts[key] = next;
    return next;
  }

  resetFailCount(key: string): void {
    this.failCounts[key] = 0;
  }

  /**
   * Smart retry assist state for the *next* attempt.
   *   showTip    — true once 2 fails in a row; nudge the user to slow down.
   *   autoReplay — same trigger; replay the reference once.
   *   assisted   — true from the 3rd attempt onward; relax threshold by 10%.
   */
  getAssistForNextAttempt(key: string): {
    showTip: boolean;
    autoReplay: boolean;
    assisted: boolean;
    failCount: number;
  } {
    const failCount = this.getFailCount(key);
    return {
      failCount,
      showTip: failCount >= 2,
      autoReplay: failCount === 2,
      assisted: failCount >= 3,
    };
  }

  /** Scoring threshold to use on the next upload given the fail streak. */
  adjustThreshold(baseThreshold: number, assisted: boolean): number {
    const base = Number.isFinite(Number(baseThreshold)) ? Number(baseThreshold) : 70;
    if (!assisted) return Math.round(base);
    // Relax by 10 percentage points, never below 40%.
    return Math.max(40, Math.round(base - 10));
  }

  // ── Telemetry ─────────────────────────────────────────────────────────

  /**
   * Report events that don't produce an /evaluate call (silent rejects,
   * network failures, assisted-mode starts). Fire-and-forget — errors
   * here should never break the student flow.
   */
  sendTelemetry(evt: TelemetryEvent, device?: DeviceInfo): void {
    try {
      const payload = { ...evt, ...(device ? { deviceType: device.deviceType, browser: device.browser } : {}) };
      this.http
        .post(`${this.apiUrl}/telemetry`, payload, { withCredentials: true })
        .subscribe({
          next: () => { /* ok */ },
          error: (err) => { console.debug('[pronunciation] telemetry post failed', err?.status); },
        });
    } catch (err) {
      console.debug('[pronunciation] telemetry send failed', err);
    }
  }
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let sum = 0;
  for (const x of xs) sum += Number(x) || 0;
  return sum / xs.length;
}
