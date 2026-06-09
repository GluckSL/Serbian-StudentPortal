/**
 * Live class join reminder — sent when a teacher/admin clicks Remind during an ongoing class.
 * Students who have not clicked Join in the portal (or selected manually) receive this email.
 */

const DEFAULT_TZ = 'Asia/Colombo';

function portalJoinInstructionsHtml() {
  return `
                  <div style="background:#e7f3ff; padding:18px; border-radius:8px; margin:24px 0; text-align:left; border:1px solid #b8daff;">
                    <p style="margin:0 0 12px 0; font-weight:bold; color:#000e89;">How to join now</p>
                    <ol style="margin:0; padding-left:22px; font-size:14px; color:#333; line-height:1.6;">
                      <li style="margin-bottom:8px;">Open the <strong>Glück Global</strong> student portal and sign in.</li>
                      <li style="margin-bottom:8px;">Go to <strong>My Class</strong> or <strong>Live class</strong>.</li>
                      <li style="margin-bottom:8px;">Find this session and click <strong>Join now</strong>.</li>
                      <li>Join using your <strong>registered name</strong> so attendance is recorded correctly.</li>
                    </ol>
                  </div>
                `;
}

function buildLiveJoinReminderHtml({
  studentName,
  topic,
  batch,
  plan,
  teacherName,
  timeZone = DEFAULT_TZ,
  startTime,
}) {
  const st = new Date(startTime);
  const dateStr = st.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  });
  const timeStr = st.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });

  const teacherLine = teacherName
    ? `<p style="margin:16px 0 0 0; color:#333;">Your teacher <strong>${teacherName}</strong> is in the class and waiting for you.</p>`
    : `<p style="margin:16px 0 0 0; color:#333;">Your teacher is in the class and waiting for you.</p>`;

  return `
              <div style="font-family: Arial, sans-serif; text-align:center; background:#f9f9f9; padding:20px;">
                <div style="max-width:600px; margin:auto; background:#fff; padding:20px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">

                  <div style="background:#000e89; border-radius:8px; padding:20px;">
                    <h2 style="color:white; margin:0;">Glück Global — Class in progress</h2>
                  </div>

                  <p style="margin-top:20px;">Hello <strong>${studentName}</strong>,</p>

                  <p style="color:#333; line-height:1.6;">
                    Your German class <strong>"${topic}"</strong> is <strong>live right now</strong>.
                    We noticed you have not joined through the student portal yet.
                  </p>

                  ${teacherLine}

                  <div style="background:#fff3cd; border:1px solid #ffc107; padding:15px; border-radius:8px; margin:20px 0; text-align:left;">
                    <p style="margin:0; font-size:14px; color:#856404;">
                      Please join as soon as possible so you do not miss important lesson content.
                    </p>
                  </div>

                  <div style="background:#f5f5f5; padding:15px; border-radius:8px; margin:20px 0;">
                    <p style="margin:5px 0;"><strong>📅 Date:</strong> ${dateStr}</p>
                    <p style="margin:5px 0;"><strong>🕐 Started at:</strong> ${timeStr}</p>
                    <p style="margin:5px 0;"><strong>👥 Batch:</strong> ${batch}${plan ? ` — ${plan}` : ''}</p>
                  </div>

                  ${portalJoinInstructionsHtml()}

                  <p style="margin-top:30px; color:#666; font-size:13px;">
                    If you are having trouble joining, please contact your teacher or our support team.
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
 * @param {object} meeting - MeetingLink document (lean or mongoose)
 * @param {object} transporter - nodemailer transporter
 * @param {Array<{ name: string, email: string }>} recipients
 * @param {string} [teacherName]
 * @returns {Promise<{ attempted, successful, failed, failedStudents, errors }>}
 */
async function sendLiveJoinReminderEmails(meeting, transporter, recipients, teacherName = '') {
  const emailResults = {
    attempted: 0,
    successful: 0,
    failed: 0,
    failedStudents: [],
    errors: [],
  };

  const timeZone = meeting.timezone || DEFAULT_TZ;
  const topic = meeting.topic || 'German class';
  const batch = meeting.batch || '';
  const plan = meeting.plan || '';

  for (const att of recipients) {
    const name = att.name || 'Student';
    const email = att.email;
    if (!email) continue;

    emailResults.attempted++;
    try {
      const html = buildLiveJoinReminderHtml({
        studentName: name,
        topic,
        batch,
        plan,
        teacherName,
        timeZone,
        startTime: meeting.startTime,
      });

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: `⏰ Please join your class now — ${topic} (Glück Global)`,
        html,
      });
      emailResults.successful++;
    } catch (err) {
      emailResults.failed++;
      emailResults.failedStudents.push({ name, email, error: err.message });
      emailResults.errors.push(err.message);
    }
  }

  return emailResults;
}

module.exports = {
  buildLiveJoinReminderHtml,
  sendLiveJoinReminderEmails,
};
