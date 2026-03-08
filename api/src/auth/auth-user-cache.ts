/**
 * In-process TTL cache for JWT-validated user data (ROK-701).
 *
 * Eliminates redundant `SELECT role, discord_id FROM users` queries
 * on every guarded request. Keyed by user ID with a short TTL (30s).
 *
 * Invalidation: call `invalidateAuthUser(userId)` whenever role or
 * discordId changes (e.g. UsersService.setRole / linkDiscord / unlinkDiscord).
 */
import type { UserRole } from '@raid-ledger/contract';

export interface CachedAuthUser {
  role: UserRole;
  discordId: string | null;
}

interface CacheEntry {
  data: CachedAuthUser;
  expiresAt: number;
}

/** TTL in milliseconds — 30 seconds. */
export const AUTH_USER_CACHE_TTL_MS = 30_000;

const cache = new Map<number, CacheEntry>();

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

/** Store an auth user entry with TTL. */
export function setCachedAuthUser(userId: number, data: CachedAuthUser): void {
  cache.set(userId, {
    data,
    expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
  });
}

/** Invalidate a single user's cached entry. */
export function invalidateAuthUser(userId: number): void {
  cache.delete(userId);
}

/** Clear the entire cache (useful for testing). */
export function clearAuthUserCache(): void {
  cache.clear();
}
