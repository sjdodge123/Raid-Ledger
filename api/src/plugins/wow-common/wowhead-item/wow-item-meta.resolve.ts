/**
 * ROK-1727: resolve one item to a `wow_item_meta` row — env 16 (Forever)
 * first, env 4 (Classic) fallback, else `not_found`. A retryable failure
 * (429 / 5xx / network) is retried in-run up to WOWHEAD_MAX_TRIES_PER_RUN
 * times, then stored as `error` with a backoff `next_retry_at`.
 */
import * as wowheadFetch from './wowhead-item.fetch';
import {
  createWowheadLimiter,
  errorRetryOffsetMs,
  retryDelayMs,
  WOWHEAD_MAX_TRIES_PER_RUN,
  type WowheadLimiter,
} from './wowhead-item.limiter';
import {
  WOWHEAD_ENV_CLASSIC,
  WOWHEAD_ENV_FOREVER,
  type WowheadEnv,
  type WowheadFetch,
  type WowheadFetchResult,
  type WowItemMetaInsert,
} from './wowhead-item.types';

const DAY_MS = 86_400_000;
/** `resolved` rows: long cache. */
export const RESOLVED_TTL_MS = 30 * DAY_MS;
/** `classic_fallback` / `not_found` rows: daily re-probe (AC). */
export const RECHECK_TTL_MS = DAY_MS;

/** Injectable I/O for the resolver (tests replace any of it). */
export interface WowheadResolverDeps {
  fetchFn: WowheadFetch;
  limiter: WowheadLimiter;
  wait: (ms: number) => Promise<void>;
  now: () => Date;
  /** Kill switch, re-read before EVERY scheduled fetch (Codex MEDIUM). */
  isEnabled: () => Promise<boolean>;
}

/** Thrown inside a limiter task when the kill switch is off: stop, write nothing. */
export class WowheadResolverDisabledError extends Error {
  constructor() {
    super('Wowhead resolver switched off');
    this.name = 'WowheadResolverDisabledError';
  }
}

/** Nest token for overriding {@link WowheadResolverDeps} in tests. */
export const WOWHEAD_RESOLVER_DEPS = Symbol('WOWHEAD_RESOLVER_DEPS');

export function defaultResolverDeps(): WowheadResolverDeps {
  return {
    fetchFn: (url, init) => globalThis.fetch(url, init),
    limiter: createWowheadLimiter(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    isEnabled: () => Promise.resolve(true),
  };
}

/** One (item, env) through the limiter, retrying retryable results. */
async function fetchWithRetry(
  itemId: number,
  env: WowheadEnv,
  deps: WowheadResolverDeps,
): Promise<WowheadFetchResult> {
  let last: WowheadFetchResult = { kind: 'retryable', status: null };
  for (let tries = 0; tries < WOWHEAD_MAX_TRIES_PER_RUN; tries++) {
    if (tries > 0) await deps.wait(retryDelayMs(tries));
    last = await deps.limiter.schedule(async () => {
      if (!(await deps.isEnabled())) throw new WowheadResolverDisabledError();
      return wowheadFetch.fetchWowheadItem(itemId, env, deps.fetchFn);
    });
    if (last.kind !== 'retryable') return last;
  }
  return last;
}

const EMPTY = { env: null, name: null, quality: null, icon: null };

/** Row for a hit: env 16 = `resolved` (30 d), env 4 = `classic_fallback` (24 h). */
function foundRow(
  itemId: number,
  env: WowheadEnv,
  res: Extract<WowheadFetchResult, { kind: 'found' }>,
  fetchedAt: Date,
): WowItemMetaInsert {
  const forever = env === WOWHEAD_ENV_FOREVER;
  const ttl = forever ? RESOLVED_TTL_MS : RECHECK_TTL_MS;
  return {
    itemId,
    status: forever ? 'resolved' : 'classic_fallback',
    env,
    name: res.name,
    quality: res.quality,
    icon: res.icon,
    fetchedAt,
    nextRetryAt: new Date(fetchedAt.getTime() + ttl),
    attempts: 0,
  };
}

/** The row for one env's outcome; null = not found there, try the next env. */
function rowFor(
  itemId: number,
  env: WowheadEnv,
  res: WowheadFetchResult,
  prevAttempts: number,
  fetchedAt: Date,
): WowItemMetaInsert | null {
  const at = (ms: number) => new Date(fetchedAt.getTime() + ms);
  if (res.kind === 'not_found') return null;
  if (res.kind === 'retryable') {
    const attempts = prevAttempts + 1;
    const nextRetryAt = at(errorRetryOffsetMs(attempts));
    return {
      itemId,
      status: 'error',
      ...EMPTY,
      fetchedAt,
      nextRetryAt,
      attempts,
    };
  }
  return foundRow(itemId, env, res, fetchedAt);
}

/**
 * Probe env 16 then env 4. `prevAttempts` is the row's consecutive error
 * count (0 for a new item); any non-error outcome resets it.
 */
export async function resolveItem(
  itemId: number,
  prevAttempts: number,
  deps: WowheadResolverDeps,
): Promise<WowItemMetaInsert> {
  for (const env of [WOWHEAD_ENV_FOREVER, WOWHEAD_ENV_CLASSIC]) {
    const res = await fetchWithRetry(itemId, env, deps);
    const row = rowFor(itemId, env, res, prevAttempts, deps.now());
    if (row) return row;
  }
  const fetchedAt = deps.now();
  const nextRetryAt = new Date(fetchedAt.getTime() + RECHECK_TTL_MS);
  return {
    itemId,
    status: 'not_found',
    ...EMPTY,
    fetchedAt,
    nextRetryAt,
    attempts: 0,
  };
}
