// src/app/components/admin-dashboard/user-roles.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

const apiUrl = environment.apiUrl;

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
                                'bg-danger': user.role === 'ADMIN'
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
                        </select>
                      </td>
                      <td>
                        <button class="btn btn-sm btn-success" 
                                (click)="updateUserRole(user)"
                                [disabled]="!user.newRole || user.newRole === user.role">
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
    .badge.bg-secondary { background: #f1f5f9 !important; color: #64748b !important; }

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
  allTeachersAndAdmins: any[] = [];

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.fetchTeachersAndAdmins();
  }

  fetchTeachersAndAdmins(): void {
    this.http.get<any>(`${apiUrl}/auth/teachers-and-admins`, { withCredentials: true }).subscribe({
      next: (response) => {
        this.allTeachersAndAdmins = response.map((user: any) => ({
          ...user,
          newRole: user.role
        }));
      },
      error: (err) => {
        console.error('Failed to fetch teachers and admins:', err);
        alert('Failed to load users');
      }
    });
  }

  onRoleChange(user: any): void {
    console.log(`Role change requested for ${user.name}: ${user.role} -> ${user.newRole}`);
  }

  updateUserRole(user: any): void {
    if (!user.newRole || user.newRole === user.role) {
      return;
    }

    if (!confirm(`Are you sure you want to change ${user.name}'s role from ${user.role} to ${user.newRole}?`)) {
      user.newRole = user.role;
      return;
    }

    this.http.put(`${apiUrl}/auth/${user._id}`, { role: user.newRole }, { withCredentials: true }).subscribe({
      next: (response) => {
        alert(`Successfully updated ${user.name}'s role to ${user.newRole}`);
        user.role = user.newRole;
        this.fetchTeachersAndAdmins();
      },
      error: (err) => {
        console.error('Failed to update role:', err);
        alert('Failed to update role. Please try again.');
        user.newRole = user.role;
      }
    });
  }
}
