'use strict';

const fs = require('fs');
const path = require('path');
const transporter = require('../config/emailConfig');
const { buildJobApplicationReceivedAdminEmail } = require('./emailTemplates');

const DEFAULT_NOTIFY_EMAILS = 'operations@gluckglobal.com';

function parseJobApplicationNotifyEmails() {
  const raw = process.env.JOB_APPLICATION_NOTIFY_EMAILS || DEFAULT_NOTIFY_EMAILS;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function buildJobApplicationResumeAttachment(file, resumeUrl) {
  const attachments = [];

  if (file?.buffer) {
    attachments.push({
      filename: file.originalname || 'resume',
      content: file.buffer,
      contentType: file.mimetype || undefined,
    });
    return attachments;
  }

  if (file?.path && fs.existsSync(file.path)) {
    attachments.push({
      filename: file.originalname || path.basename(file.path),
      path: file.path,
    });
    return attachments;
  }

  if (!resumeUrl) return attachments;

  const rel = String(resumeUrl).replace(/^\/uploads\/job-applications\//, '');
  const localPath = path.join(__dirname, '..', 'uploads', 'job-applications', rel);
  if (fs.existsSync(localPath)) {
    attachments.push({
      filename: path.basename(localPath),
      path: localPath,
    });
  }

  return attachments;
}

/**
 * Email operations when a student applies for a job opening.
 */
async function notifyJobApplicationSubmitted({ application, opening, file }) {
  const recipients = parseJobApplicationNotifyEmails();
  if (!recipients.length) return;

  const adminUrl = `${process.env.FRONTEND_URL || 'https://gluckstudentsportal.com'}/admin/job-openings`;
  const appliedAt = application.createdAt
    ? new Date(application.createdAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const attachments = buildJobApplicationResumeAttachment(file, application.resumeUrl);
  const resumeNote = attachments.length
    ? "The applicant's resume is attached to this email."
    : 'Resume could not be attached — open the admin panel to download it.';

  const mail = buildJobApplicationReceivedAdminEmail({
    studentName: application.studentName,
    studentEmail: application.studentEmail,
    studentRegNo: application.studentRegNo,
    studentBatch: application.studentBatch,
    phone: application.phone,
    linkedIn: application.linkedIn,
    coverLetter: application.coverLetter,
    resumeFileName: application.resumeFileName,
    companyName: opening.companyName,
    jobTitle: opening.jobTitle,
    jobType: opening.jobType,
    location: opening.location,
    locationType: opening.locationType,
    salary: opening.salary,
    appliedAt,
    adminUrl,
    resumeNote,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: recipients.join(', '),
    subject: mail.subject,
    html: mail.html,
    attachments,
  });
}

module.exports = {
  parseJobApplicationNotifyEmails,
  buildJobApplicationResumeAttachment,
  notifyJobApplicationSubmitted,
};
