const mongoose = require('mongoose');

/**
 * Idempotency lock for the daily finance report emails.
 *
 * A unique compound index on { reportType, dateKey } guarantees that only ONE
 * send can ever be recorded per report type per IST day — even across multiple
 * server processes/instances sharing the same MongoDB. The process that wins
 * the atomic insert is the only one allowed to actually send the email; every
 * other firing (duplicate cron, restarted process, stale deploy) is skipped.
 */
const schema = new mongoose.Schema({
  /** 'morning' | 'evening' */
  reportType: { type: String, required: true },
  /** IST calendar day, formatted YYYY-MM-DD. */
  dateKey: { type: String, required: true },
  sentAt: { type: Date, default: Date.now },
});

schema.index({ reportType: 1, dateKey: 1 }, { unique: true });
// Auto-clean old lock rows; we only ever care about the current IST day.
schema.index({ sentAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

/**
 * Atomically claim the daily send. Returns true if this caller won the claim
 * (and should send the email), false if it was already claimed by someone else.
 */
schema.statics.claim = async function claim(reportType, dateKey) {
  try {
    await this.create({ reportType, dateKey });
    return true;
  } catch (err) {
    // Duplicate key => another process/firing already claimed today's send.
    if (err && err.code === 11000) return false;
    throw err;
  }
};

module.exports = mongoose.model('FinanceReportSendLog', schema, 'finance_report_send_log');
