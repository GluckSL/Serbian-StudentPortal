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

export interface DashboardStats {
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
  activeStudents: number;
  overdueCount: number;
}

/** Row returned by GET /students/browse — User-primary with optional profile data */
export interface StudentBrowseRow {
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

/** Legacy table row (profile-primary, All Payments hub) */
export interface StudentTableRow {
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
  };
  totalPaid: number;
  pendingApprovalAmount: number;
  overdueAmount: number;
  overallStatus: string;
  lastRebuiltAt?: string;
  /** LKR / INR / USD from phone prefix (server-side). */
  inferredCurrency?: string;
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
  transactionId?: string;
  status: string;
  submittedAt: string;
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
  custom: { requestId: string; submissionId: string }[];
}

export interface StudentHistory {
  student: { _id: string; name: string; email: string; batch?: string; level?: string; subscription?: string; enrollmentDate?: string; createdAt?: string; };
  profile: { totalPaid: number; pendingApprovalAmount: number; overdueAmount: number; expectedAmount?: number; overdueCount: number; overallStatus: string; lastPaymentDate?: string; lastPaymentAmount?: number; lastPaymentCurrency?: string; } | null;
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

  approveSubmission(submissionId: string, body: { adminRemarks?: string }): Observable<{ success: boolean; data: unknown; receiptNumber?: string; isFullyPaid?: boolean }> {
    return this.http.patch<{ success: boolean; data: unknown; receiptNumber?: string; isFullyPaid?: boolean }>(`${this.base}/approvals/${submissionId}/approve`, body);
  }

  rejectSubmission(submissionId: string, body: { rejectionReason: string }): Observable<unknown> {
    return this.http.patch(`${this.base}/approvals/${submissionId}/reject`, body);
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
}
