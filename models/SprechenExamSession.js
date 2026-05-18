'use strict';

const mongoose = require('mongoose');

const EvalCriterionSchema = new mongoose.Schema(
  {
    id: { type: String },
    label: { type: String },
    met: { type: Boolean },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const EvaluationSchema = new mongoose.Schema(
  {
    points: { type: Number, default: 0 },
    maxPoints: { type: Number, default: 0 },
    criteria: { type: [EvalCriterionSchema], default: [] },
    modelVersion: { type: String, default: '' },
  },
  { _id: false }
);

const TutorOverrideSchema = new mongoose.Schema(
  {
    points: { type: Number },
    note: { type: String, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const TurnCardSchema = new mongoose.Schema(
  {
    type: { type: String, default: '' },
    content: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
  },
  { _id: false }
);

// One turn = one participant speaking (student or bot)
const SprechenTurnSchema = new mongoose.Schema(
  {
    teil: { type: Number, required: true },
    turnNumber: { type: Number, required: true },
    phase: { type: String, default: '' },
    role: { type: String, enum: ['student', 'bot'], required: true },
    card: { type: TurnCardSchema, default: null },
    transcript: { type: String, default: '' },
    durationMs: { type: Number, default: null },
    evaluation: { type: EvaluationSchema, default: null },
    tutorOverride: { type: TutorOverrideSchema, default: null },
    botSpeech: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ScoresSchema = new mongoose.Schema(
  {
    teil1: { type: Number, default: 0 },
    teil2: { type: Number, default: 0 },
    teil3: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
  },
  { _id: false }
);

// Persisted exam state (replaces in-memory Map used by DG Bot)
const ExamStateSchema = new mongoose.Schema(
  {
    phase: { type: String, default: 'welcome' },
    awaitingStudent: { type: Boolean, default: false },
    cardType: { type: String, default: '' },
    cardContent: { type: String, default: '' },
    cardImageUrl: { type: String, default: '' },
    teilNumber: { type: Number, default: 0 },
    teilStartedAt: { type: Date, default: null },
  },
  { _id: false }
);

const SprechenExamSessionSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SprechenExamModule',
      required: true,
      index: true,
    },
    state: { type: ExamStateSchema, default: () => ({}) },
    scores: { type: ScoresSchema, default: () => ({}) },
    turns: { type: [SprechenTurnSchema], default: [] },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SprechenExamSessionSchema.index({ studentId: 1, moduleId: 1, completed: 1, createdAt: -1 });

module.exports = mongoose.model('SprechenExamSession', SprechenExamSessionSchema);
