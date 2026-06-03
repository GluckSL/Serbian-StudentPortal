// GlückArena shared TypeScript types

export type ArticleGender = 'der' | 'die' | 'das';
export type GameType = 'scramble_rush' | 'sentence_builder' | 'matching' | 'flashcards' | 'image_matching' | 'gender_stack' | 'flapjugation' | 'whackawort' | 'memory' | 'jumbled_words' | 'hangman' | 'word_picture_match';
export type GameDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type AttemptStatus = 'in-progress' | 'completed' | 'abandoned';
export type LeaderboardPeriod = 'daily' | 'weekly' | 'all';

export interface TimerSettings {
  sessionLimitSeconds: number | null;
  perQuestionSeconds: number | null;
}

export interface GenderStackSettings {
  /** Seconds between new word spawns (3–5) */
  spawnIntervalSeconds: number;
  /** Seconds for a word to fall to the shelf line */
  fallDurationSeconds: number;
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
  genderStackSettings?: GenderStackSettings;
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

export interface ImageMatchPair {
  hint: string;
  imageUrl: string | null;
  audioUrl: string | null;
}

// Image Matching question (client-safe — no word field in pairs)
export interface ImageMatchingQuestion {
  _id: string;
  gameType: 'image_matching';
  order: number;
  pairs: ImageMatchPair[];
}

export interface GenderStackQuestion {
  _id: string;
  gameType: 'gender_stack';
  order: number;
  word: string;
  translation: string;
  audioUrl: string | null;
}

export interface FlapjugationQuestion {
  _id: string;
  gameType: 'flapjugation';
  order: number;
  word: string;
  translation: string;
  tokens: string[];
}

export interface WhackawortQuestion {
  _id: string;
  gameType: 'whackawort';
  order: number;
  word: string;
  translation: string;
  category: string;
}

export interface MemoryGamePair {
  word: string;
  imageUrl: string | null;
  audioUrl: string | null;
}

export interface MemoryGameQuestion {
  _id: string;
  gameType: 'memory';
  order: number;
  pairs: MemoryGamePair[];
}

export interface JumbledWordsQuestion {
  _id: string;
  gameType: 'jumbled_words';
  order: number;
  hint: string;
  imageUrl: string | null;
  audioUrl: string | null;
  jumbledLetters: string[];
  letterCount: number;
}

export interface HangmanQuestion {
  _id: string;
  gameType: 'hangman';
  order: number;
  hint: string;
  imageUrl: string | null;
  audioUrl: string | null;
  word: string;
  letterCount: number;
}

export interface WordPictureMatchPair {
  word: string;
  hint: string;
  imageUrl: string | null;
  audioUrl: string | null;
}

export interface WordPictureMatchQuestion {
  _id: string;
  gameType: 'word_picture_match';
  order: number;
  pairs: WordPictureMatchPair[];
}

export interface MatchingQuestion {
  _id: string;
  gameType: 'matching';
  order: number;
  word: string;
  translation: string;
}

export type GameQuestion = ScrambleQuestion | SentenceQuestion | ImageMatchingQuestion | GenderStackQuestion | FlapjugationQuestion | WhackawortQuestion | MemoryGameQuestion | JumbledWordsQuestion | HangmanQuestion | WordPictureMatchQuestion | MatchingQuestion;

// Admin-only question shapes (includes answers)
export interface AdminScrambleQuestion extends ScrambleQuestion {
  word: string;
}
export interface AdminSentenceQuestion extends SentenceQuestion {
  correctSentence: string;
  tokens: string[];
}
export interface AdminImageMatchPair {
  word: string;
  hint: string;
  imageUrl: string | null;
  audioUrl: string | null;
}

export interface AdminImageMatchingQuestion extends ImageMatchingQuestion {
  pairs: AdminImageMatchPair[];
}
export interface AdminGenderStackQuestion extends GenderStackQuestion {
  articleGender: ArticleGender;
}
export interface AdminFlapjugationQuestion extends FlapjugationQuestion {
}
export interface AdminWhackawortQuestion extends WhackawortQuestion {
}
export interface AdminMemoryMatchPair {
  word: string;
  imageUrl: string | null;
  audioUrl: string | null;
}

export interface AdminMemoryGameQuestion extends MemoryGameQuestion {
  pairs: AdminMemoryMatchPair[];
}
export interface AdminJumbledWordsQuestion extends JumbledWordsQuestion {
  word: string;
}
export interface AdminHangmanQuestion extends HangmanQuestion {
}
export interface AdminWordPictureMatchPair {
  word: string;
  hint: string;
  imageUrl: string | null;
  audioUrl: string | null;
}
export interface AdminWordPictureMatchQuestion extends WordPictureMatchQuestion {
  pairs: AdminWordPictureMatchPair[];
}
export type AdminGameQuestion = AdminScrambleQuestion | AdminSentenceQuestion | AdminImageMatchingQuestion | AdminGenderStackQuestion | AdminFlapjugationQuestion | AdminWhackawortQuestion | AdminMemoryGameQuestion | AdminJumbledWordsQuestion | AdminHangmanQuestion | AdminWordPictureMatchQuestion;

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
  correctAnswer: { word?: string; sentence?: string; tokens?: string[]; articleGender?: ArticleGender };
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
  shuffledWords?: string[];
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
    matching: { gamesCompleted: number; bestScore: number; totalXp: number };
    flashcards: { gamesCompleted: number; bestScore: number; totalXp: number };
    image_matching: { gamesCompleted: number; bestScore: number; totalXp: number };
    gender_stack: { gamesCompleted: number; bestScore: number; totalXp: number };
    flapjugation: { gamesCompleted: number; bestScore: number; totalXp: number };
    whackawort: { gamesCompleted: number; bestScore: number; totalXp: number };
    memory: { gamesCompleted: number; bestScore: number; totalXp: number };
    jumbled_words: { gamesCompleted: number; bestScore: number; totalXp: number };
    hangman: { gamesCompleted: number; bestScore: number; totalXp: number };
    word_picture_match: { gamesCompleted: number; bestScore: number; totalXp: number };
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
  uniqueStudents?: number;
  studentsInBatch?: number | null;
}

export interface StudentArenaStat {
  studentId: string;
  name: string;
  batch: string;
  attempts: number;
  completed: number;
  totalTimeSeconds: number;
  totalXp: number;
  totalScore: number;
  avgAccuracy: number;
  lastActivity: string | null;
}

export interface AdminAnalyticsResponse {
  success: boolean;
  kpis: AnalyticsKpis;
  studentStats: StudentArenaStat[];
  filters?: { batch: string | null; gameType: string | null };
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
  roomName?: string;
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
  question: ArenaBattleScrambleQuestion | ArenaBattleSentenceQuestion | ArenaBattleImageQuestion | ArenaBattleGenderQuestion | ArenaBattleFlashCardQuestion | ArenaBattleMatchingQuestion | ArenaBattleFlapjugationQuestion | ArenaBattleWhackawortQuestion | ArenaBattleJumbledWordsQuestion;
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

// ── Battlefield Types ─────────────────────────────────────────────────────────

export interface ChatMessage {
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface BattlefieldRoomListing {
  inviteCode: string;
  roomName: string;
  gameType: GameType;
  hostName: string;
  hostId: string;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'playing';
  isPublic: boolean;
  hasPassword: boolean;
  teamMode?: boolean;
}

export interface BattlefieldStatsDto {
  gamesPlayed: number;
  wins: number;
  losses: number;
  elo: number;
  tier: string;
}

export interface BattlefieldLeaderboardEntry {
  rank: number;
  studentId: string;
  name: string;
  elo: number;
  tier: string;
  wins: number;
  losses: number;
  winRate: number;
  isMe?: boolean;
}

export interface TeamBattleDto {
  _id: string;
  title: string;
  gameSetId: string;
  gameType: GameType;
  status: 'pending' | 'active' | 'finished';
  teamA: {
    name: string;
    type: 'classroom' | 'manual';
    classroomId?: string;
    score: number;
    members: { id: string; name: string; score: number }[];
  };
  teamB: {
    name: string;
    type: 'classroom' | 'manual';
    classroomId?: string;
    score: number;
    members: { id: string; name: string; score: number }[];
  };
  rounds: number;
  currentRound: number;
  winner: string | null;
  roomCode: string | null;
  startsAt: string;
  createdBy: string;
}

export interface TeamBattleStanding {
  batch: string;
  played: number;
  won: number;
  lost: number;
  pointsFor: number;
  pointsAgainst: number;
  winRate: number;
}

export interface ArenaBattleGenderQuestion {
  questionId: string;
  index: number;
  word: string;
  translation?: string;
}

export interface ArenaBattleImageQuestion {
  questionId: string;
  index: number;
  imageUrl: string;
  word: string;
  options: string[];
}

export interface ArenaBattleFlashCardQuestion {
  questionId: string;
  index: number;
  prompt: string;
  hint?: string;
}

export interface ArenaBattleMatchingQuestion {
  questionId: string;
  index: number;
  pairs: { id: string; left: string; right: string }[];
  shuffledLeft: string[];
  shuffledRight: string[];
}

export interface ArenaBattleFlapjugationQuestion {
  questionId: string;
  index: number;
  infinitive: string;
  forms: string[];
  translation?: string;
}

export interface ArenaBattleWhackawortQuestion {
  questionId: string;
  index: number;
  targetCategory: string;
  words: Array<{ word: string; translation: string; category: string }>;
  duration: number;
}

export interface ArenaBattleJumbledWordsQuestion {
  questionId: string;
  index: number;
  jumbledLetters: string[];
  hint?: string;
  imageUrl?: string | null;
  audioUrl?: string | null;
  letterCount: number;
}
