const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const { checkAndRecordStreak, getStreakData } = require('../services/studentLoginStreak');

router.post('/check', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const data = await checkAndRecordStreak(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[login-streak] check error:', err);
    res.status(500).json({ success: false, message: 'Failed to check login streak' });
  }
});

router.get('/', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const data = await getStreakData(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[login-streak] get error:', err);
    res.status(500).json({ success: false, message: 'Failed to get login streak' });
  }
});

module.exports = router;
