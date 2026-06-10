const mongoose = require('mongoose');

/**
 * Tracks the last successful run date for each named cron job.
 * Used to detect and recover missed runs after server restarts.
 */
const cronJobLogSchema = new mongoose.Schema(
  {
    jobName: { type: String, required: true, unique: true, index: true },
    lastRunDate: { type: String, required: true },   // YYYY-MM-DD in job's timezone
    lastRunAt:  { type: Date,   required: true },
    runCount:   { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('CronJobLog', cronJobLogSchema);
