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

function normalizeZoomMeetingId(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseMeetingIdsInput(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[\s,]+/);

  const unique = new Set();
  for (const part of parts) {
    const trimmed = String(part || '').trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

function buildLooseZoomMeetingIdRegex(zoomMeetingId) {
  const digits = normalizeZoomMeetingId(zoomMeetingId);
  if (digits.length < 8) return null;
  return new RegExp(`^\\D*${digits.split('').join('\\D*')}\\D*$`);
}

function buildMeetingIdFilterClauses(meetingIds) {
  const clauses = [];
  for (const id of meetingIds) {
    const raw = String(id || '').trim();
    if (!raw) continue;
    clauses.push({ zoomMeetingId: raw });

    const digits = normalizeZoomMeetingId(raw);
    if (digits && digits !== raw) {
      clauses.push({ zoomMeetingId: digits });
    }

    const looseRegex = buildLooseZoomMeetingIdRegex(raw);
    if (looseRegex) {
      clauses.push({ zoomMeetingId: { $regex: looseRegex } });
    }
  }
  return clauses;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run async work with a fixed concurrency limit (e.g. parallel Zoom API calls
 * without tripping rate limits).
 */
async function asyncPool(poolLimit, items, iterator) {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(poolLimit, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) break;
      results[i] = await iterator(items[i], i);
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);
  return results;
}

function isRetryableZoomError(err) {
  const status = err?.response?.status;
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || '').toLowerCase();
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) return true;
  return (
    msg.includes('client network socket disconnected before secure tls connection was established') ||
    msg.includes('socket hang up') ||
    msg.includes('timeout')
  );
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

async function fetchMeetingRecordingsFromZoomWithRetry(meetingLink, accessToken, maxAttempts = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchMeetingRecordingsFromZoom(meetingLink, accessToken);
    } catch (err) {
      lastErr = err;
      if (!isRetryableZoomError(err) || attempt === maxAttempts) break;
      const delayMs = Math.min(5000, 700 * Math.pow(2, attempt - 1));
      console.warn(
        `⚠️  Zoom recordings fetch retry ${attempt}/${maxAttempts} for meetingLinkId=${meetingLink._id} ` +
        `zoomId=${meetingLink.zoomMeetingId} after ${delayMs}ms: ${err.message}`
      );
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

async function backfillZoomRecordings({
  batch = null,
  limit = 100,
  includeFailed = true,
  force = false,
  meetingIds = [],
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
  const parsedMeetingIds = parseMeetingIdsInput(meetingIds);
  backfillState.params = { batch, limit, includeFailed, force, meetingIds: parsedMeetingIds };

  const parsedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const query = {
    zoomMeetingId: { $exists: true, $ne: '' },
    status: { $in: ['ended', 'started', 'scheduled'] },
  };

  if (batch) query.batch = String(batch);
  if (parsedMeetingIds.length) {
    const clauses = buildMeetingIdFilterClauses(parsedMeetingIds);
    if (!clauses.length) {
      throw new Error('meetingIds was provided but no valid IDs were found.');
    }
    query.$or = clauses;
  }

  console.log(
    `🔄 Backfill started — batch=${batch || 'all'} limit=${parsedLimit} includeFailed=${includeFailed} force=${force}` +
    ` meetingIds=${parsedMeetingIds.length ? parsedMeetingIds.join(',') : 'all'}`
  );

  try {
    const meetingLinks = await MeetingLink.find(query)
      .select('_id batch topic zoomMeetingId zoomMeetingUuid status startTime duration')
      .sort({ startTime: -1, createdAt: -1 })
      .limit(parsedLimit)
      .lean();

    const summary = {
      considered: meetingLinks.length,
      queued: 0,
      pipelineCompleted: 0,
      pipelineFailed: 0,
      skippedAlreadyReady: 0,
      skippedProcessing: 0,
      skippedFailed: 0,
      skippedNoRecordingInZoom: 0,
      errors: 0,
      details: [],
    };
    const pipelineQueue = [];

    if (!meetingLinks.length) {
      console.log('ℹ️  Backfill: no matching MeetingLinks found — nothing to do');
      backfillState.running = false;
      backfillState.completedAt = new Date().toISOString();
      backfillState.summary = summary;
      return summary;
    }

    console.log(`📋 Backfill: ${meetingLinks.length} MeetingLinks to scan`);

    const accessToken = await zoomService.getAccessToken();

    const meetingObjectIds = meetingLinks.map((m) => m._id);
    const existingRecordings = await ZoomRecording.find({ meetingLinkId: { $in: meetingObjectIds } }).lean();
    const recordingsByLinkId = new Map();
    existingRecordings.forEach((rec) => {
      recordingsByLinkId.set(String(rec.meetingLinkId), rec);
    });

    const scanConcurrency = Math.max(
      1,
      Math.min(Number(process.env.BACKFILL_ZOOM_SCAN_CONCURRENCY) || 5, 30)
    );

    console.log(
      `🔎 Backfill Zoom scan: concurrency=${scanConcurrency} ` +
      `(default 5; raise BACKFILL_ZOOM_SCAN_CONCURRENCY up to ~10 if Zoom rate limits allow)`
    );

    const scanOne = async (meeting) => {
      try {
        const existing = recordingsByLinkId.get(String(meeting._id));

        if (existing && !force) {
          if (existing.status === 'ready') return { kind: 'skip_ready' };
          if (existing.status === 'processing') return { kind: 'skip_processing' };
          if (existing.status === 'failed' && !includeFailed) return { kind: 'skip_failed' };
        }

        const zoomData = await fetchMeetingRecordingsFromZoomWithRetry(meeting, accessToken);
        const targetFile = pickBestMp4(zoomData?.recording_files || []);

        if (!targetFile?.download_url) {
          console.log(
            `⏭️  Backfill: no MP4 in Zoom for meetingLinkId=${meeting._id} (zoomId=${meeting.zoomMeetingId})`
          );
          return { kind: 'skip_no_mp4' };
        }

        const recordingStart = targetFile.recording_start || zoomData?.start_time || meeting.startTime;

        console.log(
          `➕ Backfill queuing pipeline: meetingLinkId=${meeting._id} ` +
          `zoomId=${meeting.zoomMeetingId} batch="${meeting.batch}" type=${targetFile.recording_type}`
        );

        return {
          kind: 'queued',
          pipelineItem: {
            meetingLinkId: meeting._id,
            zoomMeetingId: String(meeting.zoomMeetingId),
            downloadUrl: targetFile.download_url,
            recordingStart,
            batch: meeting.batch,
            topic: meeting.topic,
          },
          detail: {
            meetingLinkId: meeting._id,
            batch: meeting.batch,
            topic: meeting.topic,
            zoomMeetingId: meeting.zoomMeetingId,
            queued: true,
          },
        };
      } catch (err) {
        const reason = err.response?.data?.message || err.message;
        console.error(
          `❌ Backfill scan error for meetingLinkId=${meeting._id} zoomId=${meeting.zoomMeetingId}: ${reason}`
        );
        return {
          kind: 'error',
          detail: {
            meetingLinkId: meeting._id,
            batch: meeting.batch,
            topic: meeting.topic,
            zoomMeetingId: meeting.zoomMeetingId,
            queued: false,
            error: reason,
          },
        };
      }
    };

    const scanResults = await asyncPool(scanConcurrency, meetingLinks, scanOne);

    for (const r of scanResults) {
      switch (r.kind) {
        case 'skip_ready':
          summary.skippedAlreadyReady += 1;
          break;
        case 'skip_processing':
          summary.skippedProcessing += 1;
          break;
        case 'skip_failed':
          summary.skippedFailed += 1;
          break;
        case 'skip_no_mp4':
          summary.skippedNoRecordingInZoom += 1;
          break;
        case 'queued':
          summary.queued += 1;
          pipelineQueue.push(r.pipelineItem);
          summary.details.push(r.detail);
          break;
        case 'error':
          summary.errors += 1;
          summary.details.push(r.detail);
          break;
        default:
          break;
      }
    }

    const pipelineConcurrency = Math.max(1, Number(process.env.RECORDING_PROCESS_CONCURRENCY) || 1);
    if (pipelineQueue.length) {
      console.log(
        `🚚 Backfill pipeline: ${pipelineQueue.length} job(s) — all queued; ` +
        `FFmpeg parallelism=${pipelineConcurrency} (set RECORDING_PROCESS_CONCURRENCY, default 1)`
      );
    }

    const pipelineResults = await Promise.all(
      pipelineQueue.map((item, idx) =>
        processZoomRecording(item.zoomMeetingId, item.downloadUrl, item.recordingStart, {
          meetingLinkId: item.meetingLinkId.toString(),
        })
          .then((result) => {
            console.log(
              `🎬 Backfill pipeline done ${idx + 1}/${pipelineQueue.length}: ` +
              `meetingLinkId=${item.meetingLinkId} zoomId=${item.zoomMeetingId} ` +
              `${result?.success ? 'OK' : 'FAIL'}`
            );
            return { item, result };
          })
          .catch((err) => {
            console.error(`❌ Backfill pipeline error for meetingLinkId=${item.meetingLinkId}:`, err.message);
            return { item, result: { success: false, error: err.message } };
          })
      )
    );

    for (const { item, result } of pipelineResults) {
      if (result?.success) {
        summary.pipelineCompleted += 1;
      } else {
        summary.pipelineFailed += 1;
        console.error(
          `❌ Backfill pipeline failed for meetingLinkId=${item.meetingLinkId}: ${result?.error || 'unknown'}`
        );
      }
    }

    console.log(
      `✅ Backfill scan complete: considered=${summary.considered} queued=${summary.queued} ` +
      `skippedReady=${summary.skippedAlreadyReady} skippedProcessing=${summary.skippedProcessing} ` +
      `skippedFailed=${summary.skippedFailed} noRecording=${summary.skippedNoRecordingInZoom} errors=${summary.errors} ` +
      `pipelineCompleted=${summary.pipelineCompleted} pipelineFailed=${summary.pipelineFailed}`
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
