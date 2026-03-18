// src/app/services/digital-exercise.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type QuestionType = 'mcq' | 'matching' | 'fill-blank' | 'pronunciation' | 'question-answer' | 'listening';

export interface MCQQuestion {
  type: 'mcq';
  _id?: string;
  question: string;
  imageUrl?: string;
  options: string[];
  correctAnswerIndex?: number; // hidden from students during play
  explanation?: string;
  points: number;
}

export interface MatchingQuestion {
  type: 'matching';
  _id?: string;
  instruction: string;
  pairs: Array<{ left: string; right?: string }>;
  shuffledRight?: string[]; // provided by server during play
  points: number;
}

export interface FillBlankQuestion {
  type: 'fill-blank';
  _id?: string;
  sentence: string;
  answers?: string[]; // hidden from students during play
  hint?: string;
  caseSensitive?: boolean;
  points: number;
}

export interface PronunciationQuestion {
  type: 'pronunciation';
  _id?: string;
  word: string;
  phonetic?: string;
  translation?: string;
  audioUrl?: string;
  acceptedVariants?: string[];
  points: number;
}

export interface QuestionAnswerQuestion {
  type: 'question-answer';
  _id?: string;
  prompt: string;
  sampleAnswers?: string[];
  similarityThreshold?: number;
  scoringMode?: 'full' | 'proportional';
  points: number;
}

export interface ListeningQuestion {
  type: 'listening';
  _id?: string;
  prompt?: string;
  mediaUrl: string;
  expectedTranscript: string;
  attemptMode?: 'typing' | 'typing-or-speech';
  points: number;
}

export type ExerciseQuestion = MCQQuestion | MatchingQuestion | FillBlankQuestion | PronunciationQuestion | QuestionAnswerQuestion | ListeningQuestion;

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
  stats?: { completions: number; avgScore: number; uniqueStudents: number };
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
}

export interface QuestionResponse {
  questionIndex: number;
  selectedOptionIndex?: number;
  matchingResponse?: Array<{ leftIndex: number; rightIndex: number }>;
  fillBlankResponses?: string[];
  spokenText?: string;
  pronunciationScore?: number;
  qaResponse?: string;
  listeningText?: string;
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

export interface ExerciseFilters {
  level?: string;
  category?: string;
  difficulty?: string;
  targetLanguage?: string;
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class DigitalExerciseService {
  private apiUrl = `${environment.apiUrl}/digital-exercises`;

  constructor(private http: HttpClient) {}

  // ─── Student / Browse ─────────────────────────────────────────────────────

  getExercises(filters: ExerciseFilters = {}): Observable<any> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        params = params.set(key, val.toString());
      }
    });
    return this.http.get<any>(this.apiUrl, { params, withCredentials: true });
  }

  getExercise(id: string): Observable<DigitalExercise> {
    return this.http.get<DigitalExercise>(`${this.apiUrl}/${id}`, { withCredentials: true });
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

  getMyAttempts(exerciseId: string): Observable<ExerciseAttempt[]> {
    return this.http.get<ExerciseAttempt[]>(`${this.apiUrl}/${exerciseId}/my-attempts`, { withCredentials: true });
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

  generateFromPdf(options: {
    uploadId: string;
    types: string[];
    typeCounts?: Record<string, number>;
    targetLanguage: string;
    nativeLanguage: string;
    level: string;
    difficulty: string;
    maxQuestions: number;
  }): Observable<any> {
    return this.http.post<any>(`${environment.apiUrl}/pdf-exercises/generate`, options, { withCredentials: true });
  }

  cleanupPdf(uploadId: string): Observable<any> {
    return this.http.delete<any>(`${environment.apiUrl}/pdf-exercises/cleanup/${uploadId}`, { withCredentials: true });
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
      pronunciation: 'Pronunciation Check',
      'question-answer': 'Question / Answer',
      listening: 'Listening'
    };
    return labels[type] || type;
  }

  getQuestionTypeIcon(type: QuestionType): string {
    const icons: Record<QuestionType, string> = {
      mcq: 'quiz',
      matching: 'compare_arrows',
      'fill-blank': 'text_fields',
      pronunciation: 'record_voice_over',
      'question-answer': 'short_text',
      listening: 'headphones'
    };
    return icons[type] || 'help';
  }

  uploadListeningMedia(file: File): Observable<{ success: boolean; url: string }> {
    const formData = new FormData();
    formData.append('media', file);
    return this.http.post<{ success: boolean; url: string }>(
      `${environment.apiUrl}/listening-media/upload`,
      formData,
      { withCredentials: true }
    );
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
}
