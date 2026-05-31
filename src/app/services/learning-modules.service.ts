// src/app/services/learning-modules.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { LevelAccessService } from './level-access.service';

export interface LearningModule {
  _id?: string;
  title: string;
  description: string;
  targetLanguage: 'English' | 'German';
  nativeLanguage: 'English' | 'Tamil' | 'Sinhala';
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  category: 'Grammar' | 'Vocabulary' | 'Conversation' | 'Reading' | 'Writing' | 'Listening';
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  estimatedDuration: number;
  minimumCompletionTime?: number; // ✅ NEW: Minimum time required to complete (5-60 min)
  learningObjectives: Array<{
    objective: string;
    description: string;
  }>;
  prerequisites: string[];
  content: {
    introduction: string;
    keyTopics: string[];
    examples: Array<{
      german: string;
      english: string;
      explanation: string;
    }>;
    exercises: Array<{
      type: 'multiple-choice' | 'fill-blank' | 'translation' | 'conversation' | 'essay' | 'role-play';
      question: string;
      options?: string[];
      correctAnswer: string;
      explanation: string;
      points: number;
    }>;
    // ✅ NEW: Role-play scenario (optional - only for role-play modules)
    rolePlayScenario?: {
      situation: string;
      studentRole: string;
      aiRole: string;
      setting?: string;
      objective?: string;
      aiPersonality?: string;
      studentGuidance?: string;
      aiOpeningLines?: string[];
      suggestedStudentResponses?: string[];
    };
    allowedVocabulary?: Array<{
      word: string;
      translation: string;
      category: string;
    }>;
    allowedGrammar?: Array<{
      structure: string;
      examples: string[];
      level: string;
    }>;
    conversationFlow?: Array<{
      stage: string;
      aiPrompts: string[];
      expectedResponses: string[];
      helpfulPhrases: string[];
    }>;
  };
  aiTutorConfig: {
    personality: string;
    focusAreas: string[];
    commonMistakes: string[];
    helpfulPhrases: string[];
    culturalNotes: string[];
    allowedVocabulary?: Array<{
      word: string;
      translation: string;
      category: string;
      usage?: string;
    }>;
    rolePlayInstructions?: {
      aiRole: string;
      aiPersonality: string;
      openingLines: string[];
      studentRole: string;
      studentGuidance: string;
      suggestedResponses: string[];
    };
  };
  createdBy: any;
  isActive: boolean;
  visibleToStudents?: boolean;  // ✅ Controls if students can see this module
  publishedAt?: Date;           // ✅ When module was made visible to students
  tags: string[];
  courseDay?: number | null;
  totalEnrollments: number;
  averageCompletionTime: number;
  averageScore: number;
  createdAt: Date;
  updatedAt: Date;
  studentProgress?: any;
}

export interface ModuleFilters {
  level?: string;
  category?: string;
  difficulty?: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  search?: string;
  page?: number;
  limit?: number;
  accessibleOnly?: boolean; // New: Filter only accessible modules for student
  studentLevel?: string;    // New: Student's current level for access control
}

@Injectable({
  providedIn: 'root'
})
export class LearningModulesService {
  private apiUrl = `${environment.apiUrl}/learning-modules`;

  constructor(
    private http: HttpClient,
    private levelAccessService: LevelAccessService
  ) {}

  // Get all modules with filtering
  getModules(filters: ModuleFilters = {}): Observable<any> {
    let params = new HttpParams();
    
    Object.keys(filters).forEach(key => {
      const value = filters[key as keyof ModuleFilters];
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, value.toString());
      }
    });

    return this.http.get<any>(`${this.apiUrl}`, { 
      params, 
      withCredentials: true 
    });
  }

  // Get specific module
  getModule(id: string): Observable<LearningModule> {
    return this.http.get<LearningModule>(`${this.apiUrl}/${id}`, { 
      withCredentials: true 
    });
  }

  // Create new module (Teachers/Admins only)
  createModule(module: Partial<LearningModule>): Observable<LearningModule> {
    return this.http.post<LearningModule>(`${this.apiUrl}`, module, { 
      withCredentials: true 
    });
  }

  // Update module (Teachers/Admins only)
  updateModule(id: string, module: Partial<LearningModule>): Observable<LearningModule> {
    return this.http.put<LearningModule>(`${this.apiUrl}/${id}`, module, { 
      withCredentials: true 
    });
  }

  // Delete module (Admins only)
  deleteModule(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`, { 
      withCredentials: true 
    });
  }

  // ✅ NEW: Toggle module visibility for students (Teachers/Admins only)
  toggleModuleVisibility(id: string, visibleToStudents: boolean): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/visibility`, 
      { visibleToStudents }, 
      { withCredentials: true }
    );
  }

  // Enroll student in module
  enrollInModule(moduleId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${moduleId}/enroll`, {}, { 
      withCredentials: true 
    });
  }

  // Get module statistics (Teachers/Admins)
  getModuleStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/stats/overview`, { 
      withCredentials: true 
    });
  }

  // Get all modules with management details (Admin only)
  getModulesForAdmin(filters: { page?: number; limit?: number; status?: string } = {}): Observable<any> {
    let params = new HttpParams();
    
    Object.keys(filters).forEach(key => {
      const value = filters[key as keyof typeof filters];
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, value.toString());
      }
    });

    return this.http.get<any>(`${this.apiUrl}/admin/management`, { 
      params, 
      withCredentials: true 
    });
  }

  // Get module update history (Admin only)
  getModuleHistory(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/${id}/history`, { 
      withCredentials: true 
    });
  }

  // Get available levels
  getAvailableLevels(): string[] {
    return ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  }

  // Get available categories
  getAvailableCategories(): string[] {
    return ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening'];
  }

  // Get available difficulties
  getAvailableDifficulties(): string[] {
    return ['Beginner', 'Intermediate', 'Advanced'];
  }

  // Get exercise types
  getExerciseTypes(): string[] {
    return ['multiple-choice', 'fill-blank', 'translation', 'conversation', 'essay', 'role-play'];
  }

  // Get available languages
  getAvailableLanguages(): string[] {
    return ['English', 'German'];
  }

  // Get available native languages
  getAvailableNativeLanguages(): string[] {
    return ['English', 'Tamil', 'Sinhala'];
  }

  // Mark module as completed
  markModuleCompleted(moduleId: string, sessionData?: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/${moduleId}/complete`, sessionData || {}, { 
      withCredentials: true 
    });
  }

  // Update module progress
  updateModuleProgress(moduleId: string, progressData: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/${moduleId}/progress`, progressData, { 
      withCredentials: true 
    });
  }

  // ===== LEVEL-BASED ACCESS CONTROL METHODS =====

  // Get modules accessible to a student based on their level
  getAccessibleModules(studentLevel: string, filters: ModuleFilters = {}): Observable<any> {
    // Add student level to filters for backend processing
    const accessFilters = {
      ...filters,
      studentLevel,
      accessibleOnly: true
    };

    return this.getModules(accessFilters).pipe(
      map(response => {
        // Add access information to each module
        if (response.modules) {
          response.modules = response.modules.map((module: LearningModule) => ({
            ...module,
            accessInfo: this.levelAccessService.getModuleAccessStatus(studentLevel, module.level)
          }));
        }
        return response;
      })
    );
  }

  // Check if student can access a specific module
  canStudentAccessModule(studentLevel: string, moduleLevel: string): boolean {
    return this.levelAccessService.canAccessModule(studentLevel, moduleLevel);
  }

  // Get module access status for display
  getModuleAccessStatus(studentLevel: string, moduleLevel: string) {
    return this.levelAccessService.getModuleAccessStatus(studentLevel, moduleLevel);
  }

  // Get accessible levels for a student
  getAccessibleLevels(studentLevel: string): string[] {
    return this.levelAccessService.getAccessibleLevels(studentLevel);
  }

  // Get recommended modules for a student
  getRecommendedModules(studentLevel: string, filters: ModuleFilters = {}): Observable<any> {
    const recommendedLevels = this.levelAccessService.getRecommendedLevels(studentLevel);
    
    // Filter by recommended levels
    const recommendedFilters = {
      ...filters,
      studentLevel,
      recommendedOnly: true
    };

    return this.getModules(recommendedFilters).pipe(
      map(response => {
        if (response.modules) {
          response.modules = response.modules
            .filter((module: LearningModule) => recommendedLevels.includes(module.level))
            .map((module: LearningModule) => ({
              ...module,
              accessInfo: this.levelAccessService.getModuleAccessStatus(studentLevel, module.level),
              isRecommended: true
            }));
        }
        return response;
      })
    );
  }

  // Get level progression information
  getLevelProgression(currentLevel: string) {
    return this.levelAccessService.getLevelProgression(currentLevel);
  }

  // Format level for display
  formatLevel(levelCode: string): string {
    return this.levelAccessService.formatLevel(levelCode);
  }

  // Get level color for UI
  getLevelColor(levelCode: string): string {
    return this.levelAccessService.getLevelColor(levelCode);
  }

  // Get access icon
  getAccessIcon(canAccess: boolean): string {
    return this.levelAccessService.getAccessIcon(canAccess);
  }
}