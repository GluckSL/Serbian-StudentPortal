import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

let redirectInProgress = false;

/**
 * On 401 (session expired / invalid cookie), clear local auth and go to login.
 * Skips auth endpoints so wrong password on login still shows inline error.
 */
export const authExpiredInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) {
        return throwError(() => err);
      }

      const url = req.url.toLowerCase();
      const isAuthEndpoint =
        url.includes('/auth/login') ||
        url.includes('/auth/signup') ||
        url.includes('/auth/register');

      const path = router.url.split('?')[0];
      const onLoginPage = path === '/login';

      if (isAuthEndpoint || onLoginPage) {
        return throwError(() => err);
      }

      if (!redirectInProgress) {
        redirectInProgress = true;
        auth.clearClientSession();
        router
          .navigate(['/login'], { queryParams: { session: 'expired' } })
          .finally(() => {
            setTimeout(() => {
              redirectInProgress = false;
            }, 800);
          });
      }

      return throwError(() => err);
    })
  );
};
