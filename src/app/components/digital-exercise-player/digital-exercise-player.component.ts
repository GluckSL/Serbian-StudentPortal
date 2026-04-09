// src/app/components/digital-exercise-player/digital-exercise-player.component.ts

import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DigitalExerciseService, DigitalExercise, ExerciseQuestion,
  QuestionResponse, SubmitResult
} from '../../services/digital-exercise.service';
import { resolveMediaUrl } from '../../utils/media-url';
import { countFillBlankRuns, splitFillBlankSentence } from '../../utils/fill-blank';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';
import { AuthService } from '../../services/auth.service';
import { take } from 'rxjs/operators';

type PlayerState = 'loading' | 'intro' | 'playing' | 'submitted' | 'review' | 'error';

interface VpChatMessage {
  id: string;
  role: 'tutor' | 'user';
  text: string;
  isCorrect?: boolean;
  score?: number;
}

interface PlayerQuestion {
  data: any; // raw question data from API
  index: number;
  // MCQ state
  selectedOption?: number;
  // Matching state
  matchingLeft?: Array<{ value: string; matchedRightIndex: number | null }>;
  matchingRight?: Array<{ value: string; matchedLeftIndex: number | null }>;
  selectedLeftIndex?: number | null;
  // Fill-blank state
  fillAnswers?: string[];
  // Pronunciation state
  spokenText?: string;
  pronunciationScore?: number;
  isRecording?: boolean;
  hasRecorded?: boolean;
  // Question/Answer state
  qaResponse?: string;
  // Listening state
  listeningText?: string;
  // Video Pronunciation state
  vpSpokenText?: string;
  vpResult?: 'idle' | 'correct' | 'incorrect';
  vpAutoAdvanceTimer?: any;
  /** Bumped to cancel in-flight praise/retry sequences (e.g. user hits Try again). */
  vpAdvanceSeq?: number;
  /** True after the clip fires `ended` — then Replay + Speak are shown */
  vpPlaybackEnded?: boolean;
  /** Number of failed pronunciation attempts (incorrect result or speech error) for this clip. */
  vpFailCount?: number;
  // Result state
  isAnswered?: boolean;
  isCorrect?: boolean | null;
  feedback?: string;
}

@Component({
  selector: 'app-digital-exercise-player',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './digital-exercise-player.component.html',
  styleUrls: ['./digital-exercise-player.component.css']
})
export class DigitalExercisePlayerComponent implements OnInit, OnDestroy {
  state: PlayerState = 'loading';
  exercise: DigitalExercise | null = null;
  exerciseId = '';
  attemptId = '';

  playerQuestions: PlayerQuestion[] = [];
  currentIndex = 0;
  submitting = false;
  showFinishSummary = false;
  finishingAll = false;

  startTime = 0;
  elapsedSeconds = 0;
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

  // Speech recognition
  private recognition: any = null;
  private listeningRecognition: any = null;
  speechSupported = false;

  /** Current video-pronunciation element (for autoplay / replay). */
  private vpVideoElement: HTMLVideoElement | null = null;

  /** Admin-uploaded praise / retry clip (video exercises). */
  private vpFeedbackAudioEl: HTMLAudioElement | null = null;
  /** Optional line from admin (e.g. “Try again”) shown under feedback while clip may play. */
  vpFeedbackCaption: string | null = null;

  /** Practice history chat (video-only exercises). */
  vpChatMessages: VpChatMessage[] = [];
  private vpChatSeq = 0;
  private vpChatClipPrompted = new Set<number>();

  @ViewChild('vpChatScroll') vpChatScroll?: ElementRef<HTMLDivElement>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    public exerciseService: DigitalExerciseService,
    private snackBar: MatSnackBar,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.exerciseId = this.route.snapshot.paramMap.get('id') || '';
    this.checkSpeechSupport();
    this.loadExercise();
  }

  ngOnDestroy(): void {
    this.stopTimer();
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
    }
    this.stopVpFeedbackAudio();
    this.playerQuestions.forEach(pq => {
      if (pq.vpAutoAdvanceTimer) clearTimeout(pq.vpAutoAdvanceTimer);
    });
  }

  private checkSpeechSupport(): void {
    this.speechSupported = !!(('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window));
  }

  loadExercise(): void {
    this.state = 'loading';
    this.authService.currentUser$.pipe(take(1)).subscribe((user) => {
      const asStudent = user?.role === 'STUDENT';
      this.exerciseService.getExercise(this.exerciseId, { asStudent }).subscribe({
        next: (exercise) => {
          this.exercise = exercise;
          this.initPlayerQuestions();
          // Start immediately when user clicks "Start" from the list page.
          this.startExercise();
        },
        error: () => { this.state = 'error'; }
      });
    });
  }

  private initPlayerQuestions(): void {
    if (!this.exercise) return;
    this.vpOptimisticCompletion = false;
    this.playerQuestions = this.exercise.questions.map((q: any, i: number) => {
      const pq: PlayerQuestion = { data: q, index: i, isAnswered: false };

      if (q.type === 'mcq') {
        pq.selectedOption = undefined;
      } else if (q.type === 'matching') {
        const leftItems = (q.pairs || []).map((p: any) => ({ value: p.left, matchedRightIndex: null }));
        const rightItems = q.shuffledRight
          ? q.shuffledRight.map((r: string) => ({ value: r, matchedLeftIndex: null }))
          : (q.pairs || []).map((_: any, idx: number) => ({ value: q.pairs[idx].right, matchedLeftIndex: null }));
        pq.matchingLeft = leftItems;
        pq.matchingRight = rightItems;
        pq.selectedLeftIndex = null;
      } else if (q.type === 'fill-blank') {
        const count = countFillBlankRuns(q.sentence || '');
        pq.fillAnswers = new Array(count).fill('');
      } else if (q.type === 'pronunciation') {
        pq.spokenText = '';
        pq.pronunciationScore = 0;
        pq.isRecording = false;
        pq.hasRecorded = false;
      } else if (q.type === 'question-answer') {
        pq.qaResponse = '';
      } else if (q.type === 'listening') {
        pq.listeningText = '';
      } else if (q.type === 'video-pronunciation') {
        pq.vpSpokenText = '';
        pq.vpResult = 'idle';
        pq.isRecording = false;
        pq.hasRecorded = false;
        pq.vpPlaybackEnded = false;
        pq.vpAdvanceSeq = 0;
        pq.vpFailCount = 0;
      }
      return pq;
    });
    this.resetVpChat();
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
    if (pq.isCorrect === true) {
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
  }

  pushVpChat(role: 'tutor' | 'user', text: string, extra?: { isCorrect?: boolean; score?: number }): void {
    this.vpChatMessages.push({
      id: `c${++this.vpChatSeq}`,
      role,
      text,
      isCorrect: extra?.isCorrect,
      score: extra?.score
    });
    setTimeout(() => this.scrollVpChatToBottom(), 0);
  }

  private scrollVpChatToBottom(): void {
    const el = this.vpChatScroll?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  /** Tutor line for current clip (once per index). */
  syncVpChatForCurrentQuestion(): void {
    if (!this.isVideoOnlyExercise || this.state !== 'playing') return;
    const pq = this.currentQuestion;
    if (!pq || pq.data?.type !== 'video-pronunciation') return;
    if (this.vpChatClipPrompted.has(this.currentIndex)) return;
    this.vpChatClipPrompted.add(this.currentIndex);
    const n = this.currentIndex + 1;
    const total = this.playerQuestions.length;
    const cap = pq.data.caption || '';
    this.pushVpChat(
      'tutor',
      `Clip ${n} of ${total} — watch the video, then say: "${cap}"`
    );
  }

  private afterVideoOnlyNavigation(): void {
    if (this.isVideoOnlyExercise && this.state === 'playing') {
      this.clearVpFeedbackUi();
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
      this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
      this.maybeAutoSubmitVideoOnlyOnDeadline();
    }, 1000);
  }

  /** After incorrect: retry audio → short pause → reset attempt → replay same clip (video-only).
   *  On the LAST clip we skip the auto-reset so the student can choose: Try again, Replay, or
   *  Submit the exercise — preventing an infinite stuck loop. */
  private async runVpIncorrectFeedbackSequence(pq: PlayerQuestion): Promise<void> {
    if (!this.isVideoOnlyExercise) return;
    const seq = (pq.vpAdvanceSeq = (pq.vpAdvanceSeq || 0) + 1);
    const isLastClip = this.currentIndex >= this.playerQuestions.length - 1;

    await this.playVideoExerciseFeedbackAudioPromise(false);
    if (pq.vpAdvanceSeq !== seq) return;

    // On the last clip: leave state as-is (vpResult = 'incorrect') so the
    // "Submit Exercise" button stays visible. The student is never forced to retry.
    if (isLastClip) return;

    await this.delay(500);
    if (pq.vpAdvanceSeq !== seq) return;
    pq.vpSpokenText = '';
    pq.vpResult = 'idle';
    pq.hasRecorded = false;
    pq.pronunciationScore = 0;
    pq.isAnswered = false;
    this.replayVpVideo();
  }

  /** Submit the video exercise immediately (used when student is stuck on the last clip). */
  finishVideoExercise(): void {
    if (this.finishingAll || this.submitting) return;
    this.finishingAll = true;
    this.stopTimer();
    this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const responses = this.buildAllResponses();
    this.exerciseService.submitAttempt(this.exerciseId, this.attemptId, responses, this.elapsedSeconds).subscribe({
      next: (result) => {
        this.result = result;
        this.finishingAll = false;
        this.applyResultFeedback(result);
        this.state = 'submitted';
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
        if (this.isVideoOnlyExercise) {
          this.resetVpChat();
          const title = this.exercise?.title || 'this lesson';
          this.pushVpChat(
            'tutor',
            `Hey! Let's practice "${title}" together. Watch each clip, then repeat the phrase when it's your turn.`
          );
          this.syncVpChatForCurrentQuestion();
          setTimeout(() => this.scrollVpChatToBottom(), 120);
        }
      },
      error: (err) => {
        this.snackBar.open(err.error?.error || 'Failed to start exercise', 'Close', { duration: 4000 });
        this.state = 'error';
      }
    });
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  get currentQuestion(): PlayerQuestion {
    return this.playerQuestions[this.currentIndex];
  }

  get isFirstQuestion(): boolean { return this.currentIndex === 0; }
  get isLastQuestion(): boolean { return this.currentIndex === this.playerQuestions.length - 1; }
  get answeredCount(): number { return this.playerQuestions.filter(q => q.isAnswered === true).length; }
  get totalPoints(): number { return this.playerQuestions.reduce((s, q) => s + (q.data.points || 1), 0); }
  get unattemptedCount(): number { return this.playerQuestions.length - this.answeredCount; }

  get correctCount(): number { return this.playerQuestions.filter(q => q.isCorrect === true).length; }
  get wrongCount(): number { return this.playerQuestions.filter(q => q.isCorrect === false).length; }
  get unansweredCount(): number { return this.playerQuestions.filter(q => q.isCorrect !== true && q.isCorrect !== false).length; }
  get submittedCount(): number { return this.playerQuestions.filter(q => q.isCorrect === true || q.isCorrect === false).length; }
  get pendingCount(): number { return this.playerQuestions.length - this.submittedCount; }
  /** Backward-compatible alias used by older template fragments. */
  get isSubmittedState(): boolean { return this.state === 'submitted'; }

  prevQuestion(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.afterVideoOnlyNavigation();
    }
  }

  nextQuestion(): void {
    if (this.currentIndex < this.playerQuestions.length - 1) {
      this.currentIndex++;
      this.afterVideoOnlyNavigation();
    }
  }

  goToQuestion(index: number): void {
    this.currentIndex = index;
    this.afterVideoOnlyNavigation();
  }

  isQuestionAnswered(pq: PlayerQuestion): boolean {
    const q = pq.data;
    if (q.type === 'mcq') return pq.selectedOption !== undefined && pq.selectedOption !== null;
    if (q.type === 'matching') return (pq.matchingLeft || []).every(l => l.matchedRightIndex !== null);
    if (q.type === 'fill-blank') return (pq.fillAnswers || []).every(a => a.trim() !== '');
    if (q.type === 'pronunciation') return pq.hasRecorded === true;
    if (q.type === 'question-answer') return (pq.qaResponse || '').trim().length > 0;
    if (q.type === 'listening') return (pq.listeningText || '').trim().length > 0;
    if (q.type === 'video-pronunciation') return pq.hasRecorded === true;
    return false;
  }

  // ─── MCQ Interaction ─────────────────────────────────────────────────────────

  selectOption(pq: PlayerQuestion, index: number): void {
    if (this.state === 'submitted') return;
    pq.selectedOption = index;
    this.markAttempted(pq);
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

  startRecording(pq: PlayerQuestion): void {
    if (!this.speechSupported) {
      this.snackBar.open('Speech recognition not supported in this browser. Try Chrome or Edge.', 'Close', { duration: 5000 });
      return;
    }
    if (pq.isRecording) return;

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    this.recognition = new SpeechRecognition();

    const langMap: Record<string, string> = { 'German': 'de-DE', 'English': 'en-US' };
    this.recognition.lang = langMap[this.exercise?.targetLanguage || 'German'] || 'de-DE';
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 3;

    pq.isRecording = true;

    this.recognition.onresult = (event: any) => {
      const results = event.results[0];
      const best = results[0].transcript.toLowerCase().trim();
      pq.spokenText = results[0].transcript;

      // Calculate pronunciation score
      const target = pq.data.word.toLowerCase().trim();
      const variants = (pq.data.acceptedVariants || []).map((v: string) => v.toLowerCase().trim());
      const allAccepted = [target, ...variants];

      let score = 0;
      if (allAccepted.some(a => a === best)) {
        score = 100;
      } else {
        // Fuzzy match
        const similarity = this.calculateStringSimilarity(best, target);
        score = Math.round(similarity * 100);

        // Check alternatives
        for (const alt of variants) {
          const altSim = this.calculateStringSimilarity(best, alt);
          score = Math.max(score, Math.round(altSim * 100));
        }
      }

      pq.pronunciationScore = score;
      pq.hasRecorded = true;
      pq.isRecording = false;
      this.markAttempted(pq);
    };

    this.recognition.onerror = (event: any) => {
      pq.isRecording = false;
      if (event.error === 'not-allowed') {
        this.snackBar.open('Microphone access denied. Please allow microphone access.', 'Close', { duration: 5000 });
      } else if (event.error === 'no-speech') {
        pq.hasRecorded = false;
        this.snackBar.open('No speech detected. Please try again.', 'Close', { duration: 3000 });
      }
    };

    this.recognition.onend = () => { pq.isRecording = false; };

    this.recognition.start();
  }

  stopRecording(pq: PlayerQuestion): void {
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
    }
    pq.isRecording = false;
  }

  resetPronunciation(pq: PlayerQuestion): void {
    pq.spokenText = '';
    pq.pronunciationScore = 0;
    pq.hasRecorded = false;
  }

  playAudio(url: string): void {
    if (!url) return;
    const audio = new Audio(url);
    audio.play().catch(() => {});
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
    this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const resp: QuestionResponse = { questionIndex: this.currentIndex };
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
    } else if (pq.data.type === 'pronunciation') {
      resp.spokenText = pq.spokenText || '';
      resp.pronunciationScore = pq.pronunciationScore || 0;
    } else if (pq.data.type === 'question-answer') {
      resp.qaResponse = pq.qaResponse || '';
    } else if (pq.data.type === 'listening') {
      resp.listeningText = pq.listeningText || '';
    } else if (pq.data.type === 'video-pronunciation') {
      resp.spokenText = pq.vpSpokenText || '';
      resp.pronunciationScore = pq.pronunciationScore || 0;
    }

    this.exerciseService.submitQuestion(
      this.exerciseId,
      this.attemptId,
      this.currentIndex,
      resp,
      this.elapsedSeconds
    ).subscribe({
      next: (res) => {
        pq.isCorrect = res.isCorrect;
        pq.feedback = this.buildFeedbackFromCorrectAnswer(pq.data, res.correctAnswer, pq);
        if (pq.data.type === 'fill-blank' && res.correctAnswer?.answers) {
          pq.data._correctAnswers = res.correctAnswer.answers;
        }
        if (pq.data.type === 'mcq' && res.correctAnswer?.correctAnswerIndex !== undefined) {
          pq.data.correctAnswerIndex = res.correctAnswer.correctAnswerIndex;
        }
        if (pq.data.type === 'matching' && res.correctAnswer?.pairs) {
          pq.data._correctPairs = res.correctAnswer.pairs;
        }
        this.submitting = false;

        if (res.allSubmitted) {
          this.vpOptimisticCompletion = false;
          this.result = {
            scorePercentage: res.scorePercentage,
            earnedPoints: res.earnedPoints,
            totalPoints: res.totalPoints,
            passed: res.passed,
            answerDetails: this.playerQuestions.map((p, i) => ({
              questionIndex: i,
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
    this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const responses = this.buildAllResponses();
    this.exerciseService.submitAttempt(this.exerciseId, this.attemptId, responses, this.elapsedSeconds).subscribe({
      next: (result) => {
        this.result = result;
        this.finishingAll = false;
        this.applyResultFeedback(result);
        this.state = 'submitted';
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
      else if (pq.data.type === 'pronunciation') {
        resp.spokenText = pq.spokenText || '';
        resp.pronunciationScore = pq.pronunciationScore || 0;
      }       else if (pq.data.type === 'question-answer') resp.qaResponse = pq.qaResponse || '';
      else if (pq.data.type === 'listening') resp.listeningText = pq.listeningText || '';
      else if (pq.data.type === 'video-pronunciation') {
        resp.spokenText = pq.vpSpokenText || '';
        resp.pronunciationScore = pq.pronunciationScore || 0;
      }
      return resp;
    });
  }

  private buildFeedbackFromCorrectAnswer(q: any, correctAnswer: any, pq: PlayerQuestion): string {
    if (!correctAnswer) return '';
    if (q.type === 'mcq' && correctAnswer.explanation) return correctAnswer.explanation;
    if (q.type === 'fill-blank' && correctAnswer.answers) {
      return 'Correct answers: ' + correctAnswer.answers.join(', ');
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
      else if (pq.data.type === 'pronunciation') {
        resp.spokenText = pq.spokenText || '';
        resp.pronunciationScore = pq.pronunciationScore || 0;
      }       else if (pq.data.type === 'question-answer') resp.qaResponse = pq.qaResponse || '';
      else if (pq.data.type === 'listening') resp.listeningText = pq.listeningText || '';
      else if (pq.data.type === 'video-pronunciation') {
        resp.spokenText = pq.vpSpokenText || '';
        resp.pronunciationScore = pq.pronunciationScore || 0;
      }
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
        pq.isCorrect = detail.isCorrect;
        pq.feedback = this.buildFeedback(pq.data, detail.correctAnswer, pq);
        // Store correct answers for display
        if (pq.data.type === 'fill-blank' && detail.correctAnswer?.answers) {
          pq.data._correctAnswers = detail.correctAnswer.answers;
        }
        if (pq.data.type === 'mcq' && detail.correctAnswer?.correctAnswerIndex !== undefined) {
          pq.data.correctAnswerIndex = detail.correctAnswer.correctAnswerIndex;
        }
        if (pq.data.type === 'matching' && detail.correctAnswer?.pairs) {
          pq.data._correctPairs = detail.correctAnswer.pairs;
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
    return '';
  }

  // ─── Timer ────────────────────────────────────────────────────────────────────

  private startTimer(): void {
    this.startTime = Date.now();
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
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
      this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
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
    if (pq.data.type === 'pronunciation') return (pq.spokenText || '—').trim();
    if (pq.data.type === 'question-answer') {
      if (this.isTrueFalseQuestion(pq.data)) {
        const parsed = this.parseTrueFalse(pq.qaResponse);
        return parsed === true ? 'Richtig' : parsed === false ? 'Falsch' : '—';
      }
      return (pq.qaResponse || '—').trim();
    }
    if (pq.data.type === 'listening') return (pq.listeningText || '—').trim();
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
      const ans = (pq.data._correctAnswers || []).join(', ');
      return ans || '—';
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
    if (pq.data.type === 'pronunciation') return pq.data.word || '—';
    if (pq.data.type === 'video-pronunciation') return pq.data.caption || '—';
    return '—';
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

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  getProgressPercentage(): number {
    if (this.playerQuestions.length === 0) return 0;
    return Math.round((this.answeredCount / this.playerQuestions.length) * 100);
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
    return splitFillBlankSentence(sentence || '');
  }

  getQuestionTypes(): Array<{ type: string; count: number; label: string; icon: string; indices: number[] }> {
    const byType: Record<string, number[]> = {};
    const labels: Record<string, string> = { mcq: 'Multiple Choice', matching: 'Matching', 'fill-blank': 'Fill Blanks', pronunciation: 'Pronunciation', 'question-answer': 'Question / Answer', listening: 'Listening', 'video-pronunciation': 'Video Pronunciation' };
    const icons: Record<string, string> = { mcq: 'quiz', matching: 'compare_arrows', 'fill-blank': 'text_fields', pronunciation: 'record_voice_over', 'question-answer': 'short_text', listening: 'headphones', 'video-pronunciation': 'videocam' };
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
    return resolveMediaUrl(relative);
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

  /** Min match score (0–100) to treat a clip as passed and advance (practice-partner / video clips). */
  private static readonly VP_PASS_SCORE = 20;

  onVpLoadStart(): void {
    this.vpVideoElement = null;
  }

  /** When the clip is ready — autoplay without native controls. */
  onVpVideoReady(ev: Event): void {
    const video = ev.target as HTMLVideoElement;
    if (!video) return;
    this.vpVideoElement = video;
    const pq = this.playerQuestions[this.currentIndex];
    if (pq?.data?.type === 'video-pronunciation') {
      pq.vpPlaybackEnded = false;
    }
    video.muted = false;
    video.play().catch(() => {});
  }

  /**
   * When the clip ends, pause and park on the last frame so the student still sees the video
   * (not a blank/white surface), then the dim overlay + speak UI appears on top.
   */
  onVpVideoEnded(ev: Event | null, pq: PlayerQuestion): void {
    if (!pq || pq.data?.type !== 'video-pronunciation') return;
    pq.vpPlaybackEnded = true;
    const v = (ev?.target as HTMLVideoElement) || this.vpVideoElement;
    if (!v) return;
    try {
      v.pause();
      if (v.duration && !isNaN(v.duration) && v.duration > 0) {
        v.currentTime = Math.max(0, v.duration - 0.001);
      }
    } catch {
      /* ignore */
    }
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
    }
    this.clearVpFeedbackUi();
    const v = this.vpVideoElement;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  }

  startVideoPronunciation(pq: PlayerQuestion): void {
    if (this.state === 'submitted') return;
    if (pq.data?.type === 'video-pronunciation' && !pq.vpPlaybackEnded) {
      this.snackBar.open('Finish watching the clip first, then tap Speak.', 'Close', { duration: 3000 });
      return;
    }
    if (!this.speechSupported) {
      this.snackBar.open('Speech recognition not supported in this browser. Try Chrome or Edge.', 'Close', { duration: 5000 });
      return;
    }
    if (pq.isRecording) return;

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const rec = new SpeechRecognition();
    const langMap: Record<string, string> = { 'German': 'de-DE', 'English': 'en-US' };
    rec.lang = langMap[this.exercise?.targetLanguage || 'German'] || 'de-DE';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    pq.isRecording = true;
    pq.vpResult = 'idle';
    this.clearVpFeedbackUi();
    if (this.isVideoOnlyExercise) {
      setTimeout(() => this.scrollVpChatToBottom(), 0);
    }

    rec.onresult = (event: any) => {
      const best = event.results[0][0].transcript.toLowerCase().trim();
      pq.vpSpokenText = event.results[0][0].transcript;
      pq.isRecording = false;
      pq.hasRecorded = true;

      const target = (pq.data.caption || '').toLowerCase().trim();
      const variants = (pq.data.acceptedVariants || []).map((v: string) => v.toLowerCase().trim());
      const allAccepted = [target, ...variants];

      let score = 0;
      if (allAccepted.some(a => a === best)) {
        score = 100;
      } else {
        score = Math.round(this.calculateStringSimilarity(best, target) * 100);
        for (const alt of variants) {
          score = Math.max(score, Math.round(this.calculateStringSimilarity(best, alt) * 100));
        }
      }
      pq.pronunciationScore = score;

      const isCorrect = score >= DigitalExercisePlayerComponent.VP_PASS_SCORE;
      pq.vpResult = isCorrect ? 'correct' : 'incorrect';
      if (!isCorrect) {
        pq.vpFailCount = (pq.vpFailCount || 0) + 1;
      }
      this.markAttempted(pq);

      if (this.isVideoOnlyExercise) {
        this.pushVpChat('user', pq.vpSpokenText || best, { isCorrect, score });
      }

      if (isCorrect) {
        if (pq.vpAutoAdvanceTimer) clearTimeout(pq.vpAutoAdvanceTimer);
        pq.vpAutoAdvanceTimer = undefined;
        void this.runVpCorrectAdvanceSequence(pq);
      } else {
        void this.runVpIncorrectFeedbackSequence(pq);
      }
    };

    rec.onerror = (event: any) => {
      pq.isRecording = false;
      if (event.error === 'not-allowed') {
        pq.vpFailCount = (pq.vpFailCount || 0) + 1;
        this.snackBar.open('Microphone access denied. Please allow microphone access.', 'Close', { duration: 5000 });
      } else if (event.error === 'no-speech') {
        pq.vpFailCount = (pq.vpFailCount || 0) + 1;
        this.snackBar.open('No speech detected. Please try again.', 'Close', { duration: 3000 });
      }
    };

    rec.onend = () => { pq.isRecording = false; };
    rec.start();
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

  /**
   * True when the Skip button should be visible for the current clip:
   * - video-only exercise
   * - student has had ≥ 2 failed attempts (incorrect result OR speech errors)
   * - clip is not already graded correct
   * - not currently recording
   */
  get showVpSkipButton(): boolean {
    if (!this.isVideoOnlyExercise || this.state !== 'playing') return false;
    const pq = this.currentQuestion;
    if (!pq || pq.data?.type !== 'video-pronunciation') return false;
    if (pq.isCorrect === true) return false;
    if (pq.isRecording) return false;
    return (pq.vpFailCount || 0) >= 2;
  }

  /**
   * Skip the current clip: submit it as-is (score 0 / incorrect) then advance.
   * The clip is counted as "attempted" so the exercise can still complete.
   */
  skipVpClip(): void {
    if (this.submitting || this.finishingAll) return;
    const pq = this.currentQuestion;
    if (!pq) return;

    // Mark as attempted with 0 score so the backend grades it as incorrect
    pq.vpSpokenText = pq.vpSpokenText || '';
    pq.pronunciationScore = pq.pronunciationScore || 0;
    pq.vpResult = 'idle';
    pq.isAnswered = true;
    pq.vpAdvanceSeq = (pq.vpAdvanceSeq || 0) + 1;
    this.clearVpFeedbackUi();

    const isLastClip = this.currentIndex >= this.playerQuestions.length - 1;

    if (isLastClip) {
      // Last clip — bulk-submit everything and show result
      this.finishVideoExercise();
    } else {
      // Submit this clip individually then advance
      this.submitCurrentQuestion();
      setTimeout(() => this.nextQuestion(), 300);
    }

    if (this.isVideoOnlyExercise) {
      this.pushVpChat('tutor', 'Skipping to the next clip — you can always come back and practise more!');
    }
  }

  markAttempted(pq: PlayerQuestion): void {
    pq.isAnswered = true;
  }

  isMatchCorrect(pq: PlayerQuestion, leftIndex: number): boolean {
    const matchedRightIndex = pq.matchingLeft![leftIndex].matchedRightIndex;
    if (matchedRightIndex === null || matchedRightIndex === undefined) return false;
    const matchedRightValue = pq.matchingRight![matchedRightIndex].value;
    const correctPairs = pq.data._correctPairs || [];
    const correctForLeft = correctPairs.find((p: any) => p.leftIndex === leftIndex);
    return correctForLeft ? correctForLeft.rightValue === matchedRightValue : false;
  }

  isFillCorrect(pq: PlayerQuestion, blankIndex: number): boolean {
    const correct = (pq.data._correctAnswers || [])[blankIndex];
    const given = (pq.fillAnswers || [])[blankIndex];
    if (!correct || given === undefined) return false;
    return pq.data.caseSensitive
      ? given.trim() === correct.trim()
      : given.trim().toLowerCase() === correct.trim().toLowerCase();
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
}
