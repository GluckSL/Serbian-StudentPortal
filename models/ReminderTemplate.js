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

const reminderTemplateSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 150 },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
      // Supports {{studentName}}, {{batch}}, {{classTime}}, {{classDate}}, {{topic}} placeholders
    },
    attachments: { type: [attachmentSchema], default: [] },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    isActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReminderTemplate', reminderTemplateSchema);
