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

    // Use cached user first — no HTTP call needed if already logged in
    const cachedUser = this.authService.getSnapshotUser();
    if (cachedUser) {
      const allowed = this.checkRole(cachedUser, expectedRole, state.url);
      // #region agent log
      if (state.url.includes('krish-dashboard')) {
        fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'240bb9'},body:JSON.stringify({sessionId:'240bb9',runId:'pre-fix',hypothesisId:'H1',location:'role.guard.ts:canActivate',message:'RoleGuard cached user check',data:{url:state.url,role:cachedUser?.role,allowed,expectedRole},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      return of(allowed);
    }

    // Fallback: fetch from server if no cached user
    return this.authService.getUserProfile().pipe(
      map(user => {
        const allowed = this.checkRole(user, expectedRole, state.url);
        // #region agent log
        if (state.url.includes('krish-dashboard')) {
          fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'240bb9'},body:JSON.stringify({sessionId:'240bb9',runId:'pre-fix',hypothesisId:'H1',location:'role.guard.ts:canActivate-fetch',message:'RoleGuard profile fetch check',data:{url:state.url,role:user?.role,allowed,expectedRole},timestamp:Date.now()})}).catch(()=>{});
        }
        // #endregion
        return allowed;
      }),
      catchError((err) => {
        // #region agent log
        if (state.url.includes('krish-dashboard')) {
          fetch('http://127.0.0.1:7522/ingest/8fbb1e5d-0f41-4182-9ec8-d3623ff105ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'240bb9'},body:JSON.stringify({sessionId:'240bb9',runId:'pre-fix',hypothesisId:'H1',location:'role.guard.ts:catchError',message:'RoleGuard profile fetch failed -> login',data:{url:state.url,error:String(err)},timestamp:Date.now()})}).catch(()=>{});
        }
        // #endregion
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

      this.router.navigate(['/admin-dashboard']);
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
      this.router.navigate(['/admin-dashboard']);
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
      this.router.navigate(['/admin-dashboard']);
    } else {
      this.router.navigate(['/login']);
    }
    return false;
  }
}
