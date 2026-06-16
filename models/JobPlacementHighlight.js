const mongoose = require('mongoose');

const jobPlacementHighlightSchema = new mongoose.Schema(
  {
    studentName: { type: String, required: true, trim: true, maxlength: 120 },
    studentRegNo: { type: String, default: '', trim: true, maxlength: 40 },
    batch: { type: String, default: '', trim: true, maxlength: 40 },
    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    companyLogoUrl: { type: String, default: '', trim: true },
    jobTitle: { type: String, required: true, trim: true, maxlength: 200 },
    placedAt: { type: Date, required: true, index: true },
    packageLabel: { type: String, default: '', trim: true, maxlength: 80 },
    story: { type: String, default: '', trim: true, maxlength: 2000 },
    isPublished: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    }
  },
  { timestamps: true }
);

jobPlacementHighlightSchema.index({ isPublished: 1, placedAt: -1, sortOrder: -1 });

module.exports = mongoose.model('JobPlacementHighlight', jobPlacementHighlightSchema);
