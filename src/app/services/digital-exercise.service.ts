// src/app/services/digital-exercise.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, from, of, throwError } from 'rxjs';
import { switchMap, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';

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
  /** Populated on student exercise list for analytics (best attempt) */
  wrongCount?: number;
  correctCount?: number;
  totalQuestions?: number;
}

/** Per-question row from my-review / staff attempt detail APIs */
export interface AttemptReviewRow {
  questionIndex: number;
  displayIndex: number;
  type: string;
  promptSnippet: string;
  isCorrect: boolean;
  pointsEarned: number;
  maxPoints: number;
  studentAnswer: string;
  expectedAnswer: string;
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
  isCorrect: boolean;
  pointsEarned: number;
  earnedPoints: number;
  totalPoints: number;
  scorePercentage: number;
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
  subQuestionResponses?: Array<{ questionIndex: number; selectedOptionIndex?: number | null; textAnswer?: string | null }>;
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
  /** Student list: only exercises tagged for this journey day */
  todayOnly?: boolean;
  /** Admin list: numeric day 1–200, or "unassigned" */
  courseDay?: string | number;
}

@Injectable({ providedIn: 'root' })
export class DigitalExerciseService {
  private apiUrl = `${environment.apiUrl}/digital-exercises`;

  constructor(private http: HttpClient) {}

  // ─── Student / Browse ─────────────────────────────────────────────────────

  getExercises(filters: ExerciseFilters = {}): Observable<any> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val === undefined || val === null || val === '') return;
      if (key === 'todayOnly') {
        if (val === true) params = params.set('todayOnly', 'true');
        return;
      }
      params = params.set(key, val.toString());
    });
    return this.http.get<any>(this.apiUrl, { params, withCredentials: true });
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

  createExercise(exercise: Partial<DigitalExercise>): Observable<DigitalExercise> {
    return this.http.post<DigitalExercise>(this.apiUrl, exercise, { withCredentials: true });
  }

  updateExercise(id: string, exercise: Partial<DigitalExercise>): Observable<DigitalExercise> {
    return this.http.put<DigitalExercise>(`${this.apiUrl}/${id}`, exercise, { withCredentials: true });
  }

  toggleVisibility(id: string, visibleToStudents: boolean): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/visibility`, { visibleToStudents }, { withCredentials: true });
  }

  toggleActive(id: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/toggle-active`, {}, { withCredentials: true });
  }

  deleteExercise(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`, { withCredentials: true });
  }

  bulkDeleteExercises(ids: string[]): Observable<{ success: boolean; modifiedCount: number }> {
    return this.http.post<{ success: boolean; modifiedCount: number }>(
      `${this.apiUrl}/admin/bulk-delete`,
      { ids },
      { withCredentials: true }
    );
  }

  bulkUpdateExercises(ids: string[], updates: DigitalExerciseBulkMetadata): Observable<{ success: boolean; modifiedCount: number }> {
    return this.http.patch<{ success: boolean; modifiedCount: number }>(
      `${this.apiUrl}/admin/bulk-update`,
      { ids, updates },
      { withCredentials: true }
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
    timeSpentSeconds: number
  ): Observable<SubmitResult> {
    return this.http.post<SubmitResult>(
      `${this.apiUrl}/${exerciseId}/submit`,
      { attemptId, responses, timeSpentSeconds },
      { withCredentials: true }
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

  /** Student: best completed attempt, per-question answers vs expected */
  getMyExerciseReview(exerciseId: string): Observable<MyExerciseReviewResponse> {
    return this.http.get<MyExerciseReviewResponse>(`${this.apiUrl}/${exerciseId}/my-review`, { withCredentials: true });
  }

  /** Admin/Teacher: one student's completed attempt with full breakdown */
  getAttemptReviewForStaff(exerciseId: string, attemptId: string): Observable<StaffAttemptReviewResponse> {
    return this.http.get<StaffAttemptReviewResponse>(
      `${this.apiUrl}/${exerciseId}/attempts/${attemptId}`,
      { withCredentials: true }
    );
  }

  /** Admin/Teacher: override grading for one submitted question in an attempt */
  overrideAttemptQuestion(
    exerciseId: string,
    attemptId: string,
    questionIndex: number,
    isCorrect: boolean
  ): Observable<StaffAttemptOverrideResponse> {
    return this.http.patch<StaffAttemptOverrideResponse>(
      `${this.apiUrl}/${exerciseId}/attempts/${attemptId}/questions/${questionIndex}/override`,
      { isCorrect },
      { withCredentials: true }
    );
  }

  // ─── Analytics (Teacher/Admin) ────────────────────────────────────────────

  getExerciseCompletions(exerciseId: string, filters: { date?: string; studentId?: string; page?: number; limit?: number } = {}): Observable<any> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        params = params.set(key, val.toString());
      }
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
    const formData = new FormData();
    formData.append('pdf', file);
    return this.http.post<any>(`${environment.apiUrl}/pdf-exercises/upload`, formData, { withCredentials: true });
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

  getLevelColor(level: string): string {
    const colors: Record<string, string> = {
      A1: '#4CAF50', A2: '#8BC34A', B1: '#FFC107', B2: '#FF9800', C1: '#F44336', C2: '#9C27B0'
    };
    return colors[level] || '#607D8B';
  }

  getQuestionTypeLabel(type: QuestionType): string {
    const labels: Record<QuestionType, string> = {
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
      image_pin_match: 'Image Pin Match'
    };
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
    prefix: 'listening-media' | 'exercise-attachments'
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

  /** Per-question attachment: audio goes to R2 only; other types use multipart (disk/S3). */
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
