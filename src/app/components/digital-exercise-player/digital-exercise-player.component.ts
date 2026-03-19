// src/app/components/digital-exercise-player/digital-exercise-player.component.ts

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DigitalExerciseService, DigitalExercise, ExerciseQuestion,
  QuestionResponse, SubmitResult
} from '../../services/digital-exercise.service';
import { environment } from '../../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../../shared/material.module';

type PlayerState = 'loading' | 'intro' | 'playing' | 'submitted' | 'review' | 'error';

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

  startTime = 0;
  elapsedSeconds = 0;
  timerInterval: any;

  result: SubmitResult | null = null;

  /** Synced with state so template can use it inside *ngIf="state === 'playing'" without type overlap error. */
  isSubmittedState = false;

  // Speech recognition
  private recognition: any = null;
  private listeningRecognition: any = null;
  speechSupported = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public exerciseService: DigitalExerciseService,
    private snackBar: MatSnackBar
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
  }

  private checkSpeechSupport(): void {
    this.speechSupported = !!(('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window));
  }

  loadExercise(): void {
    this.state = 'loading';
    this.exerciseService.getExercise(this.exerciseId).subscribe({
      next: (exercise) => {
        this.exercise = exercise;
        this.initPlayerQuestions();
        this.isSubmittedState = false;
        this.state = 'intro';
      },
      error: () => { this.state = 'error'; }
    });
  }

  private initPlayerQuestions(): void {
    if (!this.exercise) return;
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
        const count = (q.sentence?.match(/___/g) || []).length;
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
      }
      return pq;
    });
  }

  startExercise(): void {
    this.exerciseService.startAttempt(this.exerciseId).subscribe({
      next: (res) => {
        this.attemptId = res.attemptId;
        this.currentIndex = 0;
        this.startTime = Date.now();
        this.startTimer();
        this.isSubmittedState = false;
        this.state = 'playing';
      },
      error: (err) => {
        this.snackBar.open(err.error?.error || 'Failed to start exercise', 'Close', { duration: 4000 });
      }
    });
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  get currentQuestion(): PlayerQuestion {
    return this.playerQuestions[this.currentIndex];
  }

  get isFirstQuestion(): boolean { return this.currentIndex === 0; }
  get isLastQuestion(): boolean { return this.currentIndex === this.playerQuestions.length - 1; }
  get answeredCount(): number { return this.playerQuestions.filter(q => this.isQuestionAnswered(q)).length; }
  get totalPoints(): number { return this.playerQuestions.reduce((s, q) => s + (q.data.points || 1), 0); }

  prevQuestion(): void { if (this.currentIndex > 0) this.currentIndex--; }

  nextQuestion(): void {
    if (this.currentIndex < this.playerQuestions.length - 1) {
      this.currentIndex++;
    }
  }

  goToQuestion(index: number): void { this.currentIndex = index; }

  isQuestionAnswered(pq: PlayerQuestion): boolean {
    const q = pq.data;
    if (q.type === 'mcq') return pq.selectedOption !== undefined && pq.selectedOption !== null;
    if (q.type === 'matching') return (pq.matchingLeft || []).every(l => l.matchedRightIndex !== null);
    if (q.type === 'fill-blank') return (pq.fillAnswers || []).every(a => a.trim() !== '');
    if (q.type === 'pronunciation') return pq.hasRecorded === true;
    if (q.type === 'question-answer') return (pq.qaResponse || '').trim().length > 0;
    if (q.type === 'listening') return (pq.listeningText || '').trim().length > 0;
    return false;
  }

  // ─── MCQ Interaction ─────────────────────────────────────────────────────────

  selectOption(pq: PlayerQuestion, index: number): void {
    if (this.state === 'submitted') return;
    pq.selectedOption = index;
  }

  // ─── Matching Interaction ─────────────────────────────────────────────────────

  selectLeft(pq: PlayerQuestion, index: number): void {
    if (this.state === 'submitted') return;
    if (pq.matchingLeft![index].matchedRightIndex !== null) {
      this.unmatchLeft(pq, index);
      return;
    }
    pq.selectedLeftIndex = index;
  }

  selectRight(pq: PlayerQuestion, rightIndex: number): void {
    if (this.state === 'submitted') return;
    if (pq.selectedLeftIndex === null || pq.selectedLeftIndex === undefined) return;

    const leftIndex = pq.selectedLeftIndex;

    if (pq.matchingRight![rightIndex].matchedLeftIndex !== null) return; // already matched

    pq.matchingLeft![leftIndex].matchedRightIndex = rightIndex;
    pq.matchingRight![rightIndex].matchedLeftIndex = leftIndex;
    pq.selectedLeftIndex = null;
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

  // ─── Submit ───────────────────────────────────────────────────────────────────

  submitExercise(): void {
    if (this.submitting) return;

    const unanswered = this.playerQuestions.filter(q => !this.isQuestionAnswered(q));
    if (unanswered.length > 0) {
      const confirmed = confirm(`You have ${unanswered.length} unanswered question(s). Submit anyway?`);
      if (!confirmed) return;
    }

    this.submitting = true;
    this.stopTimer();

    const responses: QuestionResponse[] = this.playerQuestions.map((pq, i) => {
      const resp: QuestionResponse = { questionIndex: i };
      if (pq.data.type === 'mcq') {
        resp.selectedOptionIndex = pq.selectedOption;
      } else if (pq.data.type === 'matching') {
        resp.matchingResponse = (pq.matchingLeft || []).map((l, li) => ({
          leftIndex: li,
          rightIndex: l.matchedRightIndex ?? -1
        }));
      } else if (pq.data.type === 'fill-blank') {
        resp.fillBlankResponses = pq.fillAnswers || [];
      } else if (pq.data.type === 'pronunciation') {
        resp.spokenText = pq.spokenText || '';
        resp.pronunciationScore = pq.pronunciationScore || 0;
      } else if (pq.data.type === 'question-answer') {
        resp.qaResponse = pq.qaResponse || '';
      } else if (pq.data.type === 'listening') {
        resp.listeningText = pq.listeningText || '';
      }
      return resp;
    });

    this.exerciseService.submitAttempt(this.exerciseId, this.attemptId, responses, this.elapsedSeconds).subscribe({
      next: (result) => {
        this.result = result;
        this.submitting = false;
        this.isSubmittedState = true;
        this.state = 'submitted';
        this.applyResultFeedback(result);
      },
      error: (err) => {
        this.submitting = false;
        this.snackBar.open(err.error?.error || 'Failed to submit. Please try again.', 'Close', { duration: 5000 });
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
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    }
  }

  formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  backToExercises(): void {
    this.router.navigate(['/digital-exercises']);
  }

  tryAgain(): void {
    this.result = null;
    this.isSubmittedState = false;
    this.initPlayerQuestions();
    this.currentIndex = 0;
    this.startExercise();
  }

  showReviewAnswers(): void {
    this.state = 'review';
  }

  backToResult(): void {
    this.isSubmittedState = true;
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
    if (pq.data.type === 'question-answer') return (pq.qaResponse || '—').trim();
    if (pq.data.type === 'listening') return (pq.listeningText || '—').trim();
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
      const pairs = (pq.data.pairs || []).map((p: any) => `${p.left} → ${p.right}`);
      return pairs.length ? pairs.join('; ') : '—';
    }
    if (pq.data.type === 'fill-blank') {
      const ans = (pq.data._correctAnswers || []).join(', ');
      return ans || '—';
    }
    if (pq.data.type === 'question-answer') {
      const samples = pq.data.sampleAnswers || [];
      return samples.length ? samples.join('; ') : '(AI graded)';
    }
    if (pq.data.type === 'listening') return pq.data.expectedTranscript || '—';
    if (pq.data.type === 'pronunciation') return pq.data.word || '—';
    return '—';
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
    return sentence.split('___');
  }

  getQuestionTypes(): Array<{ type: string; count: number; label: string; icon: string }> {
    const counts: Record<string, number> = {};
    const labels: Record<string, string> = { mcq: 'Multiple Choice', matching: 'Matching', 'fill-blank': 'Fill Blanks', pronunciation: 'Pronunciation', 'question-answer': 'Question / Answer', listening: 'Listening' };
    const icons: Record<string, string> = { mcq: 'quiz', matching: 'compare_arrows', 'fill-blank': 'text_fields', pronunciation: 'record_voice_over', 'question-answer': 'short_text', listening: 'headphones' };
    this.playerQuestions.forEach(pq => { counts[pq.data.type] = (counts[pq.data.type] || 0) + 1; });
    return Object.entries(counts).map(([type, count]) => ({ type, count, label: labels[type] || type, icon: icons[type] || 'help' }));
  }

  getTypeIcon(type: string): string {
    return this.exerciseService.getQuestionTypeIcon(type as any);
  }

  getTypeLabel(type: string): string {
    return this.exerciseService.getQuestionTypeLabel(type as any);
  }

  getMediaFullUrl(relative?: string | null): string {
    if (!relative) return '';
    if (relative.startsWith('http')) return relative;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return base ? base + relative : relative;
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

  isMatchCorrect(pq: PlayerQuestion, leftIndex: number): boolean {
    const matchedRightIndex = pq.matchingLeft![leftIndex].matchedRightIndex;
    if (matchedRightIndex === null || matchedRightIndex === undefined) return false;
    const leftValue = pq.matchingLeft![leftIndex].value;
    const matchedRightValue = pq.matchingRight![matchedRightIndex].value;
    const originalPairs = pq.data.pairs || [];
    const originalPair = originalPairs.find((p: any) => p.left === leftValue);
    return originalPair ? originalPair.right === matchedRightValue : false;
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
}
