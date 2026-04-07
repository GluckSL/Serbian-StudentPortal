// services/zoomService.js

const axios = require('axios');
const zoomConfig = require('../config/zoomConfig');

function encodeZoomUuid(uuid) {
  // Zoom requires UUIDs to be URL-encoded; if UUID contains '/' it must be double-encoded.
  const once = encodeURIComponent(String(uuid));
  return once.includes('%2F') ? encodeURIComponent(once) : once;
}

/**
 * Zoom scheduled meetings: if `timezone` is a non-UTC IANA zone, `start_time` must be
 * wall-clock local time `yyyy-MM-ddTHH:mm:ss` (no `Z`). Passing a UTC `...Z` while also
 * passing `timezone` can lead to unexpected scheduled times.
 */
function formatZoomStartTime(startTimeInput, ianaTimezone) {
  const d = startTimeInput instanceof Date ? startTimeInput : new Date(startTimeInput);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid startTime for Zoom');
  }

  const tz = ianaTimezone || 'UTC';
  if (tz === 'UTC' || tz === 'Etc/UTC' || tz === 'Etc/GMT' || tz === 'Greenwich') {
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = dtf.formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t)?.value;
  const y = g('year');
  const mo = g('month');
  const day = g('day');
  let h = g('hour');
  const mi = g('minute');
  let s = g('second') || '00';
  // Some environments can return hour "24"
  if (h === '24') h = '00';
  s = String(s).padStart(2, '0');
  return `${y}-${mo}-${day}T${h}:${mi}:${s}`;
}

class ZoomService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get Zoom Access Token using the master Server-to-Server OAuth credentials.
   */
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    console.log('🔑 Fetching Zoom access token...');

    const credentials = Buffer.from(
      `${zoomConfig.clientId}:${zoomConfig.clientSecret}`
    ).toString('base64');

    const response = await axios.post(
      `${zoomConfig.oauthUrl}?grant_type=account_credentials&account_id=${zoomConfig.accountId}`,
      {},
      {
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    this.accessToken = response.data.access_token;
    this.tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

    console.log('✅ Zoom access token obtained');
    return this.accessToken;
  }

  /**
   * Create a Zoom meeting on a specific teacher's Zoom user account.
   * @param {Object} meetingData - Meeting configuration
   * @param {String} hostEmail - Teacher's Zoom email (user under master account)
   */
  async createMeeting(meetingData, hostEmail) {
    try {
      const token = await this.getAccessToken();

      const {
        topic,
        startTime,
        duration,
        timezone = 'Asia/Colombo',
        agenda,
        settings = {}
      } = meetingData;

      const zoomStartTime = formatZoomStartTime(startTime, timezone);
      console.log('📌 [Zoom create] Incoming startTime (ISO instant):', startTime);
      console.log('📌 [Zoom create] timezone:', timezone);
      console.log('📌 [Zoom create] start_time sent to Zoom (local, no Z):', zoomStartTime);

      const payload = {
        topic: topic || 'German Language Class',
        type: zoomConfig.meetingTypes.SCHEDULED,
        start_time: zoomStartTime,
        duration: duration || 60,
        timezone: timezone,
        agenda: agenda || 'German language learning session',
        settings: {
          ...zoomConfig.defaultSettings,
          ...settings,
          host_video: true,
          participant_video: true,
          waiting_room: false,
          join_before_host: true,
          mute_upon_entry: true,
          breakout_room: { enable: true },
          approval_type: 2, // No registration required
          registrants_email_notification: false,
          registrants_confirmation_email: false,
          alternative_hosts_email_notification: false
        }
      };

      // Use teacher's Zoom email as the host, fallback to 'me'
      const userId = hostEmail || 'me';
      console.log(`📅 Creating Zoom meeting on host: ${userId} — ${payload.topic}`);

      const response = await axios.post(
        `${zoomConfig.apiBaseUrl}/users/${userId}/meetings`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const meeting = response.data;
      console.log('✅ Zoom meeting created:', meeting.id);
      console.log('📌 [Zoom create] Zoom returned start_time:', meeting.start_time, '| timezone:', meeting.timezone);

      return {
        success: true,
        meeting: {
          id: meeting.id,
          meetingId: meeting.id,
          uuid: meeting.uuid,
          topic: meeting.topic,
          startTime: meeting.start_time,
          duration: meeting.duration,
          timezone: meeting.timezone,
          joinUrl: meeting.join_url,
          startUrl: meeting.start_url,
          password: meeting.password,
          hostEmail: meeting.host_email,
          agenda: meeting.agenda,
          status: meeting.status,
          createdAt: meeting.created_at
        }
      };
    } catch (error) {
      console.error('❌ Error creating Zoom meeting:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to create Zoom meeting');
    }
  }

  /**
   * Get meeting details
   */
  async getMeeting(meetingId) {
    const token = await this.getAccessToken();
    const response = await axios.get(`${zoomConfig.apiBaseUrl}/meetings/${meetingId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.data;
  }

  /**
   * Update a meeting
   */
  async updateMeeting(meetingId, updateData) {
    const token = await this.getAccessToken();
    if (!updateData.settings) updateData.settings = {};
    updateData.settings.registrants_email_notification = false;

    if (updateData.start_time && updateData.timezone) {
      const raw = String(updateData.start_time);
      const isUtcOrOffset = raw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(raw);
      if (isUtcOrOffset) {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
          updateData.start_time = formatZoomStartTime(parsed, updateData.timezone);
          console.log('📌 [Zoom update] Normalized start_time:', updateData.start_time, '| timezone:', updateData.timezone);
        }
      }
    }

    await axios.patch(`${zoomConfig.apiBaseUrl}/meetings/${meetingId}`, updateData, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    console.log('✅ Meeting updated');
    return { success: true };
  }

  /**
   * Delete a meeting
   */
  async deleteMeeting(meetingId) {
    const token = await this.getAccessToken();
    await axios.delete(`${zoomConfig.apiBaseUrl}/meetings/${meetingId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { schedule_for_reminder: false, cancel_meeting_reminder: false }
    });
    console.log('✅ Meeting deleted');
    return { success: true };
  }

  /**
   * Get meeting participants (for attendance tracking)
   */
  async getMeetingParticipants(meetingId) {
    try {
      const token = await this.getAccessToken();
      const id = encodeZoomUuid(meetingId);
      const response = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${id}/participants`,
        { headers: { 'Authorization': `Bearer ${token}` }, params: { page_size: 300 } }
      );

      const participants = response.data.participants || [];
      const participantMap = new Map();

      participants.forEach(p => {
        const key = p.user_email || p.name;
        if (participantMap.has(key)) {
          const existing = participantMap.get(key);
          existing.duration += p.duration;
          existing.durationMinutes = Math.round(existing.duration / 60);
          if (new Date(p.join_time) < new Date(existing.joinTime)) existing.joinTime = p.join_time;
          if (new Date(p.leave_time) > new Date(existing.leaveTime)) existing.leaveTime = p.leave_time;
          existing.sessionCount = (existing.sessionCount || 1) + 1;
        } else {
          participantMap.set(key, {
            id: p.id, userId: p.user_id, name: p.name, email: p.user_email,
            joinTime: p.join_time, leaveTime: p.leave_time,
            duration: p.duration, durationMinutes: Math.round(p.duration / 60),
            attentiveness_score: p.attentiveness_score, status: p.status,
            participantUserId: p.participant_user_id, sessionCount: 1
          });
        }
      });

      return Array.from(participantMap.values());
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('ℹ️ Meeting not found or hasn\'t ended yet');
        return [];
      }
      console.error('❌ Error getting participants:', error.response?.data || error.message);
      throw new Error('Failed to get meeting participants');
    }
  }

  /**
   * Get detailed meeting report
   */
  async getMeetingReport(meetingId) {
    try {
      const token = await this.getAccessToken();
      const id = encodeZoomUuid(meetingId);
      const meetingResponse = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${id}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const meeting = meetingResponse.data;
      const participants = await this.getMeetingParticipants(meetingId);

      return {
        success: true,
        meeting: {
          id: meeting.id, uuid: meeting.uuid, topic: meeting.topic,
          startTime: meeting.start_time, endTime: meeting.end_time,
          duration: meeting.duration, totalMinutes: meeting.duration,
          participantsCount: meeting.participants_count, hostId: meeting.host_id
        },
        participants,
        summary: {
          totalParticipants: participants.length,
          averageDuration: participants.length > 0
            ? Math.round(participants.reduce((sum, p) => sum + p.durationMinutes, 0) / participants.length) : 0,
          totalAttendanceMinutes: participants.reduce((sum, p) => sum + p.durationMinutes, 0)
        }
      };
    } catch (error) {
      console.error('❌ Error getting meeting report:', error.response?.data || error.message);
      throw new Error('Failed to get meeting report');
    }
  }

  /**
   * Get participant engagement metrics
   */
  async getParticipantEngagement(meetingId) {
    try {
      const token = await this.getAccessToken();
      const meetingResponse = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${meetingId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const actualMeetingDuration = meetingResponse.data.duration;
      const participants = await this.getMeetingParticipants(meetingId);

      return participants.map(participant => {
        const participationRate = Math.min(participant.durationMinutes / actualMeetingDuration, 1);
        const participationPercentage = Math.round(participationRate * 100);
        return {
          ...participant,
          engagement: {
            cameraOnMinutes: 0, cameraOnSeconds: 0, micOnMinutes: 0, micOnSeconds: 0,
            cameraOnPercentage: 0, micOnPercentage: 0,
            participationRate, participationPercentage,
            engagementScore: participationPercentage,
            actualMeetingDuration,
            accountLimitation: true, estimated: true, dataAvailable: false
          }
        };
      });
    } catch (error) {
      console.error('❌ Error getting participant engagement:', error.message);
      throw new Error('Failed to get participant engagement data');
    }
  }
  /**
   * Get all licensed Zoom users on the master account
   */
  async getZoomUsers() {
    const token = await this.getAccessToken();
    const response = await axios.get(`${zoomConfig.apiBaseUrl}/users`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { page_size: 100, status: 'active' }
    });
    return (response.data.users || []).filter(u => u.type === 2);
  }

  /**
   * Get past meetings for a specific Zoom user
   */
  async getUserPastMeetings(userEmail, from, to) {
    const token = await this.getAccessToken();
    const params = { page_size: 100, type: 'past' };
    if (from) params.from = from;
    if (to) params.to = to;

    const response = await axios.get(`${zoomConfig.apiBaseUrl}/users/${userEmail}/meetings`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params
    });
    return response.data.meetings || [];
  }
}

module.exports = new ZoomService();
