/**
 * ROK-1755: bounded concurrent-refresh grace.
 *
 * A parent rotated within `RACE_GRACE_MS` may mint ONE sibling (multi-tab
 * session restore racing on one cookie). The "once" is an atomic Redis
 * `SET NX PX` keyed on the parent row, so a captured token replayed inside
 * the window can no longer fork unlimited live chains: the second replay is
 * reuse → family revoke + blocklist. Was 60 s and uncapped (ROK-1353).
 */
/** Grace window for a race-loser sibling (AC: ≤ 10 s). */
export const RACE_GRACE_MS = 10_000;

const GRACE_KEY_PREFIX = 'refresh_grace:';

/** `claimed` = this caller won the one sibling; `error` = Redis failed. */
export type GraceClaim = 'claimed' | 'used' | 'error';

/** What to do with a replay of an already-rotated (not revoked) token. */
export type ReplayVerdict = 'sibling' | 'reuse' | 'reject';

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
      RACE_GRACE_MS,
      'NX',
    );
    return ok === 'OK' ? 'claimed' : 'used';
  } catch {
    return 'error';
  }
}

/**
 * Inside the window: first claim → sibling, later claims → reuse. A Redis
 * failure → plain 401 (no revoke: an outage must not log out every
 * multi-tab user). Outside the window → reuse, as before.
 */
export function replayVerdict(
  rotatedAgoMs: number,
  claim: () => Promise<GraceClaim>,
): Promise<ReplayVerdict> {
  if (rotatedAgoMs > RACE_GRACE_MS) return Promise.resolve('reuse');
  return claim().then((result) => {
    if (result === 'claimed') return 'sibling';
    return result === 'used' ? 'reuse' : 'reject';
  });
}
