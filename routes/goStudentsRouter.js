// routes/goStudentsRouter.js
// Factory for GO Silver student routes (Tamil GO-SILVER / Sinhala GO-SINHALA).

const express = require('express');
const mongoose = require('mongoose');
const SilverGoUnlockCache = require('../models/SilverGoUnlockCache');
const User = require('../models/User');
const BatchConfig = require('../models/BatchConfig');
const DigitalExercise = require('../models/DigitalExercise');
const MeetingLink = require('../models/MeetingLink');
const ClassRecording = require('../models/ClassRecording');
const RecordingView = require('../models/RecordingView');
const ZoomRecording = require('../models/ZoomRecording');
const ZoomRecordingView = require('../models/ZoomRecordingView');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DGModule = require('../models/DGModule');
const DGSession = require('../models/DGSession');
const GameSet = require('../models/GameSet');
const GameAttempt = require('../models/GameAttempt');
const { studentTargetBatchKeys, moduleTargetingQuery } = require('../utils/batchTargeting');
const { verifyToken, checkRole } = require('../middleware/auth');
const { allStudentBatchStringsForContent, recordingAccessBatchKeys, batchesAlign } = require('../utils/effectiveStudentBatch');
const { withJourneyLevelInSet, levelForJourneyDay } = require('../services/journeyLevelSync.service');
const { getStudentDgJourneyAccess, dgModuleUnlockedForAccess } = require('../utils/dgStudentJourneyGate');
const {
  getTrackConfig,
  normalizeTrack,
  goStudentQuery,
  silverPoolQuery,
  isSilverGoStudent
} = require('../utils/goSilverTrack');
const {
  resolveSilverGoContentUnlock,
  reconcileSilverGoCourseDay
} = require('../utils/silverGoSequentialUnlock');
const {
  recordingWatchCountsAsComplete,
  recordingWatchSecondsForComplete
} = require('../utils/recordingWatchCompletion');
const { checkAndInstantlyAdvanceSilverGoStudent } = require('../services/journeyDayAdvance.service');
const { readRecoverablePassword } = require('../utils/passwordRecoverable');

function createGoStudentsRouter(trackKey) {
  const track = normalizeTrack(trackKey);
  const trackCfg = getTrackConfig(track);
  const GO_BATCH_NAME = trackCfg.batchName;
  const GO_LANGUAGE = trackCfg.language;
  const router = express.Router();
  /** @type {null | { running: boolean, total: number, done: number, fixedCount: number, alreadyCorrect: number, skipped: number, message: string, results: object[], startedAt?: string, finishedAt?: string, error?: string }} */
  let reconcileJob = null;

  function toGoStudentRow(student) {
    return {
      _id: student._id,
      name: student.name,
      regNo: student.regNo,
      email: student.email,
      subscription: student.subscription,
      goStatus: student.goStatus,
      goLanguage: student.goLanguage,
      goJoiningDate: student.goJoiningDate,
      currentCourseDay: student.currentCourseDay,
      batch: student.batch || '',
      level: student.level || '',
      studentStatus: student.studentStatus || '',
      displayPassword: readRecoverablePassword(student.passwordRecoverable) || null,
      lastLogin: student.lastLogin || null
    };
  }
  
  // ─── POST /api/go-students/add ────────────────────────────────────────────────
  // Find a SILVER student by email and mark them as GO
  router.post('/add', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const studentId = String(req.body?.studentId || '').trim();
      if (!email && !studentId) {
        return res.status(400).json({ message: 'Provide studentId or email.' });
      }
  
      const query = { role: 'STUDENT' };
      if (studentId) query._id = studentId;
      else query.email = email;
  
      const student = await User.findOne(query);
      if (!student) {
        return res.status(404).json({ message: 'Student not found.' });
      }
      if (student.subscription !== 'SILVER') {
        return res.status(400).json({ message: `Student is on the ${student.subscription} plan. Only SILVER students can be added to GO batch.` });
      }
      if (student.goStatus === 'GO') {
        return res.status(409).json({ message: 'Student is already in the GO batch.' });
      }
      const mediums = (student.medium || []).map((m) => String(m).toLowerCase());
      if (GO_LANGUAGE === 'Sinhala') {
        if (mediums.length && !mediums.includes('sinhala')) {
          return res.status(400).json({
            message: 'This student is not on the Sinhala medium. Add them from GO Students (Tamil) instead.'
          });
        }
      } else if (mediums.includes('sinhala')) {
        return res.status(400).json({
          message: 'This student is on the Sinhala medium. Add them from Silver Sinhala / GO Sinhala instead.'
        });
      }
  
      // Ensure batch config exists for this track
      await BatchConfig.findOneAndUpdate(
        { batchName: GO_BATCH_NAME },
        { $setOnInsert: { batchName: GO_BATCH_NAME, journeyLength: 200, batchCurrentDay: 1 } },
        { upsert: true, new: true }
      );
  
      student.goStatus = 'GO';
      student.goLanguage = GO_LANGUAGE;
      student.goJoiningDate = new Date();
      await student.save();
  
      res.json({
        message: 'Student added to GO batch successfully.',
        student: toGoStudentRow(student)
      });
    } catch (err) {
      console.error('go-students POST /add', err);
      res.status(500).json({ message: 'Failed to add student to GO batch.', error: err.message });
    }
  });
  
  // ─── GET /api/go-students ─────────────────────────────────────────────────────
  // List all GO Silver students. Default is a fast list (DB fields only).
  // Pass ?enrich=1 to resolve sequential unlock days (expensive; use sparingly).
  router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const students = await User.find(goStudentQuery(track))
        .select('name regNo email subscription goStatus goLanguage goJoiningDate currentCourseDay level batch studentStatus medium passwordRecoverable lastLogin')
        .sort({ name: 1 })
        .lean();

      const enrich =
        req.query.enrich === '1' ||
        req.query.enrich === 'true' ||
        req.query.enrich === 'yes';

      if (!enrich) {
        return res.json({ students: students.map((s) => toGoStudentRow(s)) });
      }

      const enriched = await Promise.all(
        students.map(async (s) => {
          const row = toGoStudentRow(s);
          if (!isSilverGoStudent(s)) return row;
          const unlock = await resolveSilverGoContentUnlock(s);
          const stored = s.currentCourseDay || 1;
          row.currentCourseDay = unlock.maxUnlockedContentDay;
          row.storedCourseDay = stored;
          row.needsJourneySync = unlock.maxUnlockedContentDay < stored;
          return row;
        })
      );

      res.json({ students: enriched });
    } catch (err) {
      console.error('go-students GET /', err);
      res.status(500).json({ message: 'Failed to fetch GO students.', error: err.message });
    }
  });
  
  // ─── GET /api/go-students/silver ──────────────────────────────────────────────
  // List Silver students that are not yet in GO, with search + batch filters.
  router.get('/silver', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const q = String(req.query?.q || '').trim();
      const batch = String(req.query?.batch || '').trim();
      const query = { ...silverPoolQuery(track) };
  
      if (batch && batch.toLowerCase() !== 'all') {
        query.batch = batch;
      }
  
      if (q) {
        const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$and = [
          {
            $or: [
              { name: new RegExp(safe, 'i') },
              { email: new RegExp(safe, 'i') },
              { regNo: new RegExp(safe, 'i') }
            ]
          }
        ];
      }
  
      const students = await User.find(query)
        .select('name regNo email subscription currentCourseDay level batch studentStatus')
        .sort({ name: 1 })
        .lean();
  
      const batches = await User.distinct('batch', {
        ...silverPoolQuery(track),
        batch: { $exists: true, $nin: ['', null] }
      });
  
      res.json({
        students,
        batches: (batches || []).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
      });
    } catch (err) {
      console.error('go-students GET /silver', err);
      res.status(500).json({ message: 'Failed to fetch Silver students.', error: err.message });
    }
  });
  
  // ─── POST /api/go-students/bulk-remove-batch ─────────────────────────────────
  // Clear batch values for selected GO students.
  router.post('/bulk-remove-batch', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
      const studentIds = ids.map((id) => String(id || '').trim()).filter(Boolean);
      if (!studentIds.length) {
        return res.status(400).json({ message: 'studentIds is required.' });
      }
  
      const result = await User.updateMany(
        { _id: { $in: studentIds }, ...goStudentQuery(track) },
        { $set: { batch: '' } }
      );
  
      res.json({
        message: `Batch removed for ${result.modifiedCount || 0} GO ${GO_LANGUAGE} student(s).`,
        matchedCount: result.matchedCount || 0,
        modifiedCount: result.modifiedCount || 0
      });
    } catch (err) {
      console.error('go-students POST /bulk-remove-batch', err);
      res.status(500).json({ message: 'Failed to remove batch for selected GO students.', error: err.message });
    }
  });
  
  // ─── POST /api/go-students/bulk-set-day ──────────────────────────────────────
  // Set journey day for selected GO students.
  router.post('/bulk-set-day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
      const studentIds = ids.map((id) => String(id || '').trim()).filter(Boolean);
      if (!studentIds.length) {
        return res.status(400).json({ message: 'studentIds is required.' });
      }
  
      let day = Number(req.body?.day);
      if (!Number.isFinite(day)) {
        return res.status(400).json({ message: 'day must be a number.' });
      }
      day = Math.floor(day);
  
      const goBatchCfg = await BatchConfig.findOne({ batchName: GO_BATCH_NAME }).select('journeyLength').lean();
      const maxDay =
        goBatchCfg?.journeyLength >= 1 ? Math.min(Math.floor(goBatchCfg.journeyLength), 200) : 200;
      if (day < 1 || day > maxDay) {
        return res.status(400).json({ message: `Journey day must be between 1 and ${maxDay}.` });
      }
  
      const result = await User.updateMany(
        { _id: { $in: studentIds }, ...goStudentQuery(track) },
        {
          $set: withJourneyLevelInSet(
            day,
            {
              currentCourseDay: day,
              pendingJourneyDayAdvance: false,
              pendingJourneyDayAdvanceForDay: null
            },
            { force: true }
          )
        }
      );
  
      res.json({
        message: `Journey day set to ${day} for ${result.modifiedCount || 0} GO ${GO_LANGUAGE} student(s).`,
        day,
        matchedCount: result.matchedCount || 0,
        modifiedCount: result.modifiedCount || 0
      });
    } catch (err) {
      console.error('go-students POST /bulk-set-day', err);
      res.status(500).json({ message: 'Failed to set journey day for selected GO students.', error: err.message });
    }
  });
  
  // ─── POST /api/go-students/bulk-set-batch ────────────────────────────────────
  // Assign batch value for selected GO students.
  router.post('/bulk-set-batch', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
      const studentIds = ids.map((id) => String(id || '').trim()).filter(Boolean);
      if (!studentIds.length) {
        return res.status(400).json({ message: 'studentIds is required.' });
      }
  
      const batch = String(req.body?.batch || '').trim();
      if (!batch) {
        return res.status(400).json({ message: 'batch is required.' });
      }
  
      const result = await User.updateMany(
        { _id: { $in: studentIds }, ...goStudentQuery(track) },
        { $set: { batch } }
      );
  
      res.json({
        message: `Batch set to "${batch}" for ${result.modifiedCount || 0} GO ${GO_LANGUAGE} student(s).`,
        batch,
        matchedCount: result.matchedCount || 0,
        modifiedCount: result.modifiedCount || 0
      });
    } catch (err) {
      console.error('go-students POST /bulk-set-batch', err);
      res.status(500).json({ message: 'Failed to set batch for selected GO students.', error: err.message });
    }
  });
  
  // ─── POST /api/go-students/silver/bulk-remove-batch ──────────────────────────
  // Clear wrongly assigned batch values for selected Silver students (non-GO only).
  router.post('/silver/bulk-remove-batch', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
      const studentIds = ids.map((id) => String(id || '').trim()).filter(Boolean);
      if (!studentIds.length) {
        return res.status(400).json({ message: 'studentIds is required.' });
      }
  
      const query = { _id: { $in: studentIds }, ...silverPoolQuery(track) };
  
      const result = await User.updateMany(query, {
        $set: { batch: '' }
      });
  
      res.json({
        message: `Batch removed for ${result.modifiedCount || 0} student(s).`,
        matchedCount: result.matchedCount || 0,
        modifiedCount: result.modifiedCount || 0
      });
    } catch (err) {
      console.error(`go-students(${track}) POST /silver/bulk-remove-batch`, err);
      res.status(500).json({ message: 'Failed to remove batch for selected students.', error: err.message });
    }
  });
  
  // ─── POST /api/go-students/silver/bulk-set-day ───────────────────────────────
  // Set journey day for selected Silver students (non-GO only).
  router.post('/silver/bulk-set-day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
      const studentIds = ids.map((id) => String(id || '').trim()).filter(Boolean);
      if (!studentIds.length) {
        return res.status(400).json({ message: 'studentIds is required.' });
      }
  
      let day = Number(req.body?.day);
      if (!Number.isFinite(day)) {
        return res.status(400).json({ message: 'day must be a number.' });
      }
      day = Math.floor(day);
      if (day < 1 || day > 200) {
        return res.status(400).json({ message: 'day must be between 1 and 200.' });
      }
  
      const query = { _id: { $in: studentIds }, ...silverPoolQuery(track) };
  
      const result = await User.updateMany(query, {
        $set: withJourneyLevelInSet(
          day,
          {
            currentCourseDay: day,
            pendingJourneyDayAdvance: false,
            pendingJourneyDayAdvanceForDay: null
          },
          { force: true }
        )
      });
  
      res.json({
        message: `Journey day set to ${day} for ${result.modifiedCount || 0} student(s).`,
        day,
        matchedCount: result.matchedCount || 0,
        modifiedCount: result.modifiedCount || 0
      });
    } catch (err) {
      console.error(`go-students(${track}) POST /silver/bulk-set-day`, err);
      res.status(500).json({ message: 'Failed to set journey day for selected students.', error: err.message });
    }
  });
  
  // ─── POST /api/go-students/silver/bulk-set-batch ─────────────────────────────
  // Assign batch value for selected Silver students (non-GO only).
  router.post('/silver/bulk-set-batch', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
      const studentIds = ids.map((id) => String(id || '').trim()).filter(Boolean);
      if (!studentIds.length) {
        return res.status(400).json({ message: 'studentIds is required.' });
      }
  
      const batch = String(req.body?.batch || '').trim();
      if (!batch) {
        return res.status(400).json({ message: 'batch is required.' });
      }
  
      const query = { _id: { $in: studentIds }, ...silverPoolQuery(track) };
  
      const result = await User.updateMany(query, {
        $set: { batch }
      });
  
      res.json({
        message: `Batch set to "${batch}" for ${result.modifiedCount || 0} student(s).`,
        batch,
        matchedCount: result.matchedCount || 0,
        modifiedCount: result.modifiedCount || 0
      });
    } catch (err) {
      console.error(`go-students(${track}) POST /silver/bulk-set-batch`, err);
      res.status(500).json({ message: 'Failed to set batch for selected students.', error: err.message });
    }
  });
  
  // ─── GET /api/go-students/reconcile-all/status ───────────────────────────────
  router.get('/reconcile-all/status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), (req, res) => {
    if (!reconcileJob) {
      return res.json({
        running: false,
        total: 0,
        done: 0,
        fixedCount: 0,
        alreadyCorrect: 0,
        skipped: 0,
        message: ''
      });
    }
    res.json(reconcileJob);
  });

  // ─── POST /api/go-students/reconcile-all ─────────────────────────────────────
  // Runs in the background (~3s per student). Returns 202 immediately; poll /status.
  router.post('/reconcile-all', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      if (reconcileJob?.running) {
        return res.status(409).json({
          message: 'Reconciliation already in progress.',
          running: true,
          done: reconcileJob.done,
          total: reconcileJob.total
        });
      }

      const students = await User.find(goStudentQuery(track))
        .select('_id name regNo currentCourseDay')
        .lean();

      reconcileJob = {
        running: true,
        total: students.length,
        done: 0,
        fixedCount: 0,
        alreadyCorrect: 0,
        skipped: 0,
        results: [],
        message: `Reconciling ${students.length} GO ${GO_LANGUAGE} student(s)…`,
        startedAt: new Date().toISOString()
      };

      res.status(202).json({
        started: true,
        message: `Started reconciliation for ${students.length} student(s). This may take a few minutes.`,
        total: students.length
      });

      setImmediate(async () => {
        try {
          for (const student of students) {
            try {
              await SilverGoUnlockCache.deleteOne({ studentId: student._id });
              const result = await reconcileSilverGoCourseDay(student._id);
              if (result.adjusted) {
                reconcileJob.fixedCount++;
                reconcileJob.results.push({
                  _id: student._id,
                  name: student.name,
                  regNo: student.regNo,
                  status: 'fixed',
                  storedDay: result.previousCourseDay,
                  correctDay: result.maxUnlockedContentDay
                });
              } else {
                reconcileJob.alreadyCorrect++;
              }
            } catch (studentErr) {
              reconcileJob.skipped++;
              reconcileJob.results.push({
                _id: student._id,
                name: student.name,
                regNo: student.regNo,
                status: 'error',
                error: studentErr.message
              });
            }
            reconcileJob.done++;
          }
          reconcileJob.message =
            `Reconciled ${students.length} student(s): ${reconcileJob.fixedCount} corrected, ` +
            `${reconcileJob.alreadyCorrect} already correct, ${reconcileJob.skipped} skipped/errored.`;
        } catch (err) {
          reconcileJob.error = err.message;
          reconcileJob.message = 'Reconciliation failed.';
          console.error('go-students reconcile-all background', err);
        } finally {
          reconcileJob.running = false;
          reconcileJob.finishedAt = new Date().toISOString();
        }
      });
    } catch (err) {
      console.error('go-students POST /reconcile-all', err);
      res.status(500).json({ message: 'Reconciliation failed.', error: err.message });
    }
  });

  // ─── PATCH /api/go-students/:studentId/journey-day ─────────────────────────────
  // Set the student's journey day (what they can access in the portal); clears pending auto-advance flags.
  router.patch('/:studentId/journey-day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const { studentId } = req.params;
      let day = Number(req.body?.currentCourseDay);
      if (!Number.isFinite(day)) {
        return res.status(400).json({ message: 'currentCourseDay must be a number.' });
      }
      day = Math.floor(day);
  
      const goBatchCfg = await BatchConfig.findOne({ batchName: GO_BATCH_NAME }).select('journeyLength').lean();
      const maxDay =
        goBatchCfg?.journeyLength >= 1 ? Math.min(Math.floor(goBatchCfg.journeyLength), 200) : 200;
      if (day < 1 || day > maxDay) {
        return res.status(400).json({ message: `Journey day must be between 1 and ${maxDay}.` });
      }
  
      const student = await User.findOne({ _id: studentId, ...goStudentQuery(track) });
      if (!student) return res.status(404).json({ message: `GO ${GO_LANGUAGE} student not found.` });
  
      student.currentCourseDay = day;
      student.level = levelForJourneyDay(day);
      student.pendingJourneyDayAdvance = false;
      student.pendingJourneyDayAdvanceForDay = null;
      await student.save();
  
      res.json({
        message: 'Journey day updated.',
        currentCourseDay: day,
        level: student.level
      });
    } catch (err) {
      console.error('go-students PATCH /:id/journey-day', err);
      res.status(500).json({ message: 'Failed to update journey day.', error: err.message });
    }
  });
  
  // ─── DELETE /api/go-students/:studentId/remove ────────────────────────────────
  // Remove a student from GO batch (clear goStatus)
  router.delete('/:studentId/remove', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const { studentId } = req.params;
      const student = await User.findOne({ _id: studentId, role: 'STUDENT' });
      if (!student) return res.status(404).json({ message: 'Student not found.' });
  
      student.goStatus = undefined;
      student.goLanguage = undefined;
      student.goJoiningDate = null;
      await student.save();
  
      res.json({
        message: 'Student moved back to Silver batch.',
        student: {
          _id: student._id,
          name: student.name,
          regNo: student.regNo,
          email: student.email,
          subscription: student.subscription,
          goStatus: student.goStatus,
          goJoiningDate: student.goJoiningDate,
          currentCourseDay: student.currentCourseDay,
          batch: student.batch || '',
          level: student.level || '',
          studentStatus: student.studentStatus || ''
        }
      });
    } catch (err) {
      console.error('go-students DELETE /:id/remove', err);
      res.status(500).json({ message: 'Failed to remove student from GO batch.', error: err.message });
    }
  });
  
  async function upsertManualRecordingView(studentId, recordingId, durationSec) {
    const targetSec = recordingWatchSecondsForComplete(durationSec);
    const existing = await RecordingView.findOne({ student: studentId, recording: recordingId })
      .sort({ startedAt: -1 });
    if (existing) {
      existing.watchDuration = Math.max(Number(existing.watchDuration) || 0, targetSec);
      existing.lastUpdatedAt = new Date();
      await existing.save();
      return existing.watchDuration;
    }
    const created = await RecordingView.create({
      student: studentId,
      recording: recordingId,
      watchDuration: targetSec
    });
    return created.watchDuration;
  }

  async function upsertZoomRecordingView(studentId, meetingLinkId, durationSec) {
    const targetSec = recordingWatchSecondsForComplete(durationSec);
    const existing = await ZoomRecordingView.findOne({ student: studentId, meetingLinkId })
      .sort({ startedAt: -1 });
    if (existing) {
      existing.watchDuration = Math.max(Number(existing.watchDuration) || 0, targetSec);
      existing.lastUpdatedAt = new Date();
      await existing.save();
      return existing.watchDuration;
    }
    const created = await ZoomRecordingView.create({
      student: studentId,
      meetingLinkId,
      watchDuration: targetSec
    });
    return created.watchDuration;
  }

  // ─── POST /api/go-students/:studentId/recordings/:recordingId/mark-watched ─
  router.post(
    '/:studentId/recordings/:recordingId/mark-watched',
    verifyToken,
    checkRole(['ADMIN', 'TEACHER_ADMIN']),
    async (req, res) => {
      try {
        const { studentId, recordingId } = req.params;
        const student = await User.findOne({ _id: studentId, ...goStudentQuery(track) })
          .select('_id goStatus subscription')
          .lean();
        if (!student) return res.status(404).json({ message: `GO ${GO_LANGUAGE} student not found.` });

        const recording = await ClassRecording.findOne({
          _id: recordingId,
          active: true,
          isPublished: { $ne: false }
        })
          .select('duration title')
          .lean();
        if (!recording) return res.status(404).json({ message: 'Recording not found.' });

        const watchDuration = await upsertManualRecordingView(
          studentId,
          recordingId,
          Number(recording.duration || 0)
        );
        const watched = recordingWatchCountsAsComplete(
          watchDuration,
          Number(recording.duration || 0)
        );

        let journeyAdvanced = false;
        if (isSilverGoStudent(student)) {
          await SilverGoUnlockCache.deleteOne({ studentId });
          const adv = await checkAndInstantlyAdvanceSilverGoStudent(studentId);
          journeyAdvanced = !!adv?.advanced;
        }

        res.json({
          success: true,
          watched,
          watchDuration,
          journeyAdvanced
        });
      } catch (err) {
        console.error('go-students POST mark-watched (manual)', err);
        res.status(500).json({ message: 'Failed to mark recording as watched.', error: err.message });
      }
    }
  );

  // ─── POST /api/go-students/:studentId/zoom-meetings/:meetingLinkId/mark-watched
  router.post(
    '/:studentId/zoom-meetings/:meetingLinkId/mark-watched',
    verifyToken,
    checkRole(['ADMIN', 'TEACHER_ADMIN']),
    async (req, res) => {
      try {
        const { studentId, meetingLinkId } = req.params;
        const student = await User.findOne({ _id: studentId, ...goStudentQuery(track) })
          .select('_id goStatus subscription')
          .lean();
        if (!student) return res.status(404).json({ message: `GO ${GO_LANGUAGE} student not found.` });

        const meeting = await MeetingLink.findById(meetingLinkId)
          .select('topic duration courseDay')
          .lean();
        if (!meeting) return res.status(404).json({ message: 'Class meeting not found.' });

        const zoomRec = await ZoomRecording.findOne({
          meetingLinkId,
          isPublished: { $ne: false }
        })
          .select('duration status')
          .lean();
        if (!zoomRec) return res.status(404).json({ message: 'Zoom recording not found for this class.' });

        const durationSec =
          Number(zoomRec.duration) > 0
            ? Number(zoomRec.duration)
            : meeting?.duration != null && Number(meeting.duration) > 0
              ? Math.round(Number(meeting.duration) * 60)
              : 0;

        const watchDuration = await upsertZoomRecordingView(studentId, meetingLinkId, durationSec);
        const watched = recordingWatchCountsAsComplete(watchDuration, durationSec);

        let journeyAdvanced = false;
        if (isSilverGoStudent(student)) {
          await SilverGoUnlockCache.deleteOne({ studentId });
          const adv = await checkAndInstantlyAdvanceSilverGoStudent(studentId);
          journeyAdvanced = !!adv?.advanced;
        }

        res.json({
          success: true,
          watched,
          watchDuration,
          journeyAdvanced
        });
      } catch (err) {
        console.error('go-students POST mark-watched (zoom)', err);
        res.status(500).json({ message: 'Failed to mark zoom recording as watched.', error: err.message });
      }
    }
  );

  // ─── GET /api/go-students/:studentId/detail ──────────────────────────────────
  // Full detail for one GO student: recordings, modules, exercises, progress
  router.get('/:studentId/detail', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
    try {
      const { studentId } = req.params;
  
      const student = await User.findOne({ _id: studentId, ...goStudentQuery(track) })
        .select('name regNo email level batch subscription goStatus goLanguage goJoiningDate currentCourseDay medium')
        .lean();
      if (!student) return res.status(404).json({ message: `GO ${GO_LANGUAGE} student not found.` });

      const storedCourseDay = student.currentCourseDay || 1;
      // Same keys as student visibility + journey completion (own class batch / GO track).
      const batchKeys = recordingAccessBatchKeys(student);
      const studentLevel = String(student.level || 'A1').toUpperCase();
      const batchRecOr = batchKeys.map((k) => ({
        batches: new RegExp(`^${String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      }));

      // Force a fresh completion re-check on every admin detail load so stale cache
      // (e.g. recordings uploaded after a student auto-advanced) doesn't hide the true day.
      if (isSilverGoStudent(student)) {
        await SilverGoUnlockCache.deleteOne({ studentId });
      }

      const [goBatchCfg, unlock] = await Promise.all([
        BatchConfig.findOne({ batchName: GO_BATCH_NAME }).select('journeyLength').lean(),
        isSilverGoStudent(student)
          ? resolveSilverGoContentUnlock(student)
          : Promise.resolve({
              maxUnlockedContentDay: storedCourseDay,
              currentCourseDay: storedCourseDay
            })
      ]);

      const journeyLength =
        goBatchCfg?.journeyLength >= 1 ? Math.min(Math.floor(goBatchCfg.journeyLength), 200) : 200;
      const accessDay = unlock.maxUnlockedContentDay || storedCourseDay;

      // Reconcile: if the student is stored ahead of what they've completed, pull them back.
      let reconciled = false;
      if (isSilverGoStudent(student) && accessDay < storedCourseDay) {
        const updateResult = await User.updateOne(
          { _id: studentId, role: 'STUDENT', currentCourseDay: storedCourseDay },
          {
            $set: withJourneyLevelInSet(
              accessDay,
              {
                currentCourseDay: accessDay,
                pendingJourneyDayAdvance: false,
                pendingJourneyDayAdvanceForDay: null
              },
              { student }
            )
          }
        );
        reconciled = updateResult.modifiedCount > 0;
      }

      const batchOrForMeetings = batchKeys.map((k) => ({
        batch: new RegExp(`^${String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      }));
      const studentObjectId = mongoose.Types.ObjectId.isValid(String(studentId))
        ? new mongoose.Types.ObjectId(String(studentId))
        : null;

      const [classRecordings, recViewsAgg, goMeetings, meetingsForDuration, allExercises, attempts] =
        await Promise.all([
        batchRecOr.length
          ? ClassRecording.find({
              active: true,
              isPublished: { $ne: false },
              level: studentLevel,
              plan: { $in: ['ALL', 'SILVER', 'PLATINUM'] },
              $or: batchRecOr
            })
              .select('title courseDay plan level duration batches createdAt')
              .lean()
          : Promise.resolve([]),
        studentObjectId
          ? RecordingView.aggregate([
              { $match: { student: studentObjectId } },
              {
                $group: {
                  _id: '$recording',
                  maxWatchDuration: { $sum: '$watchDuration' },
                  lastUpdatedAt: { $max: '$lastUpdatedAt' }
                }
              }
            ])
          : Promise.resolve([]),
        batchOrForMeetings.length
          ? MeetingLink.find({
              $or: batchOrForMeetings,
              status: { $ne: 'cancelled' }
            })
              .select('topic startTime duration courseDay status')
              .lean()
          : Promise.resolve([]),
        batchOrForMeetings.length
          ? MeetingLink.find({ $or: batchOrForMeetings, status: { $ne: 'cancelled' } })
              .select('batch courseDay duration')
              .lean()
          : Promise.resolve([]),
        DigitalExercise.find({
          isDeleted: { $ne: true },
          isActive: true,
          visibleToStudents: true,
          courseDay: { $gte: 1, $lte: journeyLength }
        })
          .select('title level category courseDay sequenceLetter')
          .lean(),
        ExerciseAttempt.find({ studentId })
          .select('exerciseId status scorePercentage earnedPoints totalPoints completedAt')
          .lean()
      ]);

      const recViewMap = {};
      for (const row of recViewsAgg) {
        recViewMap[String(row._id)] = {
          watchDuration: Math.max(0, Math.round(Number(row.maxWatchDuration || 0))),
          lastUpdatedAt: row.lastUpdatedAt || null
        };
      }

      const resolveManualDurationSec = (recording) => {
        let durationSec = Number.isFinite(Number(recording.duration))
          ? Number(recording.duration)
          : 0;
        if (durationSec > 0) return durationSec;
        const recDay = Number(recording?.courseDay);
        const recBatches = Array.isArray(recording?.batches) ? recording.batches : [];
        if (!Number.isFinite(recDay) || recDay < 1 || !recBatches.length) return 0;
        const match = meetingsForDuration.find(
          (m) =>
            Number(m?.courseDay) === recDay &&
            Number(m?.duration) > 0 &&
            recBatches.some((rb) => batchesAlign(rb, m?.batch))
        );
        return match && Number(match.duration) > 0
          ? Math.round(Number(match.duration) * 60)
          : 0;
      };

      const recordings = classRecordings.map(r => {
        const locked = r.courseDay != null && r.courseDay > accessDay;
        const viewData = recViewMap[String(r._id)];
        const durationSec = resolveManualDurationSec(r);
        const rawWatchSec = viewData?.watchDuration || 0;
        const watchSec =
          durationSec > 0 ? Math.min(rawWatchSec, durationSec) : rawWatchSec;
        const watched = recordingWatchCountsAsComplete(watchSec, durationSec);
        return {
          _id: r._id,
          title: r.title,
          courseDay: r.courseDay,
          plan: r.plan,
          level: r.level,
          locked,
          watchDuration: watchSec,
          lastWatchedAt: viewData?.lastUpdatedAt || null,
          watched,
          uploadedAt: r.createdAt
        };
      });
  
      const meetingIds = goMeetings.map((m) => m._id);
      const zoomRecs =
        meetingIds.length > 0
          ? await ZoomRecording.find({ meetingLinkId: { $in: meetingIds }, isPublished: true })
              .select('meetingLinkId duration status')
              .lean()
          : [];

      const zoomViewMap = {};
      if (meetingIds.length > 0 && studentObjectId) {
        const zoomViewsAgg = await ZoomRecordingView.aggregate([
          {
            $match: {
              student: studentObjectId,
              meetingLinkId: { $in: meetingIds }
            }
          },
          {
            $group: {
              _id: '$meetingLinkId',
              maxWatchDuration: { $sum: '$watchDuration' },
              lastUpdatedAt: { $max: '$lastUpdatedAt' }
            }
          }
        ]);
        for (const row of zoomViewsAgg) {
          zoomViewMap[String(row._id)] = {
            watchDuration: Math.max(0, Math.round(Number(row.maxWatchDuration || 0))),
            lastUpdatedAt: row.lastUpdatedAt || null
          };
        }
      }
  
      const zoomRecordings = zoomRecs.map(zr => {
        const meeting = goMeetings.find(m => String(m._id) === String(zr.meetingLinkId));
        const locked = meeting?.courseDay != null && meeting.courseDay > accessDay;
        const viewData = zoomViewMap[String(zr.meetingLinkId)];
        const durationSec =
          Number(zr.duration) > 0
            ? Number(zr.duration)
            : meeting?.duration != null && Number(meeting.duration) > 0
              ? Math.round(Number(meeting.duration) * 60)
              : 0;
        const rawWatchSec = viewData?.watchDuration || 0;
        const watchSec =
          durationSec > 0 ? Math.min(rawWatchSec, durationSec) : rawWatchSec;
        const watched = recordingWatchCountsAsComplete(watchSec, durationSec);
        return {
          _id: zr._id,
          meetingLinkId: zr.meetingLinkId,
          topic: meeting?.topic || 'Class Recording',
          courseDay: meeting?.courseDay || null,
          startTime: meeting?.startTime || null,
          duration: zr.duration,
          locked,
          watchDuration: watchSec,
          lastWatchedAt: viewData?.lastUpdatedAt || null,
          watched
        };
      });
  
      const attemptMap = {};
      for (const a of attempts) {
        const key = String(a.exerciseId);
        if (!attemptMap[key] || (a.completedAt > (attemptMap[key].completedAt || 0))) {
          attemptMap[key] = a;
        }
      }
  
      const exercises = allExercises.map(e => {
        const locked = e.courseDay > accessDay;
        const attempt = attemptMap[String(e._id)];
        return {
          _id: e._id,
          title: e.title,
          level: e.level,
          category: e.category,
          courseDay: e.courseDay,
          sequenceLetter: e.sequenceLetter,
          locked,
          attempted: !!attempt,
          status: attempt?.status || 'not_attempted',
          scorePercent: attempt?.scorePercentage || 0,
          earnedPoints: attempt?.earnedPoints || 0,
          totalPoints: attempt?.totalPoints || 0,
          completedAt: attempt?.completedAt || null
        };
      });
  
      const totalExercises = exercises.length;
      const attemptedExercises = exercises.filter((e) => e.attempted).length;

      // ── Glück Buddy (DG Bot) modules ─────────────────────────────────────────
      let dgModules = [];
      try {
        const [dgAccess, allDg, dgCompletedIds, dgAnyIds] = await Promise.all([
          getStudentDgJourneyAccess(studentId),
          DGModule.find({ isActive: true, visibleToStudents: true })
            .select('title level courseDay')
            .sort({ courseDay: 1, title: 1 })
            .lean(),
          DGSession.distinct('moduleId', { studentId, completed: true }),
          DGSession.distinct('moduleId', { studentId })
        ]);

        const dgCompletedSet = new Set((dgCompletedIds || []).map((id) => String(id)));
        const dgAnySet = new Set((dgAnyIds || []).map((id) => String(id)));

        dgModules = (allDg || []).map((m) => {
          const dayLocked =
            !dgAccess.enabled ||
            dgAccess.dgBotEnabled === false ||
            !dgModuleUnlockedForAccess(dgAccess, m.courseDay);
          const completed = dgCompletedSet.has(String(m._id));
          const started = dgAnySet.has(String(m._id));
          let status = 'not_started';
          if (completed) status = 'completed';
          else if (started) status = 'in_progress';
          return {
            _id: m._id,
            title: m.title,
            level: m.level,
            courseDay: m.courseDay ?? null,
            locked: dayLocked,
            status,
          };
        });
      } catch (dgErr) {
        console.warn('go-students detail: DG module summary skipped', dgErr?.message || dgErr);
      }
  
      const completedDgModules = dgModules.filter((d) => d.status === 'completed').length;
      const totalDgModules = dgModules.length;

      // ── GlückArena (journey-day games) ───────────────────────────────────────
      let arenaGames = [];
      try {
        const arenaBatchKeys = studentTargetBatchKeys(student);
        const arenaFilter = {
          isDeleted: { $ne: true },
          isPublished: true,
          visibleToStudents: true,
          targetLanguage: 'German',
          courseDay: { $ne: null, $gte: 1, $lte: 200 },
          ...moduleTargetingQuery(arenaBatchKeys),
        };
        const arenaSets = await GameSet.find(arenaFilter)
          .select('title level category courseDay sequenceLetter gameType difficulty')
          .sort({ courseDay: 1, sequenceLetter: 1, title: 1 })
          .lean();
        const arenaIds = arenaSets.map((g) => g._id);
        const playedArenaIds =
          arenaIds.length > 0
            ? await GameAttempt.find({
                studentId,
                gameSetId: { $in: arenaIds },
                status: 'completed',
              }).distinct('gameSetId')
            : [];
        const playedArenaSet = new Set((playedArenaIds || []).map((id) => String(id)));
        arenaGames = arenaSets.map((g) => ({
          _id: g._id,
          title: g.title,
          level: g.level,
          category: g.category,
          courseDay: g.courseDay,
          sequenceLetter: g.sequenceLetter,
          gameType: g.gameType,
          difficulty: g.difficulty,
          locked: Number(g.courseDay) > accessDay,
          played: playedArenaSet.has(String(g._id)),
        }));
      } catch (arenaErr) {
        console.warn('go-students detail: arena games skipped', arenaErr?.message || arenaErr);
      }
  
      res.json({
        journeyLength,
        journeySync: {
          effectiveAccessDay: accessDay,
          storedCourseDayBeforeSync: storedCourseDay,
          reconciled,
          needsSync: storedCourseDay > accessDay,
          sequentialUnlock: isSilverGoStudent(student)
        },
        student: {
          _id: student._id,
          name: student.name,
          regNo: student.regNo,
          email: student.email,
          level: student.level,
          subscription: student.subscription,
          goStatus: student.goStatus,
          goJoiningDate: student.goJoiningDate,
          currentDay: accessDay,
          storedCourseDay: student.currentCourseDay || 1
        },
        recordings,
        zoomRecordings,
        exercises,
        dgModules,
        arenaGames,
        progress: {
          currentDay: accessDay,
          totalExercises,
          attemptedExercises,
          totalDgModules,
          completedDgModules
        }
      });
    } catch (err) {
      console.error('go-students GET /:id/detail', err);
      res.status(500).json({ message: 'Failed to fetch GO student detail.', error: err.message });
    }
  });

  return router;
}

module.exports = createGoStudentsRouter;
