/**
 * ROK-1893 P1 (§8d) — how long a bot-made Discord server invite may be
 * reused from the per-hub cache. `createInvite({ unique: false })` can hand
 * back the bot's EXISTING invite, which may be close to its own expiry, so
 * the cache lives until the invite's `expiresAt` minus a safety margin —
 * never longer than {@link MAX_CACHE_MS}.
 */

/** Upper bound for any cached invite (a fresh 24h invite is reused ~23h). */
export const MAX_CACHE_MS = 23 * 3_600_000;
/** Stop handing out an invite this long before Discord expires it. */
export const EXPIRY_MARGIN_MS = 60 * 60_000;
/** A failed mint is cached briefly so a broken setup is not retried per view. */
export const FAILURE_CACHE_MS = 5 * 60_000;

/**
 * Cache lifetime for an invite expiring at `expiresAt` (null = never
 * expires, e.g. `maxAge: 0`), seen at `now` (epoch ms). 0 = too close to its
 * expiry to hand out at all.
 */
export function inviteCacheTtlMs(expiresAt: Date | null, now: number): number {
  if (expiresAt === null) return MAX_CACHE_MS;
  const left = expiresAt.getTime() - now - EXPIRY_MARGIN_MS;
  return Math.max(0, Math.min(MAX_CACHE_MS, left));
}

/**
 * How long the public preview waits for a mint. discord.js QUEUES a
 * rate-limited request until the bucket resets (invite creation has a tight
 * one), so an unbounded await held `GET /hubs/invites/:token` open for most
 * of a minute; past this the preview answers without the Discord link.
 */
export const MINT_TIMEOUT_MS = 3_000;

/** `work`'s value, or null when it has not settled within `ms` (the work itself keeps running). */
export function withinMs<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
