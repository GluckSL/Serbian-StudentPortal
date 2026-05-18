// utils/exerciseMediaPreserve.js
// Keeps existing image/audio/video URLs on exercise save when the client accidentally
// sends empty values. Intentional removes must be listed in mediaClears[].
// Never deletes objects from S3/R2 — only preserves MongoDB references.

const MEDIA_SCALAR_FIELDS = ['imageUrl', 'attachmentUrl', 'mediaUrl', 'videoUrl', 'audioUrl'];

function normalizeClears(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({
      qIndex: Number(c?.qIndex),
      subIndex: c?.subIndex == null || c?.subIndex === '' ? null : Number(c.subIndex),
      field: String(c?.field || '').trim()
    }))
    .filter((c) => Number.isFinite(c.qIndex) && (c.qIndex >= 0 || c.qIndex === -1) && c.field);
}

function isCleared(clears, qIndex, field, subIndex = null) {
  if (!Array.isArray(clears) || clears.length === 0) return false;
  return clears.some(
    (c) =>
      c.qIndex === qIndex &&
      c.field === field &&
      (subIndex == null ? c.subIndex == null : c.subIndex === subIndex)
  );
}

function preserveScalarMedia(existingQ, incomingQ, qIndex, clears, subIndex = null) {
  if (!existingQ || !incomingQ) return;
  for (const field of MEDIA_SCALAR_FIELDS) {
    if (isCleared(clears, qIndex, field, subIndex)) continue;
    const incoming = String(incomingQ[field] ?? '').trim();
    const existing = String(existingQ[field] ?? '').trim();
    if (!incoming && existing) {
      incomingQ[field] = existing;
    }
  }
}

function preserveOptionImages(existingQ, incomingQ, qIndex, clears, subIndex = null) {
  const existingArr = Array.isArray(existingQ?.optionImageUrls) ? existingQ.optionImageUrls : [];
  if (!Array.isArray(incomingQ.optionImageUrls)) {
    if (existingArr.some((u) => String(u ?? '').trim())) {
      incomingQ.optionImageUrls = [...existingArr];
    }
    return;
  }
  incomingQ.optionImageUrls = incomingQ.optionImageUrls.map((inc, oi) => {
    const field = `optionImageUrl:${oi}`;
    if (isCleared(clears, qIndex, field, subIndex)) return String(inc || '').trim();
    const incoming = String(inc ?? '').trim();
    const existing = String(existingArr[oi] ?? '').trim();
    return incoming || existing || '';
  });
}

function preserveQuestionPair(existingQ, incomingQ, qIndex, clears, subIndex = null) {
  if (!existingQ || !incomingQ) return incomingQ;
  preserveScalarMedia(existingQ, incomingQ, qIndex, clears, subIndex);
  preserveOptionImages(existingQ, incomingQ, qIndex, clears, subIndex);
  return incomingQ;
}

function preserveTopLevelMedia(existingExercise, incomingExercise, mediaClears) {
  if (!existingExercise || !incomingExercise) return incomingExercise;

  const clears = normalizeClears(mediaClears);

  if (!isCleared(clears, -1, 'sharedAudioUrl', null)) {
    const inc = String(incomingExercise.sharedAudioUrl ?? '').trim();
    const ex = String(existingExercise.sharedAudioUrl ?? '').trim();
    if (!inc && ex) incomingExercise.sharedAudioUrl = ex;
  }

  for (const listKey of ['videoSuccessFeedback', 'videoRetryFeedback']) {
    const incList = incomingExercise[listKey];
    const exList = existingExercise[listKey];
    if (!Array.isArray(incList) || !Array.isArray(exList)) continue;
    incList.forEach((row, i) => {
      if (!row || typeof row !== 'object') return;
      const field = `${listKey}:${i}:audioUrl`;
      if (isCleared(clears, -1, field, null)) return;
      const inc = String(row.audioUrl ?? '').trim();
      const ex = String(exList[i]?.audioUrl ?? '').trim();
      if (!inc && ex) row.audioUrl = ex;
    });
  }

  return incomingExercise;
}

/**
 * Merge incoming questions with existing DB media when saves would accidentally wipe URLs.
 * @param {Array} existingQuestions
 * @param {Array} incomingQuestions
 * @param {Array<{qIndex:number, subIndex?:number|null, field:string}>} mediaClears
 */
function preserveExistingQuestionMedia(existingQuestions, incomingQuestions, mediaClears = []) {
  if (!Array.isArray(incomingQuestions)) return incomingQuestions;
  if (!Array.isArray(existingQuestions)) return incomingQuestions;

  const clears = normalizeClears(mediaClears);

  return incomingQuestions.map((incomingQ, qi) => {
    const existingQ = existingQuestions[qi];
    if (!existingQ || !incomingQ) return incomingQ;

    preserveQuestionPair(existingQ, incomingQ, qi, clears, null);

    const incSubs = incomingQ.subQuestions;
    const exSubs = existingQ.subQuestions;
    if (Array.isArray(incSubs) && Array.isArray(exSubs)) {
      incomingQ.subQuestions = incSubs.map((incSq, si) => {
        const exSq = exSubs[si];
        if (!exSq || !incSq) return incSq;
        return preserveQuestionPair(exSq, incSq, qi, clears, si);
      });
    }

    return incomingQ;
  });
}

module.exports = {
  preserveExistingQuestionMedia,
  preserveTopLevelMedia,
  MEDIA_SCALAR_FIELDS
};
