import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { isSafeReturnUrl } from '../services/join-class-flow.service';

let redirectInProgress = false;

/**
 * On auth failures, clear local auth and go to login.
 * - Always handles 401.
 * - Handles 403 only when backend explicitly says token is invalid/expired.
 * Skips auth endpoints so wrong password on login still shows inline error.
 *
 * Includes the current SPA path as `returnUrl` so post-login navigation can
 * return the student to where they were (e.g. mid-join flow).
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
        url.includes('/auth/register') ||
        url.includes('/auth/forgot-password/') ||
        url.includes('/auth/setup/') ||
        url.includes('/public-signup/');

      const path = router.url.split('?')[0];
      const onLoginPage = path === '/login';

      if (isAuthEndpoint || onLoginPage) {
        return throwError(() => err);
      }

      if (!redirectInProgress) {
        redirectInProgress = true;
        auth.clearClientSession();

        // Preserve the current SPA route so login can redirect back after success.
        const currentPath = router.url;
        const queryParams: Record<string, string> = { session: 'expired' };
        if (isSafeReturnUrl(currentPath)) {
          queryParams['returnUrl'] = currentPath;
        }

        router
          .navigate(['/login'], { queryParams })
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
