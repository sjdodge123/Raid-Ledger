import { Logger } from '@nestjs/common';

/**
 * Stale-While-Revalidate (SWR) cache wrapper (ROK-605).
 *
 * Serves cached data immediately while triggering a background refresh
 * when the entry is within a configurable stale window near expiry.
 * This eliminates user-facing latency spikes from cold/expired caches
 * on external API calls (Twitch, IGDB, Blizzard).
 *
 * Features:
 * - Returns stale data immediately (no blocking)
 * - Fire-and-forget background refresh
 * - Deduplicates concurrent refresh calls per cache key
 * - Failed refreshes keep serving stale data
 */

const logger = new Logger('SWRCache');

// ---------------------------------------------------------------------------
// In-memory SWR cache (Blizzard instances, realms, etc.)
// ---------------------------------------------------------------------------

export interface MemoryCacheEntry<T> {
  data: T;
  expiresAt: number;
  /** Absolute timestamp when the entry becomes stale (triggers background refresh) */
  staleAt: number;
}

/** In-flight refresh tracker — prevents duplicate concurrent refreshes per key */
const inFlightRefreshes = new Map<string, Promise<unknown>>();

/**
 * Options for in-memory SWR cache get.
 */
export interface MemorySwrOptions<T> {
  /** The in-memory cache map to use */
  cache: Map<string, MemoryCacheEntry<T>>;
  /** Unique cache key */
  key: string;
  /** TTL in milliseconds */
  ttlMs: number;
  /** Fraction of TTL that triggers background refresh (0–1). Default: 0.2 (last 20%) */
  staleRatio?: number;
  /** Async function that fetches fresh data */
  fetcher: () => Promise<T>;
}

/**
 * Get a value from an in-memory SWR cache.
 *
 * - If the entry is fresh (before staleAt), returns it immediately.
 * - If the entry is stale (past staleAt but before expiresAt), returns it
 *   immediately AND triggers a background refresh.
 * - If the entry is expired or missing, calls fetcher synchronously (blocking).
 */
export async function memorySwr<T>(opts: MemorySwrOptions<T>): Promise<T> {
  const { cache, key, ttlMs, staleRatio = 0.2, fetcher } = opts;

  const entry = cache.get(key);
  const now = Date.now();

  if (entry) {
    if (now < entry.staleAt) {
      // Fresh — return immediately, no refresh needed
      return entry.data;
    }

    if (now < entry.expiresAt) {
      // Stale but not expired — return immediately, trigger background refresh
      triggerBackgroundRefresh(key, fetcher, (freshData: T) => {
        cache.set(key, makeMemoryEntry(freshData, ttlMs, staleRatio));
      });
      return entry.data;
    }
    // Expired — fall through to blocking fetch
  }

  // No cache or expired — blocking fetch
  const data = await fetcher();
  cache.set(key, makeMemoryEntry(data, ttlMs, staleRatio));
  return data;
}

function makeMemoryEntry<T>(
  data: T,
  ttlMs: number,
  staleRatio: number,
): MemoryCacheEntry<T> {
  const now = Date.now();
  return {
    data,
    expiresAt: now + ttlMs,
    staleAt: now + ttlMs * (1 - staleRatio),
  };
}

// ---------------------------------------------------------------------------
// Redis SWR cache (Twitch streams, IGDB search)
// ---------------------------------------------------------------------------

/**
 * Minimal Redis interface — only the methods we need.
 * Avoids coupling to the full ioredis type.
 */
interface RedisLike {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<string>;
}

export interface RedisSwrOptions {
  /** Redis client */
  redis: RedisLike;
  /** Cache key */
  key: string;
  /** TTL in seconds */
  ttlSec: number;
  /** Fraction of TTL that triggers background refresh (0–1). Default: 0.2 */
  staleRatio?: number;
  /** Async function that fetches fresh data and returns the JSON-serializable result */
  fetcher: () => Promise<unknown>;
}

/**
 * Redis SWR entry wraps the cached value with a `storedAt` timestamp
 * so we can compute the stale window on read.
 */
interface RedisSwrEnvelope {
  storedAt: number; // epoch ms
  data: unknown;
}

/**
 * Get a value from a Redis SWR cache.
 *
 * The envelope stored in Redis includes a `storedAt` timestamp so we can
 * determine whether the entry is in the stale window without an extra
 * Redis TTL query.
 */
/** Try reading from Redis cache; returns cached data or null on miss/error. */
function tryRedisRead<T>(
  raw: string | null,
  key: string,
  ttlSec: number,
  staleRatio: number,
  fetcher: () => Promise<unknown>,
  redis: RedisLike,
): T | null {
  if (!raw) return null;
  const envelope = JSON.parse(raw) as RedisSwrEnvelope;
  const staleAfterMs = ttlSec * 1000 * (1 - staleRatio);
  if (Date.now() - envelope.storedAt < staleAfterMs) return envelope.data as T;
  triggerBackgroundRefresh(key, fetcher, async (freshData: unknown) => {
    try {
      await redis.setex(
        key,
        ttlSec,
        JSON.stringify({ storedAt: Date.now(), data: freshData }),
      );
    } catch (err) {
      logger.warn(`SWR Redis write failed for ${key}: ${err}`);
    }
  });
  return envelope.data as T;
}

/** Write a fetched value to Redis, swallowing errors. */
async function writeRedisEnvelope(
  redis: RedisLike,
  key: string,
  ttlSec: number,
  data: unknown,
): Promise<void> {
  try {
    await redis.setex(
      key,
      ttlSec,
      JSON.stringify({ storedAt: Date.now(), data }),
    );
  } catch (err) {
    logger.warn(`SWR Redis write failed for ${key}: ${err}`);
  }
}

export async function redisSwr<T>(opts: RedisSwrOptions): Promise<T | null> {
  const { redis, key, ttlSec, staleRatio = 0.2, fetcher } = opts;
  try {
    const raw = await redis.get(key);
    const cached = tryRedisRead<T>(
      raw,
      key,
      ttlSec,
      staleRatio,
      fetcher,
      redis,
    );
    if (cached !== null) return cached;
  } catch (err) {
    logger.warn(`SWR Redis read failed for ${key}: ${err}`);
  }
  const data = await fetcher();
  await writeRedisEnvelope(redis, key, ttlSec, data);
  return data as T;
}

// ---------------------------------------------------------------------------
// Shared background refresh logic
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget background refresh with deduplication.
 * Only one refresh per cache key can be in-flight at a time.
 */
function triggerBackgroundRefresh<T>(
  key: string,
  fetcher: () => Promise<T>,
  onSuccess: (data: T) => void | Promise<void>,
): void {
  if (inFlightRefreshes.has(key)) {
    logger.debug(`SWR refresh already in-flight for ${key}, skipping`);
    return;
  }

  const refreshPromise = fetcher()
    .then(async (freshData) => {
      await onSuccess(freshData);
      logger.debug(`SWR background refresh completed for ${key}`);
    })
    .catch((err) => {
      logger.warn(`SWR background refresh failed for ${key}: ${err}`);
      // Failed refresh is non-fatal — stale data continues to be served
    })
    .finally(() => {
      inFlightRefreshes.delete(key);
    });

  inFlightRefreshes.set(key, refreshPromise);
}
