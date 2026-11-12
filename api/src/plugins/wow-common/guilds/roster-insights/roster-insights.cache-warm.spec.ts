/**
 * ROK-2178 (R2) — after an invalidation the cache recomputes, in the
 * background, only the keys of that guild that were cached, through the
 * generation guard, at most one recompute in flight per key.
 */
import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import type * as schema from '../../../../drizzle/schema';
import { _resetInFlightRefreshes } from '../../../../common/swr-cache';
import {
  RosterInsightsCache,
  insightsKey,
  type InsightsRecompute,
} from './roster-insights.cache';

const dto = (tag: string): WowRosterInsightsDto =>
  ({ classes: [{ class: tag, count: 1 }] }) as unknown as WowRosterInsightsDto;

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const MEMBER_ALL = insightsKey(1, 'member', false);
const VISITOR_MAINS = insightsKey(1, 'visitor', true);

/** A cache with `keys` already cached and `recompute` registered. */
async function seeded(
  recompute: jest.Mock<ReturnType<InsightsRecompute>, Parameters<InsightsRecompute>>,
  keys: string[],
): Promise<RosterInsightsCache> {
  const cache = new RosterInsightsCache(
    {} as unknown as PostgresJsDatabase<typeof schema>,
  );
  cache.registerRecompute(recompute);
  for (const key of keys)
    await cache.get(key, jest.fn().mockResolvedValue(dto('old')));
  return cache;
}

const recomputeMock = () =>
  jest.fn<ReturnType<InsightsRecompute>, Parameters<InsightsRecompute>>();

beforeEach(() => _resetInFlightRefreshes());
afterEach(() => jest.restoreAllMocks());

describe('RosterInsightsCache warm after invalidation (ROK-2178 R2)', () => {
  it('recomputes each cached key once without a get; the next get is a hit', async () => {
    const recompute = recomputeMock().mockResolvedValue(dto('warm'));
    const cache = await seeded(recompute, [MEMBER_ALL, VISITOR_MAINS]);
    cache.invalidateGuild(1);
    expect(recompute).toHaveBeenCalledTimes(2);
    expect(recompute).toHaveBeenCalledWith(1, 'member', false);
    expect(recompute).toHaveBeenCalledWith(1, 'visitor', true);
    const getFetcher = jest.fn().mockResolvedValue(dto('miss'));
    expect(await cache.get(MEMBER_ALL, getFetcher)).toEqual(dto('warm'));
    expect(await cache.get(VISITOR_MAINS, getFetcher)).toEqual(dto('warm'));
    expect(getFetcher).not.toHaveBeenCalled();
    expect(recompute).toHaveBeenCalledTimes(2);
  });

  it('does not recompute a key that was not cached, nor another guild', async () => {
    const recompute = recomputeMock().mockResolvedValue(dto('warm'));
    const cache = await seeded(recompute, [
      MEMBER_ALL,
      insightsKey(10, 'member', false),
    ]);
    cache.invalidateGuild(1);
    expect(recompute).toHaveBeenCalledTimes(1);
    expect(recompute).toHaveBeenCalledWith(1, 'member', false);
  });

  it('coalesces repeated invalidations and never stores a superseded result', async () => {
    const stale = deferred<WowRosterInsightsDto>();
    const fresh = deferred<WowRosterInsightsDto>();
    const recompute = recomputeMock()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const cache = await seeded(recompute, [MEMBER_ALL]);
    cache.invalidateGuild(1);
    cache.invalidateGuild(1);
    cache.invalidateGuild(1);
    expect(recompute).toHaveBeenCalledTimes(1);
    stale.resolve(dto('stale'));
    fresh.resolve(dto('fresh'));
    const getFetcher = jest.fn().mockResolvedValue(dto('miss'));
    expect(await cache.get(MEMBER_ALL, getFetcher)).toEqual(dto('fresh'));
    expect(recompute).toHaveBeenCalledTimes(2);
    expect(getFetcher).not.toHaveBeenCalled();
  });

  it('logs a failed recompute and leaves the key absent', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const recompute = recomputeMock().mockRejectedValue(new Error('db down'));
    const cache = await seeded(recompute, [MEMBER_ALL]);
    cache.invalidateGuild(1);
    const getFetcher = jest.fn().mockResolvedValue(dto('miss'));
    expect(await cache.get(MEMBER_ALL, getFetcher)).toEqual(dto('miss'));
    expect(getFetcher).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`${MEMBER_ALL}: db down`),
    );
  });
});
