import { TokenResponseSchema, type RedeemMagicLinkDto } from '@raid-ledger/contract';
import { API_BASE_URL } from './config';
import { ACCESS_TOKEN_KEY, ORIGINAL_TOKEN_KEY } from './api/auth-storage-keys';
import { refreshWithOutcome } from './api/refresh-client';
import { clearSilentGuard, getAuthMethod, setAuthMethod } from './api/silent-reauth';

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

/** Whether a session the link would replace still exists (OQ6, #1384). */
type StoredSession = 'none' | 'valid' | 'unknown';

/**
 * OQ6: only a 401/403 from /auth/me proves the stored access token is dead. A
 * 429, 5xx or network error proves nothing, so the session is 'unknown'.
 */
async function probeStoredToken(stored: string): Promise<StoredSession> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    });
    if (res.ok) return 'valid';
    return res.status === 401 || res.status === 403 ? 'none' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * #1384 (operator ruling 2026-09-28): a session the refresh cookie can still
 * renew is VALID — the 1h access token expiring must not let a planted link
 * swap it (login CSRF). Only a refresh the server rejects (401/403) leaves
 * 'none'. A 429, 5xx, network error or bad body is 'unknown': the refresh
 * bucket is shared per IP, so anyone on the victim's NAT can force a 429.
 */
async function probeRefreshSession(): Promise<StoredSession> {
  const outcome = await refreshWithOutcome();
  if (outcome.kind === 'ok') return 'valid';
  return outcome.kind === 'rejected' ? 'none' : 'unknown';
}

async function checkStoredSession(): Promise<StoredSession> {
  const stored = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!stored && !getAuthMethod()) return 'none';
  const probed = stored ? await probeStoredToken(stored) : 'none';
  return probed === 'none' ? probeRefreshSession() : probed;
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
 * OQ6 (operator ruling 2026-09-27) + #1384 (2026-09-28): redeem only when no
 * session exists — no stored token, or /auth/me rejects it (401/403) AND the
 * refresh cookie cannot renew it — whoever the link is for. A valid or
 * refreshable session is kept, and so is one a transient /auth/me or refresh
 * failure could not judge — the link is left unspent (its
 * fragment is already gone).
 */
async function runRedeem(token: string): Promise<void> {
  if ((await checkStoredSession()) !== 'none') return;
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
