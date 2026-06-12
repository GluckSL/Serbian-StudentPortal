/** Normalize MongoDB exercise id from API payloads or route segments. */
export function exerciseIdForRoute(exercise: { _id?: unknown; id?: unknown } | null | undefined): string {
  const raw = exercise?._id ?? exercise?.id;
  return normalizeExerciseIdValue(raw);
}

export function normalizeExerciseIdValue(raw: unknown): string {
  if (raw == null) return '';
  let id = '';
  if (typeof raw === 'string') {
    id = raw.trim();
  } else if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    id = String(o['$oid'] ?? o['_id'] ?? o['id'] ?? '').trim();
  } else {
    id = String(raw).trim();
  }
  return id.replace(/\//g, '');
}

/**
 * Join route params when a 24-char ObjectId was accidentally split across URL segments
 * (e.g. /digital-exercises/6a24/8abbb1eb23d0a6a9324/play).
 */
export function resolveExerciseIdFromRouteParts(primary: string, secondary?: string | null): string {
  const a = normalizeExerciseIdValue(primary);
  const b = normalizeExerciseIdValue(secondary);
  if (!a) return '';
  if (!b) return a;
  const joined = `${a}${b}`;
  if (/^[a-f0-9]{24}$/i.test(joined)) return joined;
  if (/^[a-f0-9]{24}$/i.test(a)) return a;
  return joined;
}

/** Parse exercise id from a router URL path. */
export function resolveExerciseIdFromUrl(url: string): string {
  const path = String(url || '').split('?')[0];
  const match = path.match(/\/digital-exercises\/([^/]+(?:\/[^/]+)?)\/play\/?$/i);
  if (!match) return '';
  const segments = match[1].split('/').filter(Boolean);
  if (segments.length === 1) return normalizeExerciseIdValue(segments[0]);
  if (segments.length >= 2) {
    return resolveExerciseIdFromRouteParts(segments[0], segments.slice(1).join(''));
  }
  return '';
}

export function digitalExercisePlayCommands(
  exercise: { _id?: unknown; id?: unknown } | null | undefined,
): string[] {
  const id = exerciseIdForRoute(exercise);
  if (!id) return ['/student/my-course'];
  return ['/digital-exercises', id, 'play'];
}
