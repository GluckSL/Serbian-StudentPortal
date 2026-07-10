/**
 * HTML + send helpers for class reminder emails (~30 min before start via cron).
 * Join happens only through the student portal — no Zoom links or passwords in email.
 */

const DEFAULT_TZ = 'Asia/Colombo';

function portalJoinInstructionsHtml() {
  return `
                  <div style="background:#e7f3ff; padding:18px; border-radius:8px; margin:24px 0; text-align:left; border:1px solid #b8daff;">
                    <p style="margin:0 0 12px 0; font-weight:bold; color:#000e89;">How to join</p>
                    <ol style="margin:0; padding-left:22px; font-size:14px; color:#333; line-height:1.6;">
                      <li style="margin-bottom:8px;">Open the <strong>Glück Global</strong> student portal and sign in.</li>
                      <li style="margin-bottom:8px;">Go to the <strong>My Class</strong> tab.</li>
                      <li style="margin-bottom:8px;">Under <strong>Upcoming</strong>, find this class — when it is time, use <strong>Join now</strong>.</li>
                      <li style="margin-bottom:8px;">You can also open <strong>Live class</strong> and click <strong>Join</strong> when the session is active.</li>
                      <li>Join using your <strong>registered name</strong> (exactly as on your account) so attendance is recorded correctly.</li>
                    </ol>
                  </div>
                `;
}

function buildInvitationHtml({
  studentName,
  topic,
  startTime,
  duration,
  batch,
  plan,
  agenda,
  introParagraph,
  timeZone = DEFAULT_TZ
}) {
  const st = new Date(startTime);
  const dateStr = st.toLocaleDateString('sr-Latn-RS', {
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

                  ${portalJoinInstructionsHtml()}

                  <div style="background:#d4edda; border:1px solid #c3e6cb; padding:15px; border-radius:6px; margin:20px 0; text-align:left;">
                    <p style="margin:0 0 10px 0; font-weight:bold; color:#155724;">✅ Reminder:</p>
                    <ul style="margin:0; padding-left:20px; text-align:left; font-size:14px; color:#155724;">
                      <li>Do not share your portal login with others.</li>
                      <li>You can join from a few minutes before the class starts.</li>
                      <li>Use your registered display name in the meeting so attendance matches your account.</li>
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
    'Your German class starts in about <strong>30 minutes</strong>. Please join through the student portal — follow the steps below (no join link is sent by email).';

  const emailResults = {
    attempted: 0,
    successful: 0,
    failed: 0,
    failedStudents: [],
    errors: []
  };

  const timeZone = meeting.timezone || DEFAULT_TZ;

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
        introParagraph: intro,
        timeZone
      });

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: options.subject || '🎓 Class starting in ~30 minutes — join via portal (Glück Global)',
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
  DEFAULT_REMINDER_MINUTES_BEFORE: 30
};
