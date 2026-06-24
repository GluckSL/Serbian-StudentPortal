// config/glueckArena.js — feature flags, economy tuning, push-ready hooks

module.exports = {
  features: {
    streaksV2: process.env.GA_STREAKS_V2 !== 'false',
    quests: process.env.GA_QUESTS !== 'false',
    leagues: process.env.GA_LEAGUES !== 'false',
    multiplayer: process.env.GA_MULTIPLAYER !== 'false',
    matchmaking: process.env.GA_MATCHMAKING !== 'false',
    classrooms: process.env.GA_CLASSROOMS !== 'false',
    aiGeneration: process.env.GA_AI_GENERATION !== 'false',
    economy: process.env.GA_ECONOMY !== 'false',
    advancedAnalytics: process.env.GA_ADVANCED_ANALYTICS !== 'false',
    adaptiveLearning: process.env.GA_ADAPTIVE_LEARNING !== 'false',
    notifications: process.env.GA_NOTIFICATIONS !== 'false',
    premium: process.env.GA_PREMIUM !== 'false',
  },
  streak: {
    milestones: [7, 14, 30, 50, 100],
    milestoneXp: { 7: 50, 14: 100, 30: 200, 50: 350, 100: 500 },
    weeklyRewardXp: 75,
    repairGemCost: 50,
    freezePerWeek: 1,
  },
  leagues: {
    tiers: ['bronze', 'silver', 'gold', 'diamond'],
    promoteTop: 5,
    relegateBottom: 5,
    weeklyXpReset: true,
  },
  economy: {
    dailyWheelCoins: [5, 10, 15, 20, 25, 50],
    streakFreezeCostCoins: 100,
    xpBoosterMultiplier: 1.5,
  },
  multiplayer: {
    roomTtlMinutes: 60,
    maxPlayers: 8,
    answerWindowMs: 15000,
    heartbeatIntervalMs: 15000,
    spectatorDelayMs: 3000,
    maxSpectatorsPerRoom: 50,
    eventBatching: process.env.GA_SOCKET_BATCH !== 'false',
  },
  replay: {
    retentionDays: parseInt(process.env.GA_REPLAY_RETENTION_DAYS, 10) || 30,
    maxEvents: 500,
  },
  matchmaking: {
    queueTtlMinutes: 5,
    skillRange: 200,
  },
  rateLimit: {
    answersPerMinute: 40,
    apiPerMinute: 120,
  },
  push: {
    provider: process.env.GA_PUSH_PROVIDER || 'none', // none | fcm | apns
    streakReminderHourUtc: 18,
  },
  ai: {
    provider: process.env.GA_AI_PROVIDER || 'openai',
    model: process.env.GA_AI_MODEL || 'gpt-4o-mini',
    maxTokens: 2000,
  },
};
