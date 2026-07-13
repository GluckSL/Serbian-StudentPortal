import { Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/** Routes that always use English (admin / teacher tooling). */
const ADMIN_ROUTE_PREFIXES = [
  '/admin',
  '/admin-dashboard',
  '/teacher-dashboard',
  '/user-roles',
  '/account-audit-log',
  '/payment-hub',
  '/crm-portal',
  '/language-tracking',
  '/portal-analytics',
  '/krish-dashboard',
];

/**
 * Phase 1 + student-facing routes that use {@link environment.portalStudentLocale}.
 * Expand this list as more student pages move to ngx-translate.
 */
const STUDENT_LOCALE_ROUTE_PREFIXES = [
  '/home',
  '/login',
  '/register',
  '/forgot-password',
  '/signup',
  '/help',
  '/student',
  '/student-progress',
  '/my-course',
  '/my-payments',
  '/student-documents',
  '/visa-status',
  '/performance-history',
  '/glueck-arena',
  '/digital-exercises',
  '/dg-bot',
  '/sprechen',
  '/profile',
  '/time-table-view-student',
];

@Injectable({ providedIn: 'root' })
export class PortalLocaleService {
  constructor(
    private readonly router: Router,
    private readonly translate: TranslateService,
  ) {}

  init(): void {
    this.translate.addLangs(['en', 'sr-Latn']);
    this.translate.setFallbackLang('en');

    const initialPath = this.router.url.split('?')[0];
    const initialLang = this.resolveLang(initialPath);
    this.translate.use(initialLang);

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.applyLocaleForUrl(event.urlAfterRedirects.split('?')[0]);
      });
  }

  private applyLocaleForUrl(path: string): void {
    const lang = this.resolveLang(path);
    if (this.translate.getCurrentLang() !== lang) {
      this.translate.use(lang);
    }
    document.documentElement.lang = lang === 'sr-Latn' ? 'sr-Latn' : 'en';
  }

  private resolveLang(path: string): string {
    const normalized = path || '/';
    if (this.isAdminRoute(normalized)) {
      return 'en';
    }
    if (this.isStudentLocaleRoute(normalized)) {
      return environment.portalStudentLocale || 'sr-Latn';
    }
    return 'en';
  }

  private isAdminRoute(path: string): boolean {
    return ADMIN_ROUTE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
  }

  private isStudentLocaleRoute(path: string): boolean {
    if (path === '/' || path === '') {
      return true;
    }
    return STUDENT_LOCALE_ROUTE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
  }
}
