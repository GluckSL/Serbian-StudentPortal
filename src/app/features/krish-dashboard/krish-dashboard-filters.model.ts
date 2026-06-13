export type KrishPackage = 'PLATINUM' | 'SILVER' | 'VISA_DOCS';

export type KrishStatus  = 'UNCERTAIN' | 'ONGOING' | 'COMPLETED' | 'WITHDREW';



/** CRM "Service Opted" values shown on dashboard cards. */

export const SERVICE_OPTED_CATALOG = [

  'Only for language',

  'Ausbildung',

  'Dependant',

  'Skilled Jobs',

] as const;



export type ServiceOptedName = typeof SERVICE_OPTED_CATALOG[number];



export const PACKAGE_LABELS: Record<KrishPackage, string> = {

  PLATINUM: 'Platinum',

  SILVER: 'Silver',

  VISA_DOCS: 'Visa & Docs',

};



export const STATUS_LABELS: Record<KrishStatus, string> = {

  UNCERTAIN: 'Uncertain',

  ONGOING: 'Ongoing',

  COMPLETED: 'Completed',

  WITHDREW: 'Withdrew',

};



export const STATUS_COLORS: Record<KrishStatus, string> = {

  UNCERTAIN: '#d97706',

  ONGOING:   '#16a34a',

  COMPLETED: '#2563eb',

  WITHDREW:  '#dc2626',

};



/** Statuses listed in package/service card breakdown (Finance Dashboard style). */

export const CARD_BREAKDOWN_STATUSES: KrishStatus[] = ['UNCERTAIN', 'COMPLETED', 'WITHDREW'];



export interface KrishDashboardFilters {
  statuses: KrishStatus[];
  packages: KrishPackage[];
  serviceNames: string[];
  professions: string[];
  languageLevels: string[];
  documentPaymentStatuses: string[];
  documentationStatuses: string[];
  visaStatuses: string[];
  search: string;
  counselor: string;
  page: number;
  limit: number;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export const DEFAULT_FILTERS: KrishDashboardFilters = {
  statuses: [],
  packages: [],
  serviceNames: [],
  professions: [],
  languageLevels: [],
  documentPaymentStatuses: [],
  documentationStatuses: [],
  visaStatuses: [],
  search: '',
  counselor: '',
  page: 1,
  limit: 25,
  sortBy: 'updatedAt',
  sortDir: 'desc',
};

export type ColumnFilterKey =
  | 'languageLevel'
  | 'package'
  | 'service'
  | 'status'
  | 'doc'
  | 'visa';

export const COLUMN_FILTER_LABELS: Record<ColumnFilterKey, string> = {
  languageLevel: 'Language Level',
  package: 'Package',
  service: 'Service & Professional',
  status: 'Status',
  doc: 'Documentation',
  visa: 'Visa Status',
};

export function joinFilterValues(values: string[]): string | undefined {
  return values.length ? values.join(',') : undefined;
}

export interface FacetOption {
  value: string;
  label: string;
  total: number;
  ongoing?: number;
}

export type KrishFilterCategory =
  | 'service'
  | 'languageLevel'
  | 'package'
  | 'status'
  | 'profession'
  | 'docPayment'
  | 'docStatus'
  | 'visa';

/** @deprecated Use column header filters — kept for analytics card helpers */
export const FILTER_CATEGORIES: { id: KrishFilterCategory; label: string }[] = [
  { id: 'service', label: 'Service' },
  { id: 'languageLevel', label: 'Language Level' },
  { id: 'package', label: 'Package' },
  { id: 'status', label: 'Status' },
  { id: 'profession', label: 'Professional' },
  { id: 'docPayment', label: 'Doc Payment' },
  { id: 'docStatus', label: 'Doc Status' },
  { id: 'visa', label: 'Visa Status' },
];

export const UNSPECIFIED_PROFESSION = 'Unspecified';

export function facetValueToFilter(value: string): string {
  return value === UNSPECIFIED_PROFESSION ? '__UNSPECIFIED__' : value;
}

export function filterValueToLabel(value: string): string {
  return value === '__UNSPECIFIED__' ? UNSPECIFIED_PROFESSION : value;
}

export const NON_SKILLED_PROFESSION_KEYS = new Set([
  'others',
  'other',
  'o/l',
  'a/l',
  'o l & a l',
  'o/l & a/l',
  'ol & al',
  'unspecified',
]);

export function normalizeProfessionKey(label?: string | null): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, ' & ');
}

export function isNonSkilledProfessionLabel(label?: string | null): boolean {
  const key = normalizeProfessionKey(label);
  if (!key) return true;
  return NON_SKILLED_PROFESSION_KEYS.has(key);
}



// ── Domain types ──────────────────────────────────────────────────────────



export interface SalesStudentSvc {

  _id: string;

  serviceName: string;

}



export interface SalesStudentNote {

  _id: string;

  type: 'NOTE' | 'FOLLOW_UP';

  content: string;

  followUpDate?: string;

  isCompleted?: boolean;

  createdAt: string;

}



export interface SalesStudentStatusEvent {

  _id: string;

  fromStatus: string | null;

  toStatus: string;

  note?: string;

  createdAt: string;

}



export interface SalesStudent {

  _id: string;

  name: string;

  email: string;

  phone?: string;

  age?: number;

  package: KrishPackage;

  status: KrishStatus;

  counselor?: string;
  profession?: string;
  qualifications?: string;
  specialization?: string;
  currentLanguageLevel?: string;
  documentPaymentStatus?: string;
  documentationStatus?: string;
  documentationRemarks?: string;
  visaStatus?: string;
  notes?: string;

  services?: SalesStudentSvc[];

  statusHistory?: SalesStudentStatusEvent[];

  notesHistory?: SalesStudentNote[];

  createdAt: string;

  updatedAt: string;

}



export interface StatusBreakdownRow {

  status: KrishStatus;

  count: number;

}



export interface PackageStat {

  package: KrishPackage;

  total: number;

  ongoing: number;

  uncertain?: number;

  completed?: number;

  withdrew?: number;

  statusBreakdown: StatusBreakdownRow[];

}



export interface ServiceStat {
  serviceName: string;
  label: string;
  total: number;
  ongoing: number;
  uncertain?: number;
  completed?: number;
  withdrew?: number;
  statusBreakdown: StatusBreakdownRow[];
}

export interface ProfessionStat {
  profession: string;
  label: string;
  total: number;
  ongoing: number;
  uncertain?: number;
  completed?: number;
  withdrew?: number;
  statusBreakdown: StatusBreakdownRow[];
}



export interface KrishAnalytics {

  totals: {

    total: number;

    ongoing: number;

    uncertain: number;

    completed: number;

    withdrew: number;

  };

  packages: PackageStat[];
  services: ServiceStat[];
  professionBreakdowns?: Record<string, ProfessionStat[]>;
  /** All students by Excel Professional column — matches sheet-wide totals. */
  sheetProfessions?: ProfessionStat[];
  languageLevels?: FacetOption[];
  documentPaymentStatuses?: FacetOption[];
  documentationStatuses?: FacetOption[];
  visaStatuses?: FacetOption[];
  counselors: FacetOption[];
}



export interface PaginationMeta {

  total: number;

  page: number;

  limit: number;

  pages: number;

}

