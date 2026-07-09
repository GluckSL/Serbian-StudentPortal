// models/PortalJoinAlertReview.js — supporter review of portal-join-but-absent cases

const mongoose = require('mongoose');

const portalJoinAlertReviewSchema = new mongoose.Schema(
  {
    meetingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MeetingLink',
      required: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['viewed', 'fixed'],
      required: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reviewedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

portalJoinAlertReviewSchema.index({ meetingId: 1, studentId: 1 }, { unique: true });
portalJoinAlertReviewSchema.index({ status: 1, reviewedAt: -1 });

module.exports = mongoose.model('PortalJoinAlertReview', portalJoinAlertReviewSchema);
