/**
 * routes/testAccounts.js
 *
 * Admin-only endpoints for managing "test account" flags on student users.
 * Flagged accounts are excluded from all batch analytics and completion %
 * calculations (see utils/analyticsFilters.js).
 *
 * Mounted at: /api/test-accounts
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken, checkRole } = require('../middleware/auth');

// All endpoints require ADMIN role
const adminOnly = [verifyToken, checkRole(['ADMIN'])];

// ─── GET /api/test-accounts ───────────────────────────────────────────────────
// Returns all students flagged as test accounts.
router.get('/', ...adminOnly, async (req, res) => {
  try {
    const accounts = await User.find({ isTestAccount: true })
      .select('name regNo email batch level role')
      .sort({ name: 1 })
      .lean();
    res.json({ accounts });
  } catch (err) {
    console.error('GET /test-accounts error:', err);
    res.status(500).json({ message: 'Failed to load test accounts', error: err.message });
  }
});

// ─── GET /api/test-accounts/search?q= ────────────────────────────────────────
// Search all STUDENT users by name / regNo / email (for the "add" flow).
router.get('/search', ...adminOnly, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ results: [] });

    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const results = await User.find({
      role: 'STUDENT',
      $or: [
        { name: { $regex: regex } },
        { regNo: { $regex: regex } },
        { email: { $regex: regex } }
      ]
    })
      .select('name regNo email batch level isTestAccount')
      .limit(20)
      .sort({ name: 1 })
      .lean();

    res.json({ results });
  } catch (err) {
    console.error('GET /test-accounts/search error:', err);
    res.status(500).json({ message: 'Search failed', error: err.message });
  }
});

// ─── POST /api/test-accounts/mark ────────────────────────────────────────────
// Flag a user as a test account. Body: { userId }
router.post('/mark', ...adminOnly, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required' });

    const user = await User.findOneAndUpdate(
      { _id: userId, role: 'STUDENT' },
      { isTestAccount: true },
      { new: true }
    ).select('name regNo email batch isTestAccount');

    if (!user) return res.status(404).json({ message: 'Student not found' });
    res.json({ message: 'Marked as test account', user });
  } catch (err) {
    console.error('POST /test-accounts/mark error:', err);
    res.status(500).json({ message: 'Failed to mark account', error: err.message });
  }
});

// ─── POST /api/test-accounts/unmark ──────────────────────────────────────────
// Remove the test account flag. Body: { userId }
router.post('/unmark', ...adminOnly, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required' });

    const user = await User.findOneAndUpdate(
      { _id: userId },
      { isTestAccount: false },
      { new: true }
    ).select('name regNo email batch isTestAccount');

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'Test account flag removed', user });
  } catch (err) {
    console.error('POST /test-accounts/unmark error:', err);
    res.status(500).json({ message: 'Failed to unmark account', error: err.message });
  }
});

module.exports = router;
