import { HttpInterceptorFn } from '@angular/common/http';
import { AUTH_STORAGE_KEY } from '../services/auth.service';

/**
 * Attaches JWT from localStorage as Authorization: Bearer … for API calls.
 * Skips public auth routes so login/signup are unchanged.
 */
export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const url = req.url.toLowerCase();
  if (
    url.includes('/auth/login') ||
    url.includes('/auth/signup') ||
    url.includes('/auth/register')
  ) {
    return next(req);
  }

  let token: string | null = null;
  try {
    token = localStorage.getItem(AUTH_STORAGE_KEY);
  } catch {
    return next(req);
  }

  if (!token) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    })
  );
};
