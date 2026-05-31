export interface PortalDailyLogDetailPage {
  page: string;
  rawPage: string;
  seconds: number;
}

export interface PortalDailyLogDetailStudent {
  studentId: string;
  name: string;
  seconds: number;
}

export interface PortalDailyLogRow {
  date: string;
  portalSeconds: number;
  interactions: number;
  uniqueStudents: number;
  avgStudentSeconds: number;
  topPage: { page: string; rawPage: string; seconds: number } | null;
  topStudent: { studentId: string; name: string; seconds: number } | null;
  details: {
    pages: PortalDailyLogDetailPage[];
    students: PortalDailyLogDetailStudent[];
  };
}

export function normalizeDailyLogsApi(raw: unknown): PortalDailyLogRow[] {
  const body = (raw || {}) as { items?: unknown[] };
  const items = Array.isArray(body.items) ? body.items : [];
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return items.map((it) => {
    const x = it as Record<string, unknown>;
    const topPageRaw = x['topPage'] as Record<string, unknown> | null | undefined;
    const topStudentRaw = x['topStudent'] as Record<string, unknown> | null | undefined;
    const detailsRaw = (x['details'] || {}) as Record<string, unknown>;
    const pagesArr = Array.isArray(detailsRaw['pages']) ? detailsRaw['pages'] : [];
    const studentsArr = Array.isArray(detailsRaw['students']) ? detailsRaw['students'] : [];
    return {
      date: String(x['date'] || ''),
      portalSeconds: num(x['portalSeconds']),
      interactions: num(x['interactions']),
      uniqueStudents: num(x['uniqueStudents']),
      avgStudentSeconds: num(x['avgStudentSeconds']),
      topPage: topPageRaw
        ? {
            page: String(topPageRaw['page'] || '—'),
            rawPage: String(topPageRaw['rawPage'] || ''),
            seconds: num(topPageRaw['seconds'])
          }
        : null,
      topStudent: topStudentRaw
        ? {
            studentId: String(topStudentRaw['studentId'] || ''),
            name: String(topStudentRaw['name'] || '—'),
            seconds: num(topStudentRaw['seconds'])
          }
        : null,
      details: {
        pages: pagesArr.map((p) => {
          const pr = p as Record<string, unknown>;
          return {
            page: String(pr['page'] || '—'),
            rawPage: String(pr['rawPage'] || ''),
            seconds: num(pr['seconds'])
          };
        }),
        students: studentsArr.map((s) => {
          const sr = s as Record<string, unknown>;
          return {
            studentId: String(sr['studentId'] || ''),
            name: String(sr['name'] || '—'),
            seconds: num(sr['seconds'])
          };
        })
      }
    };
  });
}
