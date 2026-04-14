const axios = require('axios');
const zoomService = require('./zoomService');
const zoomConfig = require('../config/zoomConfig');
const MeetingLink = require('../models/MeetingLink');
const ZoomRecording = require('../models/ZoomRecording');
const { processZoomRecording } = require('./recordingProcessor');

/**
 * In-memory state for the most recent backfill run.
 * Keeps the last result accessible via getBackfillStatus() so admins can
 * poll without re-triggering the job.
 */
const backfillState = {
  running: false,
  startedAt: null,
  completedAt: null,
  params: null,
  summary: null,
  error: null,
};

function getBackfillStatus() {
  return { ...backfillState };
}

function pickBestMp4(recordingFiles = []) {
  const preferredTypes = [
    'shared_screen_with_speaker_view',
    'shared_screen_with_gallery_view',
    'active_speaker',
    'gallery_view',
  ];

  for (const type of preferredTypes) {
    const file = recordingFiles.find(
      (f) => f.file_type === 'MP4' && f.recording_type === type && f.status === 'completed'
    );
    if (file) return file;
  }

  return recordingFiles.find(
    (f) => f.file_type === 'MP4' && f.status === 'completed'
  ) || null;
}

function encodeUuidForZoom(uuid) {
  // Zoom requires double-encoding for UUID values containing slash characters.
  return encodeURIComponent(encodeURIComponent(uuid));
}

async function fetchMeetingRecordingsFromZoom(meetingLink, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const meetingId = String(meetingLink.zoomMeetingId || '').trim();

  if (!meetingId) return null;

  // Try standard endpoint by meeting ID first.
  try {
    const response = await axios.get(
      `${zoomConfig.apiBaseUrl}/meetings/${meetingId}/recordings`,
      { headers }
    );
    return response.data;
  } catch (err) {
    if (err.response?.status !== 404) throw err;
  }

  // Fallback to past_meetings/{uuid}/recordings for ended/occurrence meetings.
  if (meetingLink.zoomMeetingUuid) {
    const encodedUuid = encodeUuidForZoom(meetingLink.zoomMeetingUuid);
    try {
      const response = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${encodedUuid}/recordings`,
        { headers }
      );
      return response.data;
    } catch (err) {
      if (err.response?.status !== 404) throw err;
    }
  }

  return null;
}

async function backfillZoomRecordings({
  batch = null,
  limit = 100,
  includeFailed = true,
  force = false,
} = {}) {
  if (backfillState.running) {
    console.warn('⚠️  Backfill already running — ignoring duplicate request');
    throw new Error('A backfill is already in progress. Poll /zoom/backfill/status for updates.');
  }

  backfillState.running = true;
  backfillState.startedAt = new Date().toISOString();
  backfillState.completedAt = null;
  backfillState.error = null;
  backfillState.summary = null;
  backfillState.params = { batch, limit, includeFailed, force };

  const parsedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const query = {
    zoomMeetingId: { $exists: true, $ne: '' },
    status: { $in: ['ended', 'started', 'scheduled'] },
  };

  if (batch) query.batch = String(batch);

  console.log(`🔄 Backfill started — batch=${batch || 'all'} limit=${parsedLimit} includeFailed=${includeFailed} force=${force}`);

  try {
    const meetingLinks = await MeetingLink.find(query)
      .select('_id batch topic zoomMeetingId zoomMeetingUuid status startTime duration')
      .sort({ startTime: -1, createdAt: -1 })
      .limit(parsedLimit)
      .lean();

    const summary = {
      considered: meetingLinks.length,
      queued: 0,
      skippedAlreadyReady: 0,
      skippedProcessing: 0,
      skippedFailed: 0,
      skippedNoRecordingInZoom: 0,
      errors: 0,
      details: [],
    };

    if (!meetingLinks.length) {
      console.log('ℹ️  Backfill: no matching MeetingLinks found — nothing to do');
      backfillState.running = false;
      backfillState.completedAt = new Date().toISOString();
      backfillState.summary = summary;
      return summary;
    }

    console.log(`📋 Backfill: ${meetingLinks.length} MeetingLinks to scan`);

    const accessToken = await zoomService.getAccessToken();

    for (let i = 0; i < meetingLinks.length; i += 1) {
      const meeting = meetingLinks[i];

      if (i > 0 && i % 10 === 0) {
        console.log(
          `🔄 Backfill progress: ${i}/${meetingLinks.length} scanned | ` +
          `queued=${summary.queued} skippedReady=${summary.skippedAlreadyReady} ` +
          `noRecording=${summary.skippedNoRecordingInZoom} errors=${summary.errors}`
        );
      }

      try {
        const existing = await ZoomRecording.findOne({ meetingLinkId: meeting._id }).lean();

        if (existing && !force) {
          if (existing.status === 'ready') {
            summary.skippedAlreadyReady += 1;
            continue;
          }
          if (existing.status === 'processing') {
            summary.skippedProcessing += 1;
            continue;
          }
          if (existing.status === 'failed' && !includeFailed) {
            summary.skippedFailed += 1;
            continue;
          }
        }

        const zoomData = await fetchMeetingRecordingsFromZoom(meeting, accessToken);
        const targetFile = pickBestMp4(zoomData?.recording_files || []);

        if (!targetFile?.download_url) {
          summary.skippedNoRecordingInZoom += 1;
          console.log(`⏭️  Backfill: no MP4 in Zoom for meetingLinkId=${meeting._id} (zoomId=${meeting.zoomMeetingId})`);
          continue;
        }

        const recordingStart = targetFile.recording_start || zoomData?.start_time || meeting.startTime;

        console.log(
          `➕ Backfill queuing pipeline: meetingLinkId=${meeting._id} ` +
          `zoomId=${meeting.zoomMeetingId} batch="${meeting.batch}" type=${targetFile.recording_type}`
        );

        processZoomRecording(
          String(meeting.zoomMeetingId),
          targetFile.download_url,
          recordingStart,
          { meetingLinkId: meeting._id.toString() }
        ).catch((err) => {
          console.error(`❌ Backfill pipeline error for meetingLinkId=${meeting._id}:`, err.message);
        });

        summary.queued += 1;
        summary.details.push({
          meetingLinkId: meeting._id,
          batch: meeting.batch,
          topic: meeting.topic,
          zoomMeetingId: meeting.zoomMeetingId,
          queued: true,
        });
      } catch (err) {
        summary.errors += 1;
        const reason = err.response?.data?.message || err.message;
        console.error(
          `❌ Backfill scan error for meetingLinkId=${meeting._id} zoomId=${meeting.zoomMeetingId}: ${reason}`
        );
        summary.details.push({
          meetingLinkId: meeting._id,
          batch: meeting.batch,
          topic: meeting.topic,
          zoomMeetingId: meeting.zoomMeetingId,
          queued: false,
          error: reason,
        });
      }
    }

    console.log(
      `✅ Backfill scan complete: considered=${summary.considered} queued=${summary.queued} ` +
      `skippedReady=${summary.skippedAlreadyReady} skippedProcessing=${summary.skippedProcessing} ` +
      `skippedFailed=${summary.skippedFailed} noRecording=${summary.skippedNoRecordingInZoom} errors=${summary.errors}`
    );

    backfillState.summary = summary;
    backfillState.completedAt = new Date().toISOString();
    return summary;
  } catch (err) {
    backfillState.error = err.message;
    console.error('❌ Backfill scan aborted with fatal error:', err.message);
    throw err;
  } finally {
    backfillState.running = false;
  }
}

module.exports = { backfillZoomRecordings, getBackfillStatus };
