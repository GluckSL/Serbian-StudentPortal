// routes/learningModules.js

const express = require('express');
const router = express.Router();
const LearningModule = require('../models/LearningModule');
const StudentProgress = require('../models/StudentProgress');
const { verifyToken, checkRole } = require('../middleware/auth');

// GET /api/learning-modules - Get all modules (with filtering and level-based access control)
router.get('/', verifyToken, async (req, res) => {
  try {
    const { 
      level, 
      category, 
      difficulty, 
      targetLanguage, 
      nativeLanguage, 
      search, 
      page = 1, 
      limit = 10,
      accessibleOnly,
      studentLevel,
      recommendedOnly
    } = req.query;
    
    // Build filter object
    const filter = { isActive: true, isDeleted: { $ne: true } }; // Exclude deleted items
    
    // ✅ NEW: Filter by visibility - Students only see published modules
    if (req.user.role === 'STUDENT') {
      filter.visibleToStudents = true;
    }
    // Teachers and Admins see all modules (including drafts)
    
    if (level) filter.level = level;
    if (category) filter.category = category;
    if (difficulty) filter.difficulty = difficulty;
    if (targetLanguage) filter.targetLanguage = targetLanguage;
    if (nativeLanguage) filter.nativeLanguage = nativeLanguage;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    
    // Level-based access control for students
    if (req.user.role === 'STUDENT' && (accessibleOnly === 'true' || studentLevel)) {
      const userLevel = studentLevel || req.user.level;
      const accessibleLevels = getAccessibleLevels(userLevel);
      
      if (accessibleLevels.length > 0) {
        if (level && accessibleLevels.includes(level)) {
          // Student picked a specific level that's within their access — use it
          filter.level = level;
        } else {
          // No level selected or selected level not accessible — show all accessible
          filter.level = { $in: accessibleLevels };
        }
      }
      
      console.log(`🔒 Level access control applied for ${req.user.email}:`, {
        userLevel,
        accessibleLevels,
        selectedLevel: level || 'none',
        filterApplied: filter.level
      });
    }
    
    // Recommended modules filter
    if (recommendedOnly === 'true' && studentLevel) {
      const recommendedLevels = getRecommendedLevels(studentLevel);
      if (recommendedLevels.length > 0) {
        filter.level = { $in: recommendedLevels };
      }
    }
    
    // For students, also get their progress
    const modules = await LearningModule.find(filter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();
    
    // If user is a student, include progress data and access information
    if (req.user.role === 'STUDENT') {
      const moduleIds = modules.map(m => m._id);
      const progressData = await StudentProgress.find({
        studentId: req.user.id,
        moduleId: { $in: moduleIds }
      }).lean();
      
      // Map progress to modules
      const progressMap = {};
      progressData.forEach(p => {
        progressMap[p.moduleId.toString()] = p;
      });
      
      const userLevel = studentLevel || req.user.level;
      
      modules.forEach(module => {
        module.studentProgress = progressMap[module._id.toString()] || null;
        
        // Add access information
        module.accessInfo = getModuleAccessStatus(userLevel, module.level);
      });
    }
    
    const total = await LearningModule.countDocuments(filter);
    
    res.json({
      modules,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      },
      levelInfo: req.user.role === 'STUDENT' ? {
        userLevel: studentLevel || req.user.level,
        accessibleLevels: getAccessibleLevels(studentLevel || req.user.level)
      } : null
    });
  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({ message: 'Error fetching learning modules' });
  }
});

// GET /api/learning-modules/:id - Get specific module
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const module = await LearningModule.findById(req.params.id)
      .populate('createdBy', 'name email')
      .lean();
    
    if (!module || module.isDeleted) {
      return res.status(404).json({ message: 'Module not found' });
    }
    
    // If user is a student, include their progress
    if (req.user.role === 'STUDENT') {
      const progress = await StudentProgress.findOne({
        studentId: req.user.id,
        moduleId: req.params.id
      }).lean();
      
      module.studentProgress = progress;
    }
    
    res.json(module);
  } catch (error) {
    console.error('Error fetching module:', error);
    res.status(500).json({ message: 'Error fetching module' });
  }
});

// POST /api/learning-modules - Create new module (Teachers/Admins only)
router.post('/', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    // Validate and fix module data before creating
    const fixedData = fixModuleValidationIssues(req.body);
    
    const moduleData = {
      ...fixedData,
      createdBy: req.user.id
    };
    
    const module = new LearningModule(moduleData);
    await module.save();
    
    await module.populate('createdBy', 'name email');
    
    res.status(201).json(module);
  } catch (error) {
    console.error('Error creating module:', error);
    
    // Handle validation errors specifically
    if (error.name === 'ValidationError') {
      const validationErrors = {};
      Object.keys(error.errors).forEach(key => {
        validationErrors[key] = error.errors[key].message;
      });
      
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: validationErrors,
        details: error.message
      });
    }
    
    res.status(500).json({ message: 'Error creating learning module' });
  }
});

// PUT /api/learning-modules/:id - Update module (Teachers/Admins only)
router.put('/:id', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const module = await LearningModule.findById(req.params.id);
    
    if (!module || module.isDeleted) {
      return res.status(404).json({ message: 'Module not found' });
    }
    
    // Check if user can edit this module
    if (req.user.role === 'TEACHER' && module.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to edit this module' });
    }
    
    // Validate and fix module data before updating
    const updatedData = fixModuleValidationIssues(req.body);
    
    // Set update context for tracking
    module._updateContext = {
      userId: req.user.id,
      changes: req.body.changeDescription || 'Module content updated'
    };
    
    // Update module fields
    Object.assign(module, updatedData);
    await module.save();
    
    await module.populate('createdBy', 'name email');
    await module.populate('lastUpdatedBy', 'name email');
    
    res.json(module);
  } catch (error) {
    console.error('Error updating module:', error);
    
    // Handle validation errors specifically
    if (error.name === 'ValidationError') {
      const validationErrors = {};
      Object.keys(error.errors).forEach(key => {
        validationErrors[key] = error.errors[key].message;
      });
      
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: validationErrors,
        details: error.message
      });
    }
    
    res.status(500).json({ message: 'Error updating module' });
  }
});

// ✅ NEW: PATCH /api/learning-modules/:id/visibility - Toggle module visibility for students
router.patch('/:id/visibility', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { visibleToStudents } = req.body;
    
    if (typeof visibleToStudents !== 'boolean') {
      return res.status(400).json({ message: 'visibleToStudents must be a boolean value' });
    }
    
    const module = await LearningModule.findById(req.params.id);
    
    if (!module) {
      return res.status(404).json({ message: 'Module not found' });
    }
    
    // Check permissions: Teachers can only modify their own modules
    if (req.user.role === 'TEACHER' && module.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to modify this module' });
    }
    
    // Update visibility
    module.visibleToStudents = visibleToStudents;
    
    // Set publishedAt timestamp when making visible for the first time
    if (visibleToStudents && !module.publishedAt) {
      module.publishedAt = new Date();
    }
    
    await module.save();
    
    console.log(`✅ Module visibility updated:`, {
      moduleId: module._id,
      title: module.title,
      visibleToStudents: module.visibleToStudents,
      publishedAt: module.publishedAt,
      updatedBy: req.user.name
    });
    
    res.json({ 
      message: `Module ${visibleToStudents ? 'published' : 'hidden from'} students successfully`,
      module: {
        _id: module._id,
        title: module.title,
        visibleToStudents: module.visibleToStudents,
        publishedAt: module.publishedAt
      }
    });
  } catch (error) {
    console.error('Error updating module visibility:', error);
    res.status(500).json({ message: 'Error updating module visibility' });
  }
});

// DELETE /api/learning-modules/:id - Move module to trash (Admins can delete any, Teachers can delete their own)
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const module = await LearningModule.findById(req.params.id);
    
    if (!module) {
      return res.status(404).json({ message: 'Module not found' });
    }
    
    // Check if already deleted
    if (module.isDeleted) {
      return res.status(400).json({ message: 'Module is already in trash' });
    }
    
    // Check permissions: Admins can delete any module, Teachers can only delete their own
    if (req.user.role === 'TEACHER' && module.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete modules you created' });
    }
    
    console.log('🗑️ Moving module to trash:', {
      moduleId: req.params.id,
      title: module.title,
      deletedBy: req.user.role,
      userId: req.user.id,
      createdBy: module.createdBy.toString()
    });
    
    // Move to trash using the new trash system
    const reason = req.body.reason || `Deleted by ${req.user.role.toLowerCase()}`;
    const trashedModule = await LearningModule.moveToTrash(req.params.id, req.user.id, reason);
    
    console.log('✅ Module moved to trash successfully:', {
      scheduledDeletion: trashedModule.scheduledDeletionDate,
      daysUntilPermanentDeletion: 30
    });
    
    res.json({ 
      message: 'Module moved to trash successfully',
      moduleTitle: module.title,
      scheduledDeletionDate: trashedModule.scheduledDeletionDate,
      daysUntilPermanentDeletion: 30,
      canBeRestored: true
    });
  } catch (error) {
    console.error('Error moving module to trash:', error);
    res.status(500).json({ message: 'Error moving module to trash' });
  }
});

// POST /api/learning-modules/:id/enroll - Enroll student in module
// ✅ Allow both STUDENT and TEACHER (for testing modules)
router.post('/:id/enroll', verifyToken, checkRole(['STUDENT', 'TEACHER']), async (req, res) => {
  try {
    const moduleId = req.params.id;
    const studentId = req.user.id; // Changed from req.user.userId to req.user.id
    
    console.log('📚 Enrollment attempt:', {
      moduleId,
      moduleIdType: typeof moduleId,
      moduleIdLength: moduleId?.length,
      studentId,
      studentRole: req.user.role
    });
    
    // Check if module exists
    const module = await LearningModule.findById(moduleId);
    console.log('🔍 Module lookup result:', {
      found: !!module,
      isActive: module?.isActive,
      title: module?.title
    });
    
    if (!module || !module.isActive) {
      console.log('❌ Module not found or inactive:', {
        moduleExists: !!module,
        isActive: module?.isActive,
        moduleId
      });
      return res.status(404).json({ message: 'Module not found or inactive' });
    }
    
    // Check if already enrolled
    const existingProgress = await StudentProgress.findOne({
      studentId,
      moduleId
    });
    
    if (existingProgress) {
      return res.status(400).json({ message: 'Already enrolled in this module' });
    }
    
    // Create progress record
    const progress = new StudentProgress({
      studentId,
      moduleId,
      status: 'in-progress',
      startedAt: new Date(),
      maxPossibleScore: module.content.exercises.reduce((sum, ex) => sum + ex.points, 0)
    });
    
    await progress.save();
    
    // Update module enrollment count
    module.totalEnrollments += 1;
    await module.save();
    
    res.status(201).json({ message: 'Successfully enrolled in module', progress });
  } catch (error) {
    console.error('Error enrolling in module:', error);
    res.status(500).json({ message: 'Error enrolling in module' });
  }
});

// GET /api/learning-modules/stats/overview - Get module statistics (Teachers/Admins)
router.get('/stats/overview', verifyToken, checkRole(['TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const filter = req.user.role === 'TEACHER' 
      ? { createdBy: req.user.id, isActive: true, isDeleted: { $ne: true } }
      : { isActive: true, isDeleted: { $ne: true } };
    
    const totalModules = await LearningModule.countDocuments(filter);
    const totalEnrollments = await LearningModule.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: '$totalEnrollments' } } }
    ]);
    
    const modulesByLevel = await LearningModule.aggregate([
      { $match: filter },
      { $group: { _id: '$level', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    
    const modulesByCategory = await LearningModule.aggregate([
      { $match: filter },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    res.json({
      totalModules,
      totalEnrollments: totalEnrollments[0]?.total || 0,
      modulesByLevel,
      modulesByCategory
    });
  } catch (error) {
    console.error('Error fetching module stats:', error);
    res.status(500).json({ message: 'Error fetching statistics' });
  }
});

// GET /api/learning-modules/admin/management - Get all modules with full details for admin management
router.get('/admin/management', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'all' } = req.query;
    
    // Build filter - IMPORTANT: Exclude deleted modules
    const filter = { isDeleted: { $ne: true } };
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;
    
    const modules = await LearningModule.find(filter)
      .populate('createdBy', 'name email role')
      .populate('lastUpdatedBy', 'name email role')
      .populate('updateHistory.updatedBy', 'name email role')
      .sort({ updatedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();
    
    const total = await LearningModule.countDocuments(filter);
    
    // Add summary statistics for each module
    const modulesWithStats = modules.map(module => ({
      ...module,
      totalUpdates: module.updateHistory?.length || 0,
      lastUpdateDate: module.updateHistory?.length > 0 
        ? module.updateHistory[module.updateHistory.length - 1].updatedAt 
        : module.createdAt,
      createdByTeacher: module.createdBy?.role === 'TEACHER'
    }));
    
    res.json({
      modules: modulesWithStats,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      },
      summary: {
        totalModules: total,
        activeModules: await LearningModule.countDocuments({ isActive: true, isDeleted: { $ne: true } }),
        inactiveModules: await LearningModule.countDocuments({ isActive: false, isDeleted: { $ne: true } }),
        teacherCreated: await LearningModule.countDocuments({ 
          createdBy: { $in: await getUserIdsByRole('TEACHER') },
          isDeleted: { $ne: true }
        }),
        adminCreated: await LearningModule.countDocuments({ 
          createdBy: { $in: await getUserIdsByRole('ADMIN') },
          isDeleted: { $ne: true }
        })
      }
    });
  } catch (error) {
    console.error('Error fetching admin module management data:', error);
    res.status(500).json({ message: 'Error fetching module management data' });
  }
});

// GET /api/learning-modules/:id/history - Get update history for a specific module (Admin only)
router.get('/:id/history', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const module = await LearningModule.findById(req.params.id)
      .populate('createdBy', 'name email role')
      .populate('lastUpdatedBy', 'name email role')
      .populate('updateHistory.updatedBy', 'name email role')
      .lean();
    
    if (!module) {
      return res.status(404).json({ message: 'Module not found' });
    }
    
    res.json({
      moduleId: module._id,
      title: module.title,
      createdBy: module.createdBy,
      createdAt: module.createdAt,
      currentVersion: module.version,
      lastUpdatedBy: module.lastUpdatedBy,
      lastUpdatedAt: module.updatedAt,
      updateHistory: module.updateHistory || []
    });
  } catch (error) {
    console.error('Error fetching module history:', error);
    res.status(500).json({ message: 'Error fetching module history' });
  }
});

// POST /api/learning-modules/:id/complete - Mark module as completed
// ✅ Allow STUDENT, TEACHER, and ADMIN (for testing modules)
router.post('/:id/complete', verifyToken, checkRole(['STUDENT', 'TEACHER', 'ADMIN']), async (req, res) => {
  try {
    console.log('🔍 Complete module request:', {
      moduleId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.name
    });
    
    const moduleId = req.params.id;
    const studentId = req.user.id;
    const { sessionData, autoCompleted } = req.body;
    
    // Check if module exists
    const module = await LearningModule.findById(moduleId);
    if (!module || !module.isActive) {
      return res.status(404).json({ message: 'Module not found or inactive' });
    }
    
    // ✅ VALIDATE MINIMUM TIME REQUIREMENT (unless it's a teacher/admin testing)
    if (req.user.role === 'STUDENT' && sessionData && sessionData.timeSpentMinutes !== undefined) {
      const requiredMinutes = module.minimumCompletionTime || 15;
      const actualMinutes = sessionData.timeSpentMinutes;
      
      if (actualMinutes < requiredMinutes) {
        console.log(`⚠️ Module completion REJECTED: ${actualMinutes} min < ${requiredMinutes} min required`);
        return res.status(400).json({ 
          message: 'Insufficient practice time',
          error: 'INSUFFICIENT_TIME',
          details: {
            timeSpent: actualMinutes,
            timeRequired: requiredMinutes,
            remainingMinutes: requiredMinutes - actualMinutes
          }
        });
      }
      
      console.log(`✅ Time requirement met: ${actualMinutes} min >= ${requiredMinutes} min`);
    }
    
    // Find or create progress record
    let progress = await StudentProgress.findOne({
      studentId,
      moduleId
    });
    
    if (!progress) {
      // Create new progress record if doesn't exist
      progress = new StudentProgress({
        studentId,
        moduleId,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        progressPercentage: 100,
        maxPossibleScore: module.content.exercises.reduce((sum, ex) => sum + ex.points, 0)
      });
    } else {
      // Update existing progress
      progress.status = 'completed';
      progress.completedAt = new Date();
      progress.progressPercentage = 100;
    }
    
    // Add session data if provided
    if (sessionData) {
      progress.sessionData = sessionData;
      if (sessionData.totalScore) {
        progress.currentScore = sessionData.totalScore;
      }
    }
    
    await progress.save();
    
    console.log(`✅ Module marked as completed: ${module.title} (${sessionData?.timeSpentMinutes || 'N/A'} minutes)`);
    
    res.json({ 
      message: 'Module marked as completed successfully', 
      progress,
      status: 'completed'
    });
  } catch (error) {
    console.error('Error marking module as completed:', error);
    res.status(500).json({ message: 'Error marking module as completed' });
  }
});

// POST /api/learning-modules/:id/progress - Update module progress
// ✅ Allow STUDENT, TEACHER, and ADMIN (for testing modules)
router.post('/:id/progress', verifyToken, checkRole(['STUDENT', 'TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const moduleId = req.params.id;
    const studentId = req.user.id;
    const { progress: progressPercent, score, sessionData } = req.body;
    
    // Check if module exists
    const module = await LearningModule.findById(moduleId);
    if (!module || !module.isActive) {
      return res.status(404).json({ message: 'Module not found or inactive' });
    }
    
    // Find or create progress record
    let progress = await StudentProgress.findOne({
      studentId,
      moduleId
    });
    
    if (!progress) {
      // Create new progress record
      progress = new StudentProgress({
        studentId,
        moduleId,
        status: 'in-progress',
        startedAt: new Date(),
        progressPercentage: progressPercent || 0,
        maxPossibleScore: module.content.exercises.reduce((sum, ex) => sum + ex.points, 0)
      });
    } else {
      // Update existing progress
      progress.progressPercentage = progressPercent || progress.progressPercentage;
      progress.status = progressPercent >= 100 ? 'completed' : 'in-progress';
      if (progressPercent >= 100) {
        progress.completedAt = new Date();
      }
    }
    
    // Update score if provided
    if (score !== undefined) {
      progress.currentScore = score;
    }
    
    // Add session data if provided
    if (sessionData) {
      progress.sessionData = sessionData;
    }
    
    await progress.save();
    
    res.json({ 
      message: 'Progress updated successfully', 
      progress,
      status: progress.status
    });
  } catch (error) {
    console.error('Error updating module progress:', error);
    res.status(500).json({ message: 'Error updating module progress' });
  }
});

// Helper function to get user IDs by role
async function getUserIdsByRole(role) {
  const User = require('../models/User');
  const users = await User.find({ role }, '_id').lean();
  return users.map(user => user._id);
}

// Fix common validation issues in modules (same as in AI generator)
function fixModuleValidationIssues(module) {
  const allowedExerciseTypes = ['multiple-choice', 'fill-blank', 'translation', 'conversation', 'essay', 'role-play'];
  const exerciseTypeMapping = {
    'sentence-formation': 'fill-blank',
    'word-order': 'fill-blank',
    'matching': 'multiple-choice',
    'true-false': 'multiple-choice',
    'listening': 'conversation',
    'speaking': 'conversation',
    'comprehension': 'translation'
  };

  // Create a copy to avoid modifying the original
  const fixedModule = JSON.parse(JSON.stringify(module));

  // Fix title length
  if (fixedModule.title && fixedModule.title.length > 60) {
    fixedModule.title = fixedModule.title.substring(0, 57) + '...';
    console.log('🔧 Fixed title length');
  }

  // Fix exercise types
  if (fixedModule.content && fixedModule.content.exercises) {
    fixedModule.content.exercises = fixedModule.content.exercises.map(exercise => {
      if (!allowedExerciseTypes.includes(exercise.type)) {
        const mappedType = exerciseTypeMapping[exercise.type] || 'multiple-choice';
        console.log(`🔧 Fixed exercise type: ${exercise.type} → ${mappedType}`);
        exercise.type = mappedType;
      }
      
      // Ensure multiple choice has 4 options
      if (exercise.type === 'multiple-choice') {
        if (!exercise.options || exercise.options.length < 4) {
          exercise.options = exercise.options || [];
          while (exercise.options.length < 4) {
            exercise.options.push(`Option ${exercise.options.length + 1}`);
          }
        }
        if (exercise.options.length > 4) {
          exercise.options = exercise.options.slice(0, 4);
        }
      }
      
      // Ensure required fields
      exercise.question = exercise.question || 'Sample question';
      exercise.correctAnswer = exercise.correctAnswer || (exercise.options ? exercise.options[0] : 'Sample answer');
      exercise.explanation = exercise.explanation || 'Explanation for the correct answer';
      exercise.points = exercise.points || 1;
      
      return exercise;
    });
  }

  return fixedModule;
}

// ===== LEVEL-BASED ACCESS CONTROL =====
// Import centralized level access control functions
const {
  getAccessibleLevels,
  getRecommendedLevels,
  canAccessModule,
  getModuleAccessStatus
} = require('../utils/levelAccessControl');

module.exports = router;