const mongoose = require('mongoose');

/**
 * Cached per-day aggregates for Student Logs "All logs" (activity-daily-summaries).
 * Invalidated for "today" in the client timezone on each request; use ?refresh=1 to rebuild history.
 */
const ActivityDailySummarySchema = new mongoose.Schema(
    {
        dayKey: { type: String, required: true },
        timeZone: { type: String, required: true },
        batchKey: { type: String, required: true },
        schemaVersion: { type: Number, required: true },
        estPortalMinutes: { type: Number, default: 0 },
        mostUsedPage: { type: String, default: '—' },
        mostActiveStudent: { type: String, default: '—' },
        avgPortalPerStudent: { type: Number, default: 0 },
        eventCount: { type: Number, default: 0 },
        timelineEventCount: { type: Number, default: 0 },
        computedAt: { type: Date, default: Date.now }
    },
    { collection: 'activity_daily_summaries' }
);

ActivityDailySummarySchema.index({ dayKey: 1, timeZone: 1, batchKey: 1 }, { unique: true });

module.exports = mongoose.model('ActivityDailySummary', ActivityDailySummarySchema);
