// ─── Shared types for the Goethe A1 Sprechen exam bot ────────────────────────

export interface SprechenCard {
  type: 'keywords' | 'keyword' | 'object' | 'a2_question' | 'a2_monologue' | 'a2_timetable' | string;
  content: string;
  imageUrl?: string;
  /** A2 question card — e.g. "Fragen zur Person" */
  sublabel?: string;
  /** A2 monologue card — sub-prompt chips */
  subPrompts?: string[];
  /** A2 timetable card — date heading */
  dateLabel?: string;
  /** A2 timetable card — structured slot list */
  slots?: SprechenA2TimetableSlot[];
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
  /** A2 monologue mode — student speaks freely, then presses Fertig to finish. */
  monologueMode?: boolean;
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

// ─── A2 module types ──────────────────────────────────────────────────────────

export interface SprechenA2QuestionCard {
  prompt: string;
  sublabel?: string;
  imageUrl?: string;
}

export interface SprechenA2Teil1 {
  instructionDe?: string;
  cards: SprechenA2QuestionCard[];
}

export interface SprechenA2MonologueCard {
  title: string;
  subPrompts: string[];
  imageUrl?: string;
}

export interface SprechenA2Teil2 {
  instructionDe?: string;
  cards: SprechenA2MonologueCard[];
}

export interface SprechenA2TimetableSlot {
  start: string;
  end: string;
  activity: string;
  busy: boolean;
}

export interface SprechenA2Timetable {
  imageUrl?: string;
  slots: SprechenA2TimetableSlot[];
}

export interface SprechenA2Teil3 {
  scenarioDe?: string;
  dateLabel?: string;
  studentTimetable?: SprechenA2Timetable;
  botTimetable?: SprechenA2Timetable;
}

export interface SprechenExamModuleSummary {
  _id: string;
  title: string;
  description?: string;
  level?: string;
  /** 'A1' (default) or 'A2' */
  examFormat?: string;
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
  a2Teil1?: SprechenA2Teil1;
  a2Teil2?: SprechenA2Teil2;
  a2Teil3?: SprechenA2Teil3;
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
