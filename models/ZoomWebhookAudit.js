const mongoose = require('mongoose');

const zoomWebhookAuditSchema = new mongoose.Schema(
  {
    eventType: { type: String, default: 'unknown' },
    meetingId: { type: String, default: null },
    meetingUuid: { type: String, default: null },
    status: {
      type: String,
      enum: [
        'received_raw',
        'received',
        'challenge_validated',
        'invalid_signature',
        'invalid_json',
        'missing_payload_object',
        'missing_mp4',
        'queued',
        'processed',
        'failed',
        'ignored',
        'config_error',
      ],
      default: 'received',
    },
    recordingFilesCount: { type: Number, default: 0 },
    selectedRecordingType: { type: String, default: null },
    hasDownloadUrl: { type: Boolean, default: false },
    errorMessage: { type: String, default: null },
    sourceIp: { type: String, default: null },
    headers: { type: mongoose.Schema.Types.Mixed, default: {} },
    payloadSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

zoomWebhookAuditSchema.index({ createdAt: -1 });
zoomWebhookAuditSchema.index({ eventType: 1, createdAt: -1 });
zoomWebhookAuditSchema.index({ status: 1, createdAt: -1 });
zoomWebhookAuditSchema.index({ meetingId: 1, createdAt: -1 });

module.exports = mongoose.model('ZoomWebhookAudit', zoomWebhookAuditSchema);
