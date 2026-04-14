// services/recordingProcessor.js
// Pipeline: Zoom download → FFmpeg compression → Cloudflare R2 upload

const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { PassThrough } = require('stream');
const { Upload } = require('@aws-sdk/lib-storage');
const { r2Client, R2_BUCKET } = require('../config/r2');
const zoomService = require('./zoomService');
const MeetingLink = require('../models/MeetingLink');
const ZoomRecording = require('../models/ZoomRecording');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Build the R2 object key for a recording.
 * Format: {meetingLinkId}/{ISO-timestamp}.mp4
 * Using a timestamp (not just date) so multiple recordings of the
 * same class (e.g. re-recorded sessions) don't overwrite each other.
 */
function buildR2Key(meetingLinkId, recordingStartTime) {
  const ts = recordingStartTime
    ? new Date(recordingStartTime).toISOString().replace(/[:.]/g, '-')
    : new Date().toISOString().replace(/[:.]/g, '-');
  return `${meetingLinkId}/${ts}.mp4`;
}

/**
 * Download a Zoom recording URL as a readable stream.
 * Zoom often 302-redirects to CDN/storage. Axios (and browsers) typically strip
 * Authorization on cross-host redirects → 401 on the final hop.
 * We follow redirects manually and re-attach access_token on every URL.
 */
async function createZoomDownloadStream(downloadUrl, accessToken) {
  // Only inject auth onto URLs on the same origin as the initial Zoom download URL.
  // After Zoom redirects to a CDN/storage host (e.g. ssrweb.zoom.us), the URL is
  // already signed — adding access_token or a Bearer header to it causes a 403.
  const zoomOrigin = new URL(downloadUrl).origin;

  const withToken = (absoluteUrl) => {
    const u = new URL(absoluteUrl);
    if (u.origin !== zoomOrigin) return absoluteUrl; // CDN URL — leave as-is
    u.searchParams.set('access_token', accessToken);
    return u.toString();
  };

  const isZoomOrigin = (urlStr) => {
    try { return new URL(urlStr).origin === zoomOrigin; } catch { return false; }
  };

  /**
   * Read a small snippet of a response stream for diagnostics.
   * Only used for non-200 responses where we destroy the stream anyway.
   * @param {import('stream').Readable} stream
   * @param {number} maxBytes
   */
  async function readStreamSnippet(stream, maxBytes = 4096) {
    if (!stream || typeof stream.on !== 'function') return null;

    return await new Promise((resolve) => {
      let chunks = [];
      let total = 0;
      let done = false;

      const cleanup = () => {
        stream.off('data', onData);
        stream.off('end', onEnd);
        stream.off('error', onError);
      };

      const finish = (val) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(val);
      };

      const onError = () => finish(null);
      const onEnd = () => {
        try {
          finish(Buffer.concat(chunks, total).toString('utf8'));
        } catch {
          finish(null);
        }
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
          try {
            finish(Buffer.concat(chunks, total).toString('utf8'));
          } catch {
            finish(null);
          }
        }
      };

      stream.on('data', onData);
      stream.once('end', onEnd);
      stream.once('error', onError);
    });
  }

  /**
   * @param {string} urlStr
   * @param {{ authHeader: boolean }} opts
   */
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
    const safeHopUrl = `${hopUrl.origin}${hopUrl.pathname}`; // avoid logging query token
    const onZoomOrigin = isZoomOrigin(current);

    console.log(
      `⬇️  Zoom download hop ${hop + 1}: GET ${safeHopUrl}` +
        (onZoomOrigin ? ' (authHeader=on, zoom-origin)' : ' (authHeader=off, cdn-redirect)')
    );
    let response = await getStream(current, { authHeader: onZoomOrigin });

    // Some Zoom API edges reject Bearer even on the first hop; query token alone works.
    if (response.status === 401 && onZoomOrigin) {
      console.warn(`⚠️  Zoom download hop ${hop + 1}: HTTP 401 with Authorization header; retrying without header`);
      response.data?.destroy?.();
      console.log(`⬇️  Zoom download hop ${hop + 1}: GET ${safeHopUrl} (authHeader=off, 401-retry)`);
      response = await getStream(current, { authHeader: false });
    }

    if (response.status === 200) {
      console.log(`✅ Zoom download hop ${hop + 1}: HTTP 200 stream opened`);
      return response.data;
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const loc = response.headers.location;
      response.data?.destroy?.();
      if (!loc) {
        throw new Error('Zoom download redirect missing Location header');
      }
      try {
        const next = new URL(loc, current);
        console.log(
          `➡️  Zoom download hop ${hop + 1}: HTTP ${response.status} redirect to ${next.origin}${next.pathname}`
        );
      } catch {
        console.log(`➡️  Zoom download hop ${hop + 1}: HTTP ${response.status} redirect`);
      }
      current = withToken(new URL(loc, current).href);
      continue;
    }

    // Error response: capture small body snippet (Zoom often returns JSON error payloads)
    const trackingId =
      response.headers?.['x-zm-trackingid'] ||
      response.headers?.['x-zm-tracking-id'] ||
      response.headers?.['x-zm-trackingid'] ||
      null;
    const requestId =
      response.headers?.['x-request-id'] ||
      response.headers?.['x-amzn-requestid'] ||
      response.headers?.['cf-ray'] ||
      null;

    const snippet = await readStreamSnippet(response.data, 4096);
    response.data?.destroy?.();
    const extraHint =
      response.status === 401
        ? ' (check cloud recording scopes + that S2S app is on the same account as the meeting host)'
        : response.status === 403
          ? ' (403 is often caused by missing recording permission / not the same account as host / or an expired & signed download URL)'
          : '';

    console.error(
      `❌ Zoom download failed at hop ${hop + 1}: HTTP ${response.status}${extraHint}` +
        (trackingId ? ` | zm-trackingid=${trackingId}` : '') +
        (requestId ? ` | request=${requestId}` : '') +
        (snippet ? ` | body_snippet=${JSON.stringify(snippet)}` : '')
    );

    throw new Error(`Zoom download failed: HTTP ${response.status}`);
  }

  throw new Error('Zoom download: too many redirects');
}

/**
 * Compress a readable video stream via FFmpeg and return a readable output stream.
 * Settings: H.264, CRF 28, 720p max, AAC audio — good balance of size vs quality.
 */
function compressVideoStream(inputStream) {
  const outputStream = new PassThrough();
  let completed = false;

  outputStream.once('finish', () => { completed = true; });
  outputStream.once('close', () => { completed = true; });

  ffmpeg(inputStream)
    .inputFormat('mp4')
    .videoCodec('libx264')
    .audioCodec('aac')
    .outputOptions([
      '-crf 28',
      '-preset fast',
      '-vf scale=\'min(1280,iw)\':-2', // cap at 720p width
      '-movflags frag_keyframe+empty_moov', // enables streaming output
      '-f mp4',
    ])
    .on('error', (err) => {
      const msg = String(err?.message || err);
      // fluent-ffmpeg can emit "Output stream closed" after the consumer has
      // already finished reading the stream. That is not actionable and should
      // not be treated as a pipeline failure.
      if (msg.toLowerCase().includes('output stream closed')) {
        // In our pipeline this is benign (upload continues / completes). Treat as non-fatal.
        console.warn(`⚠️  FFmpeg notice (ignored): ${msg}`);
        return;
      }

      console.error('FFmpeg compression error:', msg);
      outputStream.destroy(err);
    })
    .pipe(outputStream, { end: true });

  return outputStream;
}

/**
 * Upload a readable stream to Cloudflare R2 using multipart upload.
 * Uses @aws-sdk/lib-storage which handles chunking automatically.
 */
async function uploadStreamToR2(readableStream, r2Key) {
  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: readableStream,
      ContentType: 'video/mp4',
    },
    queueSize: 4,    // parallel upload parts
    partSize: 10 * 1024 * 1024, // 10 MB parts
  });

  upload.on('httpUploadProgress', (progress) => {
    if (progress.loaded && progress.total) {
      const pct = Math.round((progress.loaded / progress.total) * 100);
      console.log(`📤 R2 upload progress [${r2Key}]: ${pct}%`);
    }
  });

  await upload.done();
}

/**
 * Main entry point called by the webhook handler.
 *
 * @param {string} zoomMeetingId  - Numeric Zoom meeting ID from webhook payload
 * @param {string} downloadUrl    - Direct download URL from Zoom recording payload
 * @param {string} recordingStart - ISO start time of the recording (from Zoom payload)
 * @param {Object} options
 * @param {string} options.meetingLinkId - Optional explicit MeetingLink _id to avoid ambiguous matching
 */
async function processZoomRecording(zoomMeetingId, downloadUrl, recordingStart, options = {}) {
  console.log(`🎬 Starting recording pipeline for Zoom meeting ${zoomMeetingId}`);

  // 1. Match Zoom meeting ID to our internal MeetingLink
  const meetingLink = options.meetingLinkId
    ? await MeetingLink.findById(options.meetingLinkId)
    : await MeetingLink.findOne({ zoomMeetingId: String(zoomMeetingId) });
  if (!meetingLink) {
    console.warn(`⚠️  No MeetingLink found for Zoom meeting ID ${zoomMeetingId} — skipping.`);
    return { success: false, error: 'No MeetingLink found for provided zoomMeetingId' };
  }

  const meetingLinkId = meetingLink._id.toString();
  const r2Key = buildR2Key(meetingLinkId, recordingStart);
  console.log(`🧩 Recording context: meetingLinkId=${meetingLinkId} r2Key=${r2Key}`);

  // 2. Create the ZoomRecording document in "processing" state
  let zoomRecordingDoc = await ZoomRecording.findOne({ meetingLinkId });
  if (zoomRecordingDoc) {
    // Re-processing an existing recording (e.g. retry after failure)
    zoomRecordingDoc.status = 'processing';
    zoomRecordingDoc.errorMessage = null;
    zoomRecordingDoc.r2Key = r2Key;
    zoomRecordingDoc.zoomDownloadUrl = downloadUrl;
    zoomRecordingDoc.zoomMeetingId = String(zoomMeetingId);
  } else {
    zoomRecordingDoc = new ZoomRecording({
      meetingLinkId,
      zoomMeetingId: String(zoomMeetingId),
      r2Key,
      zoomDownloadUrl: downloadUrl,
      status: 'processing',
    });
  }
  await zoomRecordingDoc.save();

  try {
    // 3. Get Zoom access token (re-uses the existing token cache in zoomService)
    const accessToken = await zoomService.getAccessToken();

    // 4. Open Zoom download stream
    try {
      const u = new URL(downloadUrl);
      console.log(`⬇️  Downloading from Zoom: ${u.origin}${u.pathname}`);
    } catch {
      console.log(`⬇️  Downloading from Zoom: ${downloadUrl}`);
    }
    const downloadStream = await createZoomDownloadStream(downloadUrl, accessToken);

    // 5. Compress via FFmpeg
    console.log(`🗜️  Compressing via FFmpeg → key: ${r2Key}`);
    const compressedStream = compressVideoStream(downloadStream);

    // 6. Stream-upload to R2
    console.log(`☁️  Uploading to R2 bucket "${R2_BUCKET}"`);
    await uploadStreamToR2(compressedStream, r2Key);

    // 7. Mark as ready
    zoomRecordingDoc.status = 'ready';
    zoomRecordingDoc.duration = meetingLink.duration ? meetingLink.duration * 60 : null;
    await zoomRecordingDoc.save();

    console.log(`✅ Recording ready: ${r2Key}`);
    return { success: true, r2Key, meetingLinkId };
  } catch (err) {
    console.error(`❌ Recording pipeline failed for meeting ${zoomMeetingId}:`, err.message);
    zoomRecordingDoc.status = 'failed';
    zoomRecordingDoc.errorMessage = err.message;
    await zoomRecordingDoc.save();
    return { success: false, error: err.message, meetingLinkId };
  }
}

module.exports = { processZoomRecording };
