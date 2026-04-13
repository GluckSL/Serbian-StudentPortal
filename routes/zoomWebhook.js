// routes/zoomWebhook.js
// Handles Zoom webhook events for recording.completed
// Registered with express.raw() so we can verify the HMAC signature

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { processZoomRecording } = require('../services/recordingProcessor');

const ZOOM_WEBHOOK_SECRET_TOKEN = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;

/**
 * Verify Zoom webhook signature.
 * Zoom sends: x-zm-request-timestamp + x-zm-signature
 * Expected format: v0={HMAC-SHA256(v0:{timestamp}:{rawBody})}
 */
function verifyZoomSignature(req) {
  const timestamp = req.headers['x-zm-request-timestamp'];
  const receivedSig = req.headers['x-zm-signature'];

  if (!timestamp || !receivedSig) return false;

  // Reject stale webhooks older than 5 minutes
  const fiveMinutes = 5 * 60 * 1000;
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > fiveMinutes) return false;

  const rawBody = req.body.toString('utf8');
  const message = `v0:${timestamp}:${rawBody}`;
  const expectedSig = `v0=${crypto
    .createHmac('sha256', ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(message)
    .digest('hex')}`;

  return crypto.timingSafeEqual(
    Buffer.from(expectedSig, 'utf8'),
    Buffer.from(receivedSig, 'utf8')
  );
}

/**
 * POST /api/zoom/webhook
 * Registered in app.js with express.raw({ type: '*\/*' }) before global express.json()
 */
router.post('/', (req, res) => {
  // --- Signature verification ---
  if (!ZOOM_WEBHOOK_SECRET_TOKEN) {
    console.error('ZOOM_WEBHOOK_SECRET_TOKEN is not set — rejecting webhook');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!verifyZoomSignature(req)) {
    console.warn('⚠️  Zoom webhook signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse body now that signature is verified
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { event } = payload;

  // --- Zoom URL validation challenge (required when first registering the webhook) ---
  if (event === 'endpoint.url_validation') {
    const plainToken = payload.payload?.plainToken;
    if (!plainToken) return res.status(400).json({ error: 'Missing plainToken' });

    const encryptedToken = crypto
      .createHmac('sha256', ZOOM_WEBHOOK_SECRET_TOKEN)
      .update(plainToken)
      .digest('hex');

    return res.status(200).json({ plainToken, encryptedToken });
  }

  // --- Recording completed ---
  if (event === 'recording.completed') {
    const obj = payload.payload?.object;

    if (!obj) {
      return res.status(400).json({ error: 'Missing payload.object' });
    }

    const zoomMeetingId = obj.id;                  // Zoom numeric meeting ID
    const recordingFiles = obj.recording_files;    // Array of recording file objects

    // Respond 200 immediately — Zoom requires a fast response
    res.status(200).json({ message: 'Received' });

    // Find the primary MP4 recording file (type: "shared_screen_with_speaker_view" or "active_speaker")
    // Fall back to any MP4 if the preferred type is not present
    const preferredTypes = [
      'shared_screen_with_speaker_view',
      'shared_screen_with_gallery_view',
      'active_speaker',
      'gallery_view',
    ];

    let targetFile = null;
    for (const type of preferredTypes) {
      targetFile = recordingFiles?.find(
        (f) => f.file_type === 'MP4' && f.recording_type === type && f.status === 'completed'
      );
      if (targetFile) break;
    }

    // Fallback: any completed MP4
    if (!targetFile) {
      targetFile = recordingFiles?.find(
        (f) => f.file_type === 'MP4' && f.status === 'completed'
      );
    }

    if (!targetFile) {
      console.warn(`⚠️  No completed MP4 file found in recording.completed for meeting ${zoomMeetingId}`);
      return;
    }

    const downloadUrl = targetFile.download_url;
    const recordingStart = targetFile.recording_start || obj.start_time;

    console.log(`📩 Zoom webhook: recording.completed — meeting ${zoomMeetingId}`);
    console.log(`   File type: ${targetFile.recording_type}, size: ${targetFile.file_size} bytes`);

    // Fire-and-forget: process asynchronously so we don't block Zoom
    processZoomRecording(zoomMeetingId, downloadUrl, recordingStart).catch((err) => {
      console.error(`❌ Unhandled error in processZoomRecording:`, err);
    });

    return;
  }

  // All other events — acknowledge but ignore
  res.status(200).json({ message: 'Event ignored' });
});

module.exports = router;
