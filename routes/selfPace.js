// routes/selfPace.js — Self Pace admin + config API

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireRecordingApprovalStaff } = require('../middleware/recordingStaffAccess');
const SelfPaceConfig = require('../models/SelfPaceConfig');
const SelfPaceJourney = require('../models/SelfPaceJourney');
const SelfPaceJourneyDay = require('../models/SelfPaceJourneyDay');
const {
  CONFIG_KEY,
  getAdminProgram,
  listRecordingsForPicker,
} = require('../services/selfPace.service');

// GET /api/self-pace/program — full config + journeys + days
router.get(
  '/program',
  verifyToken,
  requireRecordingApprovalStaff('view'),
  async (req, res) => {
    try {
      const program = await getAdminProgram();
      return res.json({ success: true, ...program });
    } catch (err) {
      console.error('[SelfPace] GET /program', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// PUT /api/self-pace/config/batches — save activated batches
router.put(
  '/config/batches',
  verifyToken,
  requireRecordingApprovalStaff('edit'),
  async (req, res) => {
    try {
      const { activatedBatches } = req.body;
      if (!Array.isArray(activatedBatches)) {
        return res.status(400).json({ success: false, message: 'activatedBatches must be an array.' });
      }
      const cleaned = [...new Set(activatedBatches.map((b) => String(b || '').trim()).filter(Boolean))];

      const config = await SelfPaceConfig.findOneAndUpdate(
        { key: CONFIG_KEY },
        {
          $set: {
            key: CONFIG_KEY,
            activatedBatches: cleaned,
            updatedBy: req.user.id,
          },
        },
        { upsert: true, new: true }
      ).lean();

      return res.json({ success: true, config });
    } catch (err) {
      console.error('[SelfPace] PUT /config/batches', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// POST /api/self-pace/journeys
router.post(
  '/journeys',
  verifyToken,
  requireRecordingApprovalStaff('edit'),
  async (req, res) => {
    try {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ success: false, message: 'Journey name is required.' });

      const count = await SelfPaceJourney.countDocuments();
      const journey = await SelfPaceJourney.create({
        name,
        sortOrder: Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : count,
        active: req.body.active !== false,
        createdBy: req.user.id,
      });

      return res.status(201).json({ success: true, journey });
    } catch (err) {
      console.error('[SelfPace] POST /journeys', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// PUT /api/self-pace/journeys/:id
router.put(
  '/journeys/:id',
  verifyToken,
  requireRecordingApprovalStaff('edit'),
  async (req, res) => {
    try {
      const updates = {};
      if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
      if (req.body.sortOrder !== undefined) updates.sortOrder = Number(req.body.sortOrder);
      if (req.body.active !== undefined) updates.active = Boolean(req.body.active);

      const journey = await SelfPaceJourney.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
      if (!journey) return res.status(404).json({ success: false, message: 'Journey not found.' });
      return res.json({ success: true, journey });
    } catch (err) {
      console.error('[SelfPace] PUT /journeys/:id', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// DELETE /api/self-pace/journeys/:id
router.delete(
  '/journeys/:id',
  verifyToken,
  requireRecordingApprovalStaff('edit'),
  async (req, res) => {
    try {
      await SelfPaceJourneyDay.deleteMany({ journeyId: req.params.id });
      const journey = await SelfPaceJourney.findByIdAndDelete(req.params.id);
      if (!journey) return res.status(404).json({ success: false, message: 'Journey not found.' });
      return res.json({ success: true, message: 'Journey deleted.' });
    } catch (err) {
      console.error('[SelfPace] DELETE /journeys/:id', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// POST /api/self-pace/journeys/:journeyId/days — add day slot (courseDay)
router.post(
  '/journeys/:journeyId/days',
  verifyToken,
  requireRecordingApprovalStaff('edit'),
  async (req, res) => {
    try {
      const journey = await SelfPaceJourney.findById(req.params.journeyId);
      if (!journey) return res.status(404).json({ success: false, message: 'Journey not found.' });

      const courseDay = parseInt(req.body.courseDay, 10);
      if (!Number.isFinite(courseDay) || courseDay < 1 || courseDay > 200) {
        return res.status(400).json({ success: false, message: 'courseDay must be between 1 and 200.' });
      }

      const existing = await SelfPaceJourneyDay.findOne({
        journeyId: journey._id,
        courseDay,
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Day ${courseDay} already exists in this journey.`,
        });
      }

      const count = await SelfPaceJourneyDay.countDocuments({ journeyId: journey._id });
      const day = await SelfPaceJourneyDay.create({
        journeyId: journey._id,
        courseDay,
        recordingType: 'manual',
        sortOrder: count,
        active: true,
      });

      return res.status(201).json({ success: true, day });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'This day already exists in the journey.' });
      }
      console.error('[SelfPace] POST /journeys/:id/days', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// PUT /api/self-pace/days/:dayId/map — map a recording to a day slot
router.put(
  '/days/:dayId/map',
  verifyToken,
  requireRecordingApprovalStaff('edit'),
  async (req, res) => {
    try {
      const { recordingType, recordingId } = req.body;
      const type = String(recordingType || '').toLowerCase();
      if (type !== 'manual' && type !== 'zoom') {
        return res.status(400).json({ success: false, message: 'recordingType must be manual or zoom.' });
      }
      if (!recordingId) {
        return res.status(400).json({ success: false, message: 'recordingId is required.' });
      }

      const updates = {
        recordingType: type,
        classRecordingId: type === 'manual' ? recordingId : null,
        meetingLinkId: type === 'zoom' ? recordingId : null,
      };

      const day = await SelfPaceJourneyDay.findByIdAndUpdate(
        req.params.dayId,
        { $set: updates },
        { new: true }
      );
      if (!day) return res.status(404).json({ success: false, message: 'Day slot not found.' });

      return res.json({ success: true, day });
    } catch (err) {
      console.error('[SelfPace] PUT /days/:id/map', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// DELETE /api/self-pace/days/:dayId
router.delete(
  '/days/:dayId',
  verifyToken,
  requireRecordingApprovalStaff('edit'),
  async (req, res) => {
    try {
      const day = await SelfPaceJourneyDay.findByIdAndDelete(req.params.dayId);
      if (!day) return res.status(404).json({ success: false, message: 'Day slot not found.' });
      return res.json({ success: true, message: 'Day removed.' });
    } catch (err) {
      console.error('[SelfPace] DELETE /days/:id', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// GET /api/self-pace/recordings-picker?search=
router.get(
  '/recordings-picker',
  verifyToken,
  requireRecordingApprovalStaff('view'),
  async (req, res) => {
    try {
      const items = await listRecordingsForPicker({ search: req.query.search });
      return res.json({ success: true, items });
    } catch (err) {
      console.error('[SelfPace] GET /recordings-picker', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

module.exports = router;
