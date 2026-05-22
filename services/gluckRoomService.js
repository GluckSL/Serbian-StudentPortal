const {
  RoomServiceClient,
  EgressClient,
  AccessToken,
  EncodedFileOutput,
  S3Upload,
  EncodingOptionsPreset,
  EncodedFileType
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

  async createRoomAndStartRecording(sessionId, hostId, videoSource = 'camera') {
    this._ensureClients();
    const room = await this.roomService.createRoom({
      name: sessionId,
      emptyTimeout: 300,
      maxParticipants: 100,
    });

    // Determine best video track for Egress:
    //   'screen_share' → use host identity (LiveKit follows host's active
    //                     video track — camera or screen share)
    //   'camera'       → use teacher-camera-{hostId} track name
    //   'none'         → omit videoTrackId (placeholder/canvas only)
    let videoTrackId;
    if (videoSource === 'screen_share') {
      videoTrackId = hostId;
    } else if (videoSource === 'camera') {
      videoTrackId = `teacher-camera-${hostId}`;
    }
    // videoSource === 'none' → videoTrackId stays undefined

    const egressOptions = { audioTrackId: 'room-audio-mix', encodingOptions: EncodingOptionsPreset.H264_720P_24 };
    if (videoTrackId) egressOptions.videoTrackId = videoTrackId;

    const fileOutput = new EncodedFileOutput({
      filepath: `gluckroom/${sessionId}/recording.mp4`,
      file_type: EncodedFileType.MP4,
      output: {
        case: 's3',
        value: new S3Upload({
          accessKey: R2_ACCESS_KEY,
          secret: R2_SECRET,
          bucket: R2_BUCKET,
          endpoint: R2_ENDPOINT,
          region: 'auto',
          forcePathStyle: true,
        }),
      },
    });

    const egress = await this.egressClient.startTrackCompositeEgress(
      sessionId,
      fileOutput,
      egressOptions
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
