import { StudentActivityEvent } from '../services/student-log.service';

export const PORTAL_IDLE_GAP_MS = 30 * 60 * 1000;
export const PORTAL_MAX_SESSION_MS = 8 * 60 * 60 * 1000;

export interface AnalyticsContext {
  selectedStudentId?: string;
  selectedStudentLabel?: string;
}

export interface TimeSummary {
  totalMinutes: number;
  activeStudents: number;
  avgMinutesPerStudent: number;
  topPage: string;
  topStudent: string;
}

export interface StudentTimeRow {
  studentId: string;
  student: string;
  minutes: number;
  visits: number;
  pages: number;
}

export interface PageTimeRow {
  page: string;
  minutes: number;
  visits: number;
  students: number;
}

export interface DayTimeRow {
  day: string;
  dayLabel: string;
  minutes: number;
  visits: number;
  students: number;
}

export interface AggregatedAnalytics {
  timeSummary: TimeSummary;
  studentTimeRows: StudentTimeRow[];
  pageTimeRows: PageTimeRow[];
  dayTimeRows: DayTimeRow[];
}

export function isAuthActivity(ev: StudentActivityEvent): boolean {
  return ev.type === 'LOGIN' || ev.type === 'LOGOUT';
}

export function resolveEventPage(ev: StudentActivityEvent): string {
  const d = ev.details || {};
  switch (ev.type) {
    case 'LOGIN':
    case 'LOGOUT':
      return 'Auth';
    case 'MEETING_ATTENDANCE':
      return d.topic ? `Meeting · ${d.topic}` : 'Meeting';
    case 'EXERCISE_ATTEMPT':
      return d.exerciseTitle ? `Digital Exercise · ${d.exerciseTitle}` : 'Digital Exercise';
    case 'MODULE_PROGRESS':
      return d.moduleTitle ? `Learning Module · ${d.moduleTitle}` : 'Learning Modules';
    case 'SESSION_RECORD':
      return d.moduleTitle ? `AI Session · ${d.moduleTitle}` : 'AI Session';
    case 'ASSIGNMENT_SUBMISSION':
      return d.title ? `Assignments · ${d.title}` : 'Assignments';
    case 'PROFILE_UPDATE':
      return 'Student Profile';
    default:
      return ev.type;
  }
}

export function resolveDayKey(ev: StudentActivityEvent): string {
  const d = new Date(ev.occurredAt);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function resolveStudentLabel(ev: StudentActivityEvent, ctx: AnalyticsContext): string {
  if (ev.student) {
    return `${ev.student.name} (${ev.student.regNo})`;
  }
  return ctx.selectedStudentLabel || 'Selected student';
}

function sortEventsChrono(events: StudentActivityEvent[]): StudentActivityEvent[] {
  return [...events].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
}

function inferMinutesFromEvent(ev: StudentActivityEvent): number {
  const d = ev.details || {};
  switch (ev.type) {
    case 'SESSION_RECORD':
      return Math.max(0, Math.round(Number(d.durationMinutes) || 0));
    case 'MEETING_ATTENDANCE':
      return Math.max(0, Math.round(Number(d.attendedMinutes) || 0));
    case 'EXERCISE_ATTEMPT':
      return Math.max(0, Math.round((Number(d.timeSpentSeconds) || 0) / 60));
    default:
      return 0;
  }
}

export function portalSessionMinutesForStudent(events: StudentActivityEvent[]): number {
  const sorted = sortEventsChrono(events);
  if (sorted.length === 0) return 0;
  let totalMs = 0;
  let sessionStart = new Date(sorted[0].occurredAt).getTime();
  let lastT = sessionStart;
  for (let i = 1; i < sorted.length; i++) {
    const t = new Date(sorted[i].occurredAt).getTime();
    if (t - lastT > PORTAL_IDLE_GAP_MS) {
      totalMs += Math.min(Math.max(0, lastT - sessionStart), PORTAL_MAX_SESSION_MS);
      sessionStart = t;
    }
    lastT = t;
  }
  totalMs += Math.min(Math.max(0, lastT - sessionStart), PORTAL_MAX_SESSION_MS);
  const spanMin = Math.max(0, Math.round(totalMs / 60000));

  let inferSum = 0;
  let hasNonAuth = false;
  for (const ev of sorted) {
    if (isAuthActivity(ev)) continue;
    hasNonAuth = true;
    inferSum += inferMinutesFromEvent(ev);
  }
  if (!hasNonAuth) return 0;
  const combined = Math.max(spanMin, inferSum);
  if (combined === 0) return 1;
  return combined;
}

export function allocatePortalMinutesByPageAndDay(events: StudentActivityEvent[]): {
  pageMinutes: Map<string, number>;
  dayMinutes: Map<string, { dayLabel: string; minutes: number }>;
  totalMinutes: number;
} {
  const pageMinutes = new Map<string, number>();
  const dayMinutes = new Map<string, { dayLabel: string; minutes: number }>();
  const sorted = sortEventsChrono(events);
  if (sorted.length === 0) {
    return { pageMinutes, dayMinutes, totalMinutes: 0 };
  }

  let totalMinutes = 0;
  let lastT = new Date(sorted[0].occurredAt).getTime();
  let sessionStartIdx = 0;

  const flushSession = (endIdx: number) => {
    const slice = sorted.slice(sessionStartIdx, endIdx + 1);
    const rawMs = Math.max(
      0,
      new Date(slice[slice.length - 1].occurredAt).getTime() - new Date(slice[0].occurredAt).getTime()
    );
    const durMs = Math.min(rawMs, PORTAL_MAX_SESSION_MS);
    let durMin = Math.max(0, Math.round(durMs / 60000));
    let inferSlice = 0;
    for (const e of slice) {
      if (!isAuthActivity(e)) inferSlice += inferMinutesFromEvent(e);
    }
    durMin = Math.max(durMin, inferSlice);
    if (durMin === 0) {
      const hasNonAuth = slice.some((e) => !isAuthActivity(e));
      if (hasNonAuth) durMin = 1;
    }
    totalMinutes += durMin;
    if (durMin <= 0) return;

    const pages = new Set(slice.map((e) => resolveEventPage(e)).filter((p) => p !== 'Auth'));
    const n = Math.max(1, pages.size);
    const perPage = durMin / n;
    for (const p of pages) {
      pageMinutes.set(p, (pageMinutes.get(p) || 0) + perPage);
    }

    const dayKey = resolveDayKey(slice[0]);
    const dayLabel =
      dayKey === 'unknown' ? 'Unknown day' : new Date(`${dayKey}T00:00:00`).toLocaleDateString();
    const prev = dayMinutes.get(dayKey);
    dayMinutes.set(dayKey, {
      dayLabel,
      minutes: (prev?.minutes || 0) + durMin
    });
  };

  for (let i = 1; i < sorted.length; i++) {
    const t = new Date(sorted[i].occurredAt).getTime();
    if (t - lastT > PORTAL_IDLE_GAP_MS) {
      flushSession(i - 1);
      sessionStartIdx = i;
    }
    lastT = t;
  }
  flushSession(sorted.length - 1);

  return { pageMinutes, dayMinutes, totalMinutes };
}

export function computeAggregatedAnalytics(
  filteredEvents: StudentActivityEvent[],
  ctx: AnalyticsContext
): AggregatedAnalytics {
  const studentMap = new Map<
    string,
    { studentId: string; student: string; minutes: number; visits: number; pages: Set<string> }
  >();
  const pageMap = new Map<string, { page: string; minutes: number; visits: number; students: Set<string> }>();
  const dayMap = new Map<
    string,
    { day: string; dayLabel: string; minutes: number; visits: number; students: Set<string> }
  >();

  const byStudentEvents = new Map<string, StudentActivityEvent[]>();
  for (const ev of filteredEvents) {
    const student = resolveStudentLabel(ev, ctx);
    const studentId = ev.student?._id || ctx.selectedStudentId || student;
    const page = resolveEventPage(ev);
    const day = resolveDayKey(ev);
    const skipForAggregates = isAuthActivity(ev);

    const stuRow =
      studentMap.get(studentId) || { studentId, student, minutes: 0, visits: 0, pages: new Set<string>() };
    if (!skipForAggregates) {
      stuRow.visits += 1;
      stuRow.pages.add(page);
    }
    studentMap.set(studentId, stuRow);

    if (!skipForAggregates) {
      const pageRow = pageMap.get(page) || { page, minutes: 0, visits: 0, students: new Set<string>() };
      pageRow.visits += 1;
      pageRow.students.add(studentId);
      pageMap.set(page, pageRow);

      const dayLabel = day === 'unknown' ? 'Unknown day' : new Date(`${day}T00:00:00`).toLocaleDateString();
      const dayRow = dayMap.get(day) || { day, dayLabel, minutes: 0, visits: 0, students: new Set<string>() };
      dayRow.visits += 1;
      dayRow.students.add(studentId);
      dayMap.set(day, dayRow);
    }

    const arr = byStudentEvents.get(studentId) || [];
    arr.push(ev);
    byStudentEvents.set(studentId, arr);
  }

  let totalMinutes = 0;
  for (const [studentId, evs] of byStudentEvents) {
    const portalMin = portalSessionMinutesForStudent(evs);
    totalMinutes += portalMin;
    const row = studentMap.get(studentId);
    if (row) row.minutes = portalMin;

    const { pageMinutes, dayMinutes } = allocatePortalMinutesByPageAndDay(evs);
    for (const [p, mins] of pageMinutes) {
      if (p === 'Auth') continue;
      let pr = pageMap.get(p);
      if (!pr) {
        pr = { page: p, minutes: 0, visits: 0, students: new Set<string>() };
        pr.students.add(studentId);
        pageMap.set(p, pr);
      }
      pr.minutes += mins;
    }
    for (const [dk, { minutes: dm, dayLabel: dl }] of dayMinutes) {
      let dr = dayMap.get(dk);
      if (!dr) {
        const dayLabel =
          dl || (dk === 'unknown' ? 'Unknown day' : new Date(`${dk}T00:00:00`).toLocaleDateString());
        dr = { day: dk, dayLabel, minutes: 0, visits: 0, students: new Set<string>() };
        dr.students.add(studentId);
        dayMap.set(dk, dr);
      }
      dr.minutes += dm;
    }
  }

  const students = Array.from(studentMap.values())
    .map((row) => ({
      studentId: row.studentId,
      student: row.student,
      minutes: row.minutes,
      visits: row.visits,
      pages: row.pages.size
    }))
    .sort((a, b) => b.minutes - a.minutes || b.visits - a.visits);
  const pages = Array.from(pageMap.values())
    .filter((row) => row.page !== 'Auth')
    .map((row) => ({
      page: row.page,
      minutes: Math.round(row.minutes),
      visits: row.visits,
      students: row.students.size
    }))
    .sort((a, b) => b.minutes - a.minutes || b.visits - a.visits);
  const days = Array.from(dayMap.values())
    .map((row) => ({
      day: row.day,
      dayLabel: row.dayLabel,
      minutes: Math.round(row.minutes),
      visits: row.visits,
      students: row.students.size
    }))
    .sort((a, b) => b.day.localeCompare(a.day));

  return {
    timeSummary: {
      totalMinutes,
      activeStudents: students.length,
      avgMinutesPerStudent: students.length ? Math.round(totalMinutes / students.length) : 0,
      topPage: pages[0]?.page || '—',
      topStudent: students[0]?.student || '—'
    },
    studentTimeRows: students,
    pageTimeRows: pages,
    dayTimeRows: days
  };
}

export function portalMinutesForEventGroup(
  events: StudentActivityEvent[],
  ctx: AnalyticsContext
): number {
  if (events.length === 0) return 0;
  const byStudent = new Map<string, StudentActivityEvent[]>();
  for (const ev of events) {
    const student = resolveStudentLabel(ev, ctx);
    const studentId = ev.student?._id || ctx.selectedStudentId || student;
    const arr = byStudent.get(studentId) || [];
    arr.push(ev);
    byStudent.set(studentId, arr);
  }
  let sum = 0;
  for (const evs of byStudent.values()) {
    sum += portalSessionMinutesForStudent(evs);
  }
  return sum;
}

export function buildGroupedRows(
  timelineEvents: StudentActivityEvent[],
  groupBy: 'none' | 'student' | 'page' | 'day',
  ctx: AnalyticsContext,
  formatMinutes: (n: number) => string
): { key: string; title: string; subtitle: string; events: StudentActivityEvent[] }[] {
  if (groupBy === 'none') return [];

  const map = new Map<string, StudentActivityEvent[]>();
  for (const ev of timelineEvents) {
    let key = '';
    if (groupBy === 'student') key = resolveStudentLabel(ev, ctx);
    if (groupBy === 'page') key = resolveEventPage(ev);
    if (groupBy === 'day') key = resolveDayKey(ev);
    const arr = map.get(key) || [];
    arr.push(ev);
    map.set(key, arr);
  }

  return Array.from(map.entries())
    .map(([key, evs]) => {
      const minutes = portalMinutesForEventGroup(evs, ctx);
      const title =
        groupBy === 'day' && key !== 'unknown' ? new Date(`${key}T00:00:00`).toLocaleDateString() : key;
      return {
        key,
        title,
        subtitle: `${evs.length} events · ${formatMinutes(minutes)}`,
        events: evs
      };
    })
    .sort((a, b) => b.events.length - a.events.length);
}

/** Match student-logs feed limit scaling. */
export function feedLimitForRange(fromDate: string, toDate: string): number {
  if (!fromDate || !toDate) return 1200;
  const from = new Date(fromDate).getTime();
  const to = new Date(toDate).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 1200;
  const spanDays = Math.max((to - from) / 86400000, 1 / 24);
  return Math.min(20000, Math.max(1200, Math.ceil(600 * Math.min(spanDays, 90))));
}

export function eachCalendarDayKey(fromDate: string, toDate: string): string[] {
  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const keys: string[] = [];
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    keys.push(`${yyyy}-${mm}-${dd}`);
  }
  return keys;
}
