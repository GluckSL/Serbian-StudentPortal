'use strict';

const mongoose = require('mongoose');

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
    isActive: { type: Boolean, default: true },
    courseDay: { type: Number, min: 1, max: 200 },
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
    teil1: { type: Teil1Schema, default: () => ({}) },
    teil2: { type: Teil2Schema, default: () => ({}) },
    teil3: { type: Teil3Schema, default: () => ({}) },
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

module.exports = mongoose.model('SprechenExamModule', SprechenExamModuleSchema);
