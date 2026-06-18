// src/app/guards/auth.guard.ts

import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService, getAuthToken } from '../services/auth.service';
import { Observable, map, catchError, of, timeout } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(): Observable<boolean | UrlTree> {
    if (!getAuthToken()) {
      return of(this.router.createUrlTree(['/login']));
    }

    this.authService.hydrateUserFromStoredToken();

    if (this.authService.isLoggedIn()) {
      return of(true);
    }

    return this.authService.refreshUserProfile().pipe(
      timeout(10000),
      map(() => true),
      catchError((err) => {
        const msg = String(err?.error?.message || err?.error?.msg || '').toLowerCase();
        const authRejected =
          err?.status === 401 ||
          (err?.status === 403 &&
            (msg.includes('invalid or expired token') || msg.includes('invalid token')));
        if (authRejected) {
          this.authService.clearClientSession();
        }
        return of(this.router.createUrlTree(['/login']));
      })
    );
  }
}
