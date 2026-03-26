// src/app/services/student-progress.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface StudentProgress {
  _id: string;
  studentId: string;
  moduleId: any;
  status: 'not-started' | 'in-progress' | 'completed' | 'paused';
  progressPercentage: number;
  totalScore: number;
  maxPossibleScore: number;
  currentStreak: number;
  bestStreak: number;
  timeSpent: number;
  sessionsCount: number;
  lastSessionDate: Date;
  exercisesCompleted: Array<{
    exerciseIndex: number;
    attempts: number;
    bestScore: number;
    lastAttemptDate: Date;
    isCompleted: boolean;
  }>;
  objectivesCompleted: Array<{
    objectiveIndex: number;
    completedAt: Date;
    masteryLevel: 'basic' | 'intermediate' | 'advanced';
  }>;
  aiInteractions: Array<{
    sessionId: string;
    messageCount: number;
    topicsDiscussed: string[];
    sessionDate: Date;
    sessionDuration: number;
  }>;
  teacherFeedback: Array<{
    feedback: string;
    rating: number;
    providedBy: any;
    providedAt: Date;
  }>;
  studentNotes: string;
  startedAt: Date;
  completedAt?: Date;
  lastAccessedAt: Date;
  recentSessions?: any[];
}

export interface ProgressStats {
  totalModules: number;
  completedModules: number;
  inProgressModules: number;
  totalTimeSpent: number;
  averageScore: number;
  totalSessions: number;
}

export interface DashboardAnalytics {
  overview: ProgressStats;
  progressByLevel: { [key: string]: { total: number; completed: number } };
  progressByCategory: { [key: string]: { total: number; completed: number } };
  weeklyActivity: { [key: string]: { sessions: number; timeSpent: number } };
  recentSessions: Array<{
    moduleTitle: string;
    sessionType: string;
    duration: number;
    score: number;
    date: Date;
  }>;
  streakData: {
    currentStreak: number;
    bestStreak: number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class StudentProgressService {
  private apiUrl = `${environment.apiUrl}/student-progress`;

  constructor(private http: HttpClient) {}

  // Get student's progress across all modules
  getProgress(filters?: { status?: string; level?: string; category?: string }): Observable<{ progress: StudentProgress[]; stats: ProgressStats }> {
    let params = new HttpParams();
    
    if (filters) {
      Object.keys(filters).forEach(key => {
        const value = filters[key as keyof typeof filters];
        if (value) {
          params = params.set(key, value);
        }
      });
    }

    return this.http.get<{ progress: StudentProgress[]; stats: ProgressStats }>(`${this.apiUrl}`, {
      params,
      withCredentials: true
    });
  }

  // Get progress for specific module
  getModuleProgress(moduleId: string): Observable<StudentProgress> {
    return this.http.get<StudentProgress>(`${this.apiUrl}/${moduleId}`, {
      withCredentials: true
    });
  }

  // Update exercise completion
  updateExerciseProgress(moduleId: string, exerciseData: {
    exerciseIndex: number;
    score?: number;
    isCompleted: boolean;
  }): Observable<any> {
    return this.http.put(`${this.apiUrl}/${moduleId}/exercise`, exerciseData, {
      withCredentials: true
    });
  }

  // Update student notes
  updateNotes(moduleId: string, notes: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/${moduleId}/notes`, { notes }, {
      withCredentials: true
    });
  }

  // Get dashboard analytics
  getDashboardAnalytics(): Observable<DashboardAnalytics> {
    return this.http.get<DashboardAnalytics>(`${this.apiUrl}/analytics/dashboard`, {
      withCredentials: true
    });
  }

  // Get student progress for teachers
  getStudentProgressForTeacher(studentId: string): Observable<{ progress: StudentProgress[]; recentSessions: any[] }> {
    return this.http.get<{ progress: StudentProgress[]; recentSessions: any[] }>(`${this.apiUrl}/teacher/${studentId}`, {
      withCredentials: true
    });
  }

  // Add teacher feedback
  addTeacherFeedback(moduleId: string, feedbackData: {
    studentId: string;
    feedback: string;
    rating: number;
  }): Observable<any> {
    return this.http.post(`${this.apiUrl}/${moduleId}/feedback`, feedbackData, {
      withCredentials: true
    });
  }

  // Helper methods for progress calculations
  calculateCompletionPercentage(completed: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'completed': return 'success';
      case 'in-progress': return 'primary';
      case 'paused': return 'warning';
      case 'not-started': return 'secondary';
      default: return 'secondary';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'completed': return 'check-circle';
      case 'in-progress': return 'play-circle';
      case 'paused': return 'pause-circle';
      case 'not-started': return 'circle';
      default: return 'circle';
    }
  }

  formatTimeSpent(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} min`;
    } else if (minutes < 1440) { // Less than 24 hours
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    } else {
      const days = Math.floor(minutes / 1440);
      const remainingHours = Math.floor((minutes % 1440) / 60);
      return `${days}d ${remainingHours}h`;
    }
  }

  getMasteryLevelColor(level: string): string {
    switch (level) {
      case 'advanced': return 'success';
      case 'intermediate': return 'warning';
      case 'basic': return 'info';
      default: return 'secondary';
    }
  }

  // Calculate learning velocity (modules completed per week)
  calculateLearningVelocity(progress: StudentProgress[]): number {
    const completedModules = progress.filter(p => p.status === 'completed');
    if (completedModules.length === 0) return 0;

    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const recentCompletions = completedModules.filter(p => 
      p.completedAt && new Date(p.completedAt) >= oneWeekAgo
    );

    return recentCompletions.length;
  }

  // Get recommended next modules based on progress
  getRecommendedModules(progress: StudentProgress[]): string[] {
    // Simple recommendation logic - can be enhanced with ML
    const completedLevels = progress
      .filter(p => p.status === 'completed')
      .map(p => p.moduleId.level);

    const uniqueLevels = [...new Set(completedLevels)];
    
    // Recommend next level if current level is mostly completed
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const recommendations: string[] = [];

    uniqueLevels.forEach(level => {
      const currentLevelIndex = levels.indexOf(level);
      if (currentLevelIndex < levels.length - 1) {
        recommendations.push(levels[currentLevelIndex + 1]);
      }
    });

    return recommendations;
  }

  // Get student's level progression through German language levels
  getStudentLevelProgression(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/level-progression`, {
      withCredentials: true
    });
  }

  // Get full student journey data for progress page
  getStudentJourney(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/journey`, {
      withCredentials: true
    });
  }
}