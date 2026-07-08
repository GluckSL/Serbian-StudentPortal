/**
 * Match roster attendees to Zoom past-meeting participants.
 * Zoom often omits user_email for guests; display names may omit last name or add device suffixes.
 */

const mongoose = require('mongoose');
const MATCH_CONFIG = require('../config/matchConfig');
const matchLogger = require('../utils/matchLogger');
const { participantClaimKey } = require('../utils/participantClaimKey');
const {
  sanitizeDisplayName: sanitizePortalDisplayName,
  DISPLAY_NAME_MAX,
} = require('../utils/studentDisplayName');

const MP = MATCH_CONFIG.MATCH_PRIORITY;

const CLAIM_MAP_SYM = Symbol.for('gluck.attendanceClaimMap');
const TRACE_ID_SYM = Symbol.for('gluck.attendanceTraceId');

function claimMapForRun(participants, options) {
  if (options.claimedParticipants instanceof Map) return options.claimedParticipants;
  if (!participants || typeof participants !== 'object') return new Map();
  if (participants[CLAIM_MAP_SYM] instanceof Map) return participants[CLAIM_MAP_SYM];
  const m = new Map();
  participants[CLAIM_MAP_SYM] = m;
  return m;
}

function traceIdForRun(participants, options) {
  if (options.traceId != null && options.traceId !== '') return options.traceId;
  if (!participants || typeof participants !== 'object') return new mongoose.Types.ObjectId();
  if (participants[TRACE_ID_SYM] != null && participants[TRACE_ID_SYM] !== '') {
    return participants[TRACE_ID_SYM];
  }
  const id = new mongoose.Types.ObjectId();
  participants[TRACE_ID_SYM] = id;
  return id;
}

function normalizeEmailForMatch(email) {
  if (!email || typeof email !== 'string') return '';
  const t = email.trim().toLowerCase();
  const at = t.indexOf('@');
  if (at < 0) return t;
  let local = t.slice(0, at);
  const domain = t.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

/**
 * Aggressive normalization for name comparisons (portal + Zoom + email-local tokens).
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

/** @deprecated Prefer normalizeName */
function normalizeDisplayName(name) {
  return normalizeName(name);
}

function getInitials(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word[0] ? word[0] : ''))
    .join('')
    .toLowerCase();
}

function hasNameTokenOverlap(portalName, zoomName) {
  const p = normalizeName(portalName).split(/\s+/).filter(Boolean);
  const z = normalizeName(zoomName).split(/\s+/).filter(Boolean);
  if (!p.length || !z.length) return false;
  return p.some((token) => z.includes(token));
}

/** Zoom label matches portal initials (same rule as initials_name stage). */
function initialsAlignPortalZoom(portalName, zoomName) {
  const initials = getInitials(portalName || '');
  const zm = normalizeName(zoomName || '');
  return (
    initials.length >= 2 &&
    zm.length > 0 &&
    zm.length <= MATCH_CONFIG.INITIALS_MAX_ZOOM_NAME_LEN &&
    initials === zm
  );
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

function calculateStringSimilarity(str1, str2) {
  const s1 = normalizeName(str1 || '');
  const s2 = normalizeName(str2 || '');
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1;
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

function countEmailLocalTokenHits(localAlpha, tokens) {
  let hits = 0;
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (localAlpha === tok) hits++;
    else if (tok.length >= 3 && localAlpha.startsWith(tok)) hits++;
    else if (localAlpha.length >= 3 && tok.startsWith(localAlpha)) hits++;
    else if (tok.length >= 4 && localAlpha.includes(tok)) hits++;
  }
  return hits;
}

/** ≥60% string similarity to some token OR ≥2 matching tokens */
function emailLocalSafetyPasses(localAlpha, zoomName) {
  const tokens = normalizeName(zoomName).split(/\s+/).filter((t) => t.length >= 2);
  if (!tokens.length) return false;
  if (countEmailLocalTokenHits(localAlpha, tokens) >= 2) return true;
  let best = 0;
  for (const tok of tokens) {
    best = Math.max(best, calculateStringSimilarity(localAlpha, tok));
  }
  return best >= 0.6;
}

function applyDurationConfidenceAdjustment(confidence, participantDurationSec, meetingDurationSec) {
  let c = Number(confidence) || 0;
  if (meetingDurationSec && meetingDurationSec > 0) {
    const dur = Number(participantDurationSec) || 0;
    const ratio = dur / meetingDurationSec;
    if (ratio > 0.8) c += 10;
    if (ratio < 0.3) c -= 10;
  }
  return Math.max(0, Math.min(100, Math.round(c)));
}

function isAmbiguousConfidence(c) {
  return (
    c >= MATCH_CONFIG.AMBIGUOUS_CONFIDENCE_MIN &&
    c <= MATCH_CONFIG.AMBIGUOUS_CONFIDENCE_MAX
  );
}

function priorityForMethod(method, baseConfidence) {
  switch (method) {
    case 'email':
      return MP.EMAIL;
    case 'exact_trim_name':
      return MP.EXACT_TRIM;
    case 'exact_name':
      return MP.EXACT;
    case 'sanitized_name':
      return MP.SANITIZED_NAME;
    case 'email_local':
      return baseConfidence >= 92 ? MP.EMAIL_LOCAL_STRONG : MP.EMAIL_LOCAL_WEAK;
    case 'initials_name':
      return MP.INITIALS;
    case 'join_log_time':
      return MP.JOIN_LOG;
    case 'containment':
      return MP.CONTAINMENT;
    case 'partial_name':
      return MP.PARTIAL;
    case 'fuzzy_name':
      return MP.FUZZY;
    case 'single_participant':
      return MP.SINGLE_PARTICIPANT;
    default:
      return MP.FUZZY;
  }
}

function canUseParticipant(participant, priorityReq, matchContext) {
  const claimedParticipants = matchContext.claimedParticipants;
  const currentStudentId =
    matchContext.currentStudentId != null ? String(matchContext.currentStudentId) : null;
  const key = participantClaimKey(participant);

  if (participant._matched) {
    return { ok: false, key, reason: 'matched' };
  }
  if (participant._reserved && currentStudentId) {
    const holder = claimedParticipants && claimedParticipants.get(key);
    if (holder && holder !== currentStudentId) {
      return { ok: false, key, reason: 'reserved_other' };
    }
    if (participant._matchedByStudent && String(participant._matchedByStudent) !== currentStudentId) {
      return { ok: false, key, reason: 'reserved_other' };
    }
  }
  if (
    participant._reserved &&
    (participant._priority || 0) >= priorityReq
  ) {
    return { ok: false, key, reason: 'priority' };
  }
  if (claimedParticipants && currentStudentId) {
    const prev = claimedParticipants.get(key);
    if (prev && prev !== currentStudentId) {
      return { ok: false, key, reason: 'claimed' };
    }
  }
  return { ok: true, key };
}

function reserveParticipant(participant, priority, key, matchContext) {
  const claimedParticipants = matchContext.claimedParticipants;
  const currentStudentId =
    matchContext.currentStudentId != null ? String(matchContext.currentStudentId) : null;
  participant._reserved = true;
  participant._priority = Math.max(participant._priority || 0, priority);
  if (currentStudentId) participant._matchedByStudent = currentStudentId;
  if (claimedParticipants && currentStudentId) {
    claimedParticipants.set(key, currentStudentId);
  }
}

function mergeTrace(debug, traceId) {
  if (!traceId) return debug || {};
  return { ...(debug || {}), traceId: String(traceId) };
}

function calculatePartialNameMatch(registeredName, zoomName) {
  const registered = normalizeName(registeredName).split(/\s+/).filter(Boolean);
  const zoom = normalizeName(zoomName).split(/\s+/).filter(Boolean);
  if (!registered.length || !zoom.length) return 0;
  let matchedParts = 0;
  const totalParts = registered.length;

  for (const regPart of registered) {
    for (const zoomPart of zoom) {
      if (regPart === zoomPart) {
        matchedParts++;
        break;
      }
      if (regPart.startsWith(zoomPart) || zoomPart.startsWith(regPart)) {
        if (Math.min(regPart.length, zoomPart.length) >= 2) {
          matchedParts += 0.8;
          break;
        }
      }
      if (regPart[0] === zoomPart[0] && (regPart.length === 1 || zoomPart.length === 1)) {
        matchedParts += 0.5;
        break;
      }
    }
  }

  const baseConfidence = (matchedParts / totalParts) * 80;
  const lengthBonus = registered.length === zoom.length ? 5 : 0;
  return Math.min(Math.round(baseConfidence + lengthBonus), 80);
}

function emailLocalPartVsZoomNameConfidence(attendeeEmail, zoomName) {
  if (!attendeeEmail || !zoomName) return 0;
  const normalized = normalizeEmailForMatch(attendeeEmail);
  const at = normalized.indexOf('@');
  if (at < 0) return 0;
  let local = normalized.slice(0, at);
  if (!local) return 0;

  const localAlpha = normalizeName(local.replace(/\d/g, ''));
  if (!localAlpha) return 0;

  const tokens = normalizeName(zoomName).split(/\s+/).filter(Boolean);
  let best = 0;

  for (const tok of tokens) {
    if (tok.length < 2) continue;

    if (localAlpha === tok) {
      best = Math.max(best, 95);
      continue;
    }
    if (tok.length >= 3 && localAlpha.startsWith(tok)) {
      best = Math.max(best, 93);
      continue;
    }
    if (localAlpha.length >= 3 && tok.startsWith(localAlpha)) {
      best = Math.max(best, 92);
      continue;
    }
    if (tok.length >= 4 && localAlpha.includes(tok)) {
      best = Math.max(best, 89);
    }
  }

  if (best >= 92 && !emailLocalSafetyPasses(localAlpha, zoomName)) {
    return Math.min(best, MATCH_CONFIG.EMAIL_LOCAL_UNSAFE_CAP);
  }

  return best;
}

function extendedNameConfidence(attendeeName, zoomName) {
  const a = normalizeName(attendeeName);
  const b = normalizeName(zoomName);
  if (!a || !b) return 0;
  if (a === b) return 100;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 3 && longer.includes(shorter)) {
    return 88;
  }

  const ta = a.split(/\s+/).filter(Boolean);
  const tb = b.split(/\s+/).filter(Boolean);
  if (ta.length && tb.length) {
    const [longerT, shorterT] = ta.length >= tb.length ? [ta, tb] : [tb, ta];
    const subsetOk = shorterT.every((s) =>
      longerT.some((l) => l === s || (s.length >= 3 && (l.startsWith(s) || s.startsWith(l))))
    );
    if (subsetOk && shorterT.length < longerT.length) {
      return 86;
    }
    if (ta[0] === tb[0] && (ta.length === 1 || tb.length === 1)) {
      return 87;
    }
  }

  return 0;
}

function buildDebug(attendee, match, joinLogJoinedAt, extras = {}) {
  const portalName = attendee.name || '';
  const zoomName = match?.name ?? null;
  let joinLogTime = null;
  let zoomJoinTime = null;
  let timeDiffMs = null;
  if (joinLogJoinedAt != null) {
    try {
      joinLogTime = new Date(joinLogJoinedAt).toISOString();
    } catch {
      joinLogTime = null;
    }
  }
  if (match?.joinTime) {
    try {
      zoomJoinTime = new Date(match.joinTime).toISOString();
      if (joinLogJoinedAt != null) {
        timeDiffMs = Math.abs(new Date(match.joinTime).getTime() - new Date(joinLogJoinedAt).getTime());
      }
    } catch {
      zoomJoinTime = null;
    }
  }
  return {
    portalName,
    zoomName,
    joinLogTime,
    zoomJoinTime,
    timeDiffMs,
    ...extras,
  };
}

function summaryForMethod(method, attendee, match, debug, weakIdentity) {
  const z = match?.name || debug?.zoomName || '';
  if (method === 'email') return 'Matched via email';
  if (method === 'email_local') return `Matched via email local ↔ Zoom name`;
  if (method === 'exact_trim_name') return 'Matched via exact name (trim)';
  if (method === 'exact_name') return 'Matched via exact name (normalised)';
  if (method === 'initials_name') return `Matched via initials (${normalizeName(z).replace(/\s/g, '') || z})`;
  if (method === 'join_log_time') {
    const ms = debug?.timeDiffMs;
    if (ms != null && Number.isFinite(ms)) {
      return `Matched via join time (diff ${(ms / 60000).toFixed(1)} min)`;
    }
    return 'Matched via join time';
  }
  if (method === 'ambiguous') {
    if (debug?.joinLogSkipReason === 'multiple_candidates') return 'Skipped: multiple candidates';
    return 'Ambiguous: low confidence band';
  }
  if (weakIdentity) return 'Weak match: no name overlap (join time)';
  if (method === 'single_participant') return 'Matched: single Zoom participant';
  return `Matched via ${method}`;
}

/**
 * Finalize: reserve + duration weighting; strong immunity for email/exact_name; _matched only when assigning.
 */
function finalizeAssignment(
  attendee,
  match,
  baseConfidence,
  method,
  joinLogJoinedAt,
  meetingDurationSec,
  extraDebug = {},
  matchContext = {},
  strongImmune = false
) {
  const traceId = matchContext.traceId ?? extraDebug.traceId;
  const priority = priorityForMethod(method, baseConfidence);
  const use = canUseParticipant(match, priority, matchContext);
  if (!use.ok) {
    return emptyResult(joinLogJoinedAt, attendee, {
      ...extraDebug,
      skipReason: use.reason,
      traceId,
    });
  }
  if (match._matched) {
    matchLogger.error('PARTICIPANT_REASSIGN_ATTEMPT', {
      traceId: traceId != null ? String(traceId) : null,
      method,
      studentId: matchContext.currentStudentId,
    });
    return emptyResult(joinLogJoinedAt, attendee, {
      ...extraDebug,
      skipReason: 'already_matched',
      traceId,
    });
  }
  reserveParticipant(match, priority, use.key, matchContext);

  const durSec = match ? Number(match.duration) || 0 : 0;
  let finalConfidence = applyDurationConfidenceAdjustment(baseConfidence, durSec, meetingDurationSec);

  if (strongImmune && isAmbiguousConfidence(finalConfidence)) {
    const prev = finalConfidence;
    finalConfidence = Math.max(80, finalConfidence);
    if (prev !== finalConfidence) {
      matchLogger.info('STRONG_MATCH_DURATION_CLAMP', {
        traceId,
        method,
        prev,
        final: finalConfidence,
      });
    }
  }

  if (match && !strongImmune && isAmbiguousConfidence(finalConfidence)) {
    matchLogger.info('PARTICIPANT_RESERVED_NOT_MATCHED', {
      traceId,
      method,
      baseConfidence,
      finalConfidence,
      studentId: matchContext.currentStudentId,
      skipReason: 'ambiguous_band',
    });
    return {
      match: null,
      confidence: baseConfidence,
      finalConfidence,
      method: 'ambiguous',
      ambiguous: true,
      mismatchReason: 'low_confidence',
      debug: buildDebug(attendee, match, joinLogJoinedAt, mergeTrace({
        ...extraDebug,
        participantKey: use.key,
        rejectedCandidateZoomName: match.name,
        ambiguousReason: 'low_confidence',
        traceId,
      }, traceId)),
      debugSummary: 'Ambiguous: confidence 50–65 after duration adjust',
    };
  }

  if (match) {
    match._matched = true;
  }

  const weakIdentity = !!extraDebug.weakIdentityMatch;
  const debugSummary = summaryForMethod(
    method,
    attendee,
    match,
    buildDebug(attendee, match, joinLogJoinedAt, { ...extraDebug, participantKey: use.key }),
    weakIdentity
  );

  return {
    match,
    confidence: baseConfidence,
    finalConfidence,
    method,
    ambiguous: false,
    debug: buildDebug(attendee, match, joinLogJoinedAt, mergeTrace({ ...extraDebug, participantKey: use.key }, traceId)),
    debugSummary,
    weakIdentityMatch: weakIdentity,
    mismatchReason: weakIdentity ? 'weak_identity_match' : undefined,
  };
}

function emptyResult(joinLogJoinedAt, attendee, extras = {}) {
  const traceId = extras.traceId;
  return {
    match: null,
    confidence: 0,
    finalConfidence: 0,
    method: 'no_match',
    ambiguous: false,
    debug: mergeTrace(buildDebug(attendee, null, joinLogJoinedAt, extras), traceId),
    debugSummary: extras.joinLogSkipReason === 'multiple_candidates' ? 'Skipped: multiple candidates' : 'No match',
  };
}

/**
 * @param {object} options
 * @param {number} [options.meetingDurationSec] — scheduled meeting length in seconds (for duration ratio)
 */
function findBestParticipantMatch(attendee, participants, options = {}) {
  const joinLogJoinedAt = options.joinLogJoinedAt;
  const logCtx = options.logContext || {};
  const meetingDurationSec =
    options.meetingDurationSec != null && Number.isFinite(Number(options.meetingDurationSec))
      ? Number(options.meetingDurationSec)
      : null;

  const traceId = traceIdForRun(participants, options);
  const claimedParticipants = claimMapForRun(participants, options);

  const matchContext = {
    traceId,
    claimedParticipants,
    currentStudentId: logCtx.studentId != null ? String(logCtx.studentId) : null,
  };

  if (!participants || participants.length === 0) {
    return emptyResult(joinLogJoinedAt, attendee, { traceId });
  }

  const skipFuzzyOnly =
    participants.length > MATCH_CONFIG.LARGE_ROSTER_THRESHOLD && !MATCH_CONFIG.STRICT_MATCH_MODE;

  const largeClassSafe =
    participants.length > (MATCH_CONFIG.SAFE_LARGE_CLASS_THRESHOLD ?? 150);

  const attendeeEmail = normalizeEmailForMatch(attendee.email || '');
  let bestMatch = null;
  let bestConfidence = 0;
  let bestMethod = 'no_match';
  let blockWeakFallbacks = false;

  // Matching priority order (descending strength):
  //   email → exact_trim_name → exact_name → sanitized_name → email_local → containment → initials
  //   → join_log_time (when no prior match) → fuzzy_name → partial_name
  //
  // email is the only early-return; all other stages compete for bestMatch/bestConfidence
  // so the full participant list is always scanned before committing.  This prevents an
  // email_local hit on an earlier participant from blocking a stronger exact-name match
  // on a later one.

  for (const participant of participants) {
    if (participant._matched || participant._reserved) continue;

    const pEmail = normalizeEmailForMatch(participant.email || '');

    // Stage 1 — exact email (only stage that early-returns; strongest possible signal).
    if (pEmail && attendeeEmail && pEmail === attendeeEmail) {
      const use = canUseParticipant(participant, MP.EMAIL, matchContext);
      if (!use.ok) {
        if (use.reason === 'priority') {
          matchLogger.warn('STRONG_MATCH_PRIORITY_BLOCKED', {
            traceId: String(traceId),
            method: 'email',
            studentId: logCtx.studentId,
          });
        }
        continue;
      }
      return finalizeAssignment(
        attendee,
        participant,
        100,
        'email',
        joinLogJoinedAt,
        meetingDurationSec,
        {},
        matchContext,
        true
      );
    }

    // Stage 2 — exact_trim_name: raw case-insensitive trim match before aggressive normalisation.
    // Catches names like "O'Brien" that normalizeName would convert differently.
    const rawAtt = String(attendee.name || '').trim().toLowerCase();
    const rawPart = String(participant.name || '').trim().toLowerCase();
    if (rawAtt && rawPart && rawAtt === rawPart && 98 > bestConfidence) {
      bestMatch = participant;
      bestConfidence = 98;
      bestMethod = 'exact_trim_name';
      continue; // No point checking softer stages for this participant.
    }

    // Stage 3 — exact_name: normalised (lowercased, punctuation stripped) equality.
    const nAtt = normalizeName(attendee.name || '');
    const nPart = normalizeName(participant.name || '');
    if (nAtt && nPart && nAtt === nPart && 95 > bestConfidence) {
      bestMatch = participant;
      bestConfidence = 95;
      bestMethod = 'exact_name';
      continue;
    }

    // Stage 3b — portal name after portal-side sanitizer vs normalised Zoom display name.
    const nSanPortal = normalizeName(
      sanitizePortalDisplayName(attendee.name || '', DISPLAY_NAME_MAX)
    );
    const nZoomName = normalizeName(participant.name || '');
    if (nSanPortal && nZoomName && nSanPortal === nZoomName && 94 > bestConfidence) {
      bestMatch = participant;
      bestConfidence = 94;
      bestMethod = 'sanitized_name';
      continue;
    }

    if (MATCH_CONFIG.STRICT_MATCH_MODE) {
      continue;
    }

    // Stage 4 — email_local (strong): local part of portal email closely matches Zoom display name.
    // Positioned after name stages so an exact name match always wins over email_local inference.
    const locConf = emailLocalPartVsZoomNameConfidence(attendee.email || '', participant.name || '');
    if (locConf >= 92 && locConf > bestConfidence) {
      bestMatch = participant;
      bestConfidence = locConf;
      bestMethod = 'email_local';
      continue;
    }

    // Stage 5 — email_local (weak): moderate confidence email-local inference.
    if (!largeClassSafe && locConf >= 75 && locConf > bestConfidence) {
      bestMatch = participant;
      bestConfidence = locConf;
      bestMethod = 'email_local';
    }

    if (!largeClassSafe) {
      // Stage 6 — containment / extended name overlap.
      const ext = extendedNameConfidence(attendee.name || '', participant.name || '');
      if (ext > bestConfidence && ext >= 80) {
        bestMatch = participant;
        bestConfidence = ext;
        bestMethod = 'containment';
      }

      // Stage 7 — initials: only when we don't already have a strong candidate.
      if (
        participant.name &&
        attendee.name &&
        bestConfidence < MATCH_CONFIG.STRONG_MATCH_MIN_CONFIDENCE
      ) {
        const initials = getInitials(attendee.name);
        const zm = normalizeName(participant.name || '');
        if (
          initials.length >= 2 &&
          zm.length > 0 &&
          zm.length <= MATCH_CONFIG.INITIALS_MAX_ZOOM_NAME_LEN &&
          initials === zm &&
          85 > bestConfidence
        ) {
          bestMatch = participant;
          bestConfidence = 85;
          bestMethod = 'initials_name';
          continue;
        }
      }
    }
  }

  // Fuzzy / partial name matching before join-time fallback so minor spelling differences
  // (e.g. Shiymala vs Shiyamala) are not blocked when several students join around the same time.
  if (!bestMatch && !blockWeakFallbacks && !skipFuzzyOnly && !largeClassSafe && !MATCH_CONFIG.STRICT_MATCH_MODE) {
    for (const participant of participants) {
      if (participant._matched || participant._reserved) continue;
      if (!participant.name || !attendee.name) continue;
      if (!hasNameTokenOverlap(attendee.name, participant.name)) continue;
      const similarity = calculateStringSimilarity(attendee.name, participant.name);
      if (similarity < 0.75) continue;
      const confidence = Math.round(similarity * 100);
      if (confidence > bestConfidence) {
        bestMatch = participant;
        bestConfidence = confidence;
        bestMethod = 'fuzzy_name';
      }
    }
  }

  if (!bestMatch && !blockWeakFallbacks && !largeClassSafe && !MATCH_CONFIG.STRICT_MATCH_MODE) {
    for (const participant of participants) {
      if (participant._matched || participant._reserved) continue;
      if (!participant.name || !attendee.name) continue;
      const confidence = calculatePartialNameMatch(attendee.name, participant.name);
      if (confidence > bestConfidence && confidence >= 75) {
        bestMatch = participant;
        bestConfidence = confidence;
        bestMethod = 'partial_name';
      }
    }
  }

  if (!MATCH_CONFIG.STRICT_MATCH_MODE && !largeClassSafe && !bestMatch && joinLogJoinedAt) {
    const target = new Date(joinLogJoinedAt).getTime();
    if (Number.isFinite(target)) {
      const candidates = participants.filter((p) => {
        if (p._matched || p._reserved) return false;
        if (!p.joinTime) return false;
        const dur = Number(p.duration);
        if (!Number.isFinite(dur) || dur <= MATCH_CONFIG.MIN_DURATION_SEC) return false;
        const jt = new Date(p.joinTime).getTime();
        if (!Number.isFinite(jt)) return false;
        return Math.abs(jt - target) <= MATCH_CONFIG.JOIN_TIME_WINDOW_MS;
      });

      if (candidates.length > 1) {
        const nameMatches = candidates
          .map((p) => ({
            participant: p,
            similarity: calculateStringSimilarity(attendee.name, p.name),
          }))
          .filter(
            (row) =>
              hasNameTokenOverlap(attendee.name, row.participant.name) &&
              row.similarity >= 0.75
          )
          .sort((a, b) => b.similarity - a.similarity);

        if (nameMatches.length === 1) {
          const bestP = nameMatches[0].participant;
          const baseConf = Math.round(nameMatches[0].similarity * 100);
          const jlUse = canUseParticipant(bestP, MP.FUZZY, matchContext);
          if (jlUse.ok) {
            return finalizeAssignment(
              attendee,
              bestP,
              baseConf,
              'fuzzy_name',
              joinLogJoinedAt,
              meetingDurationSec,
              { joinLogCandidatesCount: candidates.length, disambiguatedByName: true },
              matchContext,
              false
            );
          }
        }

        blockWeakFallbacks = true;
        matchLogger.info('JOIN_LOG_FALLBACK_SKIPPED', {
          traceId: String(traceId),
          meetingId: logCtx.meetingId,
          studentId: logCtx.studentId,
          candidatesCount: candidates.length,
          reason: 'multiple_candidates',
        });
        return {
          match: null,
          confidence: 0,
          finalConfidence: 0,
          method: 'ambiguous',
          ambiguous: true,
          mismatchReason: 'multiple_candidates',
          debug: mergeTrace(
            buildDebug(attendee, null, joinLogJoinedAt, {
              joinLogSkipReason: 'multiple_candidates',
              joinLogCandidatesCount: candidates.length,
            }),
            traceId
          ),
          debugSummary: 'Skipped: multiple candidates',
        };
      }

      if (candidates.length === 1) {
        const bestP = candidates[0];
        let baseConf = MATCH_CONFIG.JOIN_LOG_BASE_CONFIDENCE;
        const overlap = hasNameTokenOverlap(attendee.name, bestP.name);
        const initialsOk = initialsAlignPortalZoom(attendee.name, bestP.name);
        let weakIdentity = false;
        if (!overlap && !initialsOk) {
          baseConf = MATCH_CONFIG.JOIN_LOG_WEAK_CONFIDENCE;
          weakIdentity = true;
        }

        const durSec = Number(bestP.duration) || 0;
        const ratio =
          meetingDurationSec != null && meetingDurationSec > 0
            ? durSec / meetingDurationSec
            : 0;
        let timeDiffMs = null;
        try {
          timeDiffMs = Math.abs(new Date(bestP.joinTime).getTime() - target);
        } catch {
          timeDiffMs = null;
        }
        if (
          timeDiffMs != null &&
          Number.isFinite(timeDiffMs) &&
          timeDiffMs < 2 * 60 * 1000 &&
          ratio > 0.7
        ) {
          baseConf = Math.min(100, baseConf + 10);
        }

        const jlUse = canUseParticipant(bestP, MP.JOIN_LOG, matchContext);
        if (!jlUse.ok) {
          if (jlUse.reason === 'priority') {
            matchLogger.warn('STRONG_MATCH_PRIORITY_BLOCKED', {
              traceId: String(traceId),
              method: 'join_log_time',
              studentId: logCtx.studentId,
            });
          }
          matchLogger.info('JOIN_LOG_FALLBACK_SKIPPED', {
            traceId: String(traceId),
            meetingId: logCtx.meetingId,
            studentId: logCtx.studentId,
            reason: jlUse.reason,
          });
        } else {
          matchLogger.info('JOIN_LOG_FALLBACK_APPLIED', {
            traceId: String(traceId),
            meetingId: logCtx.meetingId,
            studentId: logCtx.studentId,
            zoomJoinTime: bestP.joinTime,
            joinLogTime: joinLogJoinedAt,
            weakIdentity,
            baseConf,
          });
          return finalizeAssignment(
            attendee,
            bestP,
            baseConf,
            'join_log_time',
            joinLogJoinedAt,
            meetingDurationSec,
            {
              weakIdentityMatch: weakIdentity,
              joinLogCandidatesCount: 1,
              timeDiffMs,
              durationRatioApprox: ratio,
            },
            matchContext,
            false
          );
        }
      }

      if (candidates.length === 0) {
        matchLogger.info('JOIN_LOG_FALLBACK_SKIPPED', {
          traceId: String(traceId),
          meetingId: logCtx.meetingId,
          studentId: logCtx.studentId,
          candidatesCount: 0,
          reason: 'no_eligible_participant',
        });
      }
    }
  }

  if (!bestMatch && !blockWeakFallbacks && participants.length === 1) {
    const only = participants[0];
    if (only && !only._matched && !only._reserved) {
      return finalizeAssignment(
        attendee,
        only,
        75,
        'single_participant',
        joinLogJoinedAt,
        meetingDurationSec,
        {},
        matchContext,
        false
      );
    }
  }

  if (bestMatch) {
    const immune =
      bestMethod === 'exact_trim_name' ||
      bestMethod === 'exact_name' ||
      bestMethod === 'sanitized_name';
    return finalizeAssignment(
      attendee,
      bestMatch,
      bestConfidence,
      bestMethod,
      joinLogJoinedAt,
      meetingDurationSec,
      {},
      matchContext,
      immune
    );
  }

  return emptyResult(joinLogJoinedAt, attendee, {
    ...(joinLogJoinedAt && !MATCH_CONFIG.STRICT_MATCH_MODE ? { joinLogSkipReason: 'no_match_after_rules' } : {}),
    traceId,
  });
}

function createAttendanceTraceId() {
  return new mongoose.Types.ObjectId();
}

module.exports = {
  findBestParticipantMatch,
  createAttendanceTraceId,
  normalizeEmailForMatch,
  normalizeDisplayName,
  normalizeName,
  getInitials,
  hasNameTokenOverlap,
};
