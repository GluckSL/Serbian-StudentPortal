import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, catchError, filter, map, of, switchMap, take } from 'rxjs';
import { AuthService, getAuthToken } from '../services/auth.service';
import { isCoursePlan } from '../utils/student-subscription-plans.util';

/**
 * Blocks course features for service-plan students (docs / visa / post landing).
 * Silver and Platinum keep full access.
 */
@Injectable({ providedIn: 'root' })
export class VisaDocsOnlyGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    if (!getAuthToken()) {
      return of(this.router.createUrlTree(['/login']));
    }

    this.auth.hydrateUserFromStoredToken();

    const tokenRole = this.auth.getRoleFromToken();
    if (tokenRole && tokenRole !== 'STUDENT') {
      return of(true);
    }

    return this.auth.currentUser$.pipe(
      filter((user) => user !== null),
      take(1),
      switchMap((user) => {
        if (user!.role !== 'STUDENT') return of(true);

        const subscription = String(user!.subscription || '').trim();
        if (subscription) {
          return of(this.courseAccessDecision(subscription));
        }

        return this.auth.refreshUserProfile().pipe(
          map((profile) => this.courseAccessDecision(profile?.subscription)),
          catchError(() => of(this.router.createUrlTree(['/login']))),
        );
      }),
    );
  }

  private courseAccessDecision(subscription: string | null | undefined): boolean | UrlTree {
    return isCoursePlan(subscription)
      ? true
      : this.router.createUrlTree(['/student-documents']);
  }
}

