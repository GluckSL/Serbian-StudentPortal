/**
 * utils/emailTemplates.js
 *
 * Branded HTML email templates for the Glück Global portal.
 * All templates are consistent with the existing credential email style.
 */

/**
 * OTP email for self-service password reset.
 * @param {object} params
 * @param {string} params.name          - Recipient's full name
 * @param {string} params.otp           - 6-digit OTP string
 * @param {number} params.expiresMinutes - OTP validity window in minutes
 */
function buildPasswordResetOtpEmail({ name, otp, expiresMinutes = 15 }) {
  return {
    subject: 'Your Glück Global Password Reset Code',
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Password Reset</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0"
               style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                Glück Global
              </h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                German Study Buddy
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Hello <strong>${escapeHtml(name)}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#444;font-size:15px;line-height:1.6;">
                We received a request to reset the password for your Glück Global account.
                Use the one-time code below to proceed. It is valid for
                <strong>${expiresMinutes} minutes</strong>.
              </p>

              <!-- OTP Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:8px 0 32px;">
                    <div style="display:inline-block;background:#f0ebff;border:2px solid #8b5cf6;
                                border-radius:12px;padding:20px 40px;">
                      <p style="margin:0 0 6px;color:#6c3fc5;font-size:12px;
                                 font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                        Your Reset Code
                      </p>
                      <p style="margin:0;color:#1a1a2e;font-size:36px;
                                 font-weight:800;letter-spacing:8px;font-family:'Courier New',monospace;">
                        ${escapeHtml(otp)}
                      </p>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.6;">
                Enter this code on the password reset page together with your new password.
              </p>

              <!-- Security warning -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background:#fff8f0;border-left:4px solid #f59e0b;
                              border-radius:4px;padding:14px 18px;margin-bottom:24px;">
                    <p style="margin:0;color:#92400e;font-size:13px;line-height:1.5;">
                      <strong>Did not request this?</strong> You can safely ignore this email.
                      Your password will not change unless you complete the reset process.
                      Never share this code with anyone.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                Glück Global Pvt Ltd &nbsp;·&nbsp;
                <a href="https://gluckstudentsportal.com" style="color:#8b5cf6;text-decoration:none;">
                  gluckstudentsportal.com
                </a>
                <br />
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** OTP sent to current email when student requests an email change during setup. */
function buildEmailChangeOtpEmail({ name, otp, newEmail, expiresMinutes = 15 }) {
  return {
    subject: 'Confirm your Glück Global email change',
    html: `
<div style="font-family:Arial,sans-serif;color:#000;line-height:1.6;max-width:560px;margin:0 auto;">
  <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
  <p>You requested to change your portal email to <strong>${escapeHtml(newEmail)}</strong>.</p>
  <p>Your verification code is:</p>
  <p style="font-size:32px;font-weight:800;letter-spacing:8px;color:#6c3fc5;font-family:monospace;">${escapeHtml(otp)}</p>
  <p>This code expires in <strong>${expiresMinutes} minutes</strong>. If you did not request this, ignore this email.</p>
  <p>Best regards,<br><strong>Glück Global Pvt Ltd</strong></p>
</div>`.trim(),
  };
}

/** Credentials email after student completes first-login password setup. */
function buildPortalCredentialsEmail({ name, regNo, email, password, isOneTimeNote = false }) {
  const oneTimeNote = isOneTimeNote
    ? '<p style="color:#92400e;background:#fff8f0;padding:12px;border-left:4px solid #f59e0b;"><strong>Note:</strong> Your initial password was one-time only. Use the password below that you set during setup.</p>'
    : '';
  return {
    subject: 'Your Glück Global Portal Login Details',
    html: `
<div style="font-family:Arial,sans-serif;color:#000;line-height:1.6;max-width:560px;margin:0 auto;">
  <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
  <p>Your <strong>Glück Global Student Portal</strong> account is ready. Here are your login details:</p>
  ${oneTimeNote}
  <ul>
    <li><strong>Web App ID:</strong> ${escapeHtml(regNo)}</li>
    <li><strong>Email:</strong> ${escapeHtml(email)}</li>
    <li><strong>Password:</strong> ${escapeHtml(password)}</li>
  </ul>
  <p>You can sign in with your <strong>email</strong> or <strong>Web App ID</strong> and the password above.</p>
  <p>Portal: <a href="https://gluckstudentsportal.com">https://gluckstudentsportal.com</a></p>
  <p>Please keep this information safe and do not share it with anyone.</p>
  <p>Best regards,<br><strong>Glück Global Pvt Ltd</strong></p>
</div>`.trim(),
  };
}

/** Welcome email for new students — one-time password; must change on first login. */
function buildWelcomeOneTimePasswordEmail({ name, regNo, email, password }) {
  return {
    subject: 'Welcome to Glück Global Student Portal',
    html: `
<div style="font-family:Arial,sans-serif;color:#000;line-height:1.6;max-width:560px;margin:0 auto;">
  <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
  <p>Welcome to the <strong>Glück Global Student Portal</strong>. Your account has been created.</p>
  <ul>
    <li><strong>Web App ID:</strong> ${escapeHtml(regNo)}</li>
    <li><strong>Email:</strong> ${escapeHtml(email)}</li>
    <li><strong>One-time password:</strong> ${escapeHtml(password)}</li>
  </ul>
  <p style="color:#92400e;background:#fff8f0;padding:12px;border-left:4px solid #f59e0b;">
    <strong>Important:</strong> The password above is for your <strong>first login only</strong>.
    You will be asked to set your own permanent password before you can use the portal.
  </p>
  <p>Portal: <a href="https://gluckstudentsportal.com">https://gluckstudentsportal.com</a></p>
  <p>Best regards,<br><strong>Glück Global Pvt Ltd</strong></p>
</div>`.trim(),
  };
}

// ─── Shared HTML header / footer helpers ─────────────────────────────────────

function emailHeader(title = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="560" cellspacing="0" cellpadding="0"
           style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <tr>
        <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Glück Global</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">German Study Buddy</p>
        </td>
      </tr>
      <tr><td style="padding:32px 40px;">`;
}

function emailFooter() {
  return `
      </td></tr>
      <tr>
        <td style="background:#f8fafc;padding:16px 40px;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">© Glück Global Pvt Ltd · <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a></p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Signup: invite link (admin sends to prospective student) ────────────────

/**
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.signupUrl  - full URL including token
 */
function buildSignupLinkEmail({ name, signupUrl }) {
  return {
    subject: 'Your Glück Global Signup Link',
    html: emailHeader('Signup Link') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">Hello <strong>${escapeHtml(name || 'there')}</strong>,</p>
      <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
        You've been invited to join the <strong>Glück Global Student Portal</strong>.
        Click the button below to complete your registration in just a few steps.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:8px 0 28px;">
          <a href="${signupUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Complete Registration →
          </a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px;color:#64748b;font-size:13px;">Or copy this link into your browser:</p>
      <p style="margin:0 0 24px;word-break:break-all;font-size:12px;color:#6c3fc5;">${escapeHtml(signupUrl)}</p>
      <p style="margin:0;color:#9ca3af;font-size:12px;">This link expires in 30 days. If you did not request this, please ignore this email.</p>
    ` + emailFooter(),
  };
}

/**
 * Admin invite email — links to the public /register wizard.
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.registerUrl
 */
function buildRegisterInviteEmail({ name, registerUrl }) {
  return {
    subject: 'You\'re invited to register for Glück Global',
    html: emailHeader('Registration Invite') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">Hello <strong>${escapeHtml(name || 'there')}</strong>,</p>
      <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
        You have been invited to register for <strong>Glück Global</strong>.
        Click the button below to enroll and complete your registration on our student portal.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:8px 0 28px;">
          <a href="${registerUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Enroll
          </a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px;color:#64748b;font-size:13px;">Or copy this link into your browser:</p>
      <p style="margin:0 0 24px;word-break:break-all;font-size:12px;color:#6c3fc5;">${escapeHtml(registerUrl)}</p>
      <p style="margin:0;color:#9ca3af;font-size:12px;">If you did not expect this invitation, you can safely ignore this email.</p>
    ` + emailFooter(),
  };
}

// ─── Signup: email OTP verification ──────────────────────────────────────────

/**
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.otp
 * @param {number} params.expiresMinutes
 */
function buildSignupEmailOtpEmail({ name, otp, expiresMinutes = 10 }) {
  return {
    subject: 'Verify Your Email — Glück Global',
    html: emailHeader('Email Verification') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">Hello <strong>${escapeHtml(name || 'there')}</strong>,</p>
      <p style="margin:0 0 24px;color:#444;font-size:15px;line-height:1.6;">
        Use the one-time code below to verify your email address during signup.
        It is valid for <strong>${expiresMinutes} minutes</strong>.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:8px 0 28px;">
          <div style="display:inline-block;background:#f3f0ff;border:2px dashed #8b5cf6;border-radius:10px;padding:18px 40px;font-size:36px;font-weight:900;letter-spacing:12px;color:#6c3fc5;font-family:monospace;">
            ${escapeHtml(otp)}
          </div>
        </td></tr>
      </table>
      <p style="margin:0;color:#9ca3af;font-size:12px;">Do not share this code. If you didn't request it, you can ignore this email.</p>
    ` + emailFooter(),
  };
}

// ─── Signup: admin notification when proof is uploaded ───────────────────────

function proofDetailRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `
        <tr>
          <td style="padding:6px 0;color:#64748b;font-size:13px;width:160px;font-weight:600;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;color:#1e293b;font-size:13px;">${escapeHtml(String(value))}</td>
        </tr>`;
}

/**
 * @param {object} params
 * @param {string} params.studentName
 * @param {string} params.studentEmail
 * @param {string} [params.regNo]
 * @param {string} [params.phoneNumber]
 * @param {string} [params.whatsappNumber]
 * @param {string} [params.nationality]
 * @param {string} [params.address]
 * @param {string} [params.learnFromLanguage]
 * @param {string} params.level
 * @param {string} params.subscription
 * @param {number} params.amount
 * @param {string} params.currency
 * @param {string} [params.paymentMethod]
 * @param {string} [params.proofFileName]
 * @param {string} [params.proofNote]
 * @param {string} params.adminUrl  - direct link to Req Payment pending approvals
 */
function buildSignupProofReceivedAdminEmail({
  studentName,
  studentEmail,
  regNo,
  phoneNumber,
  whatsappNumber,
  nationality,
  address,
  learnFromLanguage,
  level,
  subscription,
  amount,
  currency,
  paymentMethod,
  proofFileName,
  proofNote,
  adminUrl,
}) {
  const amountStr =
    amount != null && Number.isFinite(Number(amount))
      ? `${currency || ''} ${Number(amount).toLocaleString('en-IN')}`.trim()
      : '';

  const detailRows = [
    proofDetailRow('Student Name', studentName),
    proofDetailRow('Email', studentEmail),
    proofDetailRow('Web App ID', regNo),
    proofDetailRow('Phone', phoneNumber),
    proofDetailRow('WhatsApp', whatsappNumber),
    proofDetailRow('Nationality', nationality),
    proofDetailRow('Address', address),
    proofDetailRow('Learn-from language', learnFromLanguage),
    proofDetailRow('German Level', level),
    proofDetailRow('Plan', subscription),
    proofDetailRow('Amount', amountStr),
    proofDetailRow('Payment method', paymentMethod || 'Bank transfer (manual proof)'),
    proofDetailRow('Proof file', proofFileName),
  ].join('');

  return {
    subject: `New Signup Payment Proof — ${escapeHtml(studentName)}`,
    html: emailHeader('New Signup Payment Proof') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        A student submitted a <strong>manual payment proof</strong> during self-signup. Please review the attached screenshot and approve in the admin panel.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid #e2e8f0;border-radius:10px;">
        ${detailRows}
      </table>
      ${proofNote ? `<p style="margin:0 0 20px;color:#64748b;font-size:13px;">${escapeHtml(proofNote)}</p>` : ''}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:4px 0 24px;">
          <a href="${adminUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 30px;border-radius:8px;">
            Review in Admin Panel →
          </a>
        </td></tr>
      </table>
    ` + emailFooter(),
  };
}

// ─── Signup: welcome email after approval ────────────────────────────────────

/**
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.regNo
 * @param {string} params.email
 * @param {string} params.password  - the password the student chose
 * @param {string} params.loginUrl
 */
function buildSignupApprovedWelcomeEmail({ name, regNo, email, password, loginUrl }) {
  loginUrl = loginUrl || 'https://gluckstudentsportal.com/login';
  return {
    subject: 'Welcome to Glück Global — Your Account is Ready!',
    html: emailHeader('Account Approved') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        Hello <strong>${escapeHtml(name)}</strong>,
      </p>
      <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
        Your registration and payment have been <strong style="color:#16a34a;">approved</strong>!
        Your documents and details have been reviewed. Welcome to the Glück Global Student Portal — here are your login credentials:
      </p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-weight:700;color:#64748b;font-size:13px;width:140px;">Web App ID</td>
          <td style="padding:10px 16px;color:#1e293b;font-size:15px;font-weight:700;">${escapeHtml(regNo)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-weight:700;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Email</td>
          <td style="padding:10px 16px;color:#1e293b;font-size:15px;border-top:1px solid #e2e8f0;">${escapeHtml(email)}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-weight:700;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Password</td>
          <td style="padding:10px 16px;color:#1e293b;font-size:15px;border-top:1px solid #e2e8f0;">${escapeHtml(password)}</td>
        </tr>
      </table>
      <p style="margin:0 0 8px;color:#444;font-size:14px;">You can sign in with your <strong>email</strong> or <strong>Web App ID</strong> and the password above.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:12px 0 28px;">
          <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Login to Portal →
          </a>
        </td></tr>
      </table>
      <p style="margin:0;color:#9ca3af;font-size:12px;">Please keep your credentials safe. If you have any questions, contact our support team.</p>
    ` + emailFooter(),
  };
}

/**
 * Reminder for incomplete journey-day tasks (language tracking admin).
 * @param {number} [currentCourseDay] — student's actual journey day when reminding about an earlier day
 */
function buildJourneyDayReminderEmail({
  name,
  day,
  currentCourseDay,
  incompleteTasks,
  doneTasks,
  totalTasks,
  loginUrl,
}) {
  const tasks = Array.isArray(incompleteTasks) ? incompleteTasks : [];
  const reminderDay = Number(day);
  const studentDay = Number(currentCourseDay);
  const isPastDayReminder =
    Number.isFinite(reminderDay) &&
    Number.isFinite(studentDay) &&
    studentDay > reminderDay;

  const listHtml = tasks
    .map((t, i) => {
      const title = escapeHtml(t.title || 'Task');
      return `
        <tr>
          <td style="padding:10px 16px;border-top:1px solid #e2e8f0;vertical-align:top;width:28px;color:#6c3fc5;font-weight:700;">${i + 1}.</td>
          <td style="padding:10px 16px;border-top:1px solid #e2e8f0;color:#1e293b;font-size:15px;font-weight:600;">${title}</td>
        </tr>`;
    })
    .join('');

  const progressNote =
    Number.isFinite(totalTasks) && totalTasks > 0
      ? `<p style="margin:0 0 20px;color:#64748b;font-size:14px;">You have completed <strong>${doneTasks}</strong> of <strong>${totalTasks}</strong> tasks for Day ${reminderDay}.</p>`
      : '';

  const introParagraph = isPastDayReminder
    ? `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6;">
        You are on <strong>Day ${studentDay}</strong> of your course, but you have not completed your <strong>Day ${reminderDay}</strong> tasks yet. Please complete the following items:
      </p>`
    : `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6;">
        You are on <strong>Day ${reminderDay}</strong> of your course. The following items are still incomplete and need your attention:
      </p>`;

  const subject = isPastDayReminder
    ? `Reminder: Complete your Day ${reminderDay} tasks (you are on Day ${studentDay})`
    : `Reminder: Complete your Day ${reminderDay} tasks before tonight`;

  return {
    subject,
    html:
      emailHeader('Day Progress Reminder') +
      `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        Hello <strong>${escapeHtml(name)}</strong>,
      </p>
      ${introParagraph}
      ${progressNote}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
             style="margin:0 0 24px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        ${listHtml}
      </table>
      <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.6;">
        Please complete the exercise(s) and module(s) listed above <strong>before tonight</strong> so you stay on track with your batch.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:8px 0 20px;">
          <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Open Student Portal →
          </a>
        </td></tr>
      </table>
      <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
        If you have already finished these, you can ignore this email. For help, reply to this message or contact your coordinator.
      </p>
    ` +
      emailFooter(),
  };
}

/**
 * Admin-initiated password reset: student must log in and complete OTP + new password.
 */
function buildForcePasswordResetEmail({ name, regNo, otp, loginUrl, expiresMinutes = 15 }) {
  return {
    subject: 'Action required: set a new Glück Global portal password',
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0"
             style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Student Portal</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
              Hello <strong>${escapeHtml(name)}</strong>,
            </p>
            <p style="margin:0 0 16px;color:#444;font-size:15px;line-height:1.6;">
              Your administrator has requested a password update. Your current session has been signed out.
              Please sign in at the portal using your <strong>App ID</strong> and your <strong>current password</strong>,
              then enter the verification code below and choose a new password.
            </p>
            <p style="margin:0 0 8px;color:#444;font-size:14px;"><strong>App ID:</strong> ${escapeHtml(regNo)}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr><td align="center" style="padding:16px 0 24px;">
                <div style="display:inline-block;background:#f0ebff;border:2px solid #8b5cf6;border-radius:12px;padding:18px 36px;">
                  <p style="margin:0 0 6px;color:#6c3fc5;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Verification code</p>
                  <p style="margin:0;color:#1a1a2e;font-size:32px;font-weight:800;letter-spacing:6px;font-family:'Courier New',monospace;">${escapeHtml(otp)}</p>
                </div>
              </td></tr>
            </table>
            <p style="margin:0 0 20px;color:#64748b;font-size:13px;">This code expires in <strong>${expiresMinutes} minutes</strong>.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr><td align="center" style="padding:4px 0 20px;">
                <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
                  Go to login →
                </a>
              </td></tr>
            </table>
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">
              If you did not expect this email, contact your coordinator. Do not share this code with anyone.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

module.exports = {
  buildPasswordResetOtpEmail,
  buildEmailChangeOtpEmail,
  buildPortalCredentialsEmail,
  buildWelcomeOneTimePasswordEmail,
  buildForcePasswordResetEmail,
  buildSignupLinkEmail,
  buildRegisterInviteEmail,
  buildSignupEmailOtpEmail,
  buildSignupProofReceivedAdminEmail,
  buildSignupApprovedWelcomeEmail,
  buildJourneyDayReminderEmail,
};
