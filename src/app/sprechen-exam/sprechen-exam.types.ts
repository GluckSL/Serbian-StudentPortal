// ─── Shared types for the Goethe A1 Sprechen exam bot ────────────────────────

export interface SprechenCard {
  type: 'keywords' | 'keyword' | 'object' | string;
  content: string;
  imageUrl?: string;
}

export interface SprechenBotMessage {
  role: 'bot' | 'moderator';
  text: string;
  phase?: string;
  /** English closed-caption line (DG Buddy CC EN). */
  captionEn?: string;
  /** Tamil closed-caption line (DG Buddy CC தமிழ்). */
  captionTa?: string;
}

export interface SprechenTurnResult {
  botMessages: SprechenBotMessage[];
  card: SprechenCard | null;
  phase: string;
  awaitingStudent: boolean;
  done: boolean;
  scores?: SprechenScores;
}

export interface SprechenScores {
  teil1: number;
  teil2: number;
  teil3: number;
  total: number;
  passed: boolean;
}

export interface SprechenEvalCriterion {
  id: string;
  label: string;
  met: boolean;
  note?: string;
}

export interface SprechenEvaluation {
  points: number;
  maxPoints: number;
  criteria: SprechenEvalCriterion[];
  modelVersion?: string;
}

export interface SprechenTutorOverride {
  points: number;
  note: string;
  by?: string;
  at?: string;
}

export interface SprechenTurn {
  _id: string;
  teil: number;
  turnNumber: number;
  phase: string;
  role: 'student' | 'bot';
  card: SprechenCard | null;
  transcript: string;
  durationMs: number | null;
  evaluation: SprechenEvaluation | null;
  tutorOverride: SprechenTutorOverride | null;
  botSpeech: string;
  at: string;
}

// ─── Module types ─────────────────────────────────────────────────────────────

export interface SprechenTeil1 {
  keywords: string[];
  introCardImageUrl?: string;
  spellPrompts: string[];
  numberPrompts: string[];
}

export interface SprechenTeil2Theme {
  name: string;
  studentKeyword: string;
  botKeyword: string;
  studentCardImageUrl?: string;
  botCardImageUrl?: string;
}

export interface SprechenTeil2 {
  themes: SprechenTeil2Theme[];
}

export interface SprechenTeil3Card {
  label: string;
  objectDe: string;
  imageUrl?: string;
}

export interface SprechenTeil3Round {
  studentCard: SprechenTeil3Card;
  botCard: SprechenTeil3Card;
}

export interface SprechenTeil3 {
  rounds: SprechenTeil3Round[];
}

export interface SprechenRubricCriterion {
  id: string;
  label: string;
  points: number;
  prompt: string;
  turnType: string;
}

export interface SprechenRubricTeil {
  maxPoints: number;
  criteria: SprechenRubricCriterion[];
}

export interface SprechenRubric {
  teil1?: SprechenRubricTeil;
  teil2?: SprechenRubricTeil;
  teil3?: SprechenRubricTeil;
}

export interface SprechenExamModuleSummary {
  _id: string;
  title: string;
  description?: string;
  level?: string;
  passThreshold?: number;
  visibleToStudents?: boolean;
  weeklyTestEnabled?: boolean;
  examEnabled?: boolean;
  courseDay?: number | null;
  targetBatchKeys?: string[];
  characterId?: { _id: string; name: string; avatarUrl?: string; voice?: string } | string | null;
  teil1?: SprechenTeil1;
  teil2?: SprechenTeil2;
  teil3?: SprechenTeil3;
  rubric?: SprechenRubric;
  studentProgress?: { attempts: number; bestTotal: number; lastCompleted: boolean };
  createdAt?: string;
}

export interface SprechenSessionSummary {
  sessionId: string;
  moduleId: string;
  moduleTitle: string;
  courseDay: number | null;
  scores: SprechenScores;
  completedAt: string;
}

export interface SprechenExamAggregate {
  total: number;
  completed: number;
  missed: number;
  passed: number;
  avgTotal: number;
  bestTotal: number;
}

export interface SprechenExamSummary {
  lastSession: SprechenSessionSummary | null;
  sessions: SprechenSessionSummary[];
  aggregate: SprechenExamAggregate;
}

export interface SprechenModuleListResponse {
  modules: SprechenExamModuleSummary[];
  studentCourseDay?: number;
  summary?: SprechenExamSummary;
}

export interface SprechenPlayPayload {
  module: SprechenExamModuleSummary;
  character: { _id: string; name: string; avatarUrl?: string; voice?: string } | null;
}

export interface SprechenSessionStart {
  sessionId: string;
  botMessages: SprechenBotMessage[];
  card: SprechenCard | null;
  phase: string;
  awaitingStudent: boolean;
}

// ─── Session review types (tutor dashboard) ───────────────────────────────────

export interface SprechenSessionRow {
  _id: string;
  student: { _id: string; name?: string; email?: string; regNo?: string; batch?: string } | null;
  createdAt: string;
  completed: boolean;
  completedAt?: string;
  scores: SprechenScores;
  turnCount: number;
}

export interface SprechenSessionListResponse {
  module: { _id: string; title: string; passThreshold?: number };
  sessions: SprechenSessionRow[];
  summary: { total: number; completed: number; avgTotal: number };
}

export interface SprechenReplayResponse {
  session: {
    _id: string;
    student: { name?: string; email?: string; regNo?: string; batch?: string } | null;
    createdAt: string;
    completed: boolean;
    completedAt?: string;
    scores: SprechenScores;
    moduleTitle?: string;
    passThreshold?: number;
  };
  turns: SprechenTurn[];
}

// ─── Player UI state ──────────────────────────────────────────────────────────

export type SprechenPlayerStatus = 'loading' | 'bot_speaking' | 'awaiting_student' | 'processing' | 'complete';

export type SprechenPartNum = 1 | 2 | 3 | 0;
