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

function formatMeetingDateTime(startTime, timeZone = DEFAULT_TZ) {
  const st = new Date(startTime);
  const dateStr = st.toLocaleDateString('sr-Latn-RS', {
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
  return { dateStr, timeStr };
}

function buildLiveJoinReminderPlainText({
  studentName,
  topic,
  batch,
  plan,
  teacherName,
  timeZone = DEFAULT_TZ,
  startTime,
}) {
  const { dateStr, timeStr } = formatMeetingDateTime(startTime, timeZone);
  const tutorSignoff = teacherName
    ? `Your German Tutor,\n${teacherName}`
    : 'Your German Tutor';

  return `Hello ${studentName},

I hope you're doing well!

Our German class, "${topic}", is currently live, and I noticed that you haven't joined yet.

I'd love to have you in class with us today. We're covering some interesting topics, and I don't want you to miss out on the lesson and activities.

When you have a moment, please join the class through the student portal. If you're experiencing any issues joining, don't worry—just join as soon as you can.

I'm looking forward to learning with you!
See you soon!

${tutorSignoff}

---
Class details
Date: ${dateStr}
Started at: ${timeStr}
Batch: ${batch}${plan ? ` — ${plan}` : ''}

How to join now:
1. Open the Glück Global student portal and sign in.
2. Go to My Class or Live class.
3. Find this session and click Join now.
4. Join using your registered name so attendance is recorded correctly.`;
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
  const { dateStr, timeStr } = formatMeetingDateTime(startTime, timeZone);
  const tutorSignoff = teacherName
    ? `Your German Tutor,<br><strong>${teacherName}</strong>`
    : 'Your German Tutor';

  return `
              <div style="font-family: Arial, sans-serif; text-align:center; background:#f9f9f9; padding:20px;">
                <div style="max-width:600px; margin:auto; background:#fff; padding:20px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">

                  <div style="background:#000e89; border-radius:8px; padding:20px;">
                    <h2 style="color:white; margin:0;">Glück Global — Class in progress</h2>
                  </div>

                  <div style="text-align:left; margin-top:20px; color:#333; line-height:1.7; font-size:15px;">
                    <p style="margin:0 0 16px 0;">Hello <strong>${studentName}</strong>,</p>

                    <p style="margin:0 0 16px 0;">I hope you're doing well! 😊</p>

                    <p style="margin:0 0 16px 0;">
                      Our German class, <strong>"${topic}"</strong>, is currently live, and I noticed that you haven't joined yet.
                    </p>

                    <p style="margin:0 0 16px 0;">
                      I'd love to have you in class with us today. We're covering some interesting topics, and I don't want you to miss out on the lesson and activities.
                    </p>

                    <p style="margin:0 0 16px 0;">
                      When you have a moment, please join the class through the student portal. If you're experiencing any issues joining, don't worry—just join as soon as you can.
                    </p>

                    <p style="margin:0 0 16px 0;">
                      I'm looking forward to learning with you!<br>
                      See you soon!
                    </p>

                    <p style="margin:0 0 24px 0;">
                      ${tutorSignoff}
                    </p>
                  </div>

                  <div style="background:#f5f5f5; padding:15px; border-radius:8px; margin:20px 0; text-align:left;">
                    <p style="margin:5px 0;"><strong>📅 Date:</strong> ${dateStr}</p>
                    <p style="margin:5px 0;"><strong>🕐 Started at:</strong> ${timeStr}</p>
                    <p style="margin:5px 0;"><strong>👥 Batch:</strong> ${batch}${plan ? ` — ${plan}` : ''}</p>
                  </div>

                  ${portalJoinInstructionsHtml()}
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
      const reminderPayload = {
        studentName: name,
        topic,
        batch,
        plan,
        teacherName,
        timeZone,
        startTime: meeting.startTime,
      };

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: `We're live now — please join "${topic}" (Glück Global)`,
        text: buildLiveJoinReminderPlainText(reminderPayload),
        html: buildLiveJoinReminderHtml(reminderPayload),
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
  buildLiveJoinReminderPlainText,
  sendLiveJoinReminderEmails,
};
