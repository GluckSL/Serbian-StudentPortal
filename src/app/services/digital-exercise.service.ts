// src/app/services/digital-exercise.service.ts

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { Observable, from, of, shareReplay, throwError } from 'rxjs';
import { switchMap, tap, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { StudentProgressService } from './student-progress.service';

/** Minimum score (0–100) to pass an exercise and unlock the next sequence letter. */
export const EXERCISE_PASS_SCORE_PERCENT = 40;

export type QuestionType =
  | 'mcq'
  | 'matching'
  | 'fill-blank'
  | 'word_bank_fill'
  | 'pronunciation'
  | 'question-answer'
  | 'listening'
  | 'video-pronunciation'
  | 'singular_plural'
  | 'jumble-word'
  | 'rearrange'
  | 'image_pin_match';

export interface QuestionCommonFields {
  /** Optional context shown above a question in the player. */
  context?: string;
  /** Instruction banner (light-blue) shown above the question body for the student. */
  instruction?: string;
  /** Optional worked example shown below the instruction banner. */
  example?: string;
  /** Per-question attachment URL (image / audio / video / PDF). */
  attachmentUrl?: string;
  attachmentUrls?: string[];
  /**
   * When the attachment is audio: maximum times the student may start playback
   * during one exercise attempt. Omit, null, or 0 = unlimited (default).
   */
  attachmentAudioMaxPlaysPerAttempt?: number | null;
  /** Teacher explanation shown in review. */
  answerExplanation?: string;
  /** Story paragraph for true-false reading passage. */
  storyParagraph?: string;
  /** Toggle advanced/AI grading behavior for this question. */
  aiGradingEnabled?: boolean;
}

export interface MCQQuestion extends QuestionCommonFields {
  type: 'mcq';
  _id?: string;
  question: string;
  imageUrl?: string;
  options: string[];
  /** Optional illustration per option (e.g. images extracted from a worksheet PDF). */
  optionImageUrls?: string[];
  correctAnswerIndex?: number; // hidden from students during play
  explanation?: string;
  points: number;
}

export interface MatchingQuestion extends QuestionCommonFields {
  type: 'matching';
  _id?: string;
  instruction: string;
  pairs: Array<{ left: string; right?: string }>;
  shuffledRight?: string[]; // provided by server during play
  points: number;
}

export interface FillBlankQuestion extends QuestionCommonFields {
  type: 'fill-blank';
  _id?: string;
  sentence: string;
  answers?: string[]; // hidden from students during play
  hint?: string;
  caseSensitive?: boolean;
  points: number;
}

export interface WordBankFillQuestion extends QuestionCommonFields {
  type: 'word_bank_fill';
  _id?: string;
  wordBank: string[];
  items: Array<{ prompt: string; answer?: string; acceptedAnswers?: string[] }>;
  reusableWords?: boolean;
  points: number;
}

export interface PronunciationQuestion extends QuestionCommonFields {
  type: 'pronunciation';
  _id?: string;
  word: string;
  phonetic?: string;
  translation?: string;
  audioUrl?: string;
  acceptedVariants?: string[];
  points: number;
}

export interface QuestionAnswerQuestion extends QuestionCommonFields {
  type: 'question-answer';
  _id?: string;
  prompt: string;
  sampleAnswers?: string[];
  similarityThreshold?: number;
  scoringMode?: 'full' | 'proportional';
  points: number;
}

export interface SingularPluralQuestion extends QuestionCommonFields {
  type: 'singular_plural';
  _id?: string;
  instruction?: string;
  pairs: Array<{ singular: string; plural: string }>;
  similarityThreshold?: number;
  scoringMode?: 'full' | 'proportional';
  points: number;
}

export interface ListeningQuestion extends QuestionCommonFields {
  type: 'listening';
  _id?: string;
  prompt?: string;
  mediaUrl: string;
  expectedTranscript: string;
  attemptMode?: 'typing' | 'typing-or-speech';
  points: number;
}

export interface VideoPronunciationQuestion extends QuestionCommonFields {
  type: 'video-pronunciation';
  _id?: string;
  videoUrl: string;
  caption: string;
  secondaryCaption?: string;
  secondaryCaptionAtSeconds?: number;
  similarityThreshold?: number;
  acceptedVariants?: string[];
  points: number;
}

/** Fields added by the worksheet AI pipeline; present on any question type. */
export interface WorksheetQuestionMeta {
  /** STUFE label + Übung number emitted when the exercise was generated from a worksheet,
   *  e.g. "STUFE 1 – LEICHT | Übung L1.1". Used by the player to render section headers. */
  sectionTitle?: string | null;
  /** Coarse difficulty tier: 'easy' | 'medium' | 'hard'. */
  tier?: 'easy' | 'medium' | 'hard' | null;
  /** Worksheet category label for question-answer style tasks. */
  worksheetKind?:
    | 'true-false'
    | 'sentence-transformation'
    | 'singular-plural'
    | 'table-profile-fill'
    | 'free-writing-own-sentences'
    | 'free-writing-profile'
    | 'error-correction'
    | null;
  /** Sub-questions with same context/hints/images (for creating multiple questions from one context) */
  subQuestions?: ExerciseQuestion[];
}

export interface JumbleWordQuestion extends QuestionCommonFields {
  type: 'jumble-word';
  scrambledText: string;
  boldLetter?: string;
  expectedWord: string;
  categoryTip?: string;
}

export interface RearrangeQuestion extends QuestionCommonFields {
  type: 'rearrange';
  rearrangePrompt: string;
  rearrangeAnswer?: string;
  rearrangeTokens?: string[];
  shuffledTokens?: string[]; // provided by server during play
  points: number;
}

export interface ImagePinMatchQuestion extends QuestionCommonFields {
  type: 'image_pin_match';
  _id?: string;
  imageUrl: string;
  labels: Array<{ id: string; text: string; correctPinId: string }>;
  pins: Array<{ id: string; x: number; y: number }>;
  settings?: {
    randomizeLabels?: boolean;
    allowRetry?: boolean;
  };
  points: number;
}

export type ExerciseQuestion = (
  | MCQQuestion
  | MatchingQuestion
  | FillBlankQuestion
  | WordBankFillQuestion
  | PronunciationQuestion
  | QuestionAnswerQuestion
  | SingularPluralQuestion
  | ListeningQuestion
  | VideoPronunciationQuestion
  | JumbleWordQuestion
  | RearrangeQuestion
  | ImagePinMatchQuestion
) & WorksheetQuestionMeta;

/** Optional praise / retry sound for video pronunciation exercises (admin-uploaded). */
export interface VideoExerciseFeedbackItem {
  audioUrl: string;
  caption?: string;
}

/** Tells the server an empty media field was removed on purpose (do not restore previous URL). */
export interface ExerciseMediaClear {
  qIndex: number;
  subIndex?: number | null;
  field: string;
}

export interface DigitalExercise {
  _id?: string;
  title: string;
  description: string;
  /** Serbian display copy when PORTAL_REGION=serbia (server-side). */
  descriptionDisplay?: string;
  targetLanguage: 'English' | 'German';
  nativeLanguage?: 'English' | 'Tamil' | 'Sinhala';
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  category: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  estimatedDuration?: number;
  questions: ExerciseQuestion[];
  sharedAudioUrl?: string;
  videoSuccessFeedback?: VideoExerciseFeedbackItem[];
  videoRetryFeedback?: VideoExerciseFeedbackItem[];
  tags?: string[];
  isActive?: boolean;
  visibleToStudents?: boolean;
  publishedAt?: Date;
  weeklyTestEnabled?: boolean;
  examEnabled?: boolean;
  createdBy?: any;
  totalAttempts?: number;
  totalCompletions?: number;
  averageScore?: number;
  createdAt?: Date;
  updatedAt?: Date;
  /** 1–200: assigned course day; omit/null = general exercise for any unlocked day */
  courseDay?: number | null;
  /**
   * Within-day sequence letter (a, b, c…).
   * Students must pass all prior letters before this unlocks.
   */
  sequenceLetter?: string | null;
  /** Sent on PUT when teacher explicitly removed uploaded media from a question. */
  mediaClears?: ExerciseMediaClear[];
  /** Set by server for student list response when sequence-locked */
  sequenceLocked?: boolean;
  previousSequenceLetter?: string | null;
  stats?: { completions: number; avgScore: number; uniqueStudents: number };
  /** Admin list optimization: count sent without full questions payload. */
  questionCount?: number;
  /** Admin list optimization: { [type]: count } summary sent by backend. */
  questionTypeSummary?: Record<string, number>;
  studentAttempt?: ExerciseAttempt | null;
  /**
   * When true, students skip the pronunciation step — they just watch each
   * video clip and tap "Next". Controlled by admin only (default: false).
   */
  watchOnlyMode?: boolean;
  /** When true, students can only attempt this exercise once. */
  noReattempt?: boolean;
  /** When true, the player locks the browser into fullscreen and auto-submits on tab switch. */
  lockBrowser?: boolean;
  /** QA badge: true when a tester marked the exercise as reviewed in admin list. */
  testerVerified?: boolean;
  /** Content blocks that trail after the last question (free mode builder). */
  trailingContentBlocks?: Array<{
    sectionTitle?: string;
    context?: string;
    instruction?: string;
    example?: string;
    attachmentUrls?: string[];
    attachmentAudioMaxPlaysPerAttempt?: number | null;
  }>;
  /** Present when created via Free Mode builder. */
  isFreeMode?: boolean;
  /** Present when created by splitting questions from another exercise. */
  splitLineage?: {
    sourceExerciseId?: string;
    questionSources?: Array<{ sourceQuestionIndex: number; sourceQuestionId?: string }>;
  };
  /** 'v1' = original exercises; 'v2' = Online Exercises 2.0 (batch-specific). Default: 'v1'. */
  version?: 'v1' | 'v2';
  /** Batch numbers this v2 exercise is assigned to. e.g. ['45', '46']. */
  targetBatches?: string[];
}

export interface ExerciseAttempt {
  _id?: string;
  studentId?: string;
  exerciseId?: string;
  attemptNumber?: number;
  scorePercentage: number;
  earnedPoints?: number;
  totalPoints?: number;
  status?: string;
  completedAt?: Date;
  timeSpentSeconds?: number;
  autoSubmittedDueToLockBrowser?: boolean;
  /** Populated on student exercise list for analytics (best attempt) */
  wrongCount?: number;
  correctCount?: number;
  totalQuestions?: number;
  /** True when completion is derived from a completed attempt on the split source exercise */
  inheritedFromSource?: boolean;
  sourceExerciseId?: string;
  sourceAttemptId?: string;
}

/** Per-question row from my-review / staff attempt detail APIs */
export interface AttemptReviewRow {
  questionIndex: number;
  /** Present for "Questions with Same Context" sub-parts (e.g. 31.1). */
  subQuestionIndex?: number | null;
  displayIndex: number | string;
  type: string;
  promptSnippet: string;
  isCorrect: boolean;
  pointsEarned: number;
  maxPoints: number;
  studentAnswer: string;
  expectedAnswer: string;
  answerExplanation?: string;
  isSubQuestion?: boolean;
  staffOverride?: boolean;
}

export interface ExerciseReviewSummary {
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
}

export interface MyExerciseReviewResponse {
  exercise: { _id: string; title: string; level: string; category: string };
  attempt: {
    _id: string;
    attemptNumber?: number;
    scorePercentage: number;
    earnedPoints?: number;
    totalPoints?: number;
    completedAt?: string;
    timeSpentSeconds?: number;
    autoSubmittedDueToLockBrowser?: boolean;
  };
  summary: ExerciseReviewSummary;
  perQuestion: AttemptReviewRow[];
}

export interface StaffAttemptReviewResponse extends MyExerciseReviewResponse {
  attempt: MyExerciseReviewResponse['attempt'] & {
    studentId?: { name?: string; email?: string; batch?: string; level?: string };
  };
}

export interface StaffAttemptOverrideResponse {
  success: boolean;
  attemptId: string;
  questionIndex: number;
  subQuestionIndex?: number | null;
  isCorrect: boolean;
  pointsEarned: number;
  earnedPoints: number;
  totalPoints: number;
  scorePercentage: number;
}

export interface StaffAttemptRegradeResponse {
  success: boolean;
  attemptId: string;
  earnedPoints: number;
  totalPoints: number;
  scorePercentage: number;
  summary: ExerciseReviewSummary;
  perQuestion: AttemptReviewRow[];
}

export interface QuestionResponse {
  questionIndex: number;
  selectedOptionIndex?: number;
  matchingResponse?: Array<{ leftIndex: number; rightIndex: number; rightValue?: string | null }>;
  fillBlankResponses?: string[];
  wordBankAnswers?: Array<{ index: number; value: string }>;
  singularPluralResponses?: string[];
  spokenText?: string;
  pronunciationScore?: number;
  qaResponse?: string;
  listeningText?: string;
  jumbleWordResponse?: string;
  rearrangeTextResponse?: string;
  rearrangeTokensResponse?: string[];
  imagePinAnswers?: Array<{ labelId: string; pinId: string }>;
  subQuestionResponses?: Array<{
    questionIndex: number;
    selectedOptionIndex?: number | null;
    textAnswer?: string | null;
    fillBlankResponses?: string[];
    spokenText?: string;
    pronunciationScore?: number;
    matchingResponse?: Array<{ leftIndex: number; rightIndex: number; rightValue?: string | null }>;
    wordBankAnswers?: Array<{ index: number; value: string }>;
    singularPluralResponses?: string[];
    jumbleWordResponse?: string;
    rearrangeTextResponse?: string;
    rearrangeTokensResponse?: string[];
    imagePinAnswers?: Array<{ labelId: string; pinId: string }>;
  }>;
}


export interface SubmitResult {
  scorePercentage: number;
  earnedPoints: number;
  totalPoints: number;
  passed: boolean;
  answerDetails: Array<{
    questionIndex: number;
    type: string;
    isCorrect: boolean;
    pointsEarned: number;
    correctAnswer: any;
  }>;
  autoSubmittedDueToLockBrowser?: boolean;
}

export interface SubmitQuestionResult {
  questionIndex: number;
  isCorrect: boolean;
  pointsEarned: number;
  correctAnswer: any;
  earnedPoints: number;
  totalPoints: number;
  scorePercentage: number;
  allSubmitted: boolean;
  passed: boolean;
}

/** Fields allowed in PATCH /digital-exercises/admin/bulk-update */
export type DigitalExerciseBulkMetadata = Partial<
  Pick<
    DigitalExercise,
    | 'level'
    | 'category'
    | 'courseDay'
    | 'difficulty'
    | 'visibleToStudents'
    | 'targetLanguage'
    | 'nativeLanguage'
    | 'estimatedDuration'
    | 'weeklyTestEnabled'
    | 'examEnabled'
  >
>;

export interface ExerciseFilters {
  level?: string;
  category?: string;
  difficulty?: string;
  targetLanguage?: string;
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
  /** Student / Journey list: numeric journey day 0–200 */
  todayOnly?: boolean;
  /** Admin list: numeric day 1–200, or "unassigned"; students: filter to one journey day */
  courseDay?: string | number;
}

@Injectable({ providedIn: 'root' })
export class DigitalExerciseService {
  private readonly translate = inject(TranslateService, { optional: true });
  private apiUrl = `${environment.apiUrl}/digital-exercises`;
  private readonly exerciseListCache = new Map<string, Observable<any>>();

  constructor(private http: HttpClient, private progressService: StudentProgressService) {}

  // ─── Student / Browse ─────────────────────────────────────────────────────

  invalidateExerciseListCache(): void {
    this.exerciseListCache.clear();
  }

  refreshExercises(filters: ExerciseFilters = {}): Observable<any> {
    this.exerciseListCache.delete(this.exerciseListCacheKey(filters));
    return this.getExercises(filters);
  }

  getExercises(filters: ExerciseFilters = {}): Observable<any> {
    const cacheKey = this.exerciseListCacheKey(filters);
    const cached = this.exerciseListCache.get(cacheKey);
    if (cached) return cached;

    let params = new HttpParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val === undefined || val === null || val === '') return;
      if (key === 'todayOnly') {
        if (val === true) params = params.set('todayOnly', 'true');
        return;
      }
      params = params.set(key, val.toString());
    });
    const request$ = this.http.get<any>(this.apiUrl, { params, withCredentials: true }).pipe(
      tap({ error: () => this.exerciseListCache.delete(cacheKey) }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.exerciseListCache.set(cacheKey, request$);
    return request$;
  }

  private exerciseListCacheKey(filters: ExerciseFilters = {}): string {
    return Object.entries(filters)
      .filter(([, val]) => val !== undefined && val !== null && val !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${key}=${String(val)}`)
      .join('&') || '__default__';
  }

  /** Lightweight list for Student → Gluck Exam tab (no questions / media). */
  getGluckExamExercises(): Observable<{
    exercises: DigitalExercise[];
    studentCourseDay?: number;
    studentLevel?: string;
    accessibleLevels?: string[];
  }> {
    return this.http.get<{
      exercises: DigitalExercise[];
      studentCourseDay?: number;
      studentLevel?: string;
      accessibleLevels?: string[];
    }>(`${this.apiUrl}/gluck-exam`, { withCredentials: true });
  }

  getExercise(id: string, opts: { asStudent?: boolean } = {}): Observable<DigitalExercise> {
    let params = new HttpParams();
    if (opts.asStudent) params = params.set('asStudent', 'true');
    return this.http.get<DigitalExercise>(`${this.apiUrl}/${id}`, { params, withCredentials: true });
  }

  // ─── Admin / Management ───────────────────────────────────────────────────

  getExercisesForAdmin(filters: ExerciseFilters = {}): Observable<any> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        params = params.set(key, val.toString());
      }
    });
    return this.http.get<any>(`${this.apiUrl}/admin/all`, { params, withCredentials: true });
  }

  /** Deep-clone an existing exercise into Online Exercises 2.0. */
  copyToV2(id: string): Observable<{ exercise: DigitalExercise }> {
    return this.http.post<{ exercise: DigitalExercise }>(`${this.apiUrl}/${id}/copy-to-v2`, {}, { withCredentials: true });
  }

  /** Update the targetBatches array for a v2 exercise. */
  updateTargetBatches(id: string, targetBatches: string[]): Observable<DigitalExercise> {
    return this.http.patch<DigitalExercise>(`${this.apiUrl}/${id}/target-batches`, { targetBatches }, { withCredentials: true });
  }

  createExercise(exercise: Partial<DigitalExercise>): Observable<DigitalExercise> {
    return this.http.post<DigitalExercise>(this.apiUrl, exercise, { withCredentials: true }).pipe(
      tap(() => this.invalidateExerciseListCache()),
    );
  }

  createFreeModeExercise(payload: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/freemode`, payload, { withCredentials: true });
  }

  updateFreeModeExercise(id: string, payload: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/freemode/${id}`, payload, { withCredentials: true });
  }

  /** Move selected questions into a new exercise (atomic; records split lineage). */
  splitQuestionsToNewExercise(
    sourceExerciseId: string,
    payload: {
      questionIndices: number[];
      title: string;
      description: string;
      targetLanguage?: string;
      nativeLanguage?: string;
      level?: string;
      category?: string;
      difficulty?: string;
      estimatedDuration?: number;
      tags?: string[];
      courseDay?: number | null;
      sequenceLetter?: string | null;
      visibleToStudents?: boolean;
    }
  ): Observable<{ exercise: DigitalExercise; sourceExerciseId: string }> {
    return this.http.post<{ exercise: DigitalExercise; sourceExerciseId: string }>(
      `${this.apiUrl}/${sourceExerciseId}/split-questions`,
      payload,
      { withCredentials: true }
    ).pipe(
      tap(() => this.invalidateExerciseListCache()),
    );
  }

  updateExercise(id: string, exercise: Partial<DigitalExercise>): Observable<DigitalExercise> {
    return this.http.put<DigitalExercise>(`${this.apiUrl}/${id}`, exercise, { withCredentials: true }).pipe(
      tap(() => this.invalidateExerciseListCache()),
    );
  }

  toggleVisibility(id: string, visibleToStudents: boolean): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/visibility`, { visibleToStudents }, { withCredentials: true }).pipe(
      tap(() => this.invalidateExerciseListCache()),
    );
  }

  toggleWatchOnlyMode(id: string, watchOnlyMode: boolean): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/watch-only`, { watchOnlyMode }, { withCredentials: true });
  }

  markTesterVerified(id: string): Observable<{ success: boolean; testerVerified: boolean }> {
    return this.http.patch<{ success: boolean; testerVerified: boolean }>(
      `${this.apiUrl}/${id}/tester-verified`,
      {},
      { withCredentials: true }
    ).pipe(
      tap(() => this.invalidateExerciseListCache()),
    );
  }

  toggleActive(id: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/toggle-active`, {}, { withCredentials: true }).pipe(
      tap(() => this.invalidateExerciseListCache()),
    );
  }

  deleteExercise(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`, { withCredentials: true }).pipe(
      tap(() => this.invalidateExerciseListCache()),
    );
  }

  bulkDeleteExercises(ids: string[]): Observable<{ success: boolean; modifiedCount: number }> {
    return this.http.post<{ success: boolean; modifiedCount: number }>(
      `${this.apiUrl}/admin/bulk-delete`,
      { ids },
      { withCredentials: true }
    ).pipe(
      tap(() => this.invalidateExerciseListCache()),
    );
  }

  bulkUpdateExercises(ids: string[], updates: DigitalExerciseBulkMetadata): Observable<{ success: boolean; modifiedCount: number }> {
    return this.http.patch<{ success: boolean; modifiedCount: number }>(
      `${this.apiUrl}/admin/bulk-update`,
      { ids, updates },
      { withCredentials: true }
    ).pipe(
      tap(() => this.invalidateExerciseListCache()),
    );
  }

  // ─── Student Attempt ──────────────────────────────────────────────────────

  startAttempt(exerciseId: string): Observable<{ attemptId: string; attemptNumber: number }> {
    return this.http.post<any>(`${this.apiUrl}/${exerciseId}/start`, {}, { withCredentials: true });
  }

  submitAttempt(
    exerciseId: string,
    attemptId: string,
    responses: QuestionResponse[],
    timeSpentSeconds: number,
    autoSubmittedDueToLockBrowser?: boolean
  ): Observable<SubmitResult> {
    return this.http.post<SubmitResult>(
      `${this.apiUrl}/${exerciseId}/submit`,
      { attemptId, responses, timeSpentSeconds, autoSubmittedDueToLockBrowser },
      { withCredentials: true }
    ).pipe(
      tap((res: any) => {
        this.invalidateExerciseListCache();
        if (res?.journeyAdvanced && res.previousCourseDay != null && res.newCourseDay != null) {
          this.progressService.notifyJourneyAdvance({
            previousDay: res.previousCourseDay,
            newDay: res.newCourseDay
          });
        }
      })
    );
  }

  submitQuestion(
    exerciseId: string,
    attemptId: string,
    questionIndex: number,
    response: QuestionResponse,
    timeSpentSeconds: number
  ): Observable<SubmitQuestionResult> {
    return this.http.post<SubmitQuestionResult>(
      `${this.apiUrl}/${exerciseId}/submit-question`,
      { attemptId, questionIndex, response, timeSpentSeconds },
      { withCredentials: true }
    );
  }

  getMyAttempts(exerciseId: string): Observable<ExerciseAttempt[]> {
    return this.http.get<ExerciseAttempt[]>(`${this.apiUrl}/${exerciseId}/my-attempts`, { withCredentials: true });
  }

  /** Student: best completed attempt (or specific attemptId), per-question answers vs expected */
  getMyExerciseReview(exerciseId: string, attemptId?: string): Observable<MyExerciseReviewResponse> {
    let params = new HttpParams();
    if (attemptId) params = params.set('attemptId', attemptId);
    return this.http.get<MyExerciseReviewResponse>(`${this.apiUrl}/${exerciseId}/my-review`, { params, withCredentials: true });
  }

  /** Admin/Teacher: one student's completed attempt with full breakdown */
  getAttemptReviewForStaff(exerciseId: string, attemptId: string): Observable<StaffAttemptReviewResponse> {
    return this.http.get<StaffAttemptReviewResponse>(
      `${this.apiUrl}/${exerciseId}/attempts/${attemptId}`,
      { withCredentials: true }
    );
  }

  /** Admin/Teacher: override grading for one submitted question (or sub-question) in an attempt */
  overrideAttemptQuestion(
    exerciseId: string,
    attemptId: string,
    questionIndex: number,
    isCorrect: boolean,
    subQuestionIndex?: number | null
  ): Observable<StaffAttemptOverrideResponse> {
    const body: { isCorrect: boolean; subQuestionIndex?: number } = { isCorrect };
    if (subQuestionIndex !== undefined && subQuestionIndex !== null) {
      body.subQuestionIndex = subQuestionIndex;
    }
    return this.http.patch<StaffAttemptOverrideResponse>(
      `${this.apiUrl}/${exerciseId}/attempts/${attemptId}/questions/${questionIndex}/override`,
      body,
      { withCredentials: true }
    );
  }

  /** Admin/Teacher: re-run auto-grading on a completed attempt */
  regradeAttemptForStaff(exerciseId: string, attemptId: string): Observable<StaffAttemptRegradeResponse> {
    return this.http.post<StaffAttemptRegradeResponse>(
      `${this.apiUrl}/${exerciseId}/attempts/${attemptId}/regrade`,
      {},
      { withCredentials: true }
    );
  }

  /** Re-map legacy fill-blank answers and regrade all completed attempts for an exercise */
  regradeAllAttemptsForStaff(exerciseId: string): Observable<{
    success: boolean;
    exerciseId: string;
    totalAttempts: number;
    updated: number;
    skipped: number;
    hasMultipartFillBlank: boolean;
    errors?: Array<{ attemptId: string; error: string }>;
  }> {
    return this.http.post<{
      success: boolean;
      exerciseId: string;
      totalAttempts: number;
      updated: number;
      skipped: number;
      hasMultipartFillBlank: boolean;
      errors?: Array<{ attemptId: string; error: string }>;
    }>(`${this.apiUrl}/${exerciseId}/attempts/regrade-all`, {}, { withCredentials: true });
  }

  // ─── Analytics (Teacher/Admin) ────────────────────────────────────────────

  getExerciseCompletions(exerciseId: string, filters: { date?: string; studentId?: string; page?: number; limit?: number; all?: boolean } = {}): Observable<any> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val === undefined || val === null || val === '') return;
      if (key === 'all') {
        if (val) params = params.set('all', 'true');
        return;
      }
      params = params.set(key, val.toString());
    });
    return this.http.get<any>(`${this.apiUrl}/${exerciseId}/completions`, { params, withCredentials: true });
  }

  getDailyOverview(date?: string, exerciseId?: string): Observable<any> {
    let params = new HttpParams();
    if (date) params = params.set('date', date);
    if (exerciseId) params = params.set('exerciseId', exerciseId);
    return this.http.get<any>(`${this.apiUrl}/analytics/daily-overview`, { params, withCredentials: true });
  }

  getStudentAnalytics(studentId: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/analytics/student/${studentId}`, { withCredentials: true });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  // ─── PDF Exercise Generator ───────────────────────────────────────────────

  uploadPdf(file: File): Observable<any> {
    // Direct R2 PUT bypasses nginx client_max_body_size limits on production.
    // Never fall back to multipart /upload — nginx rejects files > ~1 MB with HTTP 413.
    return this.http
      .post<{ uploadUrl: string; fileUrl: string }>(
        `${environment.apiUrl}/r2/generate-upload-url`,
        {
          filename: file.name,
          contentType: 'application/pdf',
          prefix: 'pdf-exercises',
        },
        { withCredentials: true }
      )
      .pipe(
        switchMap(({ uploadUrl, fileUrl }) =>
          from(
            fetch(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/pdf' },
              body: file,
            })
          ).pipe(
            switchMap((response) => {
              if (!response.ok) {
                return throwError(
                  () => new Error(`Cloud storage upload failed (HTTP ${response.status}). Try again or contact support.`)
                );
              }
              return this.http.post<any>(
                `${environment.apiUrl}/pdf-exercises/register-r2-upload`,
                { fileUrl, filename: file.name },
                { withCredentials: true }
              );
            })
          )
        )
      );
  }

  detectPdfStructureWithAi(uploadId: string): Observable<any> {
    return this.http.post<any>(
      `${environment.apiUrl}/pdf-exercises/detect-structure-ai`,
      { uploadId },
      { withCredentials: true }
    );
  }

  generateFromPdf(options: {
    uploadId: string;
    types: string[];
    typeCounts?: Record<string, number>;
    targetLanguage: string;
    nativeLanguage: string;
    level: string;
    difficulty: string;
    maxQuestions: number;
    worksheetMode?: boolean;
    selectedExerciseIds?: string[];
    selectedExercises?: Array<{ exerciseId: string; questionCount?: number }>;
  }): Observable<any> {
    return this.http.post<any>(`${environment.apiUrl}/pdf-exercises/generate`, options, { withCredentials: true });
  }

  getExtractionStatus(jobId: string): Observable<any> {
    return this.http.get<any>(`${environment.apiUrl}/pdf-exercises/extraction-status/${jobId}`, { withCredentials: true });
  }

  generateFromText(options: {
    text: string;
    types: string[];
    typeCounts?: Record<string, number>;
    targetLanguage: string;
    nativeLanguage: string;
    level: string;
    difficulty: string;
    maxQuestions: number;
  }): Observable<any> {
    return this.http.post<any>(`${environment.apiUrl}/pdf-exercises/text-generate`, options, { withCredentials: true });
  }

  cleanupPdf(uploadId: string): Observable<any> {
    return this.http.delete<any>(`${environment.apiUrl}/pdf-exercises/cleanup/${uploadId}`, { withCredentials: true });
  }

  /** AI Stage Phase 1: PDF → blocks (multipart field name: `file`). */
  runAiStagePhase1(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<any>(`${environment.apiUrl}/ai-stage/phase-1`, formData, { withCredentials: true });
  }

  /** AI Stage Phase 2: blocks → parsed results. */
  runAiStagePhase2(blocks: unknown[]): Observable<any> {
    return this.http.post<any>(
      `${environment.apiUrl}/ai-stage/phase-2`,
      { blocks },
      { withCredentials: true }
    );
  }

  /** AI Stage Phase 3: blocks + phase-2 results + optional answer key → final exercises. */
  runAiStagePhase3(payload: { blocks: unknown[]; parsedResults: unknown[]; answerKeyText?: string }): Observable<any> {
    return this.http.post<any>(`${environment.apiUrl}/ai-stage/phase-3`, payload, { withCredentials: true });
  }

  /**
   * Re-extract a single exercise block precisely using the per-exercise prompt.
   * Use this when you need to refine or re-process one Übung at a time.
   */
  extractSingleExercise(options: {
    topic?: string;
    exerciseId?: string;
    level?: string;
    instruction_de?: string;
    instruction_en?: string;
    content: string;
    solution_key?: string;
  }): Observable<{ success: boolean; exerciseId: string; type: string; questions: any[] }> {
    return this.http.post<any>(
      `${environment.apiUrl}/pdf-exercises/extract-single-exercise`,
      options,
      { withCredentials: true }
    );
  }

  /**
   * Two-pass sequential extraction for uploaded worksheets:
   * splits PDF into Übung blocks, calls per-exercise AI prompt for each.
   * More accurate than the single whole-document call; costs one API call per exercise.
   */
  extractExercisesSequential(options: {
    uploadId: string;
    targetLanguage?: string;
    nativeLanguage?: string;
    level?: string;
    selectedExerciseIds?: string[];
  }): Observable<any> {
    return this.http
      .post<any>(
        `${environment.apiUrl}/pdf-exercises/extract-exercises-sequential`,
        options,
        { withCredentials: true }
      )
      .pipe(timeout(55 * 60 * 1000));
  }

  // ─── Manual Listening Worksheet Extraction ──────────────────────────────
  generateListeningFromWorksheet(options: {
    uploadId: string;
    audioUrl?: string;
    targetLanguage: string;
    nativeLanguage: string;
    level: string;
    difficulty: string;
    maxQuestions?: number;
  }): Observable<any> {
    return this.http.post<any>(
      `${environment.apiUrl}/listening-worksheets/generate`,
      options,
      { withCredentials: true }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────

  getLevels(): string[] { return ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']; }
  getCategories(): string[] { return ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation']; }
  getDifficulties(): string[] { return ['Beginner', 'Intermediate', 'Advanced']; }
  getLanguages(): string[] { return ['English', 'German']; }

  /** Display label for stored category key (DB stays English). */
  getCategoryLabel(category: string | null | undefined): string {
    const key = String(category || '').trim();
    if (!key) return '—';
    const map: Record<string, string> = {
      Grammar: 'Gramatika',
      Vocabulary: 'Vokabular',
      Conversation: 'Konverzacija',
      Reading: 'Čitanje',
      Writing: 'Pisanje',
      Listening: 'Slušanje',
      Pronunciation: 'Izgovor',
    };
    if (map[key]) return map[key];
    const i18nKey = `EXERCISES.CATEGORIES.${key.toUpperCase()}`;
    if (this.translate) {
      const t = this.translate.instant(i18nKey);
      if (t && t !== i18nKey) return t;
    }
    return key;
  }

  /** Display label for stored difficulty key (DB stays English). */
  getDifficultyLabel(difficulty: string | null | undefined): string {
    const key = String(difficulty || '').trim();
    if (!key) return '—';
    const map: Record<string, string> = {
      Beginner: 'Početnik',
      Intermediate: 'Srednji nivo',
      Advanced: 'Napredni nivo',
    };
    if (map[key]) return map[key];
    const i18nKey = `EXERCISES.DIFFICULTY.${key.toUpperCase()}`;
    if (this.translate) {
      const t = this.translate.instant(i18nKey);
      if (t && t !== i18nKey) return t;
    }
    return key;
  }

  getLevelColor(level: string): string {
    const colors: Record<string, string> = {
      A1: '#4CAF50', A2: '#8BC34A', B1: '#FFC107', B2: '#FF9800', C1: '#F44336', C2: '#9C27B0'
    };
    return colors[level] || '#607D8B';
  }

  getQuestionTypeLabel(type: QuestionType): string {
    const i18nKeys: Partial<Record<QuestionType, string>> = {
      mcq: 'EXERCISES.TYPES.MCQ',
      matching: 'EXERCISES.TYPES.MATCHING',
      'fill-blank': 'EXERCISES.TYPES.FILL_BLANK',
      word_bank_fill: 'EXERCISES.TYPES.WORD_BANK_FILL',
      pronunciation: 'EXERCISES.TYPES.PRONUNCIATION',
      'question-answer': 'EXERCISES.TYPES.QUESTION_ANSWER',
      singular_plural: 'EXERCISES.TYPES.SINGULAR_PLURAL',
      listening: 'EXERCISES.TYPES.LISTENING',
      'video-pronunciation': 'EXERCISES.TYPES.VIDEO_PRONUNCIATION',
      'jumble-word': 'EXERCISES.TYPES.JUMBLE_WORD',
      rearrange: 'EXERCISES.TYPES.REARRANGE',
      image_pin_match: 'EXERCISES.TYPES.IMAGE_MATCHING',
    };
    const key = i18nKeys[type];
    if (key && this.translate) {
      const translated = this.translate.instant(key);
      if (translated && translated !== key) return translated;
    }
    const lang = this.translate?.getCurrentLang?.();
    const useSerbian =
      lang === 'sr-Latn' ||
      (!lang && environment.portalStudentLocale === 'sr-Latn');
    const srLabels: Record<QuestionType, string> = {
      mcq: 'Višestruki izbor',
      matching: 'Podudaranje',
      'fill-blank': 'Dopunjavanje',
      word_bank_fill: 'Dopunjavanje iz banke reči',
      pronunciation: 'Izgovor',
      'question-answer': 'Pitanje / odgovor',
      singular_plural: 'Jednina / množina',
      listening: 'Slušanje',
      'video-pronunciation': 'Video izgovor',
      'jumble-word': 'Mešanje slova',
      rearrange: 'Preuređivanje',
      image_pin_match: 'Podudaranje slike i reči',
    };
    const enLabels: Record<QuestionType, string> = {
      mcq: 'Multiple Choice',
      matching: 'Matching Exercise',
      'fill-blank': 'Fill in the Blanks',
      word_bank_fill: 'Word Bank Fill',
      pronunciation: 'Pronunciation Check',
      'question-answer': 'Question / Answer',
      singular_plural: 'Singular / Plural',
      listening: 'Listening',
      'video-pronunciation': 'Video Pronunciation',
      'jumble-word': 'Jumble Word',
      rearrange: 'Rearrange',
      image_pin_match: 'Image Pin Match',
    };
    const labels = useSerbian ? srLabels : enLabels;
    return labels[type] || type;
  }

  getQuestionTypeIcon(type: QuestionType): string {
    const icons: Record<QuestionType, string> = {
      mcq: 'quiz',
      matching: 'compare_arrows',
      'fill-blank': 'text_fields',
      word_bank_fill: 'format_list_bulleted',
      pronunciation: 'record_voice_over',
      'question-answer': 'short_text',
      singular_plural: 'swap_horiz',
      listening: 'headphones',
      'video-pronunciation': 'videocam',
      'jumble-word': 'shuffle',
      rearrange: 'reorder',
      image_pin_match: 'place'
    };
    return icons[type] || 'help';
  }

  uploadBlobToR2(
    file: File,
    prefix: 'listening-media' | 'exercise-attachments' | 'pdf-exercises'
  ): Observable<{ success: boolean; url: string }> {
    return this.http
      .post<{ uploadUrl: string; fileUrl: string }>(
        `${environment.apiUrl}/r2/generate-upload-url`,
        {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          prefix,
        },
        { withCredentials: true }
      )
      .pipe(
        switchMap(({ uploadUrl, fileUrl }) =>
          from(
            fetch(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': file.type || 'application/octet-stream' },
              body: file,
            })
          ).pipe(
            switchMap((response) => {
              if (!response.ok) {
                return throwError(() => new Error(`R2 upload failed with status ${response.status}`));
              }
              return of({ success: true, url: fileUrl });
            })
          )
        )
      );
  }

  uploadVideoMedia(file: File): Observable<{ success: boolean; url: string }> {
    return this.uploadBlobToR2(file, 'listening-media');
  }

  /** Listening / feedback clips — direct R2 upload only (same bucket as server-side audio). */
  uploadListeningMedia(file: File): Observable<{ success: boolean; url: string }> {
    return this.uploadBlobToR2(file, 'listening-media');
  }

  fetchListeningFromUrl(url: string): Observable<{ success: boolean; url: string }> {
    return this.http.post<{ success: boolean; url: string }>(
      `${environment.apiUrl}/listening-media/fetch-from-url`,
      { url },
      { withCredentials: true }
    );
  }

  transcribeListening(mediaUrl: string): Observable<{ success: boolean; transcript: string }> {
    return this.http.post<{ success: boolean; transcript: string }>(
      `${environment.apiUrl}/listening-media/transcribe`,
      { mediaUrl },
      { withCredentials: true }
    );
  }

  /** Per-question attachment: audio goes to R2; images use multipart (server stores in R2 or S3). */
  uploadQuestionAttachment(file: File): Observable<{ success: boolean; url: string; canonicalUrl?: string }> {
    const mt = (file.type || '').toLowerCase();
    if (mt.startsWith('audio/')) {
      return this.uploadBlobToR2(file, 'exercise-attachments');
    }
    const formData = new FormData();
    formData.append('attachment', file);
    return this.http.post<{ success: boolean; url: string; canonicalUrl?: string }>(
      `${environment.apiUrl}/digital-exercises/upload-attachment`,
      formData,
      { withCredentials: true }
    );
  }

  /**
   * When stored URLs point at missing local files, remap to canonical R2 public URLs if the object exists.
   */
  /** Presign private S3 URLs for admin builder preview (canonical URLs stay in the form model). */
  recoverExerciseMedia(exerciseId: string): Observable<{
    success: boolean;
    updatedCount: number;
    recovered: Array<{ original: string; url: string; found: boolean; field?: string }>;
    missing: Array<{ original: string; url: string; found: boolean }>;
    exercise: DigitalExercise;
  }> {
    return this.http.post<{
      success: boolean;
      updatedCount: number;
      recovered: Array<{ original: string; url: string; found: boolean; field?: string }>;
      missing: Array<{ original: string; url: string; found: boolean }>;
      exercise: DigitalExercise;
    }>(
      `${environment.apiUrl}/digital-exercises/${exerciseId}/recover-media`,
      {},
      { withCredentials: true }
    );
  }

  presignMediaUrls(urls: string[]): Observable<{
    resolutions: Array<{ original: string; url: string }>;
  }> {
    const uniq = [...new Set((urls || []).map((u) => String(u || '').trim()).filter(Boolean))];
    if (uniq.length === 0) {
      return of({ resolutions: [] });
    }
    return this.http.post<{ resolutions: Array<{ original: string; url: string }> }>(
      `${environment.apiUrl}/digital-exercises/presign-media-urls`,
      { urls: uniq },
      { withCredentials: true }
    );
  }

  resolveMediaFromR2(urls: string[]): Observable<{
    resolutions: Array<{ original: string; url: string; found: boolean }>;
  }> {
    const uniq = [...new Set((urls || []).map((u) => String(u || '').trim()).filter(Boolean))];
    if (uniq.length === 0) {
      return of({ resolutions: [] });
    }
    return this.http.post<{
      resolutions: Array<{ original: string; url: string; found: boolean }>;
    }>(`${environment.apiUrl}/r2/resolve-media-urls`, { urls: uniq }, { withCredentials: true });
  }

  generateExplanation(data: {
    questionType?: string;
    questionText?: string;
    storyParagraph?: string;
    contextText?: string;
    correctAnswer?: string;
    sampleAnswers?: string[];
    targetLanguage?: string;
    audioTranscript?: string;
  }): Observable<{ explanation: string }> {
    return this.http.post<{ explanation: string }>(
      `${environment.apiUrl}/digital-exercises/generate-explanation`,
      data,
      { withCredentials: true }
    );
  }

  convertQuestionType(data: {
    question: any;
    targetType: string;
    targetLanguage?: string;
  }): Observable<{ question: any }> {
    return this.http.post<{ question: any }>(
      `${this.apiUrl}/convert-question-type`,
      data,
      { withCredentials: true }
    );
  }

  generateMissingAnswers(questions: Array<{
    index: number;
    type: string;
    sentence?: string;
    instruction?: string;
    hint?: string;
    answers?: string[];
    prompt?: string;
    sampleAnswers?: string[];
  }>): Observable<{ results: Array<{ index: number; answers?: string[]; sampleAnswers?: string[]; expectedWord?: string }> }> {
    return this.http.post<any>(
      `${environment.apiUrl}/digital-exercises/generate-missing-answers`,
      { questions },
      { withCredentials: true }
    );
  }
}
