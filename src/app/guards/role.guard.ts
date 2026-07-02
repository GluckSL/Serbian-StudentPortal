import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { isCoursePlan } from '../utils/student-subscription-plans.util';
import { NavService } from '../shared/services/nav.service';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router,
    private navService: NavService
  ) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> {
    const expectedRole = route.data['role'];
    const allowedRoles = Array.isArray(expectedRole) ? expectedRole : [expectedRole];
    const adminScopedRoute = allowedRoles.some(
      (role: string) => role === 'ADMIN' || role === 'TEACHER_ADMIN'
    );

    // Use cached user first — no HTTP call needed if already logged in
    const cachedUser = this.authService.getSnapshotUser();
    if (cachedUser) {
      const subAdminNeedsFullProfile =
        cachedUser?.role === 'SUB_ADMIN' &&
        adminScopedRoute &&
        !cachedUser?.sidebarPermissions?.length &&
        !Object.keys(cachedUser?.sidebarAccessLevels || {}).length;
      const teacherNeedsFullProfile =
        cachedUser?.role === 'TEACHER' &&
        adminScopedRoute &&
        !cachedUser?.teacherTabPermissions?.length &&
        !Object.keys(cachedUser?.teacherTabAccessLevels || {}).length;
      if (subAdminNeedsFullProfile || teacherNeedsFullProfile) {
        return this.authService.refreshUserProfile().pipe(
          map(user => this.checkRole(user, expectedRole, state.url)),
          catchError(() => {
            this.router.navigate(['/login']);
            return of(false);
          })
        );
      }
      return of(this.checkRole(cachedUser, expectedRole, state.url));
    }

    // Fallback: fetch from server if no cached user
    return this.authService.getUserProfile().pipe(
      map(user => this.checkRole(user, expectedRole, state.url)),
      catchError(() => {
        this.router.navigate(['/login']);
        return of(false);
      })
    );
  }

  private checkRole(user: any, expectedRole: any, url: string): boolean {
    const allowedRoles = Array.isArray(expectedRole) ? expectedRole : [expectedRole];

    if (allowedRoles.includes(user?.role)) {
      if (user?.role !== 'SUB_ADMIN') {
        return true;
      }

      if (this.navService.canSubAdminAccessRoute(
        url,
        user?.sidebarPermissions || [],
        user?.sidebarAccessLevels || {}
      )) {
        return true;
      }

      this.router.navigate([this.subAdminHomeRoute(user)]);
      return false;
    }

    const canSubAdminTryAdminRoute =
      user?.role === 'SUB_ADMIN' &&
      allowedRoles.some((role: string) => role === 'ADMIN' || role === 'TEACHER_ADMIN');

    if (canSubAdminTryAdminRoute) {
      if (this.navService.canSubAdminAccessRoute(
        url,
        user?.sidebarPermissions || [],
        user?.sidebarAccessLevels || {}
      )) {
        return true;
      }
      this.router.navigate([this.subAdminHomeRoute(user)]);
      return false;
    }

    // TEACHER accessing an admin-only route via assigned tab permissions (view-only)
    const canTeacherTryAdminRoute =
      user?.role === 'TEACHER' &&
      allowedRoles.some((role: string) => role === 'ADMIN' || role === 'TEACHER_ADMIN');

    if (canTeacherTryAdminRoute) {
      if (this.navService.canTeacherAccessAdminRoute(
        url,
        user?.teacherTabPermissions || [],
        user?.teacherTabAccessLevels || {}
      )) {
        return true;
      }
      this.router.navigate(['/teacher-dashboard']);
      return false;
    }

    // Wrong role — redirect to correct dashboard
    if (user?.role === 'STUDENT') {
      const path = isCoursePlan(user?.subscription) ? '/student/my-course' : '/student-documents';
      this.router.navigate([path]);
    } else if (user?.role === 'TEACHER' || user?.role === 'TEACHER_ADMIN') {
      this.router.navigate(['/teacher-dashboard']);
    } else if (user?.role === 'ADMIN') {
      this.router.navigate(['/admin-dashboard']);
    } else if (user?.role === 'SUB_ADMIN') {
      this.router.navigate([this.subAdminHomeRoute(user)]);
    } else {
      this.router.navigate(['/login']);
    }
    return false;
  }

  private subAdminHomeRoute(user: any): string {
    return this.navService.getSubAdminDefaultRoute(
      user?.sidebarPermissions || [],
      user?.sidebarAccessLevels || {}
    );
  }
}
