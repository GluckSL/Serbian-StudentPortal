// routes/studentProgress.js

const express = require('express');
const router = express.Router();
const StudentProgress = require('../models/StudentProgress');
const LearningModule = require('../models/LearningModule');
const AiTutorSession = require('../models/AiTutorSession');
const mongoose = require('mongoose');
const { verifyToken, checkRole } = require('../middleware/auth');
const DocumentRequirement = require('../models/DocumentRequirement');
const StudentDocument = require('../models/StudentDocument');

// Helper: build documents list cross-referencing requirements with uploads
async function buildDocumentsList(studentId, servicesOpted) {
  const uploadedDocs = await StudentDocument.find({ studentId }).lean();
  const studentService = servicesOpted || '';
  let docRequirements = [];
  if (studentService && studentService !== 'German Language Only') {
    // Normalize service name for flexible matching (e.g. "Au Pair" vs "Au-pair")
    const normalized = studentService.trim().replace(/[\s\-]+/g, '[\\s\\-]*');
    const serviceRegex = new RegExp('^' + normalized + '$', 'i');
    docRequirements = await DocumentRequirement.find({
      active: true,
      $or: [{ applicableServices: { $size: 0 } }, { applicableServices: serviceRegex }]
    }).sort({ order: 1 }).lean();
  }
  const documents = docRequirements.map(r => {
    const uploaded = uploadedDocs.find(d => d.documentType === r.type);
    let status = 'not_uploaded';
    if (uploaded) status = uploaded.status === 'VERIFIED' ? 'verified' : uploaded.status === 'REJECTED' ? 'rejected' : 'pending';
    return { name: r.label || r.type, type: r.type, category: r.category, required: r.required, status, verified: status === 'verified', uploadedAt: uploaded?.uploadedAt || null };
  });
  uploadedDocs.forEach(d => {
    if (!docRequirements.find(r => r.type === d.documentType)) {
      documents.push({ name: d.documentName || d.documentType, type: d.documentType, category: 'OTHER', required: false, status: d.status === 'VERIFIED' ? 'verified' : d.status === 'REJECTED' ? 'rejected' : 'pending', verified: d.status === 'VERIFIED', uploadedAt: d.uploadedAt });
    }
  });
  const summary = { total: documents.length, verified: documents.filter(d => d.status === 'verified').length, pending: documents.filter(d => d.status === 'pending').length, rejected: documents.filter(d => d.status === 'rejected').length, notUploaded: documents.filter(d => d.status === 'not_uploaded').length };
  return { documents, docsSummary: summary, uploadedDocs };
}

// GET /api/student-progress - Get student's progress across all modules
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.get('/', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const studentId = req.user.id;
    const { status, level, category } = req.query;
    
    // Build aggregation pipeline
    const pipeline = [
      { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
      {
        $lookup: {
          from: 'learningmodules',
          localField: 'moduleId',
          foreignField: '_id',
          as: 'module'
        }
      },
      { $unwind: '$module' },
      { $match: { 'module.isActive': true } }
    ];
    
    // Add filters
    if (status) pipeline.push({ $match: { status } });
    if (level) pipeline.push({ $match: { 'module.level': level } });
    if (category) pipeline.push({ $match: { 'module.category': category } });
    
    // Sort by last accessed
    pipeline.push({ $sort: { lastAccessedAt: -1 } });
    
    const progress = await StudentProgress.aggregate(pipeline);
    
    // Calculate overall statistics
    const stats = {
      totalModules: progress.length,
      completedModules: progress.filter(p => p.status === 'completed').length,
      inProgressModules: progress.filter(p => p.status === 'in-progress').length,
      totalTimeSpent: progress.reduce((sum, p) => sum + (p.timeSpent || 0), 0),
      averageScore: progress.length > 0 
        ? Math.round(progress.reduce((sum, p) => sum + p.progressPercentage, 0) / progress.length)
        : 0,
      totalSessions: progress.reduce((sum, p) => sum + (p.sessionsCount || 0), 0)
    };
    
    res.json({ progress, stats });
  } catch (error) {
    console.error('Error fetching student progress:', error);
    res.status(500).json({ message: 'Error fetching progress data' });
  }
});

// GET /api/student-progress/level-progression - Get student's level progression
router.get('/level-progression', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const User = require('../models/User');
    const studentId = req.user.id;
    
    const student = await User.findById(studentId).select('level languageLevelOpted courseStartDates courseCompletionDates').lean();
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    
    const allLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const currentLevelIndex = allLevels.indexOf(student.level);
    
    // Determine which levels to show based on languageLevelOpted
    let displayLevels;
    const opted = (student.languageLevelOpted || '').trim();
    
    if (!opted) {
      // Default: A1 to B2
      displayLevels = ['A1', 'A2', 'B1', 'B2'];
    } else if (opted.includes('-')) {
      // Range like "A1-B2", "A2-B2", "A1-A2"
      const [startLevel, endLevel] = opted.split('-');
      const startIdx = allLevels.indexOf(startLevel);
      const endIdx = allLevels.indexOf(endLevel);
      if (startIdx >= 0 && endIdx >= 0 && endIdx >= startIdx) {
        displayLevels = allLevels.slice(startIdx, endIdx + 1);
      } else {
        displayLevels = ['A1', 'A2', 'B1', 'B2'];
      }
    } else {
      // Single level like "A1" or "B2"
      const optedIdx = allLevels.indexOf(opted);
      if (optedIdx >= 0) {
        // If current level is higher than opted level, show up to current level
        if (currentLevelIndex > optedIdx) {
          displayLevels = allLevels.slice(0, currentLevelIndex + 1);
        } else {
          // Show from A1 to opted level
          displayLevels = allLevels.slice(0, optedIdx + 1);
        }
      } else {
        displayLevels = ['A1', 'A2', 'B1', 'B2'];
      }
    }
    
    // Ensure current level is always included
    if (!displayLevels.includes(student.level)) {
      const currentIdx = allLevels.indexOf(student.level);
      if (currentIdx >= 0) {
        // Extend display levels to include current level
        const lastDisplayIdx = allLevels.indexOf(displayLevels[displayLevels.length - 1]);
        if (currentIdx > lastDisplayIdx) {
          displayLevels = allLevels.slice(allLevels.indexOf(displayLevels[0]), currentIdx + 1);
        }
      }
    }
    
    // Determine target level (last level in the display range)
    const targetLevel = displayLevels[displayLevels.length - 1];
    
    const levelProgression = displayLevels.map((level, index) => {
      const startDateKey = `${level}StartDate`;
      const completionDateKey = `${level}CompletionDate`;
      
      const startDate = student.courseStartDates?.[startDateKey];
      const completedDate = student.courseCompletionDates?.[completionDateKey];
      const levelIndex = allLevels.indexOf(level);
      
      let status = 'not-started';
      let duration = null;
      
      if (completedDate) {
        status = 'completed';
        if (startDate) {
          const diffTime = Math.abs(new Date(completedDate).getTime() - new Date(startDate).getTime());
          duration = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30));
        }
      } else if (startDate) {
        status = 'in-progress';
      } else if (levelIndex < currentLevelIndex) {
        status = 'completed';
      } else if (levelIndex === currentLevelIndex) {
        status = 'in-progress';
      }
      
      return {
        level,
        status,
        startDate,
        completedDate,
        duration
      };
    });
    
    res.json({
      currentLevel: student.level,
      targetLevel,
      levelProgression
    });
  } catch (error) {
    console.error('Error fetching level progression:', error);
    res.status(500).json({ message: 'Error fetching level progression' });
  }
});

// GET /api/student-progress/journey - Full student journey data for progress page
router.get('/journey', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const User = require('../models/User');
    const SessionRecord = require('../models/SessionRecord');
    const StudentDocument = require('../models/StudentDocument');
    const DocumentRequirement = require('../models/DocumentRequirement');
    const Invoice = require('../models/Invoice');
    const StudentPayment = require('../models/StudentPayment');
    const VisaTracking = require('../models/VisaTracking');
    const studentId = req.user.id;

    const student = await User.findById(studentId).select('-password').populate('assignedTeacher', 'name').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    // Level progression
    const allLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const currentLevelIndex = allLevels.indexOf(student.level);
    const opted = (student.languageLevelOpted || '').trim();
    let displayLevels;
    if (!opted) {
      displayLevels = ['A1', 'A2', 'B1', 'B2'];
    } else if (opted.includes('-')) {
      const [s, e] = opted.split('-');
      const si = allLevels.indexOf(s), ei = allLevels.indexOf(e);
      displayLevels = (si >= 0 && ei >= 0 && ei >= si) ? allLevels.slice(si, ei + 1) : ['A1', 'A2', 'B1', 'B2'];
    } else {
      const oi = allLevels.indexOf(opted);
      displayLevels = oi >= 0 ? allLevels.slice(0, Math.max(oi, currentLevelIndex) + 1) : ['A1', 'A2', 'B1', 'B2'];
    }
    if (!displayLevels.includes(student.level)) {
      displayLevels = allLevels.slice(allLevels.indexOf(displayLevels[0]), currentLevelIndex + 1);
    }

    const levelProgression = displayLevels.map(level => {
      const startDate = student.courseStartDates?.[level + 'StartDate'];
      const completedDate = student.courseCompletionDates?.[level + 'CompletionDate'];
      const li = allLevels.indexOf(level);
      let status = 'not-started';
      if (completedDate) status = 'completed';
      else if (startDate || li < currentLevelIndex) status = li === currentLevelIndex ? 'in-progress' : 'completed';
      else if (li === currentLevelIndex) status = 'in-progress';
      return { level, status, startDate, completedDate };
    });

    // Module progress per level
    const moduleProgress = await StudentProgress.aggregate([
      { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
      { $lookup: { from: 'learningmodules', localField: 'moduleId', foreignField: '_id', as: 'module' } },
      { $unwind: '$module' },
      { $group: { _id: '$module.level', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, totalTime: { $sum: '$timeSpent' } } }
    ]);
    const lessonsByLevel = {};
    let totalStudyMinutes = 0;
    moduleProgress.forEach(mp => { lessonsByLevel[mp._id] = { total: mp.total, completed: mp.completed }; totalStudyMinutes += mp.totalTime || 0; });

    // AI Bot usage this week
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const botSessions = await AiTutorSession.find({ studentId: new mongoose.Types.ObjectId(studentId), startTime: { $gte: weekStart } }).select('totalDuration startTime').lean();
    let botWeekMinutes = 0, botTodayMinutes = 0;
    botSessions.forEach(s => { const dur = s.totalDuration || 0; botWeekMinutes += dur; if (s.startTime >= todayStart) botTodayMinutes += dur; });

    // Attendance
    const sessionRecords = await SessionRecord.find({ studentId: new mongoose.Types.ObjectId(studentId) }).select('sessionState startTime').sort({ startTime: -1 }).lean();
    const totalSessionCount = sessionRecords.length;
    const completedSessions = sessionRecords.filter(s => s.sessionState === 'completed' || s.sessionState === 'manually_ended').length;
    const lastSession = sessionRecords[0];

    // Documents
    const { documents, docsSummary, uploadedDocs } = await buildDocumentsList(studentId, student.servicesOpted);

    // Teacher feedback latest per level
    const feedbackByLevel = {};
    const allProg = await StudentProgress.find({ studentId: new mongoose.Types.ObjectId(studentId) }).populate('moduleId', 'level').lean();
    allProg.forEach(p => {
      if (p.teacherFeedback?.length > 0 && p.moduleId?.level) {
        const latest = p.teacherFeedback.sort((a, b) => new Date(b.providedAt) - new Date(a.providedAt))[0];
        if (!feedbackByLevel[p.moduleId.level] || new Date(latest.providedAt) > new Date(feedbackByLevel[p.moduleId.level].providedAt)) {
          feedbackByLevel[p.moduleId.level] = latest;
        }
      }
    });

    // History timeline
    const history = [];
    displayLevels.forEach(level => {
      const sd = student.courseStartDates?.[level + 'StartDate'];
      const cd = student.courseCompletionDates?.[level + 'CompletionDate'];
      if (sd) history.push({ date: sd, title: level + ' course started', desc: 'Student began ' + level + ' level.' });
      if (cd) history.push({ date: cd, title: level + ' completed', desc: 'All ' + level + ' lessons completed.' });
    });
    uploadedDocs.forEach(doc => { if (doc.uploadedAt) history.push({ date: doc.uploadedAt, title: doc.documentType + ' submitted', desc: (doc.documentName || doc.documentType) + ' provided.' }); });
    if (student.createdAt) history.push({ date: student.createdAt, title: 'Student profile created', desc: 'Profile created for student ' + student.regNo + '.' });
    if (student.enrollmentDate) history.push({ date: student.enrollmentDate, title: 'Enrollment confirmed', desc: 'Student enrolled in ' + (student.servicesOpted || 'program') + '.' });
    history.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      profile: {
        regNo: student.regNo, name: student.name, batch: student.batch,
        teacher: student.assignedTeacher?.name || student.teacherIncharge || 'Not assigned',
        servicesOpted: student.servicesOpted || '', languageLevelOpted: student.languageLevelOpted || '',
        currentLevel: student.level, studentStatus: student.studentStatus,
        enrollmentDate: student.enrollmentDate || student.createdAt,
        examScores: student.examScores || {}, languageExamStatus: student.languageExamStatus || ''
      },
      levelProgression, lessonsByLevel,
      totalStudyHours: Math.round(totalStudyMinutes / 60),
      botUsage: { todayMinutes: botTodayMinutes, weekMinutes: botWeekMinutes, targetMinutesPerWeek: 180 },
      attendance: { attended: completedSessions, total: totalSessionCount, lastSessionDate: lastSession?.startTime || null },
      documents, docsSummary,
      feedbackByLevel, history: history.slice(0, 20),
      payments: await (async () => {
        // Try StudentPayment (CSV-imported ledger) first — match by studentId OR email
        const sp = await StudentPayment.findOne({
          $or: [
            { studentId: studentId },
            { email: student.email.toLowerCase() }
          ]
        }).populate('payments.recordedBy', 'name').lean();
        if (sp) {
          // Also check for paid invoices to add to the total
          const paidInvoices = await Invoice.find({
            customer_email: { $regex: new RegExp('^' + student.email.toLowerCase().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$' + '&') + '$', 'i') },
            payment_status: 'paid'
          }).lean();
          const invoicePaidTotal = paidInvoices.reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
          const livePaid = (sp.totalPaid || 0) + invoicePaidTotal;
          const liveBalance = (sp.totalPackageAmount || 0) - livePaid;
          return {
            source: 'ledger',
            currency: sp.currency || 'LKR',
            totalPackageAmount: sp.totalPackageAmount || 0,
            totalInvoiced: sp.totalInvoiced || 0,
            totalAmount: sp.totalPackageAmount || 0,
            paidAmount: livePaid,
            pendingAmount: liveBalance > 0 ? liveBalance : 0,
            payments: (sp.payments || []).map(p => ({
              amount: p.amount,
              date: p.date,
              method: p.method || '',
              note: p.note || '',
              recordedBy: p.recordedBy?.name || ''
            })),
            invoices: []
          };
        }
        // Fallback to Invoice collection
        const invoices = await Invoice.find({ customer_email: student.email }).sort({ created_at: 1 }).lean();
        const totalAmount = invoices.reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
        const paidAmount = invoices.filter(i => i.payment_status === 'paid').reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
        return {
          source: 'invoices',
          currency: 'LKR',
          totalPackageAmount: totalAmount,
          totalInvoiced: totalAmount,
          totalAmount,
          paidAmount,
          pendingAmount: totalAmount - paidAmount,
          payments: [],
          invoices: invoices.map((inv, idx) => ({
            invoiceNumber: inv.invoice_number,
            description: inv.items?.map(i => i.description).join(', ') || '',
            invoiceDate: inv.invoice_date,
            dueDate: inv.due_date,
            subtotal: inv.subtotal || 0,
            tax: inv.total_tax || 0,
            totalPayable: inv.total_payable || 0,
            paymentStatus: inv.payment_status || 'unpaid',
            paymentDate: inv.payment_date || ''
          }))
        };
      })(),
      visa: await (async () => {
        const PORTAL_STEP_NAMES = [
          'Application Filed', 'Preliminary Review', 'Embassy Review',
          'Embassy Feedback', 'Changes / Appointment', 'Final Submission & Decision'
        ];
        const AU_PAIR_STEP_NAMES = [
          'Appointment Booking', 'Document Preparation', 'Interview Preparation',
          'Embassy Visit', 'Result & Next Steps'
        ];
        const vt = await VisaTracking.findOne({ studentId }).populate('history.updatedBy', 'name').lean();
        if (!vt) {
          return { route: 'Not set', currentStep: 0, totalSteps: 0, steps: [], stages: [], finalOutcome: '', finalOutcomeNote: '', history: [], dates: {} };
        }
        const steps = vt.visaType === 'AU_PAIR' ? AU_PAIR_STEP_NAMES : PORTAL_STEP_NAMES;
        // Compute current step from stages
        let currentStep = 0;
        if (vt.stages && vt.stages.length) {
          for (let i = 0; i < vt.stages.length; i++) {
            if (vt.stages[i].outcome !== 'completed') { currentStep = i; break; }
            if (i === vt.stages.length - 1) currentStep = i;
          }
        }
        // Build dates from stage-level stageDate fields
        const dates = {};
        (vt.stages || []).forEach(s => {
          if (s.stageDate && s.stageDateLabel) {
            const key = s.stageDateLabel.replace(/\s+/g, '').replace('Date', '');
            dates[key] = s.stageDate;
          }
        });
        return {
          route: vt.visaType === 'AU_PAIR' ? 'Au Pair' : 'Portal Visa',
          currentStep,
          totalSteps: steps.length,
          steps,
          stages: (vt.stages || []).map(s => ({
            stage: s.stage,
            status: s.status || '',
            message: s.message || '',
            actionRequired: s.actionRequired || false,
            actionNote: s.actionNote || '',
            handledBy: s.handledBy || '',
            outcome: s.outcome || '',
            outcomeDate: s.outcomeDate || null,
            stageDate: s.stageDate || null,
            stageDateLabel: s.stageDateLabel || ''
          })),
          finalOutcome: vt.finalOutcome || '',
          finalOutcomeNote: vt.finalOutcomeNote || '',
          history: (vt.history || []).map(h => ({
            date: h.date,
            stage: h.stage,
            note: h.note,
            updatedBy: h.updatedBy?.name || 'Unknown user'
          })).reverse(),
          dates
        };
      })()
    });
  } catch (error) {
    console.error('Error fetching student journey:', error);
    res.status(500).json({ message: 'Error fetching journey data' });
  }
});

// GET /api/student-progress/:moduleId - Get progress for specific module
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.get('/:moduleId', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const studentId = req.user.id;
    
    const progress = await StudentProgress.findOne({ studentId, moduleId })
      .populate('moduleId')
      .populate('teacherFeedback.providedBy', 'name email')
      .lean();
    
    if (!progress) {
      return res.status(404).json({ message: 'Progress not found for this module' });
    }
    
    // Get recent AI sessions for this module
    const recentSessions = await AiTutorSession.find({
      studentId,
      moduleId,
      status: 'completed'
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('sessionType analytics startTime totalDuration')
    .lean();
    
    progress.recentSessions = recentSessions;
    
    res.json(progress);
  } catch (error) {
    console.error('Error fetching module progress:', error);
    res.status(500).json({ message: 'Error fetching module progress' });
  }
});

// PUT /api/student-progress/:moduleId/exercise - Update exercise completion
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.put('/:moduleId/exercise', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { exerciseIndex, score, isCompleted } = req.body;
    const studentId = req.user.id;
    
    const progress = await StudentProgress.findOne({ studentId, moduleId });
    if (!progress) {
      return res.status(404).json({ message: 'Progress not found' });
    }
    
    // Find or create exercise completion record
    let exerciseProgress = progress.exercisesCompleted.find(
      ex => ex.exerciseIndex === exerciseIndex
    );
    
    if (!exerciseProgress) {
      exerciseProgress = {
        exerciseIndex,
        attempts: 0,
        bestScore: 0,
        isCompleted: false
      };
      progress.exercisesCompleted.push(exerciseProgress);
    }
    
    // Update exercise progress
    exerciseProgress.attempts += 1;
    exerciseProgress.bestScore = Math.max(exerciseProgress.bestScore, score || 0);
    exerciseProgress.lastAttemptDate = new Date();
    
    if (isCompleted) {
      exerciseProgress.isCompleted = true;
    }
    
    // Update total score
    progress.totalScore += score || 0;
    
    // Recalculate progress percentage
    progress.calculateProgress();
    
    // Update streak
    if (isCompleted && score > 0) {
      progress.currentStreak += 1;
      progress.bestStreak = Math.max(progress.bestStreak, progress.currentStreak);
    } else if (score === 0) {
      progress.currentStreak = 0;
    }
    
    // Check if module is completed
    const module = await LearningModule.findById(moduleId);
    const totalExercises = module.content.exercises.length;
    const completedExercises = progress.exercisesCompleted.filter(ex => ex.isCompleted).length;
    
    if (completedExercises === totalExercises && progress.status !== 'completed') {
      progress.status = 'completed';
      progress.completedAt = new Date();
    }
    
    await progress.save();
    
    res.json({
      message: 'Exercise progress updated',
      progress: {
        progressPercentage: progress.progressPercentage,
        currentStreak: progress.currentStreak,
        totalScore: progress.totalScore,
        status: progress.status
      }
    });
  } catch (error) {
    console.error('Error updating exercise progress:', error);
    res.status(500).json({ message: 'Error updating exercise progress' });
  }
});

// PUT /api/student-progress/:moduleId/notes - Update student notes
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.put('/:moduleId/notes', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { notes } = req.body;
    const studentId = req.user.id;
    
    const progress = await StudentProgress.findOneAndUpdate(
      { studentId, moduleId },
      { studentNotes: notes },
      { new: true }
    );
    
    if (!progress) {
      return res.status(404).json({ message: 'Progress not found' });
    }
    
    res.json({ message: 'Notes updated successfully' });
  } catch (error) {
    console.error('Error updating notes:', error);
    res.status(500).json({ message: 'Error updating notes' });
  }
});

// GET /api/student-progress/analytics/dashboard - Get dashboard analytics
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.get('/analytics/dashboard', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const studentId = req.user.id;
    
    // Get progress data
    const progressData = await StudentProgress.find({ studentId })
      .populate('moduleId', 'title level category')
      .lean();
    
    // Get recent sessions
    const recentSessions = await AiTutorSession.find({ studentId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('moduleId', 'title')
      .select('sessionType analytics startTime totalDuration')
      .lean();
    
    // Calculate analytics
    const analytics = {
      overview: {
        totalModules: progressData.filter(p => p.moduleId).length, // Only count valid modules
        completedModules: progressData.filter(p => p.status === 'completed' && p.moduleId).length,
        inProgressModules: progressData.filter(p => p.status === 'in-progress' && p.moduleId).length,
        totalTimeSpent: progressData.reduce((sum, p) => sum + (p.timeSpent || 0), 0),
        totalSessions: progressData.reduce((sum, p) => sum + (p.sessionsCount || 0), 0)
      },
      
      progressByLevel: progressData.reduce((acc, p) => {
        // Skip progress records with null or missing moduleId
        if (!p.moduleId || !p.moduleId.level) return acc;
        
        const level = p.moduleId.level;
        if (!acc[level]) acc[level] = { total: 0, completed: 0 };
        acc[level].total += 1;
        if (p.status === 'completed') acc[level].completed += 1;
        return acc;
      }, {}),
      
      progressByCategory: progressData.reduce((acc, p) => {
        // Skip progress records with null or missing moduleId
        if (!p.moduleId || !p.moduleId.category) return acc;
        
        const category = p.moduleId.category;
        if (!acc[category]) acc[category] = { total: 0, completed: 0 };
        acc[category].total += 1;
        if (p.status === 'completed') acc[category].completed += 1;
        return acc;
      }, {}),
      
      weeklyActivity: await getWeeklyActivity(studentId),
      
      recentSessions: recentSessions.map(session => ({
        moduleTitle: session.moduleId.title,
        sessionType: session.sessionType,
        duration: session.totalDuration,
        score: session.analytics.sessionScore,
        date: session.startTime
      })),
      
      streakData: {
        currentStreak: Math.max(...progressData.map(p => p.currentStreak || 0)),
        bestStreak: Math.max(...progressData.map(p => p.bestStreak || 0))
      }
    };
    
    res.json(analytics);
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    res.status(500).json({ message: 'Error fetching analytics' });
  }
});

// Helper function to get weekly activity
async function getWeeklyActivity(studentId) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  
  const sessions = await AiTutorSession.find({
    studentId,
    startTime: { $gte: oneWeekAgo }
  }).select('startTime totalDuration').lean();
  
  const weeklyData = {};
  // Use consistent day names (starting with Monday for better UX)
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  // Initialize all days with zero values
  days.forEach(day => {
    weeklyData[day] = { sessions: 0, timeSpent: 0 };
  });
  
  // Aggregate session data by day
  sessions.forEach(session => {
    const dayIndex = session.startTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
    // Convert Sunday=0 to Sunday=6 for our Monday-first array
    const adjustedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
    const dayName = days[adjustedIndex];
    
    weeklyData[dayName].sessions += 1;
    weeklyData[dayName].timeSpent += session.totalDuration || 0;
  });
  
  return weeklyData;
}

// GET /api/student-progress/teacher/:studentId - Get student progress (Teachers/Admins)
router.get('/teacher/:studentId', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const progress = await StudentProgress.find({ studentId })
      .populate('moduleId', 'title level category')
      .populate('studentId', 'name email level')
      .sort({ lastAccessedAt: -1 })
      .lean();
    
    // Get recent AI sessions
    const recentSessions = await AiTutorSession.find({ studentId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('moduleId', 'title')
      .select('sessionType analytics startTime totalDuration')
      .lean();
    
    res.json({ progress, recentSessions });
  } catch (error) {
    console.error('Error fetching student progress for teacher:', error);
    res.status(500).json({ message: 'Error fetching student progress' });
  }
});

// POST /api/student-progress/:moduleId/feedback - Add teacher feedback
router.post('/:moduleId/feedback', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { studentId, feedback, rating } = req.body;
    const teacherId = req.user.id;
    
    const progress = await StudentProgress.findOne({ studentId, moduleId });
    if (!progress) {
      return res.status(404).json({ message: 'Student progress not found' });
    }
    
    progress.teacherFeedback.push({
      feedback,
      rating,
      providedBy: teacherId,
      providedAt: new Date()
    });
    
    await progress.save();
    
    res.json({ message: 'Feedback added successfully' });
  } catch (error) {
    console.error('Error adding teacher feedback:', error);
    res.status(500).json({ message: 'Error adding feedback' });
  }
});

// GET /api/student-progress/admin/journey/:studentId - Full journey for a specific student (admin view)
router.get('/admin/journey/:studentId', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const User = require('../models/User');
    const SessionRecord = require('../models/SessionRecord');
    const StudentDocument = require('../models/StudentDocument');
    const Invoice = require('../models/Invoice');
    const StudentPayment = require('../models/StudentPayment');
    const VisaTracking = require('../models/VisaTracking');
    const studentId = req.params.studentId;

    const student = await User.findById(studentId).select('-password').populate('assignedTeacher', 'name').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    // Level progression
    const allLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const currentLevelIndex = allLevels.indexOf(student.level);
    const opted = (student.languageLevelOpted || '').trim();
    let displayLevels;
    if (!opted) {
      displayLevels = ['A1', 'A2', 'B1', 'B2'];
    } else if (opted.includes('-')) {
      const [s, e] = opted.split('-');
      const si = allLevels.indexOf(s), ei = allLevels.indexOf(e);
      displayLevels = (si >= 0 && ei >= 0 && ei >= si) ? allLevels.slice(si, ei + 1) : ['A1', 'A2', 'B1', 'B2'];
    } else {
      const oi = allLevels.indexOf(opted);
      displayLevels = oi >= 0 ? allLevels.slice(0, Math.max(oi, currentLevelIndex) + 1) : ['A1', 'A2', 'B1', 'B2'];
    }
    if (!displayLevels.includes(student.level)) {
      displayLevels = allLevels.slice(allLevels.indexOf(displayLevels[0]), currentLevelIndex + 1);
    }

    const levelProgression = displayLevels.map(level => {
      const startDate = student.courseStartDates?.[level + 'StartDate'];
      const completedDate = student.courseCompletionDates?.[level + 'CompletionDate'];
      const li = allLevels.indexOf(level);
      let status = 'not-started';
      if (completedDate) status = 'completed';
      else if (startDate || li < currentLevelIndex) status = li === currentLevelIndex ? 'in-progress' : 'completed';
      else if (li === currentLevelIndex) status = 'in-progress';
      return { level, status, startDate, completedDate };
    });

    // Module progress per level
    const moduleProgress = await StudentProgress.aggregate([
      { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
      { $lookup: { from: 'learningmodules', localField: 'moduleId', foreignField: '_id', as: 'module' } },
      { $unwind: '$module' },
      { $group: { _id: '$module.level', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, totalTime: { $sum: '$timeSpent' } } }
    ]);
    const lessonsByLevel = {};
    let totalStudyMinutes = 0;
    moduleProgress.forEach(mp => { lessonsByLevel[mp._id] = { total: mp.total, completed: mp.completed }; totalStudyMinutes += mp.totalTime || 0; });

    // AI Bot usage this week
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const botSessions = await AiTutorSession.find({ studentId: new mongoose.Types.ObjectId(studentId), startTime: { $gte: weekStart } }).select('totalDuration startTime').lean();
    let botWeekMinutes = 0, botTodayMinutes = 0;
    botSessions.forEach(s => { const dur = s.totalDuration || 0; botWeekMinutes += dur; if (s.startTime >= todayStart) botTodayMinutes += dur; });

    // Attendance
    const sessionRecords = await SessionRecord.find({ studentId: new mongoose.Types.ObjectId(studentId) }).select('sessionState startTime').sort({ startTime: -1 }).lean();
    const totalSessionCount = sessionRecords.length;
    const completedSessions = sessionRecords.filter(s => s.sessionState === 'completed' || s.sessionState === 'manually_ended').length;
    const lastSession = sessionRecords[0];

    // Documents
    const { documents, docsSummary, uploadedDocs } = await buildDocumentsList(studentId, student.servicesOpted);

    // Teacher feedback latest per level
    const feedbackByLevel = {};
    const allProg = await StudentProgress.find({ studentId: new mongoose.Types.ObjectId(studentId) }).populate('moduleId', 'level').lean();
    allProg.forEach(p => {
      if (p.teacherFeedback?.length > 0 && p.moduleId?.level) {
        const latest = p.teacherFeedback.sort((a, b) => new Date(b.providedAt) - new Date(a.providedAt))[0];
        if (!feedbackByLevel[p.moduleId.level] || new Date(latest.providedAt) > new Date(feedbackByLevel[p.moduleId.level].providedAt)) {
          feedbackByLevel[p.moduleId.level] = latest;
        }
      }
    });

    // History timeline
    const history = [];
    displayLevels.forEach(level => {
      const sd = student.courseStartDates?.[level + 'StartDate'];
      const cd = student.courseCompletionDates?.[level + 'CompletionDate'];
      if (sd) history.push({ date: sd, title: level + ' course started', desc: 'Student began ' + level + ' level.' });
      if (cd) history.push({ date: cd, title: level + ' completed', desc: 'All ' + level + ' lessons completed.' });
    });
    uploadedDocs.forEach(doc => { if (doc.uploadedAt) history.push({ date: doc.uploadedAt, title: doc.documentType + ' submitted', desc: (doc.documentName || doc.documentType) + ' provided.' }); });
    if (student.createdAt) history.push({ date: student.createdAt, title: 'Student profile created', desc: 'Profile created for student ' + student.regNo + '.' });
    if (student.enrollmentDate) history.push({ date: student.enrollmentDate, title: 'Enrollment confirmed', desc: 'Student enrolled in ' + (student.servicesOpted || 'program') + '.' });
    history.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Payments
    const escapeRegex = (str) => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\' + '$' + '&');
    const payments = await (async () => {
      const sp = await StudentPayment.findOne({
        $or: [{ studentId: studentId }, { email: student.email.toLowerCase() }]
      }).populate('payments.recordedBy', 'name').lean();
      if (sp) {
        const paidInvoices = await Invoice.find({
          customer_email: { $regex: new RegExp('^' + escapeRegex(student.email.toLowerCase()) + '$', 'i') },
          payment_status: 'paid'
        }).lean();
        const invoicePaidTotal = paidInvoices.reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
        const livePaid = (sp.totalPaid || 0) + invoicePaidTotal;
        const liveBalance = (sp.totalPackageAmount || 0) - livePaid;
        return {
          source: 'ledger', currency: sp.currency || 'LKR',
          totalPackageAmount: sp.totalPackageAmount || 0, totalAmount: sp.totalPackageAmount || 0,
          paidAmount: livePaid, pendingAmount: liveBalance > 0 ? liveBalance : 0,
          payments: (sp.payments || []).map(p => ({ amount: p.amount, date: p.date, method: p.method || '', note: p.note || '', recordedBy: p.recordedBy?.name || '' })),
          invoices: []
        };
      }
      const invoices = await Invoice.find({ customer_email: student.email }).sort({ created_at: 1 }).lean();
      const totalAmount = invoices.reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
      const paidAmount = invoices.filter(i => i.payment_status === 'paid').reduce((sum, inv) => sum + (inv.total_payable || 0), 0);
      return {
        source: 'invoices', currency: 'LKR', totalPackageAmount: totalAmount, totalAmount, paidAmount, pendingAmount: totalAmount - paidAmount, payments: [],
        invoices: invoices.map(inv => ({ invoiceNumber: inv.invoice_number, description: inv.items?.map(i => i.description).join(', ') || '', invoiceDate: inv.invoice_date, dueDate: inv.due_date, subtotal: inv.subtotal || 0, tax: inv.total_tax || 0, totalPayable: inv.total_payable || 0, paymentStatus: inv.payment_status || 'unpaid', paymentDate: inv.payment_date || '' }))
      };
    })();

    // Visa
    const PORTAL_STEP_NAMES = ['Application Filed', 'Preliminary Review', 'Embassy Review', 'Embassy Feedback', 'Changes / Appointment', 'Final Submission & Decision'];
    const AU_PAIR_STEP_NAMES = ['Appointment Booking', 'Document Preparation', 'Interview Preparation', 'Embassy Visit', 'Result & Next Steps'];
    const vt = await VisaTracking.findOne({ studentId }).populate('history.updatedBy', 'name').lean();
    let visa;
    if (!vt) {
      visa = { route: 'Not set', currentStep: 0, totalSteps: 0, steps: [], stages: [], finalOutcome: '', finalOutcomeNote: '', history: [], dates: {} };
    } else {
      const steps = vt.visaType === 'AU_PAIR' ? AU_PAIR_STEP_NAMES : PORTAL_STEP_NAMES;
      let currentStep = 0;
      if (vt.stages && vt.stages.length) {
        for (let i = 0; i < vt.stages.length; i++) {
          if (vt.stages[i].outcome !== 'completed') { currentStep = i; break; }
          if (i === vt.stages.length - 1) currentStep = i;
        }
      }
      const dates = {};
      (vt.stages || []).forEach(s => { if (s.stageDate && s.stageDateLabel) { dates[s.stageDateLabel.replace(/\s+/g, '').replace('Date', '')] = s.stageDate; } });
      visa = {
        route: vt.visaType === 'AU_PAIR' ? 'Au Pair' : 'Portal Visa', currentStep, totalSteps: steps.length, steps,
        stages: (vt.stages || []).map(s => ({ stage: s.stage, status: s.status || '', message: s.message || '', actionRequired: s.actionRequired || false, actionNote: s.actionNote || '', handledBy: s.handledBy || '', outcome: s.outcome || '', outcomeDate: s.outcomeDate || null, stageDate: s.stageDate || null, stageDateLabel: s.stageDateLabel || '' })),
        finalOutcome: vt.finalOutcome || '', finalOutcomeNote: vt.finalOutcomeNote || '',
        history: (vt.history || []).map(h => ({ date: h.date, stage: h.stage, note: h.note, updatedBy: h.updatedBy?.name || 'Unknown user' })).reverse(), dates
      };
    }

    res.json({
      profile: {
        regNo: student.regNo, name: student.name, batch: student.batch,
        teacher: student.assignedTeacher?.name || student.teacherIncharge || 'Not assigned',
        servicesOpted: student.servicesOpted || '', languageLevelOpted: student.languageLevelOpted || '',
        currentLevel: student.level, studentStatus: student.studentStatus,
        enrollmentDate: student.enrollmentDate || student.createdAt
      },
      levelProgression, lessonsByLevel, totalStudyHours: Math.round(totalStudyMinutes / 60),
      botUsage: { todayMinutes: botTodayMinutes, weekMinutes: botWeekMinutes, targetMinutesPerWeek: 180 },
      attendance: { attended: completedSessions, total: totalSessionCount, lastSessionDate: lastSession?.startTime || null },
      documents, docsSummary,
      feedbackByLevel, history: history.slice(0, 20), payments, visa
    });
  } catch (err) {
    console.error('Admin journey error:', err);
    res.status(500).json({ message: 'Error fetching student journey' });
  }
});

// GET /api/student-progress/admin/overview - All students progress overview (admin)
router.get('/admin/overview', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const User = require('../models/User');
    const SessionRecord = require('../models/SessionRecord');
    const StudentDocument = require('../models/StudentDocument');
    const StudentPayment = require('../models/StudentPayment');
    const VisaTracking = require('../models/VisaTracking');

    const allLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

    // Get all students
    const students = await User.find({ role: 'STUDENT' })
      .select('name email regNo batch level servicesOpted languageLevelOpted studentStatus assignedTeacher enrollmentDate courseStartDates courseCompletionDates')
      .populate('assignedTeacher', 'name')
      .lean();

    // Batch fetch related data
    const studentIds = students.map(s => s._id);
    const studentIdStrs = studentIds.map(id => id.toString());

    // Attendance counts per student
    const attendanceAgg = await SessionRecord.aggregate([
      { $match: { studentId: { $in: studentIds } } },
      { $group: {
        _id: '$studentId',
        total: { $sum: 1 },
        attended: { $sum: { $cond: [{ $in: ['$sessionState', ['completed', 'manually_ended']] }, 1, 0] } }
      }}
    ]);
    const attendanceMap = {};
    attendanceAgg.forEach(a => { attendanceMap[a._id.toString()] = a; });

    // Module progress per student
    const moduleAgg = await StudentProgress.aggregate([
      { $match: { studentId: { $in: studentIds } } },
      { $lookup: { from: 'learningmodules', localField: 'moduleId', foreignField: '_id', as: 'mod' } },
      { $unwind: '$mod' },
      { $group: {
        _id: { studentId: '$studentId', level: '$mod.level' },
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
      }}
    ]);
    const moduleMap = {};
    moduleAgg.forEach(m => {
      const sid = m._id.studentId.toString();
      if (!moduleMap[sid]) moduleMap[sid] = {};
      moduleMap[sid][m._id.level] = { total: m.total, completed: m.completed };
    });

    // Documents per student
    const docAgg = await StudentDocument.aggregate([
      { $match: { studentId: { $in: studentIds } } },
      { $group: {
        _id: '$studentId',
        total: { $sum: 1 },
        verified: { $sum: { $cond: [{ $eq: ['$status', 'VERIFIED'] }, 1, 0] } }
      }}
    ]);
    const docMap = {};
    docAgg.forEach(d => { docMap[d._id.toString()] = d; });

    // Payments
    const payments = await StudentPayment.find({ studentId: { $in: studentIds } }).select('studentId totalPackageAmount totalPaid pendingPayment currency').lean();
    const payMap = {};
    payments.forEach(p => { payMap[p.studentId.toString()] = p; });

    // Visa
    const visas = await VisaTracking.find({ studentId: { $in: studentIds } }).select('studentId visaType currentStage stages').lean();
    const visaMap = {};
    visas.forEach(v => { visaMap[v.studentId.toString()] = v; });

    // Build response
    const result = students.map(s => {
      const sid = s._id.toString();
      const att = attendanceMap[sid] || { total: 0, attended: 0 };
      const doc = docMap[sid] || { total: 0, verified: 0 };
      const pay = payMap[sid] || null;
      const visa = visaMap[sid] || null;
      const mods = moduleMap[sid] || {};

      // Level progression
      const currentLevelIndex = allLevels.indexOf(s.level);
      const opted = (s.languageLevelOpted || '').trim();
      let displayLevels;
      if (!opted) { displayLevels = ['A1', 'A2', 'B1', 'B2']; }
      else if (opted.includes('-')) {
        const [st, en] = opted.split('-');
        const si = allLevels.indexOf(st), ei = allLevels.indexOf(en);
        displayLevels = (si >= 0 && ei >= 0 && ei >= si) ? allLevels.slice(si, ei + 1) : ['A1', 'A2', 'B1', 'B2'];
      } else {
        const oi = allLevels.indexOf(opted);
        displayLevels = oi >= 0 ? allLevels.slice(0, Math.max(oi, currentLevelIndex) + 1) : ['A1', 'A2', 'B1', 'B2'];
      }

      const levelsCompleted = displayLevels.filter(lv => {
        const li = allLevels.indexOf(lv);
        return s.courseCompletionDates?.[lv + 'CompletionDate'] || li < currentLevelIndex;
      }).length;
      const learningPct = displayLevels.length ? Math.round((levelsCompleted / displayLevels.length) * 100) : 0;

      const docsPct = doc.total ? Math.round((doc.verified / doc.total) * 100) : 0;
      const payPct = pay && pay.totalPackageAmount ? Math.round((pay.totalPaid / pay.totalPackageAmount) * 100) : 0;

      let visaSteps = 0, visaCurrent = 0;
      if (visa) {
        visaSteps = visa.visaType === 'au_pair' ? 5 : 6;
        // Compute current stage from stages array outcomes
        if (visa.stages && visa.stages.length) {
          for (let i = 0; i < visa.stages.length; i++) {
            if (visa.stages[i].outcome !== 'completed') { visaCurrent = i; break; }
            if (i === visa.stages.length - 1) visaCurrent = i;
          }
        }
      }
      const visaPct = visaSteps > 1 ? Math.round((visaCurrent / (visaSteps - 1)) * 100) : 0;

      const overallPct = Math.round((learningPct * 0.4 + docsPct * 0.2 + payPct * 0.2 + visaPct * 0.2));
      const attRate = att.total ? Math.round((att.attended / att.total) * 100) : 0;

      return {
        _id: sid,
        name: s.name,
        email: s.email,
        regNo: s.regNo,
        batch: s.batch || '',
        level: s.level,
        service: s.servicesOpted || '',
        teacher: s.assignedTeacher?.name || '',
        status: s.studentStatus || '',
        enrollmentDate: s.enrollmentDate,
        overallPct,
        learningPct,
        currentLevel: s.level,
        levelsCompleted,
        totalLevels: displayLevels.length,
        attendance: { attended: att.attended, total: att.total, rate: attRate },
        docs: { verified: doc.verified, total: doc.total, pct: docsPct },
        payment: pay ? { currency: pay.currency, total: pay.totalPackageAmount, paid: pay.totalPaid, pending: pay.pendingPayment, pct: payPct } : null,
        visa: visa ? { type: visa.visaType, current: visaCurrent, total: visaSteps, pct: visaPct } : null
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching admin progress overview:', error);
    res.status(500).json({ message: 'Error fetching progress overview' });
  }
});

module.exports = router;