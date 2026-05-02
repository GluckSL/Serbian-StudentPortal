export type DgSceneType = 'intro' | 'teach' | 'practice' | 'feedback';

export type DgPlayerStatus = 'idle' | 'speaking' | 'listening' | 'processing' | 'result';

export type DgEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'thinking'
  | 'speaking'
  | 'confused'
  | 'surprised'
  | 'concerned'
  | 'excited';

export interface DgScene {
  _id?: string;
  type: DgSceneType;
  text: string;
  audioUrl?: string;
  expectedAnswer?: string;
  translation?: string;
  hint?: string;
  order: number;
}

/** Same shape as Learning Module role-play scenario + teaching lists. */
export interface DgRolePlayScenario {
  situation?: string;
  setting?: string;
  studentRole?: string;
  aiRole?: string;
  objective?: string;
  aiPersonality?: string;
  studentGuidance?: string;
  aiOpeningLines?: string[];
  suggestedStudentResponses?: string[];
}

export interface DgVocabEntry {
  word: string;
  translation: string;
  category: string;
  usage?: string;
}

export interface DgGrammarEntry {
  structure: string;
  examples: string[];
  level?: string;
}

export interface DgConversationFlowStage {
  stage: string;
  aiPrompts: string[];
  expectedResponses: string[];
  helpfulPhrases: string[];
}

export interface DgCharacterDoc {
  _id: string;
  name: string;
  /**
   * Single image URL from CMS/admin. When omitted, the player uses bundled
   * fox art from `assets/dg-bot/fox/` (full-body per mood).
   */
  avatarUrl?: string;
  animations?: Record<string, string>;
  voice?: string;
  personality?: string;
  isActive?: boolean;
  /** Single default tutor (e.g. Lumo) for new modules. */
  isDefault?: boolean;
}

export interface DgModuleSummary {
  _id: string;
  title: string;
  description?: string;
  level?: string;
  language?: string;
  nativeLanguage?: string;
  minimumCompletionTime?: number;
  minPracticeMinutes?: number;
  maxPracticeMinutes?: number | null;
  courseDay?: number | null;
  characterId?: string | DgCharacterDoc;
  visibleToStudents?: boolean;
  scenes?: DgScene[];
  updatedAt?: string;
  rolePlayScenario?: DgRolePlayScenario;
  allowedVocabulary?: DgVocabEntry[];
  aiTutorVocabulary?: DgVocabEntry[];
  allowedGrammar?: DgGrammarEntry[];
  conversationFlow?: DgConversationFlowStage[];
}

export interface DgPlayPayload {
  module: {
    _id: string;
    title: string;
    description?: string;
    level?: string;
    language?: string;
    nativeLanguage?: string;
    minimumCompletionTime?: number;
    minPracticeMinutes?: number;
    maxPracticeMinutes?: number | null;
    courseDay?: number | null;
    scenes: DgScene[];
    rolePlayScenario?: DgRolePlayScenario;
    allowedVocabulary?: DgVocabEntry[];
    aiTutorVocabulary?: DgVocabEntry[];
    allowedGrammar?: DgGrammarEntry[];
    conversationFlow?: DgConversationFlowStage[];
  };
  character: DgCharacterDoc;
}

export interface DgSessionStartResponse {
  sessionId: string;
  currentSceneIndex: number;
}

export interface DgGoalStep {
  id: string;
  label: string;
  done: boolean;
  current: boolean;
}

/** Runtime player UI snapshot (see `DgBotPlayerComponent` fields). */
export interface DgPlayerUiState {
  currentScene: DgScene | null;
  index: number;
  status: DgPlayerStatus;
  transcript: string;
  score: number | null;
  isTransitioning: boolean;
}

// ─── Conversation / Role-play types ──────────────────────────────────────────

/** One message in the per-scene conversation history sent to the backend. */
export interface DgConversationMessage {
  role: 'user' | 'ai';
  text: string;
}

/** Request body for POST /api/dg/conversation/start. */
export interface DgConversationStartRequest {
  moduleId: string;
  sessionId: string;
}

/** Response from POST /api/dg/conversation/start. */
export interface DgConversationStartResponse {
  ok: boolean;
  roleMessage: string;
  maxTurns: number;
  vocabCount: number;
  language: string;
  situation: string;
  minPracticeMinutes?: number;
  maxPracticeMinutes?: number | null;
}

/** Request body for POST /api/dg/conversation/respond. */
export interface DgConversationRequest {
  moduleId: string;
  sessionId: string;
  sceneIndex: number;
  userText: string;
  pronunciationScore: number;
  remainingSeconds: number;
  turnNumber: number;
  history: DgConversationMessage[];
  /** When set, server handles Continue / Complete without a spoken transcript. */
  clientAction?: 'continue' | 'complete';
}

/** Response from POST /api/dg/conversation/respond. */
export interface DgConversationResponse {
  text: string;
  translatedEnglish?: string;
  translatedTamil: string;
  /** Turn count after this response. */
  turnNumber: number;
  turnCount: number;
  /** True when the full conversation is complete. */
  sceneComplete: boolean;
  complete: boolean;
  conversationStarted: boolean;
  vocabCoverage: number;
  usedVocab?: string[];
  /**
   * 'waiting_start' | 'started' | 'core' | 'extension' | 'complete'
   * 'core'      = still working through admin vocab lists
   * 'extension' = core done; continuing at same CEFR level on scenario thread
   */
  phase: string;
  /** Percentage of student-list words the student has produced (0–100). */
  studentVocabCoverage?: number | null;
  /** Percentage of AI-list words the bot has modelled (0–100). */
  aiVocabCoverage?: number | null;
  completionReason?: string | null;
  elapsedSeconds?: number;
  minRequiredSeconds?: number;
  maxAllowedSeconds?: number | null;
  shouldWrapUp?: boolean;
  /** True when student should repeat in the target language; client shows `hintDe` / `hintEn`. */
  languageHint?: boolean;
  hintDe?: string;
  hintEn?: string;
}

/** One entry in the chat history shown on screen. */
export interface DgChatMessage {
  speaker: 'ai' | 'student' | 'hint';
  text: string;
  score?: number;
  translation?: string;
  translationEn?: string;
}
