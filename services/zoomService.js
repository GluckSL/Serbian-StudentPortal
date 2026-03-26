// services/zoomService.js

const axios = require('axios');
const zoomConfig = require('../config/zoomConfig');

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

      const payload = {
        topic: topic || 'German Language Class',
        type: zoomConfig.meetingTypes.SCHEDULED,
        start_time: startTime,
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

      return {
        success: true,
        meeting: {
          id: meeting.id,
          meetingId: meeting.id,
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
      const response = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${meetingId}/participants`,
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
      const meetingResponse = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${meetingId}`,
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
}

module.exports = new ZoomService();
