import { API_BASE_URL } from '../config';
import {
  AUTH_METHOD_KEY,
  DISCORD_OAUTH_AT_KEY,
  LEGACY_MIGRATION_PENDING_KEY,
  SILENT_GUARD_KEY,
} from './auth-storage-keys';
import {
  safeGetItem,
  safeRemoveItem,
  safeSessionGetItem,
  safeSessionRemoveItem,
  safeSessionSetItem,
  safeSetItem,
} from '../safe-storage';

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
 *
 * Storage access goes through `safe-storage`: when the browser blocks it
 * (Safari private mode, blocked site data) the method reads as unknown, so no
 * silent attempt fires, and every write is a no-op instead of a throw.
 */

/** How long a silent-reauth attempt suppresses further attempts. */
export const SILENT_REAUTH_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * ROK-2370: how long a finished Discord OAuth sign-in keeps the silent bounce
 * armed on a touch device (ruling Q4).
 */
export const DISCORD_OAUTH_FRESH_MS = 14 * 24 * 60 * 60 * 1000;

/** ROK-2370: remember that this browser just finished a Discord OAuth sign-in. */
export function recordDiscordOAuth(now: number = Date.now()): void {
  safeSetItem(DISCORD_OAUTH_AT_KEY, String(now));
}

/** True when this browser finished a Discord OAuth sign-in under 14 days ago. */
function hasRecentDiscordOAuth(now: number): boolean {
  const at = Number(safeGetItem(DISCORD_OAUTH_AT_KEY));
  if (!Number.isFinite(at) || at <= 0) return false;
  return now - at < DISCORD_OAUTH_FRESH_MS;
}

/** Touch device = coarse primary pointer (phones AND iPads, whatever the width). */
function isTouchDevice(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Record how the user authenticated (for the silent-reauth decision). ROK-2371:
 * `'google'` is recorded but never bounces — `attemptSilentReauth` only acts on
 * `'discord'`, so a dead Google session shows the login page.
 */
export function setAuthMethod(method: 'discord' | 'local' | 'magic' | 'google'): void {
  safeSetItem(AUTH_METHOD_KEY, method);
}

/** Read the last-used auth method, or null if unknown. */
export function getAuthMethod(): string | null {
  return safeGetItem(AUTH_METHOD_KEY);
}

/**
 * Arm the silent-reauth guard with the current timestamp. Returns false when
 * the write did not stick (sessionStorage blocked or full): without a guard a
 * failed `prompt=none` bounce could redirect again on the next mount.
 */
export function armSilentGuard(): boolean {
  const armedAt = String(Date.now());
  safeSessionSetItem(SILENT_GUARD_KEY, armedAt);
  return safeSessionGetItem(SILENT_GUARD_KEY) === armedAt;
}

/** Clear the silent-reauth guard (e.g. after a clean login). */
export function clearSilentGuard(): void {
  safeSessionRemoveItem(SILENT_GUARD_KEY);
}

/**
 * True while a guard exists and is still within the cooldown. A stale guard is
 * cleared as a side effect so the next attempt is free to proceed.
 */
function isSilentGuardFresh(): boolean {
  // A blocked read is null → 0 → "not fresh", same as a missing guard.
  const armedAt = Number(safeSessionGetItem(SILENT_GUARD_KEY));
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
  safeRemoveItem(AUTH_METHOD_KEY);
  safeRemoveItem(LEGACY_MIGRATION_PENDING_KEY);
  safeRemoveItem(DISCORD_OAUTH_AT_KEY);
}

/**
 * If eligible, perform a silent Discord re-auth redirect. Returns true when a
 * redirect was initiated (caller should stop and let navigation take over);
 * false when not eligible / a fresh attempt is still cooling down (caller
 * falls through to the login screen).
 */
export function attemptSilentReauth(returnTo: string): boolean {
  if (getAuthMethod() !== 'discord') return false;
  // ROK-2370: a phone/iPad with no recent Discord OAuth here would land on
  // Discord's own sign-in form — show our login page instead.
  if (isTouchDevice() && !hasRecentDiscordOAuth(Date.now())) return false;
  if (isSilentGuardFresh()) return false;
  // No guard, no redirect: fall through to the login screen instead of looping.
  if (!armSilentGuard()) return false;
  const url = `${API_BASE_URL}/auth/discord/silent?returnTo=${encodeURIComponent(
    returnTo,
  )}`;
  window.location.assign(url);
  return true;
}
