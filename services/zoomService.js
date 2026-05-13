// services/zoomService.js

const axios = require('axios');
const zoomConfig = require('../config/zoomConfig');

/**
 * Gmail-style normalisation for dedupe keys (dots removed in local part).
 */
function normalizeEmailForDedupe(email) {
  if (!email || typeof email !== 'string') return '';
  const t = email.trim().toLowerCase();
  const at = t.indexOf('@');
  if (at < 0) return t;
  let local = t.slice(0, at);
  const domain = t.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

/**
 * Name normaliser for participant deduplication (reconnect rows).
 * Aligns loosely with portal display-name cleanup: Unicode letters, collapse space.
 */
function normalizeParticipantName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200B}-\u{200D}\u{FEFF}\u{00AD}]/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
      const msLeft = this.tokenExpiry - Date.now();
      const minutesLeft = Math.max(0, Math.round(msLeft / 60000));
      console.log(`🔁 Reusing cached Zoom access token (expires in ~${minutesLeft} min)`);
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

    console.log(
      `✅ Zoom access token obtained (expires_in=${response.data.expires_in}s, cached_until=${new Date(this.tokenExpiry).toISOString()})`
    );
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
        timezone = 'Asia/Kolkata',
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
          alternative_hosts_email_notification: false,
          /** Block student↔student 1:1 chat in Zoom (public chat to everyone still allowed). */
          private_chat: false
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

      // Enforce private-chat=false at the user level for this host so the
      // meeting-level setting is not silently overridden by user/account settings.
      this.disablePrivateChatForUser(userId).catch(() => {});

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
          // Zoom sometimes omits `password` but still provides `encrypted_password` / join_url `pwd=`
          password: meeting.password || meeting.encrypted_password || '',
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
    updateData.settings.private_chat = false;

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
  encodeUuidForZoom(uuid) {
    return encodeURIComponent(encodeURIComponent(String(uuid || '').trim()));
  }

  async fetchPastMeetingParticipants(token, pastMeetingRef) {
    const response = await axios.get(
      `${zoomConfig.apiBaseUrl}/past_meetings/${pastMeetingRef}/participants`,
      { headers: { 'Authorization': `Bearer ${token}` }, params: { page_size: 300 } }
    );
    return response.data.participants || [];
  }

  async getLatestPastMeetingUuid(token, meetingId) {
    try {
      const response = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${meetingId}/instances`,
        { headers: { 'Authorization': `Bearer ${token}` }, params: { page_size: 30 } }
      );
      const meetings = Array.isArray(response.data?.meetings) ? response.data.meetings : [];
      if (!meetings.length) return null;
      meetings.sort((a, b) => new Date(b?.start_time || 0) - new Date(a?.start_time || 0));
      return meetings[0]?.uuid ? String(meetings[0].uuid) : null;
    } catch (error) {
      return null;
    }
  }

  async getPastMeetingInstances(token, meetingId) {
    try {
      const response = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${meetingId}/instances`,
        { headers: { 'Authorization': `Bearer ${token}` }, params: { page_size: 30 } }
      );
      const meetings = Array.isArray(response.data?.meetings) ? response.data.meetings : [];
      return meetings
        .filter((m) => m && m.uuid)
        .map((m) => ({
          uuid: String(m.uuid),
          startTime: m.start_time ? new Date(m.start_time) : null,
          endTime: m.end_time ? new Date(m.end_time) : null,
          participantsCount: Number(m.participants_count || 0),
        }));
    } catch (error) {
      return [];
    }
  }

  async getMeetingParticipants(meetingId, options = {}) {
    try {
      const token = await this.getAccessToken();
      const rawUuid = options.meetingUuid ? String(options.meetingUuid).trim() : '';
      const encodedUuid = rawUuid ? this.encodeUuidForZoom(rawUuid) : '';
      const expectedStartMs = options.expectedStartTime
        ? new Date(options.expectedStartTime).getTime()
        : null;
      const hasExpectedStart = Number.isFinite(expectedStartMs);

      const refsToTry = [];
      if (encodedUuid) refsToTry.push(encodedUuid);
      const meetingIdRef = String(meetingId).trim();

      let participants = [];
      let lastError = null;
      const instances = await this.getPastMeetingInstances(token, meetingIdRef);

      if (instances.length > 0) {
        const sortedInstances = [...instances].sort((a, b) => {
          if (hasExpectedStart) {
            const aMs = a.startTime ? new Date(a.startTime).getTime() : null;
            const bMs = b.startTime ? new Date(b.startTime).getTime() : null;
            const aDiff = Number.isFinite(aMs) ? Math.abs(aMs - expectedStartMs) : Number.MAX_SAFE_INTEGER;
            const bDiff = Number.isFinite(bMs) ? Math.abs(bMs - expectedStartMs) : Number.MAX_SAFE_INTEGER;
            if (aDiff !== bDiff) return aDiff - bDiff;
          }
          const aCount = Number(a.participantsCount || 0);
          const bCount = Number(b.participantsCount || 0);
          return bCount - aCount;
        });

        for (const instance of sortedInstances) {
          if (!instance.uuid) continue;
          refsToTry.push(this.encodeUuidForZoom(instance.uuid));
        }
      }

      refsToTry.push(meetingIdRef);
      const uniqueRefs = [...new Set(refsToTry.filter(Boolean))];

      for (const ref of uniqueRefs) {
        if (!ref) continue;
        try {
          participants = await this.fetchPastMeetingParticipants(token, ref);
          if (participants.length > 0) break;
        } catch (error) {
          lastError = error;
          continue;
        }
      }

      if (participants.length === 0) {
        const latestUuid = await this.getLatestPastMeetingUuid(token, meetingId);
        if (latestUuid) {
          try {
            participants = await this.fetchPastMeetingParticipants(
              token,
              this.encodeUuidForZoom(latestUuid)
            );
          } catch (error) {
            lastError = error;
          }
        }
      }

      // Zoom sometimes returns an incomplete participant list for a meeting ID/instance.
      // If we got 0-1 participants, probe all past instances and select the richest dataset.
      if (participants.length <= 1) {
        if (instances.length > 0) {
          let bestParticipants = participants;
          let bestScore = participants.length * 100000 + participants.reduce((sum, p) => sum + (Number(p.duration) || 0), 0);
          let bestWithinWindowParticipants = null;
          let bestWithinWindowScore = -1;

          for (const instance of instances) {
            if (!instance.uuid) continue;
            try {
              const instanceParticipants = await this.fetchPastMeetingParticipants(
                token,
                this.encodeUuidForZoom(instance.uuid)
              );
              const countScore = instanceParticipants.length * 100000;
              const durationScore = instanceParticipants.reduce((sum, p) => sum + (Number(p.duration) || 0), 0);
              const combinedScore = countScore + durationScore;

              if (hasExpectedStart) {
                const instanceStartMs = instance.startTime ? new Date(instance.startTime).getTime() : null;
                const withinWindow =
                  Number.isFinite(instanceStartMs) &&
                  Math.abs(instanceStartMs - expectedStartMs) <= 24 * 60 * 60 * 1000;
                if (withinWindow && instanceParticipants.length > 0) {
                  if (combinedScore > bestWithinWindowScore) {
                    bestWithinWindowScore = combinedScore;
                    bestWithinWindowParticipants = instanceParticipants;
                  }
                }
              }

              if (combinedScore > bestScore) {
                bestScore = combinedScore;
                bestParticipants = instanceParticipants;
              }
            } catch (error) {
              continue;
            }
          }

          if (bestWithinWindowParticipants && bestWithinWindowParticipants.length > 0) {
            participants = bestWithinWindowParticipants;
          } else {
            participants = bestParticipants;
          }

        }
      }

      const participantMap = new Map();

      participants.forEach(p => {
        const rawEmailInput = (p.user_email || p.email || '').trim();
        const dedupeEmail = normalizeEmailForDedupe(rawEmailInput);

        // Deduplication key: normalised email (Gmail-aware) OR normalised display name.
        let key;
        if (dedupeEmail) {
          key = `email:${dedupeEmail}`;
        } else {
          const normName = normalizeParticipantName(p.name || p.user_name || '');
          key = normName ? `name:${normName}` : `raw:${String(p.name || p.user_name || p.id || Math.random())}`;
        }

        if (participantMap.has(key)) {
          const existing = participantMap.get(key);
          existing.duration += p.duration;
          existing.durationMinutes = Math.round(existing.duration / 60);
          if (new Date(p.join_time) < new Date(existing.joinTime)) existing.joinTime = p.join_time;
          if (new Date(p.leave_time) > new Date(existing.leaveTime)) existing.leaveTime = p.leave_time;
          existing.sessionCount = (existing.sessionCount || 1) + 1;
        } else {
          participantMap.set(key, {
            id: p.id,
            userId: p.user_id,
            name: p.name || p.user_name || '',
            email: dedupeEmail || rawEmailInput.toLowerCase(),
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
  async getMeetingReport(meetingId, options = {}) {
    try {
      const token = await this.getAccessToken();
      const meetingResponse = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${meetingId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const meeting = meetingResponse.data;
      const participants = await this.getMeetingParticipants(meetingId, options);

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
   * Disable private (1:1) chat at the user level for a specific Zoom host.
   * This is required because meeting-level `private_chat: false` is silently
   * ignored when the host's user-level or account-level setting allows it.
   *
   * @param {string} userEmail  - The Zoom user's email / user-id
   */
  async disablePrivateChatForUser(userEmail) {
    try {
      const token = await this.getAccessToken();
      await axios.patch(
        `${zoomConfig.apiBaseUrl}/users/${encodeURIComponent(userEmail)}/settings`,
        { in_meeting: { private_chat: false } },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`✅ Private chat disabled at user level for: ${userEmail}`);
      return { success: true };
    } catch (error) {
      console.error(
        `⚠️  Could not disable private chat for user ${userEmail}:`,
        error.response?.data || error.message
      );
      return { success: false, error: error.response?.data || error.message };
    }
  }

  /**
   * Disable private (1:1) chat at the master-account level.
   * Calling this once ensures the setting applies to ALL meetings across ALL hosts,
   * regardless of per-meeting or per-user overrides.
   */
  async disablePrivateChatAccountWide() {
    try {
      const token = await this.getAccessToken();
      await axios.patch(
        `${zoomConfig.apiBaseUrl}/accounts/me/settings`,
        { in_meeting: { private_chat: false } },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('✅ Private chat disabled at account level');
      return { success: true };
    } catch (error) {
      console.error(
        '⚠️  Could not disable private chat at account level:',
        error.response?.data || error.message
      );
      return { success: false, error: error.response?.data || error.message };
    }
  }

  /**
   * Disable private chat for ALL licensed users on the master account.
   * Combines account-wide + per-user enforcement for maximum coverage.
   */
  async disablePrivateChatForAllUsers() {
    const results = [];

    // Account-wide first (covers future users too)
    const accountResult = await this.disablePrivateChatAccountWide();
    results.push({ target: 'account', ...accountResult });

    // Per-user enforcement on every existing licensed user
    try {
      const users = await this.getZoomUsers();
      for (const user of users) {
        const userResult = await this.disablePrivateChatForUser(user.email);
        results.push({ target: user.email, ...userResult });
      }
    } catch (error) {
      console.error('⚠️  Error fetching users for private chat enforcement:', error.message);
      results.push({ target: 'all_users_fetch', success: false, error: error.message });
    }

    return results;
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
