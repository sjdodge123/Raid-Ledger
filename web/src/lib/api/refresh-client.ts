import { API_BASE_URL } from '../config';
import { RefreshResponseSchema } from '@raid-ledger/contract';
import { getAccessToken, setAccessToken } from './access-token-store';
import { getAuthMethod } from './silent-reauth';
import { isTokenStale } from './token-expiry';
import {
  endDeactivatedSession,
  isDeactivatedResponse,
  readErrorCode,
} from './deactivated-session';
import { nativeFetch } from './native-fetch';
import { httpStatusOf } from './api-error';

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

/** >0 while this tab holds `rl-refresh` for `installSessionExclusively` (ROK-1820). */
let installDepth = 0;

/**
 * Identity generation (review m1). Impersonation start/exit and a cross-tab
 * identity change bump it; a refresh whose POST began under an older
 * generation must not install its token over the new identity.
 */
let generation = 0;

/** The held identity changed: in-flight refreshes may no longer install a token. */
export function bumpRefreshGeneration(): void {
  generation += 1;
}

/** 401/403 → rejected; a deactivated account also ends the session (ROK-1753). */
async function rejectedOutcome(res: Response): Promise<RefreshOutcome> {
  if (await isDeactivatedResponse(res)) endDeactivatedSession();
  return REJECTED;
}

async function postRefresh(): Promise<PostOutcome> {
  const startedAt = generation;
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
    if (generation !== startedAt) return INDETERMINATE;
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
  // A refresh asked for while this tab holds the lock for a session install
  // would queue behind it forever (the install may be awaiting this very
  // refresh) — answer indeterminate, which never clears the session.
  if (installDepth > 0) return Promise.resolve(INDETERMINATE);
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

/**
 * A refresh that STARTS after this call (review m1): bump the generation, wait
 * out any in-flight POST (sent under the old identity), then refresh anew.
 */
export async function freshRefresh(): Promise<RefreshOutcome> {
  bumpRefreshGeneration();
  if (inFlight) await inFlight;
  return sharedRefresh();
}

/** Runs `issue`, then bumps the generation — still inside the lock when locked. */
async function issueThenBump<T>(issue: () => Promise<T>): Promise<T> {
  try {
    return await issue();
  } finally {
    bumpRefreshGeneration();
  }
}

async function underInstallLock<T>(
  locks: LockManager,
  issue: () => Promise<T>,
  entered: { value: boolean },
): Promise<T> {
  return locks.request(LOCK_NAME, async () => {
    entered.value = true;
    installDepth += 1;
    try {
      return await issueThenBump(issue);
    } finally {
      installDepth -= 1;
    }
  });
}

/**
 * Locked when Web Locks exist. If the lock request itself fails (e.g. an
 * opaque origin) the install runs unlocked, as `doRefresh` does; an error
 * thrown by `issue` under the lock is rethrown, never retried.
 */
async function issueFenced<T>(issue: () => Promise<T>): Promise<T> {
  const locks = lockManager();
  if (!locks) return issueThenBump(issue);
  const entered = { value: false };
  try {
    return await underInstallLock(locks, issue, entered);
  } catch (err) {
    if (entered.value) throw err;
    return issueThenBump(issue);
  }
}

/**
 * ROK-1820: run a request that ISSUES a new session (a password change that
 * revokes every session and re-mints one) so no refresh can land on top of it.
 *
 * - A stale access token is refreshed FIRST, unlocked: under the lock every
 *   in-tab refresh answers indeterminate, so the request would 401 unretried.
 * - The request runs under the `rl-refresh` Web Lock, so no refresh POST from
 *   any tab of this browser is in flight while it runs: a sibling's rotated
 *   `rl_rt` Set-Cookie lands BEFORE the re-issued cookie, never after it.
 * - The generation is bumped before the request and again before the lock is
 *   released, so a refresh that began under the pre-change session — or
 *   queued behind the install — is dropped instead of overwriting the
 *   re-issued access token.
 * - A 401 under the lock (an unexpired but revoked token — another tab changed
 *   the password) can't refresh there, so the lock is released, ONE normal
 *   refresh runs, and the request is retried once under a fresh fence. A 401
 *   is rejected by the auth guard before the handler, so the retry is safe.
 *
 * Known gap: without `navigator.locks`, a refresh that passed the server's
 * revoke re-check just before the change can still deliver its (now revoked)
 * `rl_rt` Set-Cookie AFTER the re-issued one; the generation only guards the
 * access token, so the next refresh 401s and signs the user out.
 */
export async function installSessionExclusively<T>(issue: () => Promise<T>): Promise<T> {
  if (getAuthMethod() && isTokenStale(getAccessToken())) await ensureFreshToken();
  const first = await attemptInstall(issue);
  if (!first.unauthorized || !getAuthMethod()) return first.settle();
  // Outside the lock now, a normal refresh can run. `freshRefresh` never joins
  // a pre-change POST, whose token the generation bump would drop anyway.
  if ((await freshRefresh()).kind !== 'ok') return first.settle();
  return (await attemptInstall(issue)).settle();
}

/** One fenced attempt: its outcome, replayable, plus whether it was a 401. */
interface InstallAttempt<T> {
  settle: () => T;
  unauthorized: boolean;
}

/** True for a 401 thrown by `fetchApi` or returned by `fetchWithAuth`. */
function isUnauthorized(outcome: unknown): boolean {
  if (outcome instanceof Response) return outcome.status === 401;
  return httpStatusOf(outcome) === 401;
}

async function attemptInstall<T>(issue: () => Promise<T>): Promise<InstallAttempt<T>> {
  bumpRefreshGeneration();
  try {
    const value = await issueFenced(issue);
    return { settle: () => value, unauthorized: isUnauthorized(value) };
  } catch (err) {
    return { settle: () => { throw err; }, unauthorized: isUnauthorized(err) };
  }
}
