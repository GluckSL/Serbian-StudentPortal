// src/app/components/teacher-dashboard/session-records.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { NotificationService } from '../../services/notification.service';

interface SessionRecord {
  id: string;
  sessionId: string;
  student: {
    id: string;
    name: string;
    email: string;
    level: string;
  };
  module: {
    title: string;
    level: string;
  };
  sessionType: string;
  sessionState: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  formattedDuration: string;
  conversationStats: {
    totalMessages: number;
    studentMessages: number;
    tutorMessages: number;
    speechMessages: number;
    textMessages: number;
  };
  performanceSummary: {
    conversationCount: number;
    timeSpent: number;
    vocabularyUsed: string[];
    exerciseAccuracy: number;
    totalScore: number;
    sessionCompleted: boolean;
    moduleCompleted: boolean;
  };
  teacherReviewed: boolean;
  isModuleCompleted: boolean;
  createdAt: Date;
}

interface SessionDetails extends SessionRecord {
  messages: Array<{
    role: 'student' | 'tutor';
    content: string;
    messageType: string;
    timestamp: Date;
  }>;
  summary: {
    conversationCount: number;
    timeSpentMinutes: number;
    vocabularyUsed: string[];
    exerciseScore: number;
    conversationScore: number;
    totalScore: number;
    correctAnswers: number;
    incorrectAnswers: number;
    accuracy: number;
  };
  teacherNotes?: string;
  reviewedAt?: Date;
}

@Component({
  selector: 'app-session-records',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="container-fluid py-4">
      <div class="row">
        <div class="col-12">
          <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
              <h4 class="mb-0">📊 Student Session Records</h4>
              <div class="d-flex gap-2">
                <select class="form-select form-select-sm" [(ngModel)]="selectedModule" (change)="loadSessionRecords()">
                  <option value="">All Modules</option>
                  <option *ngFor="let module of availableModules" [value]="module.id">
                    {{module.title}} ({{module.level}})
                  </option>
                </select>
                <button class="btn btn-primary btn-sm" (click)="loadSessionRecords()">
                  <i class="fas fa-refresh"></i> Refresh
                </button>
              </div>
            </div>
            
            <div class="card-body">
              <!-- Statistics Overview -->
              <div class="row mb-4" *ngIf="stats">
                <div class="col-md-2">
                  <div class="stat-card text-center p-3 bg-primary text-white rounded">
                    <h5 class="mb-1">{{stats.totalSessions}}</h5>
                    <small>Total Sessions</small>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="stat-card text-center p-3 bg-success text-white rounded">
                    <h5 class="mb-1">{{stats.completedSessions}}</h5>
                    <small>Completed</small>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="stat-card text-center p-3 bg-info text-white rounded">
                    <h5 class="mb-1">{{stats.modulesCompleted}}</h5>
                    <small>Modules Done</small>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="stat-card text-center p-3 bg-warning text-white rounded">
                    <h5 class="mb-1">{{stats.needsReview}}</h5>
                    <small>Need Review</small>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="stat-card text-center p-3 bg-secondary text-white rounded">
                    <h5 class="mb-1">{{stats.avgDurationMinutes}}m</h5>
                    <small>Avg Duration</small>
                  </div>
                </div>
                <div class="col-md-2">
                  <div class="stat-card text-center p-3 bg-dark text-white rounded">
                    <h5 class="mb-1">{{stats.completionRate}}%</h5>
                    <small>Success Rate</small>
                  </div>
                </div>
              </div>

              <!-- Session Records Table -->
              <div class="table-responsive">
                <table class="table table-hover">
                  <thead class="table-dark">
                    <tr>
                      <th>Student</th>
                      <th>Module</th>
                      <th>Session Info</th>
                      <th>Performance</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let record of sessionRecords" 
                        [class.table-warning]="!record.teacherReviewed && record.sessionState === 'manually_ended'"
                        [class.table-danger]="record.sessionState === 'abandoned'"
                        [class.table-success]="record.isModuleCompleted">
                      <td>
                        <div>
                          <strong>{{record.student.name}}</strong>
                          <br>
                          <small class="text-muted">{{record.student.email}}</small>
                          <br>
                          <span class="badge bg-info">{{record.student.level}}</span>
                        </div>
                      </td>
                      <td>
                        <div>
                          <strong>{{record.module.title}}</strong>
                          <br>
                          <span class="badge bg-secondary">{{record.module.level}}</span>
                        </div>
                      </td>
                      <td>
                        <div>
                          <strong>💬 {{record.performanceSummary.conversationCount}} conversations</strong>
                          <br>
                          <small>⏱️ {{record.performanceSummary.timeSpent}} minutes</small>
                          <br>
                          <small>📅 {{formatDate(record.createdAt)}}</small>
                          <!-- Show warning for short sessions -->
                          <br>
                          <span *ngIf="record.performanceSummary.timeSpent < 5" class="badge bg-warning text-dark">
                            ⚠️ Very Short Session
                          </span>
                        </div>
                      </td>
                      <td>
                        <div>
                          <strong>📚 Vocabulary:</strong> {{record.performanceSummary.vocabularyUsed.length}} words
                          <br>
                          <small *ngIf="record.performanceSummary.vocabularyUsed.length > 0">
                            {{record.performanceSummary.vocabularyUsed.slice(0, 3).join(', ')}}
                            <span *ngIf="record.performanceSummary.vocabularyUsed.length > 3">...</span>
                          </small>
                          <small *ngIf="record.performanceSummary.vocabularyUsed.length === 0" class="text-muted">
                            No vocabulary used
                          </small>
                          <br>
                          <span class="badge bg-primary">Score: {{record.performanceSummary.totalScore}}</span>
                        </div>
                      </td>
                      <td>
                        <div>
                          <span class="badge" 
                                [class.bg-success]="record.sessionState === 'completed'"
                                [class.bg-warning]="record.sessionState === 'manually_ended'"
                                [class.bg-danger]="record.sessionState === 'abandoned'"
                                [class.bg-info]="record.sessionState === 'active'">
                            {{getSessionStateLabel(record.sessionState)}}
                          </span>
                          <br>
                          <span *ngIf="record.isModuleCompleted" class="badge bg-success mt-1">
                            ✅ Module Complete
                          </span>
                          <span *ngIf="!record.isModuleCompleted && record.sessionState === 'completed'" class="badge bg-warning mt-1">
                            ⚠️ Session Complete, Module Incomplete
                          </span>
                          <span *ngIf="record.sessionState === 'manually_ended'" class="badge bg-warning mt-1">
                            🛑 Stopped Early
                          </span>
                          <span *ngIf="record.sessionState === 'abandoned'" class="badge bg-danger mt-1">
                            ❌ Abandoned
                          </span>
                          <br>
                          <span *ngIf="!record.teacherReviewed" class="badge bg-info mt-1">
                            📝 Needs Review
                          </span>
                        </div>
                      </td>
                      <td>
                        <div class="btn-group-vertical btn-group-sm">
                          <button class="btn btn-outline-primary btn-sm" 
                                  (click)="viewSessionDetails(record.sessionId)">
                            <i class="fas fa-eye"></i> View Details
                          </button>
                          <button class="btn btn-outline-success btn-sm" 
                                  (click)="addReview(record.sessionId)"
                                  [disabled]="record.teacherReviewed">
                            <i class="fas fa-comment"></i> 
                            {{record.teacherReviewed ? 'Reviewed' : 'Add Review'}}
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Pagination -->
              <nav *ngIf="pagination" class="mt-3">
                <ul class="pagination justify-content-center">
                  <li class="page-item" [class.disabled]="!pagination.hasPrev">
                    <button class="page-link" (click)="changePage(currentPage - 1)" [disabled]="!pagination.hasPrev">
                      Previous
                    </button>
                  </li>
                  <li class="page-item active">
                    <span class="page-link">{{currentPage}} of {{pagination.totalPages}}</span>
                  </li>
                  <li class="page-item" [class.disabled]="!pagination.hasNext">
                    <button class="page-link" (click)="changePage(currentPage + 1)" [disabled]="!pagination.hasNext">
                      Next
                    </button>
                  </li>
                </ul>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Session Details Modal -->
    <div class="modal fade" id="sessionDetailsModal" tabindex="-1" *ngIf="selectedSessionDetails">
      <div class="modal-dialog modal-xl">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              📊 Session Details - {{selectedSessionDetails.student.name}}
            </h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <!-- Session Summary -->
            <div class="row mb-4">
              <div class="col-md-6">
                <h6>📋 Session Summary</h6>
                <ul class="list-unstyled">
                  <li><strong>💬 Conversations:</strong> {{selectedSessionDetails.summary.conversationCount}}</li>
                  <li><strong>⏱️ Time Spent:</strong> {{selectedSessionDetails.summary.timeSpentMinutes}} minutes</li>
                  <li><strong>📚 Vocabulary Used:</strong> {{selectedSessionDetails.summary.vocabularyUsed.join(', ') || 'None'}}</li>
                  <li><strong>🎯 Total Score:</strong> {{selectedSessionDetails.summary.totalScore}}</li>
                  <li><strong>✅ Accuracy:</strong> {{selectedSessionDetails.summary.accuracy}}%</li>
                </ul>
              </div>
              <div class="col-md-6">
                <h6>📈 Performance Metrics</h6>
                <ul class="list-unstyled">
                  <li><strong>Exercise Score:</strong> {{selectedSessionDetails.summary.exerciseScore}}</li>
                  <li><strong>Conversation Score:</strong> {{selectedSessionDetails.summary.conversationScore}}</li>
                  <li><strong>Correct Answers:</strong> {{selectedSessionDetails.summary.correctAnswers}}</li>
                  <li><strong>Incorrect Answers:</strong> {{selectedSessionDetails.summary.incorrectAnswers}}</li>
                </ul>
              </div>
            </div>

            <!-- Conversation History -->
            <div class="mb-4">
              <h6>💬 Conversation History</h6>
              <div class="conversation-container" style="max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 15px; border-radius: 5px;">
                <div *ngFor="let message of selectedSessionDetails.messages" 
                     class="message mb-2 p-2 rounded"
                     [class.bg-light]="message.role === 'tutor'"
                     [class.bg-primary]="message.role === 'student'"
                     [class.text-white]="message.role === 'student'">
                  <div class="d-flex justify-content-between align-items-start">
                    <div>
                      <strong>{{message.role === 'student' ? '👤 Student' : '🤖 AI Tutor'}}:</strong>
                      <p class="mb-1">{{message.content}}</p>
                    </div>
                    <small class="text-muted">{{formatTime(message.timestamp)}}</small>
                  </div>
                </div>
              </div>
            </div>

            <!-- Teacher Review Section -->
            <div class="mb-3">
              <h6>📝 Teacher Review</h6>
              <div *ngIf="selectedSessionDetails.teacherReviewed; else noReview">
                <div class="alert alert-success">
                  <strong>Reviewed on:</strong> {{formatDate(selectedSessionDetails.reviewedAt!)}}
                  <br>
                  <strong>Notes:</strong> {{selectedSessionDetails.teacherNotes || 'No notes provided'}}
                </div>
              </div>
              <ng-template #noReview>
                <div class="alert alert-warning">
                  <strong>Not yet reviewed</strong>
                  <br>
                  <textarea class="form-control mt-2" 
                            [(ngModel)]="reviewNotes" 
                            placeholder="Add your review notes here..."
                            rows="3"></textarea>
                  <button class="btn btn-success btn-sm mt-2" 
                          (click)="submitReview(selectedSessionDetails.sessionId)">
                    <i class="fas fa-check"></i> Submit Review
                  </button>
                </div>
              </ng-template>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .stat-card {
      transition: transform 0.2s;
    }
    .stat-card:hover {
      transform: translateY(-2px);
    }
    .conversation-container {
      background-color: #f8f9fa;
    }
    .message {
      animation: fadeIn 0.3s ease-in;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .table-hover tbody tr:hover {
      background-color: rgba(0,123,255,.075);
    }
  `]
})
export class SessionRecordsComponent implements OnInit {
  sessionRecords: SessionRecord[] = [];
  selectedSessionDetails: SessionDetails | null = null;
  availableModules: any[] = [];
  selectedModule: string = '';
  currentPage: number = 1;
  pagination: any = null;
  stats: any = null;
  reviewNotes: string = '';
  isLoading: boolean = false;

  constructor(private http: HttpClient, private notify: NotificationService) {}

  ngOnInit(): void {
    this.loadAvailableModules();
    this.loadSessionRecords();
    this.loadStats();
  }

  loadAvailableModules(): void {
    this.http.get(`${environment.apiUrl}/learning-modules`, { withCredentials: true })
      .subscribe({
        next: (response: any) => {
          this.availableModules = response.modules || [];
        },
        error: (error) => {
          console.error('Error loading modules:', error);
        }
      });
  }

  loadSessionRecords(): void {
    this.isLoading = true;
    const params: any = {
      page: this.currentPage,
      limit: 10
    };
    
    if (this.selectedModule) {
      params.moduleId = this.selectedModule;
    }

    this.http.get(`${environment.apiUrl}/session-records/module/${this.selectedModule || 'all'}`, {
      params,
      withCredentials: true
    }).subscribe({
      next: (response: any) => {
        this.sessionRecords = response.sessionRecords || [];
        this.pagination = response.pagination;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading session records:', error);
        this.isLoading = false;
      }
    });
  }

  loadStats(): void {
    const params: any = {};
    if (this.selectedModule) {
      params.moduleId = this.selectedModule;
    }

    this.http.get(`${environment.apiUrl}/session-records/stats/overview`, {
      params,
      withCredentials: true
    }).subscribe({
      next: (response: any) => {
        this.stats = response.stats;
      },
      error: (error) => {
        console.error('Error loading stats:', error);
      }
    });
  }

  viewSessionDetails(sessionId: string): void {
    this.http.get(`${environment.apiUrl}/session-records/${sessionId}/details`, {
      withCredentials: true
    }).subscribe({
      next: (response: any) => {
        this.selectedSessionDetails = response.sessionRecord;
        // Open modal (you might need to use Bootstrap JS or Angular Material)
        const modal = new (window as any).bootstrap.Modal(document.getElementById('sessionDetailsModal'));
        modal.show();
      },
      error: (error) => {
        console.error('Error loading session details:', error);
      }
    });
  }

  addReview(sessionId: string): void {
    this.viewSessionDetails(sessionId);
  }

  submitReview(sessionId: string): void {
    if (!this.reviewNotes.trim()) {
      this.notify.warning('Please enter review notes');
      return;
    }

    this.http.put(`${environment.apiUrl}/session-records/${sessionId}/review`, {
      teacherNotes: this.reviewNotes
    }, { withCredentials: true }).subscribe({
      next: (response: any) => {
        this.notify.success('Review submitted successfully!');
        this.reviewNotes = '';
        this.loadSessionRecords();
        const modal = (window as any).bootstrap.Modal.getInstance(document.getElementById('sessionDetailsModal'));
        modal?.hide();
      },
      error: (error) => {
        console.error('Error submitting review:', error);
        this.notify.error('Error submitting review. Please try again.');
      }
    });
  }

  changePage(page: number): void {
    if (page >= 1 && page <= this.pagination.totalPages) {
      this.currentPage = page;
      this.loadSessionRecords();
    }
  }

  getSessionStateLabel(state: string): string {
    switch (state) {
      case 'completed': return '✅ Completed';
      case 'manually_ended': return '⚠️ Stopped Early';
      case 'abandoned': return '❌ Abandoned';
      case 'active': return '🔄 In Progress';
      default: return state;
    }
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString() + ' ' + new Date(date).toLocaleTimeString();
  }

  formatTime(time: Date | string): string {
    return new Date(time).toLocaleTimeString();
  }
}