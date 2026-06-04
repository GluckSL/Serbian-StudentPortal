const mongoose = require('mongoose');

const jobOpeningSchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true, maxlength: 120 },
    companyLogoUrl: { type: String, default: '', trim: true },
    jobTitle: { type: String, required: true, trim: true, maxlength: 200 },
    jobType: {
      type: String,
      enum: ['Full Time', 'Part Time', 'Internship', 'Contract'],
      default: 'Full Time',
      index: true
    },
    experience: { type: String, default: '', trim: true, maxlength: 80 },
    jobCategory: { type: String, default: '', trim: true, maxlength: 80, index: true },
    /** Minimum student journey day (currentCourseDay) to apply; null = no restriction */
    minJourneyDay: { type: Number, default: null, min: 1, max: 200 },
    locationType: {
      type: String,
      enum: ['Onsite', 'Remote', 'Hybrid'],
      default: 'Onsite',
      index: true
    },
    location: { type: String, default: '', trim: true, maxlength: 120 },
    salary: { type: String, default: '', trim: true, maxlength: 120 },
    skills: { type: [String], default: [] },
    description: { type: String, default: '', trim: true, maxlength: 50000 },
    applyBefore: { type: Date, required: true, index: true },
    isPublished: { type: Boolean, default: true, index: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    }
  },
  { timestamps: true }
);

jobOpeningSchema.index({ isPublished: 1, isActive: 1, applyBefore: -1, createdAt: -1 });

module.exports = mongoose.model('JobOpening', jobOpeningSchema);
