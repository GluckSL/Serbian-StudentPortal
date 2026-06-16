import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CefrRow {
  code: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  order: number;
  lkr: number;
  inr: number;
}

export interface ReferenceRow {
  label: string;
  lkr: number;
  inr: number;
}

export interface ScheduleStep {
  label?: string;
  daysFromEnrollment?: number | null;
  amountLkr?: number | null;
  amountInr?: number | null;
}

export interface InstallmentSchedule {
  title?: string;
  notes?: string;
  steps?: ScheduleStep[];
}

export interface PricingCatalog {
  _id?: string;
  cefrRows: CefrRow[];
  referenceRows: ReferenceRow[];
  defaultInstallmentSchedule?: InstallmentSchedule;
  updatedAt?: string;
}

export interface StudentCatalog {
  cefrRows: CefrRow[];
  studentLevel?: string | null;
  /** Currency inferred from the student's phone number (INR / LKR / USD) */
  inferredCurrency?: string;
}

export interface CatalogPaymentLevelRow {
  level: string;
  studentCount: number;
  feeLKR: number;
  feeINR: number;
  feeUSD: number;
  totalLKR: number;
  totalINR: number;
  totalUSD: number;
}

export interface DashboardStats {
  totalPaymentExpectedLKR: number;
  totalPaymentExpectedINR: number;
  totalPaymentExpectedUSD: number;
  catalogPaymentBreakdown?: CatalogPaymentLevelRow[];
  totalDueLKR: number;
  totalDueINR: number;
  totalDueUSD: number;
  totalReceivedLKR: number;
  totalReceivedINR: number;
  totalReceivedUSD: number;
  pendingApprovalAmountLKR: number;
  pendingApprovalAmountINR: number;
  pendingApprovalAmountUSD: number;
  totalExpectedThisMonthLKR: number;
  totalExpectedThisMonthINR: number;
  totalExpectedThisMonthUSD: number;
  totalOverdueLKR: number;
  totalOverdueINR: number;
  totalOverdueUSD: number;
  totalStudents: number;
  fullyPaidStudents: number;
  balanceStudents: number;
  overdueStudents: number;
  docsPaidStudents: number;
  visaPaidStudents: number;
  activeStudents?: number;
  overdueCount: number;
  /** True when dashboard stats respect current hub filters */
  filtered?: boolean;
  filterSummary?: string;
}

/** Row returned by GET /students/browse — User-primary with optional profile data */
export interface CurrencyPaidTotals {
  totalPaidLKR: number;
  totalPaidINR: number;
  totalPaidUSD: number;
}

export interface CurrencyBucket {
  LKR: number;
  INR: number;
  USD: number;
}

export interface CurrencyPendingTotals {
  pendingApprovalAmountLKR: number;
  pendingApprovalAmountINR: number;
  pendingApprovalAmountUSD: number;
}

export interface CurrencyOverdueTotals {
  overdueAmountLKR: number;
  overdueAmountINR: number;
  overdueAmountUSD: number;
}

export interface StudentBrowseRow extends CurrencyPaidTotals, CurrencyPendingTotals, CurrencyOverdueTotals {
  _id: string;
  name: string;
  email: string;
  batch?: string;
  level?: string;
  subscription?: string;
  enrollmentDate?: string;
  createdAt?: string;
  phoneNumber?: string;
  /** Currency inferred from phone prefix (INR / LKR / USD) */
  inferredCurrency: string;
  totalPaid: number;
  pendingApprovalAmount: number;
  overdueAmount: number;
  balanceDue: number;
  overallStatus: string;
  lastPaymentDate?: string;
}

export type PaymentPaidSlotBadge = 'ALL' | 'A1' | 'A2' | 'B1' | 'B2' | 'DOCS' | 'VISA';

/** Legacy table row (profile-primary, All Payments hub) */
export interface StudentTableRow extends CurrencyPaidTotals, CurrencyPendingTotals, CurrencyOverdueTotals {
  _id: string;
  studentId: {
    _id: string;
    name: string;
    email: string;
    batch?: string;
    level?: string;
    phoneNumber?: string;
    enrollmentDate?: string;
    dateJoined?: string;
    createdAt?: string;
    currentCourseDay?: number;
    isTestAccount?: boolean;
  };
  totalPaid: number;
  pendingApprovalAmount: number;
  overdueAmount: number;
  overallStatus: string;
  /** Open LANGUAGE_FEE amount remaining (0 = full paid for language course). */
  languageFeeBalance?: number;
  /** FULL_PAID | BALANCE (journey under 10) | DUE (journey 10+). */
  languageFeeStatus?: string;
  lastRebuiltAt?: string;
  /** LKR / INR / USD from phone prefix (server-side). */
  inferredCurrency?: string;
  /** Settled payment slots for Total received badges (ALL = every slot paid). */
  paidSlots?: PaymentPaidSlotBadge[];
}

export interface BulkLegacyLanguageRow {
  studentId: string;
  totalCourseFee: number;
  amountPaid: number;
  currency: string;
  paymentDate: string;
  remarks?: string;
}

export interface BulkLegacyLanguageResult {
  succeeded: { studentId: string }[];
  failed: { studentId: string; message: string; code?: string }[];
}

export interface PagedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ApprovalQueueItem {
  _id: string;
  paymentRequestId: {
    _id: string;
    amount: number;
    amountRemaining?: number;
    currency: string;
    paymentType: string;
    customType?: string;
    dueDate: string;
    remarks?: string;
    installmentAllowed?: boolean;
    totalInstallments?: number;
  };
  studentId: {
    _id: string;
    name: string;
    email: string;
    batch?: string;
    level?: string;
  };
  paidAmount: number;
  currency: string;
  paymentMethod: string;
  paymentDateTime?: string;
  accountHolderName?: string;
  transactionId?: string;
  status: string;
  submittedAt: string;
  approvedAt?: string;
  reviewedAt?: string;
  screenshotViewUrl?: string;
  rejectionReason?: string;
  reuploadNote?: string;
  adminRemarks?: string;
  installmentNumber?: number;
}

export interface InstallmentRow {
  _id: string;
  installmentNumber: number;
  requestedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate: string;
  currency: string;
  status: string;
}

export interface StudentInstallmentView {
  activeInstallmentNumber: number | null;
  displayAmount: number;
  displayDueDate: string | null;
  canUpload: boolean;
  totalInstallments: number;
  allPaid: boolean;
  /** True when this slice is visible but calendar date has not arrived yet (no upload). */
  scheduleLocked?: boolean;
}

export interface PaymentHubNotification {
  _id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  priority?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: {
    studentId?: string;
    studentName?: string;
    studentEmail?: string;
    batch?: string;
    level?: string;
    journeyDay?: number;
    dueAmount?: number;
    currency?: string;
    studentStatus?: 'UNCERTAIN' | 'ONGOING' | 'COMPLETED' | 'WITHDREW' | string;
    missedCount?: number;
    missedItems?: string[];
    absentCount?: number;
    absentItems?: (string | PaymentHubClassAbsentItem)[];
  };
  createdAt: string;
}

export interface PaymentHubClassAbsentItem {
  meetingId?: string;
  topic: string;
  startTime?: string | null;
  batch?: string;
  courseDay?: number;
  status?: 'missed';
}

export interface PaymentRequestItem {
  _id: string;
  studentId: { _id: string; name: string; email: string; batch?: string; level?: string; };
  amount: number;
  currency: string;
  paymentType: string;
  customType?: string;
  dueDate: string;
  status: string;
  remarks?: string;
  amountRemaining: number;
  installmentAllowed: boolean;
  totalInstallments: number;
  createdAt: string;
  source?: string;
  isImported?: boolean;
  submissions?: ApprovalQueueItem[];
  installments?: InstallmentRow[];
  studentInstallmentView?: StudentInstallmentView | null;
}

export interface LegacyLanguagePayment {
  totalCourseFee: number;
  amountPaid: number;
  currency: string;
  paymentDate: string;
  remarks?: string;
  markFullyPaid?: boolean;
}

export interface LegacyLineItem {
  amount: number;
  currency: string;
  paymentDate: string;
  remarks?: string;
}

export interface LegacyCustomPayment extends LegacyLineItem {
  paymentType: string;
  /** Corrects the slot quoted total (A1–B2) before optional payment recording */
  quotedTotal?: number;
}

export interface MapLegacyPaymentsBody {
  studentId: string;
  languagePayment?: LegacyLanguagePayment | null;
  docsPayments?: LegacyLineItem[];
  visaPayments?: LegacyLineItem[];
  customPayments?: LegacyCustomPayment[];
}

export interface MapLegacyPaymentsResult {
  language: { requestId: string; submissionId: string } | null;
  docs: { requestId: string; submissionId: string }[];
  visa: { requestId: string; submissionId: string }[];
  custom: Array<{
    requestId?: string;
    submissionId?: string;
    reconciled?: {
      updated?: boolean;
      created?: boolean;
      quotedTotal?: number;
      totalPaid?: number;
      amountRemaining?: number;
      archivedCount?: number;
    };
    alreadyMapped?: boolean;
  }>;
}

export interface BatchStudentPaymentRow extends CurrencyPaidTotals, CurrencyPendingTotals, CurrencyOverdueTotals {
  studentId: string;
  name: string;
  email: string;
  batch?: string;
  level: string;
  currentJourneyDay: number | null;
  totalPaid: number;
  pendingApprovalAmount: number;
  overdueAmount: number;
  overallStatus: string;
  levelPaid: Record<string, CurrencyBucket>;
  docsPaidByCurrency: CurrencyBucket;
  visaPaidByCurrency: CurrencyBucket;
  otherPaidByCurrency: CurrencyBucket;
  lastPaymentDate?: string | null;
  lastPaymentAmount?: number;
  lastPaymentCurrency?: string;
  inferredCurrency?: string;
  openRequestCount: number;
  /** Earliest overdue conversion date (ISO). */
  overdueSince?: string | null;
  /** Current-level language fee (A1–B2) — received / pending / overdue. */
  langPaidLKR?: number;
  langPaidINR?: number;
  langPaidUSD?: number;
  langPendingLKR?: number;
  langPendingINR?: number;
  langPendingUSD?: number;
  langOverdueLKR?: number;
  langOverdueINR?: number;
  langOverdueUSD?: number;
  levelSlots?: Partial<Record<LanguageLevelSlot, BatchLevelSlotTotals>>;
  allLanguageFees?: BatchLevelSlotTotals;
}

export type BatchStudentPaymentFilter = LanguageLevelSlot | 'all_language' | 'all_payment';

export interface BatchStudentsPaymentDetail {
  batch: string;
  students: BatchStudentPaymentRow[];
}

export type LanguageLevelSlot = 'A1' | 'A2' | 'B1' | 'B2';

export interface BatchLevelSlotTotals {
  receivedLKR: number;
  receivedINR: number;
  receivedUSD: number;
  pendingLKR: number;
  pendingINR: number;
  pendingUSD: number;
  overdueLKR: number;
  overdueINR: number;
  overdueUSD: number;
  expectedLKR: number;
  expectedINR: number;
  expectedUSD: number;
}

export interface BatchPaymentSummaryRow extends CurrencyPaidTotals {
  batch: string;
  studentCount: number;
  totalPaid: number;
  totalPendingLKR?: number;
  totalPendingINR?: number;
  totalPendingUSD?: number;
  totalOverdueLKR?: number;
  totalOverdueINR?: number;
  totalOverdueUSD?: number;
  totalExpectedLKR?: number;
  totalExpectedINR?: number;
  totalExpectedUSD?: number;
  /** Received for current CEFR level only (A1–B2 language fee). */
  langPaidLKR?: number;
  langPaidINR?: number;
  langPaidUSD?: number;
  /** All payment types — pending / overdue / expected (received + pending + overdue). */
  fullPendingLKR?: number;
  fullPendingINR?: number;
  fullPendingUSD?: number;
  fullOverdueLKR?: number;
  fullOverdueINR?: number;
  fullOverdueUSD?: number;
  fullExpectedLKR?: number;
  fullExpectedINR?: number;
  fullExpectedUSD?: number;
  levelSlots?: Partial<Record<LanguageLevelSlot, BatchLevelSlotTotals>>;
  allLanguageFees?: BatchLevelSlotTotals;
  totalDueLKR?: number;
  totalDueINR?: number;
  totalDueUSD?: number;
  fullyPaidStudents?: number;
  balanceStudents?: number;
  overdueStudents?: number;
  docsPaidStudents?: number;
  visaPaidStudents?: number;
  insightPaidFullLKR?: number;
  insightPaidFullINR?: number;
  insightPaidFullUSD?: number;
  insightBalanceLKR?: number;
  insightBalanceINR?: number;
  insightBalanceUSD?: number;
  insightOverdueLKR?: number;
  insightOverdueINR?: number;
  insightOverdueUSD?: number;
  insightDocsLKR?: number;
  insightDocsINR?: number;
  insightDocsUSD?: number;
  insightVisaLKR?: number;
  insightVisaINR?: number;
  insightVisaUSD?: number;
  levelCounts: Record<string, number>;
  maxStudentDay: number | null;
  avgJourneyDay?: number | null;
  collectionRateLKR?: number | null;
  /** Earliest overdue conversion date in this batch (ISO). */
  overdueSince?: string | null;
}

export interface BatchPaymentSummaryTotals extends Omit<BatchPaymentSummaryRow, 'batch' | 'levelCounts'> {
  levelCounts?: Record<string, number>;
}

export interface BatchPaymentSummary {
  batches: BatchPaymentSummaryRow[];
  totalStudents: number;
  batchNames: string[];
  totals?: BatchPaymentSummaryTotals | null;
}

export interface StudentHistory {
  student: {
    _id: string;
    name: string;
    email: string;
    batch?: string;
    level?: string;
    subscription?: string;
    enrollmentDate?: string;
    createdAt?: string;
    currentCourseDay?: number | null;
    studentStatus?: string;
    regNo?: string;
  };
  profile: ({
    totalPaid: number;
    totalPaidLKR?: number;
    totalPaidINR?: number;
    totalPaidUSD?: number;
    pendingApprovalAmount: number;
    pendingApprovalAmountLKR?: number;
    pendingApprovalAmountINR?: number;
    pendingApprovalAmountUSD?: number;
    overdueAmount: number;
    overdueAmountLKR?: number;
    overdueAmountINR?: number;
    overdueAmountUSD?: number;
    expectedAmount?: number;
    overdueCount: number;
    overallStatus: string;
    languageFeeBalance?: number;
    languageFeeStatus?: string;
    lastPaymentDate?: string;
    lastPaymentAmount?: number;
    lastPaymentCurrency?: string;
  }) | null;
  languageFeeBalance?: number;
  languageFeeStatus?: string;
  /** All active requests — used for payment mapping slot cards */
  slotRequests?: PaymentRequestItem[];
  requests: PaymentRequestItem[];
  total: number;
  page: number;
  totalPages: number;
}

export interface CreateBulkRequestBody {
  studentIds: string[];
  amount: number;
  currency: string;
  paymentType: string;
  customType?: string;
  dueDate: string;
  remarks?: string;
  installmentAllowed?: boolean;
  scheduledInstallments?: { amount: number; dueDate: string }[];
  notificationToggle?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PaymentHubApiService {
  private readonly base = `${environment.apiUrl}/new-payments`;

  constructor(private readonly http: HttpClient) {}

  private toParams(obj: Record<string, string | number | boolean | undefined | null>): HttpParams {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null && v !== '') {
        p = p.set(k, String(v));
      }
    }
    return p;
  }

  // ── Dashboard ──────────────────────────────────────────────────────────

  getDashboardStats(filters?: Record<string, string | number | boolean | undefined | null>): Observable<{ success: boolean; data: DashboardStats }> {
    const params = filters ? this.toParams(filters) : undefined;
    return this.http.get<{ success: boolean; data: DashboardStats }>(`${this.base}/dashboard/stats`, { params });
  }

  getStudentTable(params: Record<string, string | number | boolean | undefined | null>): Observable<PagedResponse<StudentTableRow>> {
    return this.http.get<PagedResponse<StudentTableRow>>(`${this.base}/students/table`, { params: this.toParams(params) });
  }

  getBatchPaymentSummary(
    params?: Record<string, string | number | boolean | undefined | null>,
  ): Observable<{ success: boolean; data: BatchPaymentSummary }> {
    return this.http.get<{ success: boolean; data: BatchPaymentSummary }>(
      `${this.base}/batches/summary`,
      { params: params ? this.toParams(params) : undefined },
    );
  }

  getFinanceVisibleBatches(): Observable<{
    success: boolean;
    data: { visibleBatches: string[]; updatedAt?: string | null };
  }> {
    return this.http.get<{ success: boolean; data: { visibleBatches: string[]; updatedAt?: string | null } }>(
      `${this.base}/finance-dashboard/visible-batches`,
    );
  }

  updateFinanceVisibleBatches(batches: string[]): Observable<{
    success: boolean;
    data: { visibleBatches: string[]; updatedAt?: string | null };
  }> {
    return this.http.put<{ success: boolean; data: { visibleBatches: string[]; updatedAt?: string | null } }>(
      `${this.base}/finance-dashboard/visible-batches`,
      { batches },
    );
  }

  triggerFinanceReport(type: 'morning' | 'evening'): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.base}/finance-dashboard/trigger-report/${type}`,
      {},
    );
  }

  getBatchStudentsPaymentDetail(batch: string): Observable<{ success: boolean; data: BatchStudentsPaymentDetail }> {
    const encoded = encodeURIComponent(batch);
    return this.http.get<{ success: boolean; data: BatchStudentsPaymentDetail }>(
      `${this.base}/batches/${encoded}/students`,
    );
  }

  // ── Student browse (Send Request tab — User-primary) ───────────────────

  browseStudentsForRequest(params: Record<string, string | number | boolean | undefined | null>): Observable<PagedResponse<StudentBrowseRow>> {
    return this.http.get<PagedResponse<StudentBrowseRow>>(`${this.base}/students/browse`, { params: this.toParams(params) });
  }

  // ── Student history (admin) ────────────────────────────────────────────

  getStudentHistory(studentId: string, params?: Record<string, string | number | boolean | undefined | null>): Observable<{ success: boolean; data: StudentHistory }> {
    return this.http.get<{ success: boolean; data: StudentHistory }>(`${this.base}/students/${studentId}/history`, { params: params ? this.toParams(params) : undefined });
  }

  // ── Payment requests (admin) ───────────────────────────────────────────

  createBulkRequest(body: CreateBulkRequestBody): Observable<{ success: boolean; data: PaymentRequestItem[]; count: number }> {
    return this.http.post<{ success: boolean; data: PaymentRequestItem[]; count: number }>(`${this.base}/requests`, body);
  }

  updateInstallmentSchedule(
    requestId: string,
    body: { installments: Array<{ installmentNumber: number; requestedAmount: number; dueDate: string }> },
  ): Observable<{ success: boolean; data: InstallmentRow[] }> {
    return this.http.put<{ success: boolean; data: InstallmentRow[] }>(
      `${this.base}/requests/${requestId}/installments`,
      body,
    );
  }

  getAllRequests(params: Record<string, string | number | boolean | undefined | null>): Observable<PagedResponse<PaymentRequestItem>> {
    return this.http.get<PagedResponse<PaymentRequestItem>>(`${this.base}/requests`, { params: this.toParams(params) });
  }

  archiveRequest(requestId: string, reason?: string): Observable<unknown> {
    return this.http.delete(`${this.base}/requests/${requestId}`, { body: { reason } });
  }

  // ── Approval queue ─────────────────────────────────────────────────────

  getApprovalQueue(params: Record<string, string | number | boolean | undefined | null>): Observable<PagedResponse<ApprovalQueueItem>> {
    return this.http.get<PagedResponse<ApprovalQueueItem>>(`${this.base}/approvals`, { params: this.toParams(params) });
  }

  getSubmissionDetail(submissionId: string): Observable<{ success: boolean; data: ApprovalQueueItem }> {
    return this.http.get<{ success: boolean; data: ApprovalQueueItem }>(`${this.base}/approvals/${submissionId}`);
  }

  approveSubmission(
    submissionId: string,
    body: {
      adminRemarks?: string;
      paidAmount?: number;
      reviewUpdates?: Record<string, unknown>;
    },
  ): Observable<{ success: boolean; data: unknown; receiptNumber?: string; isFullyPaid?: boolean }> {
    return this.http.patch<{ success: boolean; data: unknown; receiptNumber?: string; isFullyPaid?: boolean }>(`${this.base}/approvals/${submissionId}/approve`, body);
  }

  rejectSubmission(
    submissionId: string,
    body: { rejectionReason: string; reviewUpdates?: Record<string, unknown> },
  ): Observable<unknown> {
    return this.http.patch(`${this.base}/approvals/${submissionId}/reject`, body);
  }

  updateSubmissionReviewDetails(
    submissionId: string,
    body: Record<string, unknown>,
  ): Observable<{ success: boolean; message: string; data: unknown }> {
    return this.http.patch<{ success: boolean; message: string; data: unknown }>(
      `${this.base}/approvals/${submissionId}/review-details`,
      body,
    );
  }

  requestReupload(submissionId: string, body: { reuploadNote?: string }): Observable<unknown> {
    return this.http.patch(`${this.base}/approvals/${submissionId}/reupload`, body);
  }

  // ── Student-facing ─────────────────────────────────────────────────────

  getMyRequests(params: Record<string, string | number | boolean | undefined | null>): Observable<PagedResponse<PaymentRequestItem>> {
    return this.http.get<PagedResponse<PaymentRequestItem>>(`${this.base}/my/requests`, { params: this.toParams(params) });
  }

  submitPayment(body: Record<string, unknown>): Observable<{ success: boolean; data: unknown }> {
    return this.http.post<{ success: boolean; data: unknown }>(`${this.base}/my/submit`, body);
  }

  submitPaymentFormData(formData: FormData): Observable<{ success: boolean; data: unknown }> {
    return this.http.post<{ success: boolean; data: unknown }>(`${this.base}/my/submit`, formData);
  }

  // ── Overdue ────────────────────────────────────────────────────────────

  runOverdueDetection(): Observable<unknown> {
    return this.http.post(`${this.base}/overdue/detect`, {});
  }

  // ── Catalog / pricing settings ────────────────────────────────────────

  getCatalogSettings(): Observable<{ success: boolean; data: PricingCatalog }> {
    return this.http.get<{ success: boolean; data: PricingCatalog }>(`${this.base}/catalog/settings`);
  }

  updateCatalogSettings(body: Partial<PricingCatalog>): Observable<{ success: boolean; data: PricingCatalog }> {
    return this.http.put<{ success: boolean; data: PricingCatalog }>(`${this.base}/catalog/settings`, body);
  }

  getMyCatalog(): Observable<{ success: boolean; data: StudentCatalog }> {
    return this.http.get<{ success: boolean; data: StudentCatalog }>(`${this.base}/my/catalog`);
  }

  // ── Bulk student fetch for Excel import matching ──────────────────────────

  getAllStudentsForMatching(): Observable<PagedResponse<StudentTableRow>> {
    return this.http.get<PagedResponse<StudentTableRow>>(`${this.base}/students/table`, {
      params: this.toParams({ limit: 9999, page: 1 }),
    });
  }

  // ── Legacy payment mapping (admin) ────────────────────────────────────────

  mapLegacyPayments(body: MapLegacyPaymentsBody): Observable<{ success: boolean; message: string; data: MapLegacyPaymentsResult }> {
    return this.http.post<{ success: boolean; message: string; data: MapLegacyPaymentsResult }>(`${this.base}/legacy/map-payment`, body);
  }

  updateLegacyPaymentRequest(
    requestId: string,
    body: {
      amount?: number;
      paidAmount?: number;
      amountRemaining?: number;
      currency?: string;
      dueDate?: string;
      remarks?: string;
      status?: string;
    },
  ): Observable<{ success: boolean; message: string; data: { request: PaymentRequestItem } }> {
    return this.http.patch<{ success: boolean; message: string; data: { request: PaymentRequestItem } }>(
      `${this.base}/legacy/requests/${requestId}`,
      body,
    );
  }

  mapLegacyBulkLanguagePaid(body: { rows: BulkLegacyLanguageRow[] }): Observable<{
    success: boolean;
    message: string;
    data: BulkLegacyLanguageResult;
  }> {
    return this.http.post<{ success: boolean; message: string; data: BulkLegacyLanguageResult }>(
      `${this.base}/legacy/bulk-language-paid`,
      body,
    );
  }

  markLevelSlotFullPaid(body: {
    studentId: string;
    slotKey: string;
    fullPaidAmount: number;
    currency: string;
    paymentDate?: string;
    remarks?: string;
  }): Observable<{ success: boolean; message: string; data: { requestId?: string; submissionId?: string } }> {
    return this.http.post<{ success: boolean; message: string; data: { requestId?: string; submissionId?: string } }>(
      `${this.base}/legacy/level-full-paid`,
      body,
    );
  }

  correctStudentTotalPaid(
    studentId: string,
    body: { currency: string; correctedTotalPaid: number; adminRemarks: string },
  ): Observable<{ success: boolean; message: string; data: unknown }> {
    return this.http.patch<{ success: boolean; message: string; data: unknown }>(
      `${this.base}/students/${studentId}/correct-total-paid`,
      body,
    );
  }

  bulkResetStudentPayments(body: {
    studentIds: string[];
    reason?: string;
  }): Observable<{ success: boolean; message: string; data: { studentsProcessed: number; requestsArchived: number; submissionsArchived: number } }> {
    return this.http.post<{ success: boolean; message: string; data: { studentsProcessed: number; requestsArchived: number; submissionsArchived: number } }>(
      `${this.base}/students/bulk-reset-payments`,
      body,
    );
  }

  resetPaymentSlot(
    studentId: string,
    body: { slotKey: string; reason?: string },
  ): Observable<{ success: boolean; message: string; data: { slot: string; requestsArchived: number; submissionsArchived: number } }> {
    return this.http.post<{ success: boolean; message: string; data: { slot: string; requestsArchived: number; submissionsArchived: number } }>(
      `${this.base}/students/${studentId}/reset-slot`,
      body,
    );
  }

  correctSubmissionAmount(
    submissionId: string,
    body: { newPaidAmount: number; adminRemarks?: string },
  ): Observable<{ success: boolean; message: string; data: unknown }> {
    return this.http.patch<{ success: boolean; message: string; data: unknown }>(
      `${this.base}/approvals/${submissionId}/correct-amount`,
      body,
    );
  }

  // ── Admin notifications (Payment Hub) ───────────────────────────────────

  getPaymentNotifications(params?: {
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
    type?: string;
    batch?: string;
    batchLevel?: string;
    studentStatus?: string;
  }): Observable<{
    success: boolean;
    data: PaymentHubNotification[];
    total: number;
    unreadCount: number;
    page: number;
    totalPages: number;
  }> {
    return this.http.get<{
      success: boolean;
      data: PaymentHubNotification[];
      total: number;
      unreadCount: number;
      page: number;
      totalPages: number;
    }>(`${this.base}/notifications`, { params: this.toParams(params || {}) });
  }

  getPaymentNotificationUnreadCount(params?: { type?: string }): Observable<{ success: boolean; data: { count: number } }> {
    return this.http.get<{ success: boolean; data: { count: number } }>(`${this.base}/notifications/unread-count`, {
      params: this.toParams(params || {}),
    });
  }

  markPaymentNotificationRead(id: string): Observable<{ success: boolean; data: PaymentHubNotification }> {
    return this.http.patch<{ success: boolean; data: PaymentHubNotification }>(
      `${this.base}/notifications/${id}/read`,
      {},
    );
  }

  markAllPaymentNotificationsRead(): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/notifications/mark-all/read`, {});
  }

  syncJourneyDueNotifications(): Observable<{ success: boolean; data: unknown }> {
    return this.http.post<{ success: boolean; data: unknown }>(`${this.base}/notifications/journey-due/sync`, {});
  }
}
