import { API_BASE_URL } from '../config';
import { RefreshResponseSchema } from '@raid-ledger/contract';
import { setAccessToken } from './access-token-store';
import { getAuthMethod } from './silent-reauth';
import {
  endDeactivatedSession,
  isDeactivatedResponse,
  readErrorCode,
} from './deactivated-session';
import { nativeFetch } from './native-fetch';

/**
 * ROK-1353: single-flight access-token refresh.
 *
 * On a 401, callers invoke `ensureFreshToken()`. Concurrent callers in ONE tab
 * all await the SAME in-flight POST (`inFlight`). The raw refresh token lives
 * only in the httpOnly `rl_rt` cookie; this module never sees it.
 *
 * ROK-1755 B1 / ROK-1754: tabs in one browser share that cookie, but each
 * tab holds its own in-memory token. The POST runs under the `rl-refresh` Web
 * Lock, which serialises tabs: by the time a waiting tab holds it, the
 * winner's response has already put the rotated cookie in the shared jar, so
 * the waiter rotates normally — no token is ever shared through storage. The
 * server's 10s race grace answers a replay inside the window (an old bundle,
 * or a browser without `navigator.locks`) with a non-revoking 409
 * `refresh_raced`: retried once, else indeterminate — never a reason to clear.
 *
 * ROK-1754 (D1): impersonation is renewed SERVER-side — the refresh mints the
 * impersonation token while the family's marker is live — so refresh is no
 * longer gated off while impersonating.
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

/** 401/403 → rejected; a deactivated account also ends the session (ROK-1753). */
async function rejectedOutcome(res: Response): Promise<RefreshOutcome> {
  if (await isDeactivatedResponse(res)) endDeactivatedSession();
  return REJECTED;
}

async function postRefresh(): Promise<PostOutcome> {
  try {
    const res = await nativeFetch(`${API_BASE_URL}/auth/refresh`, {
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
    setAccessToken(parsed.data.access_token);
    return { kind: 'ok', token: parsed.data.access_token };
  } catch {
    return INDETERMINATE;
  }
}

/** Lost a race (409): retry ONCE with the rotated cookie, else indeterminate. */
async function refreshAndSettle(): Promise<RefreshOutcome> {
  const outcome = await postRefresh();
  if (outcome.kind !== 'raced') return outcome;
  const retry = await postRefresh();
  return retry.kind === 'raced' ? INDETERMINATE : retry;
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

/**
 * Runs once this tab holds the lock. A sibling may have ended the session
 * (logout / deactivation clears the shared auth-method marker) while this tab
 * queued — that session must not be revived (ROK-1753).
 */
function refreshUnderLock(startMethod: string | null): Promise<RefreshOutcome> {
  if (startMethod !== null && getAuthMethod() === null) return Promise.resolve(REJECTED);
  return refreshAndSettle();
}

async function doRefresh(): Promise<RefreshOutcome> {
  const start = getAuthMethod();
  const locks = lockManager();
  if (!locks) return refreshUnderLock(start);
  try {
    return await locks.request(LOCK_NAME, () => refreshUnderLock(start));
  } catch {
    // The lock itself failed (e.g. an opaque origin) — refresh unlocked.
    return refreshUnderLock(start);
  }
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
 * shares the same single-flight request.
 */
export function refreshWithOutcome(): Promise<RefreshOutcome> {
  return sharedRefresh();
}

/**
 * Refresh the access token via the httpOnly cookie. Returns the new token,
 * or null if the cookie is missing/expired/revoked or the refresh failed.
 * Single-flight: parallel calls share one network request.
 */
export function ensureFreshToken(): Promise<string | null> {
  return sharedRefresh().then((o) => (o.kind === 'ok' ? o.token : null));
}
