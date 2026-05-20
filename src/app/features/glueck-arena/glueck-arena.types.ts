// GlückArena shared TypeScript types

export type GameType = 'scramble_rush' | 'sentence_builder' | 'matching' | 'flashcards';
export type GameDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type AttemptStatus = 'in-progress' | 'completed' | 'abandoned';
export type LeaderboardPeriod = 'daily' | 'weekly' | 'all';

export interface TimerSettings {
  sessionLimitSeconds: number | null;
  perQuestionSeconds: number | null;
}

export interface GameSet {
  _id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  icon: string;
  gameType: GameType;
  difficulty: GameDifficulty;
  level: CefrLevel | null;
  category: string;
  tags: string[];
  targetLanguage: string;
  xpReward: number;
  timerSettings: TimerSettings;
  visibleToStudents: boolean;
  courseDay: number | null;
  sequenceLetter: string | null;
  targetBatches?: string[];
  targetBatchKeys?: string[];
  batchLabel?: string;
  isPublished: boolean;
  isArchived: boolean;
  questionCount: number;
  estimatedDurationMinutes: number;
  createdAt: string;
  updatedAt: string;
  studentProgress?: StudentProgress;
}

export interface StudentProgress {
  bestScore: number | null;
  timesPlayed: number;
}

// Scramble Rush question (client-safe — no word field)
export interface ScrambleQuestion {
  _id: string;
  gameType: 'scramble_rush';
  order: number;
  hint: string;
  imageUrl: string | null;
  audioUrl: string | null;
  difficultyLevel: number;
  /** Seconds until this word crosses the deadline line */
  fallDurationSeconds: number;
  scrambledLetters: string[];
  letterCount: number;
}

// Sentence Builder question — correctTokens used for instant slot feedback in rearrange mode
export interface SentenceQuestion {
  _id: string;
  gameType: 'sentence_builder';
  order: number;
  translation: string;
  sentenceAudioUrl: string | null;
  randomizeWords: boolean;
  shuffledTokens: string[];
  correctTokens: string[];
}

export type GameQuestion = ScrambleQuestion | SentenceQuestion;

// Admin-only question shapes (includes answers)
export interface AdminScrambleQuestion extends ScrambleQuestion {
  word: string;
}
export interface AdminSentenceQuestion extends SentenceQuestion {
  correctSentence: string;
  tokens: string[];
}
export type AdminGameQuestion = AdminScrambleQuestion | AdminSentenceQuestion;

export interface GameLevel {
  _id?: string;
  gameSetId?: string;
  levelNumber: number;
  lives: number;
  timeLimitSeconds: number;
  fallSpeedMs: number;
  spawnIntervalMs: number;
  wordsRequired: number;
  scoreMultiplier: number;
}

export interface GameAttempt {
  _id: string;
  studentId: string;
  gameSetId: string;
  gameType: GameType;
  status: AttemptStatus;
  startedAt: string;
  completedAt: string | null;
  timeSpentSeconds: number;
  score: number;
  xpEarned: number;
  accuracy: number;
  totalQuestions: number;
  correctAnswers: number;
  livesRemaining: number;
  currentLevel: number;
  wordsCompleted: number;
  attemptNumber: number;
}

export interface AnswerResult {
  success: boolean;
  isCorrect: boolean;
  pointsEarned: number;
  speedBonus?: number;
  correctAnswer: { word?: string; sentence?: string; tokens?: string[] };
}

export interface CompleteResult {
  success: boolean;
  attempt: GameAttempt;
  xpBonus: number;
  accuracy: number;
  newAchievements?: AchievementDto[];
  preview?: boolean;
}

export interface StartAttemptResult {
  success: boolean;
  attempt: GameAttempt;
  questions: GameQuestion[];
  levels: GameLevel[];
  set: GameSet;
  preview?: boolean;
}

export interface CatalogResponse {
  success: boolean;
  items: GameSet[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  name: string;
  avatarUrl?: string;
  totalXp?: number;
  gamesCompleted?: number;
  bestScore: number;
  bestTime?: number;
  accuracy?: number;
  /** Completed runs contributing to this row (per-game leaderboard) */
  attempts?: number;
  currentStreak?: number;
}

export interface LeaderboardResponse {
  success: boolean;
  leaderboard: LeaderboardEntry[];
  period?: LeaderboardPeriod;
  studentRank: number | null;
}

export interface StudentGameStats {
  studentId: string;
  totalXp: number;
  gamesPlayed: number;
  gamesCompleted: number;
  totalCorrectAnswers: number;
  totalAnswers: number;
  accuracy: number;
  bestScore: number;
  currentStreak: number;
  bestStreak: number;
  lastPlayedDate: string | null;
  arenaLevel?: number;
  byGameType: {
    scramble_rush: { gamesCompleted: number; bestScore: number; totalXp: number };
    sentence_builder: { gamesCompleted: number; bestScore: number; totalXp: number };
  };
}

export interface CatalogFilters {
  gameType?: GameType;
  difficulty?: GameDifficulty;
  level?: CefrLevel;
  search?: string;
  page?: number;
  limit?: number;
}

export interface AnalyticsKpis {
  attemptsStarted: number;
  attemptsCompleted: number;
  completionRate: number;
  averageAccuracy: number;
  totalXpEarned: number;
  avgSessionSeconds: number;
  rageQuitPercent: number;
  leaderboardEngagedPlayers: number;
}

export interface AdminAnalyticsResponse {
  success: boolean;
  kpis: AnalyticsKpis;
  mostPlayedGames: { gameSetId: string; title: string; gameType: string; plays: number; completed: number }[];
  hardestQuestions: { questionId: string; word?: string; correctSentence?: string; errorRate: number }[];
  dailyActivePlayers: { date: string; count: number }[];
  attemptsTrend: { date: string; attempts: number; completed: number }[];
  dateRange: { from: string; to: string };
}

export interface DailyChallengeProgress {
  _id: string;
  challengeKey: string;
  title?: string;
  description?: string;
  progress: number;
  targetValue: number;
  isCompleted: boolean;
  isClaimed: boolean;
  xpReward?: number;
}

export interface StreakDashboard {
  currentStreak: number;
  bestStreak: number;
  streakFreezes: number;
  walletFreezes: number;
  weeklyStreakDays: number;
  weeklyStreakRewardClaimed: boolean;
  weeklyRewardXp: number;
  milestones: { days: number; xpReward: number; claimed: boolean; unlocked: boolean }[];
  calendar: { dateKey: string; status: string; xpEarned?: number; gamesCompleted?: number }[];
  pushReminderEnabled: boolean;
}

export interface QuestProgress {
  _id: string;
  questKey: string;
  title?: string;
  description?: string;
  progress: number;
  targetValue: number;
  isCompleted: boolean;
  isClaimed: boolean;
  xpReward?: number;
  coinReward?: number;
  period: string;
}

export interface LeagueBoard {
  weekKey: string;
  tier: string;
  tiers: string[];
  leaderboard: { rank: number; studentId: string; name: string; weeklyXp: number; tier: string; isMe: boolean }[];
  myRank: number | null;
  promoteTop?: number;
  relegateBottom?: number;
}

export interface StudentWalletDto {
  coins: number;
  gems: number;
  inventory: { itemKey: string; quantity: number }[];
}

export interface ArenaProfileDto {
  profile: { displayName?: string; avatarUrl?: string | null; frameKey?: string; bio?: string };
  stats: StudentGameStats | null;
  recentActivity: unknown[];
  league: { tier: string; weeklyXp: number; rank: number | null } | null;
  achievements: unknown[];
  isOwner: boolean;
}

export interface ArenaLeaderboardEntry {
  rank?: number;
  studentId?: string;
  name: string;
  score: number;
  isMe?: boolean;
  isConnected?: boolean;
}

export interface ArenaRoomState {
  _id?: string;
  inviteCode: string;
  status: 'lobby' | 'countdown' | 'playing' | 'finished' | 'cancelled';
  gameType: string;
  gameSetId: string;
  hostId?: string;
  players: {
    studentId: string;
    name: string;
    score: number;
    isReady: boolean;
    isConnected: boolean;
    correctAnswers?: number;
    totalAnswers?: number;
  }[];
  maxPlayers: number;
  battle?: ArenaBattlePublic | null;
  currentQuestionIndex?: number;
}

export interface ArenaBattlePublic {
  totalRounds: number;
  currentRound: number;
  roundDurationMs: number;
  roundStartedAt?: string | null;
  roundEndsAt?: string | null;
  serverTime?: number;
}

export interface ArenaBattleScrambleQuestion {
  questionId: string;
  index: number;
  scrambledLetters: string[];
  hint?: string;
  audioUrl?: string | null;
  imageUrl?: string | null;
  letterCount?: number;
}

export interface ArenaBattleSentenceQuestion {
  questionId: string;
  index: number;
  shuffledTokens: string[];
  translation?: string;
  sentenceAudioUrl?: string | null;
}

export interface ArenaBattleRound {
  roundIndex: number;
  totalRounds: number;
  question: ArenaBattleScrambleQuestion | ArenaBattleSentenceQuestion;
  roundStartedAt?: string;
  roundEndsAt?: string;
  serverTime: number;
  roundDurationMs: number;
}

export interface ArenaBattleAnswerResult {
  isCorrect: boolean;
  points: number;
  fastest?: boolean;
  comboStreak?: number;
  correctAnswer?: { word?: string; sentence?: string };
  responseTimeMs?: number;
}

export interface ArenaBattleSnapshot {
  battle: ArenaBattlePublic;
  round: ArenaBattleRound | null;
}

export interface ArenaTournamentDto {
  _id: string;
  title: string;
  gameType: string;
  gameSetId: string;
  status: string;
  startsAt: string;
  endsAt?: string | null;
  maxParticipants: number;
  entryRules?: { minLevel?: number; premiumOnly?: boolean; inviteOnly?: boolean };
  rewards?: { xpFirst?: number; xpSecond?: number; xpThird?: number; badgeKey?: string | null };
  participants?: string[];
  participantNames?: { id: string; name: string }[];
  bracket?: ArenaBracketMatch[];
}

export interface ArenaBracketMatch {
  round: number;
  playerAId?: string | null;
  playerBId?: string | null;
  playerAName?: string | null;
  playerBName?: string | null;
  winnerId?: string | null;
  winnerName?: string | null;
  roomCode?: string | null;
  status: string;
}

export interface ArenaReplayDto {
  id: string;
  shareToken?: string;
  gameType: string;
  durationMs: number;
  highlights?: string[];
  events: { t: number; type: string; data?: Record<string, unknown> }[];
  createdAt?: string;
}

export interface ArenaReplaySummary {
  _id: string;
  inviteCode?: string;
  gameType: string;
  durationMs: number;
  shareToken?: string;
  createdAt: string;
}

export interface AchievementDto {
  _id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  criteriaType: string;
  criteriaValue: number;
  xpReward: number;
  isUnlocked: boolean;
  unlockedAt: string | null;
}
