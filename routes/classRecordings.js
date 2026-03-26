const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const ClassRecording = require('../models/ClassRecording');
const RecordingView = require('../models/RecordingView');
const User = require('../models/User');

// GET /api/class-recordings — Teacher/Admin: all recordings; Student: filtered
router.get('/', verifyToken, async (req, res) => {
  try {
    const { role } = req.user;

    if (['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(role)) {
      const recordings = await ClassRecording.find({ active: true })
        .populate('uploadedBy', 'name')
        .sort({ createdAt: -1 }).lean();
      return res.json({ success: true, recordings });
    }

    // STUDENT — filter by their batch, level, plan
    const student = await User.findById(req.user.id)
      .select('batch level subscription').lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const filter = {
      active: true,
      level: student.level,
      batches: student.batch,
      plan: { $in: [student.subscription, 'ALL'] }
    };

    const recordings = await ClassRecording.find(filter)
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 }).lean();

    res.json({ success: true, recordings });
  } catch (error) {
    console.error('Error fetching class recordings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/batches — Get unique batch values for dropdown
router.get('/batches', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const batches = await User.distinct('batch', { role: 'STUDENT', batch: { $ne: '' } });
    res.json({ success: true, batches: batches.sort() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/analytics/summary — Admin: view counts + total watch time per recording
router.get('/analytics/summary', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const summary = await RecordingView.aggregate([
      { $group: {
        _id: '$recording',
        totalViews: { $sum: 1 },
        uniqueStudents: { $addToSet: '$student' },
        totalWatchTime: { $sum: '$watchDuration' },
        avgWatchTime: { $avg: '$watchDuration' }
      }},
      { $project: {
        _id: 1, totalViews: 1, totalWatchTime: 1, avgWatchTime: 1,
        uniqueStudentCount: { $size: '$uniqueStudents' }
      }}
    ]);
    const map = {};
    summary.forEach(s => { map[s._id.toString()] = s; });
    res.json({ success: true, summary: map });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/class-recordings — Create recording (Teacher/Admin)
router.post('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { title, description, videoUrl, batches, level, plan } = req.body;
    if (!title || !videoUrl || !level || !batches || batches.length === 0) {
      return res.status(400).json({ success: false, message: 'Title, video URL, level, and at least one batch are required' });
    }

    const recording = await ClassRecording.create({
      title, description, videoUrl, batches, level,
      plan: plan || 'ALL',
      uploadedBy: req.user.id
    });

    console.log(`✅ Class recording created: "${title}" by ${req.user.id}`);
    res.json({ success: true, recording });
  } catch (error) {
    console.error('Error creating class recording:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/class-recordings/:id — Update recording (Teacher/Admin)
router.put('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { title, description, videoUrl, batches, level, plan } = req.body;
    const recording = await ClassRecording.findByIdAndUpdate(
      req.params.id,
      { title, description, videoUrl, batches, level, plan },
      { new: true }
    );
    if (!recording) return res.status(404).json({ success: false, message: 'Recording not found' });
    res.json({ success: true, recording });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/class-recordings/:id — Soft delete (Teacher/Admin)
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const recording = await ClassRecording.findByIdAndUpdate(
      req.params.id, { active: false }, { new: true }
    );
    if (!recording) return res.status(404).json({ success: false, message: 'Recording not found' });
    res.json({ success: true, message: 'Recording deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/class-recordings/:id/view — Student starts watching (creates view session)
router.post('/:id/view', verifyToken, async (req, res) => {
  try {
    const view = await RecordingView.create({
      recording: req.params.id,
      student: req.user.id,
      watchDuration: 0
    });
    res.json({ success: true, viewId: view._id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/class-recordings/view/:viewId — Update watch duration (called periodically)
router.put('/view/:viewId', verifyToken, async (req, res) => {
  try {
    const { watchDuration } = req.body;
    await RecordingView.findByIdAndUpdate(req.params.viewId, {
      watchDuration: watchDuration || 0,
      lastUpdatedAt: new Date()
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/:id/views — Admin: get all views for a recording
router.get('/:id/views', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const views = await RecordingView.find({ recording: req.params.id })
      .populate('student', 'name email batch level')
      .sort({ startedAt: -1 }).lean();
    res.json({ success: true, views });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
