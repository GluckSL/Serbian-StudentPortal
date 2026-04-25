import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

let redirectInProgress = false;

/**
 * On auth failures, clear local auth and go to login.
 * - Always handles 401.
 * - Handles 403 only when backend explicitly says token is invalid/expired.
 * Skips auth endpoints so wrong password on login still shows inline error.
 */
export const authExpiredInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const errMsg =
        String((err.error as any)?.message || (err.error as any)?.msg || '').toLowerCase();
      const isAuth403 =
        err.status === 403 &&
        (errMsg.includes('invalid or expired token') || errMsg.includes('invalid token'));

      if (err.status !== 401 && !isAuth403) {
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
