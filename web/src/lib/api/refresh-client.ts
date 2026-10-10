import { API_BASE_URL } from '../config';
import { RefreshResponseSchema } from '@raid-ledger/contract';
import { ACCESS_TOKEN_KEY, ORIGINAL_TOKEN_KEY } from './auth-storage-keys';
import { isTokenStale } from './token-expiry';

/**
 * ROK-1353: single-flight access-token refresh.
 *
 * On a 401, callers invoke `ensureFreshToken()`. Concurrent callers in ONE tab
 * all await the SAME in-flight POST (`inFlight`). The raw refresh token lives
 * only in the httpOnly `rl_rt` cookie; this module never sees it.
 *
 * ROK-1755 B1: tabs in one browser share that cookie, but `inFlight` is per
 * tab. So the POST runs under the `rl-refresh` Web Lock: the first tab
 * rotates, and a tab that waited re-reads localStorage and adopts the token
 * the winner stored instead of replaying the now-rotated cookie. The server's
 * 10s race grace answers a replay inside the window (an old bundle, or a
 * browser without `navigator.locks`) with a non-revoking 409 `refresh_raced`,
 * which is indeterminate here — never a reason to clear auth storage.
 */

/**
 * ROK-1366 #1384: what a refresh proved. Only a 401/403 proves the session is
 * gone ('rejected'); a 409, 429, 5xx, other status, network error or
 * unparseable 200 proves nothing ('indeterminate').
 */
export type RefreshOutcome =
  | { kind: 'ok'; token: string }
  | { kind: 'rejected' }
  | { kind: 'indeterminate' };

/** Internal: a 409 `refresh_raced` — another tab rotated this cookie first. */
type PostOutcome = RefreshOutcome | { kind: 'raced' };

const INDETERMINATE: RefreshOutcome = { kind: 'indeterminate' };
const LOCK_NAME = 'rl-refresh';

let inFlight: Promise<RefreshOutcome> | null = null;

/** Persist the freshly-minted access token where fetch-api reads it. */
function storeAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

async function isRacedResponse(res: Response): Promise<boolean> {
  if (res.status !== 409) return false;
  try {
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null
      && (body as { code?: unknown }).code === 'refresh_raced';
  } catch {
    return false;
  }
}

async function postRefresh(): Promise<PostOutcome> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.status === 401 || res.status === 403) return { kind: 'rejected' };
    if (await isRacedResponse(res)) return { kind: 'raced' };
    if (!res.ok) return INDETERMINATE;
    const parsed = RefreshResponseSchema.safeParse(await res.json());
    if (!parsed.success) return INDETERMINATE;
    storeAccessToken(parsed.data.access_token);
    return { kind: 'ok', token: parsed.data.access_token };
  } catch {
    return INDETERMINATE;
  }
}

/** A usable token another tab stored since this refresh started, if any. */
function siblingToken(startToken: string | null): RefreshOutcome | null {
  const current = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!current || current === startToken || isTokenStale(current)) return null;
  return { kind: 'ok', token: current };
}

/** Lost a race: adopt the winner's token, else retry ONCE (rotated cookie). */
async function settleRace(startToken: string | null): Promise<RefreshOutcome> {
  const adopted = siblingToken(startToken);
  if (adopted) return adopted;
  const retry = await postRefresh();
  if (retry.kind !== 'raced') return retry;
  return siblingToken(startToken) ?? INDETERMINATE;
}

async function refreshAndSettle(startToken: string | null): Promise<RefreshOutcome> {
  const outcome = await postRefresh();
  return outcome.kind === 'raced' ? settleRace(startToken) : outcome;
}

function lockManager(): LockManager | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

async function doRefresh(): Promise<RefreshOutcome> {
  const startToken = localStorage.getItem(ACCESS_TOKEN_KEY);
  const locks = lockManager();
  if (!locks) return refreshAndSettle(startToken);
  try {
    return await locks.request(LOCK_NAME, () =>
      siblingToken(startToken) ?? refreshAndSettle(startToken));
  } catch {
    // The lock itself failed (e.g. an opaque origin) — refresh unlocked.
    return refreshAndSettle(startToken);
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
 * the network (the refresh cookie is the admin's, and refreshing would swap
 * the bearer back to the admin) and reports 'indeterminate': the admin's
 * session was not probed, so nothing is proven about it (#1384).
 */
export function refreshWithOutcome(): Promise<RefreshOutcome> {
  if (isImpersonating()) return Promise.resolve(INDETERMINATE);
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
