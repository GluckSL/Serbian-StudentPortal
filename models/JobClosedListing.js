const mongoose = require('mongoose');

const jobClosedListingSchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    companyLogoUrl: { type: String, default: '', trim: true },
    jobTitle: { type: String, required: true, trim: true, maxlength: 200 },
    jobType: {
      type: String,
      enum: ['Full Time', 'Part Time', 'Internship', 'Contract'],
      default: 'Full Time'
    },
    experience: { type: String, default: '', trim: true, maxlength: 80 },
    location: { type: String, default: '', trim: true, maxlength: 120 },
    salary: { type: String, default: '', trim: true, maxlength: 120 },
    skills: { type: [String], default: [] },
    closedAt: { type: Date, required: true, index: true },
    note: { type: String, default: '', trim: true, maxlength: 500 },
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

jobClosedListingSchema.index({ isPublished: 1, closedAt: -1, sortOrder: -1 });

module.exports = mongoose.model('JobClosedListing', jobClosedListingSchema);
