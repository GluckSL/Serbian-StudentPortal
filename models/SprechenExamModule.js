'use strict';

const mongoose = require('mongoose');

// ─── A2 sub-schemas ───────────────────────────────────────────────────────────

const A2QuestionCardSchema = new mongoose.Schema(
  {
    prompt: { type: String, default: '' },
    sublabel: { type: String, default: 'Fragen zur Person' },
    imageUrl: { type: String, default: '' },
  },
  { _id: false }
);

const A2Teil1Schema = new mongoose.Schema(
  {
    instructionDe: {
      type: String,
      default:
        'Sie bekommen vier Karten und stellen mit diesen Karten vier Fragen. ' +
        'Ihr Partner antwortet. Dann stellt Ihr Partner vier Fragen und Sie antworten.',
    },
    cards: { type: [A2QuestionCardSchema], default: [] },
  },
  { _id: false }
);

const A2MonologueCardSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    subPrompts: { type: [String], default: [] },
    imageUrl: { type: String, default: '' },
  },
  { _id: false }
);

const A2Teil2Schema = new mongoose.Schema(
  {
    instructionDe: {
      type: String,
      default: 'Sie bekommen eine Karte und erzählen etwas über Ihr Leben.',
    },
    cards: { type: [A2MonologueCardSchema], default: [] },
  },
  { _id: false }
);

const A2TimetableSlotSchema = new mongoose.Schema(
  {
    start: { type: String, default: '' },
    end: { type: String, default: '' },
    activity: { type: String, default: '' },
    busy: { type: Boolean, default: false },
  },
  { _id: false }
);

const A2TimetableSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, default: '' },
    slots: { type: [A2TimetableSlotSchema], default: [] },
  },
  { _id: false }
);

const A2Teil3Schema = new mongoose.Schema(
  {
    scenarioDe: { type: String, default: '' },
    dateLabel: { type: String, default: '' },
    studentTimetable: { type: A2TimetableSchema, default: () => ({}) },
    botTimetable: { type: A2TimetableSchema, default: () => ({}) },
  },
  { _id: false }
);

// ─── A1 sub-schemas ───────────────────────────────────────────────────────────

const Teil1Schema = new mongoose.Schema(
  {
    keywords: { type: [String], default: ['Name', 'Alter', 'Land', 'Wohnort', 'Sprachen', 'Beruf', 'Hobby'] },
    /** Admin-uploaded intro card image (shown above Olly during Teil 1). */
    introCardImageUrl: { type: String, default: '' },
    spellPrompts: { type: [String], default: [] },
    numberPrompts: { type: [String], default: [] },
  },
  { _id: false }
);

const Teil2ThemeSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    studentKeyword: { type: String, default: '' },
    botKeyword: { type: String, default: '' },
    studentCardImageUrl: { type: String, default: '' },
    botCardImageUrl: { type: String, default: '' },
  },
  { _id: false }
);

const Teil2Schema = new mongoose.Schema(
  { themes: { type: [Teil2ThemeSchema], default: [] } },
  { _id: false }
);

const SprechenCardSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    objectDe: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
  },
  { _id: false }
);

const Teil3RoundSchema = new mongoose.Schema(
  {
    studentCard: { type: SprechenCardSchema, default: () => ({}) },
    botCard: { type: SprechenCardSchema, default: () => ({}) },
  },
  { _id: false }
);

const Teil3Schema = new mongoose.Schema(
  { rounds: { type: [Teil3RoundSchema], default: [] } },
  { _id: false }
);

const RubricCriterionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, default: '' },
    points: { type: Number, default: 1 },
    prompt: { type: String, default: '' },
    turnType: { type: String, default: '' },
  },
  { _id: false }
);

const RubricTeilSchema = new mongoose.Schema(
  {
    maxPoints: { type: Number, default: 0 },
    criteria: { type: [RubricCriterionSchema], default: [] },
  },
  { _id: false }
);

const SprechenExamModuleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
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
    courseDay: { type: Number, min: 0, max: 200 },
    targetBatchKeys: { type: [String], default: [] },
    passThreshold: { type: Number, default: 10, min: 0, max: 15 },
    characterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DGCharacter',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    /**
     * 'A1' = classic Goethe A1 three-Teil format (default, backwards compatible).
     * 'A2' = Goethe A2 format: question dialogue / monologue / timetable scheduling.
     */
    examFormat: { type: String, default: 'A1' },
    teil1: { type: Teil1Schema, default: () => ({}) },
    teil2: { type: Teil2Schema, default: () => ({}) },
    teil3: { type: Teil3Schema, default: () => ({}) },
    /** A2-specific content — only populated when examFormat === 'A2'. */
    a2Teil1: { type: A2Teil1Schema, default: () => ({}) },
    a2Teil2: { type: A2Teil2Schema, default: () => ({}) },
    a2Teil3: { type: A2Teil3Schema, default: () => ({}) },
    rubric: {
      type: new mongoose.Schema(
        {
          teil1: { type: RubricTeilSchema, default: () => ({}) },
          teil2: { type: RubricTeilSchema, default: () => ({}) },
          teil3: { type: RubricTeilSchema, default: () => ({}) },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
  },
  { timestamps: true }
);

SprechenExamModuleSchema.index({ isActive: 1, visibleToStudents: 1, courseDay: 1, createdAt: 1 });

SprechenExamModuleSchema.pre('validate', function sprechenValidateBucketFlags(next) {
  if (this.weeklyTestEnabled && this.examEnabled) {
    this.invalidate('examEnabled', 'Only one of Weekly Test or Exam can be enabled.');
    this.invalidate('weeklyTestEnabled', 'Only one of Weekly Test or Exam can be enabled.');
  }
  next();
});

module.exports = mongoose.model('SprechenExamModule', SprechenExamModuleSchema);
