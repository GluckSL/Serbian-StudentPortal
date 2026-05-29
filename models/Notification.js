// models/Notifications.js

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AssignmentSubmission',
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    type: {
      type: String,
      enum: ['ASSIGNMENT_SUBMITTED', 'ASSIGNMENT_ASSIGNED'],
      required: true,
    },

  },
  { timestamps: true }
);

notificationSchema.index({ recipientId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
