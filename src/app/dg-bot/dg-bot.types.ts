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

/** Request body for POST /api/dg/conversation/respond. */
export interface DgConversationRequest {
  moduleId: string;
  sessionId: string;
  sceneIndex: number;
  userText: string;
  pronunciationScore: number;
  /** Remaining session time in seconds. */
  remainingSeconds: number;
  /** Current turn index BEFORE this response (0-based). */
  turnNumber: number;
  /** Last N conversation messages for AI context. */
  history: DgConversationMessage[];
}

/** Response from POST /api/dg/conversation/respond. */
export interface DgConversationResponse {
  /** AI reply in the target language, vocabulary-enforced. */
  text: string;
  /** Tamil translation of the AI reply (empty string if unavailable). */
  translatedTamil: string;
  /** Turn number after this response (1-based). */
  turnNumber: number;
  /** True when turnNumber has reached MAX_TURNS — player should advance. */
  sceneComplete: boolean;
}
