import { Component, DestroyRef, OnInit, Output, EventEmitter, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NavService, NavGroup } from '../services/nav.service';
import { TourService } from '../../services/tour.service';
import { PortalTrackingService } from '../../services/portal-tracking.service';
import { InteractiveGameService } from '../../features/glueck-arena/services/interactive-game.service';
import { PaymentRequestNavService } from '../../components/payment-hub-v2/payment-request-nav.service';
import { PaymentNotificationNavService } from '../../components/payment-hub-v2/payment-notification-nav.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit {
  @Output() closeSidebar = new EventEmitter<void>();

  collapsed: Record<string, boolean> = {};
  navGroups: NavGroup[] = [];
  userRole: string = '';
  userName: string = '';
  userEmail: string = '';
  sidebarPermissions: string[] = [];
  sidebarAccessLevels: Record<string, 'view' | 'edit' | 'full'> = {};
  paymentRequestPendingCount = 0;
  paymentDueNotificationCount = 0;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private authService: AuthService,
    private navService: NavService,
    private router: Router,
    private tourService: TourService,
    private portalTracking: PortalTrackingService,
    private arenaService: InteractiveGameService,
    private paymentRequestNav: PaymentRequestNavService,
    private paymentNotificationNav: PaymentNotificationNavService,
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.userRole = user.role || '';
        this.userName = user.name || '';
        this.userEmail = user.email || '';
        this.sidebarPermissions = user.sidebarPermissions || [];
        this.sidebarAccessLevels = user.sidebarAccessLevels || {};
        let groups = this.navService.getNavForRole(
          this.userRole,
          this.sidebarPermissions,
          user.teacherTabPermissions || [],
          user.sidebarAccessLevels || {},
          user.teacherTabAccessLevels || {}
        );
        // Silver package: no portal announcements tab (GO track still uses SILVER subscription).
        // Platinum (including GO+Platinum) keeps announcements — do not key off goStatus alone.
        if (this.userRole === 'STUDENT') {
          const subscription = String(user.subscription || '').toUpperCase();
          if (subscription === 'SILVER') {
            groups = groups
              .map((g) => ({
                ...g,
                items: (g.items || []).filter((item) => item.id !== 'student-announcements')
              }))
              .filter((g) => (g.items || []).length > 0);
          }
          this.arenaService.getArenaAccess().subscribe({
            next: (r) => {
              if (!r.hasAccess) {
                groups = groups
                  .map((g) => ({
                    ...g,
                    items: (g.items || []).filter((item) => item.id !== 'glueck-arena')
                  }))
                  .filter((g) => (g.items || []).length > 0);
              }
              this.setNavGroups(groups);
            },
            error: () => { this.setNavGroups(groups); }
          });
          return;
        }
        this.setNavGroups(groups);
      }
    });
  }

  private setNavGroups(groups: NavGroup[]): void {
    this.navGroups = groups;
    this.bindPaymentRequestNavBadge();
    this.bindPaymentDueNotificationBadge();
  }

  get showPaymentDueNotifications(): boolean {
    return ['ADMIN', 'SUB_ADMIN', 'TEACHER_ADMIN'].includes(this.userRole);
  }

  private bindPaymentRequestNavBadge(): void {
    if (!['ADMIN', 'TEACHER_ADMIN'].includes(this.userRole)) {
      this.paymentRequestPendingCount = 0;
      return;
    }
    this.paymentRequestNav.pendingCount$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((count) => { this.paymentRequestPendingCount = count; });
    this.paymentRequestNav.refresh();
  }

  private bindPaymentDueNotificationBadge(): void {
    if (!this.showPaymentDueNotifications) {
      this.paymentDueNotificationCount = 0;
      return;
    }
    this.paymentNotificationNav.unreadCount$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((count) => { this.paymentDueNotificationCount = count; });
    this.paymentNotificationNav.refresh();
  }

  getRoute(item: any): string {
    if (item.route === '__dashboard__') {
      if (this.userRole === 'SUB_ADMIN') {
        return this.navService.getSubAdminDefaultRoute(this.sidebarPermissions, this.sidebarAccessLevels);
      }
      return this.navService.getDashboardRoute(this.userRole);
    }
    return item.route;
  }

  toggle(group: string): void {
    this.collapsed[group] = !this.collapsed[group];
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
    this.closeSidebar.emit();
  }

  logout(): void {
    void this.portalTracking.flushEndSessionBeforeLogout().finally(() => {
      this.authService.logout().subscribe({
        next: () => this.router.navigate(['/home']),
        error: () => this.router.navigate(['/home'])
      });
    });
    this.closeSidebar.emit();
  }

  get isStudent(): boolean { return this.userRole === 'STUDENT'; }
  get isTeacher(): boolean { return this.userRole === 'TEACHER' || this.userRole === 'TEACHER_ADMIN'; }

  restartTour(): void {
    this.tourService.resetTour(this.userRole);
    if (this.isStudent) this.tourService.startStudentTour();
    else if (this.isTeacher) this.tourService.startTeacherTour();
    this.closeSidebar.emit();
  }

  get initials(): string {
    return this.userName?.slice(0, 2).toUpperCase() || '??';
  }

  isMaterialIcon(icon: string): boolean {
    return /^[a-z0-9_]+$/.test(icon);
  }

  /** First word / rest on two lines — used only in mobile sidebar CSS. */
  splitProfileName(name: string | null | undefined): { first: string; second: string | null } {
    const raw = (name ?? '').trim();
    if (!raw) return { first: '', second: null };
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return { first: parts[0], second: null };
    return { first: parts[0], second: parts.slice(1).join(' ') };
  }

  get roleColor(): string {
    const map: Record<string, string> = {
      ADMIN: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)',
      TEACHER_ADMIN: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)',
      SUB_ADMIN: 'linear-gradient(135deg,#334155,#475569)',
      TEACHER: 'linear-gradient(135deg,#065f46,#059669)',
      STUDENT: 'linear-gradient(135deg,#7c2d12,#b45309)'
    };
    return map[this.userRole] || 'linear-gradient(135deg,#1e3a8a,#1d4ed8)';
  }

  get badgeColor(): string {
    const map: Record<string, string> = {
      ADMIN: '#7c3aed', TEACHER_ADMIN: '#7c3aed',
      SUB_ADMIN: '#334155',
      TEACHER: '#0891b2', STUDENT: '#d97706'
    };
    return map[this.userRole] || '#7c3aed';
  }
}
