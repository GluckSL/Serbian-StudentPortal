// src/environments/environment.ts

export const environment = {
  production: false,
  /**
   * Same-origin `/api` so `ng serve` (any port) proxies to Express and httpOnly cookies
   * apply to `localhost:<port>`. Avoids `localhost:4000` vs `localhost:4700` cookie/CORS issues.
   * Requires `proxy.conf.json` target to match your API (default port 4000).
   */
  apiUrl: '/api'
};
