const { Readable } = require('stream');
const {
  RoomServiceClient,
  EgressClient,
  AccessToken,
} = require('livekit-server-sdk');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const R2_ENDPOINT = process.env.R2_ENDPOINT || `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME;

class GluckRoomService {
  _ensureClients() {
    if (!this.roomService) {
      this.roomService = new RoomServiceClient(
        process.env.LIVEKIT_URL,
        process.env.LIVEKIT_API_KEY,
        process.env.LIVEKIT_API_SECRET
      );
    }
    if (!this.egressClient) {
      this.egressClient = new EgressClient(
        process.env.LIVEKIT_URL,
        process.env.LIVEKIT_API_KEY,
        process.env.LIVEKIT_API_SECRET
      );
    }
    if (!this.s3) {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: R2_ENDPOINT,
        credentials: {
          accessKeyId: R2_ACCESS_KEY,
          secretAccessKey: R2_SECRET,
        },
      });
    }
  }

  async createRoomAndStartRecording(sessionId, hostId, videoSource = 'camera', layoutUrl) {
    this._ensureClients();
    const room = await this.roomService.createRoom({
      name: sessionId,
      emptyTimeout: 300,
      maxParticipants: 100,
    });

    const egress = await this.egressClient.startRoomCompositeEgress(
      sessionId,
      {
        segments: {
          filenamePrefix: `gluckroom/${sessionId}/hls/seg`,
          playlistName: 'playlist.m3u8',
          segmentDuration: 6,
          protocol: 1,
          filenameSuffix: 0,
          output: {
            case: 's3',
            value: {
              accessKey: R2_ACCESS_KEY,
              secret: R2_SECRET,
              bucket: R2_BUCKET,
              endpoint: R2_ENDPOINT,
              region: 'auto',
              forcePathStyle: true,
            },
          },
        },
      },
      {
        layout: layoutUrl || 'speaker',
        encodingOptions: {
          videoCodec: 2,
          width: 1280,
          height: 720,
          framerate: 30,
          videoBitrate: 5000,
          audioCodec: 2,
          audioBitrate: 128,
        },
      }
    );

    return {
      roomName: room.name,
      egressId: egress.egressId,
    };
  }

  async stopRecordingAndDeleteRoom(roomName, egressId) {
    this._ensureClients();
    try {
      await this.egressClient.stopEgress(egressId);
    } catch (err) {
      console.warn('Could not stop egress (already ended/failed):', err.message);
    }
    try {
      await this.roomService.deleteRoom(roomName);
    } catch (err) {
      console.warn('Could not delete room (already removed):', err.message);
    }
  }

  async generateToken(roomName, userId, userName, canPublish = false, canPublishSources = []) {
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: userId.toString(),
        name: userName,
      }
    );

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: canPublish,
      canSubscribe: true,
      canPublishData: true,
      ...(canPublishSources.length > 0 ? { canPublishSources } : {}),
    });

    return await token.toJwt();
  }

  async getRecordingUrl(r2Key) {
    this._ensureClients();
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
    });

    const url = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    return url;
  }

  async getSignedHlsPlaylist(hlsKey) {
    this._ensureClients();

    const obj = await this.s3.send(new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: hlsKey,
    }));
    const raw = await this._streamToString(obj.Body);

    const hlsDir = hlsKey.substring(0, hlsKey.lastIndexOf('/'));
    const lines = raw.split('\n');
    const signed = await Promise.all(
      lines.map(async (line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.endsWith('.ts')) {
          const segKey = `${hlsDir}/${trimmed}`;
          const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: segKey });
          return getSignedUrl(this.s3, cmd, { expiresIn: 3600 });
        }
        return line;
      })
    );

    return signed.join('\n');
  }

  _streamToString(body) {
    if (typeof body === 'string') return Promise.resolve(body);
    if (body instanceof Buffer) return Promise.resolve(body.toString('utf-8'));
    if (body instanceof Readable) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        body.on('data', (chunk) => chunks.push(chunk));
        body.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        body.on('error', reject);
      });
    }
    return Promise.resolve(String(body));
  }

  async getRoom(roomName) {
    this._ensureClients();
    return await this.roomService.getRoom(roomName);
  }

  async getParticipants(roomName) {
    this._ensureClients();
    return await this.roomService.listParticipants(roomName);
  }

  async removeParticipant(roomName, identity) {
    this._ensureClients();
    await this.roomService.removeParticipant(roomName, identity);
  }
}

module.exports = new GluckRoomService();
