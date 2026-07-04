const express = require('express');
const ADMIN_DOC_ROLES = ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'];
const router = express.Router();
const UniversityApplication = require('../models/UniversityApplication');
const { verifyToken, checkRole } = require('../middleware/auth');

const APPLICATION_STAGES = [
  { stage: 1, label: 'Applied', desc: 'Application submitted to university' },
  { stage: 2, label: 'In Review', desc: 'University reviewing documents' },
  { stage: 3, label: 'Approved', desc: 'Admission approved or conditional offer' },
  { stage: 4, label: 'Offer Letter Sent', desc: 'Formal offer letter issued' },
  { stage: 5, label: 'Enrolled', desc: 'Student confirmed enrollment' }
];

function computeCurrentStage(stages) {
  if (!stages || !stages.length) return 1;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].status !== 'completed') return i + 1;
  }
  return stages.length;
}

function buildDefaultStages() {
  return APPLICATION_STAGES.map(d => ({
    stage: d.stage,
    status: 'pending',
    message: '',
    stageDate: null,
    updatedAt: null
  }));
}

function stripAdminFields(record) {
  if (!record) return record;
  const obj = typeof record.toObject === 'function' ? record.toObject() : { ...record };
  delete obj.adminNotes;
  return obj;
}

function attachComputedFields(record) {
  if (!record) return record;
  record.currentStage = computeCurrentStage(record.stages);
  record.stageDefinitions = APPLICATION_STAGES;
  return record;
}

async function populateRecord(query) {
  return query
    .populate('studentId', 'name email regNo batch level')
    .populate('updatedBy', 'name')
    .populate('history.updatedBy', 'name')
    .lean();
}

// GET /api/university-applications/stages
router.get('/stages', verifyToken, (req, res) => {
  res.json({ success: true, data: APPLICATION_STAGES });
});

// GET /api/university-applications/admin/all
router.get('/admin/all', verifyToken, checkRole(ADMIN_DOC_ROLES), async (req, res) => {
  try {
    const records = await UniversityApplication.aggregate([
      { $sort: { updatedAt: -1 } },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1, email: 1, regNo: 1, batch: 1, level: 1 } }],
          as: 'studentId'
        }
      },
      { $unwind: { path: '$studentId', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'updatedBy',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1 } }],
          as: 'updatedBy'
        }
      },
      { $unwind: { path: '$updatedBy', preserveNullAndEmptyArrays: true } }
    ]);

    records.forEach(r => attachComputedFields(r));
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/university-applications/admin/student/:studentId
router.get('/admin/student/:studentId', verifyToken, checkRole(ADMIN_DOC_ROLES), async (req, res) => {
  try {
    const records = await populateRecord(
      UniversityApplication.find({ studentId: req.params.studentId }).sort({ updatedAt: -1 })
    );
    records.forEach(r => attachComputedFields(r));
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/university-applications/admin/student/:studentId
router.post('/admin/student/:studentId', verifyToken, checkRole(ADMIN_DOC_ROLES), async (req, res) => {
  try {
    const { universityName } = req.body;
    if (!universityName || !String(universityName).trim()) {
      return res.status(400).json({ success: false, message: 'University name is required.' });
    }

    const trimmedName = String(universityName).trim();
    const existing = await UniversityApplication.findOne({
      studentId: req.params.studentId,
      universityName: trimmedName
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An application for this university already exists for this student.' });
    }

    const {
      course, degreeLevel, country, city, campus, intakeTerm,
      applicationReference, website, languageOfInstruction, duration,
      tuitionFee, notes, stages: incomingStages, finalOutcome, adminNotes
    } = req.body;

    const stagesArr = buildDefaultStages();
    if (incomingStages && Array.isArray(incomingStages)) {
      incomingStages.forEach(incoming => {
        const existingStage = stagesArr.find(s => s.stage === incoming.stage);
        if (!existingStage) return;
        if (incoming.status) existingStage.status = incoming.status;
        if (incoming.message) existingStage.message = incoming.message;
        if (incoming.stageDate) existingStage.stageDate = incoming.stageDate;
        if (incoming.status && incoming.status !== 'pending') existingStage.updatedAt = new Date();
      });
    }

    const record = new UniversityApplication({
      studentId: req.params.studentId,
      universityName: trimmedName,
      course: course || '',
      degreeLevel: degreeLevel || '',
      country: country || '',
      city: city || '',
      campus: campus || '',
      intakeTerm: intakeTerm || '',
      applicationReference: applicationReference || '',
      website: website || '',
      languageOfInstruction: languageOfInstruction || '',
      duration: duration || '',
      tuitionFee: tuitionFee || '',
      notes: notes || '',
      stages: stagesArr,
      finalOutcome: finalOutcome || 'pending',
      adminNotes: adminNotes || '',
      history: [{
        stage: computeCurrentStage(stagesArr),
        note: 'University application created',
        updatedBy: req.user.id
      }],
      updatedBy: req.user.id
    });

    await record.save();
    const populated = await populateRecord(UniversityApplication.findById(record._id));
    attachComputedFields(populated);
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'An application for this university already exists for this student.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/university-applications/:id
router.put('/:id', verifyToken, checkRole(ADMIN_DOC_ROLES), async (req, res) => {
  try {
    const record = await UniversityApplication.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

    const {
      universityName, course, degreeLevel, country, city, campus, intakeTerm,
      applicationReference, website, languageOfInstruction, duration, tuitionFee,
      notes, stages, finalOutcome, adminNotes
    } = req.body;

    const historyNotes = [];
    const stageLabels = ['', ...APPLICATION_STAGES.map(s => s.label)];

    if (universityName !== undefined && String(universityName).trim() !== record.universityName) {
      record.universityName = String(universityName).trim();
      historyNotes.push('University name updated');
    }

    const detailFields = {
      course, degreeLevel, country, city, campus, intakeTerm,
      applicationReference, website, languageOfInstruction, duration, tuitionFee, notes
    };
    Object.entries(detailFields).forEach(([key, val]) => {
      if (val !== undefined && val !== record[key]) {
        record[key] = val || '';
        historyNotes.push(`${key} updated`);
      }
    });

    if (stages && Array.isArray(stages)) {
      if (!record.stages || record.stages.length === 0) {
        record.stages = buildDefaultStages();
      }
      stages.forEach(incoming => {
        const existing = record.stages.find(s => s.stage === incoming.stage);
        if (!existing) return;

        if (incoming.status && incoming.status !== existing.status) {
          historyNotes.push(`Stage ${incoming.stage} (${stageLabels[incoming.stage] || ''}) → ${incoming.status}`);
          existing.updatedAt = new Date();
        }
        if (incoming.message !== undefined && incoming.message !== existing.message) {
          historyNotes.push(`Stage ${incoming.stage} message updated`);
        }

        if (incoming.status !== undefined) existing.status = incoming.status;
        if (incoming.message !== undefined) existing.message = incoming.message;
        if (incoming.stageDate !== undefined) existing.stageDate = incoming.stageDate || null;
      });
    }

    if (finalOutcome !== undefined && finalOutcome !== record.finalOutcome) {
      historyNotes.push(`Final outcome → ${finalOutcome}`);
      record.finalOutcome = finalOutcome;
    }

    if (adminNotes !== undefined) record.adminNotes = adminNotes;

    if (historyNotes.length) {
      record.history.push({
        stage: computeCurrentStage(record.stages),
        note: historyNotes.join(' | '),
        updatedBy: req.user.id
      });
    }

    record.updatedBy = req.user.id;
    await record.save();

    const populated = await populateRecord(UniversityApplication.findById(record._id));
    attachComputedFields(populated);
    res.json({ success: true, data: populated });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'An application for this university already exists for this student.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/university-applications/:id
router.delete('/:id', verifyToken, checkRole(ADMIN_DOC_ROLES), async (req, res) => {
  try {
    const record = await UniversityApplication.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/university-applications/student/mine
router.get('/student/mine', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const records = await UniversityApplication.find({ studentId: req.user.id })
      .sort({ updatedAt: -1 })
      .lean();

    const sanitized = records.map(r => {
      attachComputedFields(r);
      return stripAdminFields(r);
    });
    res.json({ success: true, data: sanitized });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
