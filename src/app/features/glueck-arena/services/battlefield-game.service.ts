import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { InteractiveGameService } from './interactive-game.service';
import { ArenaSocketService } from './arena-socket.service';
import {
  AnswerResult, StartAttemptResult, CompleteResult, GameAttempt, GameSet,
  GameLevel, GameQuestion,
} from '../glueck-arena.types';

interface AnswerData {
  questionId: string;
  typedWord?: string;
  orderedTokens?: string[];
  articleGender?: string;
  responseTimeMs?: number;
  questionElapsedMs?: number;
  pronoun?: string;
  word?: string;
  category?: string;
  slotIndex?: number;
  token?: string;
  pairIndex?: number;
}

interface BattlefieldQuestion {
  questionId: string;
  index: number;
  answerWord?: string;
  correctTokens?: string[];
  correctSentence?: string;
  articleGender?: string;
  category?: string;
  word?: string;
  tokens?: string[];
  [key: string]: any;
}

@Injectable()
export class BattlefieldGameService extends InteractiveGameService {
  private questions: BattlefieldQuestion[] = [];
  private _gameType = '';
  private get _socket(): ArenaSocketService { return this.arenaSocket; }
  private _answers: AnswerData[] = [];
  private mockAttempt!: GameAttempt;
  private sentenceTokens: {[questionId: string]: string[]} = {};
  private sentenceSent: {[questionId: string]: boolean} = {};

  constructor(http: HttpClient, private arenaSocket: ArenaSocketService) {
    super(http);
  }

  init(questions: BattlefieldQuestion[], gameType: string, userId: string) {
    this.questions = questions;
    this._gameType = gameType;
    this._answers = [];
    this.sentenceTokens = {};
    this.sentenceSent = {};
    this.mockAttempt = {
      _id: 'bf_' + Date.now(),
      studentId: userId,
      gameSetId: '',
      gameType: gameType as any,
      status: 'in-progress',
      startedAt: new Date().toISOString(),
      completedAt: null,
      timeSpentSeconds: 0,
      score: 0,
      xpEarned: 0,
      accuracy: 0,
      totalQuestions: questions.length,
      correctAnswers: 0,
      livesRemaining: 0,
      currentLevel: 0,
      wordsCompleted: 0,
      attemptNumber: 1,
    };
  }

  get attemptId(): string { return this.mockAttempt._id; }

  get answers(): AnswerData[] { return this._answers; }

  override startAttempt(_gameSetId: string): Observable<StartAttemptResult> {
    const set: GameSet = {
      _id: _gameSetId,
      title: 'Battlefield Game',
      gameType: this._gameType as GameSet['gameType'],
      description: '',
      difficulty: 'Intermediate',
      level: null,
      thumbnailUrl: null,
      icon: '',
      category: '',
      tags: [],
      targetLanguage: '',
      xpReward: 0,
      timerSettings: { sessionLimitSeconds: null, perQuestionSeconds: null },
      visibleToStudents: false,
      courseDay: null,
      sequenceLetter: null,
      isPublished: true,
      isArchived: false,
      questionCount: this.questions.length,
      estimatedDurationMinutes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return of({
      success: true,
      attempt: this.mockAttempt,
      questions: this.questions as unknown as GameQuestion[],
      levels: [],
      shuffledWords: [],
      set,
    });
  }

  override completeAttempt(_attemptId: string, _payload: {
    timeSpentSeconds: number;
    livesRemaining?: number;
    currentLevel?: number;
  }): Observable<CompleteResult> {
    return of({
      success: true,
      attempt: this.mockAttempt,
      xpBonus: 0,
      accuracy: 0,
    });
  }

  override submitAnswer(_attemptId: string, payload: {
    questionId: string;
    typedWord?: string;
    orderedTokens?: string[];
    articleGender?: string;
    responseTimeMs?: number;
    questionElapsedMs?: number;
  }): Observable<AnswerResult> {
    this._answers.push(payload);
    const question = this.questions.find(q => q.questionId === payload.questionId);
    const result = this.validateAnswer(question, payload);
    this.sendAnswerViaSocket(payload);
    return of(result);
  }

  override submitSentenceSlot(_attemptId: string, payload: {
    questionId: string;
    slotIndex: number;
    token: string;
    responseTimeMs?: number;
    questionElapsedMs?: number;
  }): Observable<{
    success: boolean;
    isCorrect: boolean;
    pointsEarned: number;
    speedBonus: number;
    questionComplete: boolean;
    totalSlots: number;
    correctSlots: number;
  }> {
    this._answers.push(payload);
    const question = this.questions.find(q => q.questionId === payload.questionId);
    const expected = question?.correctTokens?.[payload.slotIndex] || '';
    const actual = payload.token || '';
    const normalise = (t: string) => t.trim().toLowerCase().replace(/[.!?,;:]+$/g, '');
    const isCorrect = !!expected && normalise(actual) === normalise(expected);

    // Accumulate tokens for sentence_builder and send orderedTokens when complete
    if (this._gameType === 'sentence_builder') {
      if (!this.sentenceTokens[payload.questionId]) {
        this.sentenceTokens[payload.questionId] = [];
        this.sentenceSent[payload.questionId] = false;
      }
      this.sentenceTokens[payload.questionId][payload.slotIndex] = payload.token;
      const totalSlots = question?.correctTokens?.length || 0;
      const filled = this.sentenceTokens[payload.questionId].filter(t => t !== undefined).length;
      if (filled >= totalSlots && !this.sentenceSent[payload.questionId]) {
        this.sentenceSent[payload.questionId] = true;
        this.sendAnswerViaSocket({
          questionId: payload.questionId,
          orderedTokens: this.sentenceTokens[payload.questionId],
        });
      }
    } else {
      this.sendAnswerViaSocket(payload);
    }

    return of({
      success: true,
      isCorrect,
      pointsEarned: isCorrect ? 10 : 0,
      speedBonus: 0,
      questionComplete: false,
      totalSlots: question?.correctTokens?.length || 0,
      correctSlots: isCorrect ? 1 : 0,
    });
  }

  override submitWordPictureMatchSlot(_attemptId: string, payload: {
    questionId: string;
    pairIndex: number;
    word: string;
    responseTimeMs?: number;
  }): Observable<{ success: boolean; isCorrect: boolean; pointsEarned: number }> {
    this._answers.push(payload);
    const question = this.questions.find(q => q.questionId === payload.questionId);
    const pairs = question?.['pairs'] || [];
    const pair = pairs[payload.pairIndex];
    const isCorrect = !!(pair && (pair.word || '').toLowerCase().trim() === (payload.word || '').toLowerCase().trim());
    this.sendAnswerViaSocket(payload);
    return of({ success: true, isCorrect, pointsEarned: isCorrect ? 10 : 0 });
  }

  override submitMemoryMatch(_attemptId: string, payload: {
    questionId: string;
    pairIndex: number;
    word: string;
    responseTimeMs?: number;
  }): Observable<{
    success: boolean; isCorrect: boolean; pointsEarned: number;
    questionComplete: boolean; correctMatches: number; totalPairs: number;
  }> {
    this._answers.push(payload);
    const question = this.questions.find(q => q.questionId === payload.questionId);
    const pairs = question?.['pairs'] || [];
    const pair = pairs[payload.pairIndex];
    const isCorrect = !!(pair && (pair.word || '').toLowerCase().trim() === (payload.word || '').toLowerCase().trim());
    this.sendAnswerViaSocket(payload);
    return of({
      success: true, isCorrect, pointsEarned: isCorrect ? 10 : 0,
      questionComplete: false, correctMatches: isCorrect ? 1 : 0, totalPairs: 1,
    });
  }

  override submitImageMatchSlot(_attemptId: string, payload: {
    questionId: string;
    pairIndex: number;
    word: string;
    responseTimeMs?: number;
  }): Observable<{
    success: boolean;
    isCorrect: boolean;
    pointsEarned: number;
    questionComplete: boolean;
    correctMatches: number;
    totalMatches: number;
  }> {
    this._answers.push(payload);
    const question = this.questions.find(q => q.questionId === payload.questionId);
    const pairs = question?.['pairs'] || [];
    const pair = pairs[payload.pairIndex];
    const isCorrect = !!(pair && (pair.word || '').toLowerCase().trim() === (payload.word || '').toLowerCase().trim());
    this.sendAnswerViaSocket(payload);
    return of({
      success: true,
      isCorrect,
      pointsEarned: isCorrect ? 10 : 0,
      questionComplete: false,
      correctMatches: isCorrect ? 1 : 0,
      totalMatches: 1,
    });
  }

  private validateAnswer(question: BattlefieldQuestion | undefined, payload: any): AnswerResult {
    if (!question) {
      return { success: false, isCorrect: false, pointsEarned: 0, correctAnswer: {} };
    }

    const gameType = this._gameType;
    let isCorrect = false;
    let pointsEarned = 0;
    let correctAnswer: any = {};

    if (gameType === 'scramble_rush' || gameType === 'scramble') {
      const correct = (question.answerWord || '').toLowerCase().trim();
      const typed = (payload.typedWord || '').toLowerCase().trim();
      isCorrect = typed === correct;
      pointsEarned = isCorrect ? 10 : 0;
      if (!isCorrect) correctAnswer = { word: question.answerWord };
    } else if (gameType === 'gender_stack') {
      const correctGender = (question.articleGender || '').toLowerCase();
      const typed = (payload.typedWord || '').toLowerCase().trim();
      isCorrect = typed === correctGender;
      pointsEarned = isCorrect ? 10 : 0;
      if (!isCorrect) correctAnswer = { word: correctGender + ' ' + (question.word || '') };
    } else if (gameType === 'flashcards') {
      const correctWord = (question.answerWord || '').toLowerCase().trim();
      const userWord = (payload.typedWord || '').toLowerCase().trim();
      isCorrect = userWord === correctWord || userWord.includes(correctWord) || correctWord.includes(userWord);
      pointsEarned = isCorrect ? 10 : 0;
      if (!isCorrect) correctAnswer = { word: question.answerWord };
    } else if (gameType === 'matching') {
      const ordered = payload.orderedTokens || [];
      const tokens = question.tokens || [];
      let correctCount = 0;
      for (let i = 0; i < ordered.length && i < tokens.length; i++) {
        if ((ordered[i] || '').toLowerCase().trim() === (tokens[i] || '').toLowerCase().trim()) {
          correctCount++;
        }
      }
      isCorrect = correctCount === tokens.length;
      pointsEarned = isCorrect ? 10 : Math.max(0, correctCount * 2);
      if (!isCorrect) correctAnswer = { sentence: tokens.join(' | ') };
    } else if (gameType === 'flapjugation') {
      isCorrect = true; // handled by component, just acknowledge
      pointsEarned = 10;
    } else if (gameType === 'whackawort') {
      const targetCategory = (question.category || '').toLowerCase().trim();
      const tappedCategory = (payload.articleGender || payload.typedWord || '').toLowerCase().trim();
      isCorrect = tappedCategory === targetCategory;
      pointsEarned = isCorrect ? 10 : 0;
      if (!isCorrect) correctAnswer = { word: `Category: ${question.category || ''}` };
    } else if (gameType === 'multiple_choice') {
      const selectedIndex = payload.selectedIndex ?? -1;
      const correctIdx = (question as any).correctIndex ?? -1;
      isCorrect = selectedIndex === correctIdx && correctIdx >= 0;
      pointsEarned = isCorrect ? 10 : 0;
      correctAnswer = { correctIndex: correctIdx };
    } else {
      isCorrect = true;
      pointsEarned = 10;
    }

    return { success: true, isCorrect, pointsEarned, correctAnswer };
  }

  private normalizePayload(payload: any): any {
    const gt = this._gameType;
    const out: any = {
      roundIndex: this.findQuestionIndex(payload.questionId || ''),
      questionId: payload.questionId || '',
    };

    // Game types where client sends `word` but server expects `typedWord`
    if (['image_matching', 'word_picture_match', 'memory'].includes(gt)) {
      out.typedWord = payload.word || payload.typedWord || '';
      if (payload.pairIndex !== undefined) out.pairIndex = payload.pairIndex;
    } else if (gt === 'sentence_builder') {
      out.orderedTokens = payload.orderedTokens || [];
    } else if (gt === 'scramble_rush' || gt === 'gender_stack' || gt === 'flashcards' || gt === 'jumbled_words' || gt === 'hangman') {
      out.typedWord = payload.typedWord || '';
    } else if (gt === 'matching') {
      out.orderedTokens = payload.orderedTokens || [];
    } else if (gt === 'whackawort') {
      out.word = payload.word || '';
      out.category = payload.category || '';
    } else if (gt === 'flapjugation') {
      out.pronoun = payload.pronoun || '';
      out.typedWord = payload.typedWord || '';
    } else if (gt === 'multiple_choice') {
      out.selectedIndex = payload.selectedIndex;
    } else {
      out.typedWord = payload.typedWord || payload.word || '';
    }
    return out;
  }

  private sendAnswerViaSocket(payload: any) {
    this._socket.submitBattleAnswer(this.normalizePayload(payload));
  }

  private findQuestionIndex(questionId: string): number {
    const idx = this.questions.findIndex(q => q.questionId === questionId);
    return idx >= 0 ? idx : 0;
  }
}
