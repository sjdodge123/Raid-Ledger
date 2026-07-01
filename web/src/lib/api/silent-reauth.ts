import { API_BASE_URL } from '../config';
import { AUTH_METHOD_KEY, SILENT_GUARD_KEY } from './auth-storage-keys';

/**
 * ROK-1353: silent Discord re-auth fallback.
 *
 * When a refresh fails AND the user last authenticated via Discord, attempt
 * ONE silent (`prompt=none`) OAuth redirect before dropping to the login
 * screen. A sessionStorage one-shot guard prevents a redirect loop — if the
 * silent attempt itself fails, the API redirects back with
 * `?silent_failed=1`, which clears the guard and routes to login.
 */

/** Record how the user authenticated (for the silent-reauth decision). */
export function setAuthMethod(method: 'discord' | 'local' | 'magic'): void {
  localStorage.setItem(AUTH_METHOD_KEY, method);
}

/** Read the last-used auth method, or null if unknown. */
export function getAuthMethod(): string | null {
  return localStorage.getItem(AUTH_METHOD_KEY);
}

/** Clear the one-shot silent-reauth guard (e.g. after a clean login). */
export function clearSilentGuard(): void {
  sessionStorage.removeItem(SILENT_GUARD_KEY);
}

/**
 * Forget the recorded auth method (explicit logout) so a Discord user who
 * deliberately logs out is NOT silently re-authenticated on the next load.
 */
export function clearAuthMethod(): void {
  localStorage.removeItem(AUTH_METHOD_KEY);
}

/**
 * If eligible, perform a single silent Discord re-auth redirect. Returns true
 * when a redirect was initiated (caller should stop and let navigation take
 * over); false when not eligible / already attempted (caller falls through to
 * the login screen).
 */
export function attemptSilentReauth(returnTo: string): boolean {
  if (getAuthMethod() !== 'discord') return false;
  if (sessionStorage.getItem(SILENT_GUARD_KEY)) return false;
  sessionStorage.setItem(SILENT_GUARD_KEY, '1');
  const url = `${API_BASE_URL}/auth/discord/silent?returnTo=${encodeURIComponent(
    returnTo,
  )}`;
  window.location.assign(url);
  return true;
}
