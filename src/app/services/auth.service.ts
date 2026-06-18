// src/app/services/auth.service.ts

import { Injectable } from '@angular/core';
import { HttpHeaders } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, finalize } from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { environment } from '../../environments/environment';
import { isCoursePlan } from '../utils/student-subscription-plans.util';

/** JWT key in localStorage (Bearer sent by authTokenInterceptor). */
export const AUTH_STORAGE_KEY = 'authToken';
const LEGACY_AUTH_STORAGE_KEYS = ['token', 'jwtToken'];
export function getAuthToken(): string | null {
  try {
    const primary = localStorage.getItem(AUTH_STORAGE_KEY);
    if (primary) return primary;

    // Backward compatibility for sessions saved before authToken key standardization.
    for (const key of LEGACY_AUTH_STORAGE_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        localStorage.setItem(AUTH_STORAGE_KEY, legacy);
        return legacy;
      }
    }
    return null;
  } catch {
    return null;
  }
}

interface DecodeToken {
  name: string;
  email: string;
  level?: string;
}

interface User {
  _id?: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'TEACHER' | 'TEACHER_ADMIN' | 'SUB_ADMIN' | 'STUDENT';
  sidebarPermissions?: string[];
  teacherTabPermissions?: string[];
  sidebarAccessLevels?: Record<string, 'view' | 'edit' | 'full'>;
  sidebarDeletePermissions?: string[];
  teacherTabAccessLevels?: Record<string, 'view' | 'edit' | 'full'>;
  batch?: string;
  medium?: string;
  subscription?: string;
  level?: string;
  conversationId?: string;
  assignedCourses?: string[];   // for TEACHER
  assignedTeacher?: string;      // for STUDENT (teacher _id)
  profilePhotoUrl?: string;      // URL to profile photo
  studentStatus?: string;        // for STUDENT (UNCERTAIN, ONGOING, COMPLETED, DROPPED)
  phoneNumber?: string;
  address?: string;
  age?: number;
  servicesOpted?: string;
  leadSource?: string;
  languageLevelOpted?: string;
  dateWithdrew?: Date;
  reasonForWithdrawing?: string;
  courseCompletionDates?: {
    A1CompletionDate?: Date;
    A2CompletionDate?: Date;
    B1CompletionDate?: Date;
    B2CompletionDate?: Date;
  };
  courseStartDates?: {
    A1StartDate?: Date;
    A2StartDate?: Date;
    B1StartDate?: Date;
    B2StartDate?: Date;
  };
  qualifications?: string;
  [key: string]: any;            // Allow additional properties
}

/** After logout, next /login load skips "restore session" so the form stays visible. */
export const SKIP_SESSION_RESTORE_KEY = 'gluck_skip_session_restore';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Change backend API URL to your EC2 URL or keep localhost for development
  private apiUrl = environment.apiUrl;  // Base API URL

  // ✅ Holds logged-in user state
  private currentUserSubject = new BehaviorSubject<any | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();
  router: any;

  constructor(private http: HttpClient) {
    // New tabs boot a fresh Angular app — hydrate a minimal user from the stored JWT
    // so route guards don't treat an active session as logged-out.
    this.hydrateUserFromStoredToken();
  }

  /** Restore minimal user state from localStorage JWT (role/id/name) before /auth/profile returns. */
  hydrateUserFromStoredToken(): void {
    if (this.currentUserSubject.value) return;
    const token = getAuthToken();
    if (!token) return;
    try {
      const decoded = jwtDecode<{ id?: string; role?: string; name?: string; email?: string }>(token);
      if (decoded?.role) {
        this.currentUserSubject.next({
          _id: decoded.id,
          role: decoded.role,
          name: decoded.name,
          email: decoded.email,
        });
      }
    } catch {
      /* malformed token — guards will redirect to login */
    }
  }

  // ✅ Get teachers for a specific level and medium
  getTeachers(level: string, medium: string | string[]): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/auth/teachers`, {
      params: { level, medium }
    });
  }


  // ✅ Get teachers for a specific level and medium
  getTeachersByMedium(medium: string | string[]): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/auth/teachersByMedium`, {
      params: { medium }
    });
  }


  signup(user: {
    name: string,
    email: string,
    role: string,
    batch?: string,
    medium?: string,
    subscription?: string,
    level?: string,
    conversationId?: string,
    assignedCourses?: string[],   // for TEACHER
    assignedTeacher?: string      // for STUDENT (teacher _id)
    studentStatus?: string      // for STUDENT (UNCERTAIN, ONGOING, COMPLETED, DROPPED)
    phoneNumber?: string;     // for STUDENT
    address?: string;   // for STUDENT
    age?: number;   // for STUDENT
    servicesOpted?: string; // for STUDENT
    leadSource?: string; // for STUDENT
    languageLevelOpted?: string;
    dateWithdrew?: Date;
    reasonForWithdrawing?: string;
    courseCompletionDates?: {
      A1CompletionDate?: Date;
      A2CompletionDate?: Date;
      B1CompletionDate?: Date;
      B2CompletionDate?: Date;
    };
    courseStartDates?: {
      A1StartDate?: Date;
      A2StartDate?: Date;
      B1StartDate?: Date;
      B2StartDate?: Date;
    };
    qualifications?: string;
  }): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/signup`, user);
  }

  login(user: { identifier?: string; regNo?: string; password: string; keepSessionActive?: boolean }): Observable<any> {
    // Send identifier (new field); backend also accepts legacy regNo
    const payload = { identifier: user.identifier || user.regNo, password: user.password, keepSessionActive: user.keepSessionActive };
    return this.http.post<any>(`${this.apiUrl}/auth/login`, payload).pipe(
      tap((response: any) => {
        if (response?.token) {
          try {
            localStorage.setItem(AUTH_STORAGE_KEY, response.token);
          } catch {
            /* ignore */
          }
        }
        if (response && response.user) {
          this.currentUserSubject.next(response.user);
        }
      })
    );
  }

  requestPasswordReset(email: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/forgot-password/request`, { email });
  }

  resetPassword(data: { email: string; otp: string; newPassword: string; confirmPassword: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/forgot-password/reset`, data);
  }

  changePassword(data: { currentPassword: string; newPassword: string; confirmPassword: string }): Observable<any> {
    return this.http.put(`${this.apiUrl}/auth/change-password`, data);
  }

  /** Flow A: request email change — admin approval required */
  requestSetupEmailChange(data: {
    setupToken: string;
    newEmail: string;
    newPassword: string;
    confirmPassword: string;
  }): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/setup/request-email-change`, data);
  }

  /** Flow B step 1: send OTP to current email */
  sendSetupOtp(setupToken: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/setup/send-otp`, { setupToken });
  }

  /** Flow B step 2a: verify OTP only — returns verificationCode */
  verifySetupOtp(data: { setupToken: string; otp: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/setup/verify-otp`, data);
  }

  /** Flow B step 2b: set password after OTP verification, then log in */
  setSetupPassword(data: {
    setupToken: string;
    verificationCode: string;
    newPassword: string;
    confirmPassword: string;
    keepSessionActive?: boolean;
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/auth/setup/set-password`, data).pipe(
      tap((response: any) => {
        if (response?.token) {
          try {
            localStorage.setItem(AUTH_STORAGE_KEY, response.token);
          } catch {
            /* ignore */
          }
        }
        if (response?.user) {
          this.currentUserSubject.next(response.user);
        }
      })
    );
  }

  /** Admin: get email change requests */
  getEmailChangeRequests(status = 'pending'): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/email-change-requests`, {
      params: { status },
      withCredentials: true,
    });
  }

  /** Admin: approve an email change request */
  approveEmailChangeRequest(id: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/admin/email-change-requests/${id}/approve`, {}, { withCredentials: true });
  }

  /** Admin: reject an email change request */
  rejectEmailChangeRequest(id: string, reason = ''): Observable<any> {
    return this.http.post(`${this.apiUrl}/admin/email-change-requests/${id}/reject`, { reason }, { withCredentials: true });
  }

  confirmWithdrawalStatus(data: {
    studentId: string;
    decision: 'YES' | 'NO';
    loginAttemptTime: string;
    keepSessionActive?: boolean;
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/auth/withdrawal-confirmation`, data).pipe(
      tap((response: any) => {
        if (response?.token) {
          try {
            localStorage.setItem(AUTH_STORAGE_KEY, response.token);
          } catch {
            /* ignore */
          }
        }
        if (response?.user) {
          this.currentUserSubject.next(response.user);
        }
      })
    );
  }

  // Fetch user profile (with photo URL included)
  getUserProfile(): Observable<any> {
    return this.http.get(`${this.apiUrl}/auth/profile`, { withCredentials: true });
  }

  // ✅ Helper: refresh user profile and update BehaviorSubject
  refreshUserProfile(): Observable<any> {
    return this.getUserProfile().pipe(
      tap((user) => {
        this.currentUserSubject.next(user); // ✅ Broadcast user data to all subscribers
      })
    );
  }

  isLoggedIn(): boolean {
    if (this.currentUserSubject.value !== null) return true;
    return !!getAuthToken();
  }

  /** Role embedded in the JWT issued at login (fallback when profile payload omits role). */
  getRoleFromToken(): string | undefined {
    const token = getAuthToken();
    if (!token) return undefined;
    try {
      const decoded = jwtDecode<{ role?: string }>(token);
      return decoded?.role || undefined;
    } catch {
      return undefined;
    }
  }

  /** Merge login + profile payloads so navigation never loses role/subscription. */
  resolveUserForNavigation(
    profile?: { role?: string; subscription?: string } | null,
    loginUser?: { role?: string; subscription?: string } | null
  ): { role?: string; subscription?: string } {
    const tokenRole = this.getRoleFromToken();
    return {
      ...loginUser,
      ...profile,
      role: profile?.role || loginUser?.role || tokenRole,
      subscription: profile?.subscription ?? loginUser?.subscription,
    };
  }

  /** Dashboard path after login or when a valid token session is already present. */
  getPostLoginPath(user: { role?: string; subscription?: string } | null | undefined): string | null {
    const role = user?.role || this.getRoleFromToken();
    if (!role) {
      return null;
    }
    if (role === 'ADMIN' || role === 'SUB_ADMIN') {
      return '/admin-dashboard';
    }
    if (role === 'TEACHER' || role === 'TEACHER_ADMIN') {
      return '/teacher-dashboard';
    }
    if (role === 'STUDENT') {
      return isCoursePlan(user?.subscription) ? '/student/my-course' : '/student-documents';
    }
    return null;
  }

  /** Clear local user state when the session is invalid (no HTTP call — avoids loops on 401). */
  clearClientSession(): void {
    this.currentUserSubject.next(null);
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  /**
   * Call when the user explicitly logs out. Ensures the next visit to /login
   * shows the credential form instead of auto-restore.
   */
  markExpectFreshLoginPage(): void {
    this.clearClientSession();
    try {
      sessionStorage.setItem(SKIP_SESSION_RESTORE_KEY, '1');
    } catch {
      /* private mode / no sessionStorage */
    }
  }

  /** Synchronous read of the last known user (e.g. before HTTP calls in the same tick). */
  getSnapshotUser(): any | null {
    return this.currentUserSubject.value;
  }

  // Logout
  logout(): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/logout`, {}).pipe(
      finalize(() => {
        this.markExpectFreshLoginPage();
      })
    );
  }

  // Additional methods for VAPI data - you can adjust these endpoints if needed
  getStudentVapiData() {
    return this.http.get<any>(`${this.apiUrl}/student/vapi-access`);
  }

  getVapiCourses() {
    return this.http.get<any[]>(`${this.apiUrl}/student/vapi-courses`);
  }

  // Upload profile photo with validation
  uploadProfilePhoto(file: File): Observable<any> {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];

    // ✅ Validate file type before sending to backend
    if (!allowedTypes.includes(file.type)) {
      return new Observable((observer) => {
        observer.error({ message: 'Invalid file type! Only JPG/PNG files are allowed.' });
      });
    }

    const formData = new FormData();
    formData.append('profilePhoto', file);

    return this.http.post(`${this.apiUrl}/profile/upload-photo`, formData);
  }


  getUserById(id: string) {
    return this.http.get<User>(`${this.apiUrl}/auth/${id}`);
  }

  updateUser(id: string, user: User) {
    return this.http.put(`${this.apiUrl}/auth/${id}`, user);
  }

  deleteUser(id: string) {
    return this.http.delete(`${this.apiUrl}/auth/${id}`);
  }

  updateAssignedTeacherByBatchNo(batchNo: string, teacherId: string) {
    return this.http.put(`${this.apiUrl}/auth/update-teacher-by-batch`,
      {
        batch: batchNo,
        newTeacherId: teacherId
      });
  }

  getTeachersByBatch(batchNo: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/auth/teachers-by-batch/${batchNo}`);
  }
  // Resend credentials to a student
  resendCredentials(studentId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/resend-credentials/${studentId}`, {});
  }

  sendSignupLink(studentId: string, email: string, name?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/auth/admin/signup-link`, { email, name });
  }

  sendRegisterInvite(email: string, name?: string): Observable<{ success?: boolean; msg?: string }> {
    return this.http.post<{ success?: boolean; msg?: string }>(
      `${this.apiUrl}/auth/admin/register-invite`,
      { email, name }
    );
  }

  /** Sign student out, email OTP, require new password on next login (admin directory). */
  forcePasswordReset(studentId: string): Observable<{ success?: boolean; msg?: string; displayPassword?: string | null }> {
    return this.http.post<{ success?: boolean; msg?: string; displayPassword?: string | null }>(
      `${this.apiUrl}/auth/admin/force-password-reset/${studentId}`,
      {}
    );
  }

  /** Bulk sign-out: invalidate tokens and require password change on next login. */
  bulkForcePasswordReset(studentIds: string[]): Observable<{
    success?: boolean;
    msg?: string;
    successCount?: number;
    failedCount?: number;
  }> {
    return this.http.post<{
      success?: boolean;
      msg?: string;
      successCount?: number;
      failedCount?: number;
    }>(`${this.apiUrl}/auth/admin/bulk-force-password-reset`, { studentIds });
  }

  // Method to perform authenticated request
  fetchProtectedData(endpoint: string): Observable<any> {
    const token = this.getToken();
    if (!token) {
      return new Observable((observer) => {
        observer.error({ message: 'Not authenticated' });
      });
    }
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    return this.http.get(endpoint, { headers });
  }

  getToken(): string | null {
    return getAuthToken();
  }
}
