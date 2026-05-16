// services/recordingProcessor.js
// Pipeline: Zoom download → FFmpeg → HLS segments → Cloudflare R2 upload

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { Upload } = require('@aws-sdk/lib-storage');
const { r2Client, R2_BUCKET } = require('../config/r2');
const zoomService = require('./zoomService');
const MeetingLink = require('../models/MeetingLink');
const ZoomRecording = require('../models/ZoomRecording');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Configurable working directory for temp Zoom download and HLS segment files.
 * Falls back to os.tmpdir() if unset or if the provided path cannot be created.
 * Example: RECORDING_WORK_DIR=/mnt/recordings-tmp
 */
const RECORDING_WORK_DIR = (() => {
  const d = String(process.env.RECORDING_WORK_DIR || '').trim();
  if (d) {
    try {
      fs.mkdirSync(d, { recursive: true });
      return d;
    } catch (e) {
      console.warn(`⚠️  RECORDING_WORK_DIR="${d}" not usable (${e.message}) — falling back to os.tmpdir()`);
    }
  }
  return os.tmpdir();
})();

const ALLOWED_FFMPEG_PRESETS = new Set([
  'ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow',
]);

function effectiveFfmpegPreset() {
  const p = String(process.env.RECORDING_FFMPEG_PRESET || 'superfast').trim().toLowerCase();
  return ALLOWED_FFMPEG_PRESETS.has(p) ? p : 'superfast';
}

function effectiveFfmpegCrf() {
  const n = Number(process.env.RECORDING_FFMPEG_CRF);
  if (Number.isFinite(n) && n >= 18 && n <= 35) return String(Math.round(n));
  return '28';
}

const RECORDING_R2_UPLOAD_CONCURRENCY = Math.max(
  1,
  Math.min(Number(process.env.RECORDING_R2_UPLOAD_CONCURRENCY) || 8, 25)
);

/**
 * Minimum free bytes on the work volume before starting download + encode.
 * Default 3 GiB. Set RECORDING_MIN_TMP_FREE_BYTES=0 to disable the check entirely.
 */
const MIN_TMP_FREE_BYTES = (() => {
  const raw = process.env.RECORDING_MIN_TMP_FREE_BYTES;
  if (raw === '0') return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  return 3 * 1024 ** 3;
})();

const RECORDING_PIPELINE_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(Number(process.env.RECORDING_PIPELINE_MAX_ATTEMPTS) || 2, 5)
);

const FFMPEG_PROGRESS_LOG_MS = Math.max(
  5000,
  Math.min(Number(process.env.RECORDING_FFMPEG_PROGRESS_LOG_MS) || 15000, 600000)
);

/** Max width after scale filter (default 1280). Use 854 or 640 on very low-RAM hosts. */
function effectiveMaxEncodeWidth() {
  const n = Number(process.env.RECORDING_MAX_ENCODE_WIDTH);
  if (Number.isFinite(n) && n >= 426 && n <= 1920) return Math.round(n);
  return 1280;
}

/**
 * Caps FFmpeg thread count (decoder + encoder). Omit env to let FFmpeg auto-select.
 */
function effectiveFfmpegThreads() {
  const raw = process.env.RECORDING_FFMPEG_THREADS;
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(16, Math.round(n));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort free space on RECORDING_WORK_DIR volume (null if unavailable). */
function getTmpFreeBytes() {
  try {
    const { statfsSync } = require('fs');
    if (typeof statfsSync !== 'function') return null;
    const s = statfsSync(RECORDING_WORK_DIR);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** Free RAM in bytes (os.freemem). */
function getFreeRamBytes() {
  return os.freemem();
}

/**
 * Remove leftover zoom-src-* and hls-* temp entries in RECORDING_WORK_DIR
 * that are older than maxAgeMs (default 4 h).
 * Called at module startup, before each pipeline run, and on a 2 h interval.
 */
function sweepOrphanedTempFiles(maxAgeMs = 4 * 60 * 60 * 1000) {
  try {
    const entries = fs.readdirSync(RECORDING_WORK_DIR);
    const now = Date.now();
    let swept = 0;
    for (const entry of entries) {
      if (!entry.startsWith('zoom-src-') && !entry.startsWith('hls-')) continue;
      const full = path.join(RECORDING_WORK_DIR, entry);
      try {
        const stat = fs.statSync(full);
        const ageMs = now - stat.mtimeMs;
        if (ageMs < maxAgeMs) continue;
        if (stat.isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
        } else {
          fs.unlinkSync(full);
        }
        console.log(`🧹 Swept orphaned temp (age=${Math.round(ageMs / 3600000)}h): ${entry}`);
        swept += 1;
      } catch (e) {
        console.warn(`⚠️  Could not sweep orphan "${entry}": ${e.message}`);
      }
    }
    if (swept > 0) {
      console.log(`🧹 Orphan sweep: removed ${swept} stale temp file(s) from ${RECORDING_WORK_DIR}`);
    }
  } catch (e) {
    console.warn(`⚠️  Orphan temp sweep failed: ${e.message}`);
  }
}

function isRetryablePipelineError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('enospc') || m.includes('no space left')) return false;
  if (m.includes('zoom download too small')) return false;
  if (m.includes('not a valid mp4')) return false;
  if (m.includes('temp filesystem low on space')) return false;
  if (m.includes('likely oom')) return false;
  if (m.includes('cannot allocate memory')) return false;
  if (m.includes('401') && m.includes('zoom')) return false;
  if (m.includes('403')) return false;
  return (
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('econnaborted') ||
    m.includes('socket hang') ||
    m.includes('timeout') ||
    m.includes('ffmpeg exited') ||
    m.includes('zoom download failed: http 5') ||
    m.includes('eai_again') ||
    m.includes('enotfound')
  );
}

/** If stderr / message suggests OOM or SIGKILL, append a short hint for operators. */
function hintIfLikelyOom(message, stderrLines) {
  const blob = `${String(message || '')} ${(stderrLines || []).join(' ')}`.toLowerCase();
  if (
    blob.includes('cannot allocate memory') ||
    blob.includes('killed') ||
    blob.includes('signal 9') ||
    blob.includes('out of memory') ||
    /exited with code 137/.test(blob)
  ) {
    return (
      ' Likely OOM: host RAM too small for this transcode. Use a ≥2GiB instance, or set ' +
      'RECORDING_MAX_ENCODE_WIDTH=854 RECORDING_FFMPEG_PRESET=ultrafast RECORDING_FFMPEG_THREADS=1.'
    );
  }
  return '';
}

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

async function createZoomDownloadStream(downloadUrl, accessToken, options = {}) {
  const zoomOrigin = new URL(downloadUrl).origin;
  const downloadToken = String(options.downloadToken || '').trim();

  const withToken = (absoluteUrl) => {
    const u = new URL(absoluteUrl);
    if (u.origin !== zoomOrigin) return absoluteUrl;
    // For recording.completed webhooks, Zoom provides a short-lived download token.
    // This token is required for passcode-protected cloud recordings.
    u.searchParams.set('access_token', downloadToken || accessToken);
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
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
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
 * Encoding choices (tuned via env for speed vs quality):
 *   - H.264 CRF (RECORDING_FFMPEG_CRF, default 28), preset (RECORDING_FFMPEG_PRESET, default veryfast)
 *   - Scale ≤ RECORDING_MAX_ENCODE_WIDTH (default 1280)
 *   - AAC 128 kbps stereo
 *   - 2-second segments, independent_segments for hls.js seeking
 *
 * @param {NodeJS.ReadableStream|string} input  - Video stream or path to a local MP4/MOV file
 * @param {string}                meetingLinkId
 * @returns {Promise<string[]>}  List of local file paths [playlist.m3u8, seg000.ts, …]
 */
async function convertToHLS(input, meetingLinkId) {
  const tmpDir = path.join(RECORDING_WORK_DIR, `hls-${meetingLinkId}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const playlistPath  = path.join(tmpDir, 'playlist.m3u8');
  const segmentPattern = path.join(tmpDir, 'seg%03d.ts');

  const fromFile = typeof input === 'string';
  const preset = effectiveFfmpegPreset();
  const crf = effectiveFfmpegCrf();
  const maxW = effectiveMaxEncodeWidth();
  const threads = effectiveFfmpegThreads();
  console.log(
    `🎬 FFmpeg HLS conversion started → ${tmpDir}${fromFile ? ' (from disk)' : ' (from stream)'} ` +
    `[preset=${preset}, crf=${crf}, maxWidth=${maxW}${threads != null ? `, threads=${threads}` : ''}]`
  );

  await new Promise((resolve, reject) => {
    const stderrLines = [];
    const cmd = ffmpeg(input);
    if (fromFile) {
      cmd.inputOptions(['-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err']);
    } else {
      cmd.inputFormat('mp4');
    }
    let lastProgressLog = 0;
    const outOpts = [
      '-crf', crf,
      '-preset', preset,
      `-vf scale='min(${maxW},iw)':-2`,
      '-b:a', '128k',
      '-hls_time', '2',
      '-hls_list_size', '0',
      '-hls_flags', 'independent_segments',
      '-hls_segment_type', 'mpegts',
      `-hls_segment_filename ${segmentPattern}`,
      '-f', 'hls',
    ];
    if (threads != null) {
      outOpts.unshift('-threads', String(threads));
    }
    cmd
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(outOpts)
      .output(playlistPath)
      .on('stderr', (line) => {
        const s = String(line || '').trim();
        if (!s || s.startsWith('frame=') || s.startsWith('size=')) return;
        stderrLines.push(s);
        if (stderrLines.length > 48) stderrLines.shift();
      })
      .on('progress', (p) => {
        if (!p.timemark) return;
        const now = Date.now();
        if (now - lastProgressLog < FFMPEG_PROGRESS_LOG_MS) return;
        lastProgressLog = now;
        console.log(`  ⏱  FFmpeg progress: ${p.timemark}`);
      })
      .on('end', resolve)
      .on('error', (err) => {
        const msg = String(err?.message || err);
        if (msg.toLowerCase().includes('output stream closed')) {
          console.warn(`⚠️  FFmpeg notice (non-fatal): ${msg}`);
          resolve();
          return;
        }
        const tail = stderrLines.length
          ? ` | ffmpeg: ${stderrLines.slice(-6).join(' | ')}`
          : '';
        reject(new Error(msg + tail + hintIfLikelyOom(msg, stderrLines)));
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

  // Upload segments first (parallel, bounded concurrency)
  const CONCURRENCY = RECORDING_R2_UPLOAD_CONCURRENCY;
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
 *   7. finally: unlink temp MP4 + rm HLS dir if they still exist (avoids ENOSPC)
 *   Retries: transient network/FFmpeg errors retry up to RECORDING_PIPELINE_MAX_ATTEMPTS (default 2).
 *
 * @param {string} zoomMeetingId
 * @param {string} downloadUrl
 * @param {string} recordingStart  ISO timestamp from Zoom webhook
 * @param {Object} options
 * @param {string} [options.meetingLinkId]
 * @param {string} [options.meetingUuid]
 * @param {string} [options.downloadToken]
 */
async function runZoomRecordingPipeline(zoomMeetingId, downloadUrl, recordingStart, options = {}) {
  console.log(`🎬 Starting HLS pipeline for Zoom meeting ${zoomMeetingId}`);

  const totalMem = os.totalmem();
  const freeMemAtStart = getFreeRamBytes();
  if (totalMem < 1.75 * 1024 ** 3) {
    console.warn(
      `⚠️  Host has ~${Math.round(totalMem / (1024 ** 2))} MiB total RAM — long HLS transcodes often fail (OOM). ` +
        'Prefer ≥2GiB, or set RECORDING_MAX_ENCODE_WIDTH=854 RECORDING_FFMPEG_PRESET=ultrafast RECORDING_FFMPEG_THREADS=1.'
    );
  } else if (freeMemAtStart < 256 * 1024 * 1024) {
    console.warn(
      `⚠️  Low free RAM: ${Math.round(freeMemAtStart / (1024 ** 2))} MiB — FFmpeg may OOM. ` +
        'Consider RECORDING_FFMPEG_PRESET=ultrafast RECORDING_FFMPEG_THREADS=1 RECORDING_MAX_ENCODE_WIDTH=854'
    );
  }

  // 1. Resolve MeetingLink
  const meetingLink = await resolveMeetingLink(zoomMeetingId, options);

  if (!meetingLink) {
    console.warn(`⚠️  No MeetingLink for Zoom meeting ${zoomMeetingId} — skipping.`);
    return { success: false, error: 'No MeetingLink found for provided zoomMeetingId' };
  }

  const meetingLinkId = meetingLink._id.toString();
  const hlsPrefix = buildHlsPrefix(meetingLinkId);
  console.log(`🧩 meetingLinkId=${meetingLinkId}  hlsPrefix=${hlsPrefix}`);

  // Reclaim any leftover temp files from crashed/cancelled prior runs before we start.
  sweepOrphanedTempFiles();

  const preFreeDisk = getTmpFreeBytes();
  console.log(
    `💾 Resources before HLS pipeline [${meetingLinkId}]: ` +
    `disk=${preFreeDisk != null ? (preFreeDisk / (1024 ** 3)).toFixed(2) + ' GiB' : 'unknown'} free on ${RECORDING_WORK_DIR}, ` +
    `RAM=${Math.round(freeMemAtStart / (1024 ** 2))} MiB free / ${Math.round(totalMem / (1024 ** 2))} MiB total`
  );

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

  let lastError = null;

  for (let attempt = 1; attempt <= RECORDING_PIPELINE_MAX_ATTEMPTS; attempt += 1) {
    let tempMp4 = null;
    let hlsDir = null;
    try {
      const free = getTmpFreeBytes();
      if (MIN_TMP_FREE_BYTES > 0 && free != null && free < MIN_TMP_FREE_BYTES) {
        throw new Error(
          `Temp filesystem low on space: ${(free / (1024 ** 3)).toFixed(2)} GiB free on ${RECORDING_WORK_DIR} ` +
          `(need ≥${(MIN_TMP_FREE_BYTES / (1024 ** 3)).toFixed(2)} GiB). ` +
          'Free disk, set RECORDING_WORK_DIR to a larger volume, or set RECORDING_MIN_TMP_FREE_BYTES=0 to skip this check.'
        );
      }

      const accessToken = await zoomService.getAccessToken();

      try {
        const u = new URL(downloadUrl);
        console.log(`⬇️  Zoom download: ${u.origin}${u.pathname}`);
      } catch {
        console.log(`⬇️  Zoom download: ${downloadUrl}`);
      }

      const downloadStream = await createZoomDownloadStream(downloadUrl, accessToken, {
        downloadToken: options.downloadToken,
      });
      tempMp4 = path.join(RECORDING_WORK_DIR, `zoom-src-${meetingLinkId}-${Date.now()}.mp4`);
      {
        let dlBytes = 0;
        let dlLastLog = Date.now();
        const DL_LOG_MS = 30_000;
        const dlProgress = new Transform({
          transform(chunk, _enc, cb) {
            dlBytes += chunk.length;
            const now = Date.now();
            if (now - dlLastLog >= DL_LOG_MS) {
              dlLastLog = now;
              console.log(`  ⬇️  Downloading: ${(dlBytes / (1024 ** 2)).toFixed(1)} MiB received`);
            }
            cb(null, chunk);
          },
        });
        await pipeline(downloadStream, dlProgress, fs.createWriteStream(tempMp4));
        console.log(`  ⬇️  Download complete: ${(dlBytes / (1024 ** 2)).toFixed(1)} MiB total`);
      }

      const st = fs.statSync(tempMp4);
      if (st.size < 2048) {
        throw new Error(`Zoom download too small (${st.size} bytes) — likely an error response, not a recording`);
      }
      console.log(`📁 Zoom download size: ${(st.size / (1024 ** 2)).toFixed(1)} MiB → ${tempMp4}`);

      const head = Buffer.alloc(4096);
      const fh = fs.openSync(tempMp4, 'r');
      const readLen = fs.readSync(fh, head, 0, head.length, 0);
      fs.closeSync(fh);
      const probe = head.subarray(0, readLen);
      if (!bufferLooksLikeIsoBmff(probe)) {
        const text = probe.toString('utf8').replace(/\s+/g, ' ').slice(0, 200);
        throw new Error(`Zoom download is not a valid MP4 (size=${st.size}b, head=${JSON.stringify(text)})`);
      }

      const result = await convertToHLS(tempMp4, meetingLinkId);
      hlsDir = result.tmpDir;
      const files = result.files;

      const hlsKey = await uploadHlsToR2(hlsDir, files, hlsPrefix);

      zoomRecordingDoc.status = 'ready';
      zoomRecordingDoc.hlsKey = hlsKey;
      zoomRecordingDoc.r2Key = null;
      zoomRecordingDoc.errorMessage = null;
      zoomRecordingDoc.duration = meetingLink.duration ? meetingLink.duration * 60 : null;
      await zoomRecordingDoc.save();

      console.log(`✅ HLS recording ready: ${hlsKey}`);
      return { success: true, hlsKey, meetingLinkId };
    } catch (err) {
      lastError = err;
      console.error(
        `❌ HLS pipeline failed for meeting ${zoomMeetingId} ` +
        `(attempt ${attempt}/${RECORDING_PIPELINE_MAX_ATTEMPTS}):`,
        err.message
      );
      const willRetry = attempt < RECORDING_PIPELINE_MAX_ATTEMPTS && isRetryablePipelineError(err);
      if (willRetry) {
        zoomRecordingDoc.status = 'processing';
        zoomRecordingDoc.errorMessage = `will retry: ${err.message}`;
        await zoomRecordingDoc.save();
        console.warn(
          `🔁 Recording pipeline retry ${attempt + 1}/${RECORDING_PIPELINE_MAX_ATTEMPTS} ` +
          `after ${Math.round(1500 * attempt)}ms…`
        );
        await sleep(1500 * attempt);
      } else {
        zoomRecordingDoc.status = 'failed';
        zoomRecordingDoc.errorMessage = err.message;
        await zoomRecordingDoc.save();
        return { success: false, error: err.message, meetingLinkId };
      }
    } finally {
      if (tempMp4 && fs.existsSync(tempMp4)) {
        try {
          fs.unlinkSync(tempMp4);
          console.log(`🧹 Removed temp Zoom download: ${tempMp4}`);
        } catch (e) {
          console.warn(`⚠️  Could not unlink temp download ${tempMp4}: ${e.message}`);
        }
      }
      if (hlsDir && fs.existsSync(hlsDir)) {
        try {
          fs.rmSync(hlsDir, {
            recursive: true,
            force: true,
          });
          console.log(`🧹 Cleaned HLS temp dir: ${hlsDir}`);
        } catch (e) {
          console.warn(`⚠️  Could not remove HLS temp dir ${hlsDir}: ${e.message}`);
        }
      }
    }
  }

  const fallbackMsg = lastError?.message || 'Recording pipeline failed after retries';
  zoomRecordingDoc.status = 'failed';
  zoomRecordingDoc.errorMessage = fallbackMsg;
  await zoomRecordingDoc.save();
  return { success: false, error: fallbackMsg, meetingLinkId };
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
  let hlsDir = null;
  let durationSec = null;

  try {
    durationSec = await new Promise((resolve) => {
      ffmpeg.ffprobe(localFilePath, (err, metadata) => {
        if (err) return resolve(null);
        const d = Number(metadata?.format?.duration || 0);
        if (!Number.isFinite(d) || d <= 0) return resolve(null);
        resolve(Math.round(d));
      });
    });
    // Use the on-disk file as FFmpeg input (same as Zoom pipeline). Piping stdin from a
    // read stream is fragile on Windows and can appear "stuck" with sparse progress logs.
    const result = await convertToHLS(localFilePath, `manual-${recordingId}`);
    hlsDir = result.tmpDir;

    const hlsKey = await uploadHlsToR2(hlsDir, result.files, hlsPrefix);
    return { success: true, hlsKey, duration: durationSec };
  } catch (err) {
    return { success: false, error: err.message || 'Manual upload processing failed' };
  } finally {
    if (localFilePath && fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
      } catch (e) {
        console.warn(`⚠️  Could not unlink manual upload temp ${localFilePath}: ${e.message}`);
      }
    }
    if (hlsDir && fs.existsSync(hlsDir)) {
      try {
        fs.rmSync(hlsDir, {
          recursive: true,
          force: true,
        });
      } catch (e) {
        console.warn(`⚠️  Could not remove HLS temp dir ${hlsDir}: ${e.message}`);
      }
    }
  }
}

// ── Startup orphan sweep + periodic maintenance ───────────────────────────────
// Run once at boot so any temp files left by a previous crash are removed before
// the first job starts, then repeat every 2 hours to prevent ENOSPC accumulation.
sweepOrphanedTempFiles();
const _orphanSweepTimer = setInterval(() => sweepOrphanedTempFiles(), 2 * 60 * 60 * 1000);
if (typeof _orphanSweepTimer.unref === 'function') _orphanSweepTimer.unref();

module.exports = { processZoomRecording, processManualRecordingUpload };
