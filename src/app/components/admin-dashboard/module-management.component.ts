// src/app/components/admin-dashboard/module-management.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { LearningModulesService } from '../../services/learning-modules.service';
import { ModuleTrashService } from '../../services/module-trash.service';
import { NotificationService } from '../../services/notification.service';
import { AdminAnalyticsService } from '../../services/admin-analytics.service';
import { DgApiService } from '../../dg-bot/dg-api.service';

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
  /** 1–200 day in course journey; null = general pool */
  courseDay?: number | null;
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
                <button
                  type="button"
                  class="btn btn-copy-dg-module"
                  [disabled]="selectedModuleCount === 0 || copyingToDgBot"
                  (click)="copySelectedToDgBot()"
                >
                  <i class="fas fa-robot" [class.fa-spin]="copyingToDgBot"></i>
                  Copy to DG Bot
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
          <div *ngIf="loading" class="loading-state">
            <div class="skeleton-header">
              <div class="skeleton-line skeleton-line--title"></div>
              <div class="skeleton-line skeleton-line--text"></div>
            </div>
            <div class="skeleton-stats">
              <div class="skeleton-chip" *ngFor="let _ of skeletonStats; trackBy: trackByIndex"></div>
            </div>
            <div class="skeleton-table">
              <div class="skeleton-row skeleton-row--head">
                <div class="skeleton-cell" *ngFor="let _ of skeletonColumns; trackBy: trackByIndex"></div>
              </div>
              <div class="skeleton-row" *ngFor="let _ of skeletonRows; trackBy: trackByIndex">
                <div class="skeleton-cell" *ngFor="let __ of skeletonColumns; trackBy: trackByIndex"></div>
              </div>
            </div>
          </div>

          <!-- Empty State -->
          <div *ngIf="!loading && modules.length === 0" class="empty-state">
            <div class="empty-state-icon">📚</div>
            <h3>No modules found</h3>
            <p>Try changing the filter or create a new module.</p>
          </div>

          <!-- Results Summary -->
          <div *ngIf="!loading" class="results-summary">
            <div class="d-flex justify-content-between align-items-center">
              <div class="results-info">
                <span class="results-count">{{ modules.length || 0 }}</span>
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
                        <th class="text-center dg-select-col">
                          <input
                            type="checkbox"
                            class="form-check-input"
                            title="Select all on this page"
                            [checked]="allModulesOnPageSelected"
                            [disabled]="modules.length === 0 || copyingToDgBot"
                            (change)="toggleSelectAllOnPage($any($event.target).checked)"
                          />
                        </th>
                        <th>Module</th>
                        <th>Level/Category</th>
                        <th>Journey day</th>
                        <th>Created By</th>
                        <th>Last Updated</th>
                        <th>Version</th>
                        <th>Enrollments</th>
                        <th>Status</th>
                        <th class="text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr *ngFor="let module of modules; trackBy: trackByModuleId">
                        <td class="text-center dg-select-col align-middle">
                          <input
                            type="checkbox"
                            class="form-check-input"
                            [checked]="selectedModuleIds.has(module._id)"
                            [disabled]="copyingToDgBot"
                            (change)="toggleModuleSelected(module._id, $any($event.target).checked)"
                          />
                        </td>
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
                          <div class="journey-day-cell">
                            <span class="badge journey-day-badge" *ngIf="module.courseDay != null">
                              Day {{ module.courseDay }}
                            </span>
                            <span class="text-muted journey-day-pool" *ngIf="module.courseDay == null">
                              —
                            </span>
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
                            <button class="btn btn-sm btn-outline-purple me-1" (click)="openAnalytics(module)" title="Student Analytics">
                              <i class="fas fa-chart-bar"></i>
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
              <li class="page-item" *ngFor="let page of getPageNumbers(); trackBy: trackByPage" [class.active]="page === pagination.current">
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

    <!-- ═══════ Analytics Modal ═══════ -->
    <div class="analytics-overlay" *ngIf="analyticsModal.open" (click)="closeAnalytics()">
      <div class="analytics-modal" (click)="$event.stopPropagation()">

        <!-- Modal Header -->
        <div class="am-header">
          <div class="am-header-left">
            <span class="am-icon">📊</span>
            <div>
              <h2 class="am-title">Module Analytics</h2>
              <p class="am-subtitle">{{ analyticsModal.moduleName }}</p>
            </div>
          </div>
          <button class="am-close" (click)="closeAnalytics()">✕</button>
        </div>

        <!-- Loading -->
        <div class="am-loading" *ngIf="analyticsModal.loading">
          <div class="am-spinner"></div>
          <span>Loading student data…</span>
        </div>

        <!-- Summary Cards -->
        <div class="am-summary" *ngIf="!analyticsModal.loading">
          <div class="am-sum-card am-sum-total">
            <span class="am-sum-num">{{ analyticsModal.totalStudents }}</span>
            <span class="am-sum-label">Total Students</span>
          </div>
          <div class="am-sum-card am-sum-done">
            <span class="am-sum-num">{{ analyticsModal.completed }}</span>
            <span class="am-sum-label">✅ Completed</span>
          </div>
          <div class="am-sum-card am-sum-pend">
            <span class="am-sum-num">{{ analyticsModal.notCompleted }}</span>
            <span class="am-sum-label">⏳ Not Completed</span>
          </div>
          <div class="am-sum-card am-sum-time">
            <span class="am-sum-num">{{ analyticsModal.avgTime }}</span>
            <span class="am-sum-label">Avg Time Spent</span>
          </div>
          <div class="am-sum-card am-sum-score">
            <span class="am-sum-num">{{ analyticsModal.avgScore }}%</span>
            <span class="am-sum-label">Avg Score</span>
          </div>
        </div>

        <!-- Filter Tabs -->
        <div class="am-tabs" *ngIf="!analyticsModal.loading">
          <button class="am-tab" [class.active]="analyticsModal.filter === 'all'" (click)="setAnalyticsFilter('all')">All</button>
          <button class="am-tab" [class.active]="analyticsModal.filter === 'completed'" (click)="setAnalyticsFilter('completed')">✅ Completed</button>
          <button class="am-tab" [class.active]="analyticsModal.filter === 'not-completed'" (click)="setAnalyticsFilter('not-completed')">⏳ Not Completed</button>
        </div>

        <!-- Student Table -->
        <div class="am-table-wrap" *ngIf="!analyticsModal.loading">
          <table class="am-table" *ngIf="filteredAnalyticsSessions.length > 0; else noData">
            <thead>
              <tr>
                <th>Student</th>
                <th>Batch</th>
                <th>Level</th>
                <th>Status</th>
                <th>Score</th>
                <th>Time Spent</th>
                <th>Date &amp; Time</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of filteredAnalyticsSessions; trackBy: trackBySession" class="am-row">
                <td class="am-name">{{ s.studentName }}</td>
                <td>{{ s.studentBatch || '—' }}</td>
                <td>
                  <span class="am-level-badge am-level-{{ s.studentLevel?.toLowerCase() }}">{{ s.studentLevel || '—' }}</span>
                </td>
                <td>
                  <span class="am-status" [class.am-done]="s.completionStatus === 'completed'" [class.am-pend]="s.completionStatus !== 'completed'">
                    {{ s.completionStatus === 'completed' ? '✅ Completed' : '⏳ ' + (s.completionStatus || 'In Progress') }}
                  </span>
                </td>
                <td>
                  <span class="am-score" [class.am-score-hi]="s.score >= 80" [class.am-score-mid]="s.score >= 50 && s.score < 80" [class.am-score-lo]="s.score < 50 && s.score > 0">
                    {{ s.score > 0 ? (s.score | number:'1.0-1') + '%' : '—' }}
                  </span>
                </td>
                <td>{{ formatMinutes(s.timeSpent) }}</td>
                <td class="am-date">{{ formatDate(s.date) }}</td>
              </tr>
            </tbody>
          </table>
          <ng-template #noData>
            <div class="am-empty">
              <span>📭</span>
              <p>No student sessions found for this module yet.</p>
            </div>
          </ng-template>
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
              <div class="timeline-item" *ngFor="let update of selectedModuleHistory.updateHistory; let i = index; trackBy: trackByHistoryVersion">
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

    .btn-copy-dg-module {
      background: #7c3aed;
      border: none;
      color: #fff;
      font-weight: 600;
      padding: 5px 12px;
      border-radius: 8px;
      margin-left: 6px;
      font-size: 11px;
      font-family: inherit;
    }

    .btn-copy-dg-module:hover:not(:disabled) { background: #6d28d9; color: #fff; }

    .btn-copy-dg-module:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .dg-select-col {
      width: 38px;
      max-width: 42px;
      vertical-align: middle;
    }

    .dg-select-col .form-check-input {
      margin: 0;
      cursor: pointer;
    }

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
      padding: 18px;
      box-shadow: 0 2px 12px rgba(15,23,42,0.07);
    }

    .skeleton-header { margin-bottom: 14px; }
    .skeleton-line {
      border-radius: 8px;
      background: linear-gradient(90deg, #eef2f7 25%, #f7f9fc 50%, #eef2f7 75%);
      background-size: 200% 100%;
      animation: shimmer 1.2s linear infinite;
    }
    .skeleton-line--title { width: 220px; max-width: 100%; height: 14px; margin-bottom: 8px; }
    .skeleton-line--text { width: 320px; max-width: 100%; height: 10px; }
    .skeleton-stats {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .skeleton-chip {
      height: 52px;
      border-radius: 10px;
      background: linear-gradient(90deg, #eef2f7 25%, #f7f9fc 50%, #eef2f7 75%);
      background-size: 200% 100%;
      animation: shimmer 1.2s linear infinite;
    }
    .skeleton-table { border: 1px solid #eef2f7; border-radius: 10px; overflow: hidden; }
    .skeleton-row {
      display: grid;
      grid-template-columns: 0.35fr 2.2fr 1.1fr 0.8fr 1fr 1fr 0.8fr 0.8fr 0.8fr 1.4fr;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
    }
    .skeleton-row--head { background: #f8fafc; }
    .skeleton-row:last-child { border-bottom: none; }
    .skeleton-cell {
      height: 11px;
      border-radius: 6px;
      background: linear-gradient(90deg, #eef2f7 25%, #f7f9fc 50%, #eef2f7 75%);
      background-size: 200% 100%;
      animation: shimmer 1.2s linear infinite;
    }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .empty-state {
      background: #fff;
      border: 1px dashed #cbd5e1;
      border-radius: 14px;
      padding: 26px 16px;
      text-align: center;
      margin-bottom: 10px;
      color: #475569;
    }
    .empty-state-icon { font-size: 28px; line-height: 1; margin-bottom: 8px; }
    .empty-state h3 { font-size: 14px; margin: 0 0 4px; color: #0f172a; }
    .empty-state p { margin: 0; font-size: 12px; }

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

    .journey-day-cell { min-width: 72px; }
    .journey-day-badge {
      background: #e8f4fc !important;
      color: #005b96 !important;
      border: 1px solid #b8d4e8;
    }
    .journey-day-pool { font-size: 11px; }

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

    .btn-outline-purple   { color: #7c3aed; border-color: #7c3aed; }
    .btn-outline-purple:hover { background: #7c3aed; color: #fff; }

    /* ── Analytics Modal Overlay ── */
    .analytics-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15,23,42,0.55);
      backdrop-filter: blur(4px);
      z-index: 1055;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .analytics-modal {
      background: #fff;
      border-radius: 18px;
      width: 100%;
      max-width: 860px;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 60px rgba(15,23,42,0.25);
      overflow: hidden;
    }

    /* Header */
    .am-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      background: linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%);
      color: #fff;
      flex-shrink: 0;
    }
    .am-header-left { display: flex; align-items: center; gap: 12px; }
    .am-icon { font-size: 28px; }
    .am-title { font-size: 16px; font-weight: 700; margin: 0; }
    .am-subtitle { font-size: 11px; opacity: 0.8; margin: 0; }
    .am-close {
      background: rgba(255,255,255,0.15);
      border: none;
      color: #fff;
      border-radius: 8px;
      width: 32px; height: 32px;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .am-close:hover { background: rgba(255,255,255,0.3); }

    /* Loading */
    .am-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 40px;
      color: #64748b;
      font-size: 13px;
    }
    .am-spinner {
      width: 24px; height: 24px;
      border: 3px solid #e2e8f0;
      border-top-color: #7c3aed;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Summary Cards */
    .am-summary {
      display: flex;
      gap: 10px;
      padding: 14px 20px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      flex-shrink: 0;
      overflow-x: auto;
    }
    .am-sum-card {
      flex: 1;
      min-width: 90px;
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      border: 1px solid;
    }
    .am-sum-num   { font-size: 20px; font-weight: 700; line-height: 1; }
    .am-sum-label { font-size: 10px; margin-top: 4px; text-align: center; font-weight: 500; }
    .am-sum-total { background: #eef2ff; border-color: #c7d2fe; color: #3730a3; }
    .am-sum-done  { background: #dcfce7; border-color: #bbf7d0; color: #166534; }
    .am-sum-pend  { background: #fef3c7; border-color: #fde68a; color: #92400e; }
    .am-sum-time  { background: #e0f2fe; border-color: #bae6fd; color: #0369a1; }
    .am-sum-score { background: #f5f3ff; border-color: #ddd6fe; color: #6d28d9; }

    /* Filter Tabs */
    .am-tabs {
      display: flex;
      gap: 0;
      padding: 0 20px;
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      flex-shrink: 0;
    }
    .am-tab {
      padding: 10px 18px;
      border: none;
      background: none;
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      cursor: pointer;
      border-bottom: 3px solid transparent;
      transition: all 0.15s;
    }
    .am-tab:hover { color: #7c3aed; }
    .am-tab.active { color: #7c3aed; border-bottom-color: #7c3aed; font-weight: 600; }

    /* Table */
    .am-table-wrap { overflow-y: auto; flex: 1; padding: 16px 20px; }
    .am-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .am-table thead th {
      background: #f1f5f9;
      padding: 8px 12px;
      text-align: left;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
      position: sticky;
      top: 0;
    }
    .am-row td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    .am-row:hover td { background: #faf5ff; }
    .am-name { font-weight: 600; color: #1e293b; }
    .am-date { color: #64748b; white-space: nowrap; }

    .am-level-badge {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 99px;
      font-size: 10px;
      font-weight: 700;
    }
    .am-level-a1 { background: #dcfce7; color: #166534; }
    .am-level-a2 { background: #d1fae5; color: #065f46; }
    .am-level-b1 { background: #fef3c7; color: #92400e; }
    .am-level-b2 { background: #fed7aa; color: #9a3412; }
    .am-level-c1 { background: #fce7f3; color: #9d174d; }
    .am-level-c2 { background: #ede9fe; color: #4c1d95; }

    .am-status { font-size: 11px; font-weight: 500; }
    .am-done { color: #16a34a; }
    .am-pend { color: #d97706; }

    .am-score { font-weight: 700; font-size: 13px; }
    .am-score-hi  { color: #16a34a; }
    .am-score-mid { color: #d97706; }
    .am-score-lo  { color: #dc2626; }

    .am-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px;
      color: #94a3b8;
      gap: 8px;
      font-size: 13px;
    }
    .am-empty span { font-size: 36px; }

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
  readonly skeletonRows = Array.from({ length: 7 });
  readonly skeletonColumns = Array.from({ length: 10 });
  readonly skeletonStats = Array.from({ length: 5 });
  statusFilter = 'all';
  selectedModuleHistory: any = null;

  /** Learning module IDs selected on the current page (cleared when changing page/filter). */
  selectedModuleIds = new Set<string>();
  copyingToDgBot = false;

  get selectedModuleCount(): number {
    return this.selectedModuleIds.size;
  }

  get allModulesOnPageSelected(): boolean {
    return (
      this.modules.length > 0 && this.modules.every((m) => this.selectedModuleIds.has(m._id))
    );
  }

  // ── Analytics Modal State ──
  analyticsModal = {
    open: false,
    loading: false,
    moduleId: '',
    moduleName: '',
    filter: 'all' as 'all' | 'completed' | 'not-completed',
    sessions: [] as any[],
    totalStudents: 0,
    completed: 0,
    notCompleted: 0,
    avgTime: '—',
    avgScore: 0
  };

  constructor(
    private learningModulesService: LearningModulesService,
    private moduleTrashService: ModuleTrashService,
    private adminAnalyticsService: AdminAnalyticsService,
    private dgApi: DgApiService,
    private router: Router,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadModules();
  }

  loadModules(): void {
    this.fetchModules(1);
  }

  private fetchModules(page: number): void {
    this.loading = true;
    this.learningModulesService.getModulesForAdmin({
      status: this.statusFilter,
      page,
      limit: 20
    }).subscribe({
      next: (response) => {
        this.modules = response.modules;
        this.summary = response.summary;
        this.pagination = response.pagination;
        this.loading = false;
        this.selectedModuleIds = new Set();
      },
      error: (error) => {
        console.error('Error loading modules:', error);
        this.loading = false;
      }
    });
  }

  changePage(page: number): void {
    if (!this.pagination || page < 1 || page > this.pagination.pages || page === this.pagination.current) return;
    this.fetchModules(page);
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
        this.notify.error('Failed to load module history');
      }
    });
  }

  toggleStatus(module: ModuleWithStats): void {
    const newStatus = !module.isActive;
    const action = newStatus ? 'activate' : 'deactivate';
    this.notify.confirm('Toggle Status', `${action.charAt(0).toUpperCase() + action.slice(1)} this module?`).subscribe(ok => {
      if (!ok) return;
      const updateData: any = { isActive: newStatus, changeDescription: `Module ${action}d by admin` };
      this.learningModulesService.updateModule(module._id, updateData).subscribe({
        next: () => {
          module.isActive = newStatus;
          this.notify.success(`Module ${action}d successfully`);
        },
        error: (error) => {
          console.error(`Error ${action}ing module:`, error);
          this.notify.error(`Failed to ${action} module`);
        }
      });
    });
  }

  // ✅ NEW: Toggle module visibility for students
  toggleVisibility(module: ModuleWithStats): void {
    const newVisibility = !module.visibleToStudents;
    this.notify.confirm(
      newVisibility ? 'Publish Module' : 'Hide Module',
      `${newVisibility ? 'Show' : 'Hide'} "${module.title}" ${newVisibility ? 'to' : 'from'} students?`
    ).subscribe(ok => {
      if (!ok) return;
      this.learningModulesService.toggleModuleVisibility(module._id, newVisibility).subscribe({
        next: (response) => {
          module.visibleToStudents = newVisibility;
          if (newVisibility && response.module.publishedAt) module.publishedAt = response.module.publishedAt;
          this.notify.success(`Module ${newVisibility ? 'published to' : 'hidden from'} students successfully`);
        },
        error: () => this.notify.error('Failed to update module visibility')
      });
    });
  }

  // Test module directly via AI tutor chat
  testModule(module: ModuleWithStats): void {
    this.notify.confirm('Test Module', `Test "${module.title}" as a student?`, 'Start Test', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.router.navigate(['/ai-tutor-chat'], {
        queryParams: { moduleId: module._id, sessionType: 'teacher-test', testMode: 'true' }
      });
    });
  }

  deleteModule(module: ModuleWithStats): void {
    this.notify.confirm(
      'Delete Module',
      `Move "${module.title}" to trash? It will be permanently deleted after 30 days (restorable from Trash).`,
      'Move to Trash', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      this.moduleTrashService.moveToTrash(module._id, 'Admin deleted module from management page').subscribe({
        next: () => {
          this.notify.success('Module moved to trash successfully');
          this.loadModules();
        },
        error: () => this.notify.error('Failed to delete module')
      });
    });
  }

  toggleSelectAllOnPage(checked: boolean): void {
    const next = new Set(this.selectedModuleIds);
    if (checked) {
      this.modules.forEach((m) => next.add(m._id));
    } else {
      this.modules.forEach((m) => next.delete(m._id));
    }
    this.selectedModuleIds = next;
  }

  toggleModuleSelected(id: string, checked: boolean): void {
    const next = new Set(this.selectedModuleIds);
    if (checked) next.add(id);
    else next.delete(id);
    this.selectedModuleIds = next;
  }

  copySelectedToDgBot(): void {
    const ids = [...this.selectedModuleIds];
    if (!ids.length) return;
    const n = ids.length;
    this.notify
      .confirm(
        'Copy to DG Bot',
        `Create ${n} DG Bot draft module(s) from the selected Learning module(s)? Shared fields will be copied; DG defaults apply for character and scenes.`,
        'Copy',
        'Cancel',
      )
      .subscribe((ok) => {
        if (!ok) return;
        this.copyingToDgBot = true;
        this.dgApi.importFromLearning(ids).subscribe({
          next: (res) => {
            this.copyingToDgBot = false;
            const okCount = res.results?.length ?? 0;
            const errCount = res.errors?.length ?? 0;
            this.selectedModuleIds = new Set();
            if (okCount && !errCount) {
              this.notify.success(`Created ${okCount} DG Bot module(s).`);
            } else if (okCount && errCount) {
              const errSummary = res.errors.map((e) => e.message).join('; ');
              this.notify.success(
                `Created ${okCount} DG Bot module(s). ${errCount} failed: ${errSummary}`,
              );
            } else if (!okCount && errCount) {
              this.notify.error(res.errors.map((e) => e.message).join('; ') || 'Copy failed');
              return;
            }
            this.router.navigate(['/admin/dg-modules'], { queryParams: { status: 'all' } });
          },
          error: (err: any) => {
            this.copyingToDgBot = false;
            const body = err?.error;
            if (
              err?.status === 400 &&
              body &&
              Array.isArray(body.errors) &&
              Array.isArray(body.results) &&
              body.results.length === 0 &&
              body.errors.length > 0
            ) {
              this.notify.error(body.errors.map((e: { message: string }) => e.message).join('; ') || 'Copy failed');
              return;
            }
            this.notify.error(body?.message || 'Failed to copy to DG Bot');
          },
        });
      });
  }

  // ── Analytics Modal Methods ──

  openAnalytics(module: ModuleWithStats): void {
    this.analyticsModal = {
      open: true,
      loading: true,
      moduleId: module._id,
      moduleName: module.title,
      filter: 'all',
      sessions: [],
      totalStudents: 0,
      completed: 0,
      notCompleted: 0,
      avgTime: '—',
      avgScore: 0
    };
    document.body.style.overflow = 'hidden';

    this.adminAnalyticsService.getModuleUsage({ moduleId: module._id, groupBy: 'module' })
      .subscribe({
        next: (res) => {
          const moduleData = res.data?.[0];
          const sessions: any[] = moduleData?.sessions || [];

          const completed = sessions.filter(s => s.completionStatus === 'completed').length;
          const totalTime = sessions.reduce((a: number, s: any) => a + (s.timeSpent || 0), 0);
          const scores = sessions.map((s: any) => s.score || 0).filter((sc: number) => sc > 0);
          const avgScore = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

          this.analyticsModal = {
            ...this.analyticsModal,
            loading: false,
            sessions,
            totalStudents: sessions.length,
            completed,
            notCompleted: sessions.length - completed,
            avgTime: this.adminAnalyticsService.formatTimeSpent(sessions.length ? totalTime / sessions.length : 0),
            avgScore
          };
        },
        error: () => {
          this.analyticsModal.loading = false;
          this.notify.error('Failed to load analytics');
        }
      });
  }

  closeAnalytics(): void {
    this.analyticsModal.open = false;
    document.body.style.overflow = '';
  }

  setAnalyticsFilter(filter: 'all' | 'completed' | 'not-completed'): void {
    this.analyticsModal.filter = filter;
  }

  get filteredAnalyticsSessions(): any[] {
    const { sessions, filter } = this.analyticsModal;
    if (filter === 'completed') return sessions.filter(s => s.completionStatus === 'completed');
    if (filter === 'not-completed') return sessions.filter(s => s.completionStatus !== 'completed');
    return sessions;
  }

  formatMinutes(minutes: number): string {
    return this.adminAnalyticsService.formatTimeSpent(minutes || 0);
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

  trackByModuleId(_: number, module: ModuleWithStats): string {
    return module._id;
  }

  trackByPage(_: number, page: number): number {
    return page;
  }

  trackBySession(index: number, session: any): string {
    return session?._id || `${session?.studentId || 'student'}-${session?.date || index}`;
  }

  trackByHistoryVersion(index: number, update: any): string | number {
    return update?.version ?? index;
  }

  trackByIndex(index: number): number {
    return index;
  }
}