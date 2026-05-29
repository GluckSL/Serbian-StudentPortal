// routes/moduleTrash.js
// Module Trash Management System

const express = require('express');
const router = express.Router();
const LearningModule = require('../models/LearningModule');
const { verifyToken, checkRole } = require('../middleware/auth');

// Get all trash items (Admin only)
router.get('/', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    console.log('📋 Admin requesting trash items');
    
    const trashItems = await LearningModule.getTrashItems();
    
    // Calculate days remaining for each item
    const trashWithDaysRemaining = trashItems.map(item => {
      const now = new Date();
      const scheduledDeletion = new Date(item.scheduledDeletionDate);
      const daysRemaining = Math.ceil((scheduledDeletion - now) / (1000 * 60 * 60 * 24));
      
      return {
        ...item.toObject(),
        daysRemaining: Math.max(0, daysRemaining),
        isExpired: daysRemaining <= 0
      };
    });
    
    console.log(`📊 Found ${trashItems.length} items in trash`);
    
    res.json({
      success: true,
      trashItems: trashWithDaysRemaining,
      totalItems: trashItems.length
    });
  } catch (error) {
    console.error('❌ Error fetching trash items:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trash items',
      error: error.message
    });
  }
});

// Move module to trash (soft delete)
router.post('/move/:moduleId', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;
    
    console.log('🗑️ Moving module to trash:', { moduleId, userId, reason });
    
    // Check if module exists and is not already deleted
    const module = await LearningModule.findById(moduleId).lean();
    if (!module) {
      return res.status(404).json({
        success: false,
        message: 'Module not found'
      });
    }
    
    if (module.isDeleted) {
      return res.status(400).json({
        success: false,
        message: 'Module is already in trash'
      });
    }
    
    // Move to trash
    const trashedModule = await LearningModule.moveToTrash(
      moduleId, 
      userId, 
      reason || 'Deleted by admin'
    );
    
    console.log('✅ Module moved to trash successfully');
    
    res.json({
      success: true,
      message: 'Module moved to trash successfully',
      module: trashedModule,
      scheduledDeletionDate: trashedModule.scheduledDeletionDate
    });
  } catch (error) {
    console.error('❌ Error moving module to trash:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to move module to trash',
      error: error.message
    });
  }
});

// Restore module from trash
router.post('/restore/:moduleId', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const userId = req.user.id;
    
    console.log('♻️ Restoring module from trash:', { moduleId, userId });
    
    // Check if module exists and is in trash
    const module = await LearningModule.findById(moduleId).lean();
    if (!module) {
      return res.status(404).json({
        success: false,
        message: 'Module not found'
      });
    }
    
    if (!module.isDeleted) {
      return res.status(400).json({
        success: false,
        message: 'Module is not in trash'
      });
    }
    
    // Restore from trash
    const restoredModule = await LearningModule.restoreFromTrash(moduleId);
    
    console.log('✅ Module restored from trash successfully');
    
    res.json({
      success: true,
      message: 'Module restored successfully',
      module: restoredModule
    });
  } catch (error) {
    console.error('❌ Error restoring module from trash:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to restore module from trash',
      error: error.message
    });
  }
});

// Permanently delete module from trash
router.delete('/permanent/:moduleId', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { moduleId } = req.params;
    const userId = req.user.id;
    
    console.log('🔥 Permanently deleting module:', { moduleId, userId });
    
    // Check if module exists and is in trash
    const module = await LearningModule.findById(moduleId).lean();
    if (!module) {
      return res.status(404).json({
        success: false,
        message: 'Module not found'
      });
    }
    
    if (!module.isDeleted) {
      return res.status(400).json({
        success: false,
        message: 'Module must be in trash before permanent deletion'
      });
    }
    
    // Store module info for response
    const moduleInfo = {
      id: module._id,
      title: module.title,
      level: module.level,
      deletedAt: module.deletedAt
    };
    
    // Permanently delete
    await LearningModule.permanentlyDelete(moduleId);
    
    console.log('✅ Module permanently deleted');
    
    res.json({
      success: true,
      message: 'Module permanently deleted',
      deletedModule: moduleInfo
    });
  } catch (error) {
    console.error('❌ Error permanently deleting module:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to permanently delete module',
      error: error.message
    });
  }
});

// Empty entire trash (permanently delete all trash items)
router.delete('/empty', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log('🗑️ Emptying entire trash:', { userId });
    
    // Get count of items to be deleted
    const trashItems = await LearningModule.find({ isDeleted: true }).lean();
    const itemCount = trashItems.length;
    
    if (itemCount === 0) {
      return res.json({
        success: true,
        message: 'Trash is already empty',
        deletedCount: 0
      });
    }
    
    // Permanently delete all trash items
    const result = await LearningModule.deleteMany({ isDeleted: true });
    
    console.log(`✅ Emptied trash: ${result.deletedCount} modules permanently deleted`);
    
    res.json({
      success: true,
      message: `Trash emptied successfully. ${result.deletedCount} modules permanently deleted.`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('❌ Error emptying trash:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to empty trash',
      error: error.message
    });
  }
});

// Cleanup expired trash items (can be called manually or by scheduled job)
router.post('/cleanup', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    console.log('🧹 Running trash cleanup job');
    
    // Find expired items first for reporting
    const expiredItems = await LearningModule.find({
      isDeleted: true,
      scheduledDeletionDate: { $lte: new Date() }
    }).lean();
    
    // Clean up expired items
    const result = await LearningModule.cleanupExpiredTrash();
    
    console.log(`✅ Cleanup completed: ${result.deletedCount} expired modules permanently deleted`);
    
    res.json({
      success: true,
      message: `Cleanup completed. ${result.deletedCount} expired modules permanently deleted.`,
      deletedCount: result.deletedCount,
      expiredItems: expiredItems.map(item => ({
        id: item._id,
        title: item.title,
        deletedAt: item.deletedAt,
        scheduledDeletionDate: item.scheduledDeletionDate
      }))
    });
  } catch (error) {
    console.error('❌ Error during trash cleanup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired trash items',
      error: error.message
    });
  }
});

// Get trash statistics
router.get('/stats', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const now = new Date();
    
    // Get all trash items
    const trashItems = await LearningModule.find({ isDeleted: true }).lean();
    
    // Calculate statistics
    const stats = {
      totalItems: trashItems.length,
      expiredItems: 0,
      itemsExpiringSoon: 0, // Within 7 days
      oldestItem: null,
      newestItem: null,
      byLevel: {},
      byCategory: {}
    };
    
    trashItems.forEach(item => {
      const scheduledDeletion = new Date(item.scheduledDeletionDate);
      const daysRemaining = Math.ceil((scheduledDeletion - now) / (1000 * 60 * 60 * 24));
      
      if (daysRemaining <= 0) {
        stats.expiredItems++;
      } else if (daysRemaining <= 7) {
        stats.itemsExpiringSoon++;
      }
      
      // Track oldest and newest
      if (!stats.oldestItem || item.deletedAt < stats.oldestItem.deletedAt) {
        stats.oldestItem = {
          id: item._id,
          title: item.title,
          deletedAt: item.deletedAt,
          daysRemaining
        };
      }
      
      if (!stats.newestItem || item.deletedAt > stats.newestItem.deletedAt) {
        stats.newestItem = {
          id: item._id,
          title: item.title,
          deletedAt: item.deletedAt,
          daysRemaining
        };
      }
      
      // Count by level and category
      stats.byLevel[item.level] = (stats.byLevel[item.level] || 0) + 1;
      stats.byCategory[item.category] = (stats.byCategory[item.category] || 0) + 1;
    });
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('❌ Error fetching trash stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trash statistics',
      error: error.message
    });
  }
});

module.exports = router;