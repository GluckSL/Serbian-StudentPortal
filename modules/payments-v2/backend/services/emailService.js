/**
 * Payment Hub Email Service
 * Uses the existing nodemailer transporter if available in environment,
 * otherwise logs the email content.
 */
const nodemailer = require('nodemailer');

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  } else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
};

const sendMail = async ({ to, subject, html }) => {
  const t = getTransporter();
  if (!t) {
    console.log(`[EmailService] (no transport) To: ${to} | Subject: ${subject}`);
    return;
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_FROM || '"Gluck Global" <no-reply@gluckglobal.com>',
    to,
    subject,
    html,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Payment Approved Email — Motivational + Formal Template
// ─────────────────────────────────────────────────────────────────────────────
const sendPaymentApprovedEmail = async (student, submission) => {
  const { name, email } = student;
  const { paidAmount, currency, receiptNumber, paymentMethod, paymentType, requestRemarks, customType } = submission;

  const purposeLabel = requestRemarks || (customType ? `${paymentType} — ${customType}` : paymentType) || 'Course Payment';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f7fa; margin: 0; padding: 0; color: #212121; }
    .wrapper { max-width: 600px; margin: 32px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1a237e 0%, #283593 100%); color: white; padding: 32px 40px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
    .header p { margin: 8px 0 0; font-size: 15px; opacity: 0.88; }
    .check-badge { width: 64px; height: 64px; background: #4caf50; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 32px; margin-bottom: 16px; }
    .body { padding: 32px 40px; }
    .greeting { font-size: 17px; font-weight: 600; color: #1a237e; margin-bottom: 12px; }
    .msg { font-size: 15px; line-height: 1.65; color: #424242; margin-bottom: 24px; }
    .details-box { background: #f0f4ff; border-left: 4px solid #1a237e; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; }
    .details-box h3 { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #1a237e; }
    .detail-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .detail-row:last-child { margin-bottom: 0; }
    .detail-label { color: #757575; }
    .detail-value { font-weight: 600; color: #212121; }
    .purpose-highlight { background: #fff8e1; border: 1px solid #ffd54f; border-radius: 6px; padding: 12px 16px; margin-bottom: 24px; font-size: 14px; }
    .purpose-highlight strong { color: #e65100; }
    .motivation { background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%); border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; font-size: 15px; line-height: 1.6; color: #2e7d32; font-style: italic; text-align: center; }
    .footer { background: #f5f7fa; padding: 20px 40px; text-align: center; font-size: 13px; color: #9e9e9e; border-top: 1px solid #e0e0e0; }
    .footer a { color: #1a237e; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="check-badge">✓</div>
      <h1>Payment Approved!</h1>
      <p>Gluck Global — Student Portal</p>
    </div>
    <div class="body">
      <div class="greeting">Dear ${name},</div>
      <p class="msg">
        We are delighted to inform you that your payment has been <strong>successfully verified and approved</strong> by our finance team. 
        Your commitment to your language learning journey is truly commendable, and we are here to support you every step of the way.
      </p>

      <div class="purpose-highlight">
        <strong>Payment Purpose:</strong> ${purposeLabel}
      </div>

      <div class="details-box">
        <h3>Payment Details</h3>
        <div class="detail-row">
          <span class="detail-label">Amount Approved</span>
          <span class="detail-value">${currency} ${Number(paidAmount).toLocaleString('en-IN')}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Payment Method</span>
          <span class="detail-value">${paymentMethod || 'Bank Transfer'}</span>
        </div>
        ${receiptNumber ? `<div class="detail-row"><span class="detail-label">Receipt Number</span><span class="detail-value">${receiptNumber}</span></div>` : ''}
        <div class="detail-row">
          <span class="detail-label">Approved On</span>
          <span class="detail-value">${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
        </div>
      </div>

      <div class="motivation">
        "Every payment you make is an investment in your future. Keep going — fluency, confidence, and new opportunities await you. Continue your Gluck journey with full energy! 🌟"
      </div>

      <p class="msg">
        Please keep this email as proof of your payment. Your receipt${receiptNumber ? ` (${receiptNumber})` : ''} has been recorded in our system and is accessible anytime through your student portal.
      </p>
      <p class="msg">
        If you have any questions regarding this payment or your account, please do not hesitate to contact our support team at 
        <a href="mailto:info@gluckglobal.com" style="color:#1a237e;">info@gluckglobal.com</a>.
      </p>
      <p class="msg" style="font-weight:600; color:#1a237e;">
        Keep learning, keep growing. We are proud to have you as part of the Gluck Global family.
      </p>
      <p class="msg" style="margin-bottom:0;">
        Warm regards,<br/>
        <strong>The Finance Team</strong><br/>
        Gluck Global Language Institute
      </p>
    </div>
    <div class="footer">
      <p>490/73, Srimavo Bandaranaike Mawatha, Peradeniya Road, Kandy | <a href="mailto:info@gluckglobal.com">info@gluckglobal.com</a></p>
      <p>This is an automated email from the Gluck Global Student Portal. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>`;

  await sendMail({ to: email, subject: `✅ Payment Approved — ${currency} ${Number(paidAmount).toLocaleString('en-IN')} | Gluck Global`, html });
};

// ─────────────────────────────────────────────────────────────────────────────
// Payment Request Email — sent when admin creates a request
// ─────────────────────────────────────────────────────────────────────────────
const sendPaymentRequestEmail = async (student, request) => {
  const { name, email } = student;
  const { amount, currency, paymentType, customType, dueDate, remarks } = request;
  const purposeLabel = remarks || (customType ? `${paymentType} — ${customType}` : paymentType) || 'Course Payment';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f7fa; margin: 0; padding: 0; color: #212121; }
    .wrapper { max-width: 600px; margin: 32px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1a237e 0%, #283593 100%); color: white; padding: 28px 40px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; }
    .body { padding: 28px 40px; }
    .details-box { background: #f0f4ff; border-left: 4px solid #1a237e; border-radius: 8px; padding: 18px 22px; margin: 18px 0; }
    .detail-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .detail-label { color: #757575; }
    .detail-value { font-weight: 600; }
    .purpose-highlight { background: #fff8e1; border: 1px solid #ffd54f; border-radius: 6px; padding: 12px 16px; margin-bottom: 18px; font-size: 14px; }
    .footer { background: #f5f7fa; padding: 16px 40px; text-align: center; font-size: 12px; color: #9e9e9e; border-top: 1px solid #e0e0e0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>💳 New Payment Request</h1><p>Gluck Global — Student Portal</p></div>
    <div class="body">
      <p style="font-size:16px;">Dear <strong>${name}</strong>,</p>
      <p>A new payment request has been raised for your account. Please log in to the student portal to submit your payment screenshot.</p>
      <div class="purpose-highlight"><strong>Purpose:</strong> ${purposeLabel}</div>
      <div class="details-box">
        <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value">${currency} ${Number(amount).toLocaleString('en-IN')}</span></div>
        <div class="detail-row"><span class="detail-label">Due Date</span><span class="detail-value">${new Date(dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
      </div>
      <p>Please complete the payment before the due date and upload your screenshot via the student portal.</p>
      <p style="font-weight:600; color:#1a237e;">Gluck Global Finance Team</p>
    </div>
    <div class="footer">490/73, Srimavo Bandaranaike Mawatha, Peradeniya Road, Kandy | info@gluckglobal.com</div>
  </div>
</body>
</html>`;

  await sendMail({ to: email, subject: `💳 Payment Request — ${currency} ${Number(amount).toLocaleString('en-IN')} | Gluck Global`, html });
};

const sendPaymentRejectedEmail = async (student, submission) => {
  const { name, email } = student;
  const { paidAmount, currency, rejectionReason } = submission;
  const reason = rejectionReason || 'Please contact support for details.';
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f7fa; margin: 0; padding: 0; color: #212121; }
    .wrapper { max-width: 600px; margin: 32px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #b71c1c 0%, #c62828 100%); color: white; padding: 28px 40px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; }
    .body { padding: 28px 40px; }
    .reason-box { background: #fff5f5; border-left: 4px solid #c62828; border-radius: 8px; padding: 16px 20px; margin: 18px 0; font-size: 15px; line-height: 1.5; }
    .details-box { background: #f8fafc; border-radius: 8px; padding: 16px 20px; margin-bottom: 18px; font-size: 14px; }
    .footer { background: #f5f7fa; padding: 16px 40px; text-align: center; font-size: 12px; color: #9e9e9e; border-top: 1px solid #e0e0e0; }
    .footer a { color: #1a237e; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>Payment Not Approved</h1><p>Gluck Global — Student Portal</p></div>
    <div class="body">
      <p style="font-size:16px;">Dear <strong>${name}</strong>,</p>
      <p>Thank you for submitting your payment proof. After review, we were unable to approve this submission at this time.</p>
      <div class="details-box">
        <strong>Declared amount:</strong> ${currency || 'INR'} ${Number(paidAmount || 0).toLocaleString('en-IN')}
      </div>
      <div class="reason-box">
        <strong>Reason from our finance team:</strong><br/>${reason}
      </div>
      <p>Please log in to the student portal to upload a corrected screenshot, or contact us at <a href="mailto:info@gluckglobal.com">info@gluckglobal.com</a> if you have questions.</p>
      <p style="font-weight:600; color:#1a237e; margin-bottom:0;">Gluck Global Finance Team</p>
    </div>
    <div class="footer">
      <p>450/73, Srimavo Bandaranayaka Mawatha, Peradeniya Road, Kandy | <a href="mailto:info@gluckglobal.com">info@gluckglobal.com</a></p>
      <p>This is an automated email from the Gluck Global Student Portal.</p>
    </div>
  </div>
</body>
</html>`;
  await sendMail({ to: email, subject: `Payment Update Required — Gluck Global`, html });
};

module.exports = { sendPaymentApprovedEmail, sendPaymentRequestEmail, sendPaymentRejectedEmail };
