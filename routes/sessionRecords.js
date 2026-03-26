// routes/sessionRecords.js

const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const SessionRecord = require('../models/SessionRecord');
const AiTutorSession = require('../models/AiTutorSession');
const User = require('../models/User');
const LearningModule = require('../models/LearningModule');

// POST /api/session-records - Create or update session record
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      sessionId,
      moduleId,
      sessionType,
      messages,
      summary,
      sessionState,
      isModuleCompleted
    } = req.body;

    console.log('📝 Creating/updating session record:', {
      sessionId,
      moduleId,
      studentId: req.user.id,
      messageCount: messages?.length || 0
    });

    // Get student and module information
    const student = await User.findById(req.user.id);
    const module = await LearningModule.findById(moduleId);

    if (!student || !module) {
      return res.status(404).json({
        success: false,
        message: 'Student or module not found'
      });
    }

    // Calculate session duration
    const now = new Date();
    let sessionRecord = await SessionRecord.findOne({ sessionId });
    
    if (sessionRecord) {
      // Update existing session record
      sessionRecord.messages = messages || sessionRecord.messages;
      sessionRecord.summary = summary || sessionRecord.summary;
      sessionRecord.sessionState = sessionState || sessionRecord.sessionState;
      sessionRecord.isModuleCompleted = isModuleCompleted || sessionRecord.isModuleCompleted;
      sessionRecord.endTime = now;
      sessionRecord.durationMinutes = Math.round((now - sessionRecord.startTime) / 60000);
      
      await sessionRecord.save();
      console.log('✅ Session record updated:', sessionRecord._id);
    } else {
      // Create new session record
      sessionRecord = new SessionRecord({
        sessionId,
        studentId: req.user.id,
        studentName: student.name,
        studentEmail: student.email,
        moduleId,
        moduleTitle: module.title,
        moduleLevel: module.level,
        sessionType: sessionType || 'practice',
        sessionState: sessionState || 'active',
        startTime: now,
        endTime: sessionState === 'completed' || sessionState === 'manually_ended' ? now : null,
        messages: messages || [],
        summary: summary || {},
        isModuleCompleted: isModuleCompleted || false
      });

      if (sessionRecord.endTime) {
        sessionRecord.durationMinutes = Math.round((sessionRecord.endTime - sessionRecord.startTime) / 60000);
      }

      await sessionRecord.save();
      console.log('✅ New session record created:', sessionRecord._id);
    }

    res.json({
      success: true,
      message: 'Session record saved successfully',
      sessionRecord: {
        id: sessionRecord._id,
        sessionId: sessionRecord.sessionId,
        durationMinutes: sessionRecord.durationMinutes,
        messageCount: sessionRecord.messages.length
      }
    });

    // Sync AiTutorSession status (runs after response is sent)
    try {
      if (sessionState === 'manually_ended' || sessionState === 'completed' || sessionState === 'abandoned') {
        const atsStatus = sessionState === 'manually_ended' ? 'completed' : sessionState;
        await AiTutorSession.updateOne(
          { sessionId },
          { $set: { status: atsStatus, endTime: now, updatedAt: now } }
        );
        console.log(`🔄 AiTutorSession synced: ${sessionId} → ${atsStatus}`);
      }
    } catch (syncErr) {
      console.error('⚠️ AiTutorSession sync error (non-fatal):', syncErr.message);
    }

  } catch (error) {
    console.error('❌ Error saving session record:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving session record',
      error: error.message
    });
  }
});

// GET /api/session-records/student/:studentId - Get session records for a student
router.get('/student/:studentId', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { studentId } = req.params;
    const { page = 1, limit = 10, moduleId } = req.query;

    const query = { studentId };
    if (moduleId) {
      query.moduleId = moduleId;
    }

    const sessionRecords = await SessionRecord.find(query)
      .populate('studentId', 'name email level')
      .populate('moduleId', 'title level category')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await SessionRecord.countDocuments(query);

    res.json({
      success: true,
      sessionRecords: sessionRecords
        .filter(record => record.moduleId !== null) // Skip records with deleted modules
        .map(record => ({
          id: record._id,
          sessionId: record.sessionId,
          student: {
            name: record.studentName,
            email: record.studentEmail,
            level: record.studentId?.level
          },
          module: {
            title: record.moduleTitle,
            level: record.moduleLevel,
            category: record.moduleId?.category || 'General'
          },
          sessionType: record.sessionType,
          sessionState: record.sessionState,
          startTime: record.startTime,
          endTime: record.endTime,
          durationMinutes: record.durationMinutes,
          formattedDuration: record.formattedDuration,
          conversationStats: record.getConversationStats(),
          performanceSummary: record.getPerformanceSummary(),
          teacherReviewed: record.teacherReviewed,
          isModuleCompleted: record.isModuleCompleted,
          createdAt: record.createdAt
        })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('❌ Error fetching student session records:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching session records',
      error: error.message
    });
  }
});

// GET /api/session-records/module/:moduleId - Get session records for a module
router.get('/module/:moduleId', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const sessionRecords = await SessionRecord.find({ moduleId })
      .populate('studentId', 'name email level')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await SessionRecord.countDocuments({ moduleId });

    res.json({
      success: true,
      sessionRecords: sessionRecords
        .filter(record => record.studentId !== null) // Skip records with deleted students
        .map(record => ({
          id: record._id,
          sessionId: record.sessionId,
          student: {
            id: record.studentId._id,
            name: record.studentName,
            email: record.studentEmail,
            level: record.studentId?.level
          },
          sessionType: record.sessionType,
          sessionState: record.sessionState,
          startTime: record.startTime,
          endTime: record.endTime,
          durationMinutes: record.durationMinutes,
          conversationStats: record.getConversationStats(),
          performanceSummary: record.getPerformanceSummary(),
          teacherReviewed: record.teacherReviewed,
          isModuleCompleted: record.isModuleCompleted,
          createdAt: record.createdAt
        })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('❌ Error fetching module session records:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching session records',
      error: error.message
    });
  }
});

// GET /api/session-records/:sessionId/details - Get detailed session record with full conversation
router.get('/:sessionId/details', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { sessionId } = req.params;

    const sessionRecord = await SessionRecord.findOne({ sessionId })
      .populate('studentId', 'name email level')
      .populate('moduleId', 'title level category');

    if (!sessionRecord) {
      return res.status(404).json({
        success: false,
        message: 'Session record not found'
      });
    }

    // Check if referenced documents exist
    if (!sessionRecord.studentId || !sessionRecord.moduleId) {
      return res.status(404).json({
        success: false,
        message: 'Session record references deleted student or module'
      });
    }

    res.json({
      success: true,
      sessionRecord: {
        id: sessionRecord._id,
        sessionId: sessionRecord.sessionId,
        student: {
          id: sessionRecord.studentId._id,
          name: sessionRecord.studentName,
          email: sessionRecord.studentEmail,
          level: sessionRecord.studentId?.level
        },
        module: {
          id: sessionRecord.moduleId._id,
          title: sessionRecord.moduleTitle,
          level: sessionRecord.moduleLevel,
          category: sessionRecord.moduleId?.category
        },
        sessionType: sessionRecord.sessionType,
        sessionState: sessionRecord.sessionState,
        startTime: sessionRecord.startTime,
        endTime: sessionRecord.endTime,
        durationMinutes: sessionRecord.durationMinutes,
        formattedDuration: sessionRecord.formattedDuration,
        messages: sessionRecord.messages,
        summary: sessionRecord.summary,
        conversationStats: sessionRecord.getConversationStats(),
        performanceSummary: sessionRecord.getPerformanceSummary(),
        teacherReviewed: sessionRecord.teacherReviewed,
        teacherNotes: sessionRecord.teacherNotes,
        reviewedAt: sessionRecord.reviewedAt,
        isModuleCompleted: sessionRecord.isModuleCompleted,
        createdAt: sessionRecord.createdAt
      }
    });

  } catch (error) {
    console.error('❌ Error fetching session details:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching session details',
      error: error.message
    });
  }
});

// PUT /api/session-records/:sessionId/review - Add teacher review to session
router.put('/:sessionId/review', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { teacherNotes } = req.body;

    const sessionRecord = await SessionRecord.findOne({ sessionId });

    if (!sessionRecord) {
      return res.status(404).json({
        success: false,
        message: 'Session record not found'
      });
    }

    sessionRecord.teacherReviewed = true;
    sessionRecord.teacherNotes = teacherNotes;
    sessionRecord.reviewedAt = new Date();
    sessionRecord.reviewedBy = req.user.id;

    await sessionRecord.save();

    res.json({
      success: true,
      message: 'Teacher review added successfully',
      sessionRecord: {
        id: sessionRecord._id,
        teacherReviewed: sessionRecord.teacherReviewed,
        teacherNotes: sessionRecord.teacherNotes,
        reviewedAt: sessionRecord.reviewedAt
      }
    });

  } catch (error) {
    console.error('❌ Error adding teacher review:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding teacher review',
      error: error.message
    });
  }
});

// GET /api/session-records/my-history - Get current student's session history
router.get('/my-history', verifyToken, async (req, res) => {
  try {
    const { moduleId } = req.query;

    // Build query for current student
    const query = { studentId: req.user.id };
    if (moduleId && moduleId !== '') {
      query.moduleId = moduleId;
    }

    // Get session records
    const sessionRecords = await SessionRecord.find(query)
      .populate('moduleId', 'title level category')
      .sort({ createdAt: -1 })
      .limit(50); // Limit to last 50 sessions

    // Calculate statistics
    const totalSessions = sessionRecords.length;
    const completedSessions = sessionRecords.filter(s => s.sessionState === 'completed').length;
    const modulesCompleted = sessionRecords.filter(s => s.isModuleCompleted).length;
    
    const totalTimeSpent = sessionRecords.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
    const totalScore = sessionRecords.reduce((sum, s) => sum + (s.summary?.totalScore || 0), 0);
    const averageScore = totalSessions > 0 ? Math.round(totalScore / totalSessions) : 0;
    
    // Calculate unique vocabulary learned
    const allVocabulary = new Set();
    sessionRecords.forEach(s => {
      if (s.summary?.vocabularyUsed) {
        s.summary.vocabularyUsed.forEach(word => allVocabulary.add(word));
      }
    });
    
    const completionRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;
    const averageSessionDuration = totalSessions > 0 ? Math.round(totalTimeSpent / totalSessions) : 0;
    
    // Calculate improvement trend (last 5 vs previous 5 sessions)
    let improvementTrend = 'stable';
    if (sessionRecords.length >= 10) {
      const recent5 = sessionRecords.slice(0, 5);
      const previous5 = sessionRecords.slice(5, 10);
      
      const recentAvg = recent5.reduce((sum, s) => sum + (s.summary?.totalScore || 0), 0) / 5;
      const previousAvg = previous5.reduce((sum, s) => sum + (s.summary?.totalScore || 0), 0) / 5;
      
      if (recentAvg > previousAvg + 10) {
        improvementTrend = 'improving';
      } else if (recentAvg < previousAvg - 10) {
        improvementTrend = 'declining';
      }
    }

    // Format session history (filter out records with deleted modules)
    const sessionHistory = sessionRecords
      .filter(record => record.moduleId !== null) // Skip records with deleted modules
      .map(record => ({
        id: record._id,
        sessionId: record.sessionId,
        module: {
          id: record.moduleId._id,
          title: record.moduleTitle,
          level: record.moduleLevel,
          category: record.moduleId?.category || 'General'
        },
        sessionType: record.sessionType,
        sessionState: record.sessionState,
        startTime: record.startTime,
        endTime: record.endTime,
        durationMinutes: record.durationMinutes,
        formattedDuration: record.formattedDuration,
        summary: record.summary || {
          conversationCount: 0,
          timeSpentMinutes: record.durationMinutes || 0,
          vocabularyUsed: [],
          exerciseScore: 0,
          conversationScore: 0,
          totalScore: 0,
          correctAnswers: 0,
          incorrectAnswers: 0,
          accuracy: 0
        },
        performanceSummary: record.getPerformanceSummary(),
        isModuleCompleted: record.isModuleCompleted,
        createdAt: record.createdAt
      }));

    res.json({
      success: true,
      sessionHistory,
      stats: {
        totalSessions,
        completedSessions,
        modulesCompleted,
        totalTimeSpent,
        averageScore,
        totalVocabularyLearned: allVocabulary.size,
        completionRate,
        averageSessionDuration,
        improvementTrend
      }
    });

  } catch (error) {
    console.error('❌ Error fetching student session history:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching session history',
      error: error.message
    });
  }
});
router.get('/stats/overview', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { moduleId, studentId, dateFrom, dateTo } = req.query;

    // Build query
    const query = {};
    if (moduleId) query.moduleId = moduleId;
    if (studentId) query.studentId = studentId;
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    // Get statistics
    const totalSessions = await SessionRecord.countDocuments(query);
    const completedSessions = await SessionRecord.countDocuments({ ...query, sessionState: 'completed' });
    const modulesCompleted = await SessionRecord.countDocuments({ ...query, isModuleCompleted: true });
    const needsReview = await SessionRecord.countDocuments({ ...query, teacherReviewed: false });

    // Get average session duration
    const avgDurationResult = await SessionRecord.aggregate([
      { $match: query },
      { $group: { _id: null, avgDuration: { $avg: '$durationMinutes' } } }
    ]);
    const avgDuration = avgDurationResult[0]?.avgDuration || 0;

    // Get recent sessions
    const recentSessions = await SessionRecord.find(query)
      .populate('studentId', 'name email')
      .populate('moduleId', 'title level')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('sessionId studentName moduleTitle sessionState durationMinutes createdAt teacherReviewed');

    res.json({
      success: true,
      stats: {
        totalSessions,
        completedSessions,
        modulesCompleted,
        needsReview,
        avgDurationMinutes: Math.round(avgDuration),
        completionRate: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0
      },
      recentSessions: recentSessions.map(session => ({
        sessionId: session.sessionId,
        studentName: session.studentName,
        moduleTitle: session.moduleTitle,
        sessionState: session.sessionState,
        durationMinutes: session.durationMinutes,
        teacherReviewed: session.teacherReviewed,
        createdAt: session.createdAt
      }))
    });

  } catch (error) {
    console.error('❌ Error fetching overview stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: error.message
    });
  }
});

// GET /api/session-records/stats/overview - Get overview statistics for teachers
router.get('/stats/overview', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { moduleId, studentId, dateFrom, dateTo } = req.query;

    // Build query
    const query = {};
    if (moduleId) query.moduleId = moduleId;
    if (studentId) query.studentId = studentId;
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    // Get statistics
    const totalSessions = await SessionRecord.countDocuments(query);
    const completedSessions = await SessionRecord.countDocuments({ ...query, sessionState: 'completed' });
    const modulesCompleted = await SessionRecord.countDocuments({ ...query, isModuleCompleted: true });
    const needsReview = await SessionRecord.countDocuments({ ...query, teacherReviewed: false });

    // Get average session duration
    const avgDurationResult = await SessionRecord.aggregate([
      { $match: query },
      { $group: { _id: null, avgDuration: { $avg: '$durationMinutes' } } }
    ]);
    const avgDuration = avgDurationResult[0]?.avgDuration || 0;

    // Get recent sessions
    const recentSessions = await SessionRecord.find(query)
      .populate('studentId', 'name email')
      .populate('moduleId', 'title level')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('sessionId studentName moduleTitle sessionState durationMinutes createdAt teacherReviewed');

    res.json({
      success: true,
      stats: {
        totalSessions,
        completedSessions,
        modulesCompleted,
        needsReview,
        avgDurationMinutes: Math.round(avgDuration),
        completionRate: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0
      },
      recentSessions: recentSessions.map(session => ({
        sessionId: session.sessionId,
        studentName: session.studentName,
        moduleTitle: session.moduleTitle,
        sessionState: session.sessionState,
        durationMinutes: session.durationMinutes,
        teacherReviewed: session.teacherReviewed,
        createdAt: session.createdAt
      }))
    });

  } catch (error) {
    console.error('❌ Error fetching overview stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: error.message
    });
  }
});

module.exports = router;