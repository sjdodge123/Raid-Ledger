import { API_BASE_URL } from '../config';
import { RefreshResponseSchema } from '@raid-ledger/contract';
import { ACCESS_TOKEN_KEY, ORIGINAL_TOKEN_KEY } from './auth-storage-keys';

/**
 * ROK-1353: single-flight access-token refresh.
 *
 * On a 401, callers invoke `ensureFreshToken()`. Concurrent callers (e.g.
 * several tabs / parallel requests) all await the SAME in-flight POST so the
 * refresh row is rotated exactly once — the server's atomic UPDATE + ±60s
 * grace covers any residual race. The raw refresh token lives only in the
 * httpOnly `rl_rt` cookie; this module never sees it.
 */

/**
 * ROK-1366 #1384: what a refresh proved. Only a 401/403 proves the session is
 * gone ('rejected'); a 429, 5xx, other status, network error or unparseable
 * 200 proves nothing ('indeterminate').
 */
export type RefreshOutcome =
  | { kind: 'ok'; token: string }
  | { kind: 'rejected' }
  | { kind: 'indeterminate' };

const INDETERMINATE: RefreshOutcome = { kind: 'indeterminate' };

let inFlight: Promise<RefreshOutcome> | null = null;

/** Persist the freshly-minted access token where fetch-api reads it. */
function storeAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

async function doRefresh(): Promise<RefreshOutcome> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.status === 401 || res.status === 403) return { kind: 'rejected' };
    if (!res.ok) return INDETERMINATE;
    const parsed = RefreshResponseSchema.safeParse(await res.json());
    if (!parsed.success) return INDETERMINATE;
    storeAccessToken(parsed.data.access_token);
    return { kind: 'ok', token: parsed.data.access_token };
  } catch {
    return INDETERMINATE;
  }
}

/** Security gate (Codex P1, ROK-1353) — see ensureFreshToken. */
function isImpersonating(): boolean {
  return localStorage.getItem(ORIGINAL_TOKEN_KEY) !== null;
}

function sharedRefresh(): Promise<RefreshOutcome> {
  if (!inFlight) {
    inFlight = doRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Like `ensureFreshToken`, but reports WHY a refresh produced no token, and
 * shares the same single-flight request. While impersonating it never touches
 * the network and reports 'rejected' (the refresh cookie is the admin's).
 */
export function refreshWithOutcome(): Promise<RefreshOutcome> {
  if (isImpersonating()) return Promise.resolve({ kind: 'rejected' });
  return sharedRefresh();
}

/**
 * Refresh the access token via the httpOnly cookie. Returns the new token,
 * or null if the cookie is missing/expired/revoked or the refresh failed.
 * Single-flight: parallel calls share one network request.
 */
export function ensureFreshToken(): Promise<string | null> {
  // Security gate (Codex P1, ROK-1353): during impersonation the bearer is
  // the IMPERSONATED user's token but the refresh cookie belongs to the
  // admin. Refreshing here would silently switch the request identity back
  // to the admin — refuse and let the 401 surface instead.
  if (isImpersonating()) return Promise.resolve(null);
  return sharedRefresh().then((o) => (o.kind === 'ok' ? o.token : null));
}
