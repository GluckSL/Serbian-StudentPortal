/**
 * Match roster attendees to Zoom past-meeting participants.
 * Zoom often omits user_email for guests; display names may omit last name or add device suffixes.
 */

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

function normalizeDisplayName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*[\(\[\u2013\u2014-]\s*(iphone|ipad|android|phone|tablet|desktop|pc|mac|windows)\s*[\)\]]?/gi, ' ')
    .replace(/\s*'s\s+(iphone|ipad|phone|tablet)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 1;
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1;
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

function calculatePartialNameMatch(registeredName, zoomName) {
  const registered = registeredName.toLowerCase().trim().split(/\s+/);
  const zoom = zoomName.toLowerCase().trim().split(/\s+/);
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

/**
 * Strong name match when Zoom shows first name only or a substring of the roster name.
 */
/**
 * Match Zoom display name to the student email local part (before @), after stripping digits.
 * Example: sourav413@gmail.com + Zoom name "Sourav" → local "sourav413" → "sourav" === token "sourav".
 */
function emailLocalPartVsZoomNameConfidence(attendeeEmail, zoomName) {
  if (!attendeeEmail || !zoomName) return 0;
  const normalized = normalizeEmailForMatch(attendeeEmail);
  const at = normalized.indexOf('@');
  if (at < 0) return 0;
  let local = normalized.slice(0, at);
  if (!local) return 0;

  const localAlpha = local.replace(/\d/g, '');
  const zNorm = normalizeDisplayName(zoomName);
  if (!localAlpha || !zNorm) return 0;

  const tokens = zNorm.split(/\s+/).filter(Boolean);
  let best = 0;

  for (const tok of tokens) {
    const t = tok.replace(/[^a-z]/gi, '');
    if (t.length < 2) continue;

    if (localAlpha === t) {
      best = Math.max(best, 95);
      continue;
    }
    if (t.length >= 3 && localAlpha.startsWith(t)) {
      best = Math.max(best, 93);
      continue;
    }
    if (localAlpha.length >= 3 && t.startsWith(localAlpha)) {
      best = Math.max(best, 92);
      continue;
    }
    if (t.length >= 4 && localAlpha.includes(t)) {
      best = Math.max(best, 89);
    }
  }

  return best;
}

function extendedNameConfidence(attendeeName, zoomName) {
  const a = normalizeDisplayName(attendeeName);
  const b = normalizeDisplayName(zoomName);
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

/**
 * @param {object} attendee - { name, email, ... }
 * @param {object[]} participants - from zoomService.getMeetingParticipants
 */
function findBestParticipantMatch(attendee, participants) {
  if (!participants || participants.length === 0) {
    return { match: null, confidence: 0, method: 'no_match' };
  }

  const attendeeEmail = normalizeEmailForMatch(attendee.email || '');
  let bestMatch = null;
  let bestConfidence = 0;
  let bestMethod = 'no_match';

  for (const participant of participants) {
    if (participant._matched) continue;

    const pEmail = normalizeEmailForMatch(participant.email || '');

    if (pEmail && attendeeEmail && pEmail === attendeeEmail) {
      return {
        match: { ...participant, _matched: true },
        confidence: 100,
        method: 'email'
      };
    }

    const locConf = emailLocalPartVsZoomNameConfidence(attendee.email || '', participant.name || '');
    if (locConf >= 92) {
      return {
        match: { ...participant, _matched: true },
        confidence: locConf,
        method: 'email_local'
      };
    }
    if (locConf > bestConfidence && locConf >= 88) {
      bestMatch = participant;
      bestConfidence = locConf;
      bestMethod = 'email_local';
    }

    const nAtt = normalizeDisplayName(attendee.name || '');
    const nPart = normalizeDisplayName(participant.name || '');
    if (nAtt && nPart && nAtt === nPart) {
      if (90 > bestConfidence) {
        bestMatch = participant;
        bestConfidence = 90;
        bestMethod = 'exact_name';
      }
      continue;
    }

    const ext = extendedNameConfidence(attendee.name || '', participant.name || '');
    if (ext > bestConfidence && ext >= 80) {
      bestMatch = participant;
      bestConfidence = ext;
      bestMethod = 'containment';
    }

    if (participant.name && attendee.name) {
      const confidence = calculatePartialNameMatch(attendee.name, participant.name);
      if (confidence > bestConfidence && confidence >= 55) {
        bestMatch = participant;
        bestConfidence = confidence;
        bestMethod = 'partial_name';
      }
    }

    if (participant.name && attendee.name) {
      const similarity = calculateStringSimilarity(attendee.name, participant.name);
      const confidence = Math.round(similarity * 70);
      if (confidence > bestConfidence && confidence >= 35) {
        bestMatch = participant;
        bestConfidence = confidence;
        bestMethod = 'fuzzy_name';
      }
    }
  }

  if (!bestMatch && participants.length === 1) {
    const only = participants[0];
    if (only && !only._matched) {
      return {
        match: { ...only, _matched: true },
        confidence: 75,
        method: 'single_participant'
      };
    }
  }

  if (bestMatch) {
    bestMatch._matched = true;
  }

  return {
    match: bestMatch,
    confidence: bestConfidence,
    method: bestMethod
  };
}

module.exports = {
  findBestParticipantMatch,
  normalizeEmailForMatch,
  normalizeDisplayName
};
