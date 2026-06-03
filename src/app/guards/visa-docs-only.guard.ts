import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';
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
    return this.auth.currentUser$.pipe(
      take(1),
      map((user) => {
        if (!user) return this.router.createUrlTree(['/login']);
        if (user.role !== 'STUDENT') return true;
        if (isCoursePlan(user.subscription)) return true;
        return this.router.createUrlTree(['/student-documents']);
      }),
    );
  }
}

