/**
 * ITAD Redis cache helpers (ROK-772).
 * Extracted for file size compliance.
 */
import Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import {
  ITAD_LOOKUP_PREFIX,
  ITAD_SEARCH_PREFIX,
  ITAD_INFO_PREFIX,
  ITAD_PRICE_PREFIX,
  ITAD_LOOKUP_CACHE_TTL,
  ITAD_SEARCH_CACHE_TTL,
  ITAD_INFO_CACHE_TTL,
  ITAD_PRICE_CACHE_TTL,
} from './itad.constants';

const logger = new Logger('ItadCache');

/** Get a cached value, parsing JSON. Returns null on miss or error. */
async function getCached<T>(redis: Redis, key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    logger.warn(`Cache read error for ${key}`, err);
    return null;
  }
}

/** Set a cache value with TTL. Errors are swallowed. */
async function setCached(
  redis: Redis,
  key: string,
  value: unknown,
  ttl: number,
): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch (err) {
    logger.warn(`Cache write error for ${key}`, err);
  }
}

// ─── Lookup cache ────────────────────────────────────────────

export function getLookupCacheKey(appId: number): string {
  return `${ITAD_LOOKUP_PREFIX}${appId}`;
}

export async function getCachedLookup<T>(
  redis: Redis,
  appId: number,
): Promise<T | null> {
  return getCached<T>(redis, getLookupCacheKey(appId));
}

export async function setCachedLookup(
  redis: Redis,
  appId: number,
  data: unknown,
): Promise<void> {
  await setCached(redis, getLookupCacheKey(appId), data, ITAD_LOOKUP_CACHE_TTL);
}

// ─── Search cache ────────────────────────────────────────────

export function getSearchCacheKey(title: string, limit: number): string {
  return `${ITAD_SEARCH_PREFIX}${title.toLowerCase().trim()}:${limit}`;
}

export async function getCachedSearch<T>(
  redis: Redis,
  title: string,
  limit: number,
): Promise<T | null> {
  return getCached<T>(redis, getSearchCacheKey(title, limit));
}

export async function setCachedSearch(
  redis: Redis,
  title: string,
  limit: number,
  data: unknown,
): Promise<void> {
  await setCached(
    redis,
    getSearchCacheKey(title, limit),
    data,
    ITAD_SEARCH_CACHE_TTL,
  );
}

// ─── Info cache ──────────────────────────────────────────────

export function getInfoCacheKey(itadId: string): string {
  return `${ITAD_INFO_PREFIX}${itadId}`;
}

export async function getCachedInfo<T>(
  redis: Redis,
  itadId: string,
): Promise<T | null> {
  return getCached<T>(redis, getInfoCacheKey(itadId));
}

export async function setCachedInfo(
  redis: Redis,
  itadId: string,
  data: unknown,
): Promise<void> {
  await setCached(redis, getInfoCacheKey(itadId), data, ITAD_INFO_CACHE_TTL);
}

// ─── Price cache ─────────────────────────────────────────────

export function getPriceCacheKey(itadId: string): string {
  return `${ITAD_PRICE_PREFIX}${itadId}`;
}

export async function getCachedPrice<T>(
  redis: Redis,
  itadId: string,
): Promise<T | null> {
  return getCached<T>(redis, getPriceCacheKey(itadId));
}

export async function setCachedPrice(
  redis: Redis,
  itadId: string,
  data: unknown,
): Promise<void> {
  await setCached(redis, getPriceCacheKey(itadId), data, ITAD_PRICE_CACHE_TTL);
}
