/**
 * HTML + send helpers for Zoom class invitation emails (10 min before start via cron).
 */

const DEFAULT_TZ = 'Asia/Colombo';

function buildInvitationHtml({
  studentName,
  topic,
  startTime,
  duration,
  batch,
  plan,
  agenda,
  joinUrl,
  password,
  meetingId,
  introParagraph,
  timeZone = DEFAULT_TZ
}) {
  const st = new Date(startTime);
  const dateStr = st.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone
  });
  const timeStr = st.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone
  });

  return `
              <div style="font-family: Arial, sans-serif; text-align:center; background:#f9f9f9; padding:20px;">
                <div style="max-width:600px; margin:auto; background:#fff; padding:20px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">

                  <div style="background:#000e89; border-radius:8px; padding:20px;">
                    <h2 style="color:white; margin:0;">Glück Global - Class starting soon</h2>
                  </div>

                  <p style="margin-top:20px;">Hello <strong>${studentName}</strong>,</p>

                  <p>${introParagraph}</p>

                  <div style="background:#f5f5f5; padding:15px; border-radius:8px; margin:20px 0;">
                    <h3 style="color:#000e89; margin:0 0 10px 0;">${topic}</h3>
                    <p style="margin:5px 0;"><strong>📅 Date:</strong> ${dateStr}</p>
                    <p style="margin:5px 0;"><strong>🕐 Time:</strong> ${timeStr}</p>
                    <p style="margin:5px 0;"><strong>⏱️ Duration:</strong> ${duration} minutes</p>
                    <p style="margin:5px 0;"><strong>👥 Batch:</strong> ${batch} - ${plan}</p>
                  </div>

                  ${agenda ? `<p style="color:#666; font-style:italic;">${agenda}</p>` : ''}

                  <div style="margin:30px 0;">
                    <a href="${joinUrl}" target="_blank"
                      style="display:inline-block; background-color:#000e89; color:#fff;
                            text-decoration:none; padding:15px 30px; border-radius:6px; font-size:16px; font-weight:bold;">
                      🎥 Join Zoom Meeting
                    </a>
                  </div>

                  ${password ? `
                    <div style="background:#fff3cd; border:1px solid #ffc107; padding:10px; border-radius:6px; margin:20px 0;">
                      <p style="margin:0; color:#856404;">
                        <strong>🔒 Meeting Password:</strong> <code style="background:#fff; padding:5px 10px; border-radius:4px; font-size:16px;">${password}</code>
                      </p>
                    </div>
                  ` : ''}

                  <div style="background:#e7f3ff; padding:15px; border-radius:6px; margin:20px 0; text-align:left;">
                    <p style="margin:0 0 10px 0; font-weight:bold; color:#000e89;">📝 Meeting Details:</p>
                    <p style="margin:5px 0; font-size:14px;"><strong>Meeting ID:</strong> ${meetingId}</p>
                    <p style="margin:5px 0; font-size:14px;"><strong>Join link:</strong> <a href="${joinUrl}" style="color:#000e89; word-break:break-all;">${joinUrl}</a></p>
                  </div>

                  <div style="background:#d4edda; border:1px solid #c3e6cb; padding:15px; border-radius:6px; margin:20px 0; text-align:left;">
                    <p style="margin:0 0 10px 0; font-weight:bold; color:#155724;">✅ Tips:</p>
                    <ul style="margin:0; padding-left:20px; text-align:left; font-size:14px; color:#155724;">
                      <li>Use this link to join so your attendance can be recorded</li>
                      <li>You can join a few minutes before the scheduled time</li>
                      <li>Please don’t share your link with others</li>
                    </ul>
                  </div>

                  <p style="margin-top:30px; color:#666; font-size:13px;">
                    If you have any questions, please contact your teacher.
                  </p>

                  <hr style="border:none; border-top:1px solid #ddd; margin:30px 0;">

                  <p style="font-size:13px; color:#888;">
                    Best regards,<br>
                    <strong>Glück Global Pvt Ltd</strong><br>
                    German Language Learning Platform
                  </p>
                </div>
              </div>
            `;
}

/**
 * Send invitation-style emails to attendees on a MeetingLink document.
 * Pass options.onlyAttendees to email a subset (e.g. newly added students).
 * @returns {{ attempted, successful, failed, failedStudents, errors }}
 */
async function sendInvitationEmailsToAttendees(meeting, transporter, options = {}) {
  const intro =
    options.introParagraph ||
    'Your German class starts in about <strong>10 minutes</strong>. Join using the link below:';

  const emailResults = {
    attempted: 0,
    successful: 0,
    failed: 0,
    failedStudents: [],
    errors: []
  };

  const timeZone = meeting.timezone || DEFAULT_TZ;
  const joinUrl = meeting.joinUrl || meeting.link;
  const meetingId = meeting.zoomMeetingId || '';

  const recipientList =
    options.onlyAttendees && options.onlyAttendees.length
      ? options.onlyAttendees
      : meeting.attendees || [];

  for (const att of recipientList) {
    const name = att.name || 'Student';
    const email = att.email;
    if (!email) continue;

    emailResults.attempted++;
    try {
      const html = buildInvitationHtml({
        studentName: name,
        topic: meeting.topic || 'German class',
        startTime: meeting.startTime,
        duration: meeting.duration || 60,
        batch: meeting.batch,
        plan: meeting.plan,
        agenda: meeting.agenda || '',
        joinUrl: att.joinUrl || joinUrl,
        password: meeting.zoomPassword || '',
        meetingId,
        introParagraph: intro,
        timeZone
      });

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: options.subject || '🎓 Zoom class starting in ~10 minutes - Glück Global',
        html
      });
      emailResults.successful++;
    } catch (err) {
      emailResults.failed++;
      emailResults.failedStudents.push({ name, email, error: err.message });
    }
  }

  return emailResults;
}

module.exports = {
  buildInvitationHtml,
  sendInvitationEmailsToAttendees,
  DEFAULT_REMINDER_MINUTES_BEFORE: 10
};
