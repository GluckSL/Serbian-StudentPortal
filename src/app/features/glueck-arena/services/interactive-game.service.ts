import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  CatalogFilters,
  CatalogResponse,
  GameSet,
  StartAttemptResult,
  AnswerResult,
  CompleteResult,
  LeaderboardResponse,
  LeaderboardPeriod,
  StudentGameStats,
  AdminGameQuestion,
  GameLevel,
} from '../glueck-arena.types';

@Injectable({ providedIn: 'root' })
export class InteractiveGameService {
  private readonly base = `${environment.apiUrl}/interactive-games`;

  constructor(private http: HttpClient) {}

  // ── Student ───────────────────────────────────────────────────────────────

  getCatalog(filters: CatalogFilters = {}): Observable<CatalogResponse> {
    let params = new HttpParams();
    if (filters.gameType) params = params.set('gameType', filters.gameType);
    if (filters.difficulty) params = params.set('difficulty', filters.difficulty);
    if (filters.level) params = params.set('level', filters.level);
    if (filters.search) params = params.set('search', filters.search);
    params = params.set('page', String(filters.page ?? 1));
    params = params.set('limit', String(filters.limit ?? 12));
    return this.http.get<CatalogResponse>(this.base, { params });
  }

  getGameDetail(id: string): Observable<{ success: boolean; set: GameSet; leaderboardPreview: any[] }> {
    return this.http.get<any>(`${this.base}/${id}`);
  }

  startAttempt(gameSetId: string): Observable<StartAttemptResult> {
    return this.http.post<StartAttemptResult>(`${this.base}/${gameSetId}/attempts`, {});
  }

  submitAnswer(attemptId: string, payload: {
    questionId: string;
    typedWord?: string;
    orderedTokens?: string[];
    articleGender?: string;
    responseTimeMs?: number;
    questionElapsedMs?: number;
  }): Observable<AnswerResult> {
    return this.http.post<AnswerResult>(`${this.base}/attempts/${attemptId}/answers`, payload);
  }

  submitSentenceSlot(attemptId: string, payload: {
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
    return this.http.post<any>(`${this.base}/attempts/${attemptId}/slots`, payload);
  }

  submitImageMatchSlot(attemptId: string, payload: {
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
    return this.http.post<any>(`${this.base}/attempts/${attemptId}/image-match`, payload);
  }

  submitMemoryMatch(attemptId: string, payload: {
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
    totalPairs: number;
  }> {
    return this.http.post<any>(`${this.base}/attempts/${attemptId}/memory-match`, payload);
  }

  submitWordPictureMatchSlot(attemptId: string, payload: {
    questionId: string;
    pairIndex: number;
    word: string;
    responseTimeMs?: number;
  }): Observable<{
    success: boolean;
    isCorrect: boolean;
    pointsEarned: number;
  }> {
    return this.http.post<any>(`${this.base}/attempts/${attemptId}/word-picture-match`, payload);
  }

  completeAttempt(attemptId: string, payload: {
    timeSpentSeconds: number;
    livesRemaining?: number;
    currentLevel?: number;
  }): Observable<CompleteResult> {
    return this.http.post<CompleteResult>(`${this.base}/attempts/${attemptId}/complete`, payload);
  }

  abandonAttempt(attemptId: string): Observable<any> {
    return this.http.post(`${this.base}/attempts/${attemptId}/abandon`, {});
  }

  getMyStats(): Observable<{ success: boolean; stats: StudentGameStats | null }> {
    return this.http.get<any>(`${this.base}/me/stats`);
  }

  getArenaAccess(): Observable<{ success: boolean; hasAccess: boolean; gameCount: number }> {
    return this.http.get<any>(`${this.base}/me/arena-access`);
  }

  getGlobalLeaderboard(period: LeaderboardPeriod = 'all'): Observable<LeaderboardResponse> {
    return this.http.get<LeaderboardResponse>(`${this.base}/leaderboard/global?period=${period}`);
  }

  getGameLeaderboard(gameSetId: string): Observable<LeaderboardResponse> {
    return this.http.get<LeaderboardResponse>(`${this.base}/${gameSetId}/leaderboard`);
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  adminListSets(params: { page?: number; limit?: number; gameType?: string; isPublished?: boolean; search?: string } = {}): Observable<any> {
    let p = new HttpParams();
    if (params.page) p = p.set('page', String(params.page));
    if (params.limit) p = p.set('limit', String(params.limit));
    if (params.gameType) p = p.set('gameType', params.gameType);
    if (params.isPublished !== undefined) p = p.set('isPublished', String(params.isPublished));
    if (params.search) p = p.set('search', params.search);
    return this.http.get<any>(`${this.base}/admin/sets`, { params: p });
  }

  adminGetSet(id: string): Observable<any> {
    return this.http.get<any>(`${this.base}/admin/sets/${id}`);
  }

  adminCreateSet(data: Partial<GameSet>): Observable<any> {
    return this.http.post<any>(`${this.base}/admin/sets`, data);
  }

  adminUpdateSet(id: string, data: Partial<GameSet>): Observable<any> {
    return this.http.put<any>(`${this.base}/admin/sets/${id}`, data);
  }

  adminDeleteSet(id: string): Observable<any> {
    return this.http.delete<any>(`${this.base}/admin/sets/${id}`);
  }

  adminUploadThumbnail(id: string, file: File): Observable<any> {
    const fd = new FormData();
    fd.append('thumbnail', file);
    return this.http.post<any>(`${this.base}/admin/sets/${id}/thumbnail`, fd);
  }

  adminGetQuestions(gameSetId: string): Observable<{ success: boolean; questions: AdminGameQuestion[] }> {
    return this.http.get<any>(`${this.base}/admin/sets/${gameSetId}/questions`);
  }

  adminUpsertQuestions(gameSetId: string, questions: Partial<AdminGameQuestion>[]): Observable<any> {
    return this.http.post<any>(`${this.base}/admin/sets/${gameSetId}/questions`, { questions });
  }

  adminUpdateQuestion(qid: string, data: Partial<AdminGameQuestion>): Observable<any> {
    return this.http.put<any>(`${this.base}/admin/questions/${qid}`, data);
  }

  adminDeleteQuestion(qid: string): Observable<any> {
    return this.http.delete<any>(`${this.base}/admin/questions/${qid}`);
  }

  adminUploadQuestionImage(qid: string, file: File): Observable<any> {
    const fd = new FormData();
    fd.append('image', file);
    return this.http.post<any>(`${this.base}/admin/questions/${qid}/image`, fd);
  }

  adminUploadPairImage(qid: string, pairIndex: number, file: File): Observable<any> {
    const fd = new FormData();
    fd.append('image', file);
    return this.http.post<any>(`${this.base}/admin/questions/${qid}/pair-image/${pairIndex}`, fd);
  }

  adminGetLevels(gameSetId: string): Observable<{ success: boolean; levels: GameLevel[] }> {
    return this.http.get<any>(`${this.base}/admin/sets/${gameSetId}/levels`);
  }

  adminUpsertLevels(gameSetId: string, levels: Partial<GameLevel>[]): Observable<any> {
    return this.http.put<any>(`${this.base}/admin/sets/${gameSetId}/levels`, { levels });
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  adminAnalytics(params: Record<string, string> = {}): Observable<any> {
    let p = new HttpParams();
    Object.entries(params).forEach(([k, v]) => { if (v) p = p.set(k, v); });
    return this.http.get<any>(`${this.base}/admin/analytics`, { params: p });
  }

  teacherAnalytics(params: Record<string, string> = {}): Observable<any> {
    let p = new HttpParams();
    Object.entries(params).forEach(([k, v]) => { if (v) p = p.set(k, v); });
    return this.http.get<any>(`${this.base}/admin/teacher-analytics`, { params: p });
  }

  // ── Daily challenges & achievements ───────────────────────────────────────

  getDailyChallenges(): Observable<any> {
    return this.http.get<any>(`${this.base}/daily-challenges`);
  }

  claimDailyChallenge(progressId: string): Observable<any> {
    return this.http.post<any>(`${this.base}/daily-challenges/${progressId}/claim`, {});
  }

  getAchievements(): Observable<any> {
    return this.http.get<any>(`${this.base}/achievements`);
  }

  // ── Import ────────────────────────────────────────────────────────────────

  adminImportTemplate(gameSetId: string, gameType?: string): Observable<any> {
    let p = new HttpParams();
    if (gameType) p = p.set('gameType', gameType);
    return this.http.get<any>(`${this.base}/admin/sets/${gameSetId}/import/template`, { params: p });
  }

  adminImportPreview(gameSetId: string, rows: unknown[], importType?: string, gameType?: string): Observable<any> {
    return this.http.post<any>(`${this.base}/admin/sets/${gameSetId}/import/preview`, { rows, importType, gameType });
  }

  adminImportCommit(gameSetId: string, rows: unknown[], importType?: string, gameType?: string): Observable<any> {
    return this.http.post<any>(`${this.base}/admin/sets/${gameSetId}/import/commit`, { rows, importType, gameType });
  }

  adminUploadQuestionAudio(qid: string, file: File, field: 'word' | 'sentence' = 'word'): Observable<any> {
    const fd = new FormData();
    fd.append('audio', file);
    fd.append('field', field);
    return this.http.post<any>(`${this.base}/admin/questions/${qid}/audio`, fd);
  }

  // ── Streak 2.0 ────────────────────────────────────────────────────────────
  getStreakDashboard(): Observable<any> { return this.http.get(`${this.base}/me/streak`); }
  useStreakFreeze(dateKey: string): Observable<any> { return this.http.post(`${this.base}/me/streak/freeze`, { dateKey }); }
  repairStreak(): Observable<any> { return this.http.post(`${this.base}/me/streak/repair`, {}); }
  claimWeeklyStreak(): Observable<any> { return this.http.post(`${this.base}/me/streak/weekly-claim`, {}); }
  claimStreakMilestone(days: number): Observable<any> { return this.http.post(`${this.base}/me/streak/milestone/${days}/claim`, {}); }

  // ── Quests ────────────────────────────────────────────────────────────────
  getQuests(period?: string): Observable<any> {
    const p = period ? `?period=${period}` : '';
    return this.http.get(`${this.base}/quests${p}`);
  }
  claimQuest(progressId: string): Observable<any> { return this.http.post(`${this.base}/quests/${progressId}/claim`, {}); }

  // ── Leagues ───────────────────────────────────────────────────────────────
  getMyLeague(): Observable<any> { return this.http.get(`${this.base}/leagues/me`); }

  // ── Economy ───────────────────────────────────────────────────────────────
  getWallet(): Observable<any> { return this.http.get(`${this.base}/me/wallet`); }
  spinDailyWheel(): Observable<any> { return this.http.post(`${this.base}/me/wallet/daily-wheel`, {}); }

  // ── Profile ───────────────────────────────────────────────────────────────
  getArenaProfile(studentId?: string): Observable<any> {
    const url = studentId ? `${this.base}/profiles/${studentId}` : `${this.base}/me/profile`;
    return this.http.get(url);
  }
  updateArenaProfile(data: Record<string, unknown>): Observable<any> {
    return this.http.put(`${this.base}/me/profile`, data);
  }

  // ── Multiplayer ───────────────────────────────────────────────────────────
  createMultiplayerRoom(gameSetId: string): Observable<any> {
    return this.http.post(`${this.base}/multiplayer/rooms`, { gameSetId });
  }
  joinMultiplayerRoom(code: string): Observable<any> {
    return this.http.post(`${this.base}/multiplayer/join`, { code });
  }

  joinMatchmaking(body: { mode?: string; gameType?: string } = {}): Observable<any> {
    return this.http.post(`${this.base}/matchmaking/join`, body);
  }
  leaveMatchmaking(): Observable<any> { return this.http.post(`${this.base}/matchmaking/leave`, {}); }
  getMatchmakingStatus(): Observable<any> { return this.http.get(`${this.base}/matchmaking/status`); }

  getAdaptiveLearning(): Observable<any> { return this.http.get(`${this.base}/me/adaptive-learning`); }
  refreshAdaptiveLearning(): Observable<any> { return this.http.post(`${this.base}/me/adaptive-learning/refresh`, {}); }

  getNotificationPreferences(): Observable<any> { return this.http.get(`${this.base}/me/notifications/preferences`); }
  updateNotificationPreferences(prefs: Record<string, unknown>): Observable<any> {
    return this.http.put(`${this.base}/me/notifications/preferences`, prefs);
  }

  getPremiumStatus(): Observable<any> { return this.http.get(`${this.base}/me/premium`); }

  adminEnterpriseAnalytics(params: Record<string, string> = {}): Observable<any> {
    let p = new HttpParams();
    Object.entries(params).forEach(([k, v]) => { if (v) p = p.set(k, v); });
    return this.http.get(`${this.base}/admin/analytics/enterprise`, { params: p });
  }
  adminLiveMultiplayer(): Observable<any> { return this.http.get(`${this.base}/admin/multiplayer/live`); }
  adminMetrics(): Observable<any> { return this.http.get(`${this.base}/admin/metrics`); }
  adminAntiCheat(): Observable<any> { return this.http.get(`${this.base}/admin/anti-cheat`); }
  adminEconomyDashboard(): Observable<any> { return this.http.get(`${this.base}/admin/economy`); }

  // ── Classrooms ────────────────────────────────────────────────────────────
  listClassrooms(): Observable<any> { return this.http.get(`${this.base}/classrooms`); }
  joinClassroom(classCode: string): Observable<any> {
    return this.http.post(`${this.base}/classrooms/join`, { classCode });
  }

  // ── Mobile ────────────────────────────────────────────────────────────────
  mobileBootstrap(): Observable<any> { return this.http.get(`${this.base}/mobile/bootstrap`); }

  // ── Admin v2 ──────────────────────────────────────────────────────────────
  adminAdvancedAnalytics(params: Record<string, string> = {}): Observable<any> {
    let p = new HttpParams();
    Object.entries(params).forEach(([k, v]) => { if (v) p = p.set(k, v); });
    return this.http.get(`${this.base}/admin/analytics/advanced`, { params: p });
  }
  adminAiPreview(body: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.base}/admin/ai/generate-preview`, body);
  }

  // ── Tournaments ─────────────────────────────────────────────────────────────
  listTournaments(gameType?: string): Observable<{ success: boolean; tournaments: import('../glueck-arena.types').ArenaTournamentDto[] }> {
    let p = new HttpParams();
    if (gameType) p = p.set('gameType', gameType);
    return this.http.get<any>(`${this.base}/tournaments`, { params: p });
  }
  getTournamentHistory(): Observable<any> {
    return this.http.get(`${this.base}/tournaments/history`);
  }
  getTournament(id: string): Observable<{ success: boolean; tournament: import('../glueck-arena.types').ArenaTournamentDto }> {
    return this.http.get<any>(`${this.base}/tournaments/${id}`);
  }
  getTournamentLeaderboard(id: string): Observable<any> {
    return this.http.get(`${this.base}/tournaments/${id}/leaderboard`);
  }
  registerTournament(id: string): Observable<any> {
    return this.http.post(`${this.base}/tournaments/${id}/register`, {});
  }
  createTournament(body: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.base}/tournaments`, body);
  }
  updateTournament(id: string, body: Record<string, unknown>): Observable<any> {
    return this.http.patch(`${this.base}/tournaments/${id}`, body);
  }
  startTournament(id: string): Observable<any> {
    return this.http.post(`${this.base}/tournaments/${id}/start`, {});
  }
  adminListTournaments(): Observable<any> {
    return this.http.get(`${this.base}/admin/tournaments`);
  }
  adminTournamentAnalytics(): Observable<any> {
    return this.http.get(`${this.base}/admin/tournaments/analytics`);
  }

  // ── Replays ─────────────────────────────────────────────────────────────────
  listReplays(params: Record<string, string> = {}): Observable<{ success: boolean; replays: import('../glueck-arena.types').ArenaReplaySummary[] }> {
    let p = new HttpParams();
    Object.entries(params).forEach(([k, v]) => { if (v) p = p.set(k, v); });
    return this.http.get<any>(`${this.base}/replays`, { params: p });
  }
  getReplay(idOrToken: string): Observable<{ success: boolean; replay: import('../glueck-arena.types').ArenaReplayDto }> {
    return this.http.get<any>(`${this.base}/replays/${idOrToken}`);
  }

  // ── Observability / security ──────────────────────────────────────────────────
  adminObservability(): Observable<any> {
    return this.http.get(`${this.base}/admin/observability`);
  }
  adminAuditViewer(params: Record<string, string> = {}): Observable<any> {
    let p = new HttpParams();
    Object.entries(params).forEach(([k, v]) => { if (v) p = p.set(k, v); });
    return this.http.get(`${this.base}/admin/audit-viewer`, { params: p });
  }

  getRankedProfile(): Observable<any> { return this.http.get(`${this.base}/ranked/me`); }
  getRankedLeaderboard(): Observable<any> { return this.http.get(`${this.base}/ranked/leaderboard`); }

  // ── Battlefield ──────────────────────────────────────────────────────────
  listBattlefieldRooms(filters: { gameType?: string; search?: string } = {}): Observable<{ success: boolean; rooms: import('../glueck-arena.types').BattlefieldRoomListing[] }> {
    let p = new HttpParams();
    if (filters.gameType) p = p.set('gameType', filters.gameType);
    if (filters.search) p = p.set('search', filters.search);
    return this.http.get<any>(`${this.base}/battlefield/rooms`, { params: p });
  }
  createBattlefieldRoom(body: { gameSetId: string; roomName?: string; isPublic?: boolean; maxPlayers?: number }): Observable<any> {
    return this.http.post(`${this.base}/battlefield/rooms`, body);
  }
  joinBattlefieldRoom(code: string): Observable<any> {
    return this.http.post(`${this.base}/battlefield/rooms/${code}/join`, {});
  }
  getBattlefieldLeaderboard(params: { limit?: number; page?: number } = {}): Observable<{ success: boolean; entries: import('../glueck-arena.types').BattlefieldLeaderboardEntry[]; total: number; page: number; limit: number }> {
    let p = new HttpParams();
    if (params.limit) p = p.set('limit', String(params.limit));
    if (params.page) p = p.set('page', String(params.page));
    return this.http.get<any>(`${this.base}/battlefield/leaderboard`, { params: p });
  }
  getBattlefieldStats(): Observable<{ success: boolean; stats: import('../glueck-arena.types').BattlefieldStatsDto }> {
    return this.http.get<any>(`${this.base}/battlefield/stats`);
  }

  // ── Admin Team Battles ───────────────────────────────────────────────────
  listTeamBattles(status?: string): Observable<{ success: boolean; battles: import('../glueck-arena.types').TeamBattleDto[] }> {
    let p = new HttpParams();
    if (status) p = p.set('status', status);
    return this.http.get<any>(`${this.base}/admin/battlefield/team-battles`, { params: p });
  }
  createTeamBattle(body: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.base}/admin/battlefield/team-battles`, body);
  }
  startTeamBattle(id: string): Observable<any> {
    return this.http.post(`${this.base}/admin/battlefield/team-battles/${id}/start`, {});
  }
  cancelTeamBattle(id: string): Observable<any> {
    return this.http.post(`${this.base}/admin/battlefield/team-battles/${id}/cancel`, {});
  }
  deleteTeamBattle(id: string): Observable<any> {
    return this.http.delete(`${this.base}/admin/battlefield/team-battles/${id}`);
  }
  getTeamBattleScorecard(id: string): Observable<{ success: boolean; battle: import('../glueck-arena.types').TeamBattleDto }> {
    return this.http.get<any>(`${this.base}/admin/battlefield/team-battles/${id}/scorecard`);
  }
  getTeamBattleStandings(): Observable<{ success: boolean; standings: import('../glueck-arena.types').TeamBattleStanding[] }> {
    return this.http.get<any>(`${this.base}/admin/battlefield/team-battles/standings`);
  }
}
