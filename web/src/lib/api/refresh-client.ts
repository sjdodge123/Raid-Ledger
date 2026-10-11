import { API_BASE_URL } from '../config';
import { RefreshResponseSchema } from '@raid-ledger/contract';
import { ACCESS_TOKEN_KEY, ORIGINAL_TOKEN_KEY } from './auth-storage-keys';
import { isTokenStale } from './token-expiry';
import { getAuthMethod } from './silent-reauth';
import {
  endDeactivatedSession,
  isDeactivatedResponse,
  readErrorCode,
} from './deactivated-session';

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
 *
 * ROK-1753: a 401 `USER_DEACTIVATED` is terminal — the session is ended in
 * shared storage, and a tab that queued on the lock sees it cleared and
 * reports 'rejected' without a POST.
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
const REJECTED: RefreshOutcome = { kind: 'rejected' };
const LOCK_NAME = 'rl-refresh';

let inFlight: Promise<RefreshOutcome> | null = null;

/** Persist the freshly-minted access token where fetch-api reads it. */
function storeAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

/** 401/403 → rejected; a deactivated account also ends the session (ROK-1753). */
async function rejectedOutcome(res: Response): Promise<RefreshOutcome> {
  if (await isDeactivatedResponse(res)) endDeactivatedSession();
  return REJECTED;
}

async function postRefresh(): Promise<PostOutcome> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.status === 401 || res.status === 403) return await rejectedOutcome(res);
    if (res.status === 409 && (await readErrorCode(res)) === 'refresh_raced') {
      return { kind: 'raced' };
    }
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

function isLockManager(value: unknown): value is LockManager {
  return typeof value === 'object' && value !== null
    && 'request' in value && typeof value.request === 'function';
}

function lockManager(): LockManager | null {
  if (typeof navigator === 'undefined') return null;
  const candidate: unknown = navigator.locks;
  return isLockManager(candidate) ? candidate : null;
}

/** What this tab saw when its refresh started (before any lock wait). */
interface RefreshStart {
  token: string | null;
  method: string | null;
}

/**
 * Runs once this tab holds the lock. Shared storage may have changed while it
 * queued, so the gates are re-checked here (ROK-1755 nits, ROK-1753):
 * impersonation that began meanwhile must not POST (the cookie is the admin's),
 * and a session a sibling ended (logout / deactivation) must not be revived.
 */
function refreshUnderLock(start: RefreshStart): Promise<RefreshOutcome> {
  if (isImpersonating()) return Promise.resolve(INDETERMINATE);
  if (start.method !== null && getAuthMethod() === null) return Promise.resolve(REJECTED);
  const adopted = siblingToken(start.token);
  return adopted ? Promise.resolve(adopted) : refreshAndSettle(start.token);
}

async function doRefresh(): Promise<RefreshOutcome> {
  const start: RefreshStart = {
    token: localStorage.getItem(ACCESS_TOKEN_KEY),
    method: getAuthMethod(),
  };
  const locks = lockManager();
  if (!locks) return refreshUnderLock(start);
  try {
    return await locks.request(LOCK_NAME, () => refreshUnderLock(start));
  } catch {
    // The lock itself failed (e.g. an opaque origin) — refresh unlocked.
    return refreshUnderLock(start);
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
