const express = require('express');
const router = express.Router();
const VisaTracking = require('../models/VisaTracking');
const User = require('../models/User');
const { verifyToken, checkRole } = require('../middleware/auth');

// Portal visa stages with date labels for specific stages
const PORTAL_STAGES = [
  { stage: 1, label: 'Application Filed', desc: 'Portal submission completed', dateLabel: 'Portal Submission Date' },
  { stage: 2, label: 'Preliminary Review', desc: 'Submitted & under preliminary review', dateLabel: '' },
  { stage: 3, label: 'Embassy Review', desc: 'With embassy/consulate – under review', dateLabel: 'Embassy Submission Date' },
  { stage: 4, label: 'Embassy Feedback', desc: 'Embassy feedback: changes or pre-approved', dateLabel: '' },
  { stage: 5, label: 'Changes / Appointment', desc: 'Working on changes or appointment booking', dateLabel: 'Appointment Date' },
  { stage: 6, label: 'Final Submission & Decision', desc: 'Interview, biometrics & visa decision', dateLabel: 'Decision Date' }
];

const AU_PAIR_STAGES = [
  { stage: 1, label: 'Appointment Booking', desc: 'Embassy appointment booking', dateLabel: 'Appointment Date' },
  { stage: 2, label: 'Document Preparation', desc: 'Collecting & organising documents', dateLabel: '' },
  { stage: 3, label: 'Interview Preparation', desc: 'Mock interviews & training', dateLabel: '' },
  { stage: 4, label: 'Embassy Visit', desc: 'Embassy/VFS submission & interview', dateLabel: 'Embassy Visit Date' },
  { stage: 5, label: 'Result & Next Steps', desc: 'Waiting for decision & next steps', dateLabel: 'Decision Date' }
];

// Helper: compute currentStage from stages array
function computeCurrentStage(stages) {
  if (!stages || !stages.length) return 1;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].outcome !== 'completed') return i + 1;
  }
  return stages.length; // all completed — stay on last
}

// GET /api/visa-tracking/stages
router.get('/stages', verifyToken, (req, res) => {
  res.json({ portal: PORTAL_STAGES, auPair: AU_PAIR_STAGES });
});

// GET /api/visa-tracking/all
router.get('/all', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const records = await VisaTracking.find()
      .populate('studentId', 'name email regNo batch level')
      .populate('updatedBy', 'name')
      .populate('history.updatedBy', 'name')
      .sort({ updatedAt: -1 })
      .lean();
    // Attach computed currentStage
    records.forEach(r => { r.currentStage = computeCurrentStage(r.stages); });
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/visa-tracking/student/:studentId
router.get('/student/:studentId', verifyToken, async (req, res) => {
  try {
    const record = await VisaTracking.findOne({ studentId: req.params.studentId })
      .populate('studentId', 'name email regNo')
      .populate('history.updatedBy', 'name')
      .lean();
    if (!record) return res.json({ success: true, data: null });
    record.currentStage = computeCurrentStage(record.stages);
    record.stageDefinitions = record.visaType === 'AU_PAIR' ? AU_PAIR_STAGES : PORTAL_STAGES;
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/visa-tracking
router.post('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { studentId, visaType, stages: incomingStages } = req.body;
    const existing = await VisaTracking.findOne({ studentId });
    if (existing) return res.status(400).json({ success: false, message: 'Visa record already exists for this student.' });

    const defs = (visaType || 'PORTAL') === 'AU_PAIR' ? AU_PAIR_STAGES : PORTAL_STAGES;
    const stagesArr = defs.map(d => {
      const incoming = (incomingStages || []).find(s => s.stage === d.stage);
      return {
        stage: d.stage,
        status: incoming?.status || '',
        message: incoming?.message || '',
        actionRequired: incoming?.actionRequired || false,
        actionNote: incoming?.actionNote || '',
        handledBy: incoming?.handledBy || '',
        outcome: incoming?.outcome || '',
        outcomeDate: incoming?.outcome ? new Date() : null,
        stageDate: incoming?.stageDate || null,
        stageDateLabel: d.dateLabel || ''
      };
    });

    const historyNotes = ['Visa tracking initiated'];
    if (incomingStages) {
      incomingStages.forEach(s => {
        if (s.outcome) historyNotes.push('Stage ' + s.stage + ' outcome: ' + s.outcome);
        if (s.message) historyNotes.push('Stage ' + s.stage + ' message set');
      });
    }

    const record = new VisaTracking({
      studentId,
      visaType: visaType || 'PORTAL',
      stages: stagesArr,
      history: [{ stage: computeCurrentStage(stagesArr), note: historyNotes.join(' | '), updatedBy: req.user.id }],
      updatedBy: req.user.id
    });
    await record.save();
    const populated = await VisaTracking.findById(record._id)
      .populate('studentId', 'name email regNo batch level')
      .populate('updatedBy', 'name')
      .populate('history.updatedBy', 'name')
      .lean();
    populated.currentStage = computeCurrentStage(populated.stages);
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/visa-tracking/:id
router.put('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const record = await VisaTracking.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

    const { stages, finalOutcome, finalOutcomeNote, adminNotes } = req.body;

    const stageNames = record.visaType === 'AU_PAIR'
      ? ['', 'Appointment Booking', 'Document Preparation', 'Interview Preparation', 'Embassy Visit', 'Result & Next Steps']
      : ['', 'Application Filed', 'Preliminary Review', 'Embassy Review', 'Embassy Feedback', 'Changes / Appointment', 'Final Submission & Decision'];

    const historyNotes = [];

    if (stages && Array.isArray(stages)) {
      // If record has no stages yet (old schema), initialize them
      if (!record.stages || record.stages.length === 0) {
        record.stages = stages.map(s => ({
          stage: s.stage, status: s.status || '', message: s.message || '',
          actionRequired: s.actionRequired || false, actionNote: s.actionNote || '',
          handledBy: s.handledBy || '', outcome: s.outcome || '',
          outcomeDate: s.outcome === 'completed' ? new Date() : null,
          stageDate: s.stageDate || null, stageDateLabel: s.stageDateLabel || ''
        }));
        historyNotes.push('Stages initialized');
      } else {
        stages.forEach(incoming => {
          const existing = record.stages.find(s => s.stage === incoming.stage);
          if (!existing) return;

          // Track outcome changes
          if (incoming.outcome && incoming.outcome !== existing.outcome) {
            historyNotes.push('Stage ' + incoming.stage + ' (' + (stageNames[incoming.stage] || '') + ') outcome → ' + incoming.outcome);
            existing.outcomeDate = new Date();
          }
          if (incoming.message && incoming.message !== existing.message) {
            historyNotes.push('Stage ' + incoming.stage + ' message updated');
          }

          if (incoming.status !== undefined) existing.status = incoming.status;
          if (incoming.message !== undefined) existing.message = incoming.message;
          if (incoming.actionRequired !== undefined) existing.actionRequired = incoming.actionRequired;
          if (incoming.actionNote !== undefined) existing.actionNote = incoming.actionNote;
          if (incoming.handledBy !== undefined) existing.handledBy = incoming.handledBy;
          if (incoming.outcome !== undefined) existing.outcome = incoming.outcome;
          if (incoming.stageDate !== undefined) existing.stageDate = incoming.stageDate || null;
          if (incoming.stageDateLabel !== undefined) existing.stageDateLabel = incoming.stageDateLabel;
          existing.updatedAt = new Date();
        });
      }
    }

    if (finalOutcome !== undefined && finalOutcome !== record.finalOutcome && finalOutcome) {
      historyNotes.push('Final outcome → ' + finalOutcome);
    }

    const computedStage = computeCurrentStage(stages || record.stages);

    if (historyNotes.length) {
      record.history.push({ stage: computedStage, note: historyNotes.join(' | '), updatedBy: req.user.id });
    }

    if (finalOutcome !== undefined) record.finalOutcome = finalOutcome;
    if (finalOutcomeNote !== undefined) record.finalOutcomeNote = finalOutcomeNote;
    if (adminNotes !== undefined) record.adminNotes = adminNotes;
    record.updatedBy = req.user.id;
    record.updatedAt = new Date();

    await record.save();
    const populated = await VisaTracking.findById(record._id)
      .populate('studentId', 'name email regNo batch level')
      .populate('updatedBy', 'name')
      .populate('history.updatedBy', 'name')
      .lean();
    populated.currentStage = computeCurrentStage(populated.stages);
    res.json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/visa-tracking/:id
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    await VisaTracking.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
