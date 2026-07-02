import { API_BASE_URL } from '../config';
import { AUTH_METHOD_KEY, SILENT_GUARD_KEY } from './auth-storage-keys';

/**
 * ROK-1353 / ROK-1367: silent Discord re-auth fallback.
 *
 * When a refresh fails AND the user last authenticated via Discord, attempt a
 * silent (`prompt=none`) OAuth redirect before dropping to the login screen.
 *
 * The guard is a TIMESTAMP + cooldown, not a boolean one-shot (ROK-1367): a
 * `prompt=none` attempt that fails at Discord bounces back as `?error=...`
 * (Discord never waits for user input), so a plain "clear on error" would let
 * the very next mount fire another silent attempt → an infinite `/` ↔ Discord
 * loop. Instead, arming records `Date.now()`; a fresh guard (within the
 * cooldown) suppresses further attempts, and only once it goes stale does a
 * genuine retry fire. A clean login clears the guard outright.
 */

/** How long a silent-reauth attempt suppresses further attempts. */
export const SILENT_REAUTH_COOLDOWN_MS = 10 * 60 * 1000;

/** Record how the user authenticated (for the silent-reauth decision). */
export function setAuthMethod(method: 'discord' | 'local' | 'magic'): void {
  localStorage.setItem(AUTH_METHOD_KEY, method);
}

/** Read the last-used auth method, or null if unknown. */
export function getAuthMethod(): string | null {
  return localStorage.getItem(AUTH_METHOD_KEY);
}

/** Arm the silent-reauth guard with the current timestamp. */
export function armSilentGuard(): void {
  sessionStorage.setItem(SILENT_GUARD_KEY, String(Date.now()));
}

/** Clear the silent-reauth guard (e.g. after a clean login). */
export function clearSilentGuard(): void {
  sessionStorage.removeItem(SILENT_GUARD_KEY);
}

/**
 * True while a guard exists and is still within the cooldown. A stale guard is
 * cleared as a side effect so the next attempt is free to proceed.
 */
function isSilentGuardFresh(): boolean {
  const armedAt = Number(sessionStorage.getItem(SILENT_GUARD_KEY));
  if (!Number.isFinite(armedAt) || armedAt === 0) return false;
  if (Date.now() - armedAt < SILENT_REAUTH_COOLDOWN_MS) return true;
  clearSilentGuard();
  return false;
}

/**
 * Forget the recorded auth method (explicit logout) so a Discord user who
 * deliberately logs out is NOT silently re-authenticated on the next load.
 */
export function clearAuthMethod(): void {
  localStorage.removeItem(AUTH_METHOD_KEY);
}

/**
 * If eligible, perform a silent Discord re-auth redirect. Returns true when a
 * redirect was initiated (caller should stop and let navigation take over);
 * false when not eligible / a fresh attempt is still cooling down (caller
 * falls through to the login screen).
 */
export function attemptSilentReauth(returnTo: string): boolean {
  if (getAuthMethod() !== 'discord') return false;
  if (isSilentGuardFresh()) return false;
  armSilentGuard();
  const url = `${API_BASE_URL}/auth/discord/silent?returnTo=${encodeURIComponent(
    returnTo,
  )}`;
  window.location.assign(url);
  return true;
}
