import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { RouterOutlet } from '@angular/router';
import { FooterComponent } from "./components/footer/footer.component";
import { SidebarComponent } from "./shared/sidebar/sidebar.component";
import { CommonModule } from '@angular/common';
import { filter } from 'rxjs/operators';
import { AuthService } from './services/auth.service';
import { SupportFabComponent } from './components/support-fab/support-fab.component';
import { WelcomeBackOverlayComponent } from './components/welcome-back-overlay/welcome-back-overlay.component';
import { PortalTrackingService } from './services/portal-tracking.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, FooterComponent, SidebarComponent, RouterModule, CommonModule, SupportFabComponent, WelcomeBackOverlayComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'angular-germanbuddy';
  showHeader = true;
  isLoggedIn = false;
  sidebarOpen = false;
  authChecked = false;
  /** Full-bleed login: no public footer, main fills viewport */
  isLoginRoute = false;
  /** Marketing home includes its own footer — hide global app-footer */
  isHomeRoute = false;
  /** Live Gluck Room session only — list/create/edit/recording use normal shell + sidebar */
  isGluckRoom = false;

  constructor(
    private router: Router,
    private authService: AuthService,
    private portalTracking: PortalTrackingService
  ) {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      const path = event.urlAfterRedirects.split('?')[0];
      this.applyRouteLayout(path);
      this.closeSidebar();
    });
  }

  private applyRouteLayout(path: string): void {
    const isBareRoute = path === '/home' || path === '/login' || path === '/register' || path === '/' || path === '';
    this.showHeader = !isBareRoute;
    this.isLoginRoute = path === '/login' || path === '/register';
    this.isHomeRoute = path === '/home' || path === '/' || path === '';
    this.isGluckRoom = this.isGluckRoomLiveSession(path);
  }

  /** Full-bleed layout only for /gluck-room/:sessionId (not list, create, edit, or recording). */
  private isGluckRoomLiveSession(path: string): boolean {
    const match = path.match(/^\/gluck-room\/([^/]+)$/);
    if (!match) return false;
    const segment = decodeURIComponent(match[1]);
    return segment !== 'create' && segment !== 'recording';
  }

  ngOnInit() {
    this.portalTracking.start();
    const initialPath = this.router.url.split('?')[0];
    this.applyRouteLayout(initialPath);
    if (initialPath === '/home' || initialPath === '/login' || initialPath === '/register' || initialPath === '/' || initialPath === '') {
      this.showHeader = false;
    }

    this.authService.currentUser$.subscribe(user => {
      this.isLoggedIn = !!user;
      // Apply read-only body class for TEACHER role (not TEACHER_ADMIN)
      if (user?.role === 'TEACHER') {
        document.body.classList.add('teacher-read-only');
      } else {
        document.body.classList.remove('teacher-read-only');
      }
    });

    const pathOnly = this.router.url.split('?')[0];
    const isInviteOrRecoveryRoute =
      pathOnly === '/register' || pathOnly === '/forgot-password' || pathOnly === '/signup/apply';

    if (isInviteOrRecoveryRoute) {
      // No portal session expected — avoid /auth/profile 401 → login redirect.
      this.authChecked = true;
    } else if (pathOnly !== '/login' && pathOnly !== '/home' && pathOnly !== '/') {
      this.authService.refreshUserProfile().subscribe({
        next: (user) => {
          console.log('User authenticated on app load:', user);
          this.authChecked = true;
        },
        error: (err) => {
          console.log('No active session on app load');
          this.authChecked = true;
        }
      });
    } else {
      // Login / home handle their own session flow — avoid a second hanging /auth/profile call.
      this.authChecked = true;
    }
  }

  ngOnDestroy(): void {
    this.portalTracking.stop();
    document.body.classList.remove('mobile-sidebar-open');
  }

  get showSidebar(): boolean {
    return this.isLoggedIn && this.showHeader && !this.isGluckRoom;
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
    this.syncSidebarBodyLock();
  }

  closeSidebar(): void {
    if (!this.sidebarOpen) return;
    this.sidebarOpen = false;
    this.syncSidebarBodyLock();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeSidebar();
  }

  private syncSidebarBodyLock(): void {
    document.body.classList.toggle('mobile-sidebar-open', this.sidebarOpen);
  }
}
