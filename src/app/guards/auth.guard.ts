// src/app/guards/auth.guard.ts

import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Observable, map, catchError, of, timeout } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(): Observable<boolean | UrlTree> {
    // First check if user is already logged in (from BehaviorSubject)
    if (this.authService.isLoggedIn()) {
      console.log('✅ AuthGuard: User already logged in');
      return of(true);
    }

    console.log('⏳ AuthGuard: Checking server session...');
    // If not, try to refresh user profile from server
    return this.authService.refreshUserProfile().pipe(
      timeout(10000),
      map(() => {
        console.log('✅ AuthGuard: Server session valid');
        return true;
      }),
      catchError(() => {
        console.log('❌ AuthGuard: No valid session, redirecting to login');
        this.authService.clearClientSession();
        return of(this.router.createUrlTree(['/login']));
      })
    );
  }
}
