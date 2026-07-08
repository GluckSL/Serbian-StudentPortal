/**
 * Suggest unmapped Zoom participant names for portal-join-but-absent students.
 */

function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(name) {
  return normalizeName(name).split(/\s+/).filter((t) => t.length >= 2);
}

function levenshteinDistance(str1, str2) {
  const matrix = [];
  for (let i = 0; i <= str2.length; i++) matrix[i] = [i];
  for (let j = 0; j <= str1.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[str2.length][str1.length];
}

function scoreParticipantForStudent(studentName, studentEmail, participantName) {
  const pName = (participantName || '').trim();
  if (!pName) return 0;

  const pNorm = normalizeName(pName);
  const sNorm = normalizeName(studentName);
  if (!sNorm) return 0;

  if (pNorm === sNorm) return 100;
  if (sNorm.includes(pNorm) || pNorm.includes(sNorm)) return 88;

  let score = 0;
  const sTokens = nameTokens(studentName);
  const pTokens = nameTokens(pName);

  for (const pt of pTokens) {
    if (sTokens.includes(pt)) score = Math.max(score, 82);
    else if (sTokens.some((st) => st.includes(pt) || pt.includes(st))) score = Math.max(score, 68);
  }

  const emailLocal = (studentEmail || '').split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
  const pCompact = pNorm.replace(/\s/g, '');
  if (emailLocal && pCompact && emailLocal.includes(pCompact)) score = Math.max(score, 72);
  if (emailLocal && pCompact && pCompact.includes(emailLocal.slice(0, 4))) score = Math.max(score, 55);

  const longer = sNorm.length >= pNorm.length ? sNorm : pNorm;
  const shorter = sNorm.length >= pNorm.length ? pNorm : sNorm;
  if (longer.length > 0) {
    const dist = levenshteinDistance(longer, shorter);
    const sim = ((longer.length - dist) / longer.length) * 100;
    score = Math.max(score, sim * 0.75);
  }

  return Math.round(Math.min(100, score));
}

function getMappedParticipantKeys(attendance) {
  const keys = new Set();
  for (const row of attendance || []) {
    if (row.zoomName) keys.add(normalizeName(row.zoomName));
    if (row.zoomEmail) keys.add((row.zoomEmail || '').trim().toLowerCase());
  }
  return keys;
}

function suggestParticipants(studentName, studentEmail, attendance, zoomParticipants, limit = 3) {
  const mapped = getMappedParticipantKeys(attendance);
  const scored = [];
  const seen = new Set();

  for (const p of zoomParticipants || []) {
    const rawName = (p.name || '').trim();
    if (!rawName) continue;

    const key = normalizeName(rawName);
    if (mapped.has(key) || seen.has(key)) continue;

    const score = scoreParticipantForStudent(studentName, studentEmail, rawName);
    if (score >= 35) {
      scored.push({ name: rawName, score });
      seen.add(key);
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit);
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Map();
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      const item = items[current];
      results.set(item, await fn(item));
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

function extractBatchLevelFromTopic(topic) {
  const match = String(topic || '').match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
  return match ? match[1].toUpperCase() : '';
}

module.exports = {
  suggestParticipants,
  mapWithConcurrency,
  extractBatchLevelFromTopic,
};
