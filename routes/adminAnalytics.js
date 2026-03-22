// routes/adminAnalytics.js
// Advanced Admin Analytics for Student Usage and Teacher Performance
// UPDATED: Now uses AiTutorSession for complete data (645 sessions vs 333)

const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const AiTutorSession = require('../models/AiTutorSession'); // CHANGED: Use AiTutorSession
const LearningModule = require('../models/LearningModule');
const User = require('../models/User');
const mongoose = require('mongoose');

// GET /api/admin-analytics/module-usage - Get detailed module usage analytics
router.get('/module-usage', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    console.log('📊 Admin requesting module usage analytics');
    
    const { 
      moduleId, 
      teacherId, 
      batch, 
      level, 
      dateFrom, 
      dateTo,
      studentName, // NEW: Student name search filter
      groupBy = 'module', // module, teacher, batch, student
      studentsOnly = false // NEW: Filter to show only students
    } = req.query;
    
    console.log('🔍 studentsOnly parameter:', studentsOnly, 'Type:', typeof studentsOnly);
    
    // Build match criteria
    const matchCriteria = {};
    
    if (moduleId) matchCriteria.moduleId = new mongoose.Types.ObjectId(moduleId);
    if (dateFrom || dateTo) {
      matchCriteria.createdAt = {};
      if (dateFrom) matchCriteria.createdAt.$gte = new Date(dateFrom);
      if (dateTo) matchCriteria.createdAt.$lte = new Date(dateTo);
    }
    
    // Build aggregation pipeline
    const pipeline = [
      { $match: matchCriteria },
      
      // Populate student and module data
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      {
        $lookup: {
          from: 'learningmodules',
          localField: 'moduleId',
          foreignField: '_id',
          as: 'module'
        }
      },
      
      // Unwind arrays
      { $unwind: '$student' },
      { $unwind: '$module' },
      
      // NEW: Filter to show only STUDENTS (exclude TEACHER and ADMIN roles)
      ...(studentsOnly === 'true' ? [{ $match: { 'student.role': 'STUDENT' } }] : []),
      
      // NEW: Filter by student name (case-insensitive)
      ...(studentName ? [{ $match: { 'student.name': { $regex: studentName, $options: 'i' } } }] : []),
      
      // Filter by additional criteria
      ...(batch ? [{ $match: { 'student.batch': batch } }] : []),
      ...(level ? [{ $match: { 'student.level': level } }] : []),
      ...(teacherId ? [{ $match: { 'student.assignedTeacher': new mongoose.Types.ObjectId(teacherId) } }] : []),
      
      // Calculate duration if not set (for active/incomplete sessions)
      {
        $addFields: {
          calculatedDuration: {
            $cond: {
              if: { $ifNull: ['$totalDuration', false] },
              then: '$totalDuration',
              else: {
                $cond: {
                  if: { $and: ['$startTime', '$endTime'] },
                  then: { $round: { $divide: [{ $subtract: ['$endTime', '$startTime'] }, 60000] } },
                  else: 0
                }
              }
            }
          }
        }
      },
      
      // Group by specified criteria
      {
        $group: {
          _id: getGroupByField(groupBy),
          totalSessions: { $sum: 1 },
          totalTimeSpent: { $sum: '$calculatedDuration' }, // Use calculated duration
          completedSessions: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } // CHANGED: from sessionState
          },
          averageScore: { $avg: '$analytics.sessionScore' }, // CHANGED: from summary.totalScore
          totalStudents: { $addToSet: '$studentId' },
          totalVocabularyLearned: { $sum: { $size: { $ifNull: ['$analytics.vocabularyUsed', []] } } }, // CHANGED: from summary.vocabularyUsed
          totalConversations: { 
            $sum: { 
              $size: { 
                $filter: {
                  input: { $ifNull: ['$messages', []] },
                  as: 'msg',
                  cond: { $eq: ['$$msg.role', 'student'] }
                }
              }
            }
          }, // NEW: Count total student messages across all sessions
          sessions: {
            $push: {
              sessionId: '$sessionId',
              studentName: '$student.name',
              studentBatch: '$student.batch',
              studentLevel: '$student.level',
              moduleName: '$module.title',
              moduleLevel: '$module.level',
              timeSpent: '$calculatedDuration', // Use calculated duration
              score: '$analytics.sessionScore', // CHANGED: from summary.totalScore
              completionStatus: '$status', // CHANGED: from sessionState
              date: '$createdAt'
            }
          }
        }
      },
      
      // Add calculated fields
      {
        $addFields: {
          uniqueStudentCount: { $size: '$totalStudents' },
          completionRate: {
            $multiply: [
              { $divide: ['$completedSessions', '$totalSessions'] },
              100
            ]
          },
          averageTimePerSession: {
            $divide: ['$totalTimeSpent', '$totalSessions']
          },
          averageTimePerStudent: {
            $divide: ['$totalTimeSpent', { $size: '$totalStudents' }]
          }
        }
      },
      
      // Sort by total time spent (descending)
      { $sort: { totalTimeSpent: -1 } }
    ];
    
    const results = await AiTutorSession.aggregate(pipeline); // CHANGED: from SessionRecord
    
    console.log('✅ Query results count:', results.length);
    if (results.length > 0 && groupBy === 'student') {
      console.log('📋 Sample student data:', {
        name: results[0]._id?.studentName,
        email: results[0]._id?.studentEmail,
        batch: results[0]._id?.studentBatch,
        level: results[0]._id?.studentLevel
      });
    }
    
    // Get summary statistics
    const summaryPipeline = [
      { $match: matchCriteria },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      { $unwind: '$student' },
      // NEW: Apply studentsOnly filter to summary as well
      ...(studentsOnly === 'true' ? [{ $match: { 'student.role': 'STUDENT' } }] : []),
      ...(batch ? [{ $match: { 'student.batch': batch } }] : []),
      ...(level ? [{ $match: { 'student.level': level } }] : []),
      ...(teacherId ? [{ $match: { 'student.assignedTeacher': new mongoose.Types.ObjectId(teacherId) } }] : []),
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          totalTimeSpent: { $sum: '$totalDuration' }, // CHANGED: from durationMinutes
          totalStudents: { $addToSet: '$studentId' },
          totalModules: { $addToSet: '$moduleId' },
          averageScore: { $avg: '$analytics.sessionScore' } // CHANGED: from summary.totalScore
        }
      }
    ];
    
    const summary = await AiTutorSession.aggregate(summaryPipeline); // CHANGED: from SessionRecord
    
    res.json({
      success: true,
      data: results,
      summary: summary[0] || {
        totalSessions: 0,
        totalTimeSpent: 0,
        totalStudents: [],
        totalModules: [],
        averageScore: 0
      },
      filters: {
        moduleId,
        teacherId,
        batch,
        level,
        dateFrom,
        dateTo,
        groupBy
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching module usage analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching module usage analytics',
      error: error.message
    });
  }
});

// GET /api/admin-analytics/teacher-performance - Get teacher batch performance analytics
router.get('/teacher-performance', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    console.log('👨‍🏫 Admin requesting teacher performance analytics');
    
    const { teacherId, batch, dateFrom, dateTo } = req.query;
    
    // Build match criteria
    const matchCriteria = {};
    if (dateFrom || dateTo) {
      matchCriteria.createdAt = {};
      if (dateFrom) matchCriteria.createdAt.$gte = new Date(dateFrom);
      if (dateTo) matchCriteria.createdAt.$lte = new Date(dateTo);
    }
    
    const pipeline = [
      { $match: matchCriteria },
      
      // Populate student data
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      {
        $lookup: {
          from: 'learningmodules',
          localField: 'moduleId',
          foreignField: '_id',
          as: 'module'
        }
      },
      
      { $unwind: '$student' },
      { $unwind: '$module' },
      
      // Filter by teacher and batch if specified
      ...(teacherId ? [{ $match: { 'student.assignedTeacher': new mongoose.Types.ObjectId(teacherId) } }] : []),
      ...(batch ? [{ $match: { 'student.batch': batch } }] : []),
      
      // Filter out students without assigned teachers
      { $match: { 'student.assignedTeacher': { $exists: true, $ne: null } } },
      
      // Populate teacher data
      {
        $lookup: {
          from: 'users',
          localField: 'student.assignedTeacher',
          foreignField: '_id',
          as: 'teacher'
        }
      },
      { $unwind: '$teacher' }, // Changed: removed preserveNullAndEmptyArrays since we filtered above
      
      // Group by teacher and module
      {
        $group: {
          _id: {
            teacherId: '$teacher._id',
            teacherName: '$teacher.name',
            teacherEmail: '$teacher.email',
            moduleId: '$module._id',
            moduleName: '$module.title',
            moduleLevel: '$module.level',
            batch: '$student.batch'
          },
          totalSessions: { $sum: 1 },
          totalTimeSpent: { $sum: '$totalDuration' }, // CHANGED: from durationMinutes
          completedSessions: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } // CHANGED: from sessionState
          },
          averageScore: { $avg: '$analytics.sessionScore' }, // CHANGED: from summary.totalScore
          studentsInvolved: { $addToSet: '$studentId' },
          studentDetails: {
            $addToSet: {
              studentId: '$studentId',
              studentName: '$student.name',
              studentLevel: '$student.level',
              studentBatch: '$student.batch'
            }
          }
        }
      },
      
      // Add calculated fields
      {
        $addFields: {
          studentCount: { $size: '$studentsInvolved' },
          completionRate: {
            $multiply: [
              { $divide: ['$completedSessions', '$totalSessions'] },
              100
            ]
          },
          averageTimePerStudent: {
            $divide: ['$totalTimeSpent', { $size: '$studentsInvolved' }]
          },
          averageSessionsPerStudent: {
            $divide: ['$totalSessions', { $size: '$studentsInvolved' }]
          }
        }
      },
      
      // Group by teacher for final summary
      {
        $group: {
          _id: {
            teacherId: '$_id.teacherId',
            teacherName: '$_id.teacherName',
            teacherEmail: '$_id.teacherEmail'
          },
          totalTimeSpent: { $sum: '$totalTimeSpent' },
          totalSessions: { $sum: '$totalSessions' },
          totalCompletedSessions: { $sum: '$completedSessions' },
          averageScore: { $avg: '$averageScore' },
          totalStudents: { $sum: '$studentCount' },
          modulePerformance: {
            $push: {
              moduleId: '$_id.moduleId',
              moduleName: '$_id.moduleName',
              moduleLevel: '$_id.moduleLevel',
              batch: '$_id.batch',
              timeSpent: '$totalTimeSpent',
              sessions: '$totalSessions',
              completedSessions: '$completedSessions',
              completionRate: '$completionRate',
              averageScore: '$averageScore',
              studentCount: '$studentCount',
              averageTimePerStudent: '$averageTimePerStudent',
              studentDetails: '$studentDetails'
            }
          }
        }
      },
      
      // Add teacher-level calculated fields
      {
        $addFields: {
          overallCompletionRate: {
            $multiply: [
              { $divide: ['$totalCompletedSessions', '$totalSessions'] },
              100
            ]
          },
          averageTimePerStudent: {
            $divide: ['$totalTimeSpent', '$totalStudents']
          }
        }
      },
      
      // Sort by total time spent (most active teachers first)
      { $sort: { totalTimeSpent: -1 } }
    ];
    
    const teacherPerformance = await AiTutorSession.aggregate(pipeline); // CHANGED: from SessionRecord
    
    // Get batch-level statistics
    const batchStatsPipeline = [
      { $match: matchCriteria },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      { $unwind: '$student' },
      {
        $lookup: {
          from: 'users',
          localField: 'student.assignedTeacher',
          foreignField: '_id',
          as: 'teacher'
        }
      },
      { $unwind: { path: '$teacher', preserveNullAndEmptyArrays: true } },
      
      {
        $group: {
          _id: {
            batch: '$student.batch',
            teacherId: '$teacher._id',
            teacherName: '$teacher.name'
          },
          totalTimeSpent: { $sum: '$totalDuration' }, // CHANGED: from durationMinutes
          totalSessions: { $sum: 1 },
          studentCount: { $addToSet: '$studentId' }
        }
      },
      {
        $addFields: {
          uniqueStudentCount: { $size: '$studentCount' }
        }
      },
      {
        $group: {
          _id: '$_id.batch',
          totalTimeSpent: { $sum: '$totalTimeSpent' },
          totalSessions: { $sum: '$totalSessions' },
          totalStudents: { $sum: '$uniqueStudentCount' },
          teachers: {
            $push: {
              teacherId: '$_id.teacherId',
              teacherName: '$_id.teacherName',
              timeSpent: '$totalTimeSpent',
              sessions: '$totalSessions',
              studentCount: '$uniqueStudentCount'
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ];
    
    const batchStats = await AiTutorSession.aggregate(batchStatsPipeline); // CHANGED: from SessionRecord
    
    res.json({
      success: true,
      teacherPerformance,
      batchStats,
      summary: {
        totalTeachers: teacherPerformance.length,
        totalBatches: batchStats.length,
        totalTimeSpent: teacherPerformance.reduce((sum, teacher) => sum + teacher.totalTimeSpent, 0),
        totalSessions: teacherPerformance.reduce((sum, teacher) => sum + teacher.totalSessions, 0)
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching teacher performance analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching teacher performance analytics',
      error: error.message
    });
  }
});

// GET /api/admin-analytics/student-module-details - Get detailed student usage per module
router.get('/student-module-details', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    console.log('👨‍🎓 Admin requesting detailed student module usage');
    
    const { moduleId, studentId, teacherId, batch } = req.query;
    
    const matchCriteria = {};
    if (moduleId) matchCriteria.moduleId = new mongoose.Types.ObjectId(moduleId);
    if (studentId) matchCriteria.studentId = new mongoose.Types.ObjectId(studentId);
    
    const pipeline = [
      { $match: matchCriteria },
      
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      {
        $lookup: {
          from: 'learningmodules',
          localField: 'moduleId',
          foreignField: '_id',
          as: 'module'
        }
      },
      
      { $unwind: '$student' },
      { $unwind: '$module' },
      
      // Filter by additional criteria
      ...(batch ? [{ $match: { 'student.batch': batch } }] : []),
      ...(teacherId ? [{ $match: { 'student.assignedTeacher': new mongoose.Types.ObjectId(teacherId) } }] : []),
      
      // Calculate duration if not set
      {
        $addFields: {
          calculatedDuration: {
            $cond: {
              if: { $ifNull: ['$totalDuration', false] },
              then: '$totalDuration',
              else: {
                $cond: {
                  if: { $and: ['$startTime', '$endTime'] },
                  then: { $round: { $divide: [{ $subtract: ['$endTime', '$startTime'] }, 60000] } },
                  else: 0
                }
              }
            }
          }
        }
      },
      
      // Populate teacher data
      {
        $lookup: {
          from: 'users',
          localField: 'student.assignedTeacher',
          foreignField: '_id',
          as: 'teacher'
        }
      },
      { $unwind: { path: '$teacher', preserveNullAndEmptyArrays: true } },
      
      // Project detailed information
      {
        $project: {
          sessionId: 1,
          studentName: '$student.name',
          studentEmail: '$student.email',
          studentBatch: '$student.batch',
          studentLevel: '$student.level',
          teacherName: '$teacher.name',
          teacherEmail: '$teacher.email',
          moduleName: '$module.title',
          moduleLevel: '$module.level',
          moduleCategory: '$module.category',
          sessionType: 1,
          sessionState: '$status', // CHANGED: Map status to sessionState for compatibility
          durationMinutes: '$calculatedDuration', // Use calculated duration
          summary: '$analytics', // CHANGED: Map analytics to summary for compatibility
          messages: 1, // NEW: Include conversation messages
          createdAt: 1,
          startTime: 1,
          endTime: 1
        }
      },
      
      { $sort: { createdAt: -1 } }
    ];
    
    const detailedUsage = await AiTutorSession.aggregate(pipeline); // CHANGED: from SessionRecord
    
    // Calculate summary statistics
    const summaryStats = detailedUsage.reduce((acc, session) => {
      acc.totalSessions++;
      acc.totalTimeSpent += session.durationMinutes || 0;
      acc.totalScore += session.summary?.sessionScore || session.summary?.totalScore || 0; // CHANGED: Handle both field names
      
      if (session.sessionState === 'completed') {
        acc.completedSessions++;
      }
      
      // Track unique students and modules
      acc.uniqueStudents.add(session.studentName);
      acc.uniqueModules.add(session.moduleName);
      
      return acc;
    }, {
      totalSessions: 0,
      completedSessions: 0,
      totalTimeSpent: 0,
      totalScore: 0,
      uniqueStudents: new Set(),
      uniqueModules: new Set()
    });
    
    // Convert sets to counts
    summaryStats.uniqueStudentCount = summaryStats.uniqueStudents.size;
    summaryStats.uniqueModuleCount = summaryStats.uniqueModules.size;
    summaryStats.averageScore = summaryStats.totalSessions > 0 ? summaryStats.totalScore / summaryStats.totalSessions : 0;
    summaryStats.completionRate = summaryStats.totalSessions > 0 ? (summaryStats.completedSessions / summaryStats.totalSessions) * 100 : 0;
    
    // Remove sets from response
    delete summaryStats.uniqueStudents;
    delete summaryStats.uniqueModules;
    
    res.json({
      success: true,
      detailedUsage,
      summary: summaryStats,
      totalRecords: detailedUsage.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching detailed student module usage:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching detailed usage',
      error: error.message
    });
  }
});

// GET /api/admin-analytics/teacher-module-details - Get detailed teacher usage per module
router.get('/teacher-module-details', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    console.log('👨‍🏫 Admin requesting detailed teacher module usage');
    
    const { moduleId, teacherId, batch } = req.query;
    
    const matchCriteria = {};
    if (moduleId) matchCriteria.moduleId = new mongoose.Types.ObjectId(moduleId);
    
    const pipeline = [
      { $match: matchCriteria },
      
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      {
        $lookup: {
          from: 'learningmodules',
          localField: 'moduleId',
          foreignField: '_id',
          as: 'module'
        }
      },
      
      { $unwind: '$student' },
      { $unwind: '$module' },
      
      // Filter by batch if provided
      ...(batch ? [{ $match: { 'student.batch': batch } }] : []),
      
      // Populate teacher data
      {
        $lookup: {
          from: 'users',
          localField: 'student.assignedTeacher',
          foreignField: '_id',
          as: 'teacher'
        }
      },
      { $unwind: { path: '$teacher', preserveNullAndEmptyArrays: true } },
      
      // Filter by teacher if provided
      ...(teacherId ? [{ $match: { 'teacher._id': new mongoose.Types.ObjectId(teacherId) } }] : []),
      
      // Project detailed information
      {
        $project: {
          sessionId: 1,
          studentName: '$student.name',
          studentEmail: '$student.email',
          studentBatch: '$student.batch',
          studentLevel: '$student.level',
          teacherName: '$teacher.name',
          teacherEmail: '$teacher.email',
          moduleName: '$module.title',
          moduleLevel: '$module.level',
          moduleCategory: '$module.category',
          sessionType: 1,
          sessionState: '$status',
          durationMinutes: '$totalDuration',
          summary: '$analytics',
          messages: 1,
          createdAt: 1,
          startTime: 1,
          endTime: 1
        }
      },
      
      { $sort: { createdAt: -1 } }
    ];
    
    const detailedUsage = await AiTutorSession.aggregate(pipeline);
    
    // Calculate summary statistics
    const summaryStats = detailedUsage.reduce((acc, session) => {
      acc.totalSessions++;
      acc.totalTimeSpent += session.durationMinutes || 0;
      acc.totalScore += session.summary?.sessionScore || session.summary?.totalScore || 0;
      
      if (session.sessionState === 'completed') {
        acc.completedSessions++;
      }
      
      // Track unique students and modules
      acc.uniqueStudents.add(session.studentName);
      acc.uniqueModules.add(session.moduleName);
      
      return acc;
    }, {
      totalSessions: 0,
      completedSessions: 0,
      totalTimeSpent: 0,
      totalScore: 0,
      uniqueStudents: new Set(),
      uniqueModules: new Set()
    });
    
    // Convert sets to counts
    summaryStats.uniqueStudentCount = summaryStats.uniqueStudents.size;
    summaryStats.uniqueModuleCount = summaryStats.uniqueModules.size;
    summaryStats.averageScore = summaryStats.totalSessions > 0 ? summaryStats.totalScore / summaryStats.totalSessions : 0;
    summaryStats.completionRate = summaryStats.totalSessions > 0 ? (summaryStats.completedSessions / summaryStats.totalSessions) * 100 : 0;
    
    // Remove sets from response
    delete summaryStats.uniqueStudents;
    delete summaryStats.uniqueModules;
    
    res.json({
      success: true,
      detailedUsage,
      summary: summaryStats,
      totalRecords: detailedUsage.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching detailed teacher module usage:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching detailed usage',
      error: error.message
    });
  }
});

// GET /api/admin-analytics/teacher-own-usage - Get teacher's own AI bot usage
router.get('/teacher-own-usage', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    console.log('👨‍🎓 Admin requesting teacher own usage');
    
    const { teacherEmail, moduleId } = req.query;
    
    if (!teacherEmail) {
      return res.status(400).json({
        success: false,
        message: 'Teacher email is required'
      });
    }
    
    // Find teacher by email
    const User = require('../models/User');
    const teacher = await User.findOne({ email: teacherEmail, role: 'TEACHER' });
    
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }
    
    const matchCriteria = {
      studentId: teacher._id // Teacher used AI bot as a student
    };
    
    if (moduleId) {
      matchCriteria.moduleId = new mongoose.Types.ObjectId(moduleId);
    }
    
    const pipeline = [
      { $match: matchCriteria },
      
      {
        $lookup: {
          from: 'learningmodules',
          localField: 'moduleId',
          foreignField: '_id',
          as: 'module'
        }
      },
      
      { $unwind: '$module' },
      
      // Calculate duration if not set
      {
        $addFields: {
          calculatedDuration: {
            $cond: {
              if: { $ifNull: ['$totalDuration', false] },
              then: '$totalDuration',
              else: {
                $cond: {
                  if: { $and: ['$startTime', '$endTime'] },
                  then: { $round: { $divide: [{ $subtract: ['$endTime', '$startTime'] }, 60000] } },
                  else: 0
                }
              }
            }
          }
        }
      },
      
      // Project detailed information
      {
        $project: {
          sessionId: 1,
          studentName: teacher.name, // Teacher's name
          studentEmail: teacher.email, // Teacher's email
          studentBatch: teacher.batch || 'N/A',
          studentLevel: teacher.level || 'N/A',
          teacherName: 'Self-Practice', // Indicate it's self-practice
          teacherEmail: teacher.email,
          moduleName: '$module.title',
          moduleLevel: '$module.level',
          moduleCategory: '$module.category',
          sessionType: 1,
          sessionState: '$status',
          durationMinutes: '$calculatedDuration', // Use calculated duration
          summary: '$analytics',
          messages: 1,
          createdAt: 1,
          startTime: 1,
          endTime: 1
        }
      },
      
      { $sort: { createdAt: -1 } }
    ];
    
    const detailedUsage = await AiTutorSession.aggregate(pipeline);
    
    // Calculate summary statistics
    const summaryStats = detailedUsage.reduce((acc, session) => {
      acc.totalSessions++;
      acc.totalTimeSpent += session.durationMinutes || 0;
      acc.totalScore += session.summary?.sessionScore || session.summary?.totalScore || 0;
      
      if (session.sessionState === 'completed') {
        acc.completedSessions++;
      }
      
      // Track unique modules
      acc.uniqueModules.add(session.moduleName);
      
      return acc;
    }, {
      totalSessions: 0,
      completedSessions: 0,
      totalTimeSpent: 0,
      totalScore: 0,
      uniqueModules: new Set()
    });
    
    // Convert sets to counts
    summaryStats.uniqueModuleCount = summaryStats.uniqueModules.size;
    summaryStats.averageScore = summaryStats.totalSessions > 0 ? summaryStats.totalScore / summaryStats.totalSessions : 0;
    summaryStats.completionRate = summaryStats.totalSessions > 0 ? (summaryStats.completedSessions / summaryStats.totalSessions) * 100 : 0;
    
    // Remove sets from response
    delete summaryStats.uniqueModules;
    
    res.json({
      success: true,
      detailedUsage,
      summary: summaryStats,
      totalRecords: detailedUsage.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching teacher own usage:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching teacher own usage',
      error: error.message
    });
  }
});

// Helper function to determine grouping field
function getGroupByField(groupBy) {
  switch (groupBy) {
    case 'teacher':
      return {
        teacherId: '$student.assignedTeacher',
        teacherName: '$student.assignedTeacher' // Will be populated later
      };
    case 'batch':
      return {
        batch: '$student.batch'
      };
    case 'student':
      return {
        studentId: '$studentId',
        studentName: '$student.name',
        studentEmail: '$student.email', // NEW: Include email
        studentBatch: '$student.batch',
        studentLevel: '$student.level'
      };
    case 'module':
    default:
      return {
        moduleId: '$moduleId',
        moduleName: '$module.title',
        moduleLevel: '$module.level',
        moduleCategory: '$module.category'
      };
  }
}

// GET /api/admin-analytics/filter-options - Get available filter options
router.get('/filter-options', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    console.log('📊 Admin requesting filter options');
    
    const User = require('../models/User');
    
    // Get unique batch values from students who have used AI tutor
    const AiTutorSession = require('../models/AiTutorSession');
    
    // Get student IDs who have AI sessions
    const studentIdsWithSessions = await AiTutorSession.distinct('studentId');
    
    // Get unique batches from those students
    const batches = await User.distinct('batch', {
      _id: { $in: studentIdsWithSessions },
      role: 'STUDENT',
      batch: { $exists: true, $ne: null, $ne: '' }
    });
    
    // Sort batches (numeric first, then alphabetic)
    const sortedBatches = batches.sort((a, b) => {
      const aNum = parseInt(a);
      const bNum = parseInt(b);
      
      // Both are numbers
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }
      // a is number, b is not
      if (!isNaN(aNum)) return -1;
      // b is number, a is not
      if (!isNaN(bNum)) return 1;
      // Both are strings
      return a.localeCompare(b);
    });
    
    res.json({
      success: true,
      batches: sortedBatches,
      levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
    });
    
  } catch (error) {
    console.error('❌ Error fetching filter options:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching filter options',
      error: error.message
    });
  }
});

module.exports = router;
