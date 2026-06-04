const mongoose = require('mongoose');

const jobPortalSettingsSchema = new mongoose.Schema(
  {
    heroTitle: { type: String, default: 'Get Hired with Glück', trim: true, maxlength: 120 },
    heroSubtitle: {
      type: String,
      default:
        'Explore curated openings from partner organizations. Apply before the deadline and take the next step in your career.',
      trim: true,
      maxlength: 500
    },
    averagePackageLabel: { type: String, default: '6 LPA Average Package', trim: true, maxlength: 80 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('JobPortalSettings', jobPortalSettingsSchema);
