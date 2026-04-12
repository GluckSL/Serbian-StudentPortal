// src/app/components/admin-dashboard/user-roles.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { NavService } from '../../shared/services/nav.service';
import { NotificationService } from '../../services/notification.service';

const apiUrl = environment.apiUrl;

interface ManagedUser {
  _id: string;
  regNo: string;
  name: string;
  email: string;
  role: string;
  newRole: string;
  sidebarPermissions: string[];
  teacherTabPermissions: string[];
  permissionsDirty: boolean;
}

interface PwModal {
  open: boolean;
  user: ManagedUser | null;
  newPassword: string;
  confirmPassword: string;
  showPass: boolean;
  saving: boolean;
  generatedPreview: string;
  error: string;
}

@Component({
  selector: 'app-user-roles',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="user-roles-page">
      <div class="page-header">
        <div class="container-fluid">
          <div class="row align-items-center">
            <div class="col-md-8">
              <h1 class="page-title">
                <i class="fas fa-user-shield"></i>
                User Roles Management
              </h1>
              <p class="page-subtitle">Manage roles for teachers and administrators</p>
            </div>
            <div class="col-md-4 text-end">
              <div class="stats-quick">
                <div class="stat-item">
                  <span class="stat-number">{{ allTeachersAndAdmins.length }}</span>
                  <span class="stat-label">Total Users</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="page-content">
        <div class="container-fluid">
          <!-- Users Table -->
          <div class="data-table-card">
            <div class="card">
              <div class="card-header">
                <h5 class="mb-0">Teachers & Administrators</h5>
              </div>
              <div class="table-responsive">
                <table class="table table-hover mb-0">
                  <thead class="table-dark">
                    <tr>
                      <th>Reg No</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Current Role</th>
                      <th>Change Role</th>
                      <th>Sidebar Access (Sub-Admin)</th>
                      <th>Tab Access (Teacher)</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let user of allTeachersAndAdmins">
                      <td><span class="badge bg-secondary">{{ user.regNo }}</span></td>
                      <td>{{ user.name }}</td>
                      <td>{{ user.email }}</td>
                      <td>
                        <span class="badge" 
                              [ngClass]="{
                                'bg-primary': user.role === 'TEACHER',
                                'bg-warning': user.role === 'TEACHER_ADMIN',
                                'bg-danger': user.role === 'ADMIN',
                                'bg-dark': user.role === 'SUB_ADMIN'
                              }">
                          {{ user.role }}
                        </span>
                      </td>
                      <td>
                        <select class="form-select form-select-sm" 
                                [(ngModel)]="user.newRole" 
                                (change)="onRoleChange(user)">
                          <option [value]="user.role" selected>Keep {{ user.role }}</option>
                          <option value="TEACHER" *ngIf="user.role !== 'TEACHER'">TEACHER</option>
                          <option value="TEACHER_ADMIN" *ngIf="user.role !== 'TEACHER_ADMIN'">TEACHER_ADMIN</option>
                          <option value="ADMIN" *ngIf="user.role !== 'ADMIN'">ADMIN</option>
                          <option value="SUB_ADMIN" *ngIf="user.role !== 'SUB_ADMIN'">SUB_ADMIN</option>
                        </select>
                      </td>
                      <td>
                        <div *ngIf="isSubAdminRole(user); else noSidebarConfig" class="permissions-wrap">
                          <div class="permissions-toggle-row">
                            <span class="permission-count">
                              {{ user.sidebarPermissions.length }} selected
                            </span>
                            <button
                              type="button"
                              class="btn btn-sm btn-outline-secondary permissions-toggle-btn"
                              (click)="toggleSubAdminDetails(user)"
                            >
                              {{ isSubAdminDetailsOpen(user) ? 'Hide Details' : 'Show Details' }}
                              <i class="fas" [ngClass]="isSubAdminDetailsOpen(user) ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
                            </button>
                          </div>
                          <div class="permissions-grid details-panel" *ngIf="isSubAdminDetailsOpen(user)">
                            <label class="permission-item" *ngFor="let option of subAdminPermissionOptions">
                              <input
                                type="checkbox"
                                [checked]="user.sidebarPermissions.includes(option.id)"
                                [disabled]="isPermissionMandatory(option.id)"
                                (change)="toggleSubAdminPermission(user, option.id, $event)"
                              />
                              <span>{{ option.label }}</span>
                            </label>
                          </div>
                        </div>
                        <ng-template #noSidebarConfig>
                          <span class="text-muted small">N/A</span>
                        </ng-template>
                      </td>
                      <!-- Teacher Tab Permissions -->
                      <td>
                        <div *ngIf="isTeacherRole(user); else noTeacherTabConfig" class="permissions-wrap">
                          <div class="permissions-toggle-row">
                            <span class="permission-count">
                              {{ user.teacherTabPermissions.length }} tab(s)
                            </span>
                            <button
                              type="button"
                              class="btn btn-sm btn-outline-secondary permissions-toggle-btn"
                              (click)="toggleTeacherTabDetails(user)"
                            >
                              {{ isTeacherTabDetailsOpen(user) ? 'Hide' : 'Assign Tabs' }}
                              <i class="fas" [ngClass]="isTeacherTabDetailsOpen(user) ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
                            </button>
                          </div>
                          <div class="permissions-grid details-panel" *ngIf="isTeacherTabDetailsOpen(user)">
                            <p class="tab-info-note">Teacher will see these tabs in <strong>read-only</strong> mode (no edit/delete).</p>
                            <label class="permission-item" *ngFor="let option of subAdminPermissionOptions">
                              <input
                                type="checkbox"
                                [checked]="user.teacherTabPermissions.includes(option.id)"
                                (change)="toggleTeacherTabPermission(user, option.id, $event)"
                              />
                              <span>{{ option.label }}</span>
                            </label>
                          </div>
                        </div>
                        <ng-template #noTeacherTabConfig>
                          <span class="text-muted small">N/A</span>
                        </ng-template>
                      </td>
                      <td>
                        <div class="action-btns">
                          <button class="btn btn-sm btn-success"
                                  (click)="updateUserRole(user)"
                                  [disabled]="!hasPendingChanges(user)"
                                  title="Save role changes">
                            <i class="fas fa-save"></i> Update
                          </button>
                          <button class="btn btn-sm btn-key"
                                  (click)="openPasswordModal(user)"
                                  title="Change / View Password">
                            <i class="fas fa-key"></i>
                          </button>
                          <button class="btn btn-sm btn-del"
                                  (click)="deleteUser(user)"
                                  title="Delete user">
                            <i class="fas fa-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          
        </div>
      </div>

      <!-- ===== Password Modal ===== -->
      <div class="pw-overlay" *ngIf="pwModal.open" (click)="closePasswordModal()">
        <div class="pw-box" (click)="$event.stopPropagation()">

          <div class="pw-header">
            <span class="pw-header-title"><i class="fas fa-key"></i>&nbsp; Manage Password</span>
            <button class="pw-close" (click)="closePasswordModal()">&#x2715;</button>
          </div>

          <div class="pw-body">
            <div class="pw-user-pill">
              <i class="fas fa-user-circle"></i>
              <span>{{ pwModal.user?.name }}</span>
              <span class="pw-role-badge">{{ pwModal.user?.role }}</span>
            </div>
            <p class="pw-email-line">{{ pwModal.user?.email }}</p>

            <div class="pw-field">
              <label>New Password</label>
              <div class="pw-input-row">
                <input
                  [type]="pwModal.showPass ? 'text' : 'password'"
                  [(ngModel)]="pwModal.newPassword"
                  class="form-control form-control-sm"
                  placeholder="Enter new password (min 6 chars)"
                />
                <button class="pw-eye-btn" type="button" (click)="pwModal.showPass = !pwModal.showPass">
                  <i class="fas" [ngClass]="pwModal.showPass ? 'fa-eye-slash' : 'fa-eye'"></i>
                </button>
              </div>
            </div>

            <div class="pw-field">
              <label>Confirm Password</label>
              <input
                [type]="pwModal.showPass ? 'text' : 'password'"
                [(ngModel)]="pwModal.confirmPassword"
                class="form-control form-control-sm"
                placeholder="Re-enter the new password"
              />
            </div>

            <div class="pw-divider"></div>

            <button class="btn btn-sm btn-gen" type="button" (click)="generateRandomPassword()">
              <i class="fas fa-random"></i>&nbsp; Generate Random Password
            </button>

            <div class="pw-generated-box" *ngIf="pwModal.generatedPreview">
              <div class="pw-gen-row">
                <span class="pw-gen-label">Generated:</span>
                <span class="pw-gen-value">{{ pwModal.generatedPreview }}</span>
                <button class="btn btn-sm btn-link pw-copy-btn" type="button" (click)="copyPassword()">
                  <i class="fas fa-copy"></i> Copy
                </button>
              </div>
              <p class="pw-gen-note">This password is already filled above. Save to apply it.</p>
            </div>

            <p class="pw-error-msg" *ngIf="pwModal.error">
              <i class="fas fa-exclamation-circle"></i> {{ pwModal.error }}
            </p>
          </div>

          <div class="pw-footer">
            <button class="btn btn-sm btn-light pw-cancel-btn" (click)="closePasswordModal()">Cancel</button>
            <button class="btn btn-sm btn-mail" (click)="savePassword(true)" [disabled]="pwModal.saving">
              <i class="fas fa-envelope"></i>&nbsp;{{ pwModal.saving ? 'Sending...' : 'Save & Mail' }}
            </button>
            <button class="btn btn-sm btn-save-pw" (click)="savePassword(false)" [disabled]="pwModal.saving">
              <i class="fas fa-save"></i>&nbsp;{{ pwModal.saving ? 'Saving...' : 'Save Only' }}
            </button>
          </div>

        </div>
      </div>
      <!-- ===== /Password Modal ===== -->

    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: calc(100vh - 80px);
      font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
    }

    .user-roles-page { min-height: calc(100vh - 80px); }

    /* ── Header ── */
    .page-header {
      background: #b3cde0;
      color: #011f4b;
      padding: 14px 18px;
      margin: 14px;
      border-radius: 14px;
    }

    .page-header .row { margin: 0; }
    .page-header .col-md-8,
    .page-header .col-md-4 { padding: 0; }

    .page-title {
      font-size: 15px;
      font-weight: 700;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .page-title i { font-size: 14px; }

    .page-subtitle {
      font-size: 11px;
      opacity: 0.65;
      margin: 2px 0 0;
    }

    .stats-quick {
      display: flex;
      justify-content: flex-end;
    }

    .stat-item {
      text-align: center;
      background: rgba(1,31,75,0.08);
      padding: 8px 14px;
      border-radius: 10px;
    }

    .stat-number {
      display: block;
      font-size: 18px;
      font-weight: 700;
      line-height: 1;
      color: #011f4b;
    }

    .stat-label {
      display: block;
      font-size: 9px;
      opacity: 0.6;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /* ── Content ── */
    .page-content { padding: 12px 14px; }

    /* ── Table Card ── */
    .data-table-card { margin-bottom: 10px; }

    .card {
      border: 1px solid #e8ecf4;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
      border-radius: 14px;
      overflow: hidden;
    }

    .card-header {
      background: #f8fafc;
      border-bottom: 1px solid #f1f5f9;
      border-radius: 14px 14px 0 0 !important;
      padding: 10px 14px;
    }

    .card-header h5 {
      color: #011f4b;
      font-weight: 700;
      font-size: 12px;
      margin: 0;
    }

    .card-body.create-sub-admin-body {
      padding: 12px 14px;
    }

    .permissions-toolbar {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .permission-matrix {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }

    .permission-group-card {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 8px 10px;
      background: #f8fafc;
    }

    .group-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }

    .group-top h6 {
      margin: 0;
      font-size: 11px;
      font-weight: 700;
      color: #0f172a;
    }

    .required-hint {
      font-size: 11px;
      color: #475569;
      margin-bottom: 8px;
    }

    .create-actions {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      margin-bottom: 10px;
    }

    .credentials-box {
      border: 1px dashed #93c5fd;
      border-radius: 10px;
      padding: 10px;
      background: #eff6ff;
    }

    .credentials-title {
      font-size: 12px;
      font-weight: 700;
      color: #1e3a8a;
      margin-bottom: 6px;
    }

    .credentials-row {
      font-size: 12px;
      color: #1e293b;
      margin-bottom: 4px;
      word-break: break-word;
    }

    .credentials-actions {
      margin-top: 8px;
    }

    .table { margin-bottom: 0; }

    .table thead th {
      background: #03396c;
      color: #fff;
      font-weight: 600;
      border: none;
      padding: 8px 10px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .table tbody td {
      padding: 8px 10px;
      vertical-align: middle;
      border-bottom: 1px solid #f1f5f9;
      font-size: 12px;
    }

    .table tbody tr:hover { background: #f8fafc; }
    .table tbody tr { transition: background 0.15s; }

    /* ── Badges ── */
    .badge {
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 10px;
    }

    .badge.bg-primary   { background: #dbeafe !important; color: #005b96 !important; }
    .badge.bg-warning   { background: #fef3c7 !important; color: #92400e !important; }
    .badge.bg-danger    { background: #ffe0e6 !important; color: #e11d48 !important; }
    .badge.bg-dark      { background: #e2e8f0 !important; color: #0f172a !important; }
    .badge.bg-secondary { background: #f1f5f9 !important; color: #64748b !important; }

    .permissions-wrap { min-width: 260px; max-width: 340px; }
    .permissions-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .permission-count {
      font-size: 10px;
      color: #64748b;
      font-weight: 600;
    }
    .permissions-toggle-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .details-panel {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px;
      background: #f8fafc;
    }
    .permissions-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 10px;
    }
    .permission-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      color: #334155;
    }
    .permission-item input { margin: 0; }

    .tab-info-note {
      grid-column: 1 / -1;
      font-size: 10px;
      color: #0369a1;
      background: #e0f2fe;
      border: 1px solid #bae6fd;
      border-radius: 6px;
      padding: 5px 8px;
      margin-bottom: 6px;
    }

    /* ── Form Select ── */
    .form-select-sm {
      min-width: 170px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      padding: 5px 10px;
      font-size: 11px;
      background: #f8fafc;
      color: #1e293b;
      transition: border-color 0.15s;
    }

    .form-select-sm:focus {
      border-color: #005b96;
      box-shadow: 0 0 0 2px rgba(0,91,150,0.08);
      background: #fff;
    }

    /* ── Action Buttons ── */
    .action-btns {
      display: flex;
      gap: 5px;
      align-items: center;
      flex-wrap: wrap;
    }

    .btn-sm {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 8px;
    }

    .btn-success { background: #28a745; border-color: #28a745; color: #fff; }
    .btn-success:hover { background: #1e7e34; border-color: #1e7e34; }
    .btn-success:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-key {
      background: #f59e0b;
      border: none;
      color: #fff;
      padding: 4px 9px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-key:hover { background: #d97706; }

    .btn-del {
      background: #ef4444;
      border: none;
      color: #fff;
      padding: 4px 9px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-del:hover { background: #dc2626; }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .page-header { margin: 10px; padding: 12px 14px; }
      .page-title { font-size: 14px; }
      .stats-quick { justify-content: center; margin-top: 8px; }
    }

    @media (max-width: 576px) {
      .page-content { padding: 10px; }
    }

    /* ══════════════════════════════
       Password Modal
    ══════════════════════════════ */
    .pw-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .pw-box {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      width: 100%;
      max-width: 440px;
      overflow: hidden;
      animation: pwSlideIn 0.2s ease;
    }

    @keyframes pwSlideIn {
      from { transform: translateY(-20px); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }

    .pw-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      background: #03396c;
      color: #fff;
    }
    .pw-header-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .pw-close {
      background: none;
      border: none;
      color: rgba(255,255,255,0.75);
      font-size: 18px;
      cursor: pointer;
      line-height: 1;
      padding: 0 2px;
      transition: color 0.15s;
    }
    .pw-close:hover { color: #fff; }

    .pw-body {
      padding: 18px 20px 10px;
    }

    .pw-user-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: #f1f5f9;
      border-radius: 999px;
      padding: 4px 12px 4px 8px;
      font-size: 12px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .pw-user-pill i { color: #03396c; font-size: 14px; }
    .pw-role-badge {
      background: #dbeafe;
      color: #1e40af;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 999px;
    }

    .pw-email-line {
      font-size: 11px;
      color: #64748b;
      margin: 0 0 14px;
      padding-left: 2px;
    }

    .pw-field {
      margin-bottom: 12px;
    }
    .pw-field label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #334155;
      margin-bottom: 4px;
    }
    .pw-input-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pw-input-row .form-control { flex: 1; }
    .pw-eye-btn {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 4px 9px;
      cursor: pointer;
      color: #64748b;
      font-size: 12px;
      transition: background 0.15s;
    }
    .pw-eye-btn:hover { background: #e2e8f0; }

    .pw-divider {
      height: 1px;
      background: #f1f5f9;
      margin: 12px 0;
    }

    .btn-gen {
      background: #e0f2fe;
      border: 1px solid #bae6fd;
      color: #0369a1;
      font-size: 11px;
      font-weight: 600;
      border-radius: 8px;
      padding: 4px 12px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-gen:hover { background: #bae6fd; }

    .pw-generated-box {
      margin-top: 10px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .pw-gen-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .pw-gen-label {
      font-size: 11px;
      color: #166534;
      font-weight: 600;
    }
    .pw-gen-value {
      font-family: 'Courier New', monospace;
      font-size: 13px;
      font-weight: 700;
      color: #15803d;
      background: #dcfce7;
      padding: 2px 8px;
      border-radius: 6px;
      letter-spacing: 0.05em;
    }
    .pw-copy-btn {
      font-size: 11px;
      color: #0369a1;
      text-decoration: none;
      padding: 2px 6px;
      font-weight: 600;
    }
    .pw-copy-btn:hover { text-decoration: underline; }
    .pw-gen-note {
      font-size: 10px;
      color: #166534;
      margin: 6px 0 0;
      opacity: 0.8;
    }

    .pw-error-msg {
      margin-top: 10px;
      font-size: 11px;
      color: #dc2626;
      font-weight: 600;
    }

    .pw-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 20px 14px;
      border-top: 1px solid #f1f5f9;
    }

    .pw-cancel-btn {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      color: #475569;
      font-size: 11px;
      font-weight: 600;
      border-radius: 8px;
    }
    .pw-cancel-btn:hover { background: #e2e8f0; }

    .btn-save-pw {
      background: #03396c;
      border: none;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      border-radius: 8px;
      padding: 5px 16px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-save-pw:hover:not(:disabled) { background: #022952; }
    .btn-save-pw:disabled { opacity: 0.55; cursor: not-allowed; }

    .btn-mail {
      background: #16a34a;
      border: none;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      border-radius: 8px;
      padding: 5px 14px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-mail:hover:not(:disabled) { background: #15803d; }
    .btn-mail:disabled { opacity: 0.55; cursor: not-allowed; }
  `]
})
export class UserRolesComponent implements OnInit {
  private readonly requiredSubAdminPermissions = ['dashboard', 'profile'];
  expandedSubAdminRows = new Set<string>();
  expandedTeacherTabRows = new Set<string>();
  allTeachersAndAdmins: ManagedUser[] = [];
  subAdminPermissionGroups: { group: string; items: { id: string; label: string }[] }[] = [];
  subAdminPermissionOptions: { id: string; label: string }[] = [];

  pwModal: PwModal = {
    open: false,
    user: null,
    newPassword: '',
    confirmPassword: '',
    showPass: false,
    saving: false,
    generatedPreview: '',
    error: ''
  };

  constructor(private http: HttpClient, private navService: NavService, private notify: NotificationService) {
    this.subAdminPermissionGroups = this.navService.getAdminNavGroups().map((group) => ({
      group: group.group,
      items: group.items.map((item) => ({ id: item.id, label: item.label }))
    }));

    this.subAdminPermissionOptions = this.subAdminPermissionGroups
      .flatMap((group) => group.items)
      .filter((item, index, self) => self.findIndex((other) => other.id === item.id) === index);
  }

  ngOnInit(): void {
    this.fetchTeachersAndAdmins();
  }

  isPermissionMandatory(permissionId: string): boolean {
    return this.requiredSubAdminPermissions.includes(permissionId);
  }

  fetchTeachersAndAdmins(): void {
    this.http.get<any>(`${apiUrl}/auth/teachers-and-admins`, { withCredentials: true }).subscribe({
      next: (response) => {
        this.allTeachersAndAdmins = response.map((user: any): ManagedUser => ({
          ...user,
          newRole: user.role,
          sidebarPermissions: this.normalizePermissionsForRole(user.role, user.sidebarPermissions || []),
          teacherTabPermissions: user.role === 'TEACHER'
            ? this.navService.normalizeTeacherTabPermissions(user.teacherTabPermissions || [])
            : [],
          permissionsDirty: false
        }));
        this.expandedSubAdminRows.clear();
        this.expandedTeacherTabRows.clear();
      },
      error: (err) => {
        console.error('Failed to fetch teachers and admins:', err);
        this.notify.error('Failed to load users');
      }
    });
  }

  onRoleChange(user: ManagedUser): void {
    if (user.newRole === 'SUB_ADMIN') {
      user.sidebarPermissions = this.navService.normalizeSidebarPermissions(user.sidebarPermissions || []);
      user.teacherTabPermissions = [];
    } else if (user.newRole === 'TEACHER') {
      user.sidebarPermissions = [];
      user.teacherTabPermissions = this.navService.normalizeTeacherTabPermissions(user.teacherTabPermissions || []);
    } else {
      user.sidebarPermissions = [];
      user.teacherTabPermissions = [];
    }
    user.permissionsDirty = true;
  }

  isSubAdminRole(user: ManagedUser): boolean {
    return user.newRole === 'SUB_ADMIN' || user.role === 'SUB_ADMIN';
  }

  isSubAdminDetailsOpen(user: ManagedUser): boolean {
    return this.expandedSubAdminRows.has(user._id);
  }

  toggleSubAdminDetails(user: ManagedUser): void {
    if (this.isSubAdminDetailsOpen(user)) {
      this.expandedSubAdminRows.delete(user._id);
    } else {
      this.expandedSubAdminRows.add(user._id);
    }
  }

  toggleSubAdminPermission(user: ManagedUser, permissionId: string, event: Event): void {
    if (this.isPermissionMandatory(permissionId)) {
      return;
    }
    const input = event.target as HTMLInputElement;
    const current = new Set(user.sidebarPermissions || []);
    if (input.checked) {
      current.add(permissionId);
    } else {
      current.delete(permissionId);
    }

    user.sidebarPermissions = this.navService.normalizeSidebarPermissions(Array.from(current));
    user.permissionsDirty = true;
  }

  isTeacherRole(user: ManagedUser): boolean {
    return user.newRole === 'TEACHER' || user.role === 'TEACHER';
  }

  isTeacherTabDetailsOpen(user: ManagedUser): boolean {
    return this.expandedTeacherTabRows.has(user._id);
  }

  toggleTeacherTabDetails(user: ManagedUser): void {
    if (this.isTeacherTabDetailsOpen(user)) {
      this.expandedTeacherTabRows.delete(user._id);
    } else {
      this.expandedTeacherTabRows.add(user._id);
    }
  }

  toggleTeacherTabPermission(user: ManagedUser, permissionId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const current = new Set(user.teacherTabPermissions || []);
    if (input.checked) {
      current.add(permissionId);
    } else {
      current.delete(permissionId);
    }
    user.teacherTabPermissions = this.navService.normalizeTeacherTabPermissions(Array.from(current));
    user.permissionsDirty = true;
  }

  hasPendingChanges(user: ManagedUser): boolean {
    return user.newRole !== user.role || user.permissionsDirty;
  }

  private normalizePermissionsForRole(role: string, sidebarPermissions: string[]): string[] {
    return role === 'SUB_ADMIN' ? this.navService.normalizeSidebarPermissions(sidebarPermissions) : [];
  }

  private normalizeTeacherTabsForRole(role: string, teacherTabPermissions: string[]): string[] {
    return role === 'TEACHER' ? this.navService.normalizeTeacherTabPermissions(teacherTabPermissions) : [];
  }

  updateUserRole(user: ManagedUser): void {
    if (!this.hasPendingChanges(user)) {
      return;
    }

    const actionText = user.newRole === user.role
      ? `update access for ${user.name}`
      : `change ${user.name}'s role from ${user.role} to ${user.newRole}`;

    this.notify.confirm('Update Access', `Are you sure you want to ${actionText}?`).subscribe(ok => {
      if (!ok) {
        user.newRole = user.role;
        user.sidebarPermissions = this.normalizePermissionsForRole(user.role, user.sidebarPermissions);
        user.teacherTabPermissions = this.normalizeTeacherTabsForRole(user.role, user.teacherTabPermissions);
        user.permissionsDirty = false;
        return;
      }

      const payload: any = { role: user.newRole };
      payload.sidebarPermissions = user.newRole === 'SUB_ADMIN'
        ? this.navService.normalizeSidebarPermissions(user.sidebarPermissions || [])
        : [];
      payload.teacherTabPermissions = user.newRole === 'TEACHER'
        ? this.navService.normalizeTeacherTabPermissions(user.teacherTabPermissions || [])
        : [];

      this.http.put(`${apiUrl}/auth/${user._id}`, payload, { withCredentials: true }).subscribe({
        next: () => {
          this.notify.success(`Successfully updated access for ${user.name}`);
          user.role = user.newRole;
          user.sidebarPermissions = this.normalizePermissionsForRole(user.role, payload.sidebarPermissions || []);
          user.teacherTabPermissions = this.normalizeTeacherTabsForRole(user.role, payload.teacherTabPermissions || []);
          user.permissionsDirty = false;
          this.fetchTeachersAndAdmins();
        },
        error: (err) => {
          console.error('Failed to update role/access:', err);
          this.notify.error('Failed to update role/access. Please try again.');
          user.newRole = user.role;
          user.sidebarPermissions = this.normalizePermissionsForRole(user.role, user.sidebarPermissions);
          user.teacherTabPermissions = this.normalizeTeacherTabsForRole(user.role, user.teacherTabPermissions);
          user.permissionsDirty = false;
        }
      });
    });
  }

  /* ── Delete user ── */
  deleteUser(user: ManagedUser): void {
    this.notify.confirm(
      'Delete User',
      `Are you sure you want to permanently delete ${user.name} (${user.email})? This cannot be undone.`
    ).subscribe(ok => {
      if (!ok) return;
      this.http.delete(`${apiUrl}/auth/${user._id}`, { withCredentials: true }).subscribe({
        next: () => {
          this.notify.success(`${user.name} has been deleted.`);
          this.fetchTeachersAndAdmins();
        },
        error: (err) => {
          console.error('Failed to delete user:', err);
          this.notify.error('Failed to delete user. Please try again.');
        }
      });
    });
  }

  /* ── Password modal ── */
  openPasswordModal(user: ManagedUser): void {
    this.pwModal = {
      open: true,
      user,
      newPassword: '',
      confirmPassword: '',
      showPass: false,
      saving: false,
      generatedPreview: '',
      error: ''
    };
  }

  closePasswordModal(): void {
    this.pwModal.open = false;
  }

  generateRandomPassword(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 12; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.pwModal.generatedPreview = pwd;
    this.pwModal.newPassword = pwd;
    this.pwModal.confirmPassword = pwd;
    this.pwModal.error = '';
  }

  copyPassword(): void {
    if (this.pwModal.generatedPreview) {
      navigator.clipboard.writeText(this.pwModal.generatedPreview).then(() => {
        this.notify.success('Password copied to clipboard!');
      });
    }
  }

  savePassword(andEmail: boolean): void {
    const { newPassword, confirmPassword, user } = this.pwModal;

    if (!newPassword || newPassword.trim().length < 6) {
      this.pwModal.error = 'Password must be at least 6 characters.';
      return;
    }
    if (newPassword !== confirmPassword) {
      this.pwModal.error = 'Passwords do not match.';
      return;
    }
    if (!user) return;

    this.pwModal.error = '';
    this.pwModal.saving = true;

    const endpoint = andEmail ? 'admin-set-password-and-email' : 'admin-set-password';
    this.http.put(
      `${apiUrl}/auth/${endpoint}/${user._id}`,
      { newPassword: newPassword.trim() },
      { withCredentials: true }
    ).subscribe({
      next: () => {
        this.pwModal.saving = false;
        if (andEmail) {
          this.notify.success(`Password updated and emailed to ${user.email}.`);
        } else {
          this.notify.success(`Password updated successfully for ${user.name}.`);
        }
        this.closePasswordModal();
      },
      error: (err) => {
        this.pwModal.saving = false;
        this.pwModal.error = err?.error?.message || 'Failed to update password. Please try again.';
        console.error('Password update error:', err);
      }
    });
  }
}
