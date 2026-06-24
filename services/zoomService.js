// services/zoomService.js

const axios = require('axios');
const zoomConfig = require('../config/zoomConfig');

/** null = unknown, true = API works, false = OAuth scopes missing — skip further calls. */
let userSettingsScopeAvailable = null;
let accountSettingsScopeAvailable = null;
let userSettingsScopeWarned = false;
let accountSettingsScopeWarned = false;

function isMissingZoomSettingsScope(error) {
  const code = error.response?.data?.code;
  const msg = String(error.response?.data?.message || error.message || '');
  return code === 4711 || /update:settings/.test(msg);
}

function logMissingUserSettingsScopeOnce() {
  if (userSettingsScopeWarned) return;
  userSettingsScopeWarned = true;
  console.warn(
    '⚠️  Zoom OAuth app is missing user:update:settings scope. ' +
      'Skipping per-user private chat enforcement; meetings still use private_chat:false at meeting level. ' +
      'Add user:update:settings (or user:update:settings:admin) in the Zoom Marketplace app to enable user-level enforcement.'
  );
}

function logMissingAccountSettingsScopeOnce() {
  if (accountSettingsScopeWarned) return;
  accountSettingsScopeWarned = true;
  console.warn(
    '⚠️  Zoom OAuth app is missing account settings scope. ' +
      'Skipping account-wide private chat enforcement; meetings still use private_chat:false at meeting level.'
  );
}

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

/**
 * Dedupe key for one Zoom past-meeting participant row.
 * - Email: stable signed-in Zoom users.
 * - Normalized display name: merges disconnect/reconnect rows (guest user_id and row id change every session).
 * - user_id only when name is missing (rare).
 */
function participantDedupeKey(p) {
  const rawEmailInput = (p.user_email || p.email || '').trim();
  const dedupeEmail = normalizeEmailForDedupe(rawEmailInput);
  if (dedupeEmail) return `email:${dedupeEmail}`;

  const normName = normalizeParticipantName(p.name || p.user_name || '');
  if (normName) return `name:${normName}`;

  const zoomUserId = String(p.user_id || p.participant_user_id || '').trim();
  if (zoomUserId) return `userid:${zoomUserId}`;

  const rowId = String(p.id || '').trim();
  if (rowId) return `id:${rowId}`;

  return `raw:${String(p.name || p.user_name || 'unknown')}`;
}

/** Sessions joined within this gap are counted as reconnects rather than intentional re-joins. */
const RECONNECT_GAP_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Merge a new Zoom session row into an already-seen participant entry.
 * Tracks individual sessions so we can compute reconnect counts and gap analytics.
 */
function mergeParticipantRows(existing, p, dedupeEmail, rawEmailInput) {
  const sessionDuration = Number(p.duration) || 0;
  const sessionJoinTime = p.join_time || null;
  const sessionLeaveTime = p.leave_time || null;

  // Gap from the last recorded leave to this session's join — determines reconnect vs re-join.
  const prevSession = existing.sessions[existing.sessions.length - 1];
  const prevLeaveTime = prevSession?.leaveTime;
  const gapMs = (prevLeaveTime && sessionJoinTime)
    ? new Date(sessionJoinTime).getTime() - new Date(prevLeaveTime).getTime()
    : null;

  existing.sessions.push({ joinTime: sessionJoinTime, leaveTime: sessionLeaveTime, duration: sessionDuration });
  existing.sessionCount = existing.sessions.length;

  if (gapMs !== null && gapMs >= 0 && gapMs < RECONNECT_GAP_MS) {
    existing.reconnectCount = (existing.reconnectCount || 0) + 1;
  }

  existing.duration += sessionDuration;
  existing.totalDuration = existing.duration;
  existing.durationMinutes = Math.round(existing.duration / 60);

  // firstJoin = earliest join; finalLeave = latest leave across all sessions.
  if (sessionJoinTime && (!existing.firstJoin || new Date(sessionJoinTime) < new Date(existing.firstJoin))) {
    existing.firstJoin = sessionJoinTime;
    existing.joinTime = sessionJoinTime;
  }
  if (sessionLeaveTime && (!existing.finalLeave || new Date(sessionLeaveTime) > new Date(existing.finalLeave))) {
    existing.finalLeave = sessionLeaveTime;
    existing.leaveTime = sessionLeaveTime;
  }

  if (!existing.email && (dedupeEmail || rawEmailInput)) {
    existing.email = dedupeEmail || rawEmailInput.toLowerCase();
  }
}

function dedupeParticipantRows(rawParticipants) {
  // Sort chronologically so sessions array within each participant is in join order.
  const sorted = [...rawParticipants].sort((a, b) => {
    const aT = a.join_time ? new Date(a.join_time).getTime() : 0;
    const bT = b.join_time ? new Date(b.join_time).getTime() : 0;
    return aT - bT;
  });

  const participantMap = new Map();
  for (const p of sorted) {
    const rawEmailInput = (p.user_email || p.email || '').trim();
    const dedupeEmail = normalizeEmailForDedupe(rawEmailInput);
    const key = participantDedupeKey(p);

    if (participantMap.has(key)) {
      mergeParticipantRows(participantMap.get(key), p, dedupeEmail, rawEmailInput);
    } else {
      const initDuration = Number(p.duration) || 0;
      participantMap.set(key, {
        id: p.id,
        userId: p.user_id,
        name: p.name || p.user_name || '',
        email: dedupeEmail || rawEmailInput.toLowerCase(),
        // firstJoin / finalLeave — explicit aliases kept consistent with merged records.
        firstJoin: p.join_time || null,
        finalLeave: p.leave_time || null,
        // Legacy field names kept for backward compatibility.
        joinTime: p.join_time || null,
        leaveTime: p.leave_time || null,
        duration: initDuration,
        totalDuration: initDuration,
        durationMinutes: Math.round(initDuration / 60),
        attentiveness_score: p.attentiveness_score,
        status: p.status,
        participantUserId: p.participant_user_id,
        sessionCount: 1,
        reconnectCount: 0,
        sessions: [{ joinTime: p.join_time || null, leaveTime: p.leave_time || null, duration: initDuration }],
      });
    }
  }
  return Array.from(participantMap.values());
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

    try {
      await axios.patch(`${zoomConfig.apiBaseUrl}/meetings/${meetingId}`, updateData, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      console.log('✅ Meeting updated');
      return { success: true };
    } catch (error) {
      const zoomMsg = error.response?.data?.message;
      throw new Error(zoomMsg || error.message || 'Failed to update Zoom meeting');
    }
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
    const all = [];
    let nextPageToken = '';

    do {
      const params = { page_size: 300 };
      if (nextPageToken) params.next_page_token = nextPageToken;

      const response = await axios.get(
        `${zoomConfig.apiBaseUrl}/past_meetings/${pastMeetingRef}/participants`,
        { headers: { 'Authorization': `Bearer ${token}` }, params }
      );

      const page = Array.isArray(response.data?.participants) ? response.data.participants : [];
      all.push(...page);
      nextPageToken = response.data?.next_page_token ? String(response.data.next_page_token) : '';
    } while (nextPageToken);

    return all;
  }

  /**
   * Score a raw participant list; prefer higher counts and instances near the scheduled start.
   */
  scoreParticipantFetch(rawList, meta = {}) {
    const count = rawList.length;
    const duration = rawList.reduce((sum, p) => sum + (Number(p.duration) || 0), 0);
    const metaCount = Number(meta.participantsCount) || 0;
    const effectiveCount = Math.max(count, metaCount);
    let score = effectiveCount * 100000 + duration;

    if (meta.expectedStartMs != null && meta.instanceStartMs != null) {
      const diff = Math.abs(meta.instanceStartMs - meta.expectedStartMs);
      const sixHours = 6 * 60 * 60 * 1000;
      const fortyEightHours = 48 * 60 * 60 * 1000;
      if (diff <= sixHours) score += 25000;
      else if (diff <= fortyEightHours) score += 5000;
      else score -= 50000;
    }

    return score;
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
      const meetingIdRef = String(meetingId).trim();

      const instances = await this.getPastMeetingInstances(token, meetingIdRef);

      /** @type {{ ref: string, source: string, participantsCount?: number, instanceStartMs?: number|null }[]} */
      const refCandidates = [];

      if (encodedUuid) {
        refCandidates.push({ ref: encodedUuid, source: 'stored_uuid' });
      }

      const sortedInstances = [...instances].sort((a, b) => {
        const aCount = Number(a.participantsCount || 0);
        const bCount = Number(b.participantsCount || 0);
        if (bCount !== aCount) return bCount - aCount;
        if (hasExpectedStart) {
          const aMs = a.startTime ? new Date(a.startTime).getTime() : null;
          const bMs = b.startTime ? new Date(b.startTime).getTime() : null;
          const aDiff = Number.isFinite(aMs) ? Math.abs(aMs - expectedStartMs) : Number.MAX_SAFE_INTEGER;
          const bDiff = Number.isFinite(bMs) ? Math.abs(bMs - expectedStartMs) : Number.MAX_SAFE_INTEGER;
          if (aDiff !== bDiff) return aDiff - bDiff;
        }
        return 0;
      });

      for (const instance of sortedInstances) {
        if (!instance.uuid) continue;
        refCandidates.push({
          ref: this.encodeUuidForZoom(instance.uuid),
          source: 'instance',
          participantsCount: instance.participantsCount,
          instanceStartMs: instance.startTime ? new Date(instance.startTime).getTime() : null,
        });
      }

      refCandidates.push({ ref: meetingIdRef, source: 'meeting_id' });

      const seenRefs = new Set();
      const uniqueCandidates = refCandidates.filter((c) => {
        if (!c.ref || seenRefs.has(c.ref)) return false;
        seenRefs.add(c.ref);
        return true;
      });

      let bestRaw = [];
      let bestScore = -1;
      let bestSource = null;
      let bestMetaCount = 0;

      for (const candidate of uniqueCandidates) {
        try {
          const rawList = await this.fetchPastMeetingParticipants(token, candidate.ref);
          const score = this.scoreParticipantFetch(rawList, {
            participantsCount: candidate.participantsCount,
            expectedStartMs: hasExpectedStart ? expectedStartMs : null,
            instanceStartMs: candidate.instanceStartMs,
          });

          if (score > bestScore) {
            bestScore = score;
            bestRaw = rawList;
            bestSource = candidate.source;
            bestMetaCount = Number(candidate.participantsCount) || 0;
          }
        } catch {
          continue;
        }
      }

      if (bestRaw.length === 0) {
        const latestUuid = await this.getLatestPastMeetingUuid(token, meetingId);
        if (latestUuid) {
          try {
            bestRaw = await this.fetchPastMeetingParticipants(
              token,
              this.encodeUuidForZoom(latestUuid)
            );
            bestSource = 'latest_instance';
          } catch {
            // fall through
          }
        }
      }

      const rawCount = bestRaw.length;
      const deduped = dedupeParticipantRows(bestRaw);

      if (rawCount > 0 && deduped.length < rawCount) {
        console.log(
          `ℹ️ Zoom participants deduped ${rawCount} → ${deduped.length} rows (source=${bestSource || 'unknown'})`
        );
      }
      if (bestMetaCount > rawCount && rawCount > 0) {
        console.warn(
          `⚠️ Zoom instance metadata reports ${bestMetaCount} participants but API returned ${rawCount} (source=${bestSource || 'unknown'})`
        );
      }
      if (bestRaw.length > 0) {
        console.log(
          `✅ Zoom participants selected: ${deduped.length} unique (${rawCount} raw, source=${bestSource || 'unknown'})`
        );
      }

      return deduped;
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
    if (userSettingsScopeAvailable === false) {
      return { success: false, skipped: true, reason: 'missing_scope' };
    }

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
      userSettingsScopeAvailable = true;
      console.log(`✅ Private chat disabled at user level for: ${userEmail}`);
      return { success: true };
    } catch (error) {
      if (isMissingZoomSettingsScope(error)) {
        userSettingsScopeAvailable = false;
        logMissingUserSettingsScopeOnce();
        return { success: false, skipped: true, reason: 'missing_scope' };
      }
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
    if (accountSettingsScopeAvailable === false) {
      return { success: false, skipped: true, reason: 'missing_scope' };
    }

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
      accountSettingsScopeAvailable = true;
      console.log('✅ Private chat disabled at account level');
      return { success: true };
    } catch (error) {
      if (isMissingZoomSettingsScope(error)) {
        accountSettingsScopeAvailable = false;
        logMissingAccountSettingsScopeOnce();
        return { success: false, skipped: true, reason: 'missing_scope' };
      }
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
