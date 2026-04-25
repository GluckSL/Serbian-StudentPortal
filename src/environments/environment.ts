// src/environments/environment.ts

export const environment = {
  production: false,
  /** Verbose DG Bot client logs (dev only). */
  dgDevLogging: true,
  /**
   * Same-origin `/api` so `ng serve` (any port) proxies to Express.
   * Avoids `localhost:4000` vs `localhost:4700` cross-origin auth header issues.
   * Requires `proxy.conf.json` target to match your API (default port 4000).
   */
  apiUrl: '/api'
};
