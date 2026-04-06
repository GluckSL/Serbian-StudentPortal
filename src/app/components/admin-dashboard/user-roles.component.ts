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
  permissionsDirty: boolean;
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
                      <td>
                        <button class="btn btn-sm btn-success" 
                                (click)="updateUserRole(user)"
                                [disabled]="!hasPendingChanges(user)">
                          <i class="fas fa-save"></i> Update
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          
        </div>
      </div>
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

    /* ── Buttons ── */
    .btn-sm {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 8px;
    }

    .btn-success { background: #28a745; border-color: #28a745; color: #fff; }
    .btn-success:hover { background: #1e7e34; border-color: #1e7e34; }
    .btn-success:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .page-header { margin: 10px; padding: 12px 14px; }
      .page-title { font-size: 14px; }
      .stats-quick { justify-content: center; margin-top: 8px; }
    }

    @media (max-width: 576px) {
      .page-content { padding: 10px; }
    }
  `]
})
export class UserRolesComponent implements OnInit {
  private readonly requiredSubAdminPermissions = ['dashboard', 'profile'];
  expandedSubAdminRows = new Set<string>();
  allTeachersAndAdmins: ManagedUser[] = [];
  subAdminPermissionGroups: { group: string; items: { id: string; label: string }[] }[] = [];
  subAdminPermissionOptions: { id: string; label: string }[] = [];

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
          permissionsDirty: false
        }));
        this.expandedSubAdminRows.clear();
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
    } else {
      user.sidebarPermissions = [];
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

  hasPendingChanges(user: ManagedUser): boolean {
    return user.newRole !== user.role || user.permissionsDirty;
  }

  private normalizePermissionsForRole(role: string, sidebarPermissions: string[]): string[] {
    return role === 'SUB_ADMIN' ? this.navService.normalizeSidebarPermissions(sidebarPermissions) : [];
  }

  updateUserRole(user: ManagedUser): void {
    if (!this.hasPendingChanges(user)) {
      return;
    }

    const actionText = user.newRole === user.role
      ? `update sidebar access for ${user.name}`
      : `change ${user.name}'s role from ${user.role} to ${user.newRole}`;

    this.notify.confirm('Update Access', `Are you sure you want to ${actionText}?`).subscribe(ok => {
      if (!ok) {
        user.newRole = user.role;
        user.sidebarPermissions = this.normalizePermissionsForRole(user.role, user.sidebarPermissions);
        user.permissionsDirty = false;
        return;
      }

      const payload: any = { role: user.newRole };
      payload.sidebarPermissions = user.newRole === 'SUB_ADMIN'
        ? this.navService.normalizeSidebarPermissions(user.sidebarPermissions || [])
        : [];

      this.http.put(`${apiUrl}/auth/${user._id}`, payload, { withCredentials: true }).subscribe({
        next: () => {
          this.notify.success(`Successfully updated access for ${user.name}`);
          user.role = user.newRole;
          user.sidebarPermissions = this.normalizePermissionsForRole(user.role, payload.sidebarPermissions || []);
          user.permissionsDirty = false;
          this.fetchTeachersAndAdmins();
        },
        error: (err) => {
          console.error('Failed to update role/access:', err);
          this.notify.error('Failed to update role/access. Please try again.');
          user.newRole = user.role;
          user.sidebarPermissions = this.normalizePermissionsForRole(user.role, user.sidebarPermissions);
          user.permissionsDirty = false;
        }
      });
    });
  }
}
