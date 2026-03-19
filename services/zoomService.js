// services/zoomService.js

const axios = require('axios');
const zoomConfig = require('../config/zoomConfig');

class ZoomService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get all licensed Zoom users on the account
   */
  async getZoomUsers() {
    const token = await this.getAccessToken();
    const response = await axios.get(`${zoomConfig.apiBaseUrl}/users`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { page_size: 100, status: 'active' }
    });
    // Only return licensed users (type 2) who can host meetings
    return (response.data.users || []).filter(u => u.type === 2);
  }

  /**
   * Find an available Zoom host for a given time slot.
   * Checks each licensed user's scheduled meetings and picks one with no conflict.
   */
  async findAvailableHost(startTime, duration) {
    const token = await this.getAccessToken();
    const users = await this.getZoomUsers();

    const BUFFER_BEFORE_MS = 15 * 60 * 1000; // 15 min before
    const BUFFER_AFTER_MS = 30 * 60 * 1000; // 30 min after
    const meetingStart = new Date(startTime).getTime();
    const meetingEnd = meetingStart + (duration || 60) * 60 * 1000;

    for (const user of users) {
      try {
        // Check for currently LIVE meetings on this host
        const liveRes = await axios.get(`${zoomConfig.apiBaseUrl}/users/${user.id}/meetings`, {
          headers: { 'Authorization': `Bearer ${token}` },
          params: { type: 'live', page_size: 100 }
        });
        const liveMeetings = liveRes.data.meetings || [];
        if (liveMeetings.length > 0) {
          console.log(`⏳ ${user.email} has ${liveMeetings.length} live meeting(s), skipping...`);
          continue;
        }

        // Check for upcoming scheduled meeting conflicts
        const res = await axios.get(`${zoomConfig.apiBaseUrl}/users/${user.id}/meetings`, {
          headers: { 'Authorization': `Bearer ${token}` },
          params: { type: 'upcoming', page_size: 100 }
        });

        const meetings = res.data.meetings || [];
        const hasConflict = meetings.some(m => {
          const mStart = new Date(m.start_time).getTime() - BUFFER_BEFORE_MS;
          const mEnd = new Date(m.start_time).getTime() + (m.duration || 60) * 60 * 1000 + BUFFER_AFTER_MS;
          return meetingStart < mEnd && meetingEnd > mStart;
        });

        if (!hasConflict) {
          console.log(`✅ Available Zoom host found: ${user.email}`);
          return user;
        } else {
          console.log(`⏳ ${user.email} has a conflict at this time, checking next...`);
        }
      } catch (err) {
        console.error(`⚠️ Error checking meetings for ${user.email}:`, err.response?.data?.message || err.message);
      }
    }

    // Fallback: if all users are busy, return null with conflict details
    console.warn('⚠️ All Zoom hosts are busy at this time.');
    return null;
  }

  /**
   * Get Zoom Access Token using Server-to-Server OAuth
   */
  async getAccessToken() {
    try {
      // Check if token is still valid
      if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return this.accessToken;
      }

      console.log('🔑 Fetching new Zoom access token...');

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
      // Set expiry to 5 minutes before actual expiry for safety
      this.tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

      console.log('✅ Zoom access token obtained successfully');
      return this.accessToken;
    } catch (error) {
      console.error('❌ Error getting Zoom access token:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Zoom API');
    }
  }

  /**
   * Create a Zoom meeting
   * @param {Object} meetingData - Meeting configuration
   * @returns {Object} Created meeting details
   */
  async createMeeting(meetingData) {
    try {
      const token = await this.getAccessToken();

      const {
        topic,
        startTime,
        duration,
        timezone = 'Asia/Colombo',
        agenda,
        attendees = [],
        settings = {}
      } = meetingData;

      // Prepare meeting payload
      const payload = {
        topic: topic || 'German Language Class',
        type: zoomConfig.meetingTypes.SCHEDULED,
        start_time: startTime, // Format: "2024-01-15T10:00:00Z"
        duration: duration || 60, // in minutes
        timezone: timezone,
        agenda: agenda || 'German language learning session',
        settings: {
          ...zoomConfig.defaultSettings,
          ...settings,
          // Enforce video settings - participants join with video on
          host_video: true,
          participant_video: true,
          // No waiting room - direct entry for registered participants
          waiting_room: false,
          // Allow joining before host (teacher can start meeting)
          join_before_host: true,
          // Mute on entry (but video stays on)
          mute_upon_entry: true,
          // ✅ REGISTRATION SETTINGS - CRITICAL FOR UNIQUE URLS
          approval_type: 0, // Automatically approve all registrants
          registration_type: 1, // Attendees register once and can attend any occurrence
          // ✅ DISABLE Zoom's email notifications (we'll use our own)
          registrants_email_notification: false, // ❌ Disabled - using our email system
          registrants_confirmation_email: false, // ❌ Disabled - using our email system
          alternative_hosts_email_notification: false // ❌ Disabled
        }
      };

      // Try to add alternative host if provided (optional - may fail if user not licensed)
      if (meetingData.teacherEmail) {
        payload.settings.alternative_hosts = meetingData.teacherEmail;
        payload.settings.alternative_hosts_email_notification = true;
      }

      console.log('📅 Creating Zoom meeting:', payload.topic);

      // Find an available Zoom host for this time slot
      const host = await this.findAvailableHost(startTime, duration);
      if (!host) {
        // Gather conflict details for the error message
        const token2 = await this.getAccessToken();
        const users = await this.getZoomUsers();
        const meetingStartMs = new Date(startTime).getTime();
        const meetingEndMs = meetingStartMs + (duration || 60) * 60 * 1000;
        const conflicts = [];
        const BUFFER_BEFORE_MS = 15 * 60 * 1000;
        const BUFFER_AFTER_MS = 30 * 60 * 1000;

        for (const user of users) {
          try {
            const res = await axios.get(`${zoomConfig.apiBaseUrl}/users/${user.id}/meetings`, {
              headers: { 'Authorization': `Bearer ${token2}` },
              params: { type: 'upcoming', page_size: 100 }
            });
            const conflicting = (res.data.meetings || []).filter(m => {
              const mStart = new Date(m.start_time).getTime() - BUFFER_BEFORE_MS;
              const mEnd = new Date(m.start_time).getTime() + (m.duration || 60) * 60 * 1000 + BUFFER_AFTER_MS;
              return meetingStartMs < mEnd && meetingEndMs > mStart;
            });
            if (conflicting.length > 0) {
              conflicts.push({
                hostEmail: user.email,
                meetings: conflicting.map(m => ({ topic: m.topic, startTime: m.start_time, duration: m.duration }))
              });
            }
          } catch (e) { /* skip */ }
        }

        const err = new Error('All Zoom host accounts are busy at this time. Please choose a different time slot.');
        err.conflicts = conflicts;
        err.statusCode = 409;
        throw err;
      }
      const hostUserId = host.id;
      console.log(`🎯 Assigning meeting to Zoom host: ${host.email}`);

      let response;
      try {
        response = await axios.post(
          `${zoomConfig.apiBaseUrl}/users/${hostUserId}/meetings`,
          payload,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (error) {
        // If alternative host fails, try again without it
        if (error.response?.data?.code === 1114 && payload.settings.alternative_hosts) {
          console.log('⚠️ Alternative host failed, creating meeting without alternative host...');
          delete payload.settings.alternative_hosts;
          delete payload.settings.alternative_hosts_email_notification;
          
          response = await axios.post(
            `${zoomConfig.apiBaseUrl}/users/${hostUserId}/meetings`,
            payload,
            {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            }
          );
        } else {
          throw error;
        }
      }

      const meeting = response.data;

      console.log('✅ Zoom meeting created successfully:', meeting.id);

      // Add registrants if provided and capture unique join URLs
      let registrantResults = [];
      if (attendees && attendees.length > 0) {
        console.log(`👥 Adding ${attendees.length} attendees to meeting...`);
        registrantResults = await this.addRegistrants(meeting.id, attendees);
      }

      return {
        success: true,
        meeting: {
          id: meeting.id,
          meetingId: meeting.id,
          topic: meeting.topic,
          startTime: meeting.start_time,
          duration: meeting.duration,
          timezone: meeting.timezone,
          joinUrl: meeting.join_url, // Generic meeting join URL
          startUrl: meeting.start_url,
          password: meeting.password,
          hostEmail: meeting.host_email,
          agenda: meeting.agenda,
          status: meeting.status,
          createdAt: meeting.created_at
        },
        registrants: registrantResults // Include registrant data with unique join URLs
      };
    } catch (error) {
      console.error('❌ Error creating Zoom meeting:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to create Zoom meeting');
    }
  }

  /**
   * Add registrants to a meeting
   * @param {String} meetingId - Zoom meeting ID
   * @param {Array} attendees - Array of attendee objects with email and name
   * @param {Boolean} sendEmail - Whether to send email notification (default: true)
   */
  async addRegistrants(meetingId, attendees, sendEmail = true) {
    try {
      const token = await this.getAccessToken();
      const results = [];

      for (const attendee of attendees) {
        try {
          const response = await axios.post(
            `${zoomConfig.apiBaseUrl}/meetings/${meetingId}/registrants`,
            {
              email: attendee.email,
              first_name: attendee.firstName || attendee.name?.split(' ')[0] || 'Student',
              last_name: attendee.lastName || attendee.name?.split(' ').slice(1).join(' ') || '',
              auto_approve: true // Automatically approve registration
            },
            {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              params: {
                occurrence_ids: undefined // For all occurrences
              }
            }
          );

          results.push({
            email: attendee.email,
            name: attendee.name,
            success: true,
            registrantId: response.data.registrant_id,
            joinUrl: response.data.join_url
          });

          console.log(`✅ Added registrant: ${attendee.email}${sendEmail ? ' (email sent)' : ''}`);
        } catch (error) {
          console.error(`❌ Failed to add registrant ${attendee.email}:`, error.response?.data || error.message);
          results.push({
            email: attendee.email,
            name: attendee.name,
            success: false,
            error: error.response?.data?.message || 'Failed to add registrant'
          });
        }
      }

      return results;
    } catch (error) {
      console.error('❌ Error adding registrants:', error.message);
      throw error;
    }
  }

  /**
   * Get meeting details
   * @param {String} meetingId - Zoom meeting ID
   */
  async getMeeting(meetingId) {
    try {
      const token = await this.getAccessToken();

      const response = await axios.get(
        `${zoomConfig.apiBaseUrl}/meetings/${meetingId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Error getting meeting details:', error.response?.data || error.message);
      throw new Error('Failed to get meeting details');
    }
  }

  /**
   * Update a meeting
   * @param {String} meetingId - Zoom meeting ID
   * @param {Object} updateData - Data to update
   */
  async updateMeeting(meetingId, updateData) {
    try {
      const token = await this.getAccessToken();

      // ✅ DISABLE Zoom's email notifications (we use our own email system)
      if (updateData.settings) {
        updateData.settings.registrants_email_notification = false; // ❌ Disabled
      } else {
        updateData.settings = {
          registrants_email_notification: false // ❌ Disabled
        };
      }

      const response = await axios.patch(
        `${zoomConfig.apiBaseUrl}/meetings/${meetingId}`,
        updateData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('✅ Meeting updated successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ Error updating meeting:', error.response?.data || error.message);
      throw new Error('Failed to update meeting');
    }
  }

  /**
   * Delete a meeting
   * @param {String} meetingId - Zoom meeting ID
   * @param {Object} options - Deletion options
   */
  async deleteMeeting(meetingId, options = {}) {
    try {
      const token = await this.getAccessToken();

      // ✅ DISABLE Zoom's cancellation emails (we send our own)
      const params = {
        schedule_for_reminder: false, // ❌ Don't send Zoom cancellation email
        cancel_meeting_reminder: false // ❌ Don't send Zoom reminder
      };

      await axios.delete(
        `${zoomConfig.apiBaseUrl}/meetings/${meetingId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          params: params
        }
      );

      console.log('✅ Meeting deleted successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ Error deleting meeting:', error.response?.data || error.message);
      throw new Error('Failed to delete meeting');
    }
  }

  /**
   * Get meeting participants (for attendance tracking)
   * @param {String} meetingId - Zoom meeting ID
   */
  async getMeetingParticipants(meetingId) {
    try {
      const token = await this.getAccessToken();

      const response = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${meetingId}/participants`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          params: {
            page_size: 300 // Get up to 300 participants
          }
        }
      );

      const participants = response.data.participants || [];
      
      // Group participants by email (or name if email not available) to merge multiple sessions
      const participantMap = new Map();
      
      participants.forEach(p => {
        const key = p.user_email || p.name; // Use email as primary key, fallback to name
        
        if (participantMap.has(key)) {
          // Merge with existing participant - sum durations, keep earliest join and latest leave
          const existing = participantMap.get(key);
          existing.duration += p.duration;
          existing.durationMinutes = Math.round(existing.duration / 60);
          
          // Keep earliest join time
          if (new Date(p.join_time) < new Date(existing.joinTime)) {
            existing.joinTime = p.join_time;
          }
          
          // Keep latest leave time
          if (new Date(p.leave_time) > new Date(existing.leaveTime)) {
            existing.leaveTime = p.leave_time;
          }
          
          // Increment session count
          existing.sessionCount = (existing.sessionCount || 1) + 1;
        } else {
          // First session for this participant
          participantMap.set(key, {
            id: p.id,
            userId: p.user_id,
            name: p.name,
            email: p.user_email,
            joinTime: p.join_time,
            leaveTime: p.leave_time,
            duration: p.duration, // in seconds
            durationMinutes: Math.round(p.duration / 60), // convert to minutes
            attentiveness_score: p.attentiveness_score,
            status: p.status,
            participantUserId: p.participant_user_id,
            sessionCount: 1
          });
        }
      });
      
      // Convert map back to array
      return Array.from(participantMap.values());
    } catch (error) {
      console.error('❌ Error getting participants:', error.response?.data || error.message);
      
      // If meeting hasn't ended yet, return empty array
      if (error.response?.status === 404) {
        console.log('ℹ️ Meeting not found or hasn\'t ended yet');
        return [];
      }
      
      throw new Error('Failed to get meeting participants');
    }
  }

  /**
   * Get participant QoS (Quality of Service) data including camera/mic usage
   * @param {String} meetingId - Zoom meeting ID
   * @param {String} participantId - Participant ID
   */
  async getParticipantQoS(meetingId, participantId) {
    try {
      const token = await this.getAccessToken();

      const response = await axios.get(
        `${zoomConfig.apiBaseUrl}/metrics/meetings/${meetingId}/participants/${participantId}/qos`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      const qos = response.data;
      
      // Extract video and audio data
      const videoData = qos.user_qos?.video_input || [];
      const audioData = qos.user_qos?.audio_input || [];
      
      // Calculate camera on time
      let cameraOnSeconds = 0;
      videoData.forEach(segment => {
        if (segment.bitrate && segment.bitrate !== '0') {
          // If bitrate exists, camera was on during this segment
          cameraOnSeconds += (segment.frame_rate || 0) > 0 ? 1 : 0;
        }
      });

      // Calculate mic on time
      let micOnSeconds = 0;
      audioData.forEach(segment => {
        if (segment.bitrate && segment.bitrate !== '0') {
          micOnSeconds += 1;
        }
      });

      return {
        participantId: participantId,
        cameraOnSeconds: cameraOnSeconds,
        cameraOnMinutes: Math.round(cameraOnSeconds / 60),
        micOnSeconds: micOnSeconds,
        micOnMinutes: Math.round(micOnSeconds / 60),
        videoQuality: qos.user_qos?.video_input?.[0] || {},
        audioQuality: qos.user_qos?.audio_input?.[0] || {},
        connectionQuality: qos.user_qos?.cpu_usage || {}
      };
    } catch (error) {
      console.error('❌ Error getting participant QoS:', error.response?.data || error.message);
      
      // Handle account limitation gracefully
      if (error.response?.data?.code === 200 && 
          error.response?.data?.message?.includes('Business or higher accounts')) {
        console.log('ℹ️ QoS data requires Business+ Zoom account - using basic engagement estimation');
        
        // Return estimated engagement based on participation duration
        return this.estimateBasicEngagement(participantId);
      }
      
      // Return default values if QoS data not available
      return {
        participantId: participantId,
        cameraOnSeconds: 0,
        cameraOnMinutes: 0,
        micOnSeconds: 0,
        micOnMinutes: 0,
        dataAvailable: false,
        accountLimitation: true
      };
    }
  }

  /**
   * Estimate basic engagement when QoS data is not available
   * @param {String} participantId - Participant ID
   */
  async estimateBasicEngagement(participantId) {
    // For accounts without Dashboard access, provide estimated engagement
    // This is a fallback that assumes reasonable engagement levels
    
    return {
      participantId: participantId,
      cameraOnSeconds: 0,
      cameraOnMinutes: 0,
      micOnSeconds: 0,
      micOnMinutes: 0,
      estimated: true,
      dataAvailable: false,
      accountLimitation: true,
      message: 'Engagement metrics require Zoom Business+ account with Dashboard feature'
    };
  }

  /**
   * Get detailed participant engagement metrics
   * @param {String} meetingId - Zoom meeting ID
   */
  async getParticipantEngagement(meetingId) {
    try {
      const token = await this.getAccessToken();

      // Get the actual meeting details to know the total duration
      const meetingResponse = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${meetingId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      const actualMeetingDuration = meetingResponse.data.duration; // in minutes
      console.log(`📊 Actual meeting duration: ${actualMeetingDuration} minutes`);

      // Get basic participant data (now merged by email/name)
      const participants = await this.getMeetingParticipants(meetingId);

      // For accounts without Dashboard access, skip QoS calls and provide basic engagement
      console.log('ℹ️ Using basic engagement metrics (QoS requires Business+ account)');
      
      const engagementData = participants.map(participant => {
        // Calculate participation rate based on ACTUAL meeting duration
        const participationRate = Math.min(participant.durationMinutes / actualMeetingDuration, 1);
        const participationPercentage = Math.round(participationRate * 100);
        
        // Engagement score based on participation (0-100%)
        const engagementScore = participationPercentage;
        
        return {
          ...participant,
          engagement: {
            // Basic engagement estimation
            cameraOnMinutes: 0,
            cameraOnSeconds: 0,
            micOnMinutes: 0,
            micOnSeconds: 0,
            cameraOnPercentage: 0,
            micOnPercentage: 0,
            
            // Participation-based engagement (using ACTUAL meeting duration)
            participationRate: participationRate,
            participationPercentage: participationPercentage,
            engagementScore: engagementScore,
            actualMeetingDuration: actualMeetingDuration,
            
            // Account limitation flags
            accountLimitation: true,
            estimated: true,
            dataAvailable: false,
            message: 'Detailed engagement metrics require Zoom Business+ account with Dashboard feature'
          }
        };
      });

      return engagementData;
    } catch (error) {
      console.error('❌ Error getting participant engagement:', error.message);
      throw new Error('Failed to get participant engagement data');
    }
  }

  /**
   * Get detailed meeting report with all metrics
   * @param {String} meetingId - Zoom meeting ID
   */
  async getMeetingReport(meetingId) {
    try {
      const token = await this.getAccessToken();

      // Get meeting details
      const meetingResponse = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${meetingId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      const meeting = meetingResponse.data;

      // Get participants
      const participants = await this.getMeetingParticipants(meetingId);

      return {
        success: true,
        meeting: {
          id: meeting.id,
          uuid: meeting.uuid,
          topic: meeting.topic,
          startTime: meeting.start_time,
          endTime: meeting.end_time,
          duration: meeting.duration, // in minutes
          totalMinutes: meeting.duration,
          participantsCount: meeting.participants_count,
          hostId: meeting.host_id
        },
        participants: participants,
        summary: {
          totalParticipants: participants.length,
          averageDuration: participants.length > 0 
            ? Math.round(participants.reduce((sum, p) => sum + p.durationMinutes, 0) / participants.length)
            : 0,
          totalAttendanceMinutes: participants.reduce((sum, p) => sum + p.durationMinutes, 0)
        }
      };
    } catch (error) {
      console.error('❌ Error getting meeting report:', error.response?.data || error.message);
      throw new Error('Failed to get meeting report');
    }
  }

  /**
   * List all meetings for the user
   */
  async listMeetings() {
    try {
      const token = await this.getAccessToken();
      const users = await this.getZoomUsers();
      let allMeetings = [];

      for (const user of users) {
        try {
          const response = await axios.get(
            `${zoomConfig.apiBaseUrl}/users/${user.id}/meetings`,
            {
              headers: { 'Authorization': `Bearer ${token}` },
              params: { type: 'upcoming', page_size: 100 }
            }
          );
          const meetings = (response.data.meetings || []).map(m => ({
            ...m,
            hostEmail: user.email
          }));
          allMeetings = allMeetings.concat(meetings);
        } catch (err) {
          console.error(`⚠️ Error listing meetings for ${user.email}:`, err.response?.data?.message || err.message);
        }
      }

      return allMeetings;
    } catch (error) {
      console.error('❌ Error listing meetings:', error.response?.data || error.message);
      throw new Error('Failed to list meetings');
    }
  }
}

module.exports = new ZoomService();
