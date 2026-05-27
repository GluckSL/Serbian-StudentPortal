import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from "./components/header/header.component";
import { FooterComponent } from "./components/footer/footer.component";
import { SidebarComponent } from "./shared/sidebar/sidebar.component";
import { CommonModule } from '@angular/common'; 
import { filter } from 'rxjs/operators';
import { AuthService } from './services/auth.service';
import { SupportFabComponent } from './components/support-fab/support-fab.component';
import { PortalTrackingService } from './services/portal-tracking.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, SidebarComponent, RouterModule, CommonModule, SupportFabComponent],
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

  constructor(
    private router: Router,
    private authService: AuthService,
    private portalTracking: PortalTrackingService
  ) {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      const path = event.urlAfterRedirects.split('?')[0];
      const isBareRoute = path === '/home' || path === '/login' || path === '/register' || path === '/' || path === '';
      this.showHeader = !isBareRoute;
      this.isLoginRoute = path === '/login' || path === '/register';
      this.isHomeRoute = path === '/home' || path === '/' || path === '';
      this.closeSidebar();
    });
  }

  ngOnInit() {
    this.portalTracking.start();
    const initialPath = this.router.url.split('?')[0];
    this.isLoginRoute = initialPath === '/login' || initialPath === '/register';
    this.isHomeRoute = initialPath === '/home' || initialPath === '/' || initialPath === '';
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

    const currentUrl = this.router.url;
    if (currentUrl !== '/login' && currentUrl !== '/home' && currentUrl !== '/') {
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
      this.authChecked = true;
      // Restore user from existing token on public routes (header/sidebar state).
      this.authService.refreshUserProfile().subscribe({
        next: () => {},
        error: () => {}
      });
    }
  }

  ngOnDestroy(): void {
    this.portalTracking.stop();
    document.body.classList.remove('mobile-sidebar-open');
  }

  get showSidebar(): boolean {
    return this.isLoggedIn && this.showHeader;
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
