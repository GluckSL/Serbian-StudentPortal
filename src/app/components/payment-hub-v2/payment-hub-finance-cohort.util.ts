export type FinanceCohort = 'all' | 'platinum' | 'silver' | 'visa_docs';

export interface FinanceCohortQuery {
  cohort: FinanceCohort;
  status: string;
}

export function parseFinanceCohortQuery(params: Record<string, string | undefined>): FinanceCohortQuery {
  const rawCohort = String(params['cohort'] || 'all').toLowerCase();
  const cohort: FinanceCohort =
    rawCohort === 'platinum' || rawCohort === 'silver' || rawCohort === 'visa_docs' ? rawCohort : 'all';
  const status = String(params['status'] || '').trim().toUpperCase();
  return { cohort, status };
}

export function financeCohortLabel(cohort: FinanceCohort): string {
  switch (cohort) {
    case 'platinum':
      return 'Platinum';
    case 'silver':
      return 'Silver';
    case 'visa_docs':
      return 'Visa & docs';
    default:
      return 'All students';
  }
}

export function formatStudentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    UNCERTAIN: 'Uncertain',
    COMPLETED: 'Completed',
    WITHDREW: 'Withdrew',
    DROPPED: 'Dropped',
    ONGOING: 'Ongoing',
  };
  return labels[String(status || '').toUpperCase()] || status;
}

export interface PlanStatusBreakdownEntry {
  status: string;
  count: number;
}

export interface PortalStudentCounts {
  portalNonTest: number;
  ongoingNonTest: number;
  platinumTotal: number;
  platinumOngoing: number;
  platinumStatusBreakdown: PlanStatusBreakdownEntry[];
  silverTotal: number;
  silverOngoing: number;
  silverStatusBreakdown: PlanStatusBreakdownEntry[];
  visaDocsTotal: number;
  visaDocsOngoing: number;
  visaDocsStatusBreakdown: PlanStatusBreakdownEntry[];
}
