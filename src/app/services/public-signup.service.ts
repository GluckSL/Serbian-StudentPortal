// src/app/services/public-signup.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'gluck_signup_token';

@Injectable({ providedIn: 'root' })
export class PublicSignupService {
  private base = `${environment.apiUrl}/public-signup`;

  constructor(private http: HttpClient) {}

  // ── Token persistence ──────────────────────────────────────────────────────

  saveToken(token: string): void {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  }

  getToken(): string | null {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  }

  clearToken(): void {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }

  // ── API calls ──────────────────────────────────────────────────────────────

  /** Step 1a: submit personal info + trigger OTP */
  start(data: {
    applicationToken?: string;
    name: string;
    email: string;
    phoneNumber?: string;
    whatsappNumber?: string;
    address?: string;
    age?: number | null;
    nationality?: string;
    medium?: string[];
    otherLanguageKnown?: string;
    languageLevelOpted?: string;
    qualifications?: string;
    leadSource?: string;
    subscription?: string;
  }): Observable<any> {
    return this.http.post(`${this.base}/start`, data);
  }

  /** Step 1b: verify OTP + save password */
  verifyEmail(data: {
    applicationToken: string;
    otp: string;
    password: string;
    confirmPassword: string;
  }): Observable<any> {
    return this.http.post(`${this.base}/verify-email`, data);
  }

  /** Step 2: upload optional documents */
  uploadDocuments(applicationToken: string, files: File[]): Observable<any> {
    const fd = new FormData();
    fd.append('applicationToken', applicationToken);
    files.forEach(f => fd.append('documents', f));
    return this.http.post(`${this.base}/documents`, fd);
  }

  /** Get pricing catalog */
  getCatalog(): Observable<any> {
    return this.http.get(`${this.base}/catalog`);
  }

  /** Step 3a: save level/plan/currency, provision pending user */
  finalize(data: {
    applicationToken: string;
    level: string;
    subscription: string;
    currency: string;
  }): Observable<any> {
    return this.http.post(`${this.base}/finalize`, data);
  }

  /** Step 3b option 1: create Razorpay order */
  createRazorpayOrder(applicationToken: string): Observable<any> {
    return this.http.post(`${this.base}/razorpay/create-order`, { applicationToken });
  }

  /** Step 3b option 1: verify Razorpay payment */
  verifyRazorpay(data: {
    applicationToken: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }): Observable<any> {
    return this.http.post(`${this.base}/razorpay/verify`, data);
  }

  /** Step 3b option 2: upload payment proof */
  uploadPaymentProof(applicationToken: string, file: File): Observable<any> {
    const fd = new FormData();
    fd.append('applicationToken', applicationToken);
    fd.append('screenshot', file);
    return this.http.post(`${this.base}/payment-proof`, fd);
  }

  /** Resume: load application state */
  resumeApplication(token: string): Observable<any> {
    return this.http.get(`${this.base}/${token}`);
  }
}
