// routes/journeyCrossBatchRecordingAccess.js
// Self pace journey admin APIs.

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireRecordingApprovalStaff } = require('../middleware/recordingStaffAccess');
const JourneyCrossBatchRecordingRule = require('../models/JourneyCrossBatchRecordingRule');
const SelfPaceBatchActivation = require('../models/SelfPaceBatchActivation');
const ClassRecording = require('../models/ClassRecording');
const MeetingLink = require('../models/MeetingLink');
const ZoomRecording = require('../models/ZoomRecording');
const { previewRule } = require('../services/journeyCrossBatchRecordingAccess.service');

function normalizeBatchList(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const t = String(v || '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

async function getActivationDoc() {
  const doc = await SelfPaceBatchActivation.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default', activeBatches: [] } },
    { new: true, upsert: true }
  ).lean();
  return doc;
}

// ─── Active batches ───────────────────────────────────────────────────────────
router.get('/active-batches', verifyToken, requireRecordingApprovalStaff('view'), async (req, res) => {
  try {
    const doc = await getActivationDoc();
    return res.json({ success: true, activeBatches: doc.activeBatches || [] });
  } catch (err) {
    console.error('[SelfPace] GET /active-batches error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/active-batches', verifyToken, requireRecordingApprovalStaff('edit'), async (req, res) => {
  try {
    const activeBatches = normalizeBatchList(req.body?.activeBatches || []);
    const doc = await SelfPaceBatchActivation.findOneAndUpdate(
      { key: 'default' },
      {
        $set: {
          activeBatches,
          updatedBy: req.user.id,
        },
      },
      { upsert: true, new: true }
    ).lean();
    return res.json({ success: true, activeBatches: doc.activeBatches || [] });
  } catch (err) {
    console.error('[SelfPace] PUT /active-batches error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /journeys (and legacy /rules) ───────────────────────────────────────
router.get(
  '/journeys',
  verifyToken,
  requireRecordingApprovalStaff('view'),
  async (req, res) => {
    try {
      const filter = {};
      if (req.query.active !== undefined) {
        filter.active = req.query.active === 'true';
      }
      if (req.query.courseDay) {
        const cd = parseInt(req.query.courseDay, 10);
        if (Number.isFinite(cd)) filter.courseDay = cd;
      }
      const journeys = await JourneyCrossBatchRecordingRule.find(filter)
        .populate('createdBy', 'name email')
        .sort({ courseDay: 1, studentBatch: 1 })
        .lean();
      return res.json({ success: true, journeys });
    } catch (err) {
      console.error('[SelfPace] GET /journeys error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─── POST /journeys (and legacy /rules) ──────────────────────────────────────
router.post(
  '/journeys',
  verifyToken,
  requireRecordingApprovalStaff('edit'),
  async (req, res) => {
    try {
      const { courseDay, targetBatches, notes, journeyTitle } = req.body;
      if (!courseDay) {
        return res.status(400).json({ success: false, message: 'courseDay is required.' });
      }
      const cd = parseInt(courseDay, 10);
      if (!Number.isFinite(cd) || cd < 1 || cd > 200) {
        return res.status(400).json({ success: false, message: 'courseDay must be between 1 and 200.' });
      }
      const normalizedTargets = normalizeBatchList(targetBatches || []);

      const rule = await JourneyCrossBatchRecordingRule.create({
        courseDay: cd,
        targetBatches: normalizedTargets,
        notes: String(notes || '').trim(),
        journeyTitle: String(journeyTitle || '').trim(),
        mappedManualRecordingIds: [],
        mappedZoomMeetingLinkIds: [],
        active: true,
        createdBy: req.user.id,
      });

      return res.status(201).json({ success: true, journey: rule });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'Duplicate active journey rule.' });
      }
      console.error('[SelfPace] POST /journeys error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─── PUT /journeys/:id (and legacy /rules/:id) ───────────────────────────────
router.put(
  '/journeys/:id',
  verifyToken,
  requireRecordingApprovalStaff('edit'),
  async (req, res) => {
    try {
      const { courseDay, active, notes, targetBatches, journeyTitle } = req.body;
      const updates = {};

      if (targetBatches !== undefined) updates.targetBatches = normalizeBatchList(targetBatches);
      if (notes !== undefined) updates.notes = String(notes).trim();
      if (journeyTitle !== undefined) updates.journeyTitle = String(journeyTitle).trim();
      if (active !== undefined) updates.active = Boolean(active);
      if (courseDay !== undefined) {
        const cd = parseInt(courseDay, 10);
        if (!Number.isFinite(cd) || cd < 1 || cd > 200) {
          return res.status(400).json({ success: false, message: 'courseDay must be between 1 and 200.' });
        }
        updates.courseDay = cd;
      }

      const rule = await JourneyCrossBatchRecordingRule.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true, runValidators: true }
      ).populate('createdBy', 'name email');

      if (!rule) return res.status(404).json({ success: false, message: 'Journey not found.' });
      return res.json({ success: true, journey: rule });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'Duplicate active journey rule.' });
      }
      console.error('[SelfPace] PUT /journeys/:id error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─── DELETE /journeys/:id (and legacy /rules/:id) ────────────────────────────
router.delete(
  '/journeys/:id',
  verifyToken,
  requireRecordingApprovalStaff('edit'),
  async (req, res) => {
    try {
      const rule = await JourneyCrossBatchRecordingRule.findByIdAndDelete(req.params.id);
      if (!rule) return res.status(404).json({ success: false, message: 'Journey not found.' });
      return res.json({ success: true, message: 'Journey deleted.' });
    } catch (err) {
      console.error('[SelfPace] DELETE /journeys/:id error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─── Map/unmap recordings to journey ──────────────────────────────────────────
router.post('/journeys/:id/map-recording', verifyToken, requireRecordingApprovalStaff('edit'), async (req, res) => {
  try {
    const { recordingType, recordingId } = req.body || {};
    if (!recordingType || !recordingId) {
      return res.status(400).json({ success: false, message: 'recordingType and recordingId are required.' });
    }
    const journey = await JourneyCrossBatchRecordingRule.findById(req.params.id);
    if (!journey) return res.status(404).json({ success: false, message: 'Journey not found.' });

    const rt = String(recordingType).toLowerCase();
    if (rt === 'manual') {
      const exists = await ClassRecording.exists({ _id: recordingId });
      if (!exists) return res.status(404).json({ success: false, message: 'Manual recording not found.' });
      if (!journey.mappedManualRecordingIds.some((id) => String(id) === String(recordingId))) {
        journey.mappedManualRecordingIds.push(recordingId);
      }
    } else if (rt === 'zoom') {
      const exists = await MeetingLink.exists({ _id: recordingId });
      if (!exists) return res.status(404).json({ success: false, message: 'Zoom class not found.' });
      if (!journey.mappedZoomMeetingLinkIds.some((id) => String(id) === String(recordingId))) {
        journey.mappedZoomMeetingLinkIds.push(recordingId);
      }
    } else {
      return res.status(400).json({ success: false, message: 'recordingType must be manual or zoom.' });
    }
    await journey.save();
    return res.json({ success: true, journey });
  } catch (err) {
    console.error('[SelfPace] POST /journeys/:id/map-recording error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/journeys/:id/map-recording', verifyToken, requireRecordingApprovalStaff('edit'), async (req, res) => {
  try {
    const { recordingType, recordingId } = req.body || {};
    if (!recordingType || !recordingId) {
      return res.status(400).json({ success: false, message: 'recordingType and recordingId are required.' });
    }
    const journey = await JourneyCrossBatchRecordingRule.findById(req.params.id);
    if (!journey) return res.status(404).json({ success: false, message: 'Journey not found.' });
    const rt = String(recordingType).toLowerCase();
    if (rt === 'manual') {
      journey.mappedManualRecordingIds = (journey.mappedManualRecordingIds || []).filter((id) => String(id) !== String(recordingId));
    } else if (rt === 'zoom') {
      journey.mappedZoomMeetingLinkIds = (journey.mappedZoomMeetingLinkIds || []).filter((id) => String(id) !== String(recordingId));
    } else {
      return res.status(400).json({ success: false, message: 'recordingType must be manual or zoom.' });
    }
    await journey.save();
    return res.json({ success: true, journey });
  } catch (err) {
    console.error('[SelfPace] DELETE /journeys/:id/map-recording error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Recordings catalog for mapper modal ─────────────────────────────────────
router.get('/recordings-catalog', verifyToken, requireRecordingApprovalStaff('view'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const manual = await ClassRecording.find({ active: true })
      .select('_id title courseDay isPublished status')
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();
    const zoomRows = await ZoomRecording.find({ status: 'ready' })
      .select('meetingLinkId isPublished status createdAt')
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();
    const meetings = await MeetingLink.find({ _id: { $in: zoomRows.map((z) => z.meetingLinkId) } })
      .select('_id topic courseDay startTime')
      .lean();
    const meetingMap = new Map(meetings.map((m) => [String(m._id), m]));

    const manualRows = manual.map((m) => ({
      id: String(m._id),
      type: 'manual',
      title: m.title || 'Manual recording',
      courseDay: m.courseDay || null,
      isPublished: m.isPublished !== false,
      status: m.status || 'ready',
    }));
    const zoomList = zoomRows.map((z) => {
      const m = meetingMap.get(String(z.meetingLinkId));
      return {
        id: String(z.meetingLinkId),
        type: 'zoom',
        title: m?.topic || 'Zoom recording',
        courseDay: m?.courseDay || null,
        isPublished: z.isPublished !== false,
        status: z.status || 'ready',
      };
    });
    let rows = [...manualRows, ...zoomList];
    if (q) {
      rows = rows.filter((r) =>
        String(r.title || '').toLowerCase().includes(q) ||
        String(r.courseDay || '').includes(q)
      );
    }
    return res.json({ success: true, recordings: rows.slice(0, 400) });
  } catch (err) {
    console.error('[SelfPace] GET /recordings-catalog error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /journeys/:id/preview (and legacy /rules/:id/preview) ──────────────
router.get(
  '/journeys/:id/preview',
  verifyToken,
  requireRecordingApprovalStaff('view'),
  async (req, res) => {
    try {
      const rule = await JourneyCrossBatchRecordingRule.findById(req.params.id).lean();
      if (!rule) return res.status(404).json({ success: false, message: 'Journey not found.' });

      const preview = await previewRule(rule);
      return res.json({ success: true, ...preview });
    } catch (err) {
      console.error('[SelfPace] GET /journeys/:id/preview error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

module.exports = router;
