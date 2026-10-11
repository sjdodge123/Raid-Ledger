import { LEGACY_ACCESS_TOKEN_KEY, LEGACY_ORIGINAL_TOKEN_KEY } from './auth-storage-keys';
import { readClaims } from './token-expiry';

/**
 * ROK-1754: the access JWT lives in this module's memory and NOWHERE else —
 * never localStorage or sessionStorage, where any script on the origin (or a
 * browser extension) could read it. A reload starts empty; the session is
 * re-minted from the httpOnly `rl_rt` refresh cookie. Each tab holds its own
 * token; tabs coordinate through the `rl-refresh` Web Lock + the cookie jar.
 *
 * `getAuthToken()`/`setAuthToken()` in `use-auth.ts` delegate here, so their
 * ~40 importers are unchanged.
 */

let token: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** The current in-memory access token, or null. */
export function getAccessToken(): string | null {
  return token;
}

/** Hold a freshly-minted access token (login, refresh, magic link, impersonate). */
export function setAccessToken(next: string): void {
  if (token === next) return;
  token = next;
  emit();
}

/** Drop the in-memory token (logout, deactivation, failed refresh). */
export function clearAccessToken(): void {
  if (token === null) return;
  token = null;
  emit();
}

/** `useSyncExternalStore` subscription; returns the unsubscribe. */
export function subscribeAccessToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * True when the in-memory token carries an `impersonatedBy` claim. The claim
 * is unverified client-side — a UI hint only; the server enforces identity.
 */
export function isImpersonatingToken(candidate: string | null = token): boolean {
  if (!candidate) return false;
  const by = readClaims(candidate)?.impersonatedBy;
  return by !== undefined && by !== null;
}

/**
 * Remove the tokens an older bundle stored in localStorage. Returns true when
 * one was there — a signed-in user upgrading, whom the boot refresh (B2) must
 * re-mint even without the auth-method marker. Never throws.
 */
export function purgeLegacyAuthStorage(): boolean {
  try {
    const had = localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY) !== null;
    localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
    localStorage.removeItem(LEGACY_ORIGINAL_TOKEN_KEY);
    return had;
  } catch {
    return false;
  }
}

const legacyPurged = purgeLegacyAuthStorage();

/** Whether this page load purged a legacy stored token (see §5). */
export function legacySessionPurged(): boolean {
  return legacyPurged;
}
