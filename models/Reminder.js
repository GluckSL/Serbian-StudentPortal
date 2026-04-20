const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true, trim: true },
    mimeType: { type: String, default: '' },
    fileSize: { type: Number, default: 0 }
  },
  { _id: false }
);

const recipientSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    messageBody: { type: String, default: '' },
    status: {
      type: String,
      enum: ['queued', 'in_progress', 'sent', 'failed'],
      default: 'queued',
      index: true
    },
    scheduledFor: { type: Date, default: null, index: true },
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'MeetingLink', default: null },
    meetingTopic: { type: String, default: '' },
    meetingStartTime: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    error: { type: String, default: '' },
    isTestAccount: { type: Boolean, default: false }
  },
  { _id: true, timestamps: false }
);

const reminderSchema = new mongoose.Schema(
  {
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReminderTemplate',
      default: null
    },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    attachments: { type: [attachmentSchema], default: [] },
    targetBatch: { type: String, required: true, trim: true, index: true },
    deliveryMode: {
      type: String,
      enum: ['instant', 'scheduled'],
      default: 'instant',
      index: true
    },
    scheduleScope: {
      type: String,
      enum: ['one', 'all', 'multi'],
      default: 'one'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    scheduledFor: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: ['queued', 'scheduled', 'in_progress', 'completed', 'failed'],
      default: 'queued',
      index: true
    },
    totalRecipients: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    pendingCount: { type: Number, default: 0 },
    recipients: { type: [recipientSchema], default: [] }
  },
  { timestamps: true }
);

reminderSchema.index({ targetBatch: 1, createdAt: -1 });

module.exports = mongoose.model('Reminder', reminderSchema);
