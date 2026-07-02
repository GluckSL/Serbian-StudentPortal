/**
 * Post-class feedback notification job.
 *
 * Runs every 5 minutes. Finds MeetingLinks that ended within the last
 * 30 minutes for feedback-enabled batches and sends each attendee an
 * email + WhatsApp with a direct feedback link.
 *
 * Adds feedbackNotificationSent flag to MeetingLink to prevent re-sends.
 */
const cron = require('node-cron');
const MeetingLink = require('../../models/MeetingLink');
const FeedbackBatchSettings = require('../../models/FeedbackBatchSettings');
const User = require('../../models/User');
const transporter = require('../../config/emailConfig');
const {
  sendWhatsappNotification,
  isWhatsappAutomatedJobsEnabled,
} = require('../../services/whatsappCrmService');

const FEEDBACK_NOTIFICATION_TYPE = 'CLASS_FEEDBACK_REQUEST';
const LOOK_BACK_MINUTES = 35; // look back window after class ends
const PORTAL_URL =
  process.env.PORTAL_URL || 'https://gluckstudentsportal.com';

/**
 * Build the feedback email HTML for a student.
 */
function buildFeedbackEmail({ name, classTitle, batch, feedbackUrl }) {
  const escapedName = (name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedTitle = (classTitle || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedBatch = (batch || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return {
    subject: `🦊 How was your class? Share your feedback — ${escapedTitle}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Class Feedback</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0"
               style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#FF6B35 0%,#FF8E53 100%);padding:32px 40px;text-align:center;">
              <div style="font-size:48px;margin-bottom:8px;">🦊</div>
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">How was your class today?</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">
                Glück Global · ${escapedBatch}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Hi <strong>${escapedName}</strong> 👋
              </p>
              <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.7;">
                Your class <strong>"${escapedTitle}"</strong> has just ended.<br/>
                It would mean a lot to us if you could take 30 seconds to share how it went!
                Your feedback helps us make every class better for you. 🌟
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:8px 0 32px;">
                    <a href="${feedbackUrl}"
                       style="display:inline-block;background:linear-gradient(135deg,#FF6B35,#FF8E53);
                              color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;
                              padding:14px 40px;border-radius:50px;
                              box-shadow:0 4px 15px rgba(255,107,53,0.35);">
                      🦊 Give Feedback Now
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#888;font-size:13px;line-height:1.6;text-align:center;">
                It only takes 4 quick questions &amp; less than 30 seconds.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fc;padding:20px 40px;text-align:center;">
              <p style="margin:0;color:#aaa;font-size:12px;">
                © Glück Global · German Study Buddy<br/>
                You received this because you are enrolled in <strong>${escapedBatch}</strong>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

async function processFeedbackNotifications() {
  if (!isWhatsappAutomatedJobsEnabled()) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() - LOOK_BACK_MINUTES * 60 * 1000);

  // Load all feedback-enabled batches
  const enabledSettings = await FeedbackBatchSettings.find({ enabled: true }).lean();
  if (enabledSettings.length === 0) return;
  const enabledBatches = new Set(enabledSettings.map((s) => s.batch));

  // Find meetings that ended in the window, haven't sent feedback notification yet,
  // and belong to a feedback-enabled batch
  const meetings = await MeetingLink.find({
    status: 'ended',
    feedbackNotificationSent: { $ne: true },
    'attendees.0': { $exists: true },
    startTime: { $gte: windowStart, $lte: now },
  }).limit(40);

  for (const doc of meetings) {
    if (!enabledBatches.has(doc.batch)) continue;

    // Atomic claim to prevent duplicate sends
    const meeting = await MeetingLink.findOneAndUpdate(
      { _id: doc._id, feedbackNotificationSent: { $ne: true } },
      { $set: { feedbackNotificationSent: true, feedbackNotificationSentAt: new Date() } },
      { new: true }
    );
    if (!meeting) continue;

    const classTitle = meeting.topic || 'Your class';
    const batch = meeting.batch;

    for (const attendee of meeting.attendees) {
      let student = null;
      if (attendee.studentId) {
        student = await User.findById(attendee.studentId)
          .select('name email whatsappNumber phoneNumber')
          .lean();
      }

      const name = student?.name || attendee.name || 'Student';
      const email = student?.email || attendee.email || '';
      const phone = student?.whatsappNumber || student?.phoneNumber || '';
      const feedbackUrl = `${PORTAL_URL}/student/my-course?tab=classes&feedbackClass=${meeting._id}`;

      // Send email
      if (email) {
        try {
          const emailContent = buildFeedbackEmail({ name, classTitle, batch, feedbackUrl });
          await transporter.sendMail({
            from: `"Glück Global" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: emailContent.subject,
            html: emailContent.html,
          });
        } catch (emailErr) {
          console.error(`[FeedbackNotif] ❌ Email failed for ${email}:`, emailErr.message);
        }
      }

      // Send WhatsApp
      if (phone) {
        try {
          await sendWhatsappNotification({
            phone,
            name,
            type: FEEDBACK_NOTIFICATION_TYPE,
            message: `Hi ${name}! 🦊 Your class "${classTitle}" (${batch}) just ended. Please take 30 seconds to share your feedback: ${feedbackUrl}`,
            data: {
              meetingId: meeting._id,
              classTitle,
              batch,
              feedbackUrl,
            },
          });
        } catch (waErr) {
          console.error(`[FeedbackNotif] ❌ WhatsApp failed for ${phone}:`, waErr.message);
        }
      }
    }

    console.log(`[FeedbackNotif] ✅ Notifications sent for "${classTitle}" (${batch}) — ${meeting.attendees.length} students`);
  }
}

function scheduleFeedbackNotifications() {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    processFeedbackNotifications().catch((err) =>
      console.error('[FeedbackNotif] ❌ Job error:', err.message)
    );
  });
  console.log('📅 [Feedback] Post-class feedback notifications scheduled (every 5 min)');
}

module.exports = { scheduleFeedbackNotifications, processFeedbackNotifications };
