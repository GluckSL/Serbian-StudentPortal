const User = require('../models/User');
const MeetingLink = require('../models/MeetingLink');
const Feedback = require('../models/Feedback');
const {
  dispatchEvent,
  sanitizeUserDoc,
  sanitizeMeetingLink,
  sanitizeFeedbackDoc
} = require('./studentPortalCrmWebhook');

const CHUNK_SIZE = 50;

const META_BULK = { syncMode: 'snapshot' };

async function dispatchUsers(query, event) {
  let sent = 0;
  let skipped = 0;
  let errors = 0;
  const cursor = User.find(query).select('-password').cursor();
  for await (const doc of cursor) {
    const entity = sanitizeUserDoc(doc);
    entity.type = 'User';
    const r = await dispatchEvent({
      event,
      entity,
      metaOverrides: META_BULK
    });
    if (r.skipped) skipped++;
    else if (r.ok) sent++;
    else errors++;
  }
  return { sent, skipped, errors };
}

async function runSyncKind(kind) {
  const summary = { kind, sent: 0, skipped: 0, errors: 0 };

  if (kind === 'students') {
    const r = await dispatchUsers({ role: 'STUDENT' }, 'STUDENT_CREATED');
    summary.sent += r.sent;
    summary.skipped += r.skipped;
    summary.errors += r.errors;
    return summary;
  }

  if (kind === 'teachers') {
    const r1 = await dispatchUsers({ role: 'TEACHER' }, 'TEACHER_CREATED');
    const r2 = await dispatchUsers({ role: 'TEACHER_ADMIN' }, 'TEACHER_CREATED');
    summary.sent += r1.sent + r2.sent;
    summary.skipped += r1.skipped + r2.skipped;
    summary.errors += r1.errors + r2.errors;
    return summary;
  }

  if (kind === 'reminders') {
    const docs = await MeetingLink.find({}).lean();
    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const batch = docs.slice(i, i + CHUNK_SIZE);
      for (const raw of batch) {
        const entity = sanitizeMeetingLink(raw);
        entity.type = 'MeetingLink';
        const r = await dispatchEvent({
          event: 'REMINDER_CREATED',
          entity,
          metaOverrides: META_BULK
        });
        if (r.skipped) summary.skipped++;
        else if (r.ok) summary.sent++;
        else summary.errors++;
      }
    }
    return summary;
  }

  if (kind === 'feedback') {
    const docs = await Feedback.find({}).lean();
    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const batch = docs.slice(i, i + CHUNK_SIZE);
      for (const raw of batch) {
        const entity = sanitizeFeedbackDoc(raw);
        entity.type = 'Feedback';
        const r = await dispatchEvent({
          event: 'FEEDBACK_CREATED',
          entity,
          metaOverrides: META_BULK
        });
        if (r.skipped) summary.skipped++;
        else if (r.ok) summary.sent++;
        else summary.errors++;
      }
    }
    return summary;
  }

  throw new Error(`Unknown sync kind: ${kind}`);
}

async function runFullSync() {
  const kinds = ['students', 'teachers', 'reminders', 'feedback'];
  const byKind = {};
  for (const k of kinds) {
    byKind[k] = await runSyncKind(k);
  }
  return {
    at: new Date().toISOString(),
    byKind,
    totals: Object.values(byKind).reduce(
      (acc, s) => {
        acc.sent += s.sent;
        acc.skipped += s.skipped;
        acc.errors += s.errors;
        return acc;
      },
      { sent: 0, skipped: 0, errors: 0 }
    )
  };
}

module.exports = {
  runSyncKind,
  runFullSync
};
