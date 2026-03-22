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

    return this.authService.getUserProfile().pipe(
      map(user => {

        // Handle array of roles
        if (Array.isArray(expectedRole)) {
          if (expectedRole.includes(user?.role)) {
            return true;
          }
        } else {
          // ✅ allow if role matches
          if (user?.role === expectedRole) {
            return true;
          }
        }

        // ❌ wrong role → redirect them to their correct dashboard
        if (user?.role === 'STUDENT') {
          this.router.navigate(['/student-progress']);
        } else if (user?.role === 'TEACHER') {
          this.router.navigate(['/teacher-dashboard']);
        } else if (user?.role === 'TEACHER_ADMIN') {
          this.router.navigate(['/teacher-dashboard']);
        } else if (user?.role === 'ADMIN') {
          this.router.navigate(['/admin-dashboard']);
        } else {
          this.router.navigate(['/login']);
        }

        return false;
      }),
      catchError(err => {
        this.router.navigate(['/login']);
        return of(false);
      })
    );
  }
}
