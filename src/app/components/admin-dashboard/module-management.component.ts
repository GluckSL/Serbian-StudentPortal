// src/app/components/admin-dashboard/module-management.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { LearningModulesService } from '../../services/learning-modules.service';
import { ModuleTrashService } from '../../services/module-trash.service';

interface ModuleWithStats {
  _id: string;
  title: string;
  description: string;
  level: string;
  category: string;
  difficulty: string;
  isActive: boolean;
  visibleToStudents?: boolean;  // ✅ NEW
  publishedAt?: Date;           // ✅ NEW
  createdBy: {
    _id: string;
    name: string;
    email: string;
    role: string;
  };
  lastUpdatedBy?: {
    _id: string;
    name: string;
    email: string;
    role: string;
  };
  createdAt: Date;
  updatedAt: Date;
  version: number;
  totalUpdates: number;
  lastUpdateDate: Date;
  createdByTeacher: boolean;
  totalEnrollments: number;
}

@Component({
  selector: 'app-module-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="admin-modules">
      <!-- Header Section -->
      <div class="admin-header">
        <div class="container-fluid">
          <div class="row align-items-center">
            <div class="col-md-8">
              <h1 class="admin-title">
                <i class="fas fa-book"></i>
                Module Management
              </h1>
              <p class="admin-subtitle">Manage and organize all learning modules</p>
            </div>
            <div class="col-md-4 text-end">
              <div class="admin-stats-quick" *ngIf="summary">
                <div class="stat-item">
                  <span class="stat-number">{{ summary.totalModules || 0 }}</span>
                  <span class="stat-label">Total Modules</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content Area -->
      <div class="admin-content">
        <div class="container-fluid">
          
          <!-- Action Bar -->
          <div class="action-bar">
            <div class="row align-items-center">
              <div class="col-md-6">
                <button class="btn btn-primary btn-add-module" routerLink="/learning-modules">
                  <i class="fas fa-plus"></i>
                  Create New Module
                </button>
                <button class="btn btn-trash-module" routerLink="/admin-trash">
                  <i class="fas fa-trash"></i>
                  Trash
                </button>
              </div>
              <div class="col-md-6 text-end">
                <div class="filter-options">
                  <select class="form-select" [(ngModel)]="statusFilter" (change)="loadModules()">
                    <option value="all">All Modules</option>
                    <option value="active">Active Only</option>
                    <option value="inactive">Inactive Only</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <!-- Summary Statistics -->
          <div class="stats-section" *ngIf="summary">
            <div class="row">
              <div class="col-md-2">
                <div class="stat-card bg-primary text-white">
                  <div class="stat-icon"><i class="fas fa-book"></i></div>
                  <div class="stat-content">
                    <h3>{{ summary.totalModules }}</h3>
                    <p>Total Modules</p>
                  </div>
                </div>
              </div>
              <div class="col-md-2">
                <div class="stat-card bg-success text-white">
                  <div class="stat-icon"><i class="fas fa-check-circle"></i></div>
                  <div class="stat-content">
                    <h3>{{ summary.activeModules }}</h3>
                    <p>Active</p>
                  </div>
                </div>
              </div>
              <div class="col-md-2">
                <div class="stat-card bg-warning text-white">
                  <div class="stat-icon"><i class="fas fa-pause-circle"></i></div>
                  <div class="stat-content">
                    <h3>{{ summary.inactiveModules }}</h3>
                    <p>Inactive</p>
                  </div>
                </div>
              </div>
              <div class="col-md-3">
                <div class="stat-card bg-info text-white">
                  <div class="stat-icon"><i class="fas fa-chalkboard-teacher"></i></div>
                  <div class="stat-content">
                    <h3>{{ summary.teacherCreated }}</h3>
                    <p>Created by Teachers</p>
                  </div>
                </div>
              </div>
              <div class="col-md-3">
                <div class="stat-card bg-secondary text-white">
                  <div class="stat-icon"><i class="fas fa-user-shield"></i></div>
                  <div class="stat-content">
                    <h3>{{ summary.adminCreated }}</h3>
                    <p>Created by Admins</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Loading State -->
          <div *ngIf="loading" class="loading-state text-center py-5">
            <div class="spinner-border text-primary" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-3">Loading modules...</p>
          </div>

          <!-- Results Summary -->
          <div *ngIf="!loading" class="results-summary">
            <div class="d-flex justify-content-between align-items-center">
              <div class="results-info">
                <span class="results-count">{{ modules?.length || 0 }}</span>
                <span class="results-text">modules found</span>
              </div>
            </div>
          </div>

          <!-- Modules Table -->
          <div *ngIf="!loading" class="modules-table">
            <div class="data-table-card">
              <div class="card">
                <div class="table-responsive">
                  <table class="table table-hover mb-0">
                    <thead class="table-dark">
                      <tr>
                        <th>Module</th>
                        <th>Level/Category</th>
                        <th>Created By</th>
                        <th>Last Updated</th>
                        <th>Version</th>
                        <th>Enrollments</th>
                        <th>Status</th>
                        <th class="text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr *ngFor="let module of modules">
                        <td>
                          <div class="module-info">
                            <div class="module-title">{{ module.title }}</div>
                            <div class="module-desc">{{ module.description | slice:0:80 }}{{ module.description.length > 80 ? '...' : '' }}</div>
                          </div>
                        </td>
                        <td>
                          <div class="level-category">
                            <span class="badge bg-primary me-1">{{ module.level }}</span>
                            <br>
                            <small class="text-muted">{{ module.category }}</small>
                          </div>
                        </td>
                        <td>
                          <div class="creator-info">
                            <div class="creator-name">{{ module.createdBy.name }}</div>
                            <span class="badge" [class]="module.createdByTeacher ? 'bg-info' : 'bg-secondary'">
                              {{ module.createdBy.role }}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div class="update-info">
                            <div class="update-date">{{ formatDate(module.lastUpdateDate) }}</div>
                            <small class="text-muted" *ngIf="module.lastUpdatedBy">
                              by {{ module.lastUpdatedBy.name }}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div class="version-info">
                            <span class="badge bg-info">v{{ module.version }}</span>
                            <br>
                            <small class="text-muted">{{ module.totalUpdates }} updates</small>
                          </div>
                        </td>
                        <td>
                          <span class="badge bg-success">{{ module.totalEnrollments }}</span>
                        </td>
                        <td>
                          <span class="badge" [class]="module.isActive ? 'bg-success' : 'bg-danger'">
                            {{ module.isActive ? 'Active' : 'Inactive' }}
                          </span>
                          <br>
                          <span class="badge mt-1" [class]="module.visibleToStudents ? 'bg-primary' : 'bg-warning'">
                            {{ module.visibleToStudents ? '👁️ Visible' : '🔒 Hidden' }}
                          </span>
                        </td>
                        <td class="text-center">
                          <div class="action-buttons">
                            <button class="btn btn-sm me-1" 
                                    [class]="module.visibleToStudents ? 'btn-outline-warning' : 'btn-outline-success'"
                                    (click)="toggleVisibility(module)" 
                                    [title]="module.visibleToStudents ? 'Hide from students' : 'Show to students'">
                              <i class="fas" [class]="module.visibleToStudents ? 'fa-eye-slash' : 'fa-eye'"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-success me-1" (click)="testModule(module)" title="Test Module">
                              <i class="fas fa-play-circle"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-info me-1" (click)="viewHistory(module._id)" title="View History">
                              <i class="fas fa-history"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-primary me-1" [routerLink]="['/edit-module', module._id]" title="Edit Module">
                              <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-warning me-1" (click)="toggleStatus(module)" title="Toggle Status">
                              <i class="fas" [class]="module.isActive ? 'fa-pause' : 'fa-play'"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger" (click)="deleteModule(module)" title="Delete Module">
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

          <!-- Pagination -->
          <nav *ngIf="pagination && pagination.pages > 1" class="pagination-nav">
            <ul class="pagination justify-content-center">
              <li class="page-item" [class.disabled]="pagination.current === 1">
                <button class="page-link" (click)="changePage(pagination.current - 1)">Previous</button>
              </li>
              <li class="page-item" *ngFor="let page of getPageNumbers()" [class.active]="page === pagination.current">
                <button class="page-link" (click)="changePage(page)">{{ page }}</button>
              </li>
              <li class="page-item" [class.disabled]="pagination.current === pagination.pages">
                <button class="page-link" (click)="changePage(pagination.current + 1)">Next</button>
              </li>
            </ul>
          </nav>

        </div>
      </div>
    </div>

    <!-- History Modal -->
    <div class="modal fade" id="historyModal" tabindex="-1" *ngIf="selectedModuleHistory">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Module Update History</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <h6>{{ selectedModuleHistory.title }}</h6>
            <p><strong>Created by:</strong> {{ selectedModuleHistory.createdBy.name }} ({{ selectedModuleHistory.createdBy.role }}) on {{ formatDate(selectedModuleHistory.createdAt) }}</p>
            <p><strong>Current Version:</strong> {{ selectedModuleHistory.currentVersion }}</p>
            
            <h6 class="mt-4">Update History:</h6>
            <div class="timeline">
              <div class="timeline-item" *ngFor="let update of selectedModuleHistory.updateHistory; let i = index">
                <div class="timeline-marker bg-primary"></div>
                <div class="timeline-content">
                  <div class="d-flex justify-content-between">
                    <strong>Version {{ update.version }}</strong>
                    <small class="text-muted">{{ formatDate(update.updatedAt) }}</small>
                  </div>
                  <p class="mb-1">{{ update.changes }}</p>
                  <small class="text-muted">Updated by {{ update.updatedBy.name }} ({{ update.updatedBy.role }})</small>
                </div>
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

    .admin-modules { min-height: calc(100vh - 80px); }

    /* ── Header ── */
    .admin-header {
      background: #b3cde0;
      color: #011f4b;
      padding: 14px 18px;
      margin: 14px;
      border-radius: 14px;
    }

    .admin-header .row { margin: 0; }
    .admin-header .col-md-8,
    .admin-header .col-md-4 { padding: 0; }

    .admin-title {
      font-size: 15px;
      font-weight: 700;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .admin-title i { font-size: 14px; }

    .admin-subtitle {
      font-size: 11px;
      opacity: 0.65;
      margin: 2px 0 0;
    }

    .admin-stats-quick { display: flex; justify-content: flex-end; }

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
    .admin-content { padding: 12px 14px; }

    /* ── Action Bar ── */
    .action-bar {
      margin-bottom: 10px;
      background: #fff;
      border-radius: 14px;
      padding: 10px 14px;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
      border: 1px solid #e8ecf4;
    }

    .action-bar .row { margin: 0; }
    .action-bar .col-md-6 { padding: 0; }

    .btn-add-module {
      background: #005b96;
      border: none;
      color: #fff;
      font-weight: 600;
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 11px;
      font-family: inherit;
    }

    .btn-add-module:hover { background: #03396c; color: #fff; }

    .btn-trash-module {
      background: #e11d48;
      border: none;
      color: #fff;
      font-weight: 600;
      padding: 5px 12px;
      border-radius: 8px;
      margin-left: 6px;
      font-size: 11px;
      font-family: inherit;
    }

    .btn-trash-module:hover { background: #be123c; color: #fff; }

    .filter-options .form-select {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 5px 10px;
      font-size: 11px;
      font-weight: 500;
      background: #f8fafc;
      color: #1e293b;
    }

    .filter-options .form-select:focus {
      border-color: #005b96;
      box-shadow: 0 0 0 2px rgba(0,91,150,0.08);
    }

    /* ── Stats Cards ── */
    .stats-section { margin-bottom: 10px; }

    .stat-card {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      border-radius: 12px;
      margin-bottom: 8px;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
      border: 1px solid #e8ecf4;
    }

    .stat-card.bg-primary   { background: #005b96 !important; }
    .stat-card.bg-success   { background: #28a745 !important; }
    .stat-card.bg-warning   { background: #f59e0b !important; }
    .stat-card.bg-info      { background: #6497b1 !important; }
    .stat-card.bg-secondary { background: #64748b !important; }

    .stat-icon { font-size: 18px; margin-right: 10px; opacity: 0.85; }

    .stat-content h3 { margin: 0; font-size: 16px; font-weight: 700; }
    .stat-content p  { margin: 0; font-size: 10px; opacity: 0.9; }

    /* ── Loading ── */
    .loading-state {
      background: #fff;
      border-radius: 14px;
      padding: 30px 20px;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
      text-align: center;
    }

    .loading-state p { font-size: 12px; color: #64748b; margin-top: 10px; }
    .spinner-border { color: #005b96; }

    /* ── Results Summary ── */
    .results-summary {
      margin-bottom: 10px;
      padding: 8px 14px;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
      border: 1px solid #e8ecf4;
    }

    .results-count { font-size: 13px; font-weight: 700; color: #005b96; }
    .results-text  { color: #94a3b8; margin-left: 4px; font-size: 11px; }

    /* ── Table Card ── */
    .data-table-card .card {
      border: 1px solid #e8ecf4;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
      border-radius: 14px;
      overflow: hidden;
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

    /* ── Module Info ── */
    .module-info .module-title { font-weight: 600; color: #0f172a; font-size: 12px; }
    .module-info .module-desc  { color: #94a3b8; font-size: 10px; margin-top: 2px; }

    .level-category small { font-size: 10px; }

    .creator-info .creator-name { font-weight: 600; color: #0f172a; font-size: 12px; }

    .update-info .update-date { font-size: 11px; color: #475569; }
    .update-info small { font-size: 10px; }

    .version-info small { font-size: 10px; }

    /* ── Badges ── */
    .badge {
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 10px;
    }

    .badge.bg-primary   { background: #dbeafe !important; color: #005b96 !important; }
    .badge.bg-info      { background: #e0f2fe !important; color: #0369a1 !important; }
    .badge.bg-success   { background: #dcfce7 !important; color: #166534 !important; }
    .badge.bg-warning   { background: #fef3c7 !important; color: #92400e !important; }
    .badge.bg-danger    { background: #ffe0e6 !important; color: #e11d48 !important; }
    .badge.bg-secondary { background: #f1f5f9 !important; color: #64748b !important; }

    /* ── Action Buttons ── */
    .action-buttons { display: flex; gap: 3px; justify-content: center; flex-wrap: wrap; }

    .action-buttons .btn {
      padding: 3px 7px;
      font-size: 11px;
      border-radius: 6px;
    }

    .btn-outline-primary  { color: #005b96; border-color: #005b96; }
    .btn-outline-primary:hover { background: #005b96; color: #fff; }

    .btn-outline-success  { color: #28a745; border-color: #28a745; }
    .btn-outline-success:hover { background: #28a745; color: #fff; }

    .btn-outline-info     { color: #6497b1; border-color: #6497b1; }
    .btn-outline-info:hover { background: #6497b1; color: #fff; }

    .btn-outline-warning  { color: #f59e0b; border-color: #f59e0b; }
    .btn-outline-warning:hover { background: #f59e0b; color: #fff; }

    .btn-outline-danger   { color: #e11d48; border-color: #e11d48; }
    .btn-outline-danger:hover { background: #e11d48; color: #fff; }

    /* ── Pagination ── */
    .pagination-nav { margin-top: 14px; }

    .pagination .page-link {
      color: #005b96;
      border-color: #e2e8f0;
      font-size: 11px;
      padding: 4px 10px;
    }

    .pagination .page-item.active .page-link {
      background: #005b96;
      border-color: #005b96;
      color: #fff;
    }

    .pagination .page-link:hover {
      color: #03396c;
      background: #f8fafc;
      border-color: #e2e8f0;
    }

    /* ── History Modal ── */
    .modal-content {
      border-radius: 14px;
      border: none;
      box-shadow: 0 10px 40px rgba(15,23,42,0.2);
    }

    .modal-header {
      border-radius: 14px 14px 0 0;
      background: #b3cde0;
      padding: 12px 16px;
    }

    .modal-header .modal-title {
      font-weight: 700;
      font-size: 13px;
      color: #011f4b;
    }

    .modal-body { padding: 16px; font-size: 12px; }
    .modal-body h6 { font-size: 13px; font-weight: 700; color: #011f4b; }
    .modal-body p  { font-size: 11px; color: #475569; }

    .timeline { position: relative; padding-left: 20px; }

    .timeline-item { position: relative; margin-bottom: 12px; }

    .timeline-marker {
      position: absolute;
      left: -20px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      top: 4px;
      background: #005b96;
    }

    .timeline-content {
      background: #f8fafc;
      padding: 10px 12px;
      border-radius: 10px;
      border-left: 3px solid #005b96;
      font-size: 11px;
    }

    .timeline-content strong { font-size: 12px; color: #011f4b; }
    .timeline-content small  { font-size: 10px; }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .admin-header { margin: 10px; padding: 12px 14px; }
      .admin-title { font-size: 14px; }
      .admin-stats-quick { justify-content: center; margin-top: 8px; }
      .action-bar .row > div { margin-bottom: 8px; text-align: center; }
      .stat-card { flex-direction: column; text-align: center; padding: 8px; }
      .stat-icon { margin-right: 0; margin-bottom: 4px; }
      .action-buttons { flex-direction: column; gap: 3px; }
      .action-buttons .btn { font-size: 10px; padding: 2px 6px; }
    }

    @media (max-width: 576px) {
      .admin-content { padding: 10px; }
      .admin-title { font-size: 13px; flex-direction: column; text-align: center; gap: 4px; }
      .admin-stats-quick { justify-content: center; margin-top: 8px; }
    }
  `]
})
export class ModuleManagementComponent implements OnInit {
  modules: ModuleWithStats[] = [];
  summary: any = null;
  pagination: any = null;
  loading = true;
  statusFilter = 'all';
  selectedModuleHistory: any = null;

  constructor(
    private learningModulesService: LearningModulesService,
    private moduleTrashService: ModuleTrashService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadModules();
  }

  loadModules(): void {
    this.loading = true;
    this.learningModulesService.getModulesForAdmin({
      status: this.statusFilter,
      page: 1,
      limit: 20
    }).subscribe({
      next: (response) => {
        this.modules = response.modules;
        this.summary = response.summary;
        this.pagination = response.pagination;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading modules:', error);
        this.loading = false;
      }
    });
  }

  changePage(page: number): void {
    if (page >= 1 && page <= this.pagination.pages) {
      this.loading = true;
      this.learningModulesService.getModulesForAdmin({
        status: this.statusFilter,
        page: page,
        limit: 20
      }).subscribe({
        next: (response) => {
          this.modules = response.modules;
          this.pagination = response.pagination;
          this.loading = false;
        },
        error: (error) => {
          console.error('Error loading modules:', error);
          this.loading = false;
        }
      });
    }
  }

  getPageNumbers(): number[] {
    const pages = [];
    const start = Math.max(1, this.pagination.current - 2);
    const end = Math.min(this.pagination.pages, this.pagination.current + 2);
    
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  viewHistory(moduleId: string): void {
    this.learningModulesService.getModuleHistory(moduleId).subscribe({
      next: (history) => {
        this.selectedModuleHistory = history;
        // Open modal (you might want to use a proper modal service)
        const modal = document.getElementById('historyModal');
        if (modal) {
          // Bootstrap modal show
          (window as any).bootstrap?.Modal?.getOrCreateInstance(modal)?.show();
        }
      },
      error: (error) => {
        console.error('Error loading module history:', error);
        alert('Failed to load module history');
      }
    });
  }

  toggleStatus(module: ModuleWithStats): void {
    const newStatus = !module.isActive;
    const action = newStatus ? 'activate' : 'deactivate';
    
    if (confirm(`Are you sure you want to ${action} this module?`)) {
      const updateData: any = { 
        isActive: newStatus,
        changeDescription: `Module ${action}d by admin`
      };
      
      this.learningModulesService.updateModule(module._id, updateData).subscribe({
        next: () => {
          module.isActive = newStatus;
          alert(`Module ${action}d successfully`);
        },
        error: (error) => {
          console.error(`Error ${action}ing module:`, error);
          alert(`Failed to ${action} module`);
        }
      });
    }
  }

  // ✅ NEW: Toggle module visibility for students
  toggleVisibility(module: ModuleWithStats): void {
    const newVisibility = !module.visibleToStudents;
    const action = newVisibility ? 'show to' : 'hide from';
    
    if (confirm(`Are you sure you want to ${action} students?\n\nModule: ${module.title}`)) {
      this.learningModulesService.toggleModuleVisibility(module._id, newVisibility).subscribe({
        next: (response) => {
          module.visibleToStudents = newVisibility;
          if (newVisibility && response.module.publishedAt) {
            module.publishedAt = response.module.publishedAt;
          }
          alert(`Module ${newVisibility ? 'published to' : 'hidden from'} students successfully`);
        },
        error: (error) => {
          console.error(`Error toggling module visibility:`, error);
          alert(`Failed to update module visibility`);
        }
      });
    }
  }

  // Test module directly via AI tutor chat
  testModule(module: ModuleWithStats): void {
    const confirmTest = confirm(
      `🧪 Test Module: "${module.title}"\n\n` +
      `This will start the AI tutoring session for this module, allowing you to experience it as a student would.\n\n` +
      `Continue with testing?`
    );

    if (confirmTest) {
      this.router.navigate(['/ai-tutor-chat'], {
        queryParams: {
          moduleId: module._id,
          sessionType: 'teacher-test',
          testMode: 'true'
        }
      });
    }
  }

  deleteModule(module: ModuleWithStats): void {
    const confirmMessage = `⚠️ DELETE MODULE WARNING ⚠️

This will move "${module.title}" to the trash.
The module will be automatically deleted after 30 days.

You can restore it from the Trash Management page if needed.

Are you sure you want to delete this module?`;

    if (confirm(confirmMessage)) {
      this.moduleTrashService.moveToTrash(module._id, 'Admin deleted module from management page').subscribe({
        next: (response) => {
          console.log('✅ Module moved to trash:', response);
          alert('Module moved to trash successfully');
          this.loadModules(); // Reload the modules list
        },
        error: (error) => {
          console.error('❌ Error moving module to trash:', error);
          alert('Failed to delete module');
        }
      });
    }
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}