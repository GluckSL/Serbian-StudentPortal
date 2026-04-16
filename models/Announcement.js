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

const announcementSchema = new mongoose.Schema(
  {
    channel: {
      type: String,
      enum: ['website', 'whatsapp'],
      default: 'website',
      index: true
    },
    deliveryType: {
      type: String,
      enum: ['website', 'website_email'],
      default: 'website'
    },
    targetBatches: {
      type: [String],
      required: true,
      validate: {
        validator: (batches) => Array.isArray(batches) && batches.length > 0,
        message: 'At least one batch is required'
      }
    },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    attachments: { type: [attachmentSchema], default: [] },
    emailSubject: { type: String, default: '', trim: true, maxlength: 200 },
    emailBody: { type: String, default: '', trim: true, maxlength: 5000 },
    emailDispatch: {
      totalRecipients: { type: Number, default: 0 },
      sentCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 },
      sentAt: { type: Date, default: null }
    },
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

announcementSchema.index({ targetBatches: 1, createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
