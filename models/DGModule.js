const mongoose = require('mongoose');

const DGSceneSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['intro', 'teach', 'practice', 'feedback'],
      required: true,
    },
    text: { type: String, default: '' },
    /** Pre-generated narration MP3 (or other audio) URL; player prefers this over runtime TTS. */
    audioUrl: { type: String, default: '' },
    expectedAnswer: { type: String, default: '' },
    translation: { type: String, default: '' },
    hint: { type: String, default: '' },
    order: { type: Number, required: true, min: 0 },
  },
  { _id: true }
);

/** Mirrors Learning Modules role-play content for admin + future player/AI use. */
const DgVocabEntrySchema = new mongoose.Schema(
  {
    word: { type: String, default: '' },
    translation: { type: String, default: '' },
    category: { type: String, default: '' },
    usage: { type: String, default: '' },
  },
  { _id: false }
);

const DgGrammarEntrySchema = new mongoose.Schema(
  {
    structure: { type: String, default: '' },
    examples: { type: [String], default: [] },
    level: { type: String, default: '' },
  },
  { _id: false }
);

const DgFlowEntrySchema = new mongoose.Schema(
  {
    stage: { type: String, default: '' },
    aiPrompts: { type: [String], default: [] },
    expectedResponses: { type: [String], default: [] },
    helpfulPhrases: { type: [String], default: [] },
  },
  { _id: false }
);

const DgRolePlayScenarioSchema = new mongoose.Schema(
  {
    situation: { type: String, default: '' },
    setting: { type: String, default: '' },
    studentRole: { type: String, default: '' },
    aiRole: { type: String, default: '' },
    objective: { type: String, default: '' },
    aiPersonality: { type: String, default: '' },
    studentGuidance: { type: String, default: '' },
    aiOpeningLines: { type: [String], default: [] },
    suggestedStudentResponses: { type: [String], default: [] },
  },
  { _id: false }
);

const DGModuleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    characterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DGCharacter',
      required: true,
    },
    scenes: { type: [DGSceneSchema], default: [] },
    level: { type: String, default: 'A1' },
    visibleToStudents: { type: Boolean, default: false },
    /**
     * Exam bucket flags (mutually exclusive).
     * - weeklyTestEnabled: visible under Student → My Course → Gluck Exam → Weekly Test
     * - examEnabled:       visible under Student → My Course → Gluck Exam → Exams
     * Default: both false (not shown under Gluck Exam).
     */
    weeklyTestEnabled: { type: Boolean, default: false },
    examEnabled: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    language: { type: String, default: 'German' },
    /** Target language mirror; native = student's L1 (same as Learning Modules role-play). */
    nativeLanguage: { type: String, default: 'English' },
    minimumCompletionTime: { type: Number, default: 10, min: 5, max: 60 },
    minPracticeMinutes: { type: Number, default: 10, min: 5, max: 120 },
    maxPracticeMinutes: { type: Number, default: null, min: 5, max: 180 },
    /** 1–200 day in course journey; unset = general pool */
    courseDay: { type: Number, min: 0, max: 200 },
    /**
     * Optional batch targeting.
     * Empty / missing = visible to all batches (subject to other gating like journey day).
     *
     * Stored as normalized batch keys (see utils/effectiveStudentBatch.normalizeBatch).
     */
    targetBatchKeys: { type: [String], default: [] },
    rolePlayScenario: { type: DgRolePlayScenarioSchema, default: () => ({}) },
    allowedVocabulary: { type: [DgVocabEntrySchema], default: [] },
    aiTutorVocabulary: { type: [DgVocabEntrySchema], default: [] },
    allowedGrammar: { type: [DgGrammarEntrySchema], default: [] },
    conversationFlow: { type: [DgFlowEntrySchema], default: [] },
  },
  { timestamps: true }
);

DGModuleSchema.index({ visibleToStudents: 1, isActive: 1, level: 1 });
DGModuleSchema.index({ createdBy: 1 });
DGModuleSchema.index({ targetBatchKeys: 1, visibleToStudents: 1, isActive: 1, courseDay: 1 });

DGModuleSchema.pre('validate', function dgValidatePracticeWindow(next) {
  if (
    this.maxPracticeMinutes != null &&
    this.minPracticeMinutes != null &&
    this.maxPracticeMinutes < this.minPracticeMinutes
  ) {
    this.invalidate('maxPracticeMinutes', 'Max practice minutes must be greater than or equal to min practice minutes.');
  }
  if (this.weeklyTestEnabled && this.examEnabled) {
    this.invalidate('examEnabled', 'Only one of Weekly Test or Exam can be enabled.');
    this.invalidate('weeklyTestEnabled', 'Only one of Weekly Test or Exam can be enabled.');
  }
  next();
});

DGModuleSchema.methods.getSortedScenes = function getSortedScenes() {
  return [...(this.scenes || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
};

module.exports = mongoose.model('DGModule', DGModuleSchema);
module.exports.DGSceneSchema = DGSceneSchema;
