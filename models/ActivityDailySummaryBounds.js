const mongoose = require('mongoose');

/**
 * Tracks which calendar dayKey span has been warmed for activity-daily-summaries cache
 * (per IANA timezone + batch). Fast path is allowed when the request lies inside this span.
 */
const ActivityDailySummaryBoundsSchema = new mongoose.Schema(
    {
        timeZone: { type: String, required: true },
        batchKey: { type: String, required: true },
        schemaVersion: { type: Number, required: true },
        minDayKey: { type: String, required: true },
        maxDayKey: { type: String, required: true },
        updatedAt: { type: Date, default: Date.now }
    },
    { collection: 'activity_daily_summary_bounds' }
);

ActivityDailySummaryBoundsSchema.index({ timeZone: 1, batchKey: 1 }, { unique: true });

module.exports = mongoose.model('ActivityDailySummaryBounds', ActivityDailySummaryBoundsSchema);
