import { Component, OnInit, OnDestroy, Type } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { NavService, NavGroup, NavItem } from '../../shared/services/nav.service';
import { AuthService } from '../../services/auth.service';
import { Subscription, filter } from 'rxjs';
import { AdminHubOverviewComponent } from './admin-hub-overview.component';

interface HubCard {
  group: string;
  items: NavItem[];
  icon: string;
  gradient: string;
  accentColor: string;
  description: string;
}

// Maps nav-item route → lazy import of its component
const ROUTE_LOADER: Record<string, () => Promise<Type<any>>> = {
  '/admin/students':            () => import('../admin-dashboard/admin-dashboard.component').then(m => m.AdminDashboardComponent),
  '/teachers':                  () => import('../teachers/teachers.component').then(m => m.TeachersComponent),
  '/user-roles':                () => import('../admin-dashboard/user-roles.component').then(m => m.UserRolesComponent),
  '/account-audit-log':         () => import('../admin-dashboard/account-audit-log.component').then(m => m.AccountAuditLogComponent),
  '/time-table-view-admin':     () => import('../time-table/time-table-view.component').then(m => m.TimeTableViewComponent),
  '/teacher/meetings':          () => import('../meeting-link/meetings-list.component').then(m => m.MeetingsListComponent),
  '/gluck-room':                () => import('../gluck-room-list/gluck-room-list.component').then(m => m.GluckRoomListComponent),
  '/admin/zoom-reports':        () => import('../admin-dashboard/zoom-reports.component').then(m => m.ZoomReportsComponent),
  '/admin/attendance-dashboard': () => import('../admin-dashboard/attendance-dashboard.component').then(m => m.AttendanceDashboardComponent),
  '/admin/portal-join-alert': () => import('../admin-dashboard/portal-join-alert.component').then(m => m.PortalJoinAlertComponent),
  '/class-recordings':          () => import('../class-recordings/manage-recordings/manage-recordings.component').then(m => m.ManageRecordingsComponent),
  '/admin/dg-modules':          () => import('../../dg-bot/dg-admin-modules/dg-admin-modules.component').then(m => m.DgAdminModulesComponent),
  '/admin/sprechen-exam':       () => import('../../sprechen-exam/sprechen-admin-modules/sprechen-admin-modules.component').then(m => m.SprechenAdminModulesComponent),
  '/admin/digital-exercises':   () => import('../admin-dashboard/digital-exercise-management/digital-exercise-management.component').then(m => m.DigitalExerciseManagementComponent),
  '/admin/teacher-resources':   () => import('../admin-dashboard/teacher-resources-admin.component').then(m => m.TeacherResourcesAdminComponent),
  '/admin/correction':          () => import('../admin-dashboard/correction/correction.component').then(m => m.CorrectionComponent),
  '/admin/glueck-arena':        () => import('../../features/glueck-arena/components/admin/game-set-list/game-set-list.component').then(m => m.GameSetListComponent),
  '/portal-analytics':          () => import('../../pages/portal-analytics/portal-analytics.component').then(m => m.PortalAnalyticsComponent),
  '/admin/student-progress':    () => import('../admin-dashboard/admin-progress/admin-progress.component').then(m => m.AdminProgressComponent),
  '/admin/performance':         () => import('../admin-dashboard/admin-performance/admin-performance.component').then(m => m.AdminPerformanceComponent),
  '/admin/language-tracking':   () => import('../../pages/language-tracking/language-tracking.component').then(m => m.LanguageTrackingComponent),
  '/admin/leaderboard':         () => import('../admin-dashboard/admin-leaderboard/admin-leaderboard.component').then(m => m.AdminLeaderboardComponent),
  '/admin/journey':             () => import('../admin-dashboard/journey-management/journey-management.component').then(m => m.JourneyManagementComponent),
  '/admin/go-students':         () => import('../admin-dashboard/go-students/go-students-journey.component').then(m => m.GoStudentsJourneyComponent),
  '/admin/enrollment-overview': () => import('../../features/krish-dashboard/krish-dashboard.component').then(m => m.KrishDashboardComponent),
  '/admin/finance-dashboard':   () => import('../payment-hub-v2/payment-hub-finance-overview.component').then(m => m.PaymentHubFinanceOverviewComponent),
  '/admin/payment-hub':         () => import('../payment-hub-v2/payment-hub-shell.component').then(m => m.PaymentHubShellComponent),
  '/admin/payment-request':     () => import('../payment-hub-v2/payment-hub-request-shell.component').then(m => m.PaymentHubRequestShellComponent),
  '/admin/document-verification': () => import('../admin-dashboard/document-verification/document-verification.component').then(m => m.DocumentVerificationComponent),
  '/admin/google-sheet-sync':   () => import('../admin-dashboard/google-sheet-sync/google-sheet-sync.component').then(m => m.GoogleSheetSyncComponent),
  '/admin/visa-tracking':       () => import('../admin-dashboard/visa-tracking/visa-tracking.component').then(m => m.VisaTrackingComponent),
  '/admin/announcements':       () => import('../admin-dashboard/admin-announcements.component').then(m => m.AdminAnnouncementsComponent),
  '/admin/job-openings':        () => import('../job-openings/admin-job-openings.component').then(m => m.AdminJobOpeningsComponent),
  '/admin/support-tickets':     () => import('../help/help-admin.component').then(m => m.HelpAdminComponent),
  '/admin/olly-chat':           () => import('../olly-admin/olly-admin.component').then(m => m.OllyAdminComponent),
  '/help':                      () => import('../help/help.component').then(m => m.HelpComponent),
  '/admin/test-accounts':       () => import('../admin-dashboard/test-accounts/test-accounts.component').then(m => m.TestAccountsComponent),
  '/profile':                   () => import('../profile/profile.component').then(m => m.ProfileComponent),
  '/admin/crm':                 () => import('./crm-portal/crm-portal.component').then(m => m.CrmPortalComponent),
};

@Component({
  selector: 'app-admin-hub',
  standalone: true,
  imports: [CommonModule, RouterModule, AdminHubOverviewComponent],
  templateUrl: './admin-hub.component.html',
  styleUrls: ['./admin-hub.component.css']
})
export class AdminHubComponent implements OnInit, OnDestroy {
  cards: HubCard[] = [];
  selectedCard: HubCard | null = null;
  activeItem: NavItem | null = null;
  inlineComponent: Type<any> | null = null;
  componentLoading = false;

  loading = true;
  private sub?: Subscription;

  private readonly CARD_META: Record<string, { icon: string; gradient: string; accentColor: string; description: string }> = {
    'Overview':            { icon: 'dashboard',              gradient: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)',   accentColor: '#1d4ed8', description: 'Students, teachers & roles' },
    'Classes & Attendance':{ icon: 'videocam',               gradient: 'linear-gradient(135deg,#065f46,#059669)',   accentColor: '#059669', description: 'Timetable, classes, attendance & recordings' },
    'Learning Content':    { icon: 'menu_book',              gradient: 'linear-gradient(135deg,#581c87,#9333ea)',   accentColor: '#9333ea', description: 'Modules, exercises, resources & corrections' },
    'GlückArena':          { icon: 'sports_esports',         gradient: 'linear-gradient(135deg,#92400e,#f59e0b)',   accentColor: '#f59e0b', description: 'Arena, command center, analytics & battles' },
    'Progress & Analytics':{ icon: 'insights',               gradient: 'linear-gradient(135deg,#0f4c75,#0ea5e9)',   accentColor: '#0ea5e9', description: 'Progress, performance, tracking & leaderboard' },
    'Sales & Finance':     { icon: 'account_balance_wallet', gradient: 'linear-gradient(135deg,#3b0764,#7c3aed)',   accentColor: '#7c3aed', description: 'Enrollment, finance, payments & requests' },
    'Documents & Data':    { icon: 'folder_open',            gradient: 'linear-gradient(135deg,#1c3144,#455a64)',   accentColor: '#455a64', description: 'Documents, sheet sync & visa tracking' },
    'Support & Comms':     { icon: 'forum',                  gradient: 'linear-gradient(135deg,#881337,#e11d48)',   accentColor: '#e11d48', description: 'Announcements, tickets & live chat' },
    'System':              { icon: 'settings',               gradient: 'linear-gradient(135deg,#1f2937,#6b7280)',   accentColor: '#6b7280', description: 'Test accounts & profile settings' },
  };

  constructor(
    private navService: NavService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.sub = this.authService.currentUser$.subscribe(user => {
      if (!user) return;
      const groups: NavGroup[] = this.navService.getNavForRole(
        user.role || '',
        user.sidebarPermissions || [],
        user.teacherTabPermissions || [],
        user.sidebarAccessLevels || {},
        user.teacherTabAccessLevels || {}
      );

      this.cards = groups
        .filter(g => g.items.length > 0)
        .map(g => {
          // Remove "Dashboard" item — that IS this page
          const items = g.items.filter(i => i.id !== 'dashboard');
          return {
            group: g.group,
            items,
            ...(this.CARD_META[g.group] ?? {
              icon: 'grid_view',
              gradient: 'linear-gradient(135deg,#1e293b,#334155)',
              accentColor: '#334155',
              description: items.map(i => i.label).join(', ')
            })
          };
        })
        .filter(c => c.items.length > 0); // drop any card that becomes empty

      this.loading = false;
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  selectCard(card: HubCard): void {
    if (this.selectedCard?.group === card.group) {
      this.selectedCard = null;
      this.activeItem = null;
      this.inlineComponent = null;
      return;
    }
    this.selectedCard = card;
    this.activeItem = null;
    this.inlineComponent = null;
  }

  async selectItem(item: NavItem): Promise<void> {
    this.activeItem = item;
    this.inlineComponent = null;

    const loader = ROUTE_LOADER[item.route];
    if (loader) {
      this.componentLoading = true;
      try {
        this.inlineComponent = await loader();
      } catch {
        // Loader failed → fall back to navigation
        this.router.navigate([item.route]);
      } finally {
        this.componentLoading = false;
      }
    } else {
      // No inline loader for this route — navigate normally
      this.router.navigate([item.route]);
    }
  }

  isItemActive(item: NavItem): boolean {
    return this.activeItem?.route === item.route;
  }

  isMaterialIcon(icon: string): boolean {
    return /^[a-z0-9_]+$/.test(icon);
  }

  get skeletonCards(): number[] { return Array(8).fill(0); }
}
