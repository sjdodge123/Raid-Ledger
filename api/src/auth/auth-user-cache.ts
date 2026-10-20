/**
 * In-process TTL cache for JWT-validated user data (ROK-701).
 *
 * Eliminates redundant `SELECT role, discord_id FROM users` queries
 * on every guarded request. Keyed by user ID with a short TTL (30s).
 *
 * Invalidation: call `invalidateAuthUser(userId)` whenever role or
 * discordId changes (e.g. UsersService.setRole / linkDiscord / unlinkDiscord)
 * and after every token-version bump (ROK-1823).
 *
 * ROK-1823 D9 stale-cache guard: a loader captures `authUserEpoch(userId)`
 * BEFORE its SELECT and passes it to `setCachedAuthUser`; an invalidation
 * that ran meanwhile changes the epoch, so the (possibly pre-bump) row is
 * returned to that one request but never cached for the next 30 s.
 */
import type { UserRole } from '@raid-ledger/contract';

export interface CachedAuthUser {
  role: UserRole;
  discordId: string | null;
  deactivatedAt: Date | null;
  /** ROK-313: kick/ban state cached alongside role for the per-request lockout
   * in jwt.strategy. Invalidated (like role) whenever moderation state changes. */
  kickedAt: Date | null;
  bannedAt: Date | null;
  banReason: string | null;
  /** ROK-1823: `users.token_version`, compared against the token's `tv`. */
  tokenVersion: number;
}

interface CacheEntry {
  data: CachedAuthUser;
  expiresAt: number;
}

/** TTL in milliseconds — 30 seconds. */
export const AUTH_USER_CACHE_TTL_MS = 30_000;

const cache = new Map<number, CacheEntry>();

/** Per-user invalidation epochs. Every value comes from one counter, so an
 * epoch never repeats — not even across `clearAuthUserCache`. */
const epochs = new Map<number, number>();
let epochSeq = 0;
/** The epoch of every user with no entry in `epochs`; reset by a clear. */
let baseEpoch = 0;

/** Capture BEFORE loading a user; hand the value to `setCachedAuthUser`. */
export function authUserEpoch(userId: number): number {
  return epochs.get(userId) ?? baseEpoch;
}

/** Get a cached auth user entry, or null if missing/expired. */
export function getCachedAuthUser(userId: number): CachedAuthUser | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(userId);
    return null;
  }
  return entry.data;
}

/**
 * Store an auth user entry with TTL. With `loadEpoch` (the value of
 * `authUserEpoch` captured before the load), the entry is dropped when
 * `userId` was invalidated since — the stale-cache guard.
 */
export function setCachedAuthUser(
  userId: number,
  data: CachedAuthUser,
  loadEpoch?: number,
): void {
  if (loadEpoch !== undefined && loadEpoch !== authUserEpoch(userId)) return;
  cache.set(userId, {
    data,
    expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
  });
}

/** Invalidate a single user's cached entry. */
export function invalidateAuthUser(userId: number): void {
  cache.delete(userId);
  epochs.set(userId, ++epochSeq);
}

/** Clear the entire cache (useful for testing). */
export function clearAuthUserCache(): void {
  cache.clear();
  epochs.clear();
  baseEpoch = ++epochSeq;
}
