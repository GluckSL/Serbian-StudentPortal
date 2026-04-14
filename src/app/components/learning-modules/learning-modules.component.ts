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
import { NotificationService } from '../../services/notification.service';
import { NavService } from '../../shared/services/nav.service';

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
    limit: 80
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
    public levelAccessService: LevelAccessService,
    private studentProgressService: StudentProgressService,
    private router: Router,
    private http: HttpClient,
    private notify: NotificationService,
    private navService: NavService
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
          this.notify.error('Failed to load learning modules');
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
          this.notify.error('Failed to load learning modules');
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
      limit: 80
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
        this.notify.success('Successfully enrolled in module!');
        this.loadModules();
      },
      error: (error) => {
        console.error('Error enrolling in module:', error);
        if (error.status === 400) {
          this.notify.info('You are already enrolled in this module');
        } else {
          this.notify.error('Failed to enroll in module');
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

    this.notify.confirm('Upgrade to PLATINUM', status.message + '\n\nWould you like to request an upgrade? Our sales team will contact you within 24 hours.', 'Request Upgrade', 'Cancel').subscribe(ok => {
      if (ok) this.requestUpgrade();
    });
  }

  // Request subscription upgrade
  private requestUpgrade(): void {
    this.http.post(`${environment.apiUrl}/upgrade-requests/request-upgrade`, {
      phone: this.currentUser?.phone || 'Not provided',
      message: 'Student requested PLATINUM upgrade for AI Tutoring access'
    }, { withCredentials: true }).subscribe({
      next: (response: any) => {
        this.notify.success('Upgrade request submitted! Our sales team will contact you soon.');
      },
      error: (error: any) => {
        console.error('Error submitting upgrade request:', error);
        this.notify.error('Failed to submit upgrade request. Please contact support directly.');
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
    
    const moduleType = module.content.rolePlayScenario ? 'Role-Play' : 'Practice';
    const minTime = module.minimumCompletionTime || 15;
    let rolePlayInfo = '';
    if (module.content.rolePlayScenario) {
      const s = module.content.rolePlayScenario;
      rolePlayInfo = `\nSituation: ${s.situation || 'N/A'} | Student: ${s.studentRole || 'N/A'} | AI: ${s.aiRole || 'N/A'}`;
    }
    
    this.notify.info(
      `${module.title} (${moduleType}, ${module.level})\n` +
      `Category: ${module.category} | Difficulty: ${module.difficulty}\n` +
      `Min time: ${minTime} min | Est. duration: ${module.estimatedDuration || 30} min\n` +
      `${module.description}${rolePlayInfo}`
    );
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
    const role = this.currentUser?.role;
    if (role === 'TEACHER' || role === 'ADMIN' || role === 'TEACHER_ADMIN') return true;
    if (role === 'SUB_ADMIN') return this.hasSubAdminPermission('modules');
    return false;
  }

  createNewModule(): void {
    if (!this.isTeacherOrAdmin()) {
      this.notify.error('You do not have permission to create modules.');
      return;
    }
    this.router.navigate(['/module-creation-choice']);
  }

  testAudio(): void {
    this.router.navigate(['/audio-test']);
  }

  editModule(module: LearningModule): void {
    if (!module._id) return;
    if (!this.isTeacherOrAdmin()) {
      this.notify.error('You do not have permission to edit modules.');
      return;
    }
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
    
    this.notify.confirm(
      'Test Module',
      `Test "${module.title}" as a student? This will start an AI tutoring session.`,
      'Start Test', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      this.router.navigate(['/ai-tutor-chat'], {
        queryParams: { moduleId: module._id, sessionType: 'teacher-test', testMode: 'true' }
      });
    });
  }

  deleteModule(module: LearningModule): void {
    const moduleId = module._id;
    if (!moduleId) return;
    if (!this.isTeacherOrAdmin()) {
      this.notify.error('You do not have permission to delete modules.');
      return;
    }

    this.notify.confirm(
      'Delete Module',
      `Delete "${module.title}"? This action cannot be undone.`,
      'Yes, Delete', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      this.learningModulesService.deleteModule(moduleId).subscribe({
        next: (response) => {
          this.notify.success(`Module "${module.title}" deleted successfully.`);
          this.loadModules();
        },
        error: (error) => {
          let errorMessage = 'Failed to delete module.';
          if (error.status === 403) errorMessage = 'You can only delete modules you created.';
          else if (error.status === 404) errorMessage = 'Module not found.';
          else if (error.error?.message) errorMessage = error.error.message;
          this.notify.error(errorMessage);
        }
      });
    });
  }

  // ✅ NEW: Toggle module visibility for students
  toggleVisibility(module: LearningModule): void {
    const moduleId = module._id;
    if (!moduleId) return;
    if (!this.isTeacherOrAdmin()) {
      this.notify.error('You do not have permission to change module visibility.');
      return;
    }

    const newVisibility = !module.visibleToStudents;

    this.notify.confirm(
      newVisibility ? 'Publish Module' : 'Hide Module',
      `${newVisibility ? 'Students will be able to see and access' : 'Students will no longer see'} "${module.title}". Continue?`,
      'Confirm', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      this.learningModulesService.toggleModuleVisibility(moduleId, newVisibility).subscribe({
        next: (response) => {
          module.visibleToStudents = newVisibility;
          if (newVisibility && response.module?.publishedAt) {
            module.publishedAt = response.module.publishedAt;
          }
          this.notify.success(`Module "${module.title}" is now ${newVisibility ? 'visible to' : 'hidden from'} students.`);
        },
        error: (error) => {
          let errorMessage = 'Failed to update module visibility.';
          if (error.status === 403) errorMessage = 'You can only modify modules you created.';
          else if (error.error?.message) errorMessage = error.error.message;
          this.notify.error(errorMessage);
        }
      });
    });
  }

  canDeleteModule(module: LearningModule): boolean {
    if (!this.currentUser) return false;
    
    // Admins can delete any module
    if (this.currentUser.role === 'ADMIN' || this.currentUser.role === 'TEACHER_ADMIN') return true;
    if (this.currentUser.role === 'SUB_ADMIN') return this.hasSubAdminPermission('modules');
    
    // Teachers can delete modules they created
    if (this.currentUser.role === 'TEACHER') {
      // Check if the current user created this module
      return module.createdBy === this.currentUser.id || 
             module.createdBy?.toString() === this.currentUser.id?.toString();
    }
    
    // Students cannot delete modules
    return false;
  }

  private hasSubAdminPermission(permissionId: string): boolean {
    if (this.currentUser?.role !== 'SUB_ADMIN') return false;
    const permissions = this.navService.normalizeSidebarPermissions(this.currentUser?.sidebarPermissions || []);
    return permissions.includes(permissionId);
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
    const canAccess = canAccessByLevel && !this.isJourneyDayLocked(module);
    
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

    if (this.isJourneyDayLocked(module)) {
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

  /** Keep modules visible for the current journey week (day … day+6); lock state is UI + server. */
  private filterByJourneyDay(modules: LearningModule[]): LearningModule[] {
    if (!this.currentUser || this.currentUser.role !== 'STUDENT') {
      return modules;
    }
    const maxDay = this.studentJourneyDay + 6;
    return modules.filter((m) => {
      const d = m.courseDay;
      if (d == null) return true;
      const day = Number(d);
      return Number.isFinite(day) && day <= maxDay;
    });
  }

  /** True when courseDay is set and still in the future relative to the student's journey day. */
  isJourneyDayLocked(module: LearningModule): boolean {
    if (!this.currentUser || this.currentUser.role !== 'STUDENT') {
      return false;
    }
    const moduleDay = module?.courseDay;
    if (moduleDay == null) return false;
    return Number(moduleDay) > this.studentJourneyDay;
  }

  /** Primary label when module is blocked for the student (journey vs level). */
  studentLockedModuleButtonLabel(module: LearningModule): string {
    if (this.isJourneyDayLocked(module) && module.courseDay != null) {
      return `Unlock on day ${module.courseDay}`;
    }
    return 'Locked';
  }

  private getFallbackJourneyDayFromUser(user: any): number {
    const day = Number(user?.currentCourseDay ?? user?.profile?.currentCourseDay);
    if (!Number.isFinite(day) || day < 1) return 1;
    return Math.floor(day);
  }
}