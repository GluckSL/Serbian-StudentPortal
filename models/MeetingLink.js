// models/MeetingLink.js
const mongoose = require('mongoose');

const meetingLinkSchema = new mongoose.Schema({
  // Basic Info
  batch: { type: String, required: true },
  plan: { type: String, required: true, enum: ['SILVER', 'PLATINUM'] },
  platform: { type: String, required: true },
  link: { type: String, required: true },
  
  // Meeting Details
  topic: { type: String },
  agenda: { type: String },
  startTime: { type: Date },
  duration: { type: Number }, // in minutes
  timezone: { type: String, default: 'Asia/Colombo' },
  
  // Zoom-specific fields
  zoomMeetingId: { type: String }, // Zoom meeting ID
  zoomPassword: { type: String },
  hostEmail: { type: String },
  startUrl: { type: String }, // For host to start meeting
  joinUrl: { type: String }, // For participants to join
  
  // Teacher who created the meeting
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  
  // Students invited to the meeting
  attendees: [{
    studentId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    name: String,
    email: String,
    registrantId: String, // Zoom registrant ID
    joinUrl: String, // Personal join URL for this student
    addedAt: { type: Date, default: Date.now }
  }],
  
  // Meeting status
  status: {
    type: String,
    enum: ['scheduled', 'started', 'ended', 'cancelled'],
    default: 'scheduled'
  },
  
  // Attendance tracking
  attendance: [{
    studentId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    name: String,
    email: String,
    attended: { type: Boolean, default: false },
    joinTime: Date,
    leaveTime: Date,
    duration: Number, // in seconds
    durationMinutes: Number, // in minutes
    status: { type: String, enum: ['attended', 'absent', 'late'], default: 'absent' },
    
    // Enhanced matching fields
    confidence: { type: Number, default: 0 }, // 0-100
    matchMethod: { 
      type: String, 
      enum: ['email', 'exact_name', 'partial_name', 'fuzzy_name', 'no_match'], 
      default: 'no_match' 
    },
    zoomName: String, // Name displayed in Zoom
    zoomEmail: String, // Email from Zoom (if available)
    needsReview: { type: Boolean, default: false }
  }],
  
  // Attendance metadata
  attendanceRecorded: { type: Boolean, default: false },
  attendanceRecordedAt: Date,
  attendanceRetries: { type: Number, default: 0 },
  attendanceError: { type: String, default: '' },
  
  // Email notification status
  emailNotificationStatus: {
    attempted: { type: Number, default: 0 },
    successful: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    allSent: { type: Boolean, default: false },
    failedStudents: [{
      name: String,
      email: String,
      error: String
    }],
    lastAttempt: Date
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
meetingLinkSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('MeetingLink', meetingLinkSchema);
