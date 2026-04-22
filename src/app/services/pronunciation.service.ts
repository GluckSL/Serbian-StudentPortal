// src/app/services/pronunciation.service.ts
//
// Production-grade pronunciation recorder + evaluator.
//
//   - Wraps MediaRecorder for reliable audio capture (preferred flow).
//   - Falls back to webkitSpeechRecognition when MediaRecorder is not
//     available (very old Safari, locked-down kiosk browsers, etc).
//   - Handles mic permissions, picks the best supported mime type per
//     browser (important for iOS Safari & Firefox), and guards against
//     the usual MediaRecorder pitfalls (`ondataavailable` timing etc).
//   - Uploads the blob to POST /api/pronunciation/evaluate and returns
//     the server-graded result.
//
// Components should only depend on this service — never on the raw
// MediaRecorder / SpeechRecognition APIs directly.

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { environment } from '../../environments/environment';

// ── Types ───────────────────────────────────────────────────────────────────

export type RecordingState = 'idle' | 'recording' | 'processing' | 'result' | 'error';

export interface PronunciationEvaluateRequest {
  expected: string;
  language?: 'German' | 'English' | 'de-DE' | 'en-US' | string;
  variants?: string[];
  threshold?: number;
  /** Forwarded verbatim to server for logging — never include PII here. */
  clientMeta?: Record<string, unknown>;
}

export type PronunciationConfidence = 'low' | 'medium' | 'high';

export interface PronunciationEvaluateResponse {
  requestId: string;
  engine: 'openai' | 'fallback' | 'client-transcript';
  transcript: string;
  score: number;
  isCorrect: boolean;
  /** Server-computed confidence tier (low / medium / high). */
  confidence?: PronunciationConfidence;
  /** Echoed from clientMeta — true when this attempt used a relaxed threshold. */
  assistedMode?: boolean;
  threshold: number;
  matchedAgainst: string;
  normalizedExpected: string;
  normalizedSpoken: string;
  durationMs?: number;
  transcriptionError?: string | null;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Object URL suitable for instant playback (release with revokeObjectUrl). */
  objectUrl: string;
}

export interface CapabilityInfo {
  mediaRecorder: boolean;
  speechRecognition: boolean;
  getUserMedia: boolean;
  isIOS: boolean;
  isSafari: boolean;
  isChromium: boolean;
  isFirefox: boolean;
  preferredMimeType: string | null;
  /** True when we consider this the "recommended" browser (Chromium desktop). */
  isRecommendedBrowser: boolean;
}

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Live + aggregate audio levels gathered during recording. */
export interface AudioStats {
  /** Most recent RMS level (0..1). */
  lastLevel: number;
  /** Peak RMS observed during the current recording (0..1). */
  peak: number;
  /** Average RMS across all samples (0..1). */
  average: number;
  /** Number of level samples taken. */
  samples: number;
  /** Recording duration so far in ms (live) or total on stop. */
  durationMs: number;
}

/** Defaults for "too quiet / too short" pre-validation. */
export interface SilenceCheckOptions {
  /** Minimum recording duration in ms; shorter recordings fail. */
  minDurationMs?: number;
  /** Below this average RMS the recording counts as silent. */
  minAverageLevel?: number;
  /** Below this peak RMS the recording counts as silent (both must hold). */
  minPeakLevel?: number;
}

export interface SilenceCheckResult {
  /** True when the recording seems intentional (loud enough / long enough). */
  ok: boolean;
  reason?: 'too-short' | 'too-quiet';
  stats: AudioStats;
}

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class PronunciationService {
  private readonly apiUrl = `${environment.apiUrl}/pronunciation`;

  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recordingMimeType: string | null = null;
  private recordingStartMs = 0;
  private activeStopResolver: ((result: RecordingResult) => void) | null = null;
  private activeStopRejecter: ((err: Error) => void) | null = null;

  // ── Audio analyser / level tracking ──────────────────────────────────
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserSource: MediaStreamAudioSourceNode | null = null;
  private levelSampler: ReturnType<typeof setInterval> | null = null;
  private levelPeak = 0;
  private levelSum = 0;
  private levelSamples = 0;
  private lastLevel = 0;
  private analyserBuffer: Uint8Array = new Uint8Array(0);

  constructor(private http: HttpClient) {}

  // ── Capability detection ────────────────────────────────────────────────

  getCapabilities(): CapabilityInfo {
    const nav: any = typeof navigator !== 'undefined' ? navigator : {};
    const ua = String(nav?.userAgent || '');
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(nav?.MSStream);
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    const isFirefox = /firefox|fxios/i.test(ua);
    const isChromium = /chrome|crios|edg|edge|opr\//i.test(ua) && !isFirefox;

    const getUserMedia = !!nav?.mediaDevices?.getUserMedia;
    const mediaRecorder = typeof (window as any).MediaRecorder !== 'undefined';
    const speechRecognition =
      typeof (window as any).webkitSpeechRecognition !== 'undefined' ||
      typeof (window as any).SpeechRecognition !== 'undefined';

    return {
      mediaRecorder,
      speechRecognition,
      getUserMedia,
      isIOS,
      isSafari,
      isFirefox,
      isChromium,
      isRecommendedBrowser: isChromium && !isIOS,
      preferredMimeType: this.pickMimeType(),
    };
  }

  /** Pick the best mime type the current browser can actually encode. */
  private pickMimeType(): string | null {
    const MR: any = (window as any).MediaRecorder;
    if (!MR || typeof MR.isTypeSupported !== 'function') return null;
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4;codecs=mp4a.40.2', // iOS / Safari
      'audio/mp4',
      'audio/aac',
    ];
    for (const c of candidates) {
      try { if (MR.isTypeSupported(c)) return c; } catch { /* ignore */ }
    }
    return null;
  }

  /** Query the Permissions API when available; otherwise returns 'unknown'. */
  async queryMicPermission(): Promise<MicPermissionState> {
    const anyNav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (!anyNav?.permissions?.query) return 'unknown';
    try {
      const status = await anyNav.permissions.query({ name: 'microphone' as PermissionName });
      return (status?.state as MicPermissionState) || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /** Ask for mic access. Returns the live stream so callers can keep it alive. */
  async requestMicStream(): Promise<MediaStream> {
    const nav: any = navigator;
    if (!nav?.mediaDevices?.getUserMedia) {
      throw this.error('MEDIA_DEVICES_UNAVAILABLE', 'This browser does not support microphone recording.');
    }
    try {
      return await nav.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err: any) {
      const name = String(err?.name || '');
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw this.error('PERMISSION_DENIED', 'Microphone access was denied. Please allow microphone access in your browser settings.');
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        throw this.error('NO_MIC', 'No microphone was found on this device.');
      }
      if (name === 'NotReadableError') {
        throw this.error('MIC_BUSY', 'Your microphone is in use by another app. Close it and try again.');
      }
      throw this.error('MIC_UNAVAILABLE', err?.message || 'Could not open the microphone.');
    }
  }

  // ── Recording lifecycle ─────────────────────────────────────────────────

  isRecording(): boolean {
    return !!this.mediaRecorder && this.mediaRecorder.state === 'recording';
  }

  async startRecording(): Promise<void> {
    if (this.isRecording()) return;

    const caps = this.getCapabilities();
    if (!caps.mediaRecorder) {
      throw this.error('MEDIA_RECORDER_UNSUPPORTED', 'Audio recording is not supported in this browser.');
    }

    // Always get a fresh stream — reusing stale ones is a common iOS bug.
    this.mediaStream = await this.requestMicStream();

    const mimeType = caps.preferredMimeType || undefined;
    try {
      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.mediaStream, { mimeType })
        : new MediaRecorder(this.mediaStream);
    } catch (err: any) {
      this.hardStopStream();
      throw this.error('MEDIA_RECORDER_FAILED', err?.message || 'Could not start recording.');
    }

    this.recordingMimeType = this.mediaRecorder.mimeType || mimeType || 'audio/webm';
    this.chunks = [];
    this.recordingStartMs = Date.now();
    this.setupAudioAnalyser(this.mediaStream);

    this.mediaRecorder.addEventListener('dataavailable', (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
    });

    this.mediaRecorder.addEventListener('error', (ev: any) => {
      const msg = ev?.error?.message || 'Recorder error';
      const err = this.error('MEDIA_RECORDER_ERROR', msg);
      if (this.activeStopRejecter) {
        const reject = this.activeStopRejecter;
        this.activeStopResolver = null;
        this.activeStopRejecter = null;
        reject(err);
      }
      this.hardStopStream();
    });

    this.mediaRecorder.addEventListener('stop', () => {
      const mime = this.recordingMimeType || 'audio/webm';
      const blob = new Blob(this.chunks, { type: mime });
      const durationMs = Date.now() - this.recordingStartMs;
      const objectUrl = URL.createObjectURL(blob);
      const result: RecordingResult = { blob, mimeType: mime, durationMs, objectUrl };
      this.hardStopStream();
      if (this.activeStopResolver) {
        const resolve = this.activeStopResolver;
        this.activeStopResolver = null;
        this.activeStopRejecter = null;
        resolve(result);
      }
    });

    // Collect a chunk every second — helps Safari / Firefox flush reliably.
    try {
      this.mediaRecorder.start(1000);
    } catch (err: any) {
      this.hardStopStream();
      throw this.error('MEDIA_RECORDER_START_FAILED', err?.message || 'Recorder failed to start.');
    }
  }

  /**
   * Stop the current recording and resolve with the captured blob.
   * Never rejects on "nothing was captured" — that is handled by the caller
   * when `blob.size === 0`.
   */
  stopRecording(): Promise<RecordingResult> {
    if (!this.mediaRecorder) {
      return Promise.reject(this.error('NOT_RECORDING', 'No active recording to stop.'));
    }
    if (this.mediaRecorder.state === 'inactive') {
      const mime = this.recordingMimeType || 'audio/webm';
      const blob = new Blob(this.chunks, { type: mime });
      const durationMs = Date.now() - this.recordingStartMs;
      this.hardStopStream();
      return Promise.resolve({ blob, mimeType: mime, durationMs, objectUrl: URL.createObjectURL(blob) });
    }

    return new Promise<RecordingResult>((resolve, reject) => {
      this.activeStopResolver = resolve;
      this.activeStopRejecter = reject;
      try {
        this.mediaRecorder!.stop();
      } catch (err: any) {
        this.activeStopResolver = null;
        this.activeStopRejecter = null;
        this.hardStopStream();
        reject(this.error('MEDIA_RECORDER_STOP_FAILED', err?.message || 'Failed to stop recorder.'));
      }
    });
  }

  /** Cancel the current recording and release the mic without emitting a blob. */
  cancelRecording(): void {
    try { this.mediaRecorder?.stop(); } catch { /* ignore */ }
    this.chunks = [];
    this.activeStopResolver = null;
    this.activeStopRejecter = null;
    this.hardStopStream();
  }

  private hardStopStream(): void {
    this.teardownAudioAnalyser();
    try { this.mediaStream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    this.mediaStream = null;
    this.mediaRecorder = null;
  }

  // ── Audio analyser + level tracking ───────────────────────────────────

  /** Build the analyser graph and start the RMS sampler. Safe to call once per recording. */
  private setupAudioAnalyser(stream: MediaStream): void {
    this.teardownAudioAnalyser();
    try {
      const Ctx: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
      this.analyserSource = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      this.analyserSource.connect(this.analyser);

      this.levelPeak = 0;
      this.levelSum = 0;
      this.levelSamples = 0;
      this.lastLevel = 0;
      this.analyserBuffer = new Uint8Array(this.analyser.fftSize);

      // Sample RMS ~10 Hz — cheap and gives us a stable average/peak.
      this.levelSampler = setInterval(() => {
        const analyser = this.analyser;
        const buf = this.analyserBuffer;
        if (!analyser || !buf.length) return;
        analyser.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        this.lastLevel = rms;
        if (rms > this.levelPeak) this.levelPeak = rms;
        this.levelSum += rms;
        this.levelSamples += 1;
      }, 100);
    } catch (err) {
      // Analyser setup is a non-fatal enhancement — log and continue.
      console.warn('[pronunciation] analyser setup failed', err);
      this.teardownAudioAnalyser();
    }
  }

  private teardownAudioAnalyser(): void {
    if (this.levelSampler) { clearInterval(this.levelSampler); this.levelSampler = null; }
    try { this.analyserSource?.disconnect(); } catch { /* ignore */ }
    try { this.analyser?.disconnect(); } catch { /* ignore */ }
    if (this.audioCtx) {
      try { this.audioCtx.close().catch(() => { /* ignore */ }); } catch { /* ignore */ }
    }
    this.audioCtx = null;
    this.analyserSource = null;
    this.analyser = null;
    this.analyserBuffer = new Uint8Array(0);
  }

  /** The live AnalyserNode. Hand this to the audio visualiser. */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** Most-recent RMS level captured by the sampler (0..1). */
  getAudioLevel(): number {
    return this.lastLevel;
  }

  /** True if the most recent sample exceeds `threshold`. Cheap live probe. */
  isUserSpeaking(threshold = 0.03): boolean {
    return this.lastLevel > threshold;
  }

  /** Snapshot of level stats + current duration. */
  getAudioStats(): AudioStats {
    return {
      lastLevel: this.lastLevel,
      peak: this.levelPeak,
      average: this.levelSamples ? this.levelSum / this.levelSamples : 0,
      samples: this.levelSamples,
      durationMs: this.recordingStartMs ? Date.now() - this.recordingStartMs : 0,
    };
  }

  /**
   * Decide whether a just-finished recording is usable.
   * Pure — doesn't touch recorder state — pass explicit duration from the
   * `RecordingResult` you got back from `stopRecording()`.
   */
  evaluateSilence(durationMs: number, opts: SilenceCheckOptions = {}): SilenceCheckResult {
    const stats: AudioStats = {
      lastLevel: this.lastLevel,
      peak: this.levelPeak,
      average: this.levelSamples ? this.levelSum / this.levelSamples : 0,
      samples: this.levelSamples,
      durationMs,
    };
    const minDuration = opts.minDurationMs ?? 800;
    const minAvg = opts.minAverageLevel ?? 0.015;
    const minPeak = opts.minPeakLevel ?? 0.06;

    if (durationMs < minDuration) return { ok: false, reason: 'too-short', stats };
    if (stats.samples < 3) return { ok: false, reason: 'too-short', stats };
    if (stats.average < minAvg && stats.peak < minPeak) {
      return { ok: false, reason: 'too-quiet', stats };
    }
    return { ok: true, stats };
  }

  // ── Mic test (bonus feature) ────────────────────────────────────────────

  /**
   * Record a short clip for instant playback — used by "Test Microphone".
   * Returns a playable object URL and the captured blob.
   */
  async recordQuickSample(ms: number = 2000): Promise<RecordingResult> {
    await this.startRecording();
    await new Promise<void>((r) => setTimeout(r, Math.max(500, Math.min(ms, 10000))));
    return this.stopRecording();
  }

  releaseObjectUrl(url: string | null | undefined): void {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }

  // ── Server evaluation ───────────────────────────────────────────────────

  /** Upload the recorded blob and grade it server-side. */
  evaluateAudio(
    audio: Blob,
    request: PronunciationEvaluateRequest,
  ): Observable<PronunciationEvaluateResponse> {
    return from(this.postAudio(audio, request));
  }

  /**
   * Fallback: when MediaRecorder is unavailable and the client ran
   * SpeechRecognition locally, score the transcript server-side so results
   * stay consistent with the audio path.
   */
  evaluateTranscript(
    transcript: string,
    request: PronunciationEvaluateRequest,
  ): Observable<PronunciationEvaluateResponse> {
    return this.http.post<PronunciationEvaluateResponse>(
      `${this.apiUrl}/text-score`,
      {
        transcript,
        expected: request.expected,
        language: request.language,
        variants: request.variants || [],
        threshold: request.threshold,
      },
      { withCredentials: true },
    );
  }

  private async postAudio(
    audio: Blob,
    request: PronunciationEvaluateRequest,
  ): Promise<PronunciationEvaluateResponse> {
    const form = new FormData();
    const filename = this.inferFilename(audio);
    form.append('audio', audio, filename);
    form.append('expected', request.expected);
    if (request.language) form.append('language', request.language);
    if (request.variants?.length) form.append('variants', JSON.stringify(request.variants));
    if (typeof request.threshold === 'number') form.append('threshold', String(request.threshold));
    if (request.clientMeta) form.append('clientMeta', JSON.stringify(request.clientMeta));

    return await this.http
      .post<PronunciationEvaluateResponse>(`${this.apiUrl}/evaluate`, form, { withCredentials: true })
      .toPromise() as PronunciationEvaluateResponse;
  }

  private inferFilename(blob: Blob): string {
    const type = blob.type || '';
    if (type.includes('webm')) return 'recording.webm';
    if (type.includes('ogg')) return 'recording.ogg';
    if (type.includes('mp4')) return 'recording.m4a';
    if (type.includes('mpeg')) return 'recording.mp3';
    if (type.includes('wav')) return 'recording.wav';
    return 'recording.bin';
  }

  // ── Error helper ────────────────────────────────────────────────────────

  private error(code: string, message: string): Error & { code?: string } {
    const err = new Error(message) as Error & { code?: string };
    err.code = code;
    return err;
  }
}
