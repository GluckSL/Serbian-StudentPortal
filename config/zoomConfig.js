// config/zoomConfig.js

require('dotenv').config();

module.exports = {
  // Zoom OAuth Credentials
  accountId: process.env.ZOOM_ACCOUNT_ID,
  clientId: process.env.ZOOM_CLIENT_ID,
  clientSecret: process.env.ZOOM_CLIENT_SECRET,
  
  // Zoom API Base URL
  apiBaseUrl: 'https://api.zoom.us/v2',
  oauthUrl: 'https://zoom.us/oauth/token',
  
  // Default Meeting Settings
  defaultSettings: {
    host_video: true,
    participant_video: true,
    join_before_host: false,
    mute_upon_entry: true,
    waiting_room: true,
    audio: 'both',
    auto_recording: 'cloud', // 'none', 'local', or 'cloud'
    approval_type: 0, // 0 = automatically approve, 1 = manually approve, 2 = no registration required
    /** Zoom: disable participant-to-participant private 1:1 chat (enforced again in zoomService.createMeeting). */
    private_chat: false,
  },
  
  // Meeting Types
  meetingTypes: {
    INSTANT: 1,
    SCHEDULED: 2,
    RECURRING_NO_FIXED_TIME: 3,
    RECURRING_FIXED_TIME: 8
  }
};
