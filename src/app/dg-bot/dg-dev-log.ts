import { environment } from '../../environments/environment';

export function dgDevLog(...args: unknown[]): void {
  if (!environment.dgDevLogging) return;
  console.log('[DG]', ...args);
}
