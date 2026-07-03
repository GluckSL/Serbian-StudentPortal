#!/usr/bin/env node
/**
 * Dedupe Online Exercises 2.0 (v2) documents.
 *
 * When "Copy to 2.0" was clicked more than once on the same source exercise,
 * multiple v2 copies were created. This keeps ONE per group and soft-deletes the
 * rest so teachers and students only see a single exercise.
 *
 * Grouping key (in priority order):
 *   1. splitLineage.sourceExerciseId  (set on copies made after the lineage fix,
 *      or after running tools/backfill-v2-exercise-split-lineage.js --apply)
 *   2. content signature: title | courseDay | level | category | sequenceLetter
 *
 * Keeper selection within a group:
 *   1. most completed student attempts (preserves progress data)
 *   2. has a non-empty targetBatches (already assigned to a batch)
 *   3. visibleToStudents = true
 *   4. newest updatedAt
 *
 * The keeper inherits the UNION of targetBatches from the group, and becomes
 * visible if any duplicate was visible.
 *
 * Usage:
 *   node tools/dedupe-v2-exercises.js           # dry run (no writes)
 *   node tools/dedupe-v2-exercises.js --apply   # perform the cleanup
 */
'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const DigitalExercise = require('../models/DigitalExercise');
const ExerciseAttempt = require('../models/ExerciseAttempt');

const APPLY = process.argv.includes('--apply');

function normStr(v) {
  return String(v ?? '').trim();
}

function contentKey(ex) {
  return [
    normStr(ex.title).toLowerCase(),
    String(ex.courseDay ?? ''),
    normStr(ex.level).toUpperCase(),
    normStr(ex.category),
    normStr(ex.sequenceLetter).toLowerCase(),
  ].join('|');
}

function groupKey(ex) {
  const src = ex.splitLineage && ex.splitLineage.sourceExerciseId;
  if (src) return `src:${String(src)}`;
  return `content:${contentKey(ex)}`;
}

function pickKeeper(group, completionsById) {
  return [...group].sort((a, b) => {
    const compA = completionsById.get(String(a._id)) || 0;
    const compB = completionsById.get(String(b._id)) || 0;
    if (compA !== compB) return compB - compA;

    const assignedA = Array.isArray(a.targetBatches) && a.targetBatches.length ? 1 : 0;
    const assignedB = Array.isArray(b.targetBatches) && b.targetBatches.length ? 1 : 0;
    if (assignedA !== assignedB) return assignedB - assignedA;

    const visA = a.visibleToStudents ? 1 : 0;
    const visB = b.visibleToStudents ? 1 : 0;
    if (visA !== visB) return visB - visA;

    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  })[0];
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(APPLY ? 'APPLY mode — updating database\n' : 'DRY RUN — pass --apply to write\n');

  const v2Exercises = await DigitalExercise.find({
    version: 'v2',
    isDeleted: { $ne: true },
  })
    .select('_id title courseDay level category sequenceLetter targetBatches visibleToStudents splitLineage updatedAt')
    .lean();

  if (!v2Exercises.length) {
    console.log('No v2 exercises found.');
    await mongoose.disconnect();
    return;
  }

  const completedCounts = await ExerciseAttempt.aggregate([
    { $match: { exerciseId: { $in: v2Exercises.map((e) => e._id) }, status: 'completed' } },
    { $group: { _id: '$exerciseId', count: { $sum: 1 } } },
  ]);
  const completionsById = new Map(completedCounts.map((c) => [String(c._id), c.count]));

  const groups = new Map();
  for (const ex of v2Exercises) {
    const key = groupKey(ex);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ex);
  }

  let groupsWithDupes = 0;
  let toDelete = 0;

  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    groupsWithDupes += 1;

    const keeper = pickKeeper(group, completionsById);
    const dupes = group.filter((ex) => String(ex._id) !== String(keeper._id));

    const mergedBatches = new Set(
      Array.isArray(keeper.targetBatches) ? keeper.targetBatches.map(String) : []
    );
    let shouldBeVisible = !!keeper.visibleToStudents;
    for (const d of dupes) {
      (Array.isArray(d.targetBatches) ? d.targetBatches : []).forEach((b) => mergedBatches.add(String(b)));
      if (d.visibleToStudents) shouldBeVisible = true;
    }

    console.log(`\nGroup [${key}]  "${keeper.title}" day ${keeper.courseDay}`);
    console.log(
      `  KEEP   ${keeper._id}  completions=${completionsById.get(String(keeper._id)) || 0}  ` +
        `batches=[${(keeper.targetBatches || []).join(',')}]  visible=${!!keeper.visibleToStudents}`
    );
    for (const d of dupes) {
      console.log(
        `  DELETE ${d._id}  completions=${completionsById.get(String(d._id)) || 0}  ` +
          `batches=[${(d.targetBatches || []).join(',')}]  visible=${!!d.visibleToStudents}`
      );
    }
    const mergedArr = [...mergedBatches];
    console.log(`  -> keeper batches become [${mergedArr.join(',')}], visible=${shouldBeVisible}`);
    toDelete += dupes.length;

    if (APPLY) {
      await DigitalExercise.updateOne(
        { _id: keeper._id },
        {
          $set: {
            targetBatches: mergedArr,
            visibleToStudents: shouldBeVisible,
            updatedAt: new Date(),
          },
        }
      );
      await DigitalExercise.updateMany(
        { _id: { $in: dupes.map((d) => d._id) } },
        { $set: { isDeleted: true, deletedAt: new Date(), isActive: false, visibleToStudents: false, updatedAt: new Date() } }
      );
    }
  }

  console.log(
    `\nDone. ${groups.size} groups, ${groupsWithDupes} with duplicates, ${toDelete} exercise(s) ${APPLY ? 'soft-deleted' : 'would be soft-deleted'}.`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
