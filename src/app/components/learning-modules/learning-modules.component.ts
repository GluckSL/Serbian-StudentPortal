// src/app/components/learning-modules/learning-modules.component.ts

import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { LearningModulesService, LearningModule, ModuleFilters } from '../../services/learning-modules.service';
import { AuthService } from '../../services/auth.service';
import { SubscriptionGuardService, SubscriptionStatus } from '../../services/subscription-guard.service';
import { LevelAccessService } from '../../services/level-access.service';
import { StudentProgressService } from '../../services/student-progress.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-learning-modules',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './learning-modules.component.html',
  styleUrls: ['./learning-modules.component.css']
})
export class LearningModulesComponent implements OnInit {
  /** When true with a student user, trims the top header (e.g. inside My Course). */
  @Input() embedded = false;

  modules: LearningModule[] = [];
  filteredModules: LearningModule[] = [];
  isLoading: boolean = false;
  currentUser: any = null;
  studentJourneyDay = 1;
  
  // Filters
  filters: ModuleFilters = {
    level: '',
    category: '',
    difficulty: '',
    targetLanguage: '',
    nativeLanguage: '',
    search: '',
    page: 1,
    limit: 12
  };
  
  // Pagination
  pagination = {
    current: 1,
    pages: 1,
    total: 0
  };
  
  // Filter options
  levels: string[] = [];
  categories: string[] = [];
  difficulties: string[] = [];
  targetLanguages: string[] = [];
  nativeLanguages: string[] = [];
  
  // View mode
  viewMode: 'grid' | 'list' = 'grid';
  
  constructor(
    private learningModulesService: LearningModulesService,
    private authService: AuthService,
    private subscriptionGuard: SubscriptionGuardService,
    public levelAccessService: LevelAccessService, // Make public for template access
    private studentProgressService: StudentProgressService,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.initializeFilterOptions();
    
    // Load user first, then load modules
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.studentJourneyDay = this.getFallbackJourneyDayFromUser(user);
      console.log('👤 Current user loaded:', user);
      
      // Only load modules after user is loaded
      if (user) {
        if (user.role === 'STUDENT') {
          this.loadStudentJourneyDay();
        }
        this.loadModules();
      }
    });
    
    // Refresh modules when user returns from AI tutor
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // Page became visible again, refresh modules to show updated status
        console.log('🔄 Page visible again, refreshing modules...');
        this.loadModules();
      }
    });
  }

  initializeFilterOptions(): void {
    this.levels = this.learningModulesService.getAvailableLevels();
    this.categories = this.learningModulesService.getAvailableCategories();
    this.difficulties = this.learningModulesService.getAvailableDifficulties();
    this.targetLanguages = this.learningModulesService.getAvailableLanguages();
    this.nativeLanguages = this.learningModulesService.getAvailableNativeLanguages();
  }

  loadModules(): void {
    this.isLoading = true;
    
    console.log('📚 loadModules() called');
    console.log('👤 Current user:', this.currentUser);
    console.log('📖 User level:', this.currentUser?.level);
    console.log('🎭 User role:', this.currentUser?.role);
    
    // For students, use level-based access control
    if (this.currentUser?.role === 'STUDENT') {
      console.log(`🔒 Loading accessible modules for ${this.currentUser.level} level student`);
      
      this.learningModulesService.getAccessibleModules(this.currentUser.level, this.filters).subscribe({
        next: (response) => {
          const modules = this.filterByJourneyDay(response.modules || []);
          this.modules = modules;
          this.filteredModules = modules;
          this.pagination = {
            ...response.pagination,
            total: modules.length
          };
          this.isLoading = false;
          
          console.log(`✅ Loaded ${response.modules.length} accessible modules`);
          console.log('📊 Modules:', response.modules.map((m: LearningModule) => ({ title: m.title, level: m.level })));
        },
        error: (error) => {
          console.error('❌ Error loading accessible modules:', error);
          this.isLoading = false;
          alert('Failed to load learning modules');
        }
      });
    } else {
      // For teachers and admins, load all modules
      this.learningModulesService.getModules(this.filters).subscribe({
        next: (response) => {
          this.modules = response.modules;
          this.filteredModules = response.modules;
          this.pagination = response.pagination;
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error loading modules:', error);
          this.isLoading = false;
          alert('Failed to load learning modules');
        }
      });
    }
  }

  applyFilters(): void {
    this.filters.page = 1; // Reset to first page
    this.loadModules();
  }

  clearFilters(): void {
    this.filters = {
      level: '',
      category: '',
      difficulty: '',
      targetLanguage: '',
      nativeLanguage: '',
      search: '',
      page: 1,
      limit: 12
    };
    this.loadModules();
  }

  onPageChange(page: number): void {
    this.filters.page = page;
    this.loadModules();
  }

  enrollInModule(module: LearningModule): void {
    if (!module._id) return;
    
    this.learningModulesService.enrollInModule(module._id).subscribe({
      next: (response) => {
        alert('Successfully enrolled in module!');
        // Reload modules to update enrollment status
        this.loadModules();
      },
      error: (error) => {
        console.error('Error enrolling in module:', error);
        if (error.status === 400) {
          alert('You are already enrolled in this module');
        } else {
          alert('Failed to enroll in module');
        }
      }
    });
  }

  startTutoring(module: LearningModule, sessionType: string = 'practice'): void {
    if (!module._id) return;

    const doNavigate = () => {
      this.router.navigate(['/ai-tutor-chat'], {
        queryParams: {
          moduleId: module._id,
          sessionType: sessionType,
          returnUrl: this.router.url
        }
      });
    };

    // Check if user has PLATINUM subscription for AI tutoring
    this.subscriptionGuard.checkPlatinumAccess().subscribe((status: SubscriptionStatus) => {
      if (status.hasAccess) {
        // Auto-enroll if needed, then navigate immediately
        if (!module.studentProgress) {
          this.learningModulesService.enrollInModule(module._id!).subscribe({
            next: () => doNavigate(),
            error: (err) => {
              console.error('Auto-enroll failed:', err);
              doNavigate(); // Try anyway — backend will enroll on session start
            }
          });
        } else {
          doNavigate();
        }
      } else {
        // User doesn't have PLATINUM access, show upgrade message
        this.showSubscriptionUpgradeDialog(status);
      }
    });
  }

  private showSubscriptionUpgradeDialog(status: SubscriptionStatus): void {
    const upgradeMessage = `🤖 AI Tutoring - Premium Feature\n\n` +
      `${status.message}\n\n` +
      `AI Tutoring Features:\n` +
      `• Voice conversation with AI tutor\n` +
      `• Real-time dialogue bubbles\n` +
      `• Personalized learning experience\n` +
      `• Role-play scenarios\n` +
      `• Engagement scoring\n\n` +
      `Current: ${status.currentSubscription || 'No subscription'}\n` +
      `Required: ${status.requiredSubscription}\n\n` +
      `Would you like to request an upgrade to PLATINUM?\n` +
      `Our sales team will contact you within 24 hours.`;

    if (confirm(upgradeMessage)) {
      // Send upgrade request email to sales team
      this.requestUpgrade();
    }
  }

  // Request subscription upgrade
  private requestUpgrade(): void {
    this.http.post(`${environment.apiUrl}/upgrade-requests/request-upgrade`, {
      phone: this.currentUser?.phone || 'Not provided',
      message: 'Student requested PLATINUM upgrade for AI Tutoring access'
    }, { withCredentials: true }).subscribe({
      next: (response: any) => {
        alert(`✅ Upgrade Request Submitted!\n\n${response.message}\n\nOur sales team will contact you soon to discuss pricing and payment options.`);
      },
      error: (error: any) => {
        console.error('Error submitting upgrade request:', error);
        alert('❌ Failed to submit upgrade request. Please contact support directly.');
      }
    });
  }

  // Check if user can access AI tutoring
  canAccessAiTutoring(): boolean {
    return this.subscriptionGuard.isPlatinum() || this.currentUser?.role !== 'STUDENT';
  }

  // Get subscription badge text
  getSubscriptionBadge(): string {
    const subscription = this.subscriptionGuard.getCurrentSubscription();
    return subscription || 'No Subscription';
  }

  // Check if user is student
  isStudent(): boolean {
    return this.currentUser?.role === 'STUDENT';
  }

  viewModuleDetails(module: LearningModule): void {
    if (!module._id) return;
    
    // Determine module type
    const moduleType = module.content.rolePlayScenario ? '🎭 Role-Play' : '📚 Practice';
    const minTime = module.minimumCompletionTime || 15;
    
    // Build role-play specific details
    let rolePlayInfo = '';
    if (module.content.rolePlayScenario) {
      const scenario = module.content.rolePlayScenario;
      rolePlayInfo = `\n\n🎭 Role-Play Details:
• Situation: ${scenario.situation || 'N/A'}
• Student Role: ${scenario.studentRole || 'N/A'}
• AI Role: ${scenario.aiRole || 'N/A'}
• Setting: ${scenario.setting || 'N/A'}`;
    }
    
    alert(`📋 Module Details

Title: ${module.title}
Type: ${moduleType}
Level: ${module.level}
Category: ${module.category}
Difficulty: ${module.difficulty}
⏱️ Minimum Time: ${minTime} minutes

Description: ${module.description}${rolePlayInfo}

Languages:
• Target: ${module.targetLanguage || 'N/A'}
• Native: ${module.nativeLanguage || 'N/A'}

📊 Estimated Duration: ${module.estimatedDuration || 30} minutes
✅ Completion Requirement: Complete objectives AND spend at least ${minTime} minutes`);
  }

  getProgressPercentage(module: LearningModule): number {
    return module.studentProgress?.progressPercentage || 0;
  }

  getProgressColor(percentage: number): string {
    if (percentage >= 80) return 'success';
    if (percentage >= 60) return 'info';
    if (percentage >= 40) return 'warning';
    return 'danger';
  }

  getStatusBadgeClass(module: LearningModule): string {
    if (!module.studentProgress) return 'badge-secondary';
    
    switch (module.studentProgress.status) {
      case 'completed': return 'badge-success';
      case 'in-progress': return 'badge-primary';
      case 'paused': return 'badge-warning';
      default: return 'badge-secondary';
    }
  }

  getStatusText(module: LearningModule): string {
    if (!module.studentProgress) return 'Not Enrolled';
    
    switch (module.studentProgress.status) {
      case 'completed': return 'Completed';
      case 'in-progress': return 'In Progress';
      case 'paused': return 'Paused';
      default: return 'Not Started';
    }
  }



  getCategoryIcon(category: string): string {
    switch (category) {
      case 'Grammar': return '📚';
      case 'Vocabulary': return '📝';
      case 'Conversation': return '💬';
      case 'Reading': return '📖';
      case 'Writing': return '✍️';
      case 'Listening': return '👂';
      default: return '📋';
    }
  }

  formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} min`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    }
  }

  canEnroll(module: LearningModule): boolean {
    return this.currentUser?.role === 'STUDENT' && !module.studentProgress;
  }

  canStartTutoring(module: LearningModule): boolean {
    // Allow unenrolled modules too — startTutoring() auto-enrolls before navigating
    return this.currentUser?.role === 'STUDENT' &&
           module.studentProgress?.status !== 'completed';
  }

  isTeacherOrAdmin(): boolean {
    return this.currentUser?.role === 'TEACHER' || this.currentUser?.role === 'ADMIN';
  }

  createNewModule(): void {
    this.router.navigate(['/module-creation-choice']);
  }

  testAudio(): void {
    this.router.navigate(['/audio-test']);
  }

  editModule(module: LearningModule): void {
    if (!module._id) return;
    this.router.navigate(['/edit-module', module._id]);
  }

  testModule(module: LearningModule): void {
    if (!module._id) return;
    
    // Debug logging
    console.log('🔍 Testing module:', { 
      id: module._id, 
      title: module.title,
      idType: typeof module._id,
      idLength: module._id?.toString().length 
    });
    
    // Show confirmation dialog
    const confirmTest = confirm(
      `🧪 Test Module: "${module.title}"\n\n` +
      `Module ID: ${module._id}\n\n` +
      `This will start the AI tutoring session for this module, allowing you to experience it as a student would.\n\n` +
      `Continue with testing?`
    );
    
    if (confirmTest) {
      console.log('🚀 Navigating to AI tutor with params:', {
        moduleId: module._id,
        sessionType: 'teacher-test',
        testMode: 'true'
      });
      
      // Navigate to AI tutor with test mode
      this.router.navigate(['/ai-tutor-chat'], {
        queryParams: {
          moduleId: module._id,
          sessionType: 'teacher-test',
          testMode: 'true'
        }
      });
    }
  }

  deleteModule(module: LearningModule): void {
    if (!module._id) return;
    
    // Show confirmation dialog
    const confirmDelete = confirm(
      `🗑️ Delete Module: "${module.title}"\n\n` +
      `Are you sure you want to delete this module?\n\n` +
      `This action cannot be undone. The module will be permanently removed from the system.\n\n` +
      `Click OK to confirm deletion.`
    );
    
    if (confirmDelete) {
      console.log('🗑️ Deleting module:', { 
        id: module._id, 
        title: module.title 
      });
      
      this.learningModulesService.deleteModule(module._id).subscribe({
        next: (response) => {
          console.log('✅ Module deleted successfully:', response);
          
          // Show success message
          alert(`✅ Module "${module.title}" has been deleted successfully.`);
          
          // Refresh the modules list
          this.loadModules();
        },
        error: (error) => {
          console.error('❌ Error deleting module:', error);
          
          let errorMessage = 'Failed to delete module.';
          if (error.status === 403) {
            errorMessage = 'You can only delete modules you created.';
          } else if (error.status === 404) {
            errorMessage = 'Module not found.';
          } else if (error.error?.message) {
            errorMessage = error.error.message;
          }
          
          alert(`❌ Error: ${errorMessage}`);
        }
      });
    }
  }

  // ✅ NEW: Toggle module visibility for students
  toggleVisibility(module: LearningModule): void {
    if (!module._id) return;
    
    const newVisibility = !module.visibleToStudents;
    const action = newVisibility ? 'publish to' : 'hide from';
    
    const confirmToggle = confirm(
      `${newVisibility ? '👁️ Publish' : '🔒 Hide'} Module: "${module.title}"\n\n` +
      `Are you sure you want to ${action} students?\n\n` +
      `${newVisibility ? 'Students will be able to see and access this module.' : 'Students will no longer see this module in their list.'}\n\n` +
      `Click OK to confirm.`
    );
    
    if (confirmToggle) {
      console.log('🔄 Toggling visibility:', { 
        id: module._id, 
        title: module.title,
        newVisibility 
      });
      
      this.learningModulesService.toggleModuleVisibility(module._id, newVisibility).subscribe({
        next: (response) => {
          console.log('✅ Visibility updated:', response);
          
          // Update the module in the list
          module.visibleToStudents = newVisibility;
          if (newVisibility && response.module?.publishedAt) {
            module.publishedAt = response.module.publishedAt;
          }
          
          // Show success message
          alert(`✅ Module "${module.title}" is now ${newVisibility ? 'visible to' : 'hidden from'} students.`);
        },
        error: (error) => {
          console.error('❌ Error toggling visibility:', error);
          
          let errorMessage = 'Failed to update module visibility.';
          if (error.status === 403) {
            errorMessage = 'You can only modify modules you created.';
          } else if (error.error?.message) {
            errorMessage = error.error.message;
          }
          
          alert(`❌ Error: ${errorMessage}`);
        }
      });
    }
  }

  canDeleteModule(module: LearningModule): boolean {
    if (!this.currentUser) return false;
    
    // Admins can delete any module
    if (this.currentUser.role === 'ADMIN') return true;
    
    // Teachers can delete modules they created
    if (this.currentUser.role === 'TEACHER') {
      // Check if the current user created this module
      return module.createdBy === this.currentUser.id || 
             module.createdBy?.toString() === this.currentUser.id?.toString();
    }
    
    // Students cannot delete modules
    return false;
  }

  getPaginationArray(): number[] {
    const pages = [];
    const start = Math.max(1, this.pagination.current - 2);
    const end = Math.min(this.pagination.pages, this.pagination.current + 2);
    
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    
    return pages;
  }

  // ===== LEVEL-BASED ACCESS CONTROL METHODS =====

  // Check if student can access a module
  canAccessModule(module: LearningModule): boolean {
    if (!this.currentUser || this.currentUser.role !== 'STUDENT') {
      return true; // Teachers and admins can access all modules
    }
    
    const canAccessByLevel = this.levelAccessService.canAccessModule(this.currentUser.level, module.level);
    const canAccessByJourneyDay = this.canAccessModuleByJourneyDay(module);
    const canAccess = canAccessByLevel && canAccessByJourneyDay;
    
    // Debug logging
    if (!canAccess) {
      console.log(`🔒 Access denied for module "${module.title}":`, {
        studentLevel: this.currentUser.level,
        moduleLevel: module.level,
        studentName: this.currentUser.name
      });
    }
    
    return canAccess;
  }

  // Get access status for a module
  getModuleAccessStatus(module: LearningModule) {
    if (!this.currentUser || this.currentUser.role !== 'STUDENT') {
      return { canAccess: true, reason: 'Full access', levelDifference: 0 };
    }

    if (!this.canAccessModuleByJourneyDay(module)) {
      return {
        canAccess: false,
        reason: `Unlocks on journey day ${module.courseDay}`,
        levelDifference: 0
      };
    }

    return this.levelAccessService.getModuleAccessStatus(this.currentUser.level, module.level);
  }

  // Get level color for display
  getLevelColor(levelCode: string): string {
    return this.levelAccessService.getLevelColor(levelCode);
  }

  // Format level for display
  formatLevel(levelCode: string): string {
    return this.levelAccessService.formatLevel(levelCode);
  }

  // Get access icon
  getAccessIcon(canAccess: boolean): string {
    return this.levelAccessService.getAccessIcon(canAccess);
  }

  // Get student's current level info
  getCurrentLevelInfo() {
    if (!this.currentUser || this.currentUser.role !== 'STUDENT') {
      return null;
    }
    
    return this.levelAccessService.getLevelInfo(this.currentUser.level);
  }

  // Get level progression for student
  getLevelProgression() {
    if (!this.currentUser || this.currentUser.role !== 'STUDENT') {
      return null;
    }
    
    return this.levelAccessService.getLevelProgression(this.currentUser.level);
  }

  // Check if module is recommended for student
  isRecommendedModule(module: LearningModule): boolean {
    if (!this.currentUser || this.currentUser.role !== 'STUDENT') {
      return false;
    }
    
    const recommendedLevels = this.levelAccessService.getRecommendedLevels(this.currentUser.level);
    return recommendedLevels.includes(module.level);
  }

  // Load only recommended modules
  loadRecommendedModules(): void {
    if (!this.currentUser || this.currentUser.role !== 'STUDENT') {
      return;
    }
    
    this.isLoading = true;
    this.learningModulesService.getRecommendedModules(this.currentUser.level, this.filters).subscribe({
      next: (response) => {
        const modules = this.filterByJourneyDay(response.modules || []);
        this.modules = modules;
        this.filteredModules = modules;
        this.pagination = {
          ...response.pagination,
          total: modules.length
        };
        this.isLoading = false;
        
        console.log(`⭐ Loaded ${response.modules.length} recommended modules for ${this.currentUser.level} level student`);
      },
      error: (error) => {
        console.error('Error loading recommended modules:', error);
        this.isLoading = false;
      }
    });
  }

  private loadStudentJourneyDay(): void {
    this.studentProgressService.getStudentJourney().subscribe({
      next: (journey) => {
        const fromJourney = Number(journey?.profile?.currentCourseDay);
        if (Number.isFinite(fromJourney) && fromJourney > 0) {
          this.studentJourneyDay = Math.floor(fromJourney);
        }
      },
      error: () => {
        // Keep fallback from current user snapshot.
      }
    });
  }

  private filterByJourneyDay(modules: LearningModule[]): LearningModule[] {
    if (!this.currentUser || this.currentUser.role !== 'STUDENT') {
      return modules;
    }
    return modules.filter((m) => this.canAccessModuleByJourneyDay(m));
  }

  private canAccessModuleByJourneyDay(module: LearningModule): boolean {
    if (!this.currentUser || this.currentUser.role !== 'STUDENT') {
      return true;
    }
    const moduleDay = module?.courseDay;
    if (moduleDay == null) return false;
    return Number(moduleDay) <= this.studentJourneyDay;
  }

  private getFallbackJourneyDayFromUser(user: any): number {
    const day = Number(user?.currentCourseDay ?? user?.profile?.currentCourseDay);
    if (!Number.isFinite(day) || day < 1) return 1;
    return Math.floor(day);
  }
}