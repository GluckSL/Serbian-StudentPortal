// services/recordingProcessor.js
// Pipeline: Zoom download → FFmpeg → HLS segments → Cloudflare R2 upload

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { Upload } = require('@aws-sdk/lib-storage');
const { r2Client, R2_BUCKET } = require('../config/r2');
const zoomService = require('./zoomService');
const MeetingLink = require('../models/MeetingLink');
const ZoomRecording = require('../models/ZoomRecording');

ffmpeg.setFfmpegPath(ffmpegPath);

// ── Key helpers ───────────────────────────────────────────────────────────────

/**
 * R2 prefix for all HLS files of one recording.
 * Structure: {meetingLinkId}/hls/playlist.m3u8
 *            {meetingLinkId}/hls/seg000.ts
 *            {meetingLinkId}/hls/seg001.ts  …
 */
function buildHlsPrefix(meetingLinkId) {
  return `${meetingLinkId}/hls`;
}

function normalizeZoomMeetingId(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildLooseZoomMeetingIdRegex(zoomMeetingId) {
  const digits = normalizeZoomMeetingId(zoomMeetingId);
  if (digits.length < 8) return null;
  return new RegExp(`^\\D*${digits.split('').join('\\D*')}\\D*$`);
}

/** Zoom webhooks and REST may send UUIDs with different URL-encoding layers. */
function zoomWebhookUuidCandidates(meetingUuid) {
  const u = String(meetingUuid || '').trim();
  if (!u) return [];
  const out = new Set([u]);
  try {
    let cur = u;
    for (let i = 0; i < 4; i += 1) {
      const dec = decodeURIComponent(cur);
      if (dec === cur) break;
      out.add(dec);
      cur = dec;
    }
  } catch {
    /* ignore */
  }
  try {
    out.add(encodeURIComponent(u));
    out.add(encodeURIComponent(encodeURIComponent(u)));
  } catch {
    /* ignore */
  }
  return [...out].filter(Boolean);
}

function bufferLooksLikeIsoBmff(buf) {
  if (!buf || buf.length < 12) return false;
  const n = Math.min(buf.length - 4, 48);
  for (let i = 0; i <= n; i += 1) {
    if (buf[i] === 0x66 && buf[i + 1] === 0x74 && buf[i + 2] === 0x79 && buf[i + 3] === 0x70) return true;
  }
  return false;
}

async function resolveMeetingLink(zoomMeetingId, options = {}) {
  if (options.meetingLinkId) {
    return MeetingLink.findById(options.meetingLinkId);
  }

  const rawZoomMeetingId = String(zoomMeetingId || '').trim();
  if (rawZoomMeetingId) {
    const exactMatch = await MeetingLink.findOne({ zoomMeetingId: rawZoomMeetingId });
    if (exactMatch) return exactMatch;
  }

  const digitsOnly = normalizeZoomMeetingId(rawZoomMeetingId);
  if (digitsOnly.length >= 8 && digitsOnly !== rawZoomMeetingId) {
    const digitMatch = await MeetingLink.findOne({ zoomMeetingId: digitsOnly });
    if (digitMatch) {
      console.log(`🧩 MeetingLink resolved by digits-only zoomMeetingId for ${zoomMeetingId}`);
      return digitMatch;
    }
  }

  const uuidCandidates = zoomWebhookUuidCandidates(options.meetingUuid);
  if (uuidCandidates.length) {
    const uuidMatch = await MeetingLink.findOne({ zoomMeetingUuid: { $in: uuidCandidates } });
    if (uuidMatch) {
      console.log(`🧩 MeetingLink resolved by zoomMeetingUuid for meeting ${zoomMeetingId}`);
      return uuidMatch;
    }
  }

  const looseRegex = buildLooseZoomMeetingIdRegex(rawZoomMeetingId);
  if (looseRegex) {
    const looseMatch = await MeetingLink.findOne({ zoomMeetingId: { $regex: looseRegex } });
    if (looseMatch) {
      console.log(`🧩 MeetingLink resolved by flexible zoomMeetingId match for ${zoomMeetingId}`);
      return looseMatch;
    }
  }

  return null;
}

// ── Zoom download ──────────────────────────────────────────────────────────────

async function createZoomDownloadStream(downloadUrl, accessToken) {
  const zoomOrigin = new URL(downloadUrl).origin;

  const withToken = (absoluteUrl) => {
    const u = new URL(absoluteUrl);
    if (u.origin !== zoomOrigin) return absoluteUrl;
    u.searchParams.set('access_token', accessToken);
    return u.toString();
  };

  const isZoomOrigin = (urlStr) => {
    try { return new URL(urlStr).origin === zoomOrigin; } catch { return false; }
  };

  async function readStreamSnippet(stream, maxBytes = 4096) {
    if (!stream || typeof stream.on !== 'function') return null;
    return new Promise((resolve) => {
      let chunks = [], total = 0, done = false;
      const cleanup = () => {
        stream.off('data', onData);
        stream.off('end', onEnd);
        stream.off('error', onError);
      };
      const finish = (val) => { if (done) return; done = true; cleanup(); resolve(val); };
      const onError = () => finish(null);
      const onEnd = () => {
        try { finish(Buffer.concat(chunks, total).toString('utf8')); } catch { finish(null); }
      };
      const onData = (chunk) => {
        if (done) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        const remaining = maxBytes - total;
        if (remaining <= 0) return;
        const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf;
        chunks.push(slice);
        total += slice.length;
        if (total >= maxBytes) {
          try { finish(Buffer.concat(chunks, total).toString('utf8')); } catch { finish(null); }
        }
      };
      stream.on('data', onData);
      stream.once('end', onEnd);
      stream.once('error', onError);
    });
  }

  async function getStream(urlStr, opts) {
    return axios.get(urlStr, {
      responseType: 'stream',
      maxRedirects: 0,
      validateStatus: () => true,
      headers: opts.authHeader ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  }

  let current = withToken(downloadUrl);

  for (let hop = 0; hop < 15; hop += 1) {
    const hopUrl = new URL(current);
    const safeHopUrl = `${hopUrl.origin}${hopUrl.pathname}`;
    const onZoomOrigin = isZoomOrigin(current);

    console.log(
      `⬇️  Zoom download hop ${hop + 1}: GET ${safeHopUrl}` +
      (onZoomOrigin ? ' (authHeader=on)' : ' (authHeader=off, cdn)')
    );
    let response = await getStream(current, { authHeader: onZoomOrigin });

    if (response.status === 401 && onZoomOrigin) {
      console.warn(`⚠️  Hop ${hop + 1}: HTTP 401 with header; retrying without`);
      response.data?.destroy?.();
      response = await getStream(current, { authHeader: false });

      if (response.status === 401) {
        const rawCurrentWithoutToken = (() => {
          try {
            const u = new URL(current);
            u.searchParams.delete('access_token');
            return u.toString();
          } catch {
            return current;
          }
        })();
        console.warn(`⚠️  Hop ${hop + 1}: HTTP 401 without header; retrying raw URL`);
        response.data?.destroy?.();
        response = await getStream(rawCurrentWithoutToken, { authHeader: false });
      }
    }

    if (response.status === 200) {
      console.log(`✅ Zoom download hop ${hop + 1}: HTTP 200 stream opened`);
      return response.data;
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const loc = response.headers.location;
      response.data?.destroy?.();
      if (!loc) throw new Error('Zoom download redirect missing Location header');
      current = withToken(new URL(loc, current).href);
      continue;
    }

    const trackingId = response.headers?.['x-zm-trackingid'] || null;
    const snippet = await readStreamSnippet(response.data, 4096);
    response.data?.destroy?.();
    throw new Error(
      `Zoom download failed: HTTP ${response.status}` +
      (trackingId ? ` | zm-trackingid=${trackingId}` : '') +
      (snippet ? ` | body=${JSON.stringify(snippet)}` : '')
    );
  }

  throw new Error('Zoom download: too many redirects');
}

// ── FFmpeg → HLS conversion ───────────────────────────────────────────────────

/**
 * Convert the Zoom input stream to HLS segments in a temp directory.
 *
 * Encoding choices:
 *   - H.264 CRF 28, preset fast  → good quality/size for class recordings
 *   - Scale ≤ 1280 wide (720p)   → sharp on most devices
 *   - AAC 128 kbps stereo        → clear voice audio
 *   - 2-second segments          → faster first-frame startup
 *   - independent_segments flag  → every .ts is independently decodable
 *     (lets hls.js seek to any segment without downloading prior ones)
 *
 * @param {NodeJS.ReadableStream|string} input  - Video stream or path to a local MP4/MOV file
 * @param {string}                meetingLinkId
 * @returns {Promise<string[]>}  List of local file paths [playlist.m3u8, seg000.ts, …]
 */
async function convertToHLS(input, meetingLinkId) {
  const tmpDir = path.join(os.tmpdir(), `hls-${meetingLinkId}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const playlistPath  = path.join(tmpDir, 'playlist.m3u8');
  const segmentPattern = path.join(tmpDir, 'seg%03d.ts');

  const fromFile = typeof input === 'string';
  console.log(`🎬 FFmpeg HLS conversion started → ${tmpDir}${fromFile ? ' (from disk)' : ' (from stream)'}`);

  await new Promise((resolve, reject) => {
    const cmd = ffmpeg(input);
    if (!fromFile) {
      cmd.inputFormat('mp4');
    }
    cmd
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-crf 28',
        '-preset fast',
        `-vf scale='min(1280,iw)':-2`,   // cap 720p, preserve aspect
        '-b:a 128k',
        '-hls_time 2',                    // 2-second segments
        '-hls_list_size 0',               // keep all segments in playlist
        '-hls_flags independent_segments',// each .ts independently decodable
        '-hls_segment_type mpegts',
        `-hls_segment_filename ${segmentPattern}`,
        '-f hls',
      ])
      .output(playlistPath)
      .on('progress', (p) => {
        if (p.timemark) console.log(`  ⏱  FFmpeg progress: ${p.timemark}`);
      })
      .on('end', resolve)
      .on('error', (err) => {
        const msg = String(err?.message || err);
        if (msg.toLowerCase().includes('output stream closed')) {
          console.warn(`⚠️  FFmpeg notice (non-fatal): ${msg}`);
          resolve();
          return;
        }
        reject(err);
      })
      .run();
  });

  const files = fs.readdirSync(tmpDir);
  console.log(`✅ FFmpeg produced ${files.length} HLS files (1 playlist + ${files.length - 1} segments)`);
  return { tmpDir, files };
}

// ── R2 upload ─────────────────────────────────────────────────────────────────

/**
 * Upload a single local file to R2. Uses multipart for large .ts segments.
 */
async function uploadFileToR2(localPath, r2Key, contentType) {
  const stream = fs.createReadStream(localPath);
  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: stream,
      ContentType: contentType,
    },
    queueSize: 2,
    partSize: 5 * 1024 * 1024, // 5 MB parts
  });
  await upload.done();
}

/**
 * Upload all HLS files from tmpDir to R2 under the given prefix.
 * Uploads segments in parallel (up to 5 concurrent) for speed.
 *
 * @returns {string} R2 key of the playlist file
 */
async function uploadHlsToR2(tmpDir, files, hlsPrefix) {
  console.log(`☁️  Uploading ${files.length} HLS files to R2 prefix "${hlsPrefix}"`);

  // Sort: upload playlist last so it only appears in R2 once all segments are ready.
  // (Prevents a brief window where the playlist references segments not yet uploaded.)
  const segments  = files.filter((f) => f.endsWith('.ts'));
  const playlists = files.filter((f) => f.endsWith('.m3u8'));

  // Upload segments first (parallel, 5 at a time)
  const CONCURRENCY = 5;
  for (let i = 0; i < segments.length; i += CONCURRENCY) {
    const batch = segments.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((seg) =>
      uploadFileToR2(
        path.join(tmpDir, seg),
        `${hlsPrefix}/${seg}`,
        'video/mp2t'
      )
    ));
    console.log(`  ✅ Segments uploaded: ${Math.min(i + CONCURRENCY, segments.length)}/${segments.length}`);
  }

  // Upload playlist after all segments
  for (const pl of playlists) {
    await uploadFileToR2(
      path.join(tmpDir, pl),
      `${hlsPrefix}/${pl}`,
      'application/vnd.apple.mpegurl'
    );
  }

  return `${hlsPrefix}/playlist.m3u8`;
}

// ── Main pipeline entry point ─────────────────────────────────────────────────

/**
 * Full pipeline:
 *   1. Match Zoom meeting ID → MeetingLink
 *   2. Mark ZoomRecording as processing
 *   3. Download from Zoom to a temp MP4 (avoids FFmpeg pipe/probe issues)
 *   4. FFmpeg → HLS segments in temp dir
 *   5. Upload all HLS files to R2
 *   6. Mark ZoomRecording as ready with hlsKey
 *   7. Clean up temp dir
 *
 * @param {string} zoomMeetingId
 * @param {string} downloadUrl
 * @param {string} recordingStart  ISO timestamp from Zoom webhook
 * @param {Object} options
 * @param {string} [options.meetingLinkId]
 * @param {string} [options.meetingUuid]
 */
async function runZoomRecordingPipeline(zoomMeetingId, downloadUrl, recordingStart, options = {}) {
  console.log(`🎬 Starting HLS pipeline for Zoom meeting ${zoomMeetingId}`);

  // 1. Resolve MeetingLink
  const meetingLink = await resolveMeetingLink(zoomMeetingId, options);

  if (!meetingLink) {
    console.warn(`⚠️  No MeetingLink for Zoom meeting ${zoomMeetingId} — skipping.`);
    return { success: false, error: 'No MeetingLink found for provided zoomMeetingId' };
  }

  const meetingLinkId = meetingLink._id.toString();
  const hlsPrefix = buildHlsPrefix(meetingLinkId);
  console.log(`🧩 meetingLinkId=${meetingLinkId}  hlsPrefix=${hlsPrefix}`);

  // 2. Upsert ZoomRecording as processing
  let zoomRecordingDoc = await ZoomRecording.findOne({ meetingLinkId });
  if (zoomRecordingDoc) {
    zoomRecordingDoc.status = 'processing';
    zoomRecordingDoc.errorMessage = null;
    zoomRecordingDoc.hlsKey = null;
    zoomRecordingDoc.r2Key = null;
    zoomRecordingDoc.zoomDownloadUrl = downloadUrl;
    zoomRecordingDoc.zoomMeetingId = String(zoomMeetingId);
  } else {
    zoomRecordingDoc = new ZoomRecording({
      meetingLinkId,
      zoomMeetingId: String(zoomMeetingId),
      zoomDownloadUrl: downloadUrl,
      status: 'processing',
    });
  }
  await zoomRecordingDoc.save();

  let tmpDir = null;
  let tmpMp4 = null;

  try {
    // 3. Zoom access token
    const accessToken = await zoomService.getAccessToken();

    // 4. Stream Zoom file to disk (FFmpeg on pipe often fails with "Invalid data" for cloud recordings)
    try {
      const u = new URL(downloadUrl);
      console.log(`⬇️  Zoom download: ${u.origin}${u.pathname}`);
    } catch { console.log(`⬇️  Zoom download: ${downloadUrl}`); }

    const downloadStream = await createZoomDownloadStream(downloadUrl, accessToken);
    tmpMp4 = path.join(os.tmpdir(), `zoom-src-${meetingLinkId}-${Date.now()}.mp4`);
    await pipeline(downloadStream, fs.createWriteStream(tmpMp4));

    const st = fs.statSync(tmpMp4);
    if (st.size < 2048) {
      throw new Error(`Zoom download too small (${st.size} bytes) — likely an error response, not a recording`);
    }

    const head = Buffer.alloc(4096);
    const fh = fs.openSync(tmpMp4, 'r');
    const readLen = fs.readSync(fh, head, 0, head.length, 0);
    fs.closeSync(fh);
    const probe = head.subarray(0, readLen);
    if (!bufferLooksLikeIsoBmff(probe)) {
      const text = probe.toString('utf8').replace(/\s+/g, ' ').slice(0, 200);
      throw new Error(`Zoom download is not a valid MP4 (size=${st.size}b, head=${JSON.stringify(text)})`);
    }

    // 5. FFmpeg → HLS temp files
    const result = await convertToHLS(tmpMp4, meetingLinkId);
    tmpDir = result.tmpDir;
    const files = result.files;

    // 6. Upload to R2
    const hlsKey = await uploadHlsToR2(tmpDir, files, hlsPrefix);

    // 7. Mark ready
    zoomRecordingDoc.status = 'ready';
    zoomRecordingDoc.hlsKey = hlsKey;
    zoomRecordingDoc.r2Key = null; // HLS-only; no separate MP4
    zoomRecordingDoc.duration = meetingLink.duration ? meetingLink.duration * 60 : null;
    await zoomRecordingDoc.save();

    console.log(`✅ HLS recording ready: ${hlsKey}`);
    return { success: true, hlsKey, meetingLinkId };

  } catch (err) {
    console.error(`❌ HLS pipeline failed for meeting ${zoomMeetingId}:`, err.message);
    zoomRecordingDoc.status = 'failed';
    zoomRecordingDoc.errorMessage = err.message;
    await zoomRecordingDoc.save();
    return { success: false, error: err.message, meetingLinkId };

  } finally {
    if (tmpMp4) {
      try {
        fs.rmSync(tmpMp4, { force: true });
        console.log(`🧹 Removed temp Zoom download: ${tmpMp4}`);
      } catch (e) {
        console.warn(`⚠️  Could not remove temp download ${tmpMp4}: ${e.message}`);
      }
    }
    // Always clean up temp dir
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log(`🧹 Cleaned temp dir: ${tmpDir}`);
      } catch (e) {
        console.warn(`⚠️  Could not remove temp dir ${tmpDir}: ${e.message}`);
      }
    }
  }
}

// ── Global processing queue ───────────────────────────────────────────────────
// Keep FFmpeg work bounded so cron/API work isn't starved by CPU-heavy jobs.
const PROCESS_CONCURRENCY = Math.max(1, Number(process.env.RECORDING_PROCESS_CONCURRENCY) || 1);
const pipelineQueue = [];
let activePipelines = 0;

function drainPipelineQueue() {
  while (activePipelines < PROCESS_CONCURRENCY && pipelineQueue.length > 0) {
    const job = pipelineQueue.shift();
    activePipelines += 1;
    console.log(`🧵 Recording queue: active=${activePipelines}/${PROCESS_CONCURRENCY}, waiting=${pipelineQueue.length}`);

    runZoomRecordingPipeline(job.zoomMeetingId, job.downloadUrl, job.recordingStart, job.options)
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => {
        activePipelines = Math.max(0, activePipelines - 1);
        drainPipelineQueue();
      });
  }
}

function processZoomRecording(zoomMeetingId, downloadUrl, recordingStart, options = {}) {
  return new Promise((resolve, reject) => {
    pipelineQueue.push({ zoomMeetingId, downloadUrl, recordingStart, options, resolve, reject });
    drainPipelineQueue();
  });
}

/**
 * Convert a locally uploaded MP4 into HLS and upload it to R2.
 * Returns the uploaded playlist key (e.g. manual/{recordingId}/hls/playlist.m3u8).
 */
async function processManualRecordingUpload(recordingId, localFilePath) {
  if (!recordingId) throw new Error('recordingId is required');
  if (!localFilePath) throw new Error('localFilePath is required');

  const hlsPrefix = `manual/${recordingId}/hls`;
  let tmpDir = null;

  try {
    const inputStream = fs.createReadStream(localFilePath);
    const result = await convertToHLS(inputStream, `manual-${recordingId}`);
    tmpDir = result.tmpDir;

    const hlsKey = await uploadHlsToR2(tmpDir, result.files, hlsPrefix);
    return { success: true, hlsKey };
  } catch (err) {
    return { success: false, error: err.message || 'Manual upload processing failed' };
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`⚠️  Could not remove temp dir ${tmpDir}: ${e.message}`);
      }
    }
    try {
      fs.rmSync(localFilePath, { force: true });
    } catch (e) {
      console.warn(`⚠️  Could not remove uploaded file ${localFilePath}: ${e.message}`);
    }
  }
}

module.exports = { processZoomRecording, processManualRecordingUpload };
