import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): Observable<boolean> {
    const expectedRole = route.data['role'];

    // Use cached user first — no HTTP call needed if already logged in
    const cachedUser = this.authService.getSnapshotUser();
    if (cachedUser) {
      return of(this.checkRole(cachedUser, expectedRole));
    }

    // Fallback: fetch from server if no cached user
    return this.authService.getUserProfile().pipe(
      map(user => this.checkRole(user, expectedRole)),
      catchError(() => {
        this.router.navigate(['/login']);
        return of(false);
      })
    );
  }

  private checkRole(user: any, expectedRole: any): boolean {
    if (Array.isArray(expectedRole)) {
      if (expectedRole.includes(user?.role)) return true;
    } else {
      if (user?.role === expectedRole) return true;
    }

    // Wrong role — redirect to correct dashboard
    if (user?.role === 'STUDENT') {
      const isVisaDocOnly = (user?.subscription || '').toUpperCase().trim() === 'VISA_DOC_ONLY';
      this.router.navigate([isVisaDocOnly ? '/student-progress' : '/student/my-course']);
    } else if (user?.role === 'TEACHER' || user?.role === 'TEACHER_ADMIN') {
      this.router.navigate(['/teacher-dashboard']);
    } else if (user?.role === 'ADMIN') {
      this.router.navigate(['/admin-dashboard']);
    } else {
      this.router.navigate(['/login']);
    }
    return false;
  }
}
