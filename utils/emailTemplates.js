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

const { formatSubscriptionLabel } = require('./studentSubscriptionPlans');

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
    proofDetailRow('Plan', formatSubscriptionLabel(subscription)),
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

// ─── Job portal: new application (operations inbox) ─────────────────────────

/**
 * @param {object} params
 * @param {string} params.studentName
 * @param {string} params.studentEmail
 * @param {string} [params.studentRegNo]
 * @param {string} [params.studentBatch]
 * @param {string} [params.phone]
 * @param {string} [params.linkedIn]
 * @param {string} [params.coverLetter]
 * @param {string} [params.resumeFileName]
 * @param {string} params.companyName
 * @param {string} params.jobTitle
 * @param {string} [params.jobType]
 * @param {string} [params.location]
 * @param {string} [params.locationType]
 * @param {string} [params.salary]
 * @param {string} params.appliedAt
 * @param {string} params.adminUrl
 * @param {string} [params.resumeNote]
 */
function buildJobApplicationReceivedAdminEmail({
  studentName,
  studentEmail,
  studentRegNo,
  studentBatch,
  phone,
  linkedIn,
  coverLetter,
  resumeFileName,
  companyName,
  jobTitle,
  jobType,
  location,
  locationType,
  salary,
  appliedAt,
  adminUrl,
  resumeNote,
}) {
  const locationStr = [locationType, location].filter(Boolean).join(' · ');
  const coverRaw = String(coverLetter || '').trim();
  const coverShort =
    coverRaw.length > 2000 ? `${coverRaw.slice(0, 2000)}…` : coverRaw;
  const coverHtml = coverShort
    ? escapeHtml(coverShort).replace(/\n/g, '<br/>')
    : '';

  const detailRows = [
    proofDetailRow('Student', studentName),
    proofDetailRow('Email', studentEmail),
    proofDetailRow('Web App ID', studentRegNo),
    proofDetailRow('Batch', studentBatch),
    proofDetailRow('Phone', phone),
    proofDetailRow('LinkedIn', linkedIn),
    proofDetailRow('Company', companyName),
    proofDetailRow('Job title', jobTitle),
    proofDetailRow('Job type', jobType),
    proofDetailRow('Location', locationStr),
    proofDetailRow('Salary', salary),
    proofDetailRow('Resume file', resumeFileName),
    proofDetailRow('Applied at', appliedAt),
  ].join('');

  return {
    subject: `New Job Application — ${escapeHtml(studentName)} · ${escapeHtml(jobTitle || 'Opening')}`,
    html:
      emailHeader('New Job Application') +
      `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        A student submitted an application for <strong>${escapeHtml(jobTitle || 'a job opening')}</strong>
        at <strong>${escapeHtml(companyName || '—')}</strong>. Review the details below.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid #e2e8f0;border-radius:10px;">
        ${detailRows}
      </table>
      ${
        coverHtml
          ? `<p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:700;">Cover letter</p>
      <div style="margin:0 0 20px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;color:#1e293b;font-size:14px;line-height:1.6;">${coverHtml}</div>`
          : ''
      }
      ${resumeNote ? `<p style="margin:0 0 20px;color:#64748b;font-size:13px;">${escapeHtml(resumeNote)}</p>` : ''}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:4px 0 24px;">
          <a href="${adminUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 30px;border-radius:8px;">
            View applications in Admin →
          </a>
        </td></tr>
      </table>
    ` +
      emailFooter(),
  };
}

// ─── Signup: rejection email (bank-transfer proof not approved) ─────────────

/**
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.email
 * @param {number} [params.amount]
 * @param {string} [params.currency]
 * @param {string} [params.rejectionReason]
 * @param {string} params.signupUrl — link to resume signup and re-upload proof
 */
function buildSignupRejectedEmail({ name, email, amount, currency, rejectionReason, signupUrl }) {
  signupUrl = signupUrl || 'https://gluckstudentsportal.com/signup/apply';
  const curr = String(currency || 'INR').toUpperCase();
  const amt = Number(amount);
  const amountLine =
    Number.isFinite(amt) && amt > 0
      ? `<tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-weight:700;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Declared amount</td>
          <td style="padding:10px 16px;color:#1e293b;font-size:15px;border-top:1px solid #e2e8f0;">${escapeHtml(curr)} ${amt.toLocaleString('en-IN')}</td>
        </tr>`
      : '';
  const reasonBlock = rejectionReason?.trim()
    ? `<div style="background:#fff5f5;border-left:4px solid #dc2626;border-radius:8px;padding:14px 18px;margin:0 0 20px;">
        <p style="margin:0 0 6px;font-weight:700;color:#991b1b;font-size:14px;">Reason from our finance team</p>
        <p style="margin:0;color:#444;font-size:15px;line-height:1.55;">${escapeHtml(rejectionReason.trim())}</p>
      </div>`
    : `<p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
        Please review your payment details and upload a corrected screenshot using the link below.
      </p>`;

  return {
    subject: 'Signup Payment Update — Glück Global',
    html: emailHeader('Payment Not Approved') + `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        Hello <strong>${escapeHtml(name)}</strong>,
      </p>
      <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.6;">
        Thank you for registering with Glück Global. After reviewing your payment proof, we were unable to approve your signup at this time.
      </p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-weight:700;color:#64748b;font-size:13px;width:140px;">Email</td>
          <td style="padding:10px 16px;color:#1e293b;font-size:15px;">${escapeHtml(email)}</td>
        </tr>
        ${amountLine}
      </table>
      ${reasonBlock}
      <p style="margin:0 0 8px;color:#444;font-size:14px;">You can return to the signup page, correct your payment details, and submit a new proof:</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr><td align="center" style="padding:12px 0 28px;">
          <a href="${signupUrl}" style="display:inline-block;background:linear-gradient(135deg,#b91c1c,#dc2626);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Re-submit payment proof →
          </a>
        </td></tr>
      </table>
      <p style="margin:0;color:#9ca3af;font-size:12px;">If you believe this is a mistake, contact us at info@gluckglobal.com.</p>
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
 * Reminder for incomplete journey-week tasks (language tracking admin).
 * @param {Array<{ day: number, incompleteTasks: object[] }>} daysWithTasks
 */
function buildJourneyWeekReminderEmail({
  name,
  week,
  weekStartDay,
  weekEndDay,
  currentCourseDay,
  daysWithTasks,
  totalIncomplete,
  loginUrl,
}) {
  const days = Array.isArray(daysWithTasks) ? daysWithTasks : [];
  const weekNum = Number(week);
  const studentDay = Number(currentCourseDay);

  const daysHtml = days
    .map((d) => {
      const tasks = Array.isArray(d.incompleteTasks) ? d.incompleteTasks : [];
      const taskRows = tasks
        .map(
          (t, i) => `
        <tr>
          <td style="padding:8px 12px;border-top:1px solid #e2e8f0;vertical-align:top;width:24px;color:#6c3fc5;font-weight:700;">${i + 1}.</td>
          <td style="padding:8px 12px;border-top:1px solid #e2e8f0;color:#1e293b;font-size:14px;font-weight:600;">${escapeHtml(t.title || 'Task')}</td>
        </tr>`,
        )
        .join('');
      return `
      <tr>
        <td colspan="2" style="padding:14px 16px 6px;background:#f8fafc;color:#475569;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">
          Day ${d.day}
        </td>
      </tr>
      ${taskRows}`;
    })
    .join('');

  const rangeLabel =
    Number.isFinite(weekStartDay) && Number.isFinite(weekEndDay)
      ? `Days ${weekStartDay}–${weekEndDay}`
      : `Week ${weekNum}`;

  return {
    subject: `Reminder: Complete your Week ${weekNum} pending tasks (${totalIncomplete} remaining)`,
    html:
      emailHeader('Weekly Progress Reminder') +
      `
      <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
        Hello <strong>${escapeHtml(name)}</strong>,
      </p>
      <p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6;">
        You are on <strong>Day ${studentDay}</strong> of your course. You still have
        <strong>${totalIncomplete}</strong> incomplete task${totalIncomplete === 1 ? '' : 's'} from
        <strong>Week ${weekNum}</strong> (${rangeLabel}) that need your attention:
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
             style="margin:0 0 24px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        ${daysHtml}
      </table>
      <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.6;">
        Please complete the exercise(s) and module(s) listed above so you stay on track with your batch.
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

/**
 * Motivational re-engagement email for students who haven't logged in for 3+ days.
 * @param {object} params
 * @param {string} params.name      - Student's full name
 * @param {number} params.daysSince - Number of days since last login
 * @param {string} params.loginUrl  - Portal login URL
 */
function buildPortalAbsenceReminderEmail({ name, daysSince, loginUrl, reminderNumber = 1 }) {
  const messages = [
    {
      headline: 'You\'re one step away from your dream! 🌟',
      body: `German fluency doesn't come by waiting — it comes by showing up, one day at a time. You were doing so well, and we don't want you to lose that momentum. Log in today and pick up right where you left off!`,
    },
    {
      headline: 'We miss you in class! 💙',
      body: `Your German journey is waiting for you. Every session you attend brings you closer to the life you've been working toward. Even 15 minutes today can make a huge difference — come back and keep going!`,
    },
    {
      headline: 'Don\'t let your hard work fade! 🔥',
      body: `You've already put so much effort into learning German. Missing a few days is completely normal — but the key is getting back on track quickly. Log in now and let's continue building toward your goal together.`,
    },
    {
      headline: 'Your German dream is still within reach! 🎯',
      body: `Every great language learner faces moments of pause — but the ones who succeed are the ones who choose to come back. We believe in you. Log in today, even for a short session, and feel that progress reignite!`,
    },
  ];

  const pick = messages[(Math.max(1, reminderNumber) - 1) % messages.length];

  return {
    subject: `We miss you, ${name}! Come back to your German journey 💙`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>We miss you!</title>
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

          <!-- Illustration row -->
          <tr>
            <td style="background:linear-gradient(135deg,#f3eeff 0%,#ede9fe 100%);padding:28px 40px;text-align:center;">
              <p style="margin:0;font-size:48px;line-height:1;">✈️</p>
              <p style="margin:8px 0 0;color:#6c3fc5;font-size:18px;font-weight:700;">
                ${escapeHtml(pick.headline)}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Hello <strong>${escapeHtml(name)}</strong>,
              </p>
              <p style="margin:0 0 20px;color:#444;font-size:15px;line-height:1.7;">
                ${escapeHtml(pick.body)}
              </p>

              <!-- Absence info pill -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:13px;font-weight:600;padding:8px 20px;border-radius:20px;border:1px solid #fcd34d;">
                      You haven't visited the portal in <strong>${daysSince} day${daysSince !== 1 ? 's' : ''}</strong>
                    </span>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <a href="${escapeHtml(loginUrl)}"
                       style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:16px 44px;border-radius:10px;letter-spacing:0.3px;">
                      Log In &amp; Continue Learning →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#64748b;font-size:13px;line-height:1.6;text-align:center;">
                Your team at Glück Global is rooting for you every step of the way. 🙌
              </p>
            </td>
          </tr>

          ${emailFooter()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

/**
 * Nightly digest email for the Language Team listing every student with
 * 2+ consecutive class absences.
 *
 * @param {object}   params
 * @param {Array}    params.absentStudents  - Array of student absence records
 * @param {string}   params.absentStudents[].name
 * @param {string}   params.absentStudents[].email
 * @param {string}   params.absentStudents[].batch
 * @param {number}   params.absentStudents[].streak          - consecutive absences count
 * @param {string}   [params.absentStudents[].lastAttended]  - ISO date string of last attended class, or null
 * @param {string}   [params.absentStudents[].assignedTeacher] - teacher's name
 * @param {string}   params.reportDate  - human-readable date string shown in the email header
 */
function buildConsecutiveAbsenceLanguageTeamEmail({ absentStudents = [], reportDate }) {
  const dateLabel = escapeHtml(reportDate || new Date().toDateString());

  const tableRows = absentStudents
    .map((s, idx) => {
      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8f5ff';
      const streakColor = s.streak >= 5 ? '#dc2626' : s.streak >= 3 ? '#d97706' : '#6c3fc5';
      const lastAttendedLabel = s.lastAttended
        ? escapeHtml(new Date(s.lastAttended).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))
        : '<span style="color:#9ca3af;font-style:italic;">Never recorded</span>';
      return `
      <tr style="background:${rowBg};">
        <td style="padding:11px 14px;font-size:13px;color:#1e293b;border-bottom:1px solid #ede9fe;">${escapeHtml(s.name)}</td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;">${escapeHtml(s.email || '—')}</td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;text-align:center;">
          <span style="display:inline-block;background:#ede9fe;color:#6c3fc5;font-weight:700;font-size:12px;padding:3px 10px;border-radius:20px;">
            ${escapeHtml(String(s.batch || '—'))}
          </span>
        </td>
        <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #ede9fe;text-align:center;">
          <span style="display:inline-block;background:#fff1f2;color:${streakColor};font-weight:800;font-size:13px;padding:3px 12px;border-radius:20px;border:1px solid ${streakColor}33;">
            ${s.streak} class${s.streak !== 1 ? 'es' : ''}
          </span>
        </td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;text-align:center;">${lastAttendedLabel}</td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;">${escapeHtml(s.assignedTeacher || '—')}</td>
      </tr>`;
    })
    .join('');

  const totalCount = absentStudents.length;
  const highRisk = absentStudents.filter((s) => s.streak >= 4).length;

  return {
    subject: `[Action Required] ${totalCount} Student${totalCount !== 1 ? 's' : ''} with 2+ Consecutive Absences — ${dateLabel}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Consecutive Absence Report</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="700" cellspacing="0" cellpadding="0"
               style="max-width:700px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
                Glück Global — Language Team
              </h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.88);font-size:14px;">
                Consecutive Absence Report &nbsp;·&nbsp; ${dateLabel}
              </p>
            </td>
          </tr>

          <!-- Summary pills -->
          <tr>
            <td style="background:#f3eeff;padding:20px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <span style="display:inline-block;background:#6c3fc5;color:#fff;font-size:13px;font-weight:700;padding:8px 22px;border-radius:20px;margin:0 6px;">
                      ${totalCount} student${totalCount !== 1 ? 's' : ''} flagged
                    </span>
                    ${
                      highRisk > 0
                        ? `<span style="display:inline-block;background:#dc2626;color:#fff;font-size:13px;font-weight:700;padding:8px 22px;border-radius:20px;margin:0 6px;">
                        ${highRisk} high-risk (4+ absences)
                      </span>`
                        : ''
                    }
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0 0;text-align:center;">
                    <p style="margin:0;color:#6c3fc5;font-size:13px;line-height:1.5;">
                      The following students have been absent from <strong>2 or more consecutive</strong> live classes.<br/>
                      Please follow up with them at the earliest.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:28px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                <!-- Table header -->
                <thead>
                  <tr style="background:#6c3fc5;">
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Student Name</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Email</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Batch</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Consecutive Absences</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Last Attended</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Assigned Teacher</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows || `
                  <tr>
                    <td colspan="6" style="padding:24px;text-align:center;color:#9ca3af;font-size:14px;">
                      No students with consecutive absences today. 🎉
                    </td>
                  </tr>`}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer note -->
          <tr>
            <td style="padding:0 32px 28px;">
              <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:16px;">
                This report is auto-generated every night at 12:00 AM IST by the Glück Global Student Portal.<br/>
                Students are included if they missed their last 2 or more consecutive live classes.
              </p>
            </td>
          </tr>

          <!-- Brand footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">© Glück Global Pvt Ltd · <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a></p>
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

/**
 * Morning digest for Language Team — students who missed 2+ live classes in the last 10 days.
 * @param {object} params
 * @param {Array<{ name: string, batch: string, missedCount: number, missedDates: Date[] }>} params.flaggedStudents
 * @param {Array<{ name: string, batch: string, batchClassDays: number }>} [params.unscheduledStudents]
 *        Active students whose batch held classes but who were on none of the rosters.
 * @param {string} params.reportDate
 * @param {number} [params.lookbackDays=10]
 */
function buildMissedLiveClassMorningReportEmail({
  flaggedStudents = [],
  unscheduledStudents = [],
  reportDate,
  lookbackDays = 10,
}) {
  const dateLabel = escapeHtml(reportDate || new Date().toDateString());

  const tableRows = flaggedStudents
    .map((s, idx) => {
      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8f5ff';
      const countColor = s.missedCount >= 5 ? '#dc2626' : s.missedCount >= 3 ? '#d97706' : '#6c3fc5';
      const lastTwoMissed = (s.missedDates || [])
        .slice(0, 2)
        .map((d) =>
          new Date(d).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            timeZone: 'Asia/Colombo',
          })
        )
        .join(' · ');

      return `
      <tr style="background:${rowBg};">
        <td style="padding:11px 14px;font-size:13px;color:#1e293b;border-bottom:1px solid #ede9fe;font-weight:600;">${escapeHtml(s.name)}</td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;text-align:center;">
          <span style="display:inline-block;background:#ede9fe;color:#6c3fc5;font-weight:700;font-size:12px;padding:3px 10px;border-radius:20px;">
            ${escapeHtml(String(s.batch || '—'))}
          </span>
        </td>
        <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #ede9fe;text-align:center;">
          <span style="display:inline-block;background:#fff1f2;color:${countColor};font-weight:800;font-size:13px;padding:3px 12px;border-radius:20px;border:1px solid ${countColor}33;">
            ${s.missedCount}
          </span>
        </td>
        <td style="padding:11px 14px;font-size:13px;color:#374151;border-bottom:1px solid #ede9fe;text-align:center;white-space:nowrap;">
          ${escapeHtml(lastTwoMissed || '—')}
        </td>
      </tr>`;
    })
    .join('');

  const totalCount = flaggedStudents.length;

  const unscheduledSection = unscheduledStudents.length
    ? `
          <tr>
            <td style="padding:0 32px 28px;">
              <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:16px 18px;">
                <p style="margin:0 0 10px;color:#92400e;font-size:13px;font-weight:700;">
                  ⚠️ ${unscheduledStudents.length} active student${unscheduledStudents.length !== 1 ? 's' : ''} not on any class roster
                </p>
                <p style="margin:0 0 12px;color:#92400e;font-size:12px;line-height:1.5;">
                  These students' batches held live classes in the last ${lookbackDays} days, but they were not scheduled into any of them — please check their class assignments.
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  ${unscheduledStudents
                    .map(
                      (s) => `
                  <tr>
                    <td style="padding:6px 8px;font-size:13px;color:#78350f;border-bottom:1px solid #fde68a;font-weight:600;">${escapeHtml(s.name)}</td>
                    <td style="padding:6px 8px;font-size:12px;color:#92400e;border-bottom:1px solid #fde68a;text-align:center;">Batch ${escapeHtml(String(s.batch || '—'))}</td>
                    <td style="padding:6px 8px;font-size:12px;color:#92400e;border-bottom:1px solid #fde68a;text-align:right;">${s.batchClassDays} class day${s.batchClassDays !== 1 ? 's' : ''} held</td>
                  </tr>`
                    )
                    .join('')}
                </table>
              </div>
            </td>
          </tr>`
    : '';

  return {
    subject: `[Morning Report] ${totalCount} Student${totalCount !== 1 ? 's' : ''} with 2+ Missed Live Classes (Last ${lookbackDays} Days) — ${dateLabel}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Missed Live Class Report</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="760" cellspacing="0" cellpadding="0"
               style="max-width:760px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
                Glück Global — Missed Live Class Report
              </h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.88);font-size:14px;">
                Morning digest &nbsp;·&nbsp; ${dateLabel}
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#f3eeff;padding:20px 40px;text-align:center;">
              <span style="display:inline-block;background:#6c3fc5;color:#fff;font-size:13px;font-weight:700;padding:8px 22px;border-radius:20px;">
                ${totalCount} student${totalCount !== 1 ? 's' : ''} flagged
              </span>
              <p style="margin:12px 0 0;color:#6c3fc5;font-size:13px;line-height:1.5;">
                Students listed below have missed <strong>2 or more live classes</strong> in the <strong>last ${lookbackDays} days</strong> (fully absent, 0% attendance).<br/>
                Please follow up with them at the earliest.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#6c3fc5;">
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Student Name</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Batch</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Classes Missed</th>
                    <th style="padding:11px 14px;font-size:12px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Last Missed Classes</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows || `
                  <tr>
                    <td colspan="4" style="padding:24px;text-align:center;color:#9ca3af;font-size:14px;">
                      No students with 2+ missed live classes in the last ${lookbackDays} days today. 🎉
                    </td>
                  </tr>`}
                </tbody>
              </table>
            </td>
          </tr>
${unscheduledSection}
          <tr>
            <td style="padding:0 32px 28px;">
              <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:16px;">
                This report is auto-generated every morning at 10:00 AM IST by the Glück Global Student Portal.<br/>
                Only live classes from the last ${lookbackDays} days are counted. A class counts as missed when the student was scheduled for it, attendance was recorded, and the student was fully absent (0% participation). At most one missed class is counted per day.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#f8fafc;padding:16px 40px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">© Glück Global Pvt Ltd · <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a></p>
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

/**
 * Milestone day absence alert — sent to the language team when students
 * miss their Day 1, 3, or 6 live class.
 *
 * @param {object} params
 * @param {Array}  params.groups     - Array of { batchName, courseDay, dateLabel, absentStudents: [{name, email}] }
 * @param {string} params.reportDate - Human-readable report date
 */
function buildMilestoneAbsenceAlertEmail({ groups, reportDate }) {
  const totalAbsent = groups.reduce((s, g) => s + g.absentStudents.length, 0);

  const groupRows = groups
    .map(
      (g) => `
      <!-- Group header -->
      <tr>
        <td colspan="2" style="padding:14px 0 6px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#6c3fc5;text-transform:uppercase;letter-spacing:0.5px;">
            ${escapeHtml(g.batchName)} &nbsp;·&nbsp; Day ${escapeHtml(String(g.courseDay))}
            &nbsp;<span style="font-weight:400;color:#94a3b8;">(${escapeHtml(g.dateLabel)})</span>
          </p>
        </td>
      </tr>
      ${g.absentStudents
        .map(
          (s, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:10px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.email)}
        </td>
      </tr>`,
        )
        .join('')}`,
    )
    .join('');

  return {
    subject: `⚠️ Day ${groups.map((g) => g.courseDay).join('/')} Absence Alert – ${totalAbsent} student${totalAbsent !== 1 ? 's' : ''} missed class`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Milestone Absence Alert</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="620" cellspacing="0" cellpadding="0"
               style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global · Language Team</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Milestone Absence Alert</p>
            </td>
          </tr>

          <!-- Alert banner -->
          <tr>
            <td style="background:#fff7ed;padding:18px 40px;border-bottom:2px solid #fed7aa;">
              <p style="margin:0;font-size:15px;color:#9a3412;font-weight:600;">
                ⚠️ ${totalAbsent} student${totalAbsent !== 1 ? 's' : ''} missed a milestone live class on ${escapeHtml(reportDate)}
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#c2410c;">
                Milestone days tracked: Day 1, Day 3, Day 6
              </p>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:24px 32px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                <thead>
                  <tr style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);">
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Student Name</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Email</th>
                  </tr>
                </thead>
                <tbody>
                  ${groupRows || `<tr><td colspan="2" style="padding:20px;text-align:center;color:#9ca3af;font-size:14px;">No absences recorded.</td></tr>`}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Auto-generated by the Glück Global Portal · ${escapeHtml(reportDate)}<br/>
                © Glück Global Pvt Ltd ·
                <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a>
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

/**
 * Weekly missed-classes digest — sent every Monday to the language team.
 *
 * @param {object} params
 * @param {string} params.weekRange    - e.g. "23 Jun – 29 Jun 2026"
 * @param {Array}  params.students     - Array of { name, batch, missedCount, missedDays: [{courseDay, dateLabel, topic}] }
 * @param {string} params.reportDate   - Human-readable run date
 */
function buildWeeklyMissedClassesEmail({ weekRange, students, reportDate }) {
  const tableRows = students
    .map((s, i) => {
      const dayPills = s.missedDays
        .map(
          (d) =>
            `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600;padding:3px 8px;border-radius:10px;margin:2px 2px 2px 0;border:1px solid #fcd34d;">
              Day ${escapeHtml(String(d.courseDay))} · ${escapeHtml(d.dateLabel)}
            </span>`,
        )
        .join('');

      return `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:11px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;font-weight:600;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:11px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.batch || '—')}
        </td>
        <td style="padding:11px 12px;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:center;">
          <span style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:13px;font-weight:700;padding:3px 12px;border-radius:12px;">
            ${s.missedCount}
          </span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
          ${dayPills}
        </td>
      </tr>`;
    })
    .join('');

  return {
    subject: `📊 Weekly Absence Summary – ${weekRange} – ${students.length} student${students.length !== 1 ? 's' : ''} with missed classes`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Weekly Absence Summary</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="700" cellspacing="0" cellpadding="0"
               style="max-width:700px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global · Language Team</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Weekly Absence Summary</p>
            </td>
          </tr>

          <!-- Week range banner -->
          <tr>
            <td style="background:#eff6ff;padding:16px 40px;border-bottom:2px solid #bfdbfe;">
              <p style="margin:0;font-size:15px;color:#1e40af;font-weight:600;">
                📅 Week: ${escapeHtml(weekRange)}
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#3b82f6;">
                ${students.length} student${students.length !== 1 ? 's' : ''} missed at least one live class this week
              </p>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:24px 32px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                <thead>
                  <tr style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);">
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;width:25%;">Student</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;width:18%;">Batch</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;width:10%;">Missed</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Classes Missed</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows || `<tr><td colspan="4" style="padding:24px;text-align:center;color:#9ca3af;font-size:14px;">No missed classes this week. 🎉</td></tr>`}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Auto-generated every Monday · Report for ${escapeHtml(weekRange)}<br/>
                © Glück Global Pvt Ltd ·
                <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a>
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

/**
 * Day 6 weekly test low-score alert — sent when a student scores < 60% on the weekly test.
 *
 * @param {object} params
 * @param {Array}  params.students  - [{ name, email, batch, score, exerciseTitle }]
 * @param {string} params.reportDate
 */
function buildWeeklyTestLowScoreEmail({ students, reportDate }) {
  const tableRows = students
    .map((s, i) => {
      const scoreColor = s.score < 40 ? '#991b1b' : '#92400e';
      const scoreBg    = s.score < 40 ? '#fee2e2' : '#fef3c7';
      return `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:11px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;font-weight:600;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:11px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.batch)}
        </td>
        <td style="padding:11px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.email)}
        </td>
        <td style="padding:11px 12px;text-align:center;border-bottom:1px solid #e2e8f0;">
          <span style="display:inline-block;background:${scoreBg};color:${scoreColor};font-size:13px;font-weight:700;padding:4px 14px;border-radius:12px;">
            ${s.score}%
          </span>
        </td>
      </tr>`;
    })
    .join('');

  return {
    subject: `⚠️ Day 6 Weekly Test – ${students.length} student${students.length !== 1 ? 's' : ''} scored below 60%`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Weekly Test Low Score Alert</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="660" cellspacing="0" cellpadding="0"
               style="max-width:660px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global · Language Team</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Day 6 Weekly Test · Low Score Alert</p>
            </td>
          </tr>

          <!-- Alert banner -->
          <tr>
            <td style="background:#fff7ed;padding:16px 40px;border-bottom:2px solid #fed7aa;">
              <p style="margin:0;font-size:15px;color:#9a3412;font-weight:600;">
                ⚠️ ${students.length} student${students.length !== 1 ? 's' : ''} scored below 60% on the Day 6 Weekly Test
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#c2410c;">
                These students may need additional support before progressing.
              </p>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:24px 32px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                <thead>
                  <tr style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);">
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Student</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Batch</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Email</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Score</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows || `<tr><td colspan="4" style="padding:20px;text-align:center;color:#9ca3af;">No data.</td></tr>`}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Pass threshold: 60% · Auto-generated on ${escapeHtml(reportDate)}<br/>
                © Glück Global Pvt Ltd · <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a>
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

/**
 * Day 6 content-not-completed alert — students who reached Day 8 without finishing Day 6 content.
 *
 * @param {object} params
 * @param {Array}  params.students  - [{ name, email, batch, completionPct, completedItems, totalItems, currentDay }]
 * @param {string} params.reportDate
 */
function buildDay6CompletionCheckEmail({ students, reportDate }) {
  const tableRows = students
    .map((s, i) => {
      const pct = s.completionPct;
      const barColor = pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
      return `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:11px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;font-weight:600;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:11px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.batch)}
        </td>
        <td style="padding:11px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.email)}
        </td>
        <td style="padding:11px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">
          <span style="font-size:12px;color:#64748b;">${s.completedItems}/${s.totalItems}</span>
        </td>
        <td style="padding:11px 16px;border-bottom:1px solid #e2e8f0;min-width:140px;">
          <div style="background:#e2e8f0;border-radius:4px;height:10px;width:100%;overflow:hidden;">
            <div style="width:${pct}%;background:${barColor};height:10px;border-radius:4px;"></div>
          </div>
          <p style="margin:3px 0 0;font-size:11px;color:#64748b;text-align:right;">${pct}%</p>
        </td>
      </tr>`;
    })
    .join('');

  return {
    subject: `📋 Day 6 Completion Alert – ${students.length} student${students.length !== 1 ? 's' : ''} haven't finished Day 6 activities`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Day 6 Completion Alert</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="700" cellspacing="0" cellpadding="0"
               style="max-width:700px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global · Language Team</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Day 6 Activity Completion · End-of-Week-1 Check</p>
            </td>
          </tr>

          <!-- Alert banner -->
          <tr>
            <td style="background:#fef9c3;padding:16px 40px;border-bottom:2px solid #fde047;">
              <p style="margin:0;font-size:15px;color:#713f12;font-weight:600;">
                📋 ${students.length} student${students.length !== 1 ? 's' : ''} moved to Day 8 without completing all Day 6 activities
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#92400e;">
                Deadline: End of Day 7 · Activities include exercises and DG Bot modules on journey Day 6.
              </p>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:24px 32px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                     style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
                <thead>
                  <tr style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);">
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Student</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Batch</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;">Email</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:center;letter-spacing:0.5px;text-transform:uppercase;">Done</th>
                    <th style="padding:11px 12px;font-size:12px;font-weight:700;color:#fff;text-align:left;letter-spacing:0.5px;text-transform:uppercase;min-width:140px;">Completion</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows || `<tr><td colspan="5" style="padding:20px;text-align:center;color:#9ca3af;">No data.</td></tr>`}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Counts exercises + DG Bot modules on journey Day 6 · Auto-generated on ${escapeHtml(reportDate)}<br/>
                © Glück Global Pvt Ltd · <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a>
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

/**
 * Day-1 batch launch reminder email.
 * @param {object} params
 * @param {string} params.name       - Student's name
 * @param {string} params.batchName  - Batch identifier
 * @param {string} params.type       - 'eve' (day before) or 'day1' (launch day)
 * @param {string} params.startDate  - Formatted date string e.g. "30 June 2026"
 */
function buildBatchDay1ReminderEmail({ name, batchName, type, startDate }) {
  const isEve = type === 'eve';

  const subject = isEve
    ? `🎉 Tomorrow is your Day 1 – Are you ready, ${name.split(' ')[0]}?`
    : `🚀 Today is Day 1 – Your German journey begins NOW!`;

  const headline = isEve
    ? 'Your live classes start tomorrow! 🎉'
    : 'Today is Day 1 – Let\'s go! 🚀';

  const emoji = isEve ? '🗓️' : '🎯';

  const bodyText = isEve
    ? `Get a good night's sleep and come ready to learn — tomorrow, <strong>${escapeHtml(startDate)}</strong>, is your very first Day 1 of live German classes! Your teacher and classmates are all set and waiting for you. We are so excited to have you on this journey.`
    : `This is it — <strong>${escapeHtml(startDate)}</strong> is your official Day 1! Your live German classes start today. Log in to the portal, check your timetable, and join your first class. You've been waiting for this moment — now go make it count!`;

  const pillText = isEve
    ? `Live classes begin tomorrow · ${escapeHtml(startDate)}`
    : `Day 1 is TODAY · ${escapeHtml(startDate)}`;

  const pillColor = isEve ? '#ecfdf5' : '#eff6ff';
  const pillBorder = isEve ? '#6ee7b7' : '#93c5fd';
  const pillTextColor = isEve ? '#065f46' : '#1e40af';

  const loginUrl = process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL}/login`
    : 'https://gluckstudentsportal.com/login';

  return {
    subject,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isEve ? 'Day 1 Tomorrow!' : 'Day 1 Today!'}</title>
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

          <!-- Hero banner -->
          <tr>
            <td style="background:linear-gradient(135deg,#f3eeff 0%,#ede9fe 100%);padding:28px 40px;text-align:center;">
              <p style="margin:0;font-size:52px;line-height:1;">${emoji}</p>
              <p style="margin:10px 0 0;color:#6c3fc5;font-size:20px;font-weight:700;">
                ${escapeHtml(headline)}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Hello <strong>${escapeHtml(name)}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#444;font-size:15px;line-height:1.7;">
                ${bodyText}
              </p>

              <!-- Date pill -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <span style="display:inline-block;background:${pillColor};color:${pillTextColor};font-size:13px;font-weight:600;padding:10px 22px;border-radius:20px;border:1px solid ${pillBorder};">
                      ${escapeHtml(pillText)}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- CTA button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:0 0 8px;">
                    <a href="${loginUrl}"
                       style="display:inline-block;background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.3px;">
                      ${isEve ? 'Check Your Timetable' : 'Go to Portal Now'}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;">
                Batch: <strong style="color:#6c3fc5;">${escapeHtml(batchName)}</strong>
              </p>
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                © Glück Global Pvt Ltd ·
                <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a>
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

/**
 * Short daily task reminder sent at 12 PM when a student hasn't completed today's exercises / DG bot.
 *
 * @param {object} params
 * @param {string} params.name            - Student name
 * @param {number} params.day             - Journey day number
 * @param {Array}  params.incompleteTasks - [{ kind, title }] (max 3 shown)
 * @param {string} params.portalUrl       - Portal base URL
 */
function buildDailyTaskReminderEmail({ name, day, incompleteTasks = [], portalUrl }) {
  const loginUrl = `${(portalUrl || 'https://gluckstudentsportal.com').replace(/\/$/, '')}/login`;
  const shown = (incompleteTasks || []).slice(0, 3);
  const taskListHtml = shown.length
    ? `<ul style="margin:12px 0 20px;padding-left:22px;color:#374151;font-size:15px;line-height:1.8;">
        ${shown.map((t) => `<li>${escapeHtml(t.title || 'Task')}</li>`).join('')}
       </ul>`
    : '';

  return {
    subject: `Complete today's Day ${day} tasks — Glück Global`,
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0"
               style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#000e89 0%,#6c3fc5 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global</h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Daily Task Reminder</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Hi <strong>${escapeHtml(name)}</strong>,
              </p>
              <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
                You still have tasks left to complete for <strong>Day ${day}</strong>. Finish them before the day ends to keep your streak and progress on track!
              </p>
              ${taskListHtml}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${loginUrl}"
                       style="display:inline-block;background:#000e89;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;">
                      Open Portal &amp; Complete Tasks
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
                Consistency is key — every task you complete brings you closer to fluency. See you in the portal!
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8f9ff;padding:18px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                © Glück Global Pvt Ltd · <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Hi ${name},\n\nYou still have tasks left to complete for Day ${day}. Log in to the portal and finish them today:\n${loginUrl}\n\nKeep up the great work!\n\n— Glück Global`,
  };
}

/**
 * Weekly Test Incomplete Reminder — sent directly to the student at 8 AM
 * on the morning of Day 7 (or any weekly boundary day) when they haven't
 * completed the Weekly Test from the previous day.
 *
 * @param {object} params
 * @param {string} params.name         - Student's display name
 * @param {number} params.testDay      - The courseDay of the missed weekly test (e.g. 6)
 * @param {number} params.currentDay   - Student's current courseDay (e.g. 7)
 * @param {string[]} params.missingItems - Titles of uncompleted weekly-test items
 * @param {string} params.portalUrl    - Portal base URL
 */
function buildWeeklyTestIncompleteReminderEmail({ name, testDay, currentDay, missingItems = [], portalUrl }) {
  const loginUrl = `${(portalUrl || 'https://gluckstudentsportal.com').replace(/\/$/, '')}/login`;
  const week = Math.ceil(currentDay / 7);
  const itemListHtml = missingItems.length
    ? `<ul style="margin:12px 0 20px;padding-left:22px;color:#374151;font-size:15px;line-height:1.8;">
        ${missingItems.slice(0, 5).map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
       </ul>`
    : '';

  return {
    subject: `⏰ Don't forget your Week ${week} Test — complete it to unlock Day ${currentDay} modules!`,
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0"
               style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#000e89 0%,#6c3fc5 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global</h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Weekly Test Reminder</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 16px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Hi <strong>${escapeHtml(name)}</strong>,
              </p>
              <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
                It looks like you haven't completed your <strong>Week ${week} Weekly Test</strong> from Day ${testDay} yet.
                Please complete it to fully unlock your Day ${currentDay} modules and keep your learning journey on track!
              </p>
              ${itemListHtml}
              <div style="background:#fff8e1;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 18px;margin:0 0 24px;">
                <p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;">
                  ⚠️ <strong>Don't wait!</strong> Completing your weekly test helps you consolidate everything you've learned and prepares you for the next week's content.
                </p>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:4px 0 24px;">
                    <a href="${loginUrl}"
                       style="display:inline-block;background:#000e89;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;">
                      Complete Weekly Test Now
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
                Consistency is the key to fluency — every test you complete brings you one step closer to your goal!
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8f9ff;padding:18px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                © Glück Global Pvt Ltd · <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Hi ${name},\n\nYou haven't completed your Week ${week} Weekly Test from Day ${testDay} yet. Please complete it to unlock your Day ${currentDay} modules!\n\nLog in here: ${loginUrl}\n\n— Glück Global`,
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
  buildJobApplicationReceivedAdminEmail,
  buildSignupApprovedWelcomeEmail,
  buildSignupRejectedEmail,
  buildDailyTaskReminderEmail,
  buildJourneyDayReminderEmail,
  buildJourneyWeekReminderEmail,
  buildPortalAbsenceReminderEmail,
  buildConsecutiveAbsenceLanguageTeamEmail,
  buildMissedLiveClassMorningReportEmail,
  buildBatchDay1ReminderEmail,
  buildMilestoneAbsenceAlertEmail,
  buildWeeklyMissedClassesEmail,
  buildWeeklyTestLowScoreEmail,
  buildDay6CompletionCheckEmail,
  buildLateJoinEarlyExitEmail,
  buildWeeklyTestIncompleteReminderEmail,
};

/**
 * Late join / early exit alert for Day 1 and Day 3 classes.
 *
 * @param {object} params
 * @param {string} params.batchName
 * @param {number} params.courseDay
 * @param {string} params.classDate        - e.g. "Mon, 30 Jun 2026"
 * @param {string} params.classTopic       - meeting topic/title
 * @param {string} params.classDuration    - e.g. "120 min"
 * @param {Array}  params.lateJoiners      - [{ name, email, lateByMinutes }]
 * @param {Array}  params.earlyExiters     - [{ name, email, attendedMinutes, leftEarlyByMinutes, attendedPct }]
 * @param {string} params.reportDate
 */
function buildLateJoinEarlyExitEmail({
  batchName, courseDay, classDate, classTopic, classDuration,
  lateJoiners, earlyExiters, reportDate,
}) {
  const hasLate = lateJoiners.length > 0;
  const hasEarly = earlyExiters.length > 0;

  const lateRows = lateJoiners
    .map((s, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:10px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;font-weight:600;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.email)}
        </td>
        <td style="padding:10px 12px;text-align:center;border-bottom:1px solid #e2e8f0;">
          <span style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:12px;font-weight:700;padding:4px 12px;border-radius:12px;">
            +${s.lateByMinutes} min late
          </span>
        </td>
      </tr>`)
    .join('');

  const earlyRows = earlyExiters
    .map((s, i) => {
      const pct = s.attendedPct;
      const barColor = pct >= 60 ? '#f59e0b' : '#ef4444';
      return `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:10px 12px;font-size:14px;color:#1a1a2e;border-bottom:1px solid #e2e8f0;font-weight:600;">
          ${escapeHtml(s.name)}
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">
          ${escapeHtml(s.email)}
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:center;">
          ${s.attendedMinutes} min
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">
          <span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;padding:4px 12px;border-radius:12px;">
            left ${s.leftEarlyByMinutes} min early
          </span>
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;min-width:120px;">
          <div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden;">
            <div style="width:${pct}%;background:${barColor};height:8px;border-radius:4px;"></div>
          </div>
          <p style="margin:2px 0 0;font-size:11px;color:#64748b;text-align:right;">${pct}%</p>
        </td>
      </tr>`;
    })
    .join('');

  const totalFlags = lateJoiners.length + earlyExiters.length;
  const dayLabel = `Day ${courseDay}`;

  return {
    subject: `🕐 ${dayLabel} Class Alert – ${lateJoiners.length} late join${lateJoiners.length !== 1 ? 's' : ''}, ${earlyExiters.length} early exit${earlyExiters.length !== 1 ? 's' : ''} · ${escapeHtml(batchName)}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${dayLabel} Class Attendance Alert</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="700" cellspacing="0" cellpadding="0"
               style="max-width:700px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Glück Global · Language Team</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">${dayLabel} Class · Late Join &amp; Early Exit Report</p>
            </td>
          </tr>

          <!-- Class summary pill -->
          <tr>
            <td style="background:#f0ebff;padding:16px 40px;border-bottom:2px solid #c4b5fd;">
              <p style="margin:0;font-size:15px;color:#4c1d95;font-weight:600;">
                📅 ${escapeHtml(batchName)} · ${dayLabel} &nbsp;|&nbsp; ${escapeHtml(classDate)}
              </p>
              <p style="margin:4px 0 0;font-size:13px;color:#6d28d9;">
                ${escapeHtml(classTopic || 'Live Class')} &nbsp;·&nbsp; Duration: ${escapeHtml(classDuration)}
                &nbsp;·&nbsp; <strong>${totalFlags}</strong> student${totalFlags !== 1 ? 's' : ''} flagged
              </p>
            </td>
          </tr>

          <tr><td style="padding:0 32px;">

          ${hasLate ? `
          <!-- Late Joiners -->
          <p style="margin:24px 0 10px;font-size:14px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.5px;">
            🕐 Late Joiners (${lateJoiners.length})
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                 style="border-radius:8px;overflow:hidden;border:1px solid #fecaca;">
            <thead>
              <tr style="background:#fef2f2;">
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#991b1b;text-align:left;text-transform:uppercase;letter-spacing:0.4px;">Student</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#991b1b;text-align:left;text-transform:uppercase;letter-spacing:0.4px;">Email</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#991b1b;text-align:center;text-transform:uppercase;letter-spacing:0.4px;">Arrived</th>
              </tr>
            </thead>
            <tbody>${lateRows}</tbody>
          </table>` : ''}

          ${hasEarly ? `
          <!-- Early Exits -->
          <p style="margin:24px 0 10px;font-size:14px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">
            🚪 Early Exits (${earlyExiters.length})
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                 style="border-radius:8px;overflow:hidden;border:1px solid #fed7aa;">
            <thead>
              <tr style="background:#fff7ed;">
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#92400e;text-align:left;text-transform:uppercase;letter-spacing:0.4px;">Student</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#92400e;text-align:left;text-transform:uppercase;letter-spacing:0.4px;">Email</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#92400e;text-align:center;text-transform:uppercase;letter-spacing:0.4px;">Time In</th>
                <th style="padding:10px 12px;font-size:12px;font-weight:700;color:#92400e;text-align:center;text-transform:uppercase;letter-spacing:0.4px;">Left Early</th>
                <th style="padding:10px 14px;font-size:12px;font-weight:700;color:#92400e;text-align:left;text-transform:uppercase;letter-spacing:0.4px;min-width:120px;">Attended</th>
              </tr>
            </thead>
            <tbody>${earlyRows}</tbody>
          </table>` : ''}

          </td></tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;margin-top:8px;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                Late threshold: 10 min after class start · Early exit: left before 75% of class<br/>
                Auto-generated after ${dayLabel} class ends · ${escapeHtml(reportDate)}<br/>
                © Glück Global Pvt Ltd · <a href="https://gluckstudentsportal.com" style="color:#6c3fc5;">gluckstudentsportal.com</a>
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
