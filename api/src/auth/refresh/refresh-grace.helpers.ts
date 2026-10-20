/**
 * ROK-1755: bounded concurrent-refresh grace.
 *
 * A parent rotated within `RACE_GRACE_MS` may mint ONE sibling (multi-tab
 * session restore racing on one cookie). The "once" is an atomic Redis
 * `SET NX PX` keyed on the parent row, so a captured token replayed inside
 * the window can no longer fork unlimited live chains: every later in-window
 * replay is `raced` → 409 `refresh_raced`, NO token and NO revoke (3+ tabs
 * sharing one cookie jar must not revoke their own family and bump the
 * user's token version). Only a replay older than the window is reuse →
 * family revoke + token-version bump (ROK-1823). Was 60 s and uncapped (ROK-1353).
 */
import {
  ConflictException,
  HttpStatus,
  ServiceUnavailableException,
  type HttpException,
} from '@nestjs/common';

/** Grace window for a race-loser sibling (AC: ≤ 10 s). */
export const RACE_GRACE_MS = 10_000;

const GRACE_KEY_PREFIX = 'refresh_grace:';

/** `claimed` = this caller won the one sibling; `error` = Redis failed. */
export type GraceClaim = 'claimed' | 'used' | 'error';

/** What to do with a replay of an already-rotated (not revoked) token. */
export type ReplayVerdict = 'sibling' | 'reuse' | 'raced' | 'unavailable';

/** Machine-readable code on the 409 an in-window race loser gets. */
export const REFRESH_RACED_CODE = 'refresh_raced';

/** The one ioredis call the claim needs (ioredis `Redis` satisfies it). */
export interface GraceRedis {
  set(
    key: string,
    value: string,
    px: 'PX',
    ms: number,
    nx: 'NX',
  ): Promise<string | null>;
}

/**
 * ROK-1754: a consumed row whose child is not issued yet is a rotation still
 * IN FLIGHT for at most this long (a request timeout, not a session).
 */
export const IN_FLIGHT_MAX_MS = 60_000;

/**
 * ROK-1754 review W1: the once-key must outlive the WHOLE window it guards.
 * A replay can be in grace from consume until consume + IN_FLIGHT_MAX_MS, or
 * until child issue + RACE_GRACE_MS (issue's re-stamp is capped at
 * consume + IN_FLIGHT_MAX_MS), so the latest in-window replay lands at most
 * RACE_GRACE_MS + IN_FLIGHT_MAX_MS after any claim. A shorter key let a
 * replay during a stall and a second one after the re-stamp BOTH mint a
 * sibling — two forked live chains (breaks ROK-1755's one-sibling rule).
 * GRACE_KEY_MARGIN_MS covers a claim that reaches Redis late (re-review nit).
 */
export const GRACE_KEY_MARGIN_MS = 5_000;
export const GRACE_KEY_TTL_MS =
  RACE_GRACE_MS + IN_FLIGHT_MAX_MS + GRACE_KEY_MARGIN_MS;

/**
 * ROK-1754: the age the race grace measures — from when the rotation's new
 * cookie could first have reached the browser, not from the consume. The
 * first child re-stamps `rotatedAt` at issue; a row with no first child yet
 * (`replacedBy` null — a grace sibling never sets it) is still in flight, so
 * a replay of it is a race loser (age 0), never theft. Fleet run
 * 2c53b4959397: a 14 s API stall between consume and child turned a reload
 * into "reuse" → an admin-wide revoke. `rotatedAgoMs` is computed in SQL on the
 * DB clock that stamped `rotatedAt` (review S2), never app `Date.now()`.
 */
export function rotationAgeMs(row: {
  rotatedAgoMs: number;
  replacedBy: string | null;
}): number {
  if (!row.replacedBy && row.rotatedAgoMs <= IN_FLIGHT_MAX_MS) return 0;
  return row.rotatedAgoMs;
}

/** Atomically take the parent's single grace sibling. */
export async function claimGraceOnce(
  redis: GraceRedis,
  parentId: string,
): Promise<GraceClaim> {
  try {
    const ok = await redis.set(
      `${GRACE_KEY_PREFIX}${parentId}`,
      '1',
      'PX',
      GRACE_KEY_TTL_MS,
      'NX',
    );
    return ok === 'OK' ? 'claimed' : 'used';
  } catch {
    return 'error';
  }
}

/**
 * Inside the window: first claim → sibling, later claims → raced (409, no
 * revoke). A Redis failure → unavailable (503, no revoke: an outage must not
 * log out every multi-tab user, and a 401 would make the web clear the shared
 * access token). Outside the window → reuse, as before.
 */
export function replayVerdict(
  rotatedAgoMs: number,
  claim: () => Promise<GraceClaim>,
): Promise<ReplayVerdict> {
  if (rotatedAgoMs > RACE_GRACE_MS) return Promise.resolve('reuse');
  return claim().then((result) => {
    if (result === 'claimed') return 'sibling';
    return result === 'used' ? 'raced' : 'unavailable';
  });
}

/**
 * The non-revoking error for a verdict that proves nothing about the session
 * (the web treats 409/503 as indeterminate: no logout, no storage wipe), or
 * null for `sibling` / `reuse`.
 */
export function indeterminateReplayError(
  verdict: ReplayVerdict,
): HttpException | null {
  if (verdict === 'raced') {
    return new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      code: REFRESH_RACED_CODE,
      message: 'Refresh token was just rotated by a concurrent request',
    });
  }
  if (verdict === 'unavailable') {
    return new ServiceUnavailableException({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'refresh_unavailable',
      message: 'Refresh temporarily unavailable; retry',
    });
  }
  return null;
}
