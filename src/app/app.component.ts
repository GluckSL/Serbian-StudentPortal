import { Component, OnInit } from '@angular/core';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from "./components/header/header.component";
import { FooterComponent } from "./components/footer/footer.component";
import { SidebarComponent } from "./shared/sidebar/sidebar.component";
import { CommonModule } from '@angular/common'; 
import { filter } from 'rxjs/operators';
import { AuthService } from './services/auth.service';
import { SupportFabComponent } from './components/support-fab/support-fab.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, FooterComponent, SidebarComponent, RouterModule, CommonModule, SupportFabComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
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
    private authService: AuthService
  ) {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      const path = event.urlAfterRedirects.split('?')[0];
      const isHomeOrLogin = path === '/home' || path === '/login' || path === '/' || path === '';
      this.showHeader = !isHomeOrLogin;
      this.isLoginRoute = path === '/login';
      this.isHomeRoute = path === '/home' || path === '/' || path === '';
    });
  }

  ngOnInit() {
    const initialPath = this.router.url.split('?')[0];
    this.isLoginRoute = initialPath === '/login';
    this.isHomeRoute = initialPath === '/home' || initialPath === '/' || initialPath === '';
    if (initialPath === '/home' || initialPath === '/login' || initialPath === '/' || initialPath === '') {
      this.showHeader = false;
    }

    this.authService.currentUser$.subscribe(user => {
      this.isLoggedIn = !!user;
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
    }
  }

  get showSidebar(): boolean {
    return this.isLoggedIn && this.showHeader;
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }
}
