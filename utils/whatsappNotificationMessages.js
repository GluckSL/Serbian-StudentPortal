/**
 * WhatsApp message templates — English by default; Serbian (Latin) for Serbia batches.
 *
 * Set PORTAL_REGION=serbia on the Serbia deployment so all batches get Serbian copy,
 * or list batch name fragments in SERBIA_BATCH_PREFIXES (comma-separated).
 */

function isSerbiaBatch(batchName) {
  if ((process.env.PORTAL_REGION || '').toLowerCase() === 'serbia') {
    return true;
  }
  const prefixes = (process.env.SERBIA_BATCH_PREFIXES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!batchName || prefixes.length === 0) {
    return false;
  }
  const normalized = String(batchName).toLowerCase();
  return prefixes.some((prefix) => normalized.includes(prefix.toLowerCase()));
}

function classReminderStudent({ name, topic, minutesUntilStart, portalUrl, batch }) {
  const topicLabel = topic || (isSerbiaBatch(batch) ? 'Vaš čas' : 'Your class');
  if (isSerbiaBatch(batch)) {
    return `Zdravo ${name}, "${topicLabel}" počinje za ${minutesUntilStart} min. Pridružite se putem Glück Global studentskog portala: ${portalUrl}/login — prijavite se, otvorite Moj čas i tapnite Pridruži se kada dođe vreme.`;
  }
  return `Hi ${name}, "${topicLabel}" starts in ${minutesUntilStart} min. Join via the Glück Global student portal: ${portalUrl}/login — sign in, open My Class, and tap Join now when it is time.`;
}

function classReminderTeacher({ name, topic, minutesUntilStart, batch }) {
  const topicLabel = topic || (isSerbiaBatch(batch) ? 'Vaš čas' : 'Your class');
  if (isSerbiaBatch(batch)) {
    return `Zdravo ${name}, podsetnik: "${topicLabel}" počinje za ${minutesUntilStart} min.`;
  }
  return `Hi ${name}, reminder: "${topicLabel}" starts in ${minutesUntilStart} min.`;
}

module.exports = {
  isSerbiaBatch,
  classReminderStudent,
  classReminderTeacher,
};
