//routes/profile.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const uploadProfile = require('../middleware/profileUpload');
const deleteFromS3 = require('../config/s3Delete');


// GET /api/profile - Get logged-in user's profile
router.get('/', verifyToken, async (req, res) => {
  try {
    console.log("Decoded user in profile route:", req.user);

    const user = await User.findById(req.user.id).select('-password'); // 👈 FIXED

    if (!user) {
      return res.status(404).json({ success: false, msg: 'User not found' });
    }


    let profileData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      subscription: user.subscription,
      registeredAt: user.registeredAt,
    };

    // Add role-specific fields
    if (user.role === 'STUDENT') {
      profileData.courseAssigned = user.courseAssigned;
      profileData.vapiAccess = user.vapiAccess;
    }

    if (user.role === 'ADMIN') {
      profileData.isAdmin = true;
    }

    if (user.role === 'TEACHER') {
      profileData.assignedCourses = user.assignedCourses || [];
    }

    res.json({ success: true, user: profileData });
  } catch (err) {
    console.error('Error getting profile:', err);
    res.status(500).json({ success: false, msg: 'Error fetching profile', error: err.message });
  }
});


// PUT /api/profile/update
router.put('/update', verifyToken, async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, msg: 'Name and email are required' });
    }

    // Update the user
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { name, email },
      { new: true, runValidators: true, select: '-password' }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, msg: 'User not found' });
    }

    res.json({ success: true, msg: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    console.error(`Error updating profile for user ${req.user.id}:`, err);
    res.status(500).json({ success: false, msg: 'Error updating profile', error: err.message });
  }
});


// PUT /api/profile/update-password
router.put('/update-password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, msg: 'Please provide both current and new passwords' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, msg: 'User not found' });

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ success: false, msg: 'Current password is incorrect' });

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    await user.save();

    res.json({ success: true, msg: 'Password updated successfully' });
  } catch (err) {
    console.error(`Password update error for user ${req.user.id}:`, err);
    res.status(500).json({ success: false, msg: 'Error updating password', error: err.message });
  }
});

// POST /api/profile/upload-photo - Upload profile photo
router.post('/upload-photo', verifyToken, uploadProfile.single('profilePhoto'), async (req, res) => {
  try {
    console.log("[UPLOAD PHOTO] req.user:", req.user);

    if (!req.file) {
      console.log("[UPLOAD PHOTO] No file uploaded");
      return res.status(400).json({ msg: 'No file uploaded' });
    }

    // req.file.location is the full S3 URL from multer-s3
    const s3Url = req.file.location;
    console.log("[UPLOAD PHOTO] File uploaded to S3:", s3Url);

    const user = await User.findById(req.user.id);
    if (!user) {
      console.log("[UPLOAD PHOTO] User not found in DB, deleting uploaded file from S3");
      await deleteFromS3(req.file.key);
      return res.status(404).json({ msg: 'User not found' });
    }

    // Delete old profile photo from S3 if it was previously stored there
    if (user.profilePic && user.profilePic.startsWith('http')) {
      await deleteFromS3(user.profilePic);
    }

    // Update DB with new S3 URL
    user.profilePic = s3Url;
    user.updatedAt = new Date();
    await user.save();

    res.json({ msg: 'Profile photo uploaded successfully', profilePhoto: s3Url });

  } catch (err) {
    console.error('[UPLOAD PHOTO] Error uploading photo:', err);
    res.status(500).json({ msg: 'Error uploading photo', error: err.message });
  }
});


module.exports = router;



