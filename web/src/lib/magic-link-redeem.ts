import { TokenResponseSchema, type RedeemMagicLinkDto } from '@raid-ledger/contract';
import { API_BASE_URL } from './config';
import { ACCESS_TOKEN_KEY, ORIGINAL_TOKEN_KEY } from './api/auth-storage-keys';
import { clearSilentGuard, setAuthMethod } from './api/silent-reauth';
import { readJwtSub } from './api/token-expiry';

/**
 * ROK-1366: exchange a single-use magic-link token for a real session.
 *
 * The raw link token is never stored — it is POSTed once as JSON and the
 * server answers with an access token plus the httpOnly refresh cookie.
 * `fetchCurrentUser` awaits the pending exchange before it decides, so a
 * deep link lands signed in. Every failure is silent: the caller falls back
 * to the normal unauthenticated path (refresh probe → silent re-auth → login).
 */

let pending: Promise<void> | null = null;

/** OQ6: a stored access token that still passes /auth/me is kept as-is. */
async function hasValidSession(): Promise<boolean> {
  const stored = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!stored) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function postRedeem(token: string): Promise<string | null> {
  const body: RedeemMagicLinkDto = { token };
  try {
    const res = await fetch(`${API_BASE_URL}/auth/redeem-magic-link`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const parsed = TokenResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.access_token : null;
  } catch {
    return null;
  }
}

/** A redeem is a fresh sign-in: any impersonation it replaces is over. */
function adoptSession(accessToken: string): void {
  localStorage.removeItem(ORIGINAL_TOKEN_KEY);
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  setAuthMethod('magic');
  clearSilentGuard();
}

/**
 * Review fix (login-CSRF): a link only ever signs in the person this browser
 * already knows. That is the admin's own token while impersonating, else the
 * stored access token, expired or not. With one stored, the link's
 * unverified `sub` must match it — a stranger's link, or a stored token we
 * cannot read, is ignored and `fetchCurrentUser` takes its normal refresh →
 * login path, as main's `!getAuthToken()` guard did. The server still
 * verifies the link; this only decides whether to try.
 */
function linkMatchesStoredUser(token: string): boolean {
  const stored = localStorage.getItem(ORIGINAL_TOKEN_KEY) ?? localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!stored) return true;
  const storedSub = readJwtSub(stored);
  return storedSub !== null && storedSub === readJwtSub(token);
}

async function runRedeem(token: string): Promise<void> {
  if (!linkMatchesStoredUser(token)) return;
  if (await hasValidSession()) return;
  const accessToken = await postRedeem(token);
  if (accessToken) adoptSession(accessToken);
}

/** Start the exchange (once, at module load). Never rejects. */
export function startMagicLinkRedeem(token: string): Promise<void> {
  pending = runRedeem(token).finally(() => {
    pending = null;
  });
  return pending;
}

/** Resolves once any in-flight exchange has settled; at once if none. */
export function awaitMagicLinkRedeem(): Promise<void> {
  return pending ?? Promise.resolve();
}

/** True while an exchange is in flight (App prefetches /auth/me then). */
export function isMagicLinkRedeemPending(): boolean {
  return pending !== null;
}
