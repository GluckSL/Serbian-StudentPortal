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
    // #region agent log
    fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3e50b0'},body:JSON.stringify({sessionId:'3e50b0',runId:'pre-fix',hypothesisId:'A',location:'app.component.ts:104',message:'toggleSidebar',data:{sidebarOpen:this.sidebarOpen,ua:navigator.userAgent?.slice(0,120)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }

  closeSidebar(): void {
    if (!this.sidebarOpen) return;
    this.sidebarOpen = false;
    this.syncSidebarBodyLock();
    // #region agent log
    fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3e50b0'},body:JSON.stringify({sessionId:'3e50b0',runId:'pre-fix',hypothesisId:'A',location:'app.component.ts:114',message:'closeSidebar',data:{reason:'explicit',sidebarOpen:this.sidebarOpen},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeSidebar();
  }

  @HostListener('document:touchstart', ['$event'])
  onDocTouchStart(ev: TouchEvent): void {
    if (!this.sidebarOpen) return;
    const t = ev.touches && ev.touches.length ? ev.touches[0] : null;
    if (!t) return;

    const x = t.clientX;
    const y = t.clientY;

    const elAtPoint = document.elementFromPoint(x, y) as Element | null;
    const overlay = document.querySelector('.sidebar-overlay') as HTMLElement | null;
    const sidebarHost = document.querySelector('app-sidebar') as HTMLElement | null;

    const overlayRect = overlay ? overlay.getBoundingClientRect() : null;
    const sidebarRect = sidebarHost ? sidebarHost.getBoundingClientRect() : null;

    const styleZ = (el: HTMLElement | null) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { zIndex: cs.zIndex, position: cs.position, pointerEvents: cs.pointerEvents, transform: cs.transform };
    };

    // #region agent log
    fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3e50b0'},body:JSON.stringify({sessionId:'3e50b0',runId:'pre-fix',hypothesisId:'A',location:'app.component.ts:144',message:'doc touchstart while sidebar open',data:{x,y,targetTag:(ev.target as Element | null)?.tagName||null,targetClass:(ev.target as Element | null)?.className||null,atPointTag:elAtPoint?.tagName||null,atPointClass:(elAtPoint as any)?.className||null,overlayRect:overlayRect?{left:Math.round(overlayRect.left),top:Math.round(overlayRect.top),right:Math.round(overlayRect.right),bottom:Math.round(overlayRect.bottom)}:null,sidebarRect:sidebarRect?{left:Math.round(sidebarRect.left),top:Math.round(sidebarRect.top),right:Math.round(sidebarRect.right),bottom:Math.round(sidebarRect.bottom)}:null,overlayStyle:styleZ(overlay),sidebarHostStyle:styleZ(sidebarHost)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.sidebarOpen) return;
    const target = ev.target as Element | null;
    if (!target) return;
    const isOverlay = !!target.closest?.('.sidebar-overlay');
    const isInSidebar = !!target.closest?.('app-sidebar');
    // #region agent log
    fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3e50b0'},body:JSON.stringify({sessionId:'3e50b0',runId:'pre-fix',hypothesisId:'B',location:'app.component.ts:158',message:'doc click while sidebar open',data:{targetTag:target.tagName,targetClass:(target as any).className||null,isOverlay,isInSidebar},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }

  private syncSidebarBodyLock(): void {
    document.body.classList.toggle('mobile-sidebar-open', this.sidebarOpen);
  }
}
