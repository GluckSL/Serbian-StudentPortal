// src/app/components/digital-exercise-player/digital-exercise-player.component.ts

import { Component, OnInit, OnDestroy, ViewChild, ElementRef, HostListener, NgZone } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  CdkDragDrop,
  CdkDragStart,
  CdkDragEnd,
  CdkDragMove,
  CdkDragSortEvent,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import {
  DigitalExerciseService, DigitalExercise,
  QuestionResponse, SubmitResult, SubmitQuestionResult
} from '../../services/digital-exercise.service';
import {
  DigitalExercisePlayerDraftService,
  DigitalExerciseDraftItem,
  DigitalExerciseDraftPayload
} from '../../services/digital-exercise-player-draft.service';
import { resolveMediaUrl } from '../../utils/media-url';
import { countFillBlankRuns, splitFillBlankSentence, splitByWords } from '../../utils/fill-blank';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';
import { AuthService } from '../../services/auth.service';
import { take } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { SafeHtmlPipe } from '../../pipes/safe-html.pipe';
import {
  PronunciationService,
  PronunciationEvaluateResponse,
  PronunciationConfidence,
  RecordingResult,
  MicPermissionState,
  CapabilityInfo,
  SilenceCheckResult,
} from '../../services/pronunciation.service';
import {
  PronunciationAnalyticsService,
  DeviceInfo,
  AdaptiveThresholds,
} from '../../services/pronunciation-analytics.service';
import { AudioVisualizerComponent } from '../audio-visualizer/audio-visualizer.component';
import { PronunciationComparisonViewComponent } from '../pronunciation-comparison-view/pronunciation-comparison-view.component';
import { HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../environments/environment';

type PlayerState = 'loading' | 'intro' | 'playing' | 'submitted' | 'review' | 'error';

/** Question row fields used by parent/sub-part display helpers. */
type QuestionRowData = {
  type?: string;
  question?: string;
  options?: string[];
  prompt?: string;
  subQuestions?: unknown[];
  attachmentUrl?: string;
};

interface VpChatMessage {
  id: string;
  role: 'tutor' | 'user';
  text: string;
  kind?: 'info' | 'your-turn' | 'clip-watch' | 'intro';
  isCorrect?: boolean;
  score?: number;
}

interface PlayerQuestion {
  data: any; // raw question data from API
  index: number;
  // Sub-question state
  isSubQuestion?: boolean;
  parentIndex?: number;
  subQuestionIndex?: number;
  // MCQ state
  selectedOption?: number;
  // Matching state
  matchingLeft?: Array<{ value: string; matchedRightIndex: number | null }>;
  matchingRight?: Array<{ value: string; matchedLeftIndex: number | null }>;
  selectedLeftIndex?: number | null;
  // Fill-blank state
  fillAnswers?: string[];
  // Word-bank-fill state
  wordBankAnswers?: Array<{ index: number; value: string }>;
  activeBlankIndex?: number | null;
  /** Singular/plural: one input per row (plural answer). */
  singularPluralInputs?: string[];
  // Pronunciation state
  spokenText?: string;
  pronunciationScore?: number;
  isRecording?: boolean;
  hasRecorded?: boolean;
  /** Rich state for the new audio-based flow: idle | recording | processing | result | error. */
  pronUiState?: 'idle' | 'recording' | 'processing' | 'result' | 'error';
  /** Short human-readable hint shown under the speak buttons (e.g. "Processing…"). */
  pronMessage?: string;
  /** Which engine produced the last transcript (openai | fallback | client-transcript). */
  pronEngine?: string;
  /** Last requestId from the backend evaluator — useful for support / debugging. */
  pronRequestId?: string;
  /** True when the last attempt was in the "almost correct" band. */
  pronAlmostCorrect?: boolean;
  /** Word-level analysis rows for the learner-facing comparison view. */
  pronWordAnalysis?: Array<{ expected: string; spoken: string; status: 'correct' | 'incorrect' | 'missing' }>;
  /** Contextual pronunciation hints from the server. */
  pronHints?: string[];
  /** Expected phrase shown to learner for comparison. */
  pronExpectedText?: string;
  /** Backend feedback arrays (new comparison contract). */
  pronMissingWords?: string[];
  pronExtraWords?: string[];
  pronMatchedWords?: string[];
  /** True when backend flags low recording quality. */
  pronLowAudioQuality?: boolean;
  /** Number of local attempts on this pronunciation prompt. */
  pronAttemptCount?: number;
  /** Toggle state for chunked help panel. */
  pronHelpOpen?: boolean;
  // Question/Answer state
  qaResponse?: string;
  // Listening state
  listeningText?: string;
  // Jumble-word state
  jumbleWordResponse?: string;
  jumbleUsedTokenIndices?: number[];
  // Rearrange state
  rearrangeTokens?: string[];
  rearrangeDragActive?: boolean;
  // Image pin match state
  selectedLabelId?: string | null;
  imagePinLabels?: Array<{ id: string; text: string; color: string }>;
  imagePinConnections?: Array<{ labelId: string; pinId: string }>;
  // Video Pronunciation state
  vpSpokenText?: string;
  vpResult?: 'idle' | 'correct' | 'almostCorrect' | 'incorrect';
  /** True when current clip result is in the almost-correct band. */
  vpAlmostCorrect?: boolean;
  /** Word analysis for the video-pronunciation clip comparison view. */
  vpWordAnalysis?: Array<{ expected: string; spoken: string; status: 'correct' | 'incorrect' | 'missing' }>;
  /** Hints for the video-pronunciation clip. */
  vpHints?: string[];
  /** Expected caption shown for comparison. */
  vpExpectedText?: string;
  vpAutoAdvanceTimer?: any;
  /** Bumped to cancel in-flight praise/retry sequences (e.g. user hits Try again). */
  vpAdvanceSeq?: number;
  /** Current playback time for caption switching (seconds). */
  vpCurrentTimeSec?: number;
  /** Pending timer id for optional secondary caption chat line. */
  vpSecondaryCaptionTimer?: any;
  /** True once the optional secondary caption line is shown in chat for this clip. */
  vpSecondaryCaptionShownInChat?: boolean;
  /** True after the clip fires `ended` — then Replay + Speak are shown */
  vpPlaybackEnded?: boolean;
  /** Number of failed pronunciation attempts (incorrect result or speech error) for this clip. */
  vpFailCount?: number;
  // Result state
  isAnswered?: boolean;
  isCorrect?: boolean | null;
  feedback?: string;
  /** Attachment audio: play starts used this exercise attempt (when teacher set a cap). */
  attachmentAudioPlaysUsed?: number;
  /** Sub-question answers */
  subQuestionAnswers?: Record<number, string | number>;
  /** Sub-question singular-plural inputs */
  subQuestionSpInputs?: Record<number, string[]>;
  /** Sub-question fill-blank answers */
  subQuestionFillBlankAnswers?: Record<number, string[]>;
  /** Per sub-question correctness after grading */
  subQuestionIsCorrect?: Record<number, boolean>;
  /** Sub-question matching (leftIndex -> rightIndex) */
  subQuestionMatching?: Record<number, Record<number, number>>;
  /** Sub-question matching selected left index */
  subQuestionMatchingSelectedLeft?: Record<number, number | null>;
  /** Sub-question word bank answers */
  subQuestionWordBankAnswers?: Record<number, string[]>;
  /** Sub-question jumble-word used letter tile indexes */
  subQuestionJumbleUsedTokenIndices?: Record<number, number[]>;
  /** Sub-question rearrange tokens */
  subQuestionRearrangeTokens?: Record<number, string[]>;
}

type SpecialInputTarget =
  | { type: 'fill-blank'; blankIndex: number }
  | { type: 'word-bank-fill'; blankIndex: number }
  | { type: 'question-answer' }
  | { type: 'listening' }
  | { type: 'singular-plural'; rowIndex: number }
  | { type: 'jumble-word' }
  | { type: 'rearrange' };

@Component({
  selector: 'app-digital-exercise-player',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule, SafeHtmlPipe, AudioVisualizerComponent, PronunciationComparisonViewComponent, DragDropModule],
  templateUrl: './digital-exercise-player.component.html',
  styleUrls: ['./digital-exercise-player.component.css']
})
export class DigitalExercisePlayerComponent implements OnInit, OnDestroy {
  state: PlayerState = 'loading';
  exercise: DigitalExercise | null = null;
  /** Full-size MCQ option image overlay (student zoom to read small text). */
  mcqImageLightboxUrl: string | null = null;
  exerciseId = '';
  attemptId = '';
  private currentUserRole = '';

  playerQuestions: PlayerQuestion[] = [];
  currentIndex = 0;
  submitting = false;
  private currentlyPlayingAudio: HTMLAudioElement | null = null;
  showFinishSummary = false;
  finishingAll = false;
  /** Countdown seconds before auto-advancing after image pin match is complete. */
  imagePinAutoAdvanceSeconds = 0;
  private imagePinAutoAdvanceInterval: ReturnType<typeof setInterval> | null = null;
  private imagePinAutoAdvanceQuestionIndex: number | null = null;
  private imagePinCaptureTarget: HTMLElement | null = null;
  private imagePinCapturePointerId: number | null = null;
  private imagePinDrag: {
    active: boolean;
    questionIndex: number;
    labelId: string;
    color: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    hoverPinId: string | null;
  } = {
    active: false,
    questionIndex: -1,
    labelId: '',
    color: '#4f46e5',
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    hoverPinId: null,
  };
  /** Remap broken /uploads links to R2 public URLs when objects still exist. */
  mediaRefetchInProgress = false;
  /** Cache resolved media URLs to avoid recomputing on every change detection cycle. */
  private mediaUrlCache = new Map<string, string>();
  /** Keep track of already preloaded image URLs so we don't fetch them repeatedly. */
  private preloadedImageUrls = new Set<string>();

  startTime = 0;
  elapsedSeconds = 0;
  /** Wall-clock cap sent to the server (matches backend MAX_ATTEMPT_SECONDS). */
  private static readonly MAX_REPORTED_ELAPSED_SECONDS = 2 * 60 * 60;
  timerInterval: any;
  /** Video-only: avoid firing auto-submit more than once when time runs out */
  private vpTimeUpHandled = false;

  /**
   * Video-only last clip: result screen is shown immediately; final POST may still be in flight.
   * If that POST fails, we roll back to the playing state.
   */
  private vpOptimisticCompletion = false;

  result: SubmitResult | null = null;

  /** True when current question has been submitted (for per-question feedback). */
  get hasCurrentSubmitted(): boolean {
    const pq = this.currentQuestion;
    return pq ? (pq.isCorrect === true || pq.isCorrect === false) : false;
  }

  /** Result view after a practice-partner (video-only) exercise — for tailored copy / styling. */
  get isVideoOnlyResult(): boolean {
    const qs = this.exercise?.questions;
    return !!qs?.length && qs.every((q: { type?: string }) => q.type === 'video-pronunciation');
  }

  get isStaffTester(): boolean {
    return ['ADMIN', 'TEACHER', 'TEACHER_ADMIN', 'SUB_ADMIN'].includes(this.currentUserRole);
  }

  confidenceNudge(conf?: PronunciationConfidence): string {
    if (conf === 'medium') return 'Almost there, try again for a perfect score.';
    if (conf === 'low') return 'We might have misheard you. Try speaking clearly.';
    return '';
  }

  shouldShowNeedHelp(pq: PlayerQuestion): boolean {
    return Number(pq?.pronAttemptCount || pq?.vpFailCount || 0) >= 2;
  }

  shouldShowMarkAsCorrect(pq: PlayerQuestion): boolean {
    const attempts = Number(pq?.pronAttemptCount || pq?.vpFailCount || 0);
    const score = Number(pq?.pronunciationScore || 0);
    return attempts >= 2 && score >= 70 && !this.hasCurrentSubmitted;
  }

  togglePronHelp(pq: PlayerQuestion): void {
    pq.pronHelpOpen = !pq.pronHelpOpen;
  }

  expectedChunks(text: string): string[] {
    const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const chunkSize = tokens.length <= 5 ? 1 : 2;
    const chunks: string[] = [];
    for (let i = 0; i < tokens.length; i += chunkSize) {
      chunks.push(tokens.slice(i, i + chunkSize).join(' '));
    }
    return chunks;
  }

  markCurrentAsCorrect(pq: PlayerQuestion): void {
    if (!pq) return;
    const expected = pq.vpExpectedText || pq.pronExpectedText || pq.data?.word || '';
    if (pq.data?.type === 'video-pronunciation') {
      pq.vpResult = 'correct';
      pq.vpAlmostCorrect = false;
      pq.vpSpokenText = pq.vpSpokenText || expected;
      pq.hasRecorded = true;
      pq.isAnswered = true;
      pq.pronUiState = 'result';
      pq.pronunciationScore = Math.max(85, Number(pq.pronunciationScore || 0));
      this.markAttempted(pq);
      if (this.isVideoOnlyExercise) this.pushVpChat('tutor', 'Marked as correct. You can continue.');
      return;
    }
    pq.pronAlmostCorrect = false;
    pq.spokenText = pq.spokenText || expected;
    pq.hasRecorded = true;
    pq.isAnswered = true;
    pq.pronUiState = 'result';
    pq.pronunciationScore = Math.max(85, Number(pq.pronunciationScore || 0));
    this.markAttempted(pq);
  }

  // Speech recognition
  private recognition: any = null;
  private listeningRecognition: any = null;
  private speechRecognitionCtor: any = null;
  speechSupported = false;

  // ── New audio-based pronunciation flow ────────────────────────────────
  /** True when MediaRecorder-based flow should be used as primary (fallback to SR otherwise). */
  audioRecorderSupported = false;
  /** Capability report (populated in ngOnInit). */
  pronCapabilities: CapabilityInfo | null = null;
  /** Cached permission state (best-effort from the Permissions API). */
  micPermission: MicPermissionState = 'unknown';

  /** Max recording duration before auto-stop (safety net). */
  private static readonly MAX_RECORDING_MS = 15_000;
  /** Show "this may take a moment" hint if processing runs this long. */
  private static readonly PROCESSING_SLOW_HINT_MS = 1_500;
  /** Per-question auto-stop timer for the audio recorder flow. */
  private pronAutoStopTimer: ReturnType<typeof setTimeout> | null = null;
  /** The question we are currently capturing audio for (audio flow only). */
  private activePronQuestion: PlayerQuestion | null = null;
  /** True while the "Processing…" state has been up for >1.5s and we want to reassure the user. */
  pronProcessingSlow = false;
  private pronProcessingSlowTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last silence-check result per pq index (for UI hints after auto-reject). */
  lastSilenceByIndex: Record<number, SilenceCheckResult | null> = {};
  /** Controls the "Chrome works best" banner. */
  showBrowserGuidance = false;
  browserGuidanceDismissed = false;

  /** When true, pronunciation step is skipped — student just watches the video and taps Next.
   *  Derived from the exercise data set by admin; not editable by students. */
  get watchOnlyMode(): boolean {
    return !!(this.exercise as any)?.watchOnlyMode;
  }
  /** Cached device/browser info (set in checkSpeechSupport). */
  deviceInfo: DeviceInfo | null = null;
  /** Last adaptive threshold pack used — surfaced in the debug panel. */
  lastAdaptiveThresholds: AdaptiveThresholds | null = null;
  /** When true we opt this attempt into assisted mode (relaxed threshold). */
  private assistedModeByIndex: Record<number, boolean> = {};
  /** Prevents auto-replay from firing twice for the same failure streak. */
  private autoReplayArmedFor: Record<number, boolean> = {};
  /** Server-reported confidence for the last evaluation (per pq). */
  lastConfidenceByIndex: Record<number, PronunciationConfidence | undefined> = {};
  /** Developer-only debug panel (?debug=pron or localStorage flag). */
  pronDebugPanelEnabled = false;
  /** Snapshot of the most recent /evaluate or silence-reject payload — for the debug panel. */
  lastPronDebugSnapshot: {
    pqIndex: number;
    mode: 'word' | 'clip';
    stats: { peak: number; average: number; durationMs: number; samples: number };
    silenceReason: 'too-short' | 'too-quiet' | 'ok';
    thresholds: AdaptiveThresholds | null;
    transcript: string;
    score: number;
    confidence: PronunciationConfidence | null;
    assistedMode: boolean;
    retryCount: number;
    at: number;
  } | null = null;

  // ── Mic Test (bonus feature) ──────────────────────────────────────────
  micTestOpen = false;
  micTestState: 'idle' | 'recording' | 'ready' | 'error' = 'idle';
  micTestAudioUrl: string | null = null;
  private micTestBlob: Blob | null = null;
  micTestError: string | null = null;
  private micTestCountdownTimer: ReturnType<typeof setInterval> | null = null;
  micTestCountdown = 0;
  private micTestBoostAudioCtx: AudioContext | null = null;
  private micTestBoostSource: AudioBufferSourceNode | null = null;

  /** Current video-pronunciation element (for autoplay / replay). */
  private vpVideoElement: HTMLVideoElement | null = null;

  /** We mute the reference video during recording to avoid the mic hearing the target audio. */
  private vpMutedDuringPronunciation = false;
  private vpVideoMutedBeforePronunciation = false;
  private vpVideoVolumeBeforePronunciation = 1;
  private vpVideoPausedBeforePronunciation = true;
  private vpVideoTimeBeforePronunciation = 0;

  /** Admin-uploaded praise / retry clip (video exercises). */
  private vpFeedbackAudioEl: HTMLAudioElement | null = null;
  /** Hard timeout to stop stuck speech-recognition sessions. */
  private vpRecognitionForceStopTimer: ReturnType<typeof setTimeout> | null = null;
  /** Fallback finalizer used when browser doesn't emit onend promptly after manual stop. */
  private vpManualStopFinalize: (() => void) | null = null;
  /** Optional line from admin (e.g. “Try again”) shown under feedback while clip may play. */
  vpFeedbackCaption: string | null = null;

  /** Practice history chat (video-only exercises). */
  vpChatMessages: VpChatMessage[] = [];
  private vpChatSeq = 0;
  private vpChatClipPrompted = new Set<number>();
  readonly specialCharacters: string[] = ['ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü'];
  private activeSpecialInputTarget: SpecialInputTarget | null = null;

  /** For localStorage draft keying (per user + exercise). */
  private draftUserId = '';
  private draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.flushDraftSave();
    }
  };

  @ViewChild('vpChatScroll') vpChatScroll?: ElementRef<HTMLDivElement>;
  @ViewChild('jumbleInput') jumbleInput?: ElementRef<HTMLInputElement>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    public exerciseService: DigitalExerciseService,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private exerciseDraft: DigitalExercisePlayerDraftService,
    private pronunciation: PronunciationService,
    private pronAnalytics: PronunciationAnalyticsService,
    private zone: NgZone,
    private el: ElementRef,
  ) {}

  ngOnInit(): void {
    this.exerciseId = this.route.snapshot.paramMap.get('id') || '';
    this.checkSpeechSupport();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.loadExercise();
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (this.draftSaveTimer) {
      clearTimeout(this.draftSaveTimer);
      this.draftSaveTimer = null;
    }
    this.flushDraftSave();
    this.stopTimer();
    this.clearRecordingTimers();
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
    }
    this.clearVpRecognitionForceStopTimer();
    this.stopVpFeedbackAudio();
    this.playerQuestions.forEach(pq => {
      if (pq.vpAutoAdvanceTimer) clearTimeout(pq.vpAutoAdvanceTimer);
      if (pq.vpSecondaryCaptionTimer) clearTimeout(pq.vpSecondaryCaptionTimer);
    });
    this.clearPronAutoStopTimer();
    this.clearPronProcessingSlowTimer();
    try { this.pronunciation.cancelRecording(); } catch { /* noop */ }
    this.closeMicTest();
    this.cancelImagePinAutoAdvance();
    this.clearImagePinInteractionState();
  }

  private checkSpeechSupport(): void {
    this.speechRecognitionCtor =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition ||
      null;
    this.speechSupported = !!this.speechRecognitionCtor;

    const caps = this.pronunciation.getCapabilities();
    this.pronCapabilities = caps;
    this.audioRecorderSupported = caps.mediaRecorder && caps.getUserMedia;
    this.deviceInfo = this.pronAnalytics.getDeviceInfo(caps);

    // Show a dismissable "Chrome works best" banner on iOS / Safari / Firefox
    // so students know what to switch to when things feel unreliable.
    this.showBrowserGuidance =
      !caps.isRecommendedBrowser && !this.browserGuidanceDismissed;

    // Developer debug panel: opt in via ?debug=pron or a local flag.
    this.pronDebugPanelEnabled = this.computeDebugPanelEnabled();

    // Best-effort read of the browser's stored mic permission.
    this.pronunciation.queryMicPermission()
      .then((state) => { this.micPermission = state; })
      .catch(() => { this.micPermission = 'unknown'; });

    // iOS legacy note (MediaRecorder works on iOS 14.3+; older iOS will
    // fall through to SpeechRecognition below if present, or show a warning).
    if (!this.audioRecorderSupported && !this.speechSupported && caps.isIOS) {
      console.warn('[pronunciation] Neither MediaRecorder nor SpeechRecognition available on this iOS build.');
    }
  }

  /** Analyser from the active recording — handed to the <app-audio-visualizer>. */
  getPronAnalyser(): AnalyserNode | null {
    return this.pronunciation.getAnalyser();
  }

  /** Current RMS level (0..1). Useful for debug overlays. */
  get audioLevel(): number {
    return this.pronunciation.getAudioLevel();
  }

  /** True when we think the user is NOT speaking right now (live probe). */
  get isSilent(): boolean {
    return !this.pronunciation.isUserSpeaking();
  }

  dismissBrowserGuidance(): void {
    this.browserGuidanceDismissed = true;
    this.showBrowserGuidance = false;
  }

  /**
   * In Watch Only Mode: mark the current clip as watched/completed and advance,
   * without requiring the student to speak.
   */
  skipWatchOnlyClip(): void {
    if (this.submitting || this.finishingAll) return;
    const pq = this.currentQuestion;
    if (!pq) return;

    pq.vpSpokenText = '';
    pq.pronunciationScore = 100;
    pq.vpResult = 'correct';
    pq.isCorrect = true;
    pq.hasRecorded = true;
    pq.isAnswered = true;
    pq.vpAdvanceSeq = (pq.vpAdvanceSeq || 0) + 1;
    this.clearVpFeedbackUi();
    this.markAttempted(pq);

    const isLastClip = this.currentIndex >= this.playerQuestions.length - 1;
    if (isLastClip) {
      this.finishVideoExercise();
    } else {
      this.submitCurrentQuestion();
      setTimeout(() => this.nextQuestion(), 300);
    }
  }

  /** Copy the user can read while a silent recording is being rejected. */
  silentRejectMessage(reason: SilenceCheckResult['reason']): string {
    if (reason === 'too-short') return 'That was very quick — hold the button a little longer and speak clearly.';
    return 'We couldn’t hear you — please speak a bit louder and try again.';
  }

  private clearPronProcessingSlowTimer(): void {
    if (!this.pronProcessingSlowTimer) return;
    clearTimeout(this.pronProcessingSlowTimer);
    this.pronProcessingSlowTimer = null;
    this.pronProcessingSlow = false;
  }

  private armPronProcessingSlowTimer(): void {
    this.clearPronProcessingSlowTimer();
    this.pronProcessingSlowTimer = setTimeout(() => {
      this.pronProcessingSlow = true;
    }, DigitalExercisePlayerComponent.PROCESSING_SLOW_HINT_MS);
  }

  /** Composite key we use to keep per-question retry counts scoped. */
  private pronAttemptKey(pq: PlayerQuestion, mode: 'word' | 'clip'): string {
    return `${this.exerciseId || 'ex'}:${mode}:${pq.index}`;
  }

  /** Label helper for confidence-tier UI messaging (low / medium / high). */
  confidenceHeadline(conf: PronunciationConfidence | undefined | null): string | null {
    if (conf === 'high') return 'Great job!';
    if (conf === 'medium') return 'Almost there — try once more';
    if (conf === 'low') return "Let's try again";
    return null;
  }

  /** Build the enriched clientMeta payload we send with every evaluate/telemetry call. */
  private buildClientMeta(args: {
    mode: 'word' | 'clip';
    recording: RecordingResult;
    stats: { peak: number; average: number };
    silenceRejected: boolean;
    silenceReason: 'too-short' | 'too-quiet' | null;
    retryCount: number;
    assistedMode: boolean;
    thresholds: AdaptiveThresholds | null;
  }): Record<string, unknown> {
    const device = this.deviceInfo || this.pronAnalytics.getDeviceInfo(this.pronCapabilities);
    return {
      micPermission: this.micPermission,
      audioPeak: round4(args.stats.peak),
      audioAverage: round4(args.stats.average),
      recordingDuration: args.recording.durationMs,
      audioSize: args.recording.blob.size,
      mimeType: args.recording.mimeType,
      silenceRejected: args.silenceRejected,
      silenceReason: args.silenceReason,
      retryCount: args.retryCount,
      assistedMode: args.assistedMode,
      deviceType: device.deviceType,
      browser: device.browser,
      mode: args.mode,
      thresholdSource: args.thresholds?.source || 'default',
      thresholdSampleCount: args.thresholds?.sampleCount ?? 0,
    };
  }

  private computeDebugPanelEnabled(): boolean {
    try {
      const qp = this.route.snapshot.queryParamMap.get('debug') || '';
      if (qp.toLowerCase() === 'pron') return true;
      if (typeof localStorage !== 'undefined') {
        const flag = localStorage.getItem('pron:debugPanel');
        if (flag === '1' || flag === 'true') return true;
      }
    } catch { /* ignore */ }
    return !!(environment as any).showPronunciationDebug;
  }

  togglePronDebugPanel(): void {
    this.pronDebugPanelEnabled = !this.pronDebugPanelEnabled;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('pron:debugPanel', this.pronDebugPanelEnabled ? '1' : '0');
      }
    } catch { /* ignore */ }
  }

  /** Was the given HTTP error actually a network/timeout failure (vs 4xx/5xx)? */
  private isNetworkError(err: any): boolean {
    if (!err) return false;
    if (err instanceof HttpErrorResponse) {
      // status 0 → offline, DNS, CORS, or aborted; treat as network issue
      return err.status === 0 || err.status >= 502;
    }
    const msg = String(err?.message || '').toLowerCase();
    return msg.includes('network') || msg.includes('timeout') || msg.includes('failed to fetch');
  }

  private async ensureMicrophoneAccess(): Promise<boolean> {
    const mediaDevices = (navigator as any)?.mediaDevices;
    if (!mediaDevices?.getUserMedia) return true;
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      return true;
    } catch {
      this.snackBar.open('Microphone access denied. Please allow microphone access.', 'Close', { duration: 5000 });
      return false;
    }
  }

  loadExercise(): void {
    this.state = 'loading';
    this.authService.currentUser$.pipe(take(1)).subscribe((user) => {
      this.currentUserRole = String(user?.role || '');
      this.draftUserId = (user?._id && String(user._id)) || '';
      const forceStudentView = this.route.snapshot.queryParamMap.get('asStudent') === 'true';
      const asStudent = user?.role === 'STUDENT' || forceStudentView;
      this.exerciseService.getExercise(this.exerciseId, { asStudent }).subscribe({
        next: (exercise) => {
          this.exercise = exercise;
          this.mediaUrlCache.clear();
          this.preloadedImageUrls.clear();
          const beginPlay = () => {
            this.initPlayerQuestions();
            // Start immediately when user clicks "Start" from the list page.
            this.startExercise();
          };
          // Legacy DB values often keep `/uploads/exercise-attachments/...` while the file lives only in R2.
          // If we init the player before R2 remap finishes, `<audio>` can load a dead URL and stay at 0:00.
          if (!asStudent) {
            beginPlay();
            return;
          }
          const urls = this.collectExerciseMediaUrlsForRecovery();
          if (urls.length === 0) {
            beginPlay();
            return;
          }
          this.mediaRefetchInProgress = true;
          this.exerciseService.resolveMediaFromR2(urls).subscribe({
            next: ({ resolutions }) => {
              this.mediaRefetchInProgress = false;
              this.applyFoundMediaResolutions(resolutions);
              this.mediaUrlCache.clear();
              beginPlay();
            },
            error: () => {
              this.mediaRefetchInProgress = false;
              beginPlay();
            },
          });
        },
        error: (err) => {
          const code = err?.error?.code;
          if (code === 'SEQUENCE_LOCKED') {
            const prev = err?.error?.previousLetter?.toUpperCase() || '';
            this.snackBar.open(
              `Complete exercise ${prev} first before attempting this one.`,
              'OK',
              { duration: 5000 }
            );
            this.router.navigate(['/digital-exercises']);
            return;
          }
          this.state = 'error';
        }
      });
    });
  }

  private initPlayerQuestions(): void {
    if (!this.exercise) return;
    this.vpOptimisticCompletion = false;
    this.playerQuestions = this.exercise.questions.map((q: any, i: number) => {
      const pq: PlayerQuestion = { data: q, index: i, isAnswered: false, attachmentAudioPlaysUsed: 0 };

      if (q.type === 'mcq') {
        pq.selectedOption = undefined;
      } else if (q.type === 'matching') {
        // Student (and ?asStudent) payloads omit `right` on each pair and send `shuffledRight` instead.
        const hasShuffledRight = Array.isArray(q.shuffledRight) && q.shuffledRight.length > 0;
        const pairsRaw = (q.pairs || []).filter((p: any) => {
          const leftOk = String(p?.left ?? '').trim().length > 0;
          const rightOk = String(p?.right ?? '').trim().length > 0;
          if (hasShuffledRight) return leftOk;
          return leftOk && rightOk;
        });
        const leftItems = pairsRaw.map((p: any) => ({
          value: this.normalizePlainDisplayText(p.left),
          matchedRightIndex: null,
        }));
        let rightItems = q.shuffledRight
          ? q.shuffledRight.map((r: string) => ({
              value: this.normalizePlainDisplayText(r),
              matchedLeftIndex: null,
            }))
          : pairsRaw.map((p: any) => ({
              value: this.normalizePlainDisplayText(p.right),
              matchedLeftIndex: null,
            }));
        // Randomize right-column order (API used unstable sort before; avoid row-aligned "answers").
        if (rightItems.length > 1) {
          rightItems = [...rightItems];
          this.shuffleInPlace(rightItems);
        }
        pq.matchingLeft = leftItems;
        pq.matchingRight = rightItems;
        pq.selectedLeftIndex = null;
      } else if (q.type === 'fill-blank') {
        const count = countFillBlankRuns(q.sentence || '');
        pq.fillAnswers = new Array(count).fill('');
      } else if ((q.type as string) === 'word_bank_fill') {
        const rows = Array.isArray(q.items) ? q.items : [];
        pq.wordBankAnswers = rows.map((_x: any, idx: number) => ({ index: idx, value: '' }));
        pq.activeBlankIndex = rows.length ? 0 : null;
      } else if (q.type === 'singular_plural') {
        const n = (q.pairs || []).filter((p: any) => String(p?.singular || '').trim()).length;
        pq.singularPluralInputs = new Array(Math.max(1, n)).fill('');
      } else if (q.type === 'pronunciation') {
        pq.spokenText = '';
        pq.pronunciationScore = 0;
        pq.isRecording = false;
        pq.hasRecorded = false;
      } else if (q.type === 'question-answer') {
        pq.qaResponse = '';
      } else if (q.type === 'listening') {
        pq.listeningText = '';
      } else if ((q.type as string) === 'jumble-word') {
        pq.jumbleWordResponse = '';
      } else if ((q.type as string) === 'rearrange') {
        const tokens: string[] = Array.isArray(q.shuffledTokens)
          ? q.shuffledTokens.map((t: any) => String(t ?? '').trim()).filter((t: string) => t.length > 0)
          : [];
        pq.rearrangeTokens = tokens;
        pq.rearrangeDragActive = false;
      } else if ((q.type as string) === 'image_pin_match') {
        const labelsRaw = Array.isArray(q.labels) ? q.labels : [];
        const palette = ['#4f46e5', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6'];
        pq.imagePinLabels = labelsRaw.map((l: any, idx: number) => ({
          id: String(l?.id || ''),
          text: String(l?.text || ''),
          color: palette[idx % palette.length]
        })).filter((l: { id: string; text: string }) => l.id && l.text);
        if (q?.settings?.randomizeLabels !== false && (pq.imagePinLabels?.length || 0) > 1) {
          this.shuffleInPlace(pq.imagePinLabels!);
        }
        pq.imagePinConnections = [];
        pq.selectedLabelId = null;
      } else if (q.type === 'video-pronunciation') {
        pq.vpSpokenText = '';
        pq.vpResult = 'idle';
        pq.isRecording = false;
        pq.hasRecorded = false;
        pq.vpPlaybackEnded = false;
        pq.vpAdvanceSeq = 0;
        pq.vpFailCount = 0;
        pq.vpCurrentTimeSec = 0;
        pq.vpSecondaryCaptionShownInChat = false;
      }
      return pq;
    });
    this.resetVpChat();
  }

  onRearrangeDrop(pq: PlayerQuestion, event: CdkDragDrop<string[] | undefined>): void {
    if (this.state === 'submitted' || !pq) return;
    if (!event?.isPointerOverContainer) return;
    if (!Array.isArray(pq.rearrangeTokens)) return;
    const arr = pq.rearrangeTokens;
    const prev = event.previousIndex;
    let curr = event.currentIndex;
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) return;
    curr = Math.max(0, Math.min(arr.length - 1, curr));
    if (prev === curr) return;
    moveItemInArray(arr, prev, curr);
    this.markAttempted(pq);
  }

  onRearrangeDragStarted(pq: PlayerQuestion, _ev: CdkDragStart): void {
    if (this.state === 'submitted' || !pq) return;
    pq.rearrangeDragActive = true;
  }

  onRearrangeDragEnded(pq: PlayerQuestion, _ev: CdkDragEnd): void {
    if (!pq) return;
    pq.rearrangeDragActive = false;
  }

  trackByIndex(i: number): number {
    return i;
  }

  getRearrangePreviewText(pq: PlayerQuestion): string {
    const toks = Array.isArray(pq?.rearrangeTokens) ? pq.rearrangeTokens : [];
    return toks.map((t) => String(t ?? '').trim()).filter(Boolean).join(' ');
  }

  /** True when every question is a video-pronunciation clip (split chat UI). */
  get isVideoOnlyExercise(): boolean {
    return (
      this.playerQuestions.length > 0 &&
      this.playerQuestions.every((pq) => pq.data?.type === 'video-pronunciation')
    );
  }

  /** Video-only session cap from estimated duration (minutes → seconds). */
  get vpSessionBudgetSeconds(): number {
    const m = Number(this.exercise?.estimatedDuration);
    const mins = Number.isFinite(m) && m > 0 ? m : 15;
    return Math.floor(mins * 60);
  }

  /** Generic session cap for non-video exercises (minutes → seconds). */
  get sessionBudgetSeconds(): number {
    const m = Number(this.exercise?.estimatedDuration);
    const mins = Number.isFinite(m) && m > 0 ? m : 30;
    return Math.floor(mins * 60);
  }

  /** Remaining countdown for the top-right header (stops at 0). */
  get sessionRemainingSeconds(): number {
    return Math.max(0, this.sessionBudgetSeconds - this.elapsedSeconds);
  }

  /** Countdown for sidebar timer (stops at 0). */
  get vpCountdownRemainingSeconds(): number {
    return Math.max(0, this.vpSessionBudgetSeconds - this.elapsedSeconds);
  }

  /** Centered Submit on last clip after this clip is graded correct (final hand-in). */
  get showVpFinalSubmit(): boolean {
    if (!this.isVideoOnlyExercise || !this.isLastQuestion || this.state !== 'playing') return false;
    const pq = this.currentQuestion;
    return pq?.isCorrect === true;
  }

  /** Overall score ring 0–100 (clips answered correctly / total clips). */
  get vpRingPercent(): number {
    const n = this.playerQuestions.length;
    if (!n) return 0;
    return Math.round((100 * this.correctCount) / n);
  }

  readonly vpRingR = 15.9155;
  get vpRingCircumference(): number {
    return 2 * Math.PI * this.vpRingR;
  }

  get vpRingOffset(): number {
    return this.vpRingCircumference * (1 - this.vpRingPercent / 100);
  }

  vpClipCellClass(i: number): string {
    const pq = this.playerQuestions[i];
    const parts: string[] = ['vp-clip-cell'];
    if (i === this.currentIndex) parts.push('vp-clip-cell--current');
    const watchOnlyCompleted = this.watchOnlyMode && pq.isAnswered;
    if (pq.isCorrect === true || watchOnlyCompleted) {
      parts.push('vp-clip-cell--passed');
    } else if (pq.isCorrect === false) {
      parts.push('vp-clip-cell--failed');
    } else if (pq.vpResult === 'correct') {
      parts.push('vp-clip-cell--passed');
    } else if (pq.vpResult === 'incorrect') {
      parts.push('vp-clip-cell--failed');
    }
    return parts.join(' ');
  }

  private resetVpChat(): void {
    this.vpChatMessages = [];
    this.vpChatSeq = 0;
    this.vpChatClipPrompted.clear();
    this.playerQuestions.forEach((pq) => {
      if (pq.vpSecondaryCaptionTimer) {
        clearTimeout(pq.vpSecondaryCaptionTimer);
        pq.vpSecondaryCaptionTimer = undefined;
      }
      pq.vpSecondaryCaptionShownInChat = false;
    });
  }

  /** Fisher–Yates shuffle (in-place). */
  private shuffleInPlace<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  private normalizePlainDisplayText(raw: any): string {
    const decoded = String(raw ?? '')
      .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
    return decoded.replace(/<\/?[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  pushVpChat(
    role: 'tutor' | 'user',
    text: string,
    extra?: { isCorrect?: boolean; score?: number; kind?: VpChatMessage['kind'] }
  ): void {
    this.vpChatMessages.push({
      id: `c${++this.vpChatSeq}`,
      role,
      text,
      kind: extra?.kind,
      isCorrect: extra?.isCorrect,
      score: extra?.score
    });
    setTimeout(() => this.scrollVpChatToBottom(), 0);
  }

  private scrollVpChatToBottom(): void {
    if (this.imagePinDrag?.active) return;
    const el = this.vpChatScroll?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  /** Tutor line for current clip (once per index). */
  syncVpChatForCurrentQuestion(): void {
    if (!this.isVideoOnlyExercise || this.state !== 'playing') return;
    const pq = this.currentQuestion;
    if (!pq || pq.data?.type !== 'video-pronunciation') return;
    if (!this.vpChatClipPrompted.has(this.currentIndex)) {
      this.vpChatClipPrompted.add(this.currentIndex);
      const n = this.currentIndex + 1;
      const total = this.playerQuestions.length;
      this.pushVpChat(
        'tutor',
        `Clip ${n} of ${total} — watch the video.`,
        { kind: 'clip-watch' }
      );
      this.pushVpChat('tutor', `The video clip says: "${this.primaryCaptionForQuestion(pq.data)}"`, { kind: 'info' });
      this.maybeScheduleSecondaryCaptionPrompt(pq, this.currentIndex);
    }
  }

  private maybeScheduleSecondaryCaptionPrompt(pq: PlayerQuestion, clipIndex: number): void {
    const secondary = this.secondaryCaptionForQuestion(pq.data);
    if (!secondary || pq.vpSecondaryCaptionShownInChat || pq.vpSecondaryCaptionTimer) return;
    const delayMs = this.secondaryCaptionDelaySecondsForQuestion(pq.data) * 1000;
    pq.vpSecondaryCaptionTimer = setTimeout(() => {
      pq.vpSecondaryCaptionTimer = undefined;
      if (this.state !== 'playing' || this.currentIndex !== clipIndex) return;
      pq.vpSecondaryCaptionShownInChat = true;
      this.pushVpChat('tutor', `Now it says: "${secondary}"`, { kind: 'info' });
    }, delayMs);
  }

  private clearVpSecondaryCaptionTimers(exceptIndex: number = -1): void {
    this.playerQuestions.forEach((pq, i) => {
      if (i === exceptIndex) return;
      if (pq.vpSecondaryCaptionTimer) {
        clearTimeout(pq.vpSecondaryCaptionTimer);
        pq.vpSecondaryCaptionTimer = undefined;
      }
    });
  }

  private primaryCaptionForQuestion(data: any): string {
    const primary = String(data?.caption || '').trim();
    return primary || 'Speak now';
  }

  private secondaryCaptionForQuestion(data: any): string {
    return String(data?.secondaryCaption || '').trim();
  }

  private secondaryCaptionDelaySecondsForQuestion(data: any): number {
    const raw = Number(data?.secondaryCaptionAtSeconds);
    if (!Number.isFinite(raw)) return DigitalExercisePlayerComponent.VP_SECONDARY_CAPTION_DEFAULT_DELAY_SECONDS;
    return Math.max(0, Math.min(600, Math.round(raw)));
  }

  private pushTutorTurnPromptForSpeak(caption: string): void {
    if (this.watchOnlyMode) return;
    const line = String(caption || '').trim();
    if (!line) return;
    this.pushVpChat('tutor', `Now your turn says: "${line}"`, { kind: 'your-turn' });
  }

  getTutorCaptionParts(text: string): { before: string; value: string; after: string } | null {
    const t = String(text || '');
    const knownPrefixes = ['The video clip says:', 'Now it says:', 'Now your turn says:'];
    const isTarget = knownPrefixes.some((p) => t.startsWith(p));
    if (!isTarget) return null;

    const firstQuote = t.indexOf('"');
    const lastQuote = t.lastIndexOf('"');
    if (firstQuote < 0 || lastQuote <= firstQuote) return null;

    return {
      before: t.slice(0, firstQuote + 1),
      value: t.slice(firstQuote + 1, lastQuote),
      after: t.slice(lastQuote)
    };
  }

  private speakTargetCaptionForQuestion(pq: PlayerQuestion | null | undefined): string {
    if (!pq || pq.data?.type !== 'video-pronunciation') return '';
    return this.secondaryCaptionForQuestion(pq.data) || this.primaryCaptionForQuestion(pq.data);
  }

  getMatchingIndices(pq: any): number[] {
    const len = Math.max(pq.matchingLeft?.length || 0, pq.matchingRight?.length || 0);
    return Array.from({ length: len }, (_, i) => i);
  }

  getVpPromptCaption(pq: PlayerQuestion | null | undefined): string {
    if (!pq || pq.data?.type !== 'video-pronunciation') return '';
    const primary = this.primaryCaptionForQuestion(pq.data);
    const secondary = this.secondaryCaptionForQuestion(pq.data);
    if (!secondary) return primary;
    const threshold = this.secondaryCaptionDelaySecondsForQuestion(pq.data);
    const t = Number(pq.vpCurrentTimeSec || 0);
    return t >= threshold ? secondary : primary;
  }

  private afterVideoOnlyNavigation(): void {
    if (this.isVideoOnlyExercise && this.state === 'playing') {
      this.clearVpFeedbackUi();
      this.clearVpSecondaryCaptionTimers(this.currentIndex);
      this.syncVpChatForCurrentQuestion();
      setTimeout(() => this.scrollVpChatToBottom(), 80);
    }
  }

  private clearVpFeedbackUi(): void {
    this.vpFeedbackCaption = null;
    this.stopVpFeedbackAudio();
  }

  private stopVpFeedbackAudio(): void {
    if (!this.vpFeedbackAudioEl) return;
    try {
      this.vpFeedbackAudioEl.pause();
      this.vpFeedbackAudioEl.src = '';
      this.vpFeedbackAudioEl.load();
    } catch {
      /* ignore */
    }
    this.vpFeedbackAudioEl = null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Support audioUrl (preferred) or accidental `url` from older payloads. */
  private feedbackItemUrl(x: { audioUrl?: string; url?: string } | null | undefined): string | null {
    const u = (x?.audioUrl || (x as any)?.url || '').trim();
    return u || null;
  }

  /**
   * Play one random admin praise/retry clip; resolves when playback ends, errors, or cannot start.
   * (Video-only exercises — uses Promise so we can chain delay + advance reliably.)
   */
  private playVideoExerciseFeedbackAudioPromise(wasCorrect: boolean): Promise<void> {
    if (!this.isVideoOnlyExercise || !this.exercise) return Promise.resolve();
    const raw = wasCorrect
      ? (this.exercise.videoSuccessFeedback || [])
      : (this.exercise.videoRetryFeedback || []);
    const list = raw.filter((x) => this.feedbackItemUrl(x));
    if (list.length === 0) {
      this.vpFeedbackCaption = null;
      return Promise.resolve();
    }
    const pick = list[Math.floor(Math.random() * list.length)];
    this.vpFeedbackCaption = pick.caption?.trim() || null;
    const url = this.getMediaFullUrl(this.feedbackItemUrl(pick)!);
    this.stopVpFeedbackAudio();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(safetyTimer);
        resolve();
      };
      let a: HTMLAudioElement;
      try {
        a = new Audio(url);
        this.vpFeedbackAudioEl = a;
      } catch {
        this.snackBar.open('Feedback audio could not be loaded.', 'Close', { duration: 3500 });
        finish();
        return;
      }
      const safetyTimer = window.setTimeout(finish, 30000);
      a.addEventListener(
        'error',
        () => {
          if (this.vpFeedbackAudioEl === a) {
            this.snackBar.open('Feedback audio could not be loaded.', 'Close', { duration: 3500 });
          }
          finish();
        },
        { once: true }
      );
      a.addEventListener('ended', finish, { once: true });
      void a
        .play()
        .then(() => {})
        .catch(() => finish());
    });
  }

  /** After correct: praise audio → 1s pause → submit → next clip (video autoplays in onVpVideoReady). */
  private async runVpCorrectAdvanceSequence(pq: PlayerQuestion): Promise<void> {
    if (!this.isVideoOnlyExercise) {
      pq.vpAutoAdvanceTimer = undefined;
      this.clearVpFeedbackUi();
      this.submitCurrentQuestion();
      if (this.currentIndex < this.playerQuestions.length - 1) {
        setTimeout(() => this.nextQuestion(), 300);
      }
      return;
    }
    const seq = (pq.vpAdvanceSeq = (pq.vpAdvanceSeq || 0) + 1);
    const isLastClip = this.currentIndex >= this.playerQuestions.length - 1;

    // Last clip: show results immediately (no waiting on praise audio + delay).
    if (isLastClip) {
      void this.playVideoExerciseFeedbackAudioPromise(true);
      if (pq.vpAdvanceSeq !== seq) return;
      pq.vpAutoAdvanceTimer = undefined;
      this.clearVpFeedbackUi();
      this.vpOptimisticCompletion = true;
      pq.isCorrect = true;
      this.result = this.buildProvisionalVideoOnlyResult();
      this.stopTimer();
      this.state = 'submitted';
      this.submitCurrentQuestion();
      return;
    }

    await this.playVideoExerciseFeedbackAudioPromise(true);
    if (pq.vpAdvanceSeq !== seq) return;
    await this.delay(1000);
    if (pq.vpAdvanceSeq !== seq) return;
    pq.vpAutoAdvanceTimer = undefined;
    this.clearVpFeedbackUi();
    this.submitCurrentQuestion();
    if (this.currentIndex < this.playerQuestions.length - 1) {
      setTimeout(() => this.nextQuestion(), 300);
    }
  }

  /** Local totals for instant result screen (last clip just passed; server will confirm). */
  private buildProvisionalVideoOnlyResult(): SubmitResult {
    const totalPoints = this.playerQuestions.reduce((s, p) => s + (p.data.points || 1), 0);
    let earnedPoints = 0;
    this.playerQuestions.forEach((p, i) => {
      const pts = p.data.points || 1;
      const passed = i === this.currentIndex ? true : p.isCorrect === true;
      if (passed) earnedPoints += pts;
    });
    const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    return {
      scorePercentage,
      earnedPoints,
      totalPoints,
      passed: scorePercentage >= 60,
      answerDetails: this.playerQuestions.map((p, i) => {
        const pts = p.data.points || 1;
        const ok = i === this.currentIndex ? true : p.isCorrect === true;
        return {
          questionIndex: i,
          type: p.data.type,
          isCorrect: ok,
          pointsEarned: ok ? pts : 0,
          correctAnswer: null
        };
      })
    };
  }

  private resumeVpTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.startTime = Date.now() - this.elapsedSeconds * 1000;
    this.timerInterval = setInterval(() => {
      this.syncElapsedSeconds();
      this.maybeAutoSubmitVideoOnlyOnDeadline();
    }, 1000);
  }

  /** After incorrect: play retry feedback only; student chooses retry or next clip. */
  private async runVpIncorrectFeedbackSequence(pq: PlayerQuestion): Promise<void> {
    if (!this.isVideoOnlyExercise) return;
    const seq = (pq.vpAdvanceSeq = (pq.vpAdvanceSeq || 0) + 1);

    await this.playVideoExerciseFeedbackAudioPromise(false);
    if (pq.vpAdvanceSeq !== seq) return;
  }

  /** Submit the video exercise immediately (used when student is stuck on the last clip). */
  finishVideoExercise(): void {
    if (this.finishingAll || this.submitting) return;
    this.finishingAll = true;
    this.stopTimer();
    this.syncElapsedSeconds();
    const responses = this.buildAllResponses();
    this.exerciseService.submitAttempt(this.exerciseId, this.attemptId, responses, this.elapsedSeconds).subscribe({
      next: (result) => {
        this.result = result;
        this.finishingAll = false;
        this.applyResultFeedback(result);
        this.state = 'submitted';
        this.clearExerciseDraftStorage();
      },
      error: (e) => {
        this.finishingAll = false;
        this.snackBar.open(e?.error?.error || 'Failed to submit.', 'Close', { duration: 5000 });
      }
    });
  }

  startExercise(): void {
    this.exerciseService.startAttempt(this.exerciseId).subscribe({
      next: (res) => {
        this.attemptId = res.attemptId;
        this.currentIndex = 0;
        this.startTime = Date.now();
        this.vpTimeUpHandled = false;
        this.startTimer();
        this.state = 'playing';
        this.preloadImagesAroundCurrentQuestion();
        if (this.isVideoOnlyExercise) {
          this.resetVpChat();
          const title = this.exercise?.title || 'this lesson';
          const intro = this.watchOnlyMode
            ? `Let's go through "${title}" together. Watch each clip, then tap Next when you're ready.`
            : `Hey! Let's practice "${title}" together. Watch each clip, then repeat the phrase when it's your turn.`;
          this.pushVpChat('tutor', intro, { kind: 'intro' });
          this.syncVpChatForCurrentQuestion();
          setTimeout(() => this.scrollVpChatToBottom(), 120);
        }
        void this.maybeRestoreDraftAfterStart();
      },
      error: (err) => {
        const code = err?.error?.code;
        if (code === 'SEQUENCE_LOCKED') {
          const prev = err?.error?.previousLetter?.toUpperCase() || '';
          this.snackBar.open(
            `Complete exercise ${prev} first before attempting this one.`,
            'OK',
            { duration: 5000 }
          );
          this.router.navigate(['/digital-exercises']);
          return;
        }
        this.snackBar.open(err.error?.error || 'Failed to start exercise', 'Close', { duration: 4000 });
        this.state = 'error';
      }
    });
  }

  private clearExerciseDraftStorage(): void {
    if (!this.draftUserId) return;
    this.exerciseDraft.clear(this.draftUserId, this.exerciseId);
  }

  private scheduleDraftSave(): void {
    if (this.draftSaveTimer) clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = setTimeout(() => {
      this.draftSaveTimer = null;
      this.writeDraftToStorage();
    }, 450);
  }

  private flushDraftSave(): void {
    if (this.draftSaveTimer) {
      clearTimeout(this.draftSaveTimer);
      this.draftSaveTimer = null;
    }
    this.writeDraftToStorage();
  }

  private buildDraftItems(): DigitalExerciseDraftItem[] {
    return this.playerQuestions.map((pq) => {
      const typ = pq.data?.type || '';
      const serverGraded = pq.isCorrect === true || pq.isCorrect === false;
      const base: DigitalExerciseDraftItem = { typ, serverGraded, isAnswered: pq.isAnswered };
      if (typ === 'mcq') return { ...base, selectedOption: pq.selectedOption };
      if (typ === 'matching') {
        const matchingSelections = (pq.matchingLeft || [])
          .map((l, li) => ({
            leftIndex: li,
            rightValue:
              l.matchedRightIndex != null && pq.matchingRight && l.matchedRightIndex < pq.matchingRight.length
                ? pq.matchingRight[l.matchedRightIndex].value
                : ''
          }))
          .filter((x) => x.rightValue !== '');
        return { ...base, matchingSelections };
      }
      if (typ === 'fill-blank') {
        const item: DigitalExerciseDraftItem = { ...base, fillAnswers: [...(pq.fillAnswers || [])] };
        if (pq.data.subQuestions?.length && pq.subQuestionFillBlankAnswers) {
          item.subQuestionFillBlankAnswers = { ...pq.subQuestionFillBlankAnswers };
        }
        return item;
      }
      if (typ === 'word_bank_fill') return { ...base, wordBankAnswers: [...(pq.wordBankAnswers || [])], activeBlankIndex: pq.activeBlankIndex };
      if (typ === 'singular_plural') return { ...base, singularPluralInputs: [...(pq.singularPluralInputs || [])] };
      if (typ === 'pronunciation') {
        return {
          ...base,
          spokenText: pq.spokenText,
          pronunciationScore: pq.pronunciationScore,
          hasRecorded: pq.hasRecorded
        };
      }
      if (typ === 'question-answer') return { ...base, qaResponse: pq.qaResponse };
      if (typ === 'listening') return { ...base, listeningText: pq.listeningText };
      if (typ === 'jumble-word') return { ...base, jumbleWordResponse: pq.jumbleWordResponse };
      if (typ === 'video-pronunciation') {
        return {
          ...base,
          vpSpokenText: pq.vpSpokenText,
          vpResult: pq.vpResult,
          vpPlaybackEnded: pq.vpPlaybackEnded,
          vpFailCount: pq.vpFailCount,
          spokenText: pq.spokenText,
          pronunciationScore: pq.pronunciationScore,
          hasRecorded: pq.hasRecorded
        };
      }
      return base;
    });
  }

  private writeDraftToStorage(): void {
    if (this.state !== 'playing' || !this.attemptId || !this.draftUserId || !this.exerciseId) return;
    if (!this.playerQuestions.length) return;
    this.syncElapsedSeconds();
    const elapsedSeconds = this.elapsedSeconds;
    const payload: DigitalExerciseDraftPayload = {
      v: 1,
      savedAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000,
      userId: this.draftUserId,
      exerciseId: this.exerciseId,
      questionCount: this.playerQuestions.length,
      currentIndex: this.currentIndex,
      elapsedSeconds,
      items: this.buildDraftItems()
    };
    this.exerciseDraft.write(payload);
  }

  private applyDraftItemToQuestion(pq: PlayerQuestion, item: DigitalExerciseDraftItem): void {
    if (!item || item.typ !== pq.data?.type) return;
    if (pq.data.type === 'mcq' && item.selectedOption !== undefined) {
      pq.selectedOption = item.selectedOption ?? undefined;
    } else if (pq.data.type === 'matching' && item.matchingSelections?.length) {
      this.resetMatching(pq);
      for (const row of item.matchingSelections) {
        const li = row.leftIndex;
        const rv = row.rightValue;
        if (li < 0 || !pq.matchingLeft?.[li] || !pq.matchingRight) continue;
        const pick = pq.matchingRight.findIndex((r) => r.value === rv && r.matchedLeftIndex === null);
        if (pick < 0) continue;
        pq.matchingLeft[li].matchedRightIndex = pick;
        pq.matchingRight[pick].matchedLeftIndex = li;
      }
    } else if (pq.data.type === 'fill-blank' && item.fillAnswers?.length) {
      const n = pq.fillAnswers?.length || 0;
      for (let i = 0; i < n; i++) {
        if (item.fillAnswers[i] !== undefined) pq.fillAnswers![i] = item.fillAnswers[i];
      }
      if (item.subQuestionFillBlankAnswers) {
        pq.subQuestionFillBlankAnswers = { ...item.subQuestionFillBlankAnswers };
      }
    } else if ((pq.data.type as string) === 'word_bank_fill' && item.wordBankAnswers?.length) {
      const rows = Array.isArray(pq.wordBankAnswers) ? pq.wordBankAnswers : [];
      const byIndex: Record<number, string> = {};
      item.wordBankAnswers.forEach((entry) => {
        const key = Number(entry?.index);
        if (!Number.isInteger(key)) return;
        byIndex[key] = String(entry?.value ?? '');
      });
      for (let i = 0; i < rows.length; i++) {
        if (Object.prototype.hasOwnProperty.call(byIndex, i)) {
          rows[i] = { index: i, value: byIndex[i] };
        }
      }
      if (typeof item.activeBlankIndex === 'number') {
        pq.activeBlankIndex = item.activeBlankIndex;
      }
    } else if (pq.data.type === 'singular_plural' && item.singularPluralInputs?.length) {
      const n = pq.singularPluralInputs?.length || 0;
      for (let i = 0; i < n; i++) {
        if (item.singularPluralInputs[i] !== undefined) pq.singularPluralInputs![i] = item.singularPluralInputs[i];
      }
    } else if (pq.data.type === 'pronunciation') {
      if (item.spokenText !== undefined) pq.spokenText = item.spokenText;
      if (item.pronunciationScore !== undefined) pq.pronunciationScore = item.pronunciationScore;
      if (item.hasRecorded !== undefined) pq.hasRecorded = item.hasRecorded;
    } else if (pq.data.type === 'question-answer' && item.qaResponse !== undefined) {
      pq.qaResponse = item.qaResponse;
    } else if (pq.data.type === 'listening' && item.listeningText !== undefined) {
      pq.listeningText = item.listeningText;
    } else if ((pq.data.type as string) === 'jumble-word' && item.jumbleWordResponse !== undefined) {
      pq.jumbleWordResponse = item.jumbleWordResponse;
    } else if (pq.data.type === 'video-pronunciation') {
      if (item.vpSpokenText !== undefined) pq.vpSpokenText = item.vpSpokenText;
      if (item.vpResult !== undefined) pq.vpResult = item.vpResult;
      if (item.vpPlaybackEnded !== undefined) pq.vpPlaybackEnded = item.vpPlaybackEnded;
      if (item.vpFailCount !== undefined) pq.vpFailCount = item.vpFailCount;
      if (item.spokenText !== undefined) pq.spokenText = item.spokenText;
      if (item.pronunciationScore !== undefined) pq.pronunciationScore = item.pronunciationScore;
      if (item.hasRecorded !== undefined) pq.hasRecorded = item.hasRecorded;
    }
    if (item.isAnswered) pq.isAnswered = true;
  }

  private applyDraftPayloadToQuestions(draft: DigitalExerciseDraftPayload): void {
    draft.items.forEach((item, i) => {
      const pq = this.playerQuestions[i];
      if (pq) this.applyDraftItemToQuestion(pq, item);
    });
  }

  private buildQuestionResponseForIndex(i: number): QuestionResponse | null {
    const pq = this.playerQuestions[i];
    if (!pq || !this.isQuestionAnswered(pq)) return null;
    const resp: QuestionResponse = { questionIndex: i };
    if (pq.data.type === 'mcq') {
      resp.selectedOptionIndex = pq.selectedOption;
    } else if (pq.data.type === 'matching') {
      resp.matchingResponse = (pq.matchingLeft || []).map((l, li) => {
        const rightIndex = l.matchedRightIndex ?? -1;
        const rightValue =
          rightIndex >= 0 && pq.matchingRight && rightIndex < pq.matchingRight.length
            ? pq.matchingRight[rightIndex].value
            : null;
        return { leftIndex: li, rightIndex, rightValue };
      });
    } else if (pq.data.type === 'fill-blank') {
      resp.fillBlankResponses = pq.fillAnswers || [];
    } else if ((pq.data.type as string) === 'word_bank_fill') {
      resp.wordBankAnswers = (pq.wordBankAnswers || []).map((x) => ({
        index: Number(x?.index) || 0,
        value: String(x?.value ?? '')
      }));
    } else if (pq.data.type === 'singular_plural') {
      const n = (pq.data.pairs || []).filter((p: any) => String(p?.singular || '').trim()).length;
      const raw = pq.singularPluralInputs || [];
      resp.singularPluralResponses = Array.from({ length: n }, (_, i) => String(raw[i] ?? ''));
    } else if (pq.data.type === 'pronunciation') {
      resp.spokenText = pq.spokenText || '';
      resp.pronunciationScore = pq.pronunciationScore || 0;
    } else if (pq.data.type === 'question-answer') {
      resp.qaResponse = pq.qaResponse || '';
    } else if (pq.data.type === 'listening') {
      resp.listeningText = pq.listeningText || '';
    } else if ((pq.data.type as string) === 'jumble-word') {
      resp.jumbleWordResponse = pq.jumbleWordResponse || '';
    } else if ((pq.data.type as string) === 'rearrange') {
      resp.rearrangeTokensResponse = Array.isArray(pq.rearrangeTokens) ? pq.rearrangeTokens : [];
    } else if ((pq.data.type as string) === 'image_pin_match') {
      resp.imagePinAnswers = Array.isArray(pq.imagePinConnections)
        ? pq.imagePinConnections.map((x) => ({ labelId: x.labelId, pinId: x.pinId }))
        : [];
    } else if (pq.data.type === 'video-pronunciation') {
      resp.spokenText = pq.vpSpokenText || '';
      resp.pronunciationScore = pq.pronunciationScore || 0;
    }
    const subResponses = this.buildSubQuestionResponses(pq);
    if (subResponses) resp.subQuestionResponses = subResponses;
    return resp;
  }

  private applyPerQuestionSubmitResult(pq: PlayerQuestion, res: SubmitQuestionResult): void {
    const watchOnlyClipCompleted =
      this.watchOnlyMode && pq.data?.type === 'video-pronunciation' && pq.isAnswered;
    pq.isCorrect = watchOnlyClipCompleted ? true : res.isCorrect;
    if (watchOnlyClipCompleted) {
      pq.vpResult = 'correct';
    }
    pq.feedback = this.buildFeedbackFromCorrectAnswer(pq.data, res.correctAnswer, pq);
    if (pq.data.type === 'fill-blank' && res.correctAnswer?.answers) {
      pq.data._correctAnswers = res.correctAnswer.answers;
    }
    this.applySubQuestionGradingFromCorrectAnswer(pq, res.correctAnswer);
    if (pq.data.type === 'fill-blank' && !pq.data._correctAnswers?.length && pq.data.answers?.length) {
      pq.data._correctAnswers = pq.data.answers;
    }
    if (pq.data.subQuestions?.length) {
      pq.data.subQuestions.forEach((sq: any) => {
        if (sq.type === 'fill-blank' && !sq._correctAnswers?.length && sq.answers?.length) {
          sq._correctAnswers = sq.answers;
        }
      });
    }
    if ((pq.data.type as string) === 'word_bank_fill' && Array.isArray(res.correctAnswer?.items)) {
      pq.data._wordBankCorrectItems = res.correctAnswer.items;
    }
    if (pq.data.type === 'mcq' && res.correctAnswer?.correctAnswerIndex !== undefined) {
      pq.data.correctAnswerIndex = res.correctAnswer.correctAnswerIndex;
    }
    if (pq.data.type === 'matching' && res.correctAnswer?.pairs) {
      pq.data._correctPairs = res.correctAnswer.pairs;
    }
    if (pq.data.type === 'singular_plural' && Array.isArray(res.correctAnswer?.plurals)) {
      pq.data._correctPlurals = res.correctAnswer.plurals;
    }
    if ((pq.data.type as string) === 'rearrange') {
      pq.data._correctRearrangeTokens = Array.isArray(res.correctAnswer?.rearrangeTokens)
        ? res.correctAnswer.rearrangeTokens
        : [];
      pq.data._correctRearrangeAnswer = res.correctAnswer?.rearrangeAnswer || '';
    }
    if ((pq.data.type as string) === 'image_pin_match') {
      pq.data._imagePinCorrectLabels = Array.isArray(res.correctAnswer?.labels)
        ? res.correctAnswer.labels
        : [];
      pq.data._imagePinCorrectPins = Array.isArray(res.correctAnswer?.pins)
        ? res.correctAnswer.pins
        : [];
    }
    if (res.allSubmitted) {
      this.vpOptimisticCompletion = false;
      this.result = {
        scorePercentage: res.scorePercentage,
        earnedPoints: res.earnedPoints,
        totalPoints: res.totalPoints,
        passed: res.passed,
        answerDetails: this.playerQuestions.map((p, idx) => ({
          questionIndex: idx,
          type: p.data.type,
          isCorrect: p.isCorrect ?? false,
          pointsEarned: p.isCorrect ? (p.data.points || 1) : 0,
          correctAnswer: null
        }))
      };
      if (this.state !== 'submitted') {
        this.stopTimer();
        this.state = 'submitted';
      }
      this.clearExerciseDraftStorage();
    }
  }

  private draftItemHasUserInput(it: DigitalExerciseDraftItem): boolean {
    if (it.selectedOption !== undefined && it.selectedOption !== null) return true;
    if (it.matchingSelections && it.matchingSelections.length > 0) return true;
    if (it.fillAnswers?.some((x) => String(x ?? '').trim() !== '')) return true;
    if (it.subQuestionFillBlankAnswers) {
      for (const arr of Object.values(it.subQuestionFillBlankAnswers)) {
        if ((arr || []).some((x) => String(x ?? '').trim() !== '')) return true;
      }
    }
    if (it.wordBankAnswers?.some((x) => String(x?.value ?? '').trim() !== '')) return true;
    if (it.singularPluralInputs?.some((x) => String(x ?? '').trim() !== '')) return true;
    if (String(it.qaResponse ?? '').trim() !== '') return true;
    if (String(it.listeningText ?? '').trim() !== '') return true;
    if (String(it.jumbleWordResponse ?? '').trim() !== '') return true;
    if (String(it.spokenText ?? '').trim() !== '') return true;
    if (String(it.vpSpokenText ?? '').trim() !== '') return true;
    if (it.hasRecorded) return true;
    return false;
  }

  private async maybeRestoreDraftAfterStart(): Promise<void> {
    if (!this.draftUserId || !this.exerciseId || !this.attemptId || this.playerQuestions.length === 0) return;
    const draft = this.exerciseDraft.read(this.draftUserId, this.exerciseId, this.playerQuestions.length);
    if (!draft) return;

    this.submitting = true;
    try {
      this.applyDraftPayloadToQuestions(draft);
      const gradedIndices: number[] = [];
      draft.items.forEach((it, i) => {
        if (it.serverGraded && this.playerQuestions[i]) gradedIndices.push(i);
      });
      gradedIndices.sort((a, b) => a - b);

      for (const i of gradedIndices) {
        const pq = this.playerQuestions[i];
        const resp = this.buildQuestionResponseForIndex(i);
        if (!resp) continue;
        this.syncElapsedSeconds();
        const res = await firstValueFrom(
          this.exerciseService.submitQuestion(
            this.exerciseId,
            this.attemptId,
            i,
            resp,
            this.elapsedSeconds
          )
        );
        this.applyPerQuestionSubmitResult(pq, res);
        if (res.allSubmitted) {
          return;
        }
      }

      const maxIx = this.playerQuestions.length - 1;
      this.currentIndex = Math.min(Math.max(0, draft.currentIndex), maxIx);
      const cur = this.currentQuestion;
      if (cur?.data?.type === 'video-pronunciation') {
        cur.vpPlaybackEnded = false;
      }
      this.preloadImagesAroundCurrentQuestion();
      if (!this.isVideoOnlyExercise) {
        const cap = Math.min(
          Math.max(0, draft.elapsedSeconds),
          DigitalExercisePlayerComponent.MAX_REPORTED_ELAPSED_SECONDS,
        );
        this.startTime = Date.now() - cap * 1000;
        this.syncElapsedSeconds();
      }
      if (this.isVideoOnlyExercise) {
        this.afterVideoOnlyNavigation();
        setTimeout(() => this.scrollVpChatToBottom(), 120);
      }
      const showRestoreToast =
        gradedIndices.length > 0 ||
        draft.currentIndex > 0 ||
        draft.elapsedSeconds > 2 ||
        draft.items.some((it) => this.draftItemHasUserInput(it));
      if (showRestoreToast) {
        this.snackBar.open(
          'Your answers were restored from this browser (kept for 30 minutes after your last change).',
          'Close',
          { duration: 5000 }
        );
      }
    } catch {
      this.snackBar.open(
        'Saved answers were found but could not all be synced. Continue and submit as usual.',
        'Close',
        { duration: 6000 }
      );
    } finally {
      this.submitting = false;
    }
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  get currentQuestion(): PlayerQuestion {
    return this.playerQuestions[this.currentIndex];
  }

  get isFirstQuestion(): boolean { return this.currentIndex === 0; }
  get isLastQuestion(): boolean { return this.currentIndex === this.playerQuestions.length - 1; }
  get answeredCount(): number { return this.playerQuestions.filter(q => q.isAnswered === true).length; }
  get totalQuestionCount(): number {
    return this.playerQuestions.reduce((s, q) => {
      let count = 1;
      if (q.data.subQuestions?.length) {
        count += q.data.subQuestions.length;
      }
      return s + count;
    }, 0);
  }
  get totalPoints(): number {
    return this.playerQuestions.reduce((s: number, q: any) => {
      let pts = q.data.points || 1;
      if (q.data.subQuestions?.length) {
        pts += q.data.subQuestions.reduce((ss: number, sq: any) => ss + (sq.points || 1), 0);
      }
      return s + pts;
    }, 0);
  }
  get unattemptedCount(): number { return this.playerQuestions.length - this.answeredCount; }

  get correctCount(): number { return this.playerQuestions.filter(q => q.isCorrect === true).length; }
  get wrongCount(): number { return this.playerQuestions.filter(q => q.isCorrect === false).length; }
  get unansweredCount(): number { return this.playerQuestions.filter(q => q.isCorrect !== true && q.isCorrect !== false).length; }
  get submittedCount(): number { return this.playerQuestions.filter(q => q.isCorrect === true || q.isCorrect === false).length; }
  get pendingCount(): number { return this.playerQuestions.length - this.submittedCount; }
  /**
   * 90% completion gating:
   * Students can only finish once they've attempted at least 90% of clips/questions.
   * Uses `answeredCount` because that's the existing "attempted" signal in this player.
   */
  get canCompleteByAttemptRate(): boolean {
    const total = this.playerQuestions.length;
    if (!total) return false;
    const needed = Math.ceil(0.9 * total);
    return this.answeredCount >= needed;
  }
  /** Backward-compatible alias used by older template fragments. */
  get isSubmittedState(): boolean { return this.state === 'submitted'; }

  private stopCurrentAudio(): void {
    if (this.currentlyPlayingAudio) {
      this.currentlyPlayingAudio.pause();
      this.currentlyPlayingAudio.currentTime = 0;
      this.currentlyPlayingAudio = null;
    }
  }

  prevQuestion(): void {
    this.closeMcqOptionImageLightbox();
    this.cancelImagePinAutoAdvance();
    this.clearImagePinInteractionState();
    if (this.currentIndex > 0) {
      this.stopCurrentAudio();
      this.currentIndex--;
      this.preloadImagesAroundCurrentQuestion();
      this.afterVideoOnlyNavigation();
      this.scheduleDraftSave();
    }
  }

  nextQuestion(): void {
    this.closeMcqOptionImageLightbox();
    this.cancelImagePinAutoAdvance();
    this.clearImagePinInteractionState();
    if (this.currentIndex < this.playerQuestions.length - 1) {
      this.stopCurrentAudio();
      this.currentIndex++;
      this.preloadImagesAroundCurrentQuestion();
      this.afterVideoOnlyNavigation();
      this.scheduleDraftSave();
    }
  }

  goToQuestion(index: number): void {
    this.closeMcqOptionImageLightbox();
    this.cancelImagePinAutoAdvance();
    this.clearImagePinInteractionState();
    this.stopCurrentAudio();
    this.currentIndex = index;
    this.preloadImagesAroundCurrentQuestion();
    this.afterVideoOnlyNavigation();
    this.scheduleDraftSave();
  }

  /** Navigate to a batch question by its position in the batch list */
  goToBatchQuestion(batchPosition: number): void {
    if (batchPosition >= 0 && batchPosition < this.batchQuestionIndices.length) {
      const targetIndex = this.batchQuestionIndices[batchPosition];
      this.goToQuestion(targetIndex);
    }
  }

  navPrev(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.isFirstQuestion || this.finishingAll) return;
    this.cancelImagePinAutoAdvance();
    this.prevQuestion();
  }

  navNext(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.finishingAll || this.isLastQuestion) return;
    this.cancelImagePinAutoAdvance();
    this.nextQuestion();
  }

  navFinish(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.finishingAll || !this.canCompleteByAttemptRate) return;
    this.cancelImagePinAutoAdvance();
    this.openFinishSummary();
  }

  showImagePinAutoAdvance(): boolean {
    return (
      this.imagePinAutoAdvanceSeconds > 0 &&
      !this.isLastQuestion &&
      (this.currentQuestion?.data?.type as string) === 'image_pin_match'
    );
  }

  cancelImagePinAutoAdvance(): void {
    if (this.imagePinAutoAdvanceInterval) {
      clearInterval(this.imagePinAutoAdvanceInterval);
      this.imagePinAutoAdvanceInterval = null;
    }
    this.imagePinAutoAdvanceQuestionIndex = null;
    this.imagePinAutoAdvanceSeconds = 0;
  }

  skipImagePinAutoAdvance(): void {
    const idx = this.imagePinAutoAdvanceQuestionIndex;
    this.cancelImagePinAutoAdvance();
    if (idx != null && this.currentIndex === idx && !this.isLastQuestion) {
      this.nextQuestion();
    }
  }

  private maybeScheduleImagePinAutoAdvance(pq: PlayerQuestion): void {
    if ((pq.data.type as string) !== 'image_pin_match') return;
    if (this.state === 'submitted' || this.finishingAll || this.hasCurrentSubmitted) return;
    if (!this.isQuestionAnswered(pq) || this.isLastQuestion) {
      this.cancelImagePinAutoAdvance();
      return;
    }
    if (
      this.imagePinAutoAdvanceInterval &&
      this.imagePinAutoAdvanceQuestionIndex === pq.index
    ) {
      return;
    }

    this.cancelImagePinAutoAdvance();
    this.imagePinAutoAdvanceQuestionIndex = pq.index;
    this.imagePinAutoAdvanceSeconds = 5;
    this.imagePinAutoAdvanceInterval = setInterval(() => {
      this.imagePinAutoAdvanceSeconds--;
      if (this.imagePinAutoAdvanceSeconds <= 0) {
        const questionIndex = this.imagePinAutoAdvanceQuestionIndex;
        this.cancelImagePinAutoAdvance();
        if (
          questionIndex != null &&
          this.currentIndex === questionIndex &&
          this.currentIndex < this.playerQuestions.length - 1
        ) {
          this.nextQuestion();
        }
      }
      this.zone.run(() => {});
    }, 1000);
    this.zone.run(() => {});
  }

  isQuestionAnswered(pq: PlayerQuestion): boolean {
    const q = pq.data;
    const subs = Array.isArray(q.subQuestions) ? q.subQuestions : [];
    if (subs.length > 0) {
      for (let sqi = 0; sqi < subs.length; sqi++) {
        if (!this.isSubQuestionAnswered(pq, sqi)) return false;
      }
    }
    if (q.type === 'mcq') return pq.selectedOption !== undefined && pq.selectedOption !== null;
    if (q.type === 'matching') return (pq.matchingLeft || []).every(l => l.matchedRightIndex !== null);
    if (q.type === 'fill-blank') return (pq.fillAnswers || []).every(a => a.trim() !== '');
    if ((q.type as string) === 'word_bank_fill') {
      const arr = pq.wordBankAnswers || [];
      return arr.length > 0 && arr.every((x) => String(x?.value ?? '').trim().length > 0);
    }
    if (q.type === 'singular_plural') {
      const n = (q.pairs || []).filter((p: any) => String(p?.singular || '').trim()).length;
      const inputs = pq.singularPluralInputs || [];
      if (n <= 0) return inputs.length > 0 && inputs.every(s => (s || '').trim() !== '');
      for (let i = 0; i < n; i++) {
        if (!String(inputs[i] ?? '').trim()) return false;
      }
      return true;
    }
    if (q.type === 'pronunciation') return pq.hasRecorded === true;
    if (q.type === 'question-answer') return (pq.qaResponse || '').trim().length > 0;
    if (q.type === 'listening') return (pq.listeningText || '').trim().length > 0;
    if ((q.type as string) === 'jumble-word') return (pq.jumbleWordResponse || '').trim().length > 0;
    if ((q.type as string) === 'rearrange') {
      // tokens always exist; count as answered only after the learner moves at least one tile
      return pq.isAnswered === true;
    }
    if ((q.type as string) === 'image_pin_match') {
      const labels = Array.isArray(q.labels) ? q.labels : [];
      const conns = Array.isArray(pq.imagePinConnections) ? pq.imagePinConnections : [];
      if (!labels.length) return false;
      return labels.every((l: any) => conns.some((c) => c.labelId === l.id && !!c.pinId));
    }
    if (q.type === 'video-pronunciation') {
      if (this.watchOnlyMode && pq.isAnswered) return true;
      return pq.hasRecorded === true;
    }
    return false;
  }

  private isSubQuestionAnswered(pq: PlayerQuestion, subIndex: number): boolean {
    const sq = pq.data.subQuestions?.[subIndex];
    if (!sq) return false;
    if (sq.type === 'fill-blank') {
      const count = countFillBlankRuns(sq.sentence || '');
      const answers = pq.subQuestionFillBlankAnswers?.[subIndex] || [];
      if (count <= 0) return false;
      for (let i = 0; i < count; i++) {
        if (!String(answers[i] ?? '').trim()) return false;
      }
      return true;
    }
    if (sq.type === 'mcq') {
      return pq.subQuestionAnswers?.[subIndex] !== undefined && pq.subQuestionAnswers?.[subIndex] !== null;
    }
    if (sq.type === 'matching') {
      const matches = pq.subQuestionMatching?.[subIndex];
      const leftCount = Array.isArray(sq.leftItems) ? sq.leftItems.length : (sq.pairs?.length || 0);
      if (!leftCount) return false;
      for (let li = 0; li < leftCount; li++) {
        if (matches?.[li] === undefined || matches?.[li] === null) return false;
      }
      return true;
    }
    if ((sq.type as string) === 'word_bank_fill') {
      const items = this.getSubQuestionWordBankItems(sq);
      const answers = pq.subQuestionWordBankAnswers?.[subIndex] || [];
      return items.length > 0 && items.every((_x: unknown, ii: number) => String(answers[ii] ?? '').trim() !== '');
    }
    const ans = pq.subQuestionAnswers?.[subIndex];
    return ans !== undefined && ans !== null && String(ans).trim() !== '';
  }

  private buildSubQuestionResponses(pq: PlayerQuestion): QuestionResponse['subQuestionResponses'] {
    const subs = pq.data.subQuestions;
    if (!subs?.length) return undefined;
    return subs.map((sq: any, sqi: number) => {
      const base = { questionIndex: sqi };
      if (sq.type === 'mcq') {
        const ans = pq.subQuestionAnswers?.[sqi];
        return { ...base, selectedOptionIndex: ans !== undefined && ans !== null ? Number(ans) : null };
      }
      if (sq.type === 'fill-blank') {
        return { ...base, fillBlankResponses: [...(pq.subQuestionFillBlankAnswers?.[sqi] || [])] };
      }
      const ans = pq.subQuestionAnswers?.[sqi];
      return { ...base, textAnswer: ans !== undefined && ans !== null ? String(ans) : null };
    });
  }

  private applySubQuestionGradingFromCorrectAnswer(pq: PlayerQuestion, correctAnswer: any): void {
    const subResults = Array.isArray(correctAnswer?.subResults) ? correctAnswer.subResults : [];
    if (!subResults.length || !pq.data.subQuestions?.length) return;
    if (!pq.subQuestionIsCorrect) pq.subQuestionIsCorrect = {};
    subResults.forEach((sub: any) => {
      const sqi = sub?.questionIndex;
      const sq = pq.data.subQuestions?.[sqi];
      if (!sq || sqi === undefined || sqi === null) return;
      if (typeof sub.isCorrect === 'boolean') {
        pq.subQuestionIsCorrect![sqi] = sub.isCorrect;
      }
      if (sq.type === 'fill-blank' && Array.isArray(sub.correctAnswer?.answers)) {
        sq._correctAnswers = sub.correctAnswer.answers;
      } else if (sq.type === 'fill-blank' && Array.isArray(sq.answers)) {
        sq._correctAnswers = sq.answers;
      }
      if (sq.type === 'mcq' && sub.correctAnswer?.correctAnswerIndex !== undefined) {
        sq.correctAnswerIndex = sub.correctAnswer.correctAnswerIndex;
      }
    });
  }

  /** One row per blank across parent + fill-blank sub-parts (Blank 1, Blank 2, …). */
  getFillBlankReviewItems(
    pq: PlayerQuestion,
    questionIndex: number
  ): Array<{
    globalIndex: number;
    partLabel: string;
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    answered: boolean;
  }> {
    const items: Array<{
      globalIndex: number;
      partLabel: string;
      studentAnswer: string;
      correctAnswer: string;
      isCorrect: boolean;
      answered: boolean;
    }> = [];
    let blankNum = 0;
    const data = pq.data;
    const subs = data.subQuestions || [];
    const hasSubQuestions = subs.length > 0;

    if (data.type === 'fill-blank' && countFillBlankRuns(data.sentence || '') > 0) {
      const count = countFillBlankRuns(data.sentence || '');
      const correctList = data._correctAnswers || data.answers || [];
      const partLabel = this.getFillBlankReviewPartLabel(
        questionIndex,
        this.getParentPartNumber(data),
        'parent',
        hasSubQuestions
      );
      for (let bi = 0; bi < count; bi++) {
        blankNum++;
        const studentAnswer = String(pq.fillAnswers?.[bi] ?? '').trim();
        const correctAnswer = String(correctList[bi] ?? '').trim();
        items.push({
          globalIndex: blankNum,
          partLabel,
          studentAnswer,
          correctAnswer,
          isCorrect: this.isFillCorrect(pq, bi),
          answered: studentAnswer.length > 0
        });
      }
    }

    for (let si = 0; si < subs.length; si++) {
      const sq = subs[si];
      if (sq.type !== 'fill-blank') continue;
      const count = countFillBlankRuns(sq.sentence || '');
      if (count <= 0) continue;
      const correctList = sq._correctAnswers || sq.answers || [];
      const partLabel = this.getFillBlankReviewPartLabel(
        questionIndex,
        this.getSubQuestionPartNumber(si, data),
        'sub',
        hasSubQuestions
      );
      for (let bi = 0; bi < count; bi++) {
        blankNum++;
        const studentAnswer = String(pq.subQuestionFillBlankAnswers?.[si]?.[bi] ?? '').trim();
        const correctAnswer = String(correctList[bi] ?? '').trim();
        items.push({
          globalIndex: blankNum,
          partLabel,
          studentAnswer,
          correctAnswer,
          isCorrect: this.isSubFillCorrect(pq, si, bi),
          answered: studentAnswer.length > 0
        });
      }
    }

    return items;
  }

  hasFillBlankReviewItems(pq: PlayerQuestion, questionIndex: number): boolean {
    return this.getFillBlankReviewItems(pq, questionIndex).length > 0;
  }

  getSubQuestionIsCorrect(pq: PlayerQuestion, sqIndex: number): boolean {
    if (pq.subQuestionIsCorrect?.[sqIndex] !== undefined) {
      return !!pq.subQuestionIsCorrect[sqIndex];
    }
    const sq = pq.data.subQuestions?.[sqIndex];
    if (sq?.type === 'fill-blank') {
      const count = countFillBlankRuns(sq.sentence || '');
      if (count <= 0) return false;
      for (let bi = 0; bi < count; bi++) {
        if (!this.isSubFillCorrect(pq, sqIndex, bi)) return false;
      }
      return true;
    }
    return false;
  }

  getSubCorrectAnswerText(pq: PlayerQuestion, sqIndex: number): string {
    const sq = pq.data.subQuestions?.[sqIndex];
    if (!sq) return '—';
    if (sq.type === 'fill-blank') {
      const list = sq._correctAnswers || sq.answers || [];
      return list.length ? list.map((x: string) => String(x ?? '').trim()).filter(Boolean).join(' / ') : '—';
    }
    if (sq.type === 'mcq') {
      return sq.options?.[sq.correctAnswerIndex] || '—';
    }
    if (sq.type === 'question-answer' && this.isTrueFalseQuestion(sq)) {
      const samples: string[] = sq.sampleAnswers || [];
      const parsed = samples.map(s => this.parseTrueFalseStrictSample(s)).find(v => v === true || v === false);
      if (parsed === true) return 'Richtig';
      if (parsed === false) return 'Falsch';
      return samples.length ? samples.join('; ') : '—';
    }
    return '—';
  }

  // ─── MCQ Interaction ─────────────────────────────────────────────────────────

  selectOption(pq: PlayerQuestion, index: number): void {
    if (this.state === 'submitted') return;
    pq.selectedOption = index;
    this.markAttempted(pq);
  }

  // ─── Sub-question Interaction ─────────────────────────────────────────────────────

  selectSubQuestionOption(pq: PlayerQuestion, subIndex: number, optionIndex: number): void {
    if (this.state === 'submitted') return;
    if (!pq.subQuestionAnswers) {
      pq.subQuestionAnswers = {};
    }
    pq.subQuestionAnswers[subIndex] = optionIndex;
    this.markAttempted(pq);
  }

  setSubQuestionAnswer(pq: PlayerQuestion, subIndex: number, answer: string): void {
    if (this.state === 'submitted') return;
    if (!pq.subQuestionAnswers) {
      pq.subQuestionAnswers = {};
    }
    pq.subQuestionAnswers[subIndex] = answer;
    this.markAttempted(pq);
  }

  setSubQuestionTrueFalse(pq: PlayerQuestion, subIndex: number, value: boolean): void {
    this.setSubQuestionAnswer(pq, subIndex, value ? 'true' : 'false');
  }

  getSubQuestionSpInput(pq: PlayerQuestion, subIndex: number, rowIndex: number): string {
    if (!pq.subQuestionSpInputs) {
      pq.subQuestionSpInputs = {};
    }
    if (!pq.subQuestionSpInputs[subIndex]) {
      pq.subQuestionSpInputs[subIndex] = [];
    }
    return pq.subQuestionSpInputs[subIndex][rowIndex] || '';
  }

  setSubQuestionSpInput(pq: PlayerQuestion, subIndex: number, rowIndex: number, value: string): void {
    if (this.state === 'submitted') return;
    if (!pq.subQuestionSpInputs) {
      pq.subQuestionSpInputs = {};
    }
    if (!pq.subQuestionSpInputs[subIndex]) {
      pq.subQuestionSpInputs[subIndex] = [];
    }
    pq.subQuestionSpInputs[subIndex][rowIndex] = value;
    this.markAttempted(pq);
  }

  // ─── Sub-Question Fill Blank ───────────────────────────────────────────────────
  getSubQuestionFillBlankAnswer(pq: PlayerQuestion, subIndex: number, blankIndex: number): string {
    if (!pq.subQuestionFillBlankAnswers) {
      pq.subQuestionFillBlankAnswers = {};
    }
    if (!pq.subQuestionFillBlankAnswers[subIndex]) {
      pq.subQuestionFillBlankAnswers[subIndex] = [];
    }
    return pq.subQuestionFillBlankAnswers[subIndex][blankIndex] || '';
  }

  setSubQuestionFillBlankAnswer(pq: PlayerQuestion, subIndex: number, blankIndex: number, value: string): void {
    if (this.state === 'submitted') return;
    if (!pq.subQuestionFillBlankAnswers) {
      pq.subQuestionFillBlankAnswers = {};
    }
    if (!pq.subQuestionFillBlankAnswers[subIndex]) {
      pq.subQuestionFillBlankAnswers[subIndex] = [];
    }
    pq.subQuestionFillBlankAnswers[subIndex][blankIndex] = value;
    this.markAttempted(pq);
  }

  // ─── Sub-Question Matching ─────────────────────────────────────────────────────
  selectSubQuestionMatchingLeft(pq: PlayerQuestion, subIndex: number, leftIndex: number): void {
    if (this.state === 'submitted') return;
    if (!pq.subQuestionMatching) {
      pq.subQuestionMatching = {};
    }
    if (pq.subQuestionMatching[subIndex]?.[leftIndex] !== undefined && pq.subQuestionMatching[subIndex][leftIndex] !== null) {
      delete pq.subQuestionMatching[subIndex][leftIndex];
    }
    pq.subQuestionMatchingSelectedLeft = pq.subQuestionMatchingSelectedLeft || {};
    pq.subQuestionMatchingSelectedLeft[subIndex] = leftIndex;
    this.markAttempted(pq);
  }

  selectSubQuestionMatchingRight(pq: PlayerQuestion, subIndex: number, rightIndex: number): void {
    if (this.state === 'submitted') return;
    const selectedLeft = pq.subQuestionMatchingSelectedLeft?.[subIndex];
    if (selectedLeft === undefined || selectedLeft === null) return;
    if (!pq.subQuestionMatching) {
      pq.subQuestionMatching = {};
    }
    if (!pq.subQuestionMatching[subIndex]) {
      pq.subQuestionMatching[subIndex] = {};
    }
    pq.subQuestionMatching[subIndex][selectedLeft] = rightIndex;
    pq.subQuestionMatchingSelectedLeft = pq.subQuestionMatchingSelectedLeft || {};
    pq.subQuestionMatchingSelectedLeft[subIndex] = null;
    this.markAttempted(pq);
  }

  isSubQuestionMatchingRightUsed(pq: PlayerQuestion, subIndex: number, rightIndex: number): boolean {
    const matches = pq.subQuestionMatching?.[subIndex];
    if (!matches) return false;
    return Object.values(matches).some(v => v === rightIndex);
  }

  // ─── Sub-Question Word Bank ───────────────────────────────────────────────────
  getSubQuestionWordBankAnswer(pq: PlayerQuestion, subIndex: number, blankIndex: number): string {
    if (!pq.subQuestionWordBankAnswers) {
      pq.subQuestionWordBankAnswers = {};
    }
    if (!pq.subQuestionWordBankAnswers[subIndex]) {
      pq.subQuestionWordBankAnswers[subIndex] = [];
    }
    return pq.subQuestionWordBankAnswers[subIndex][blankIndex] || '';
  }

  setSubQuestionWordBankAnswer(pq: PlayerQuestion, subIndex: number, blankIndex: number, value: string): void {
    if (this.state === 'submitted') return;
    if (!pq.subQuestionWordBankAnswers) {
      pq.subQuestionWordBankAnswers = {};
    }
    if (!pq.subQuestionWordBankAnswers[subIndex]) {
      pq.subQuestionWordBankAnswers[subIndex] = [];
    }
    pq.subQuestionWordBankAnswers[subIndex][blankIndex] = value;
    this.markAttempted(pq);
  }

  getSubQuestionWordBankItems(sq: any): any[] {
    if (sq.prompts) return sq.prompts;
    if (sq.sentences) return sq.sentences;
    if (sq.blanks) return sq.blanks;
    return [];
  }

  displaySubQuestionWordBankPrompt(item: any, index: number): string {
    if (typeof item === 'string') return item;
    if (item.prompt) return item.prompt;
    if (item.sentence) return item.sentence;
    return `Blank ${index + 1}`;
  }

  fillSubQuestionWordBankBlank(pq: PlayerQuestion, subIndex: number, word: string): void {
    if (this.state === 'submitted') return;
    if (!pq.subQuestionWordBankAnswers) {
      pq.subQuestionWordBankAnswers = {};
    }
    if (!pq.subQuestionWordBankAnswers[subIndex]) {
      const itemCount = this.getSubQuestionWordBankItems(pq.data?.subQuestions?.[subIndex] || {}).length;
      pq.subQuestionWordBankAnswers[subIndex] = new Array(itemCount).fill('');
    }
    const emptyIndex = pq.subQuestionWordBankAnswers[subIndex].findIndex((v: string) => !v || !v.trim());
    if (emptyIndex !== -1) {
      pq.subQuestionWordBankAnswers[subIndex][emptyIndex] = word;
      this.markAttempted(pq);
    }
  }

  // ─── Sub-Question Jumble Word ─────────────────────────────────────────────────
  onSubQuestionJumbleResponseChange(pq: PlayerQuestion, subIndex: number, sq: any, answer: string): void {
    if (this.state === 'submitted') return;
    if (!pq.subQuestionJumbleUsedTokenIndices) {
      pq.subQuestionJumbleUsedTokenIndices = {};
    }
    pq.subQuestionJumbleUsedTokenIndices[subIndex] = this.reconcileJumbleUsedTokenIndices(
      sq,
      pq.subQuestionJumbleUsedTokenIndices[subIndex],
      answer
    );
    this.setSubQuestionAnswer(pq, subIndex, answer);
  }

  insertSubQuestionJumbleToken(pq: PlayerQuestion, subIndex: number, token: string, tokenIndex: number): void {
    if (this.state === 'submitted') return;
    if (!token || token === ' ') return;
    if (!pq.subQuestionJumbleUsedTokenIndices) {
      pq.subQuestionJumbleUsedTokenIndices = {};
    }
    if (!pq.subQuestionJumbleUsedTokenIndices[subIndex]) {
      pq.subQuestionJumbleUsedTokenIndices[subIndex] = [];
    }
    if (pq.subQuestionJumbleUsedTokenIndices[subIndex].includes(tokenIndex)) return;
    const current = this.getSubQuestionAnswer(pq, subIndex) || '';
    pq.subQuestionJumbleUsedTokenIndices[subIndex].push(tokenIndex);
    this.setSubQuestionAnswer(pq, subIndex, current + token);
  }

  isSubQuestionJumbleTokenUsed(pq: PlayerQuestion, subIndex: number, tokenIndex: number): boolean {
    return !!pq.subQuestionJumbleUsedTokenIndices?.[subIndex]?.includes(tokenIndex);
  }

  // ─── Sub-Question Rearrange ───────────────────────────────────────────────────
  getSubQuestionRearrangeTokens(pq: PlayerQuestion, subIndex: number): string[] {
    if (!pq.subQuestionRearrangeTokens) {
      pq.subQuestionRearrangeTokens = {};
    }
    if (!pq.subQuestionRearrangeTokens[subIndex]) {
      const sq = pq.data?.subQuestions?.[subIndex];
      pq.subQuestionRearrangeTokens[subIndex] = sq?.tokens ? [...sq.tokens] : [];
    }
    return pq.subQuestionRearrangeTokens[subIndex];
  }

  onSubQuestionRearrangeDrop(pq: PlayerQuestion, subIndex: number, event: any): void {
    if (this.state === 'submitted') return;
    if (!pq.subQuestionRearrangeTokens) {
      pq.subQuestionRearrangeTokens = {};
    }
    const tokens = this.getSubQuestionRearrangeTokens(pq, subIndex);
    const [moved] = tokens.splice(event.previousIndex, 1);
    tokens.splice(event.currentIndex, 0, moved);
    pq.subQuestionRearrangeTokens[subIndex] = tokens;
    this.markAttempted(pq);
  }

  // ─── Sub-Question Answer Helper ───────────────────────────────────────────────
  getSubQuestionAnswer(pq: PlayerQuestion, subIndex: number): string {
    return pq.subQuestionAnswers?.[subIndex] as string || '';
  }

  // ─── Matching Interaction ─────────────────────────────────────────────────────

  selectLeft(pq: PlayerQuestion, index: number): void {
    if (this.state === 'submitted') return;
    if (pq.matchingLeft![index].matchedRightIndex !== null) {
      this.unmatchLeft(pq, index);
      return;
    }
    pq.selectedLeftIndex = index;
    this.markAttempted(pq);
  }

  selectTrueFalse(pq: PlayerQuestion, value: boolean): void {
    if (this.state === 'submitted') return;
    pq.qaResponse = value ? 'true' : 'false';
    this.markAttempted(pq);
  }

  selectImagePinLabel(pq: PlayerQuestion, labelId: string): void {
    if (this.state === 'submitted' || pq?.isCorrect === true || pq?.isCorrect === false) return;
    pq.selectedLabelId = labelId;
  }

  connectImagePin(pq: PlayerQuestion, pinId: string): void {
    if (this.state === 'submitted' || pq?.isCorrect === true || pq?.isCorrect === false) return;
    const labelId = String(pq.selectedLabelId || '');
    if (!labelId) return;
    if (!Array.isArray(pq.imagePinConnections)) pq.imagePinConnections = [];
    pq.imagePinConnections = [
      ...pq.imagePinConnections.filter((c) => c.labelId !== labelId),
      { labelId, pinId }
    ];
    pq.selectedLabelId = null;
    this.markAttempted(pq);
    this.maybeScheduleImagePinAutoAdvance(pq);
  }

  getImagePinConnection(pq: PlayerQuestion, labelId: string): string {
    const found = (pq.imagePinConnections || []).find((c) => c.labelId === labelId);
    return found?.pinId || '';
  }

  getImagePinLabelColor(pq: PlayerQuestion, labelId: string): string {
    return (pq.imagePinLabels || []).find((l) => l.id === labelId)?.color || '#4f46e5';
  }

  getImagePinLabelsLeft(pq: PlayerQuestion): Array<{ id: string; text: string; color: string }> {
    const labels = Array.isArray(pq.imagePinLabels) ? pq.imagePinLabels : [];
    return labels.filter((_, idx) => idx % 2 === 0);
  }

  getImagePinLabelsRight(pq: PlayerQuestion): Array<{ id: string; text: string; color: string }> {
    const labels = Array.isArray(pq.imagePinLabels) ? pq.imagePinLabels : [];
    return labels.filter((_, idx) => idx % 2 === 1);
  }

  getImagePinImageUrl(data: any): string {
    const direct = String(data?.imageUrl || '').trim();
    if (direct) return direct;
    const fallback = String(data?.attachmentUrl || '').trim();
    if (fallback && this.getAttachmentType(fallback) === 'image') return fallback;
    return '';
  }

  getMcqOptionImageUrl(data: any, oi: number): string {
    const urls = Array.isArray(data?.optionImageUrls) ? data.optionImageUrls : [];
    return String(urls[oi] || '').trim();
  }

  hasMcqOptionImages(data: any): boolean {
    const urls = Array.isArray(data?.optionImageUrls) ? data.optionImageUrls : [];
    return urls.some((u: unknown) => !!String(u || '').trim());
  }

  openMcqOptionImageLightbox(rawUrl: string, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    const url = this.getMediaFullUrl(rawUrl);
    if (!url) return;
    this.mcqImageLightboxUrl = url;
    document.body.style.overflow = 'hidden';
  }

  closeMcqOptionImageLightbox(): void {
    this.mcqImageLightboxUrl = null;
    document.body.style.overflow = '';
  }

  onMcqOptionKeyActivate(event: Event, pq: PlayerQuestion, oi: number): void {
    if (this.hasCurrentSubmitted) return;
    event.preventDefault();
    this.selectOption(pq, oi);
  }

  onMcqSubOptionKeyActivate(event: Event, pq: PlayerQuestion, sqIndex: number, oi: number): void {
    if (this.hasCurrentSubmitted) return;
    event.preventDefault();
    this.selectSubQuestionOption(pq, sqIndex, oi);
  }

  @HostListener('document:keydown.escape')
  onMcqImageLightboxEscape(): void {
    if (this.mcqImageLightboxUrl) this.closeMcqOptionImageLightbox();
  }

  getImagePinPins(data: any): Array<{ id: string; x: number; y: number }> {
    const raw = Array.isArray(data?.pins) ? data.pins : [];
    return raw
      .map((p: any, idx: number) => ({
        id: String(p?.id || `pin-${idx + 1}`),
        x: Math.max(0, Math.min(100, Number(p?.x) || 0)),
        y: Math.max(0, Math.min(100, Number(p?.y) || 0)),
      }))
      .filter((p: { id: string }) => !!p.id);
  }

  isImagePinDragActive(pq: PlayerQuestion): boolean {
    return this.imagePinDrag.active && this.imagePinDrag.questionIndex === pq.index;
  }

  imagePinTempLine(pq: PlayerQuestion): { color: string; x1: number; y1: number; x2: number; y2: number } | null {
    if (!this.isImagePinDragActive(pq)) return null;
    return {
      color: this.imagePinDrag.color,
      x1: this.imagePinDrag.x1,
      y1: this.imagePinDrag.y1,
      x2: this.imagePinDrag.x2,
      y2: this.imagePinDrag.y2
    };
  }

  imagePinIsPinNearDrag(pq: PlayerQuestion, pinId: string): boolean {
    return this.isImagePinDragActive(pq) && this.imagePinDrag.hoverPinId === pinId;
  }

  private getPlayerThreeColEl(): HTMLElement | null {
    return this.el.nativeElement.querySelector('.player-three-col');
  }

  startImagePinDrag(pq: PlayerQuestion, labelId: string, event: PointerEvent): void {
    if (this.state === 'submitted' || !pq || pq.isCorrect === true || pq.isCorrect === false) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const wrap = this.getImagePinWrapEl(pq.index);
    const handle = this.getImagePinHandleEl(pq.index, labelId);
    if (!wrap || !handle) return;

    // Capture the pointer on the handle element so all subsequent move/up events
    // are routed here regardless of where the finger travels on the screen.
    // touch-action: none on .ipm-handle (set in CSS) tells the browser not to
    // scroll when touch starts on the handle, so drag always works.
    event.preventDefault();
    event.stopPropagation();

    handle.classList.add('is-dragging');

    const wrapRect = wrap.getBoundingClientRect();
    const hRect = handle.getBoundingClientRect();
    const startX = hRect.left + hRect.width / 2 - wrapRect.left;
    const startY = hRect.top + hRect.height / 2 - wrapRect.top;

    this.imagePinDrag = {
      active: true,
      questionIndex: pq.index,
      labelId,
      color: this.getImagePinLabelColor(pq, labelId),
      x1: startX,
      y1: startY,
      x2: event.clientX - wrapRect.left,
      y2: event.clientY - wrapRect.top,
      hoverPinId: null
    };

    this.imagePinCaptureTarget = handle;
    this.imagePinCapturePointerId = event.pointerId;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Ignore on unsupported environments
    }
    this.zone.run(() => {});
  }

  @HostListener('window:pointermove', ['$event'])
  onImagePinPointerMove(event: PointerEvent): void {
    if (!this.imagePinDrag.active) return;
    const wrap = this.getImagePinWrapEl(this.imagePinDrag.questionIndex);
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    this.imagePinDrag.x2 = event.clientX - wrapRect.left;
    this.imagePinDrag.y2 = event.clientY - wrapRect.top;
    this.imagePinDrag.hoverPinId = this.findClosestPinId(
      this.imagePinDrag.questionIndex,
      event.clientX,
      event.clientY,
      34
    );
    this.zone.run(() => {});
  }

  @HostListener('window:pointerup', ['$event'])
  onImagePinPointerUp(_event: PointerEvent): void {
    if (!this.imagePinDrag.active) return;
    const pq = this.playerQuestions[this.imagePinDrag.questionIndex];
    const pinId = this.imagePinDrag.hoverPinId;
    const labelId = this.imagePinDrag.labelId;
    if (pq && pinId && labelId) {
      if (!Array.isArray(pq.imagePinConnections)) pq.imagePinConnections = [];
      pq.imagePinConnections = [
        ...pq.imagePinConnections.filter((c) => c.labelId !== labelId),
        { labelId, pinId }
      ];
      pq.selectedLabelId = null;
      this.markAttempted(pq);
      this.maybeScheduleImagePinAutoAdvance(pq);
    }
    this.resetImagePinDrag();
    this.zone.run(() => {});
  }

  @HostListener('window:pointercancel')
  onImagePinPointerCancel(): void {
    if (this.imagePinDrag.active) {
      this.resetImagePinDrag();
      this.zone.run(() => {});
    }
  }

  @HostListener('window:resize')
  onImagePinResize(): void {
    if (this.imagePinDrag.active) {
      this.imagePinDrag = { ...this.imagePinDrag };
    }
  }

  /** Release any stuck pin drag so Next/Previous stay tappable on mobile. */
  private clearImagePinInteractionState(): void {
    if (this.imagePinDrag.active) {
      this.resetImagePinDrag();
    }
  }

  private resetImagePinDrag(): void {
    const handle = this.getImagePinHandleEl(
      this.imagePinDrag.questionIndex,
      this.imagePinDrag.labelId
    );
    handle?.classList.remove('is-dragging');
    try {
      if (this.imagePinCaptureTarget && this.imagePinCapturePointerId != null) {
        this.imagePinCaptureTarget.releasePointerCapture(this.imagePinCapturePointerId);
      }
    } catch {
      // Ignore release errors
    }
    this.imagePinCaptureTarget = null;
    this.imagePinCapturePointerId = null;
    this.imagePinDrag.active = false;
    this.imagePinDrag.questionIndex = -1;
    this.imagePinDrag.labelId = '';
    this.imagePinDrag.hoverPinId = null;
  }

  private getImagePinWrapEl(questionIndex: number): HTMLElement | null {
    return document.getElementById(`ipm-wrap-${questionIndex}`) as HTMLElement | null;
  }

  private getImagePinHandleEl(questionIndex: number, labelId: string): HTMLElement | null {
    return document.getElementById(`ipm-handle-${questionIndex}-${labelId}`) as HTMLElement | null;
  }

  private findClosestPinId(questionIndex: number, clientX: number, clientY: number, maxDistancePx: number): string | null {
    const pq = this.playerQuestions[questionIndex];
    if (!pq) return null;
    const pins = this.getImagePinPins(pq.data);
    let best: { id: string; d: number } | null = null;
    for (const p of pins) {
      const pinEl = document.getElementById(`ipm-pin-${questionIndex}-${p.id}`);
      if (!pinEl) continue;
      const r = pinEl.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(clientX - cx, clientY - cy);
      if (d <= maxDistancePx && (!best || d < best.d)) {
        best = { id: String(p.id), d };
      }
    }
    return best?.id || null;
  }

  imagePinSvgLines(pq: PlayerQuestion): Array<{ color: string; x1: number; y1: number; x2: number; y2: number }> {
    const wrap = this.getImagePinWrapEl(pq.index);
    if (!wrap) return [];
    const wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.width || !wrapRect.height) return [];
    const lines: Array<{ color: string; x1: number; y1: number; x2: number; y2: number }> = [];
    (pq.imagePinConnections || []).forEach((conn) => {
      const handle = document.getElementById(`ipm-handle-${pq.index}-${conn.labelId}`);
      const pin = document.getElementById(`ipm-pin-${pq.index}-${conn.pinId}`);
      if (!handle || !pin) return;
      const a = handle.getBoundingClientRect();
      const b = pin.getBoundingClientRect();
      lines.push({
        color: this.getImagePinLabelColor(pq, conn.labelId),
        x1: Math.round(a.left + a.width / 2 - wrapRect.left),
        y1: Math.round(a.top + a.height / 2 - wrapRect.top),
        x2: Math.round(b.left + b.width / 2 - wrapRect.left),
        y2: Math.round(b.top + b.height / 2 - wrapRect.top),
      });
    });
    return lines;
  }

  selectRight(pq: PlayerQuestion, rightIndex: number): void {
    if (this.state === 'submitted') return;
    if (pq.selectedLeftIndex === null || pq.selectedLeftIndex === undefined) return;

    const leftIndex = pq.selectedLeftIndex;

    if (pq.matchingRight![rightIndex].matchedLeftIndex !== null) return; // already matched

    pq.matchingLeft![leftIndex].matchedRightIndex = rightIndex;
    pq.matchingRight![rightIndex].matchedLeftIndex = leftIndex;
    pq.selectedLeftIndex = null;
    this.markAttempted(pq);
  }

  unmatchLeft(pq: PlayerQuestion, leftIndex: number): void {
    const rightIndex = pq.matchingLeft![leftIndex].matchedRightIndex;
    if (rightIndex !== null && rightIndex !== undefined) {
      pq.matchingRight![rightIndex].matchedLeftIndex = null;
    }
    pq.matchingLeft![leftIndex].matchedRightIndex = null;
  }

  unmatchRight(pq: PlayerQuestion, rightIndex: number): void {
    const leftIndex = pq.matchingRight![rightIndex].matchedLeftIndex;
    if (leftIndex !== null && leftIndex !== undefined) {
      pq.matchingLeft![leftIndex].matchedRightIndex = null;
    }
    pq.matchingRight![rightIndex].matchedLeftIndex = null;
  }

  getMatchedRightValue(pq: PlayerQuestion, leftIndex: number): string {
    const ri = pq.matchingLeft![leftIndex].matchedRightIndex;
    return ri !== null && ri !== undefined ? pq.matchingRight![ri].value : '';
  }

  getLeftMatchClass(pq: PlayerQuestion, leftIndex: number): string {
    const rightIndex = pq.matchingLeft?.[leftIndex]?.matchedRightIndex;
    if (rightIndex === null || rightIndex === undefined || rightIndex < 0) return '';
    return this.getMatchColorClass(leftIndex);
  }

  getRightMatchClass(pq: PlayerQuestion, rightIndex: number): string {
    const leftIndex = pq.matchingRight?.[rightIndex]?.matchedLeftIndex;
    if (leftIndex === null || leftIndex === undefined || leftIndex < 0) return '';
    return this.getMatchColorClass(leftIndex);
  }

  private getMatchColorClass(leftIndex: number): string {
    const palette = ['pair-1', 'pair-2', 'pair-3', 'pair-4', 'pair-5', 'pair-6', 'pair-7', 'pair-8'];
    return palette[leftIndex % palette.length];
  }

  // ─── Pronunciation Interaction ────────────────────────────────────────────────

  recordingCountdown = 0;
  private recordingCountdownInterval: any = null;
  private recordingForceStopTimer: any = null;

  private clearRecordingTimers(): void {
    if (this.recordingCountdownInterval) { clearInterval(this.recordingCountdownInterval); this.recordingCountdownInterval = null; }
    if (this.recordingForceStopTimer) { clearTimeout(this.recordingForceStopTimer); this.recordingForceStopTimer = null; }
    this.recordingCountdown = 0;
  }

  // Default pass threshold for video pronunciation when exercise config
  // doesn't include `data.similarityThreshold`.
  // Using a low default causes partial speech to be treated as "correct".
  private static readonly VP_PASS_SCORE = 60;
  private static readonly VP_SECONDARY_CAPTION_DEFAULT_DELAY_SECONDS = 5;
  private static readonly VP_MAX_FAILED_ATTEMPTS_PER_CLIP = 3;

  private normalizeSpeechText(raw: string): string {
    return String(raw || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private numberTokenVariantsMap(lang: string): Record<string, string[]> {
    if (lang === 'de-DE') {
      return {
        '0': ['null'],
        '1': ['eins', 'ein', 'eine'],
        '2': ['zwei'],
        '3': ['drei'],
        '4': ['vier'],
        '5': ['funf', 'fuenf'],
        '6': ['sechs'],
        '7': ['sieben'],
        '8': ['acht'],
        '9': ['neun'],
        '10': ['zehn'],
        '11': ['elf'],
        '12': ['zwolf', 'zwoelf']
      };
    }
    return {
      '0': ['zero'],
      '1': ['one', 'a', 'an'],
      '2': ['two', 'to', 'too'],
      '3': ['three'],
      '4': ['four', 'for'],
      '5': ['five'],
      '6': ['six'],
      '7': ['seven'],
      '8': ['eight', 'ate'],
      '9': ['nine'],
      '10': ['ten'],
      '11': ['eleven'],
      '12': ['twelve']
    };
  }

  private canonicalizeNumberTokens(text: string, lang: string): string {
    const normalized = this.normalizeSpeechText(text);
    if (!normalized) return '';
    const tokenMap = this.numberTokenVariantsMap(lang);
    const reverseMap: Record<string, string> = {};
    Object.entries(tokenMap).forEach(([digit, words]) => {
      reverseMap[digit] = digit;
      words.forEach((w) => { reverseMap[w] = digit; });
    });
    return normalized
      .split(' ')
      .map((tok) => reverseMap[tok] || tok)
      .join(' ')
      .trim();
  }

  private normalizeNumbersForDisplay(transcript: string, target: string, lang: string): string {
    const spoken = this.normalizeSpeechText(transcript);
    const tgt = this.normalizeSpeechText(target);
    if (!spoken) return '';
    if (!tgt) return transcript.trim();

    const tokenMap = this.numberTokenVariantsMap(lang);
    const reverseMap: Record<string, string> = {};
    Object.entries(tokenMap).forEach(([digit, words]) => {
      reverseMap[digit] = digit;
      words.forEach((w) => { reverseMap[w] = digit; });
    });

    const spokenTokens = spoken.split(' ');
    const targetTokens = tgt.split(' ');
    const out = [...spokenTokens];
    const n = Math.min(spokenTokens.length, targetTokens.length);
    for (let i = 0; i < n; i++) {
      const s = spokenTokens[i];
      const t = targetTokens[i];
      const sCanon = reverseMap[s] || s;
      const tCanon = reverseMap[t] || t;
      const targetIsWordNumber = !!reverseMap[t] && !/^\d+$/.test(t);
      if (sCanon === tCanon && targetIsWordNumber) {
        out[i] = t;
      }
    }
    return out.join(' ').trim();
  }

  private buildNumberAwareVariants(text: string, lang: string): string[] {
    const base = this.normalizeSpeechText(text);
    if (!base) return [''];
    const map = this.numberTokenVariantsMap(lang);
    const tokens = base.split(' ').filter(Boolean);
    let variants = new Set<string>([tokens.join(' ')]);

    tokens.forEach((tok, i) => {
      const next = new Set<string>();
      const direct = map[tok] || [];
      const reverse = Object.entries(map)
        .filter(([, words]) => words.includes(tok))
        .map(([digit]) => digit);
      const subs = [...direct, ...reverse];
      if (!subs.length) return;
      for (const phrase of variants) {
        next.add(phrase);
        const arr = phrase.split(' ');
        for (const sub of subs) {
          const updated = [...arr];
          updated[i] = sub;
          next.add(updated.join(' '));
        }
      }
      variants = next;
    });

    return [...variants].filter(Boolean);
  }

  private scoreTranscriptAgainstTarget(transcript: string, target: string): number {
    const a = this.normalizeSpeechText(transcript);
    const b = this.normalizeSpeechText(target);
    if (!a || !b) return 0;
    if (a === b) return 100;
    const aTokens = a.split(' ').filter(Boolean);
    const bTokens = b.split(' ').filter(Boolean);
    const aTokenSet = new Set(aTokens);
    const bTokenSet = new Set(bTokens);
    const overlap = [...aTokenSet].filter((t) => bTokenSet.has(t)).length;
    const recall = bTokenSet.size ? overlap / bTokenSet.size : 0; // How much of target was spoken.
    const precision = aTokenSet.size ? overlap / aTokenSet.size : 0; // How much spoken text matches target.
    const tokenF1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    if (a.includes(b) || b.includes(a)) {
      const coverage = Math.round((Math.min(a.length, b.length) / Math.max(a.length, b.length)) * 100);
      // Prevent inflated scores for short partial matches of long target sentences.
      return Math.round(coverage * (0.35 + 0.65 * recall));
    }
    const lev = Math.round(this.calculateStringSimilarity(a, b) * 100);
    const tokenScore = Math.round(tokenF1 * 100);
    const blended = Math.max(lev, tokenScore);
    // Strongly weight target coverage so 1/5 words cannot look "almost correct".
    return Math.round(blended * (0.3 + 0.7 * recall));
  }

  private getPronunciationScoreForTranscript(
    transcript: string,
    target: string,
    variants: string[],
    lang: string
  ): number {
    const allTargets = [target, ...(variants || [])]
      .map((t) => this.normalizeSpeechText(t))
      .filter(Boolean);
    if (!allTargets.length) return 0;

    let best = 0;
    for (const t of allTargets) {
      const expanded = this.buildNumberAwareVariants(t, lang);
      for (const candidate of expanded) {
        best = Math.max(best, this.scoreTranscriptAgainstTarget(transcript, candidate));
        // Treat numeric words/digits as equivalent before scoring.
        const canonTranscript = this.canonicalizeNumberTokens(transcript, lang);
        const canonCandidate = this.canonicalizeNumberTokens(candidate, lang);
        best = Math.max(best, this.scoreTranscriptAgainstTarget(canonTranscript, canonCandidate));
      }
    }
    return best;
  }

  private flattenSpeechResultCandidates(event: any): string[] {
    const out: string[] = [];
    const results = event?.results;
    if (!results) return out;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result) continue;
      const full = String(result[0]?.transcript || '').trim();
      if (full) out.push(full);
      for (let j = 0; j < result.length; j++) {
        const alt = String(result[j]?.transcript || '').trim();
        if (alt) out.push(alt);
      }
    }
    return [...new Set(out)];
  }

  private clearVpRecognitionForceStopTimer(): void {
    if (!this.vpRecognitionForceStopTimer) return;
    clearTimeout(this.vpRecognitionForceStopTimer);
    this.vpRecognitionForceStopTimer = null;
  }

  /**
   * Entry point for single-word pronunciation clips. Prefers the new
   * MediaRecorder + server-side Whisper flow and falls back to the legacy
   * in-browser SpeechRecognition path when the recorder is unavailable.
   */
  startRecording(pq: PlayerQuestion): void {
    if (this.audioRecorderSupported) {
      void this.startAudioPronunciationForWord(pq);
      return;
    }
    if (!this.speechSupported) {
      this.snackBar.open('Audio recording is not supported in this browser. Try Chrome, Edge, or Safari 14.3+.', 'Close', { duration: 6000 });
      pq.pronUiState = 'error';
      pq.pronMessage = 'Unsupported browser';
      return;
    }
    this.startRecordingLegacy(pq);
  }

  /** Legacy SpeechRecognition path for single-word pronunciation. */
  private startRecordingLegacy(pq: PlayerQuestion): void {
    if (pq.isRecording) return;
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    this.recognition = new SpeechRecognition();

    const langMap: Record<string, string> = { 'German': 'de-DE', 'English': 'en-US' };
    this.recognition.lang = langMap[this.exercise?.targetLanguage || 'German'] || 'de-DE';
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 3;

    pq.isRecording = true;
    pq.pronUiState = 'recording';
    pq.pronMessage = '🎤 Listening…';
    let bestTranscript = '';
    let bestScore = 0;
    let gotUsableResult = false;
    const lang = this.exercise?.targetLanguage === 'English' ? 'en-US' : 'de-DE';
    const target = String(pq.data.word || '');
    const variants = Array.isArray(pq.data.acceptedVariants) ? pq.data.acceptedVariants : [];

    this.recognition.onresult = (event: any) => {
      const candidates = this.flattenSpeechResultCandidates(event);
      for (const cand of candidates) {
        const candScore = this.getPronunciationScoreForTranscript(cand, target, variants, lang);
        if (candScore > bestScore) {
          bestScore = candScore;
          bestTranscript = cand;
        }
      }
      if (candidates.length > 0) {
        gotUsableResult = true;
        const previewTranscript = bestTranscript || candidates[0] || '';
        pq.spokenText = this.normalizeNumbersForDisplay(previewTranscript, target, lang) || previewTranscript;
      }
    };

    this.recognition.onerror = (event: any) => {
      pq.isRecording = false;
      this.recognition = null;
      if (event.error === 'not-allowed') {
        this.snackBar.open('Microphone access denied. Please allow microphone access.', 'Close', { duration: 5000 });
      }
      if (event.error === 'audio-capture') {
        this.snackBar.open('No microphone was detected on this device/browser.', 'Close', { duration: 4000 });
      }
    };

    this.recognition.onend = () => {
      pq.isRecording = false;
      this.recognition = null;
      if (!gotUsableResult) {
        pq.pronUiState = 'error';
        pq.pronMessage = 'No speech detected, try again';
        this.snackBar.open('No speech detected. Please try again.', 'Close', { duration: 3000 });
        return;
      }
      const rawTranscript = bestTranscript || pq.spokenText || '';
      pq.spokenText = this.normalizeNumbersForDisplay(rawTranscript, target, lang) || rawTranscript;
      pq.pronunciationScore = bestScore;
      pq.hasRecorded = true;
      pq.pronUiState = 'result';
      pq.pronMessage = null as unknown as string;
      this.markAttempted(pq);
    };

    this.recognition.start();
  }

  /**
   * Stop a single-word pronunciation recording. Delegates to the audio or
   * legacy flow automatically based on which one is active.
   */
  stopRecording(pq: PlayerQuestion): void {
    if (this.activePronQuestion === pq) {
      void this.finishAudioPronunciationForWord(pq);
      return;
    }
    if (this.recognition) {
      try { this.recognition.stop(); } catch { /* noop */ }
    }
  }

  resetPronunciation(pq: PlayerQuestion): void {
    pq.spokenText = '';
    pq.pronunciationScore = 0;
    pq.hasRecorded = false;
  }

  playAudio(url: string): void {
    if (!url) return;
    this.stopCurrentAudio();
    const audio = new Audio(url);
    this.currentlyPlayingAudio = audio;
    audio.play().catch(() => {
      this.currentlyPlayingAudio = null;
    });
    audio.addEventListener('ended', () => {
      this.currentlyPlayingAudio = null;
    });
  }

  speakWordTTS(text: string): void {
    if (!text) return;
    if (!('speechSynthesis' in window)) {
      this.snackBar.open('Text-to-speech is not supported in this browser.', 'Close', { duration: 3000 });
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const langMap: Record<string, string> = { 'German': 'de-DE', 'English': 'en-US' };
    utterance.lang = langMap[this.exercise?.targetLanguage || 'German'] || 'de-DE';
    utterance.rate = 0.85;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  playWordAudio(pq: PlayerQuestion): void {
    if (pq.data.audioUrl) {
      this.playAudio(this.getMediaFullUrl(pq.data.audioUrl));
    } else {
      this.speakWordTTS(pq.data.word || '');
    }
  }

  getPronunciationClass(score: number): string {
    if (score >= 80) return 'pronunciation-excellent';
    if (score >= 60) return 'pronunciation-good';
    return 'pronunciation-poor';
  }

  getPronunciationFeedback(score: number): string {
    if (score >= 90) return 'Excellent pronunciation!';
    if (score >= 70) return 'Good job! Almost perfect.';
    if (score >= 50) return 'Keep practicing.';
    return 'Try again — listen to the correct pronunciation first.';
  }

  private calculateStringSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;
    return (longer.length - this.editDistance(longer, shorter)) / longer.length;
  }

  private editDistance(a: string, b: string): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
    );
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[a.length][b.length];
  }

  // ─── Submit (per-question) ──────────────────────────────────────────────────────

  submitCurrentQuestion(): void {
    if (this.submitting) return;

    const pq = this.currentQuestion;
    if (!this.isQuestionAnswered(pq)) {
      this.snackBar.open('Please answer the question before submitting.', 'Close', { duration: 3000 });
      return;
    }

    this.submitting = true;
    this.syncElapsedSeconds();

    const resp = this.buildQuestionResponseForIndex(this.currentIndex);
    if (!resp) {
      this.submitting = false;
      this.snackBar.open('Please answer the question before submitting.', 'Close', { duration: 3000 });
      return;
    }

    this.exerciseService.submitQuestion(
      this.exerciseId,
      this.attemptId,
      this.currentIndex,
      resp,
      this.elapsedSeconds
    ).subscribe({
      next: (res) => {
        this.applyPerQuestionSubmitResult(pq, res);
        this.submitting = false;
        if (!res.allSubmitted) {
          this.scheduleDraftSave();
        }
      },
      error: (err) => {
        this.submitting = false;
        const hadOptimistic = this.vpOptimisticCompletion;
        if (hadOptimistic) {
          this.vpOptimisticCompletion = false;
          this.result = null;
          this.state = 'playing';
          const pq = this.currentQuestion;
          if (pq && pq.data?.type === 'video-pronunciation') {
            pq.isCorrect = undefined;
            pq.vpSpokenText = '';
            pq.vpResult = 'idle';
            pq.hasRecorded = false;
            pq.pronunciationScore = 0;
            pq.isAnswered = false;
            this.replayVpVideo();
          }
          this.resumeVpTimer();
        }
        const msg = err?.error?.error || err?.message || 'Failed to submit. Please try again.';
        this.snackBar.open(msg, 'Close', { duration: 5000 });
        if (!hadOptimistic && (err?.status === 404 || err?.status === 500)) {
          this.fallbackToFullSubmit();
        }
      }
    });
  }

  /** Backward-compatible alias used by older template fragments. */
  submitExercise(): void {
    this.submitCurrentQuestion();
  }

  openFinishSummary(): void {
    this.showFinishSummary = true;
  }

  cancelFinishSummary(): void {
    this.showFinishSummary = false;
  }

  confirmFinishSubmit(): void {
    if (this.finishingAll) return;
    this.finishingAll = true;
    this.showFinishSummary = false;
    this.stopTimer();
    this.syncElapsedSeconds();

    const responses = this.buildAllResponses();
    this.exerciseService.submitAttempt(this.exerciseId, this.attemptId, responses, this.elapsedSeconds).subscribe({
      next: (result) => {
        this.result = result;
        this.finishingAll = false;
        this.applyResultFeedback(result);
        this.state = 'submitted';
        this.clearExerciseDraftStorage();
      },
      error: (e) => {
        this.finishingAll = false;
        this.snackBar.open(e?.error?.error || 'Failed to submit.', 'Close', { duration: 5000 });
      }
    });
  }

  private buildAllResponses(): QuestionResponse[] {
    return this.playerQuestions.map((pq, i) => {
      const resp: QuestionResponse = { questionIndex: i };
      if (pq.data.type === 'mcq') resp.selectedOptionIndex = pq.selectedOption;
      else if (pq.data.type === 'matching') {
        resp.matchingResponse = (pq.matchingLeft || []).map((l, li) => {
          const rightIndex = l.matchedRightIndex ?? -1;
          const rightValue =
            rightIndex >= 0 && pq.matchingRight && rightIndex < pq.matchingRight.length
              ? pq.matchingRight[rightIndex].value
              : null;
          return { leftIndex: li, rightIndex, rightValue };
        });
      } else if (pq.data.type === 'fill-blank') resp.fillBlankResponses = pq.fillAnswers || [];
      else if ((pq.data.type as string) === 'word_bank_fill') {
        resp.wordBankAnswers = (pq.wordBankAnswers || []).map((x) => ({
          index: Number(x?.index) || 0,
          value: String(x?.value ?? '')
        }));
      }
      else if (pq.data.type === 'singular_plural') {
        const n = (pq.data.pairs || []).filter((p: any) => String(p?.singular || '').trim()).length;
        const raw = pq.singularPluralInputs || [];
        resp.singularPluralResponses = Array.from({ length: n }, (_, j) => String(raw[j] ?? ''));
      } else if (pq.data.type === 'pronunciation') {
        resp.spokenText = pq.spokenText || '';
        resp.pronunciationScore = pq.pronunciationScore || 0;
      }       else if (pq.data.type === 'question-answer') resp.qaResponse = pq.qaResponse || '';
      else if (pq.data.type === 'listening') resp.listeningText = pq.listeningText || '';
      else if ((pq.data.type as string) === 'jumble-word') resp.jumbleWordResponse = pq.jumbleWordResponse || '';
      else if ((pq.data.type as string) === 'rearrange') {
        resp.rearrangeTokensResponse = Array.isArray(pq.rearrangeTokens) ? pq.rearrangeTokens : [];
        resp.rearrangeTextResponse = Array.isArray(pq.rearrangeTokens) ? pq.rearrangeTokens.join(' ') : '';
      } else if ((pq.data.type as string) === 'image_pin_match') {
        resp.imagePinAnswers = Array.isArray(pq.imagePinConnections)
          ? pq.imagePinConnections.map((x) => ({ labelId: x.labelId, pinId: x.pinId }))
          : [];
      }
      else if (pq.data.type === 'video-pronunciation') {
        resp.spokenText = pq.vpSpokenText || '';
        resp.pronunciationScore = pq.pronunciationScore || 0;
      }
      const subResponses = this.buildSubQuestionResponses(pq);
      if (subResponses) resp.subQuestionResponses = subResponses;
      return resp;
    });
  }

  private buildFeedbackFromCorrectAnswer(q: any, correctAnswer: any, pq: PlayerQuestion): string {
    if (!correctAnswer) return '';
    if (q.type === 'mcq' && correctAnswer.explanation) return correctAnswer.explanation;
    if (q.type === 'fill-blank' && correctAnswer.answers) {
      return 'Correct answers: ' + correctAnswer.answers.join(', ');
    }
    if ((q.type as string) === 'word_bank_fill' && Array.isArray(correctAnswer.items)) {
      const parts = correctAnswer.items.map((x: any) => {
        const alts = Array.isArray(x?.acceptedAnswers) ? x.acceptedAnswers.filter(Boolean) : [];
        if (!x?.answer) return '';
        return alts.length ? `${x.answer} (${alts.join(' / ')})` : x.answer;
      }).filter(Boolean);
      return parts.length ? 'Correct answers: ' + parts.join(', ') : '';
    }
    if (q.type === 'singular_plural' && Array.isArray(correctAnswer.plurals)) {
      return 'Correct plurals: ' + correctAnswer.plurals.join(', ');
    }
    if ((q.type as string) === 'jumble-word' && correctAnswer.expectedWord) {
      return 'Correct word: ' + correctAnswer.expectedWord;
    }
    return '';
  }

  private fallbackToFullSubmit(): void {
    const responses: QuestionResponse[] = this.playerQuestions.map((pq, i) => {
      const resp: QuestionResponse = { questionIndex: i };
      if (pq.data.type === 'mcq') resp.selectedOptionIndex = pq.selectedOption;
      else if (pq.data.type === 'matching') {
        resp.matchingResponse = (pq.matchingLeft || []).map((l, li) => {
          const rightIndex = l.matchedRightIndex ?? -1;
          const rightValue =
            rightIndex >= 0 && pq.matchingRight && rightIndex < pq.matchingRight.length
              ? pq.matchingRight[rightIndex].value
              : null;
          return { leftIndex: li, rightIndex, rightValue };
        });
      } else if (pq.data.type === 'fill-blank') resp.fillBlankResponses = pq.fillAnswers || [];
      else if ((pq.data.type as string) === 'word_bank_fill') {
        resp.wordBankAnswers = (pq.wordBankAnswers || []).map((x) => ({
          index: Number(x?.index) || 0,
          value: String(x?.value ?? '')
        }));
      }
      else if (pq.data.type === 'singular_plural') {
        const n = (pq.data.pairs || []).filter((p: any) => String(p?.singular || '').trim()).length;
        const raw = pq.singularPluralInputs || [];
        resp.singularPluralResponses = Array.from({ length: n }, (_, j) => String(raw[j] ?? ''));
      } else if (pq.data.type === 'pronunciation') {
        resp.spokenText = pq.spokenText || '';
        resp.pronunciationScore = pq.pronunciationScore || 0;
      }       else if (pq.data.type === 'question-answer') resp.qaResponse = pq.qaResponse || '';
      else if (pq.data.type === 'listening') resp.listeningText = pq.listeningText || '';
      else if ((pq.data.type as string) === 'jumble-word') resp.jumbleWordResponse = pq.jumbleWordResponse || '';
      else if ((pq.data.type as string) === 'rearrange') {
        resp.rearrangeTokensResponse = Array.isArray(pq.rearrangeTokens) ? pq.rearrangeTokens : [];
        resp.rearrangeTextResponse = Array.isArray(pq.rearrangeTokens) ? pq.rearrangeTokens.join(' ') : '';
      } else if ((pq.data.type as string) === 'image_pin_match') {
        resp.imagePinAnswers = Array.isArray(pq.imagePinConnections)
          ? pq.imagePinConnections.map((x) => ({ labelId: x.labelId, pinId: x.pinId }))
          : [];
      }
      else if (pq.data.type === 'video-pronunciation') {
        resp.spokenText = pq.vpSpokenText || '';
        resp.pronunciationScore = pq.pronunciationScore || 0;
      }
      const subResponses = this.buildSubQuestionResponses(pq);
      if (subResponses) resp.subQuestionResponses = subResponses;
      return resp;
    });
    this.submitting = true;
    this.stopTimer();
    this.exerciseService.submitAttempt(this.exerciseId, this.attemptId, responses, this.elapsedSeconds).subscribe({
      next: (result) => {
        this.result = result;
        this.submitting = false;
        this.applyResultFeedback(result);
        this.state = 'submitted';
        this.clearExerciseDraftStorage();
      },
      error: (e) => {
        this.submitting = false;
        this.snackBar.open(e?.error?.error || 'Failed to submit.', 'Close', { duration: 5000 });
      }
    });
  }

  private applyResultFeedback(result: SubmitResult): void {
    if (!result.answerDetails) return;
    result.answerDetails.forEach(detail => {
      const pq = this.playerQuestions[detail.questionIndex];
      if (pq) {
        const watchOnlyClipCompleted =
          this.watchOnlyMode && pq.data?.type === 'video-pronunciation' && pq.isAnswered;
        pq.isCorrect = watchOnlyClipCompleted ? true : detail.isCorrect;
        if (watchOnlyClipCompleted) {
          pq.vpResult = 'correct';
        }
        pq.feedback = this.buildFeedback(pq.data, detail.correctAnswer, pq);
        // Store correct answers for display
        if (pq.data.type === 'fill-blank' && detail.correctAnswer?.answers) {
          pq.data._correctAnswers = detail.correctAnswer.answers;
        }
        this.applySubQuestionGradingFromCorrectAnswer(pq, detail.correctAnswer);
        if (pq.data.type === 'fill-blank' && !pq.data._correctAnswers?.length && pq.data.answers?.length) {
          pq.data._correctAnswers = pq.data.answers;
        }
        if (pq.data.subQuestions?.length) {
          pq.data.subQuestions.forEach((sq: any) => {
            if (sq.type === 'fill-blank' && !sq._correctAnswers?.length && sq.answers?.length) {
              sq._correctAnswers = sq.answers;
            }
          });
        }
        if ((pq.data.type as string) === 'word_bank_fill' && Array.isArray(detail.correctAnswer?.items)) {
          pq.data._wordBankCorrectItems = detail.correctAnswer.items;
        }
        if (pq.data.type === 'mcq' && detail.correctAnswer?.correctAnswerIndex !== undefined) {
          pq.data.correctAnswerIndex = detail.correctAnswer.correctAnswerIndex;
        }
        if (pq.data.type === 'matching' && detail.correctAnswer?.pairs) {
          pq.data._correctPairs = detail.correctAnswer.pairs;
        }
        if (pq.data.type === 'singular_plural' && Array.isArray(detail.correctAnswer?.plurals)) {
          pq.data._correctPlurals = detail.correctAnswer.plurals;
        }
        if ((pq.data.type as string) === 'rearrange') {
          pq.data._correctRearrangeTokens = Array.isArray(detail.correctAnswer?.rearrangeTokens)
            ? detail.correctAnswer.rearrangeTokens
            : [];
          pq.data._correctRearrangeAnswer = detail.correctAnswer?.rearrangeAnswer || '';
        }
        if ((pq.data.type as string) === 'image_pin_match') {
          pq.data._imagePinCorrectLabels = Array.isArray(detail.correctAnswer?.labels)
            ? detail.correctAnswer.labels
            : [];
          pq.data._imagePinCorrectPins = Array.isArray(detail.correctAnswer?.pins)
            ? detail.correctAnswer.pins
            : [];
        }
      }
    });
  }

  private buildFeedback(q: any, correctAnswer: any, pq: PlayerQuestion): string {
    if (!correctAnswer) return '';
    if (q.type === 'mcq' && correctAnswer.explanation) return correctAnswer.explanation;
    if (q.type === 'fill-blank' && correctAnswer.answers) {
      return 'Correct answers: ' + correctAnswer.answers.join(', ');
    }
    if ((q.type as string) === 'word_bank_fill' && Array.isArray(correctAnswer.items)) {
      const parts = correctAnswer.items.map((x: any) => {
        const alts = Array.isArray(x?.acceptedAnswers) ? x.acceptedAnswers.filter(Boolean) : [];
        if (!x?.answer) return '';
        return alts.length ? `${x.answer} (${alts.join(' / ')})` : x.answer;
      }).filter(Boolean);
      return parts.length ? 'Correct answers: ' + parts.join(', ') : '';
    }
    if (q.type === 'singular_plural' && Array.isArray(correctAnswer.plurals)) {
      return 'Correct plurals: ' + correctAnswer.plurals.join(', ');
    }
    if ((q.type as string) === 'jumble-word' && correctAnswer.expectedWord) {
      return 'Correct word: ' + correctAnswer.expectedWord;
    }
    return '';
  }

  // ─── Timer ────────────────────────────────────────────────────────────────────

  private syncElapsedSeconds(): void {
    const raw = Math.floor((Date.now() - this.startTime) / 1000);
    this.elapsedSeconds = Math.min(
      Math.max(0, raw),
      DigitalExercisePlayerComponent.MAX_REPORTED_ELAPSED_SECONDS,
    );
  }

  private startTimer(): void {
    this.startTime = Date.now();
    this.timerInterval = setInterval(() => {
      this.syncElapsedSeconds();
      this.maybeAutoSubmitVideoOnlyOnDeadline();
    }, 1000);
  }

  /** When the allotted time is over, submit the full attempt (video-only). */
  private maybeAutoSubmitVideoOnlyOnDeadline(): void {
    if (!this.isVideoOnlyExercise || this.state !== 'playing' || this.vpTimeUpHandled) return;
    if (this.elapsedSeconds < this.vpSessionBudgetSeconds) return;
    if (this.submitting || this.finishingAll) return;
    this.vpTimeUpHandled = true;
    this.snackBar.open("Time's up — submitting your exercise.", 'Close', { duration: 5000 });
    this.confirmFinishSubmit();
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
      this.syncElapsedSeconds();
    }
  }

  formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  goBack(): void {
    this.location.back();
  }

  backToExercises(): void {
    this.authService.currentUser$.pipe(take(1)).subscribe((user) => {
      if (user?.role === 'STUDENT') {
        this.router.navigate(['/student/my-course'], { queryParams: { tab: 'exercises' } });
      } else {
        this.router.navigate(['/digital-exercises']);
      }
    });
  }

  tryAgain(): void {
    this.clearExerciseDraftStorage();
    this.result = null;
    this.initPlayerQuestions();
    this.currentIndex = 0;
    this.startExercise();
  }

  showReviewAnswers(): void {
    this.state = 'review';
  }

  backToResult(): void {
    this.state = 'submitted';
  }

  /** For review page: get user's answer summary text for any question type */
  getReviewAnswerText(pq: PlayerQuestion): string {
    if (pq.data.type === 'mcq') {
      const idx = pq.selectedOption ?? -1;
      const opts = pq.data.options || [];
      return idx >= 0 && idx < opts.length ? opts[idx] : '—';
    }
    if (pq.data.type === 'matching') {
      const pairs = (pq.matchingLeft || [])
        .filter(l => l.matchedRightIndex != null)
        .map(l => `${l.value} → ${pq.matchingRight![l.matchedRightIndex!].value}`);
      return pairs.length ? pairs.join('; ') : '—';
    }
    if (pq.data.type === 'fill-blank') {
      const parts = (pq.fillAnswers || []).filter(a => a != null && a !== '');
      return parts.length ? parts.join(', ') : '—';
    }
    if ((pq.data.type as string) === 'word_bank_fill') {
      const rows = Array.isArray(pq.data.items) ? pq.data.items : [];
      const answers = Array.isArray(pq.wordBankAnswers) ? pq.wordBankAnswers : [];
      if (!rows.length) return '—';
      return rows
        .map((item: any, i: number) => `${item?.prompt || `Item ${i + 1}`} -> ${String(answers[i]?.value || '').trim() || '—'}`)
        .join('; ');
    }
    if (pq.data.type === 'singular_plural') {
      const rows = (pq.data.pairs || []).filter((p: any) => String(p?.singular || '').trim());
      const inputs = pq.singularPluralInputs || [];
      if (!rows.length) return '—';
      return rows
        .map((p: any, i: number) => `${p.singular} → ${String(inputs[i] ?? '').trim() || '—'}`)
        .join('; ');
    }
    if (pq.data.type === 'pronunciation') return (pq.spokenText || '—').trim();
    if (pq.data.type === 'question-answer') {
      if (this.isTrueFalseQuestion(pq.data)) {
        const parsed = this.parseTrueFalse(pq.qaResponse);
        return parsed === true ? 'Richtig' : parsed === false ? 'Falsch' : '—';
      }
      return (pq.qaResponse || '—').trim();
    }
    if (pq.data.type === 'listening') return (pq.listeningText || '—').trim();
    if ((pq.data.type as string) === 'jumble-word') return (pq.jumbleWordResponse || '—').trim();
    if ((pq.data.type as string) === 'rearrange') {
      const toks = Array.isArray(pq.rearrangeTokens) ? pq.rearrangeTokens : [];
      return toks.length ? toks.join(' ') : '—';
    }
    if ((pq.data.type as string) === 'image_pin_match') {
      const labels = Array.isArray(pq.data.labels) ? pq.data.labels : [];
      const byLabel: Record<string, string> = {};
      (pq.imagePinConnections || []).forEach((c) => { byLabel[c.labelId] = c.pinId; });
      const pins = this.getImagePinPins(pq.data);
      const pinNum = (id: string) => {
        const idx = pins.findIndex((p: any) => String(p?.id || '') === String(id || ''));
        return idx >= 0 ? `Pin ${idx + 1}` : '—';
      };
      return labels
        .map((l: any) => `${l?.text || l?.id || 'label'} -> ${pinNum(byLabel[String(l?.id || '')] || '')}`)
        .join('; ');
    }
    if (pq.data.type === 'video-pronunciation') return (pq.vpSpokenText || '—').trim();
    return '—';
  }

  /** For review page: get correct answer summary for any question type */
  getReviewCorrectText(pq: PlayerQuestion): string {
    if (pq.data.type === 'mcq') {
      const idx = pq.data.correctAnswerIndex ?? 0;
      const opts = pq.data.options || [];
      return idx < opts.length ? opts[idx] : '—';
    }
    if (pq.data.type === 'matching') {
      // In student view, `pairs.right` is stripped from the API response.
      // We store correct pairs as `_correctPairs` during grading.
      const correctPairs = pq.data._correctPairs || [];
      const leftItems = pq.matchingLeft || [];
      const pairs = leftItems.map((l: any, li: number) => {
        const found = Array.isArray(correctPairs) ? correctPairs.find((cp: any) => cp.leftIndex === li) : null;
        const rv = found?.rightValue;
        return rv != null && rv !== '' ? `${l.value} → ${rv}` : `${l.value} → undefined`;
      });
      return pairs.length ? pairs.join('; ') : '—';
    }
    if (pq.data.type === 'fill-blank') {
      const ans = (pq.data._correctAnswers || pq.data.answers || []).join(', ');
      return ans || '—';
    }
    if ((pq.data.type as string) === 'word_bank_fill') {
      const rows = Array.isArray(pq.data._wordBankCorrectItems) ? pq.data._wordBankCorrectItems : [];
      return rows.length
        ? rows
            .map((x: any, i: number) => {
              const alts = Array.isArray(x?.acceptedAnswers) ? x.acceptedAnswers.filter(Boolean) : [];
              const altStr = alts.length ? ` (also: ${alts.join(', ')})` : '';
              return `${x?.prompt || `Item ${i + 1}`} -> ${x?.answer || '—'}${altStr}`;
            })
            .join('; ')
        : '—';
    }
    if (pq.data.type === 'singular_plural') {
      const rows = (pq.data.pairs || []).filter((p: any) => String(p?.singular || '').trim());
      const plurals = pq.data._correctPlurals || [];
      if (!rows.length) return '—';
      return rows.map((p: any, i: number) => `${p.singular} → ${plurals[i] ?? '—'}`).join('; ');
    }
    if (pq.data.type === 'question-answer') {
      if (this.isTrueFalseQuestion(pq.data)) {
        const samples: string[] = pq.data.sampleAnswers || [];
        const parsed = samples.map(s => this.parseTrueFalseStrictSample(s)).find(v => v === true || v === false);
        if (parsed === true) return 'Richtig';
        if (parsed === false) return 'Falsch';
        return samples.length ? samples.join('; ') : '—';
      }
      const samples = pq.data.sampleAnswers || [];
      return samples.length ? samples.join('; ') : '(AI graded)';
    }
    if (pq.data.type === 'listening') return pq.data.expectedTranscript || '—';
    if ((pq.data.type as string) === 'jumble-word') return (pq.data as any).expectedWord || '—';
    if ((pq.data.type as string) === 'rearrange') {
      const toks = Array.isArray((pq.data as any)._correctRearrangeTokens)
        ? (pq.data as any)._correctRearrangeTokens
        : [];
      if (toks.length) return toks.join(' ');
      return (pq.data as any)._correctRearrangeAnswer || '—';
    }
    if ((pq.data.type as string) === 'image_pin_match') {
      const labels = Array.isArray((pq.data as any)._imagePinCorrectLabels)
        ? (pq.data as any)._imagePinCorrectLabels
        : (Array.isArray((pq.data as any).labels) ? (pq.data as any).labels : []);
      const pins = Array.isArray((pq.data as any)._imagePinCorrectPins)
        ? (pq.data as any)._imagePinCorrectPins
        : (Array.isArray((pq.data as any).pins) ? (pq.data as any).pins : []);
      const pinNum = (id: string) => {
        const idx = pins.findIndex((p: any) => String(p?.id || '') === String(id || ''));
        return idx >= 0 ? `Pin ${idx + 1}` : '—';
      };
      return labels.map((l: any) => `${l?.text || l?.id || 'label'} -> ${pinNum(l?.correctPinId || '')}`).join('; ');
    }
    if (pq.data.type === 'pronunciation') return pq.data.word || '—';
    if (pq.data.type === 'video-pronunciation') {
      const first = String(pq.data.caption || '').trim();
      const second = String(pq.data.secondaryCaption || '').trim();
      if (first && second) {
        const after = this.secondaryCaptionDelaySecondsForQuestion(pq.data);
        return `${first} / after ${after}s: ${second}`;
      }
      return first || '—';
    }
    return '—';
  }

  /** For review page: get sub-question answer text */
  getSubQuestionAnswerText(pq: PlayerQuestion, sqIndex: number): string {
    const sq = pq.data.subQuestions?.[sqIndex];
    if (sq?.type === 'fill-blank') {
      const blanks = pq.subQuestionFillBlankAnswers?.[sqIndex] || [];
      const filled = blanks.map((x) => String(x ?? '').trim()).filter(Boolean);
      return filled.length ? filled.join(' / ') : 'Not answered';
    }
    const answer = pq.subQuestionAnswers?.[sqIndex];
    if (answer === undefined || answer === null) return 'Not answered';
    if (typeof answer === 'number') {
      if (sq && sq.type === 'mcq' && sq.options) {
        return sq.options[answer] || String(answer);
      }
      return String(answer);
    }
    if (sq?.type === 'question-answer' && this.isTrueFalseQuestion(sq)) {
      const parsed = this.parseTrueFalse(answer);
      return parsed === true ? 'Richtig' : parsed === false ? 'Falsch' : String(answer);
    }
    return String(answer);
  }

  getJumbleTokens(data: any): string[] {
    const text = String(data?.scrambledText || '');
    return text.split('').filter((c) => c !== '');
  }

  getFirstBoldIndex(data: any): number {
    const tokens = this.getJumbleTokens(data);
    const bold = String(data?.boldLetter || '');
    if (!bold) return -1;
    return tokens.findIndex((t) => t === bold);
  }

  isJumbleTokenUsed(pq: PlayerQuestion | null | undefined, tokenIndex: number): boolean {
    return !!pq?.jumbleUsedTokenIndices?.includes(tokenIndex);
  }

  private reconcileJumbleUsedTokenIndices(data: any, previousIndices: number[] | undefined, response: string): number[] {
    const tokens = this.getJumbleTokens(data);
    const previous = Array.isArray(previousIndices) ? previousIndices : [];
    const selected: number[] = [];
    const used = new Set<number>();
    const responseChars = String(response || '').split('').filter((char) => char !== ' ');

    for (const char of responseChars) {
      const normalizedChar = char.toLocaleLowerCase();
      const previousMatch = previous.find((index) => {
        return !used.has(index) && String(tokens[index] || '').toLocaleLowerCase() === normalizedChar;
      });
      const tokenIndex = previousMatch ?? tokens.findIndex((token, index) => {
        return !used.has(index) && String(token || '').toLocaleLowerCase() === normalizedChar;
      });
      if (tokenIndex >= 0) {
        used.add(tokenIndex);
        selected.push(tokenIndex);
      }
    }

    return selected;
  }

  parseTrueFalse(raw: any): boolean | null {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return null;
    // Common values from UI (true/false), admin/manual, and worksheet generator (richtig/falsch).
    if (/\b(true|richtig|wahr|ja|yes)\b/.test(s)) return true;
    if (/\b(false|falsch|unwahr|nein|no|incorrect)\b/.test(s)) return false;
    return null;
  }

  /**
   * True/false **sample answer** only: whole string must be a single canonical token.
   * Avoids treating free-text German answers like "Nein, sie ist …" as T/F because of `\bnein\b`.
   */
  parseTrueFalseStrictSample(raw: any): boolean | null {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return null;
    if (/^(true|richtig|wahr|ja|yes|j|t|1)\.?$/i.test(s)) return true;
    if (/^(false|falsch|unwahr|nein|no|n|f|0)\.?$/i.test(s)) return false;
    return null;
  }

  /** Detect True/False worksheet even if worksheetKind is missing (old exercises). */
  isTrueFalseQuestion(data: any): boolean {
    if (!data || data.type !== 'question-answer') return false;
    if (data.worksheetKind === 'true-false') return true;
    // Any explicit non–true/false worksheet kind (e.g. free-writing) must stay typed Q&A.
    if (data.worksheetKind && data.worksheetKind !== 'true-false') return false;
    const samples: any[] = Array.isArray(data.sampleAnswers) ? data.sampleAnswers : [];
    return samples.some(s => this.parseTrueFalseStrictSample(s) !== null);
  }

  /** Check if a question is a batch type (fill-blank or true-false) */
  isBatchQuestionType(data: any): boolean {
    if (!data) return false;
    if (data.type === 'fill-blank') return true;
    if (data.type === 'question-answer' && this.isTrueFalseQuestion(data)) return true;
    return false;
  }

  /** Get all batch questions (fill-blank and true-false) */
  get batchQuestions(): any[] {
    return this.playerQuestions.filter(pq => this.isBatchQuestionType(pq.data));
  }

  /** Get the indices of batch questions in the main playerQuestions array */
  get batchQuestionIndices(): number[] {
    return this.playerQuestions
      .map((pq, index) => ({ pq, index }))
      .filter(item => this.isBatchQuestionType(item.pq.data))
      .map(item => item.index);
  }

  /** Check if current view should show batch mode (batch questions are present) */
  get hasBatchQuestions(): boolean {
    return this.batchQuestions.length > 0;
  }

  /** Check if we are currently viewing a batch question */
  get isInBatchMode(): boolean {
    return this.hasBatchQuestions && this.batchQuestionIndices.includes(this.currentIndex);
  }

  /** Get the batch title based on question types */
  get batchTitle(): string {
    const hasFillBlank = this.batchQuestions.some(bq => bq.data.type === 'fill-blank');
    const hasTrueFalse = this.batchQuestions.some(bq => bq.data.type === 'question-answer' && this.isTrueFalseQuestion(bq.data));
    
    if (hasFillBlank && hasTrueFalse) {
      return 'Fill in the blanks & True/False';
    } else if (hasFillBlank) {
      return 'Fill in the blanks';
    } else if (hasTrueFalse) {
      return 'True/False';
    }
    return 'Questions';
  }

  /** Get the batch question at a specific offset from current batch start */
  getBatchQuestionAtOffset(offset: number): any | null {
    const batchIndices = this.batchQuestionIndices;
    if (batchIndices.length === 0) return null;
    const currentBatchIndex = batchIndices.indexOf(this.currentIndex);
    if (currentBatchIndex === -1) return null;
    const targetBatchIndex = currentBatchIndex + offset;
    if (targetBatchIndex < 0 || targetBatchIndex >= batchIndices.length) return null;
    const targetQuestionIndex = batchIndices[targetBatchIndex];
    return this.playerQuestions[targetQuestionIndex];
  }

  /** Get the player question at a specific batch index (0-based) */
  getPlayerQuestionAtBatchIndex(batchIdx: number): any | null {
    if (batchIdx < 0 || batchIdx >= this.batchQuestionIndices.length) return null;
    const questionIndex = this.batchQuestionIndices[batchIdx];
    return this.playerQuestions[questionIndex];
  }

  /** Get the actual question index in playerQuestions for a batch index */
  getActualQuestionIndex(batchIdx: number): number {
    if (batchIdx < 0 || batchIdx >= this.batchQuestionIndices.length) return -1;
    return this.batchQuestionIndices[batchIdx];
  }

  /** Check if there's a next batch question */
  get hasNextBatchQuestion(): boolean {
    const batchIndices = this.batchQuestionIndices;
    const currentBatchIndex = batchIndices.indexOf(this.currentIndex);
    return currentBatchIndex !== -1 && currentBatchIndex < batchIndices.length - 1;
  }

  /** Check if there's a previous batch question */
  get hasPrevBatchQuestion(): boolean {
    const batchIndices = this.batchQuestionIndices;
    const currentBatchIndex = batchIndices.indexOf(this.currentIndex);
    return currentBatchIndex > 0;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  getProgressPercentage(): number {
    if (this.playerQuestions.length === 0) return 0;
    return Math.round((this.answeredCount / this.playerQuestions.length) * 100);
  }

  readonly progressRingR = 15.9155;
  get progressRingCircumference(): number {
    return 2 * Math.PI * this.progressRingR;
  }
  get progressRingOffset(): number {
    return this.progressRingCircumference * (1 - this.getProgressPercentage() / 100);
  }

  getScoreClass(score: number): string {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    return 'poor';
  }

  getScoreMessage(score: number): string {
    if (score >= 90) return 'Outstanding! 🎉';
    if (score >= 80) return 'Excellent work! ⭐';
    if (score >= 70) return 'Great job! 👍';
    if (score >= 60) return 'Good effort! Keep going!';
    if (score >= 40) return 'Keep practicing!';
    return 'Don\'t give up — try again!';
  }

  getSentenceParts(sentence: string): string[] {
    return splitByWords(sentence || '');
  }

  getWordBankItems(pq: PlayerQuestion): Array<{ prompt: string }> {
    return Array.isArray(pq?.data?.items) ? pq.data.items : [];
  }

  displayWordBankPrompt(item: any, index: number): string {
    if (item && typeof item === 'object' && item.prompt != null) {
      return String(item.prompt || '');
    }
    const raw = String(item ?? '').trim();
    if (!raw) return `Item ${index + 1}`;

    // Handle malformed serialized rows shown as text: {"prompt":"...","answer":"..."}
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.prompt != null) {
        return String(parsed.prompt || '').trim();
      }
    } catch {
      // keep fallback logic
    }

    const promptMatch = raw.match(/"prompt"\s*:\s*"([^"]+)"/i);
    if (promptMatch?.[1]) return promptMatch[1];
    return raw;
  }

  isWordBankReusable(pq: PlayerQuestion): boolean {
    return pq?.data?.reusableWords !== false;
  }

  isWordAlreadyUsed(pq: PlayerQuestion, word: string, exceptIndex: number | null = null): boolean {
    const target = String(word ?? '').trim().toLowerCase();
    if (!target) return false;
    return (pq.wordBankAnswers || []).some((entry, i) => {
      if (exceptIndex !== null && i === exceptIndex) return false;
      return String(entry?.value ?? '').trim().toLowerCase() === target;
    });
  }

  canUseWordForBlank(pq: PlayerQuestion, word: string, blankIndex: number): boolean {
    if (this.isWordBankReusable(pq)) return true;
    return !this.isWordAlreadyUsed(pq, word, blankIndex);
  }

  private applyWordToWordBankBlank(pq: PlayerQuestion, index: number, word: string): void {
    if (!pq || this.state === 'submitted') return;
    const rows = this.getWordBankItems(pq);
    if (!rows.length || index < 0 || index >= rows.length) return;
    if (!this.canUseWordForBlank(pq, word, index)) return;
    this.onWordBankAnswerChange(pq, index, word);
    pq.activeBlankIndex = index;
  }

  onWordBankBlankFocus(pq: PlayerQuestion, index: number): void {
    pq.activeBlankIndex = index;
    this.setActiveSpecialInputTarget({ type: 'word-bank-fill', blankIndex: index });
  }

  onWordBankAnswerChange(pq: PlayerQuestion, index: number, value: string): void {
    if (!Array.isArray(pq.wordBankAnswers)) return;
    pq.wordBankAnswers[index] = { index, value: String(value ?? '') };
    this.markAttempted(pq);
  }

  fillActiveWordBankBlank(pq: PlayerQuestion, word: string): void {
    if (!pq || this.state === 'submitted') return;
    const rows = this.getWordBankItems(pq);
    if (!rows.length) return;
    let idx = Number(pq.activeBlankIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= rows.length) idx = 0;
    this.applyWordToWordBankBlank(pq, idx, word);
  }

  clearWordBankAnswer(pq: PlayerQuestion, index: number): void {
    this.onWordBankAnswerChange(pq, index, '');
    pq.activeBlankIndex = index;
  }

  onWordBankDrop(pq: PlayerQuestion, blankIndex: number, event: CdkDragDrop<any>): void {
    const droppedWord = String(event?.item?.data ?? '').trim();
    if (!droppedWord) return;
    this.applyWordToWordBankBlank(pq, blankIndex, droppedWord);
  }

  /** Rows with non-empty singular text (same order as `singularPluralInputs`). */
  singularPluralDisplayRows(pq: PlayerQuestion): { singular: string }[] {
    return (pq?.data?.pairs || [])
      .filter((p: any) => String(p?.singular || '').trim())
      .map((p: any) => ({ singular: String(p.singular) }));
  }

  getQuestionTypes(): Array<{ type: string; count: number; label: string; icon: string; indices: number[] }> {
    const byType: Record<string, number[]> = {};
    const labels: Record<string, string> = {
      mcq: 'Multiple Choice',
      matching: 'Matching',
      'fill-blank': 'Fill Blanks',
      word_bank_fill: 'Word Bank Fill',
      singular_plural: 'Singular / Plural',
      pronunciation: 'Pronunciation',
      'question-answer': 'Question / Answer',
      listening: 'Listening',
      'video-pronunciation': 'Video Pronunciation',
      'jumble-word': 'Jumble Word',
      image_pin_match: 'Image Pin Match'
    };
    const icons: Record<string, string> = {
      mcq: 'quiz',
      matching: 'compare_arrows',
      'fill-blank': 'text_fields',
      word_bank_fill: 'format_list_bulleted',
      singular_plural: 'swap_horiz',
      pronunciation: 'record_voice_over',
      'question-answer': 'short_text',
      listening: 'headphones',
      'video-pronunciation': 'videocam',
      'jumble-word': 'shuffle',
      image_pin_match: 'place'
    };
    this.playerQuestions.forEach((pq, i) => {
      const t = pq.data.type;
      if (!byType[t]) byType[t] = [];
      byType[t].push(i + 1);
    });
    return Object.entries(byType).map(([type, indices]) => ({
      type,
      count: indices.length,
      label: labels[type] || type,
      icon: icons[type] || 'help',
      indices
    }));
  }

  getQuestionTypeClass(pq: PlayerQuestion): string {
    return 'type-' + (pq.data.type || 'mcq');
  }

  getTypeIcon(type: string): string {
    return this.exerciseService.getQuestionTypeIcon(type as any);
  }

  getTypeLabel(type: string): string {
    return this.exerciseService.getQuestionTypeLabel(type as any);
  }

  showSpecialCharacterPad(pq: PlayerQuestion | null | undefined): boolean {
    if (!pq?.data) return false;
    if (pq.data.type === 'fill-blank') return true;
    if ((pq.data.type as string) === 'word_bank_fill') return true;
    if (pq.data.type === 'singular_plural') return true;
    if (pq.data.type === 'listening') return true;
    if (pq.data.type === 'jumble-word') return true;
    if ((pq.data.type as string) === 'rearrange') return true;
    if (pq.data.type === 'question-answer') return !this.isTrueFalseQuestion(pq.data);
    return false;
  }

  setActiveSpecialInputTarget(target: SpecialInputTarget): void {
    this.activeSpecialInputTarget = target;
  }

  insertSpecialCharacter(char: string): void {
    if (this.state === 'submitted' || !char) return;

    if (this.insertAtCaretInFocusedControl(char)) {
      this.markAttempted(this.currentQuestion);
      return;
    }

    const pq = this.currentQuestion;
    if (!pq) return;

    if (this.activeSpecialInputTarget?.type === 'singular-plural') {
      const idx = this.activeSpecialInputTarget.rowIndex;
      if (!Array.isArray(pq.singularPluralInputs) || idx < 0 || idx >= pq.singularPluralInputs.length) return;
      pq.singularPluralInputs[idx] = `${pq.singularPluralInputs[idx] || ''}${char}`;
      this.markAttempted(pq);
      return;
    }

    if (this.activeSpecialInputTarget?.type === 'fill-blank') {
      const idx = this.activeSpecialInputTarget.blankIndex;
      if (!Array.isArray(pq.fillAnswers) || idx < 0 || idx >= pq.fillAnswers.length) return;
      pq.fillAnswers[idx] = `${pq.fillAnswers[idx] || ''}${char}`;
      this.markAttempted(pq);
      return;
    }

    if (this.activeSpecialInputTarget?.type === 'word-bank-fill') {
      const idx = this.activeSpecialInputTarget.blankIndex;
      if (!Array.isArray(pq.wordBankAnswers) || idx < 0 || idx >= pq.wordBankAnswers.length) return;
      pq.wordBankAnswers[idx] = { index: idx, value: `${pq.wordBankAnswers[idx]?.value || ''}${char}` };
      this.markAttempted(pq);
      return;
    }

    if (this.activeSpecialInputTarget?.type === 'question-answer') {
      pq.qaResponse = `${pq.qaResponse || ''}${char}`;
      this.markAttempted(pq);
      return;
    }

    if (this.activeSpecialInputTarget?.type === 'listening') {
      pq.listeningText = `${pq.listeningText || ''}${char}`;
      this.markAttempted(pq);
      return;
    }

    if (this.activeSpecialInputTarget?.type === 'jumble-word') {
      pq.jumbleWordResponse = `${pq.jumbleWordResponse || ''}${char}`;
      this.markAttempted(pq);
      return;
    }
  }

  insertJumbleToken(token: string, tokenIndex: number): void {
    if (this.state === 'submitted') return;
    const pq = this.currentQuestion;
    if (!pq || (pq.data?.type as string) !== 'jumble-word') return;
    if (!token || token === ' ') return;
    if (!Array.isArray(pq.jumbleUsedTokenIndices)) {
      pq.jumbleUsedTokenIndices = [];
    }
    if (pq.jumbleUsedTokenIndices.includes(tokenIndex)) return;
    pq.jumbleUsedTokenIndices.push(tokenIndex);

    const input = this.jumbleInput?.nativeElement;
    if (input && !input.disabled) {
      this.insertAtCaretInControl(input, token);
      try {
        input.focus();
      } catch {
        // ignore
      }
      this.markAttempted(pq);
      return;
    }

    pq.jumbleWordResponse = `${pq.jumbleWordResponse || ''}${token}`;
    this.markAttempted(pq);
  }

  onJumbleResponseChange(pq: PlayerQuestion, answer: string): void {
    if (this.state === 'submitted') return;
    pq.jumbleWordResponse = answer;
    pq.jumbleUsedTokenIndices = this.reconcileJumbleUsedTokenIndices(
      pq.data,
      pq.jumbleUsedTokenIndices,
      answer
    );
    this.markAttempted(pq);
  }

  private insertAtCaretInFocusedControl(char: string): boolean {
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (!active) return false;
    const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA';
    if (!isInput || active.disabled) return false;
    const value = active.value ?? '';
    const start = active.selectionStart ?? value.length;
    const end = active.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${char}${value.slice(end)}`;
    active.value = next;
    active.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = start + char.length;
    try {
      active.setSelectionRange(caret, caret);
    } catch {
      // Ignore for controls that do not support explicit selection range.
    }
    return true;
  }

  private insertAtCaretInControl(control: HTMLInputElement | HTMLTextAreaElement, text: string): void {
    const value = control.value ?? '';
    const start = control.selectionStart ?? value.length;
    const end = control.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
    control.value = next;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = start + text.length;
    try {
      control.setSelectionRange(caret, caret);
    } catch {
      // Ignore for controls that do not support explicit selection range.
    }
  }

  private getWorksheetKindLabel(kind: string | null | undefined): string | null {
    if (!kind) return null;
    const map: Record<string, string> = {
      'true-false': 'Richtig / Falsch',
      'sentence-transformation': 'Sentence Transformation',
      'singular-plural': 'Singular → Plural',
      'table-profile-fill': 'Table / Profile Fill-in',
      'free-writing-own-sentences': 'Free Writing / Own Sentences',
      'free-writing-profile': 'Free Writing – profile',
      'error-correction': 'Error Correction'
    };
    return map[kind] || null;
  }

  /**
   * Display label for the question header / navigator.
   * For question-answer tasks, worksheetKind is shown instead of generic "Question / Answer".
   */
  getQuestionTypeLabelForDisplay(data: any): string {
    if (data?.type === 'question-answer') {
      const k = this.getWorksheetKindLabel(data?.worksheetKind);
      if (k) return k;
    }
    return this.getTypeLabel(data?.type || 'question-answer');
  }

  getMediaFullUrl(relative?: string | null): string {
    const key = String(relative || '').trim();
    if (!key) return '';
    const cached = this.mediaUrlCache.get(key);
    if (cached) return cached;
    const resolved = resolveMediaUrl(key);
    this.mediaUrlCache.set(key, resolved);
    return resolved;
  }

  private preloadImagesAroundCurrentQuestion(): void {
    const current = this.playerQuestions[this.currentIndex];
    const next = this.playerQuestions[this.currentIndex + 1];
    this.preloadQuestionImages(current);
    this.preloadQuestionImages(next);
  }

  private preloadQuestionImages(pq?: PlayerQuestion): void {
    if (!pq || typeof Image === 'undefined') return;
    this.preloadImageUrl(pq.data?.imageUrl);
    if (this.getAttachmentType(String(pq.data?.attachmentUrl || '')) === 'image') {
      this.preloadImageUrl(pq.data?.attachmentUrl);
    }
  }

  private preloadImageUrl(rawUrl?: string | null): void {
    const src = this.getMediaFullUrl(rawUrl);
    if (!src || this.preloadedImageUrls.has(src)) return;
    this.preloadedImageUrls.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }

  hasSubQuestions(data: QuestionRowData | null | undefined): boolean {
    return Array.isArray(data?.subQuestions) && data!.subQuestions!.length > 0;
  }

  /** Parent is part 1; first sub-question is part 2, etc. */
  getQuestionPartLabel(questionIndex: number, partNumber: number): string {
    return `${questionIndex + 1}.${partNumber}`;
  }

  /**
   * Labels for fill-blank review cards — distinct from sub-question headers (Q 1.2)
   * so blanks are not shown with the same Q id as the sub-question block below.
   */
  getFillBlankReviewPartLabel(
    questionIndex: number,
    partNumber: number,
    scope: 'parent' | 'sub',
    hasSubQuestions: boolean
  ): string {
    const qPart = this.getQuestionPartLabel(questionIndex, partNumber);
    if (scope === 'sub') {
      return `Sub-part Q ${qPart}`;
    }
    if (hasSubQuestions) {
      return 'Main question';
    }
    return `Q ${qPart}`;
  }

  getParentPartNumber(data?: QuestionRowData | null): number {
    return this.isParentAnswerPartEmpty(data) ? 0 : 1;
  }

  getSubQuestionPartNumber(
    sqIndex: number,
    data?: QuestionRowData | null
  ): number {
    return this.isParentAnswerPartEmpty(data) ? sqIndex + 1 : sqIndex + 2;
  }

  private htmlToPlainText(html: unknown): string {
    return String(html ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Parent only carries shared context; answerable parts are all sub-questions. */
  isParentAnswerPartEmpty(data: QuestionRowData | null | undefined): boolean {
    if (!data || !this.hasSubQuestions(data)) return false;
    const type = String(data.type || '').toLowerCase();
    if (type === 'mcq') {
      const q = this.htmlToPlainText(data.question);
      const opts = Array.isArray(data.options)
        ? data.options.some((o) => this.htmlToPlainText(o).length > 0)
        : false;
      return !q && !opts;
    }
    if (type === 'question-answer') {
      return !this.htmlToPlainText(data.prompt) && !this.isTrueFalseQuestion(data);
    }
    return false;
  }

  shouldShowParentMcqPart(data: QuestionRowData | null | undefined): boolean {
    if (!data || !this.hasSubQuestions(data)) return true;
    if (String(data.type || '').toLowerCase() !== 'mcq') return true;
    return !this.isParentAnswerPartEmpty(data);
  }

  /** Shared passage audio on the first sub-part (e.g. Q 24.1) when the parent row has no prompt. */
  shouldShowPassageAudioOnFirstSub(
    sqIndex: number,
    parent: QuestionRowData | null | undefined
  ): boolean {
    return sqIndex === 0 && !!parent && this.isParentAnswerPartEmpty(parent) && this.hasAudioAttachment(parent);
  }

  hasAudioAttachment(data: QuestionRowData | null | undefined): boolean {
    const att = String(data?.attachmentUrl || '').trim();
    return !!att && this.getAttachmentType(att) === 'audio';
  }

  hasMediaAttachment(data: QuestionRowData | null | undefined): boolean {
    const att = String(data?.attachmentUrl || '').trim();
    return !!att && this.getAttachmentType(att) !== 'audio';
  }

  /** Audio on the parent row (e.g. Q 24.1) when the question has sub-parts. */
  shouldShowParentPartAudio(data: QuestionRowData | null | undefined): boolean {
    return (
      !!data &&
      this.hasSubQuestions(data) &&
      this.hasAudioAttachment(data) &&
      !this.isParentAnswerPartEmpty(data)
    );
  }

  /** Shared panel above all parts — disabled; audio lives on the parent part card instead. */
  shouldShowSharedPassageAudio(_data?: QuestionRowData | null): boolean {
    return false;
  }

  /** @deprecated Use shouldShowParentPartAudio */
  shouldShowPassageAudioAtTop(data: QuestionRowData | null | undefined): boolean {
    return this.shouldShowParentPartAudio(data);
  }

  /** Per-part audio directly above the question/prompt. */
  shouldShowInlineQuestionAudio(data: QuestionRowData | null | undefined): boolean {
    return !!data && this.hasAudioAttachment(data) && !this.hasSubQuestions(data);
  }

  shouldShowQuestionAudio(data: QuestionRowData | null | undefined): boolean {
    return this.shouldShowInlineQuestionAudio(data) || this.shouldShowParentPartAudio(data);
  }

  /** Sub-part has its own audio (not the same clip already shown on the parent part). */
  hasSubQuestionOwnAudio(
    parent: QuestionRowData | null | undefined,
    sq: QuestionRowData | null | undefined
  ): boolean {
    const subAtt = String(sq?.attachmentUrl || '').trim();
    if (!subAtt || this.getAttachmentType(subAtt) !== 'audio') return false;
    const parentAtt = String(parent?.attachmentUrl || '').trim();
    return !parentAtt || subAtt !== parentAtt;
  }

  /** Non-audio passage attachments stay below sub-questions (reading image, PDF, etc.). */
  shouldShowPassageAttachmentAtBottom(data: QuestionRowData | null | undefined): boolean {
    return !!data && this.hasSubQuestions(data) && this.hasMediaAttachment(data);
  }

  getAttachmentType(url: string): 'image' | 'audio' | 'video' | 'pdf' | 'other' {
    if (!url) return 'other';
    const lower = url.toLowerCase().split('?')[0];
    if (/\.(jpe?g|jpg|jfif|png|gif|webp|svg|avif|bmp)$/.test(lower)) return 'image';
    if (/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/.test(lower)) return 'audio';
    if (/\.(mp4|mov|avi|mkv)$/.test(lower)) return 'video';
    if (/\.pdf$/.test(lower)) return 'pdf';
    if (
      (lower.includes('listening-media/') || lower.includes('exercise-attachments/')) &&
      !/\.(jpe?g|png|gif|webp|svg|pdf|mp4|mov)$/.test(lower)
    ) {
      return 'audio';
    }
    return 'other';
  }

  /** Max attachment-audio play starts this attempt, or null if unlimited / not audio. */
  getAttachmentAudioCap(pq: PlayerQuestion | null | undefined): number | null {
    if (!pq?.data) return null;
    const att = String(pq.data.attachmentUrl || '').trim();
    if (!att || this.getAttachmentType(att) !== 'audio') return null;
    const raw = pq.data.attachmentAudioMaxPlaysPerAttempt;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').trim(), 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(99, Math.floor(n));
  }

  getAttachmentAudioPlaysUsed(pq: PlayerQuestion): number {
    return pq.attachmentAudioPlaysUsed ?? 0;
  }

  /** Remaining play starts this attempt; null means unlimited. */
  getAttachmentAudioPlaysRemaining(pq: PlayerQuestion): number | null {
    const cap = this.getAttachmentAudioCap(pq);
    if (cap == null) return null;
    return Math.max(0, cap - this.getAttachmentAudioPlaysUsed(pq));
  }

  isAttachmentAudioLimitReached(pq: PlayerQuestion): boolean {
    const cap = this.getAttachmentAudioCap(pq);
    if (cap == null) return false;
    return this.getAttachmentAudioPlaysUsed(pq) >= cap;
  }

  playQuestionAttachmentAudio(pq: PlayerQuestion): void {
    const url = String(pq.data?.attachmentUrl || '').trim();
    if (!url || this.getAttachmentType(url) !== 'audio') return;
    const cap = this.getAttachmentAudioCap(pq);
    const used = this.getAttachmentAudioPlaysUsed(pq);
    if (cap != null && used >= cap) {
      this.snackBar.open('Play limit reached for this attempt.', 'Close', { duration: 2800 });
      return;
    }
    this.stopCurrentAudio();
    const fullUrl = this.getMediaFullUrl(url);
    const audio = new Audio(fullUrl);
    this.currentlyPlayingAudio = audio;
    if (cap != null) {
      pq.attachmentAudioPlaysUsed = used + 1;
    }
    audio.play().catch(() => {
      if (cap != null) {
        pq.attachmentAudioPlaysUsed = Math.max(0, used);
      }
      this.currentlyPlayingAudio = null;
      this.snackBar.open('Could not play audio.', 'Close', { duration: 2500 });
    });
    audio.addEventListener('ended', () => {
      this.currentlyPlayingAudio = null;
    });
  }

  /**
   * Listening clip when attachment is not audio — uses legacy mediaUrl (attachment audio is shown in the shared attachment box).
   */
  getListeningSupplementalAudioUrl(data: any): string {
    if (data?.type !== 'listening') return '';
    const att = String(data.attachmentUrl || '').trim();
    if (att && this.getAttachmentType(att) === 'audio') return '';
    return String(data.mediaUrl || '').trim();
  }

  private collectExerciseMediaUrlsForRecovery(): string[] {
    const urls: string[] = [];
    const add = (u?: string | null) => {
      const s = String(u || '').trim();
      if (!s) return;
      const lower = s.toLowerCase();
      if (
        lower.includes('listening-media') ||
        lower.includes('exercise-attachments') ||
        s.startsWith('/uploads/')
      ) {
        urls.push(s);
      }
    };
    const ex = this.exercise;
    if (!ex) return [];
    add(ex.sharedAudioUrl);
    for (const row of ex.videoSuccessFeedback || []) add(row.audioUrl);
    for (const row of ex.videoRetryFeedback || []) add(row.audioUrl);
    const rawQuestions = (ex.questions || []) as unknown as Array<Record<string, unknown>>;
    for (const q of rawQuestions) {
      add(q['imageUrl'] as string | undefined);
      const optImgs = Array.isArray(q['optionImageUrls']) ? q['optionImageUrls'] as string[] : [];
      for (const u of optImgs) add(u);
      add(q['attachmentUrl'] as string | undefined);
      add(q['mediaUrl'] as string | undefined);
      add(q['audioUrl'] as string | undefined);
      add(q['videoUrl'] as string | undefined);
    }
    return [...new Set(urls)];
  }

  /**
   * Replace exercise media fields when R2 resolve reports `found` for the stored path.
   * Returns how many fields were updated (for manual refetch feedback).
   */
  private applyFoundMediaResolutions(
    resolutions: Array<{ original: string; url: string; found: boolean }>
  ): number {
    if (!this.exercise) return 0;
    const mapFound = new Map(
      resolutions.filter((r) => r.found).map((r) => [r.original, r.url])
    );
    if (mapFound.size === 0) return 0;
    let updated = 0;
    const patchVal = (before: string | undefined | null): string | undefined | null => {
      const s = String(before || '').trim();
      if (!s) return before;
      const r = mapFound.get(s);
      return r !== undefined ? r : before;
    };
    const ex = this.exercise;
    const nextShared = patchVal(ex.sharedAudioUrl);
    if (nextShared !== ex.sharedAudioUrl) {
      ex.sharedAudioUrl = nextShared ?? undefined;
      updated++;
    }
    for (const row of ex.videoSuccessFeedback || []) {
      const n = patchVal(row.audioUrl);
      if (n !== row.audioUrl) {
        row.audioUrl = (n as string) || '';
        updated++;
      }
    }
    for (const row of ex.videoRetryFeedback || []) {
      const n = patchVal(row.audioUrl);
      if (n !== row.audioUrl) {
        row.audioUrl = (n as string) || '';
        updated++;
      }
    }
    const qs = (ex.questions || []) as unknown as Array<Record<string, unknown>>;
    for (const q of qs) {
      const ni = patchVal(q['imageUrl'] as string | undefined);
      if (ni !== q['imageUrl']) {
        q['imageUrl'] = ni ?? undefined;
        updated++;
      }
      const na = patchVal(q['attachmentUrl'] as string | undefined);
      if (na !== q['attachmentUrl']) {
        q['attachmentUrl'] = na ?? undefined;
        updated++;
      }
      const nm = patchVal(q['mediaUrl'] as string | undefined);
      if (nm !== q['mediaUrl']) {
        q['mediaUrl'] = nm;
        updated++;
      }
      const nau = patchVal(q['audioUrl'] as string | undefined);
      if (nau !== q['audioUrl']) {
        q['audioUrl'] = nau;
        updated++;
      }
      const nv = patchVal(q['videoUrl'] as string | undefined);
      if (nv !== q['videoUrl']) {
        q['videoUrl'] = nv;
        updated++;
      }
      const optImgs = Array.isArray(q['optionImageUrls']) ? (q['optionImageUrls'] as string[]) : [];
      if (optImgs.length) {
        let optChanged = false;
        const nextOpt = optImgs.map((u) => {
          const n = patchVal(u);
          if (n !== u) optChanged = true;
          return (n as string) || '';
        });
        if (optChanged) {
          q['optionImageUrls'] = nextOpt;
          updated++;
        }
      }
      const subs = Array.isArray(q['subQuestions']) ? (q['subQuestions'] as Array<Record<string, unknown>>) : [];
      for (const sq of subs) {
        const sqOpt = Array.isArray(sq['optionImageUrls']) ? (sq['optionImageUrls'] as string[]) : [];
        if (!sqOpt.length) continue;
        let sqChanged = false;
        const nextSqOpt = sqOpt.map((u) => {
          const n = patchVal(u);
          if (n !== u) sqChanged = true;
          return (n as string) || '';
        });
        if (sqChanged) {
          sq['optionImageUrls'] = nextSqOpt;
          updated++;
        }
      }
    }
    return updated;
  }

  refetchMediaFromR2(): void {
    if (!this.exercise || this.mediaRefetchInProgress) return;
    const urls = this.collectExerciseMediaUrlsForRecovery();
    if (urls.length === 0) {
      this.snackBar.open('No uploaded audio paths to recover in this exercise.', 'Close', { duration: 3500 });
      return;
    }
    this.mediaRefetchInProgress = true;
    this.exerciseService.resolveMediaFromR2(urls).subscribe({
      next: ({ resolutions }) => {
        this.mediaRefetchInProgress = false;
        const anyFound = resolutions.some((r) => r.found);
        if (!anyFound) {
          this.snackBar.open('No matching files found in cloud storage.', 'Close', { duration: 4500 });
          return;
        }
        const updated = this.applyFoundMediaResolutions(resolutions);
        this.mediaUrlCache.clear();
        this.snackBar.open(
          updated > 0 ? `Restored ${updated} media link(s) from cloud storage.` : 'Checked cloud storage; links already current.',
          'Close',
          { duration: 4500 }
        );
      },
      error: (err) => {
        this.mediaRefetchInProgress = false;
        const msg = err?.error?.error || err?.message || 'Could not recover media.';
        this.snackBar.open(msg, 'Close', { duration: 5000 });
      },
    });
  }

  startListeningSpeech(pq: PlayerQuestion): void {
    if (this.state === 'submitted') return;
    if (!this.speechSupported) {
      this.snackBar.open('Speech recognition not supported in this browser', 'Close', { duration: 3000 });
      return;
    }
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;
    if (this.listeningRecognition) try { this.listeningRecognition.stop(); } catch {}
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let full = '';
      for (let i = 0; i < e.results.length; i++) full += e.results[i][0].transcript;
      pq.listeningText = full;
      this.markAttempted(pq);
    };
    rec.onend = () => { pq.isRecording = false; this.listeningRecognition = null; };
    rec.start();
    this.listeningRecognition = rec;
    pq.isRecording = true;
  }

  stopListeningSpeech(pq: PlayerQuestion): void {
    if (this.listeningRecognition) try { this.listeningRecognition.stop(); } catch {}
    this.listeningRecognition = null;
    pq.isRecording = false;
  }

  // ─── Video Pronunciation Interaction ──────────────────────────────────────────

  private videoPassThresholdForQuestion(pq: PlayerQuestion): number {
    const raw = Number(pq?.data?.similarityThreshold);
    if (!Number.isFinite(raw)) return DigitalExercisePlayerComponent.VP_PASS_SCORE;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  onVpLoadStart(pq?: PlayerQuestion): void {
    this.vpVideoElement = null;
    if (pq?.data?.type === 'video-pronunciation') {
      pq.vpCurrentTimeSec = 0;
    }
  }

  /** When the clip is ready — autoplay without native controls. */
  onVpVideoReady(ev: Event, pq?: PlayerQuestion): void {
    const video = ev.target as HTMLVideoElement;
    if (!video) return;
    this.vpVideoElement = video;
    const active = pq || this.playerQuestions[this.currentIndex];
    if (active?.data?.type === 'video-pronunciation') {
      active.vpPlaybackEnded = false;
      active.vpCurrentTimeSec = 0;
    }
    video.muted = false;
    video.play().catch(() => {});
  }

  onVpVideoTimeUpdate(ev: Event, pq: PlayerQuestion): void {
    if (!pq || pq.data?.type !== 'video-pronunciation') return;
    const v = ev.target as HTMLVideoElement;
    if (!v) return;
    pq.vpCurrentTimeSec = Number.isFinite(v.currentTime) ? v.currentTime : 0;
    const duration = Number(v.duration);
    if (Number.isFinite(duration) && duration > 0 && duration - v.currentTime <= 0.08 && !pq.vpPlaybackEnded && !v.paused) {
      this.onVpVideoEnded(ev, pq);
    }
  }

  /**
   * When the clip ends, pause and park on the last frame so the student still sees the video
   * (not a blank/white surface), then the dim overlay + speak UI appears on top.
   */
  onVpVideoEnded(ev: Event | null, pq: PlayerQuestion): void {
    if (!pq || pq.data?.type !== 'video-pronunciation') return;
    if (pq.vpPlaybackEnded) return;
    pq.vpPlaybackEnded = true;
    const v = (ev?.target as HTMLVideoElement) || this.vpVideoElement;
    if (!v) return;
    try {
      v.pause();
      if (v.duration && !isNaN(v.duration) && v.duration > 0) {
        v.currentTime = Math.max(0, v.duration - 0.001);
        pq.vpCurrentTimeSec = v.duration;
      }
    } catch {
      /* ignore */
    }
    this.pushTutorTurnPromptForSpeak(this.speakTargetCaptionForQuestion(pq));
  }

  /** Dim layer over the video so copy + buttons read clearly on top of the last frame. */
  get vpPostPlayScrimVisible(): boolean {
    if (!this.isVideoOnlyExercise || this.state !== 'playing') return false;
    const pq = this.currentQuestion;
    if (!pq || pq.data?.type !== 'video-pronunciation') return false;
    if (this.showVpFinalSubmit) return true;
    if (pq.vpPlaybackEnded) return true;
    if (pq.isRecording) return true;
    if (pq.vpResult === 'correct' || pq.vpResult === 'incorrect') return true;
    return false;
  }

  /** Replay from the start; hides Speak until the clip ends again. */
  replayVpVideo(): void {
    const pq = this.currentQuestion;
    if (pq?.data?.type === 'video-pronunciation') {
      pq.vpAdvanceSeq = (pq.vpAdvanceSeq || 0) + 1;
      pq.vpPlaybackEnded = false;
      pq.vpCurrentTimeSec = 0;
    }
    this.clearVpFeedbackUi();
    const v = this.vpVideoElement;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  }

  get isVpVideoPaused(): boolean {
    const v = this.vpVideoElement;
    if (!v) return true;
    return !!v.paused;
  }

  toggleVpVideoPlayback(): void {
    const v = this.vpVideoElement;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      try { v.pause(); } catch {}
    }
  }

  private muteVpVideoDuringPronunciation(): void {
    const v = this.vpVideoElement;
    if (!v) return;
    if (!this.vpMutedDuringPronunciation) {
      this.vpVideoMutedBeforePronunciation = !!v.muted;
      this.vpVideoVolumeBeforePronunciation = Number.isFinite(v.volume) ? v.volume : 1;
      this.vpVideoPausedBeforePronunciation = !!v.paused;
      this.vpVideoTimeBeforePronunciation = Number.isFinite(v.currentTime) ? v.currentTime : 0;
      this.vpMutedDuringPronunciation = true;
    }
    // Use multiple guards (mute + volume + pause) because some setups can
    // still leak reference audio into the mic even when `muted=true`.
    v.muted = true;
    v.volume = 0;
    try { v.pause(); } catch { /* ignore */ }
  }

  private restoreVpVideoAfterPronunciation(): void {
    const v = this.vpVideoElement;
    if (!v) {
      this.vpMutedDuringPronunciation = false;
      return;
    }
    if (this.vpMutedDuringPronunciation) {
      v.muted = this.vpVideoMutedBeforePronunciation;
      v.volume = this.vpVideoVolumeBeforePronunciation;
      const wasPaused = this.vpVideoPausedBeforePronunciation;
      const t = this.vpVideoTimeBeforePronunciation;
      this.vpMutedDuringPronunciation = false;
      try {
        // Restore playback position and pause state if we paused it for recording.
        if (!wasPaused) {
          v.currentTime = t;
          void v.play();
        } else {
          v.currentTime = t;
        }
      } catch {
        // If restoring fails (e.g. element detached), keep the safe muted state.
      }
    }
  }

  /**
   * Entry point for video-pronunciation clips. Prefers the MediaRecorder +
   * backend Whisper flow; falls back to the legacy in-browser
   * SpeechRecognition path when the recorder is unavailable.
   */
  startVideoPronunciation(pq: PlayerQuestion): void {
    if (this.state === 'submitted') return;
    if (pq.data?.type === 'video-pronunciation' && !pq.vpPlaybackEnded) {
      this.snackBar.open('Finish watching the clip first, then tap Speak.', 'Close', { duration: 3000 });
      return;
    }
    if (pq.isRecording) return;

    if (this.audioRecorderSupported) {
      void this.startAudioPronunciationForClip(pq);
      return;
    }
    if (!this.speechSupported) {
      this.snackBar.open('Audio recording is not supported in this browser. Try Chrome, Edge, or Safari 14.3+.', 'Close', { duration: 6000 });
      pq.pronUiState = 'error';
      pq.pronMessage = 'Unsupported browser';
      return;
    }
    void this.startVideoPronunciationInternal(pq);
  }

  private async startVideoPronunciationInternal(pq: PlayerQuestion): Promise<void> {
    if (this.state === 'submitted') return;
    if (pq.data?.type === 'video-pronunciation' && !pq.vpPlaybackEnded) {
      this.snackBar.open('Finish watching the clip first, then tap Speak.', 'Close', { duration: 3000 });
      return;
    }
    if (pq.isRecording) return;

    if (!this.speechSupported) {
      this.snackBar.open('Speech recognition not supported in this browser. Try Chrome or Edge.', 'Close', { duration: 5000 });
      return;
    }

    const SpeechRecognition = this.speechRecognitionCtor;
    if (!SpeechRecognition) {
      this.snackBar.open('Speech recognition not supported in this browser. Try Chrome or Edge.', 'Close', { duration: 5000 });
      return;
    }
    const hasMicAccess = await this.ensureMicrophoneAccess();
    if (!hasMicAccess) return;
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
      this.recognition = null;
    }
    const rec = new SpeechRecognition();
    this.recognition = rec;
    const langMap: Record<string, string> = { 'German': 'de-DE', 'English': 'en-US' };
    rec.lang = langMap[this.exercise?.targetLanguage || 'German'] || 'de-DE';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    pq.isRecording = true;
    pq.vpResult = 'idle';
    this.clearVpFeedbackUi();
    this.muteVpVideoDuringPronunciation();

    const target = this.speakTargetCaptionForQuestion(pq);
    const variants = Array.isArray(pq.data.acceptedVariants) ? pq.data.acceptedVariants : [];
    const lang = this.exercise?.targetLanguage === 'English' ? 'en-US' : 'de-DE';
    let bestTranscript = '';
    let bestScore = 0;
    let gotUsableResult = false;
    let finalized = false;

    const handleFailure = (reason: 'no-speech' | 'audio-capture' | 'not-allowed' | 'start-failed'): void => {
      if (finalized) return;
      finalized = true;
      pq.isRecording = false;
      this.restoreVpVideoAfterPronunciation();
      if (this.recognition === rec) this.recognition = null;
      if (this.vpManualStopFinalize) this.vpManualStopFinalize = null;
      pq.vpFailCount = (pq.vpFailCount || 0) + 1;
      pq.pronunciationScore = 0;
      pq.vpSpokenText = '';
      pq.hasRecorded = true;
      pq.vpResult = 'incorrect';
      pq.isAnswered = true;
      this.markAttempted(pq);

      if (reason === 'not-allowed') {
        this.snackBar.open('Microphone access denied. Please allow microphone access.', 'Close', { duration: 5000 });
      } else if (reason === 'audio-capture') {
        this.snackBar.open('No microphone was detected on this device/browser.', 'Close', { duration: 4000 });
      } else if (reason === 'start-failed') {
        this.snackBar.open('Microphone could not be started. Please try again.', 'Close', { duration: 4000 });
      } else {
        this.snackBar.open('No speech detected. Please try again.', 'Close', { duration: 3000 });
      }
      if (this.isVideoOnlyExercise) {
        this.pushVpChat('tutor', 'I could not hear your full sentence. Please tap Speak and try again.');
      }

      if ((pq.vpFailCount || 0) >= DigitalExercisePlayerComponent.VP_MAX_FAILED_ATTEMPTS_PER_CLIP) {
        this.pushVpChat(
          'tutor',
          `I could not hear enough input after ${DigitalExercisePlayerComponent.VP_MAX_FAILED_ATTEMPTS_PER_CLIP} tries. You can retry or move to the next clip.`
        );
      }
    };

    const finalizeSuccess = (): void => {
      if (finalized) return;
      finalized = true;
      pq.isRecording = false;
      this.restoreVpVideoAfterPronunciation();
      if (this.recognition === rec) this.recognition = null;
      if (this.vpManualStopFinalize) this.vpManualStopFinalize = null;
      if (!gotUsableResult) {
        handleFailure('no-speech');
        return;
      }
      pq.hasRecorded = true;
      pq.pronunciationScore = bestScore;
      const passThreshold = this.videoPassThresholdForQuestion(pq);
      const almostThreshold = Math.max(0, passThreshold - 25);
      const isCorrect = pq.pronunciationScore >= passThreshold;
      const isAlmostCorrect = !isCorrect && pq.pronunciationScore >= almostThreshold;
      pq.vpAlmostCorrect = isAlmostCorrect;

      if (isCorrect) {
        pq.vpResult = 'correct';
      } else if (isAlmostCorrect) {
        pq.vpResult = 'almostCorrect';
      } else {
        pq.vpResult = 'incorrect';
      }

      if (!isCorrect && !isAlmostCorrect) pq.vpFailCount = (pq.vpFailCount || 0) + 1;
      this.markAttempted(pq);
      if (this.isVideoOnlyExercise) {
        this.pushVpChat('user', pq.vpSpokenText || '', { isCorrect, score: pq.pronunciationScore || 0 });
        if (isCorrect) {
          this.pushVpChat('tutor', 'Great job!');
        } else if (isAlmostCorrect) {
          this.pushVpChat('tutor', 'Almost there — try once more for a perfect score!');
        } else {
          this.pushVpChat('tutor', `Not quite — target is ${passThreshold}%+. Choose retry or next clip.`);
        }
      }

      if (isCorrect) {
        if (pq.vpAutoAdvanceTimer) clearTimeout(pq.vpAutoAdvanceTimer);
        pq.vpAutoAdvanceTimer = undefined;
        void this.runVpCorrectAdvanceSequence(pq);
      } else {
        void this.runVpIncorrectFeedbackSequence(pq);
      }
    };

    this.vpManualStopFinalize = finalizeSuccess;

    // ── Mixed / non-video-only exercise: keep correct/incorrect evaluation ──
    rec.onresult = (event: any) => {
      const candidates = this.flattenSpeechResultCandidates(event);
      for (const cand of candidates) {
        const s = this.getPronunciationScoreForTranscript(cand, target, variants, lang);
        if (s > bestScore) {
          bestScore = s;
          bestTranscript = cand;
        }
      }
      if (candidates.length > 0) {
        gotUsableResult = true;
        const rawTranscript = bestTranscript || candidates[0] || '';
        pq.vpSpokenText = this.normalizeNumbersForDisplay(rawTranscript, target, lang) || rawTranscript;
        pq.pronunciationScore = bestScore;
      }
    };

    rec.onerror = (event: any) => {
      const code = String(event?.error || '');
      if (code === 'not-allowed') handleFailure('not-allowed');
      else if (code === 'audio-capture') handleFailure('audio-capture');
      else if (code === 'no-speech') handleFailure('no-speech');
    };

    rec.onend = () => {
      finalizeSuccess();
    };

    try {
      rec.start();
    } catch {
      handleFailure('start-failed');
    }
  }

  stopVideoPronunciation(pq: PlayerQuestion): void {
    if (!pq?.isRecording && this.activePronQuestion !== pq) return;

    // Audio flow: stop + upload
    if (this.activePronQuestion === pq) {
      void this.finishAudioPronunciationForClip(pq);
      return;
    }

    // Legacy SpeechRecognition flow
    try {
      this.recognition?.stop();
    } catch {
      pq.isRecording = false;
      this.recognition = null;
      if (this.vpManualStopFinalize) {
        const finalize = this.vpManualStopFinalize;
        this.vpManualStopFinalize = null;
        finalize();
      }
      return;
    }
    // Some browsers don't dispatch onend reliably on manual stop; finalize anyway.
    setTimeout(() => {
      if (!pq.isRecording || !this.vpManualStopFinalize) return;
      const finalize = this.vpManualStopFinalize;
      this.vpManualStopFinalize = null;
      finalize();
    }, 750);
  }

  retryVideoPronunciation(pq: PlayerQuestion): void {
    pq.vpAdvanceSeq = (pq.vpAdvanceSeq || 0) + 1;
    this.clearVpFeedbackUi();
    if (pq.vpAutoAdvanceTimer) { clearTimeout(pq.vpAutoAdvanceTimer); pq.vpAutoAdvanceTimer = undefined; }
    pq.vpSpokenText = '';
    pq.vpResult = 'idle';
    pq.hasRecorded = false;
    pq.pronunciationScore = 0;
    pq.isAnswered = false;
    this.replayVpVideo();
  }

  speakAgainVideoPronunciation(pq: PlayerQuestion): void {
    pq.vpAdvanceSeq = (pq.vpAdvanceSeq || 0) + 1;
    this.clearVpFeedbackUi();
    if (pq.vpAutoAdvanceTimer) {
      clearTimeout(pq.vpAutoAdvanceTimer);
      pq.vpAutoAdvanceTimer = undefined;
    }
    pq.vpSpokenText = '';
    pq.vpResult = 'idle';
    pq.hasRecorded = false;
    pq.pronunciationScore = 0;
    pq.isAnswered = false;
    // Keep the clip on the last frame and listen again immediately.
    pq.vpPlaybackEnded = true;
    this.startVideoPronunciation(pq);
  }

  /**
   * Continue after an incorrect attempt: keep student's spoken text/score,
   * submit this clip as-is, then move forward.
   */
  goToNextClipAfterIncorrect(): void {
    if (this.submitting || this.finishingAll) return;
    const pq = this.currentQuestion;
    if (!pq) return;

    // Keep what student said visible in chat/review; if somehow empty, submit as 0%.
    pq.vpSpokenText = pq.vpSpokenText || '';
    pq.pronunciationScore = pq.pronunciationScore || 0;
    pq.vpResult = 'idle';
    pq.isAnswered = true;
    pq.vpAdvanceSeq = (pq.vpAdvanceSeq || 0) + 1;
    this.clearVpFeedbackUi();

    const isLastClip = this.currentIndex >= this.playerQuestions.length - 1;

    if (isLastClip) {
      // Last clip — submit full exercise
      this.finishVideoExercise();
    } else {
      // Submit this clip then advance
      this.submitCurrentQuestion();
      setTimeout(() => this.nextQuestion(), 300);
    }
  }

  markAttempted(pq: PlayerQuestion): void {
    pq.isAnswered = true;
    this.scheduleDraftSave();
  }

  /** Aligns with server `sanitizeQuestionPlainText` for per-item feedback after submit. */
  private normExercisePlainText(v: unknown): string {
    const decoded = String(v ?? '')
      // numeric entities
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      // common named entities
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      // strip any leftover tags (answers should be plain text)
      .replace(/<\/?[^>]+>/g, '');

    return decoded
      // normalize Unicode so “ä” vs “ä” compare equal
      .normalize('NFKC')
      // remove zero-width characters that can sneak in from copy/paste
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // normalize NBSP
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  isMatchCorrect(pq: PlayerQuestion, leftIndex: number): boolean {
    const matchedRightIndex = pq.matchingLeft![leftIndex].matchedRightIndex;
    if (matchedRightIndex === null || matchedRightIndex === undefined) return false;
    const matchedRightValue = pq.matchingRight![matchedRightIndex].value;
    const correctPairs = pq.data._correctPairs || [];
    const correctForLeft = correctPairs.find((p: any) => p.leftIndex === leftIndex);
    if (!correctForLeft) return false;
    return this.normExercisePlainText(correctForLeft.rightValue) === this.normExercisePlainText(matchedRightValue);
  }

  isFillCorrect(pq: PlayerQuestion, blankIndex: number): boolean {
    const correctList = pq.data._correctAnswers || pq.data.answers || [];
    const correct = correctList[blankIndex];
    const given = (pq.fillAnswers || [])[blankIndex];
    if (correct === undefined || given === undefined) return false;
    const a = this.normExercisePlainText(given);
    const b = this.normExercisePlainText(correct);
    return pq.data.caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
  }

  isSubFillCorrect(pq: PlayerQuestion, subIndex: number, blankIndex: number): boolean {
    const sq = pq.data.subQuestions?.[subIndex];
    const correctList = sq?._correctAnswers || sq?.answers || [];
    const correct = correctList[blankIndex];
    const given = (pq.subQuestionFillBlankAnswers?.[subIndex] || [])[blankIndex];
    if (correct === undefined || given === undefined) return false;
    const a = this.normExercisePlainText(given);
    const b = this.normExercisePlainText(correct);
    const caseSensitive = !!sq?.caseSensitive;
    return caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
  }

  getSubCorrectFillAnswer(pq: PlayerQuestion, subIndex: number, blankIndex: number): string {
    const sq = pq.data.subQuestions?.[subIndex];
    const list = sq?._correctAnswers || sq?.answers || [];
    return list[blankIndex] || '';
  }

  isWordBankItemCorrect(pq: PlayerQuestion, itemIndex: number): boolean {
    const items = Array.isArray(pq.data._wordBankCorrectItems) ? pq.data._wordBankCorrectItems : [];
    const row = items[itemIndex];
    const given = (pq.wordBankAnswers || [])[itemIndex]?.value;
    if (row === undefined || given === undefined) return false;
    const g = this.normExercisePlainText(given).toLowerCase();
    const primary = this.normExercisePlainText(row?.answer ?? '').toLowerCase();
    if (g && primary && g === primary) return true;
    const alts = Array.isArray(row?.acceptedAnswers) ? row.acceptedAnswers : [];
    return alts.some((a: unknown) => g && this.normExercisePlainText(String(a)).toLowerCase() === g);
  }

  getWordBankCorrectAnswer(pq: PlayerQuestion, itemIndex: number): string {
    const items = Array.isArray(pq.data._wordBankCorrectItems) ? pq.data._wordBankCorrectItems : [];
    const row = items[itemIndex];
    const ans = row?.answer || '';
    const alts = Array.isArray(row?.acceptedAnswers) ? row.acceptedAnswers.filter(Boolean) : [];
    if (!ans) return '';
    return alts.length ? `${ans} (also: ${alts.join(', ')})` : ans;
  }

  isSpRowCorrect(pq: PlayerQuestion, rowIndex: number): boolean {
    const expectedPl = (pq.data._correctPlurals || [])[rowIndex];
    const given = (pq.singularPluralInputs || [])[rowIndex];
    if (expectedPl === undefined || given === undefined) return false;
    const a = String(given).trim().toLowerCase().replace(/\s+/g, ' ');
    const b = String(expectedPl).trim().toLowerCase().replace(/\s+/g, ' ');
    return a === b && a.length > 0;
  }

  getSpCorrectPlural(pq: PlayerQuestion, rowIndex: number): string {
    const pl = (pq.data._correctPlurals || [])[rowIndex];
    return pl != null ? String(pl) : '';
  }

  getCorrectFillAnswer(pq: PlayerQuestion, blankIndex: number): string {
    return (pq.data._correctAnswers || [])[blankIndex] || '';
  }

  resetMatching(pq: PlayerQuestion): void {
    (pq.matchingLeft || []).forEach(l => l.matchedRightIndex = null);
    (pq.matchingRight || []).forEach(r => r.matchedLeftIndex = null);
    pq.selectedLeftIndex = null;
  }

  getScoreEmoji(score: number): string {
    if (score >= 90) return '🎉';
    if (score >= 80) return '⭐';
    if (score >= 70) return '👍';
    if (score >= 60) return '💪';
    return '📚';
  }

  /**
   * Worksheet headings from PDF extraction: German first, then English, then legacy merged `instruction`.
   */
  worksheetInstructionDisplay(data: any): string {
    if (!data) return '';
    const de = String(data.instruction_de ?? '').trim();
    const en = String(data.instruction_en ?? '').trim();
    if (de) return de;
    if (en) return en;
    return String(data.instruction ?? '').trim();
  }

  /**
   * Returns the sectionTitle for question at `index` only when it differs from
   * the previous question's sectionTitle (i.e. a new section begins), so the
   * player shows a section header banner at tier boundaries.
   */
  getSectionTitle(index: number): string | null {
    const pq = this.playerQuestions[index];
    if (!pq) return null;
    const title = pq.data?.sectionTitle;
    if (!title) return null;
    const prev = this.playerQuestions[index - 1];
    const prevTitle = prev?.data?.sectionTitle;
    return title !== prevTitle ? title : null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  New audio-based pronunciation flow (MediaRecorder → Whisper → Scoring)
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Template bindings use pq.isRecording + pq.pronUiState + pq.pronMessage.
  // We deliberately keep these flags in sync with the legacy SR path so the
  // existing UI (Listening indicator, buttons, chat) keeps working.

  /** Convenience label for the template. */
  pronUiLabel(pq: PlayerQuestion | null | undefined): string {
    const state = pq?.pronUiState || 'idle';
    switch (state) {
      case 'recording':   return pq?.pronMessage || '🎤 Listening…';
      case 'processing':  return pq?.pronMessage || 'Processing…';
      case 'error':       return pq?.pronMessage || 'No speech detected, try again';
      case 'result':      return pq?.pronMessage || '';
      case 'idle':
      default:            return pq?.pronMessage || 'Click to Speak';
    }
  }

  private clearPronAutoStopTimer(): void {
    if (!this.pronAutoStopTimer) return;
    clearTimeout(this.pronAutoStopTimer);
    this.pronAutoStopTimer = null;
  }

  private armPronAutoStop(pq: PlayerQuestion, kind: 'word' | 'clip'): void {
    this.clearPronAutoStopTimer();
    this.pronAutoStopTimer = setTimeout(() => {
      if (this.activePronQuestion !== pq) return;
      console.info('[pronunciation] auto-stop fired', { kind, index: pq.index });
      if (kind === 'clip') void this.finishAudioPronunciationForClip(pq);
      else void this.finishAudioPronunciationForWord(pq);
    }, DigitalExercisePlayerComponent.MAX_RECORDING_MS);
  }

  private resolveLanguageBcp47(): 'de-DE' | 'en-US' {
    return this.exercise?.targetLanguage === 'English' ? 'en-US' : 'de-DE';
  }

  private resolvePronVariants(pq: PlayerQuestion): string[] {
    const v = pq?.data?.acceptedVariants;
    return Array.isArray(v) ? v.filter((s: unknown) => typeof s === 'string') : [];
  }

  private async ensureRecordingStarted(pq: PlayerQuestion): Promise<boolean> {
    try {
      await this.pronunciation.startRecording();
      this.activePronQuestion = pq;
      pq.isRecording = true;
      pq.pronUiState = 'recording';
      pq.pronMessage = '🎤 Listening…';
      return true;
    } catch (err: any) {
      const code = err?.code || 'UNKNOWN';
      console.error('[pronunciation] startRecording failed', { code, message: err?.message });
      pq.isRecording = false;
      pq.pronUiState = 'error';
      pq.pronMessage = err?.message || 'Microphone unavailable';
      this.activePronQuestion = null;
      const msg = err?.message || 'Microphone could not be started. Please check your mic and try again.';
      this.snackBar.open(msg, 'Close', { duration: 5000 });
      if (code === 'PERMISSION_DENIED') this.micPermission = 'denied';
      return false;
    }
  }

  // ── Word-level pronunciation (single word) ────────────────────────────

  private async startAudioPronunciationForWord(pq: PlayerQuestion): Promise<void> {
    if (pq.isRecording) return;
    const started = await this.ensureRecordingStarted(pq);
    if (!started) return;
    this.armPronAutoStop(pq, 'word');
  }

  private async finishAudioPronunciationForWord(pq: PlayerQuestion): Promise<void> {
    if (this.activePronQuestion !== pq) return;
    this.clearPronAutoStopTimer();
    this.activePronQuestion = null;

    let recording: RecordingResult | null = null;
    try {
      recording = await this.pronunciation.stopRecording();
    } catch (err: any) {
      console.error('[pronunciation] stopRecording failed (word)', err);
      pq.isRecording = false;
      pq.pronUiState = 'error';
      pq.pronMessage = 'Recording failed, try again';
      this.snackBar.open('Could not capture audio. Please try again.', 'Close', { duration: 3500 });
      return;
    }
    pq.isRecording = false;

    if (!recording || recording.blob.size === 0) {
      pq.pronUiState = 'error';
      pq.pronMessage = 'No audio captured, try again';
      this.snackBar.open('No speech detected. Please try again.', 'Close', { duration: 3000 });
      this.pronunciation.releaseObjectUrl(recording?.objectUrl);
      return;
    }

    // Adaptive silence thresholds — honour user profile + device tuning.
    const device = this.deviceInfo || this.pronAnalytics.getDeviceInfo(this.pronCapabilities);
    const adaptive = this.pronAnalytics.getAdaptiveThresholds(device);
    this.lastAdaptiveThresholds = adaptive;
    const silence = this.pronunciation.evaluateSilence(recording.durationMs, {
      minAverageLevel: adaptive.minAverageLevel,
      minPeakLevel: adaptive.minPeakLevel,
      minDurationMs: adaptive.minDurationMs,
    });
    this.lastSilenceByIndex[pq.index] = silence;

    const attemptKey = this.pronAttemptKey(pq, 'word');
    const retryCount = this.pronAnalytics.getFailCount(attemptKey);
    const lang = this.resolveLanguageBcp47();

    if (!silence.ok) {
      console.info('[pronunciation] local silence reject (word)', silence);
      pq.pronUiState = 'error';
      pq.pronMessage = this.silentRejectMessage(silence.reason);
      this.snackBar.open(pq.pronMessage, 'Close', { duration: 4000 });
      this.pronAnalytics.sendTelemetry(
        {
          silenceRejected: true,
          silenceReason: silence.reason || null,
          retryCount,
          language: lang,
          audioPeak: round4(silence.stats.peak),
          audioAverage: round4(silence.stats.average),
          recordingDuration: recording.durationMs,
        },
        device,
      );
      this.updateDebugSnapshot({
        pqIndex: pq.index,
        mode: 'word',
        stats: silence.stats,
        silenceReason: silence.reason || 'too-quiet',
        thresholds: adaptive,
        transcript: '',
        score: 0,
        confidence: null,
        assistedMode: false,
        retryCount,
      });
      this.pronunciation.releaseObjectUrl(recording.objectUrl);
      return;
    }

    pq.pronUiState = 'processing';
    pq.pronMessage = 'Processing…';
    this.armPronProcessingSlowTimer();

    const expected = String(pq.data?.word || '');
    const variants = this.resolvePronVariants(pq);
    const baseThreshold = Number(pq.data?.similarityThreshold);
    const baseThresholdSafe = Number.isFinite(baseThreshold) ? baseThreshold : 70;
    const assisted = this.assistedModeByIndex[pq.index] === true;
    const threshold = this.pronAnalytics.adjustThreshold(baseThresholdSafe, assisted);
    const meta = this.buildClientMeta({
      mode: 'word',
      recording,
      stats: silence.stats,
      silenceRejected: false,
      silenceReason: null,
      retryCount,
      assistedMode: assisted,
      thresholds: adaptive,
    });

    try {
      const res = await this.pronunciation
        .evaluateAudio(recording.blob, {
          expected,
          language: lang,
          variants,
          threshold,
          clientMeta: meta,
        })
        .toPromise() as PronunciationEvaluateResponse;

      console.info('[pronunciation] word result', {
        ...meta,
        transcriptLength: res.transcript.length,
        score: res.score,
        confidence: res.confidence,
        requestId: res.requestId,
        engine: res.engine,
      });

      pq.spokenText = res.transcript || '';
      pq.pronunciationScore = res.score;
      pq.hasRecorded = true;
      pq.pronUiState = 'result';
      pq.pronMessage = null as unknown as string;
      pq.pronEngine = res.engine;
      pq.pronRequestId = res.requestId;
      pq.pronAlmostCorrect = !!res.isAlmostCorrect && !res.isCorrect;
      pq.pronWordAnalysis = res.wordAnalysis || [];
      pq.pronHints = res.hints || [];
      pq.pronExpectedText = res.expectedText || expected;
      pq.pronMissingWords = Array.isArray((res as any).feedback?.missingWords) ? (res as any).feedback.missingWords : [];
      pq.pronExtraWords = Array.isArray((res as any).feedback?.extraWords) ? (res as any).feedback.extraWords : [];
      pq.pronMatchedWords = Array.isArray((res as any).feedback?.matchedWords) ? (res as any).feedback.matchedWords : [];
      pq.pronLowAudioQuality = Boolean((res as any).flags?.lowAudioQuality);
      pq.pronAttemptCount = Number(pq.pronAttemptCount || 0) + 1;
      pq.pronHelpOpen = false;
      this.lastConfidenceByIndex[pq.index] = res.confidence;
      this.markAttempted(pq);

      const passed = !!res.isCorrect;
      // Almost-correct attempts do NOT count as failures (no retry-counter increment).
      const countAsFail = !passed && !res.isAlmostCorrect;
      const nextFailCount = countAsFail
        ? this.pronAnalytics.recordAttemptOutcome(attemptKey, false)
        : this.pronAnalytics.getFailCount(attemptKey);
      if (passed) {
        this.pronAnalytics.recordSuccessfulAttempt({
          average: silence.stats.average,
          peak: silence.stats.peak,
          durationMs: recording.durationMs,
        });
        this.assistedModeByIndex[pq.index] = false;
        this.autoReplayArmedFor[pq.index] = false;
      } else if (countAsFail) {
        this.maybeTriggerSmartAssistWord(pq, nextFailCount);
      }

      this.updateDebugSnapshot({
        pqIndex: pq.index,
        mode: 'word',
        stats: silence.stats,
        silenceReason: 'ok',
        thresholds: adaptive,
        transcript: res.transcript || '',
        score: res.score,
        confidence: res.confidence || null,
        assistedMode: !!res.assistedMode,
        retryCount,
      });
    } catch (err: any) {
      console.error('[pronunciation] evaluate failed (word)', err);
      pq.pronUiState = 'error';
      if (this.isNetworkError(err)) {
        pq.pronMessage = 'Network issue. Please try again.';
        this.snackBar.open('Network issue — could not reach the server. Please try again.', 'Close', { duration: 4500 });
        this.pronAnalytics.sendTelemetry(
          { networkError: true, retryCount, language: lang, recordingDuration: recording.durationMs },
          device,
        );
      } else {
        pq.pronMessage = 'Scoring failed, try again';
        this.snackBar.open('Could not reach the pronunciation grader. Please try again.', 'Close', { duration: 4000 });
      }
    } finally {
      this.clearPronProcessingSlowTimer();
      this.pronunciation.releaseObjectUrl(recording.objectUrl);
    }
  }

  /** After a failed word attempt, flip on assisted mode / auto-replay per spec. */
  private maybeTriggerSmartAssistWord(pq: PlayerQuestion, failCount: number): void {
    // At 2 fails: activate assisted mode (relaxed threshold) + show hint.
    if (failCount >= 2) {
      this.assistedModeByIndex[pq.index] = true;
    }
    if (failCount === 2 && !this.autoReplayArmedFor[pq.index]) {
      this.autoReplayArmedFor[pq.index] = true;
      this.snackBar.open('Try speaking a bit slower and more clearly.', 'Close', { duration: 4000 });
      setTimeout(() => this.replayReferenceForRetry(pq), 300);
    }
  }

  // ── Clip-level pronunciation (video-pronunciation) ────────────────────

  private async startAudioPronunciationForClip(pq: PlayerQuestion): Promise<void> {
    pq.vpResult = 'idle';
    this.clearVpFeedbackUi();
    this.muteVpVideoDuringPronunciation();
    const started = await this.ensureRecordingStarted(pq);
    if (!started) {
      this.restoreVpVideoAfterPronunciation();
      // Match legacy behaviour: count as a failed attempt so retry counters work.
      pq.vpFailCount = (pq.vpFailCount || 0) + 1;
      pq.vpResult = 'incorrect';
      pq.hasRecorded = true;
      pq.pronunciationScore = 0;
      pq.vpSpokenText = '';
      pq.isAnswered = true;
      this.markAttempted(pq);
      return;
    }
    this.armPronAutoStop(pq, 'clip');
  }

  private async finishAudioPronunciationForClip(pq: PlayerQuestion): Promise<void> {
    if (this.activePronQuestion !== pq) return;
    this.clearPronAutoStopTimer();
    this.activePronQuestion = null;

    let recording: RecordingResult | null = null;
    try {
      recording = await this.pronunciation.stopRecording();
    } catch (err: any) {
      console.error('[pronunciation] stopRecording failed (clip)', err);
      this.applyVpFailureFromAudioFlow(pq, 'recording-failed');
      return;
    }
    pq.isRecording = false;

    if (!recording || recording.blob.size === 0) {
      this.applyVpFailureFromAudioFlow(pq, 'no-audio', recording?.objectUrl || null);
      return;
    }

    // Adaptive silence thresholds — honour user profile + device tuning.
    const device = this.deviceInfo || this.pronAnalytics.getDeviceInfo(this.pronCapabilities);
    const adaptive = this.pronAnalytics.getAdaptiveThresholds(device);
    this.lastAdaptiveThresholds = adaptive;
    const silence = this.pronunciation.evaluateSilence(recording.durationMs, {
      minAverageLevel: adaptive.minAverageLevel,
      minPeakLevel: adaptive.minPeakLevel,
      minDurationMs: adaptive.minDurationMs,
    });
    this.lastSilenceByIndex[pq.index] = silence;

    const attemptKey = this.pronAttemptKey(pq, 'clip');
    const retryCount = this.pronAnalytics.getFailCount(attemptKey);
    const lang = this.resolveLanguageBcp47();

    if (!silence.ok) {
      console.info('[pronunciation] local silence reject (clip)', silence);
      this.pronAnalytics.sendTelemetry(
        {
          silenceRejected: true,
          silenceReason: silence.reason || null,
          retryCount,
          language: lang,
          audioPeak: round4(silence.stats.peak),
          audioAverage: round4(silence.stats.average),
          recordingDuration: recording.durationMs,
        },
        device,
      );
      this.updateDebugSnapshot({
        pqIndex: pq.index,
        mode: 'clip',
        stats: silence.stats,
        silenceReason: silence.reason || 'too-quiet',
        thresholds: adaptive,
        transcript: '',
        score: 0,
        confidence: null,
        assistedMode: false,
        retryCount,
      });
      this.applyVpSilenceRejection(pq, silence, recording.objectUrl);
      return;
    }

    pq.pronUiState = 'processing';
    pq.pronMessage = 'Processing…';
    this.armPronProcessingSlowTimer();

    const expected = this.speakTargetCaptionForQuestion(pq);
    const variants = this.resolvePronVariants(pq);
    const baseThreshold = this.videoPassThresholdForQuestion(pq);
    const assisted = this.assistedModeByIndex[pq.index] === true;
    const threshold = this.pronAnalytics.adjustThreshold(baseThreshold, assisted);
    const meta = this.buildClientMeta({
      mode: 'clip',
      recording,
      stats: silence.stats,
      silenceRejected: false,
      silenceReason: null,
      retryCount,
      assistedMode: assisted,
      thresholds: adaptive,
    });

    try {
      const res = await this.pronunciation
        .evaluateAudio(recording.blob, {
          expected,
          language: lang,
          variants,
          threshold,
          clientMeta: meta,
        })
        .toPromise() as PronunciationEvaluateResponse;

      console.info('[pronunciation] clip result', {
        ...meta,
        transcriptLength: res.transcript.length,
        score: res.score,
        confidence: res.confidence,
        requestId: res.requestId,
        engine: res.engine,
      });

      this.lastConfidenceByIndex[pq.index] = res.confidence;
      const passed = !!res.isCorrect;
      const nextFailCount = this.pronAnalytics.recordAttemptOutcome(attemptKey, passed);
      if (passed) {
        this.pronAnalytics.recordSuccessfulAttempt({
          average: silence.stats.average,
          peak: silence.stats.peak,
          durationMs: recording.durationMs,
        });
        this.assistedModeByIndex[pq.index] = false;
        this.autoReplayArmedFor[pq.index] = false;
      } else {
        this.maybeTriggerSmartAssistClip(pq, nextFailCount);
      }

      this.updateDebugSnapshot({
        pqIndex: pq.index,
        mode: 'clip',
        stats: silence.stats,
        silenceReason: 'ok',
        thresholds: adaptive,
        transcript: res.transcript || '',
        score: res.score,
        confidence: res.confidence || null,
        assistedMode: !!res.assistedMode,
        retryCount,
      });

      this.applyVpSuccessFromAudioFlow(pq, res, threshold);
    } catch (err: any) {
      console.error('[pronunciation] evaluate failed (clip)', err);
      const network = this.isNetworkError(err);
      if (network) {
        this.pronAnalytics.sendTelemetry(
          { networkError: true, retryCount, language: lang, recordingDuration: recording.durationMs },
          device,
        );
      }
      this.applyVpFailureFromAudioFlow(pq, network ? 'network-error' : 'evaluate-failed');
    } finally {
      this.clearPronProcessingSlowTimer();
      this.pronunciation.releaseObjectUrl(recording.objectUrl);
      this.restoreVpVideoAfterPronunciation();
    }
  }

  /** Clip-flow equivalent of the word smart-assist trigger. */
  private maybeTriggerSmartAssistClip(pq: PlayerQuestion, failCount: number): void {
    if (failCount >= 2) {
      this.assistedModeByIndex[pq.index] = true;
    }
    if (failCount === 2 && !this.autoReplayArmedFor[pq.index]) {
      this.autoReplayArmedFor[pq.index] = true;
      this.snackBar.open('Try speaking a bit slower and more clearly.', 'Close', { duration: 4000 });
      setTimeout(() => this.replayReferenceForRetry(pq), 300);
    }
  }

  /** Capture a debug snapshot used by the optional dev panel. */
  private updateDebugSnapshot(s: {
    pqIndex: number;
    mode: 'word' | 'clip';
    stats: { peak: number; average: number; durationMs: number; samples: number };
    silenceReason: 'too-short' | 'too-quiet' | 'ok';
    thresholds: AdaptiveThresholds | null;
    transcript: string;
    score: number;
    confidence: PronunciationConfidence | null;
    assistedMode: boolean;
    retryCount: number;
  }): void {
    this.lastPronDebugSnapshot = { ...s, at: Date.now() };
  }

  /**
   * Silent/too-short clip recordings — we keep the student on the same clip
   * (do NOT mark as a wrong attempt that consumes their retry count) and
   * explain exactly why. Counter is left untouched so this doesn't punish
   * mic hiccups.
   */
  private applyVpSilenceRejection(
    pq: PlayerQuestion,
    silence: SilenceCheckResult,
    objectUrlToRelease: string,
  ): void {
    this.pronunciation.releaseObjectUrl(objectUrlToRelease);
    pq.isRecording = false;
    pq.pronUiState = 'error';
    pq.pronMessage = this.silentRejectMessage(silence.reason);
    // Keep vpResult = idle so the main mic button reappears rather than
    // going through the incorrect/retry flow.
    pq.vpResult = 'idle';
    this.snackBar.open(pq.pronMessage, 'Close', { duration: 4000 });
    if (this.isVideoOnlyExercise) {
      this.pushVpChat('tutor', pq.pronMessage);
    }

    // Ensure we restore the reference video audio after this recording ends.
    this.restoreVpVideoAfterPronunciation();
  }

  private applyVpSuccessFromAudioFlow(
    pq: PlayerQuestion,
    res: PronunciationEvaluateResponse,
    threshold: number,
  ): void {
    pq.vpSpokenText = res.transcript || '';
    pq.pronunciationScore = res.score;
    pq.hasRecorded = true;
    pq.pronEngine = res.engine;
    pq.pronRequestId = res.requestId;
    pq.vpWordAnalysis = res.wordAnalysis || [];
    pq.vpHints = res.hints || [];
    pq.vpExpectedText = res.expectedText || '';
    pq.pronMissingWords = Array.isArray((res as any).feedback?.missingWords) ? (res as any).feedback.missingWords : [];
    pq.pronExtraWords = Array.isArray((res as any).feedback?.extraWords) ? (res as any).feedback.extraWords : [];
    pq.pronMatchedWords = Array.isArray((res as any).feedback?.matchedWords) ? (res as any).feedback.matchedWords : [];
    pq.pronLowAudioQuality = Boolean((res as any).flags?.lowAudioQuality);
    pq.pronAttemptCount = Number(pq.pronAttemptCount || 0) + 1;
    pq.pronHelpOpen = false;

    const isCorrect = res.isCorrect;
    const isAlmostCorrect = !!res.isAlmostCorrect && !isCorrect;
    pq.vpAlmostCorrect = isAlmostCorrect;

    if (isCorrect) {
      pq.vpResult = 'correct';
    } else if (isAlmostCorrect) {
      pq.vpResult = 'almostCorrect';
    } else {
      pq.vpResult = 'incorrect';
    }

    pq.pronUiState = 'result';
    pq.pronMessage = null as unknown as string;

    // Almost-correct does NOT count as a failure attempt.
    if (!isCorrect && !isAlmostCorrect) {
      pq.vpFailCount = (pq.vpFailCount || 0) + 1;
    }
    this.markAttempted(pq);

    if (this.isVideoOnlyExercise) {
      this.pushVpChat('user', pq.vpSpokenText || '(no audio)', { isCorrect, score: pq.pronunciationScore || 0 });
      if (isCorrect) {
        this.pushVpChat('tutor', this.confidenceHeadline(res.confidence) || 'Great job!');
      } else if (isAlmostCorrect) {
        this.pushVpChat('tutor', 'Almost there — try once more for a perfect score!');
      } else {
        const headline = this.confidenceHeadline(res.confidence) || 'Not quite';
        this.pushVpChat('tutor', `${headline} — target is ${threshold}%+. Choose retry or next clip.`);
      }
    }

    if (isCorrect) {
      if (pq.vpAutoAdvanceTimer) clearTimeout(pq.vpAutoAdvanceTimer);
      pq.vpAutoAdvanceTimer = undefined;
      void this.runVpCorrectAdvanceSequence(pq);
    } else if (isAlmostCorrect) {
      // Almost correct: stay on clip, show feedback, let student decide to retry or continue.
      void this.runVpIncorrectFeedbackSequence(pq);
    } else {
      void this.runVpIncorrectFeedbackSequence(pq);
    }
  }

  private applyVpFailureFromAudioFlow(
    pq: PlayerQuestion,
    reason: 'no-audio' | 'evaluate-failed' | 'recording-failed' | 'network-error',
    objectUrlToRelease: string | null = null,
  ): void {
    if (objectUrlToRelease) this.pronunciation.releaseObjectUrl(objectUrlToRelease);
    pq.isRecording = false;
    pq.pronUiState = 'error';
    pq.pronunciationScore = 0;
    pq.vpSpokenText = '';

    // Network errors should NOT be counted as a wrong answer or graded as 0%.
    // Leave the clip in idle so the student can simply tap Speak again.
    if (reason === 'network-error') {
      pq.vpResult = 'idle';
      pq.pronMessage = 'Network issue. Please try again.';
      this.snackBar.open('Network issue — could not reach the server. Please try again.', 'Close', { duration: 4500 });
      if (this.isVideoOnlyExercise) {
        this.pushVpChat('tutor', 'Network issue — please tap Speak once your connection is stable.');
      }
      this.restoreVpVideoAfterPronunciation();
      return;
    }

    pq.vpFailCount = (pq.vpFailCount || 0) + 1;
    pq.hasRecorded = true;
    pq.vpResult = 'incorrect';
    pq.isAnswered = true;
    this.markAttempted(pq);

    const reasonMessages: Record<'no-audio' | 'evaluate-failed' | 'recording-failed', string> = {
      'no-audio':         'No speech detected. Please try again.',
      'evaluate-failed':  'Could not reach the pronunciation grader. Please try again.',
      'recording-failed': 'Could not capture audio. Please try again.',
    };
    pq.pronMessage = reason === 'no-audio' ? 'No speech detected, try again' : 'Try again';
    this.snackBar.open(reasonMessages[reason], 'Close', { duration: 4000 });

    if (this.isVideoOnlyExercise) {
      this.pushVpChat('tutor', 'I could not hear your full sentence. Please tap Speak and try again.');
      if ((pq.vpFailCount || 0) >= DigitalExercisePlayerComponent.VP_MAX_FAILED_ATTEMPTS_PER_CLIP) {
        this.pushVpChat(
          'tutor',
          `I could not hear enough input after ${DigitalExercisePlayerComponent.VP_MAX_FAILED_ATTEMPTS_PER_CLIP} tries. You can retry or move to the next clip.`,
        );
      }
    }

    // Ensure we restore the reference video audio after this recording ends.
    this.restoreVpVideoAfterPronunciation();
  }

  /**
   * One-shot reference replay used after an incorrect attempt.
   * For video-pronunciation clips we replay the video; for word-level
   * pronunciation we play the word's audio (or TTS fallback).
   * Guarded per-question so we replay at most once per incorrect cycle.
   */
  replayReferenceForRetry(pq: PlayerQuestion): void {
    if (!pq) return;
    if (pq.data?.type === 'video-pronunciation') {
      this.replayVpVideo();
    } else if (pq.data?.type === 'pronunciation') {
      this.playWordAudio(pq);
    }
  }

  // ── Mic test (bonus) ──────────────────────────────────────────────────

  openMicTest(): void {
    this.micTestError = null;
    this.micTestAudioUrl = null;
    this.micTestBlob = null;
    this.micTestState = 'idle';
    this.micTestOpen = true;
  }

  closeMicTest(): void {
    this.micTestOpen = false;
    this.micTestState = 'idle';
    if (this.micTestCountdownTimer) {
      clearInterval(this.micTestCountdownTimer);
      this.micTestCountdownTimer = null;
    }
    this.micTestCountdown = 0;
    if (this.micTestAudioUrl) {
      this.pronunciation.releaseObjectUrl(this.micTestAudioUrl);
      this.micTestAudioUrl = null;
    }
    this.micTestBlob = null;
    this.stopBoostedMicPlayback();
    // Make sure we don't leave the mic running.
    try { this.pronunciation.cancelRecording(); } catch { /* noop */ }
  }

  async runMicTest(): Promise<void> {
    if (this.micTestState === 'recording') return;
    if (!this.audioRecorderSupported) {
      this.micTestError = 'Audio recording is not supported in this browser.';
      this.micTestState = 'error';
      return;
    }
    if (this.micTestAudioUrl) {
      this.pronunciation.releaseObjectUrl(this.micTestAudioUrl);
      this.micTestAudioUrl = null;
    }
    this.micTestBlob = null;
    this.stopBoostedMicPlayback();
    this.micTestError = null;
    this.micTestState = 'recording';
    this.micTestCountdown = 5;
    this.micTestCountdownTimer = setInterval(() => {
      this.micTestCountdown = Math.max(0, this.micTestCountdown - 1);
    }, 1000);

    try {
      const result = await this.pronunciation.recordQuickSample(5000);
      const quietCheck = this.pronunciation.evaluateSilence(result.durationMs, {
        minDurationMs: 650,
        minAverageLevel: 0.008,
        minPeakLevel: 0.03,
      });
      this.micTestAudioUrl = result.objectUrl;
      this.micTestBlob = result.blob;
      this.micTestState = 'ready';
      this.micTestError = !quietCheck.ok && quietCheck.reason === 'too-quiet'
        ? 'Your mic sounds very low. Try moving closer and increasing microphone input volume.'
        : null;
      console.info('[pronunciation] mic test ok', {
        durationMs: result.durationMs,
        audioSize: result.blob.size,
        mimeType: result.mimeType,
      });
    } catch (err: any) {
      console.error('[pronunciation] mic test failed', err);
      this.micTestError = err?.message || 'Microphone test failed';
      this.micTestState = 'error';
    } finally {
      if (this.micTestCountdownTimer) {
        clearInterval(this.micTestCountdownTimer);
        this.micTestCountdownTimer = null;
      }
      this.micTestCountdown = 0;
    }
  }

  async playMicTestBoosted(): Promise<void> {
    if (!this.micTestBlob) return;
    this.stopBoostedMicPlayback();
    try {
      const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const arr = await this.micTestBlob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arr.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      const gain = ctx.createGain();
      gain.gain.value = 2.2;
      src.connect(gain).connect(ctx.destination);
      src.onended = () => this.stopBoostedMicPlayback();
      this.micTestBoostAudioCtx = ctx;
      this.micTestBoostSource = src;
      src.start(0);
    } catch (err) {
      console.warn('[pronunciation] boosted mic playback failed', err);
      this.stopBoostedMicPlayback();
      this.snackBar.open('Could not play boosted audio. Use normal play below.', 'Close', { duration: 2500 });
    }
  }

  private stopBoostedMicPlayback(): void {
    try { this.micTestBoostSource?.stop(); } catch { /* noop */ }
    try { this.micTestBoostSource?.disconnect(); } catch { /* noop */ }
    this.micTestBoostSource = null;
    if (this.micTestBoostAudioCtx) {
      this.micTestBoostAudioCtx.close().catch(() => { /* noop */ });
      this.micTestBoostAudioCtx = null;
    }
  }
}

function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}
