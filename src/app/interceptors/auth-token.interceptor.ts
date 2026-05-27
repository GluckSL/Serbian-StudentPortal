import { HttpInterceptorFn } from '@angular/common/http';
import { getAuthToken } from '../services/auth.service';

/**
 * Attaches JWT from localStorage as Authorization: Bearer … for API calls.
 * Skips public auth routes so login/signup are unchanged.
 */
export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const url = req.url.toLowerCase();
  if (
    url.includes('/auth/login') ||
    url.includes('/auth/signup') ||
    url.includes('/auth/register') ||
    url.includes('/public-signup/')
  ) {
    return next(req);
  }

  const token = getAuthToken();

  if (!token) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    })
  );
};
