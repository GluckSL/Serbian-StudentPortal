// routes/zoomWebhook.js
// Handles Zoom webhook events for recording.completed
// Registered with express.raw() so we can verify the HMAC signature

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { processZoomRecording } = require('../services/recordingProcessor');
const ZoomWebhookAudit = require('../models/ZoomWebhookAudit');

const ZOOM_WEBHOOK_SECRET_TOKEN = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;

async function createAudit(data) {
  try {
    return await ZoomWebhookAudit.create(data);
  } catch (err) {
    console.error('Failed to write ZoomWebhookAudit:', err.message);
    return null;
  }
}

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
  const rawBody = req.body?.toString?.('utf8') || '';
  let parsedUnsafe = null;
  try {
    parsedUnsafe = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    // ignore parse failure here; handled below for valid signatures
  }

  // Always log first — proves the request reached THIS server (prod vs local).
  console.log(
    `📥 Zoom webhook POST received (${parsedUnsafe?.event || 'unparsed'}) body=${Buffer.byteLength(rawBody, 'utf8')}b from ${req.ip}`
  );

  void createAudit({
    eventType: parsedUnsafe?.event || 'unparsed',
    meetingId: parsedUnsafe?.payload?.object?.id
      ? String(parsedUnsafe.payload.object.id)
      : null,
    status: 'received_raw',
    sourceIp: req.ip,
    headers: {
      signaturePresent: Boolean(req.headers['x-zm-signature']),
      timestampPresent: Boolean(req.headers['x-zm-request-timestamp']),
    },
    payloadSummary: {
      bodyBytes: Buffer.byteLength(rawBody, 'utf8'),
    },
  });

  // --- Signature verification ---
  if (!ZOOM_WEBHOOK_SECRET_TOKEN) {
    console.error('ZOOM_WEBHOOK_SECRET_TOKEN is not set — rejecting webhook');
    createAudit({
      eventType: parsedUnsafe?.event || 'unknown',
      meetingId: parsedUnsafe?.payload?.object?.id ? String(parsedUnsafe.payload.object.id) : null,
      status: 'config_error',
      errorMessage: 'ZOOM_WEBHOOK_SECRET_TOKEN is not set',
      sourceIp: req.ip,
      headers: {
        signature: req.headers['x-zm-signature'] || null,
        timestamp: req.headers['x-zm-request-timestamp'] || null,
      },
    });
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!verifyZoomSignature(req)) {
    console.warn('⚠️  Zoom webhook signature verification failed');
    createAudit({
      eventType: parsedUnsafe?.event || 'unknown',
      meetingId: parsedUnsafe?.payload?.object?.id ? String(parsedUnsafe.payload.object.id) : null,
      status: 'invalid_signature',
      errorMessage: 'Invalid signature',
      sourceIp: req.ip,
      headers: {
        signature: req.headers['x-zm-signature'] || null,
        timestamp: req.headers['x-zm-request-timestamp'] || null,
      },
    });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse body now that signature is verified
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    createAudit({
      eventType: parsedUnsafe?.event || 'unknown',
      meetingId: parsedUnsafe?.payload?.object?.id ? String(parsedUnsafe.payload.object.id) : null,
      status: 'invalid_json',
      errorMessage: 'Invalid JSON body',
      sourceIp: req.ip,
    });
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

    createAudit({
      eventType: event,
      meetingId: null,
      status: 'challenge_validated',
      sourceIp: req.ip,
      payloadSummary: { plainTokenPresent: Boolean(plainToken) },
    });

    return res.status(200).json({ plainToken, encryptedToken });
  }

  // --- Recording completed ---
  if (event === 'recording.completed') {
    const obj = payload.payload?.object;

    if (!obj) {
      void createAudit({
        eventType: event,
        meetingId: null,
        status: 'missing_payload_object',
        errorMessage: 'recording.completed missing payload.object',
        sourceIp: req.ip,
      });
      return res.status(400).json({ error: 'Missing payload.object' });
    }

    const zoomMeetingId = obj.id;                  // Zoom numeric meeting ID
    const recordingFiles = obj.recording_files;    // Array of recording file objects
    const meetingId = obj.id ? String(obj.id) : null;

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
      createAudit({
        eventType: event,
        meetingId,
        meetingUuid: obj.uuid || null,
        status: 'missing_mp4',
        recordingFilesCount: Array.isArray(recordingFiles) ? recordingFiles.length : 0,
        hasDownloadUrl: false,
        sourceIp: req.ip,
        payloadSummary: {
          topic: obj.topic || null,
          recordingStatus: obj.recording_status || null,
        },
      });
      return;
    }

    const downloadUrl = targetFile.download_url;
    const recordingStart = targetFile.recording_start || obj.start_time;

    console.log(`📩 Zoom webhook: recording.completed — meeting ${zoomMeetingId}`);
    console.log(`   File type: ${targetFile.recording_type}, size: ${targetFile.file_size} bytes`);

    createAudit({
      eventType: event,
      meetingId,
      meetingUuid: obj.uuid || null,
      status: 'queued',
      recordingFilesCount: Array.isArray(recordingFiles) ? recordingFiles.length : 0,
      selectedRecordingType: targetFile.recording_type || null,
      hasDownloadUrl: Boolean(downloadUrl),
      sourceIp: req.ip,
      payloadSummary: {
        topic: obj.topic || null,
        recordingStatus: obj.recording_status || null,
        fileSize: targetFile.file_size || null,
      },
    }).then((auditDoc) => {
      // Fire-and-forget: process asynchronously so we don't block Zoom
      processZoomRecording(zoomMeetingId, downloadUrl, recordingStart).then((result) => {
        if (!auditDoc) return;
        auditDoc.status = result?.success ? 'processed' : 'failed';
        auditDoc.errorMessage = result?.success ? null : (result?.error || 'Unknown processing failure');
        auditDoc.save().catch(() => {});
      }).catch((err) => {
        if (!auditDoc) return;
        auditDoc.status = 'failed';
        auditDoc.errorMessage = err.message;
        auditDoc.save().catch(() => {});
      });
    });

    return;
  }

  // All other events — acknowledge but ignore
  createAudit({
    eventType: event || 'unknown',
    meetingId: payload?.payload?.object?.id ? String(payload.payload.object.id) : null,
    meetingUuid: payload?.payload?.object?.uuid || null,
    status: 'ignored',
    sourceIp: req.ip,
  });
  res.status(200).json({ message: 'Event ignored' });
});

module.exports = router;
