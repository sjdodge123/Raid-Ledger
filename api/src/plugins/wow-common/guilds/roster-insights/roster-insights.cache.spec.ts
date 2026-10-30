/**
 * ROK-1913 review — RosterInsightsCache: namespaced keys (the SWR in-flight
 * tracker is shared across caches) and an invalidation that lands while a
 * fetch is in flight never lets the pre-invalidation result be cached.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import type * as schema from '../../../../drizzle/schema';
import { _resetInFlightRefreshes } from '../../../../common/swr-cache';
import {
  RosterInsightsCache,
  insightsKey,
  invalidateRosterInsights,
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

const makeCache = (): RosterInsightsCache =>
  new RosterInsightsCache({} as unknown as PostgresJsDatabase<typeof schema>);

beforeEach(() => _resetInFlightRefreshes());

describe('insightsKey', () => {
  it('is namespaced so it cannot collide with another cache key', () => {
    expect(insightsKey(5, 'member', true)).toBe('ri:5:member:mains');
    expect(insightsKey(5, 'visitor', false)).toBe('ri:5:visitor:all');
  });
});

describe('RosterInsightsCache', () => {
  it('serves the cached value until the guild is invalidated', async () => {
    const cache = makeCache();
    const fetcher = jest.fn().mockResolvedValue(dto('A'));
    const key = insightsKey(1, 'member', false);
    await cache.get(key, fetcher);
    await cache.get(key, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    cache.invalidateGuild(1);
    await cache.get(key, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidating guild 1 leaves guild 10 cached (no prefix bleed)', async () => {
    const cache = makeCache();
    const fetcher = jest.fn().mockResolvedValue(dto('A'));
    await cache.get(insightsKey(10, 'member', false), fetcher);
    cache.invalidateGuild(1);
    await cache.get(insightsKey(10, 'member', false), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('an invalidation during an in-flight fetch drops the stale result', async () => {
    const cache = makeCache();
    const key = insightsKey(3, 'member', false);
    const first = deferred<WowRosterInsightsDto>();
    const fetcher = jest
      .fn<Promise<WowRosterInsightsDto>, []>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(dto('fresh'));
    const pending = cache.get(key, fetcher);
    cache.invalidateGuild(3);
    first.resolve(dto('stale'));
    expect(await pending).toEqual(dto('fresh'));
    const again = await cache.get(key, fetcher);
    expect(again).toEqual(dto('fresh'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

/** A db whose single `select … from … where` resolves to `rows`. */
function dbReturning(rows: { id: number }[]) {
  const where = jest.fn().mockResolvedValue(rows);
  const db = { select: () => ({ from: () => ({ where }) }) };
  return db as unknown as PostgresJsDatabase<typeof schema>;
}

describe('invalidateForPullScope (ROK-1917 final P2)', () => {
  it("drops every wow_guild hub of the pull's scope, and only those", async () => {
    const cache = new RosterInsightsCache(dbReturning([{ id: 7 }, { id: 9 }]));
    const fetcher = jest.fn().mockResolvedValue(dto('A'));
    for (const id of [7, 8, 9])
      await cache.get(insightsKey(id, 'member', false), fetcher);
    await cache.invalidateForPullScope({
      gameId: 1,
      region: 'us',
      guildKey: 'g',
    });
    for (const id of [7, 8, 9])
      await cache.get(insightsKey(id, 'member', false), fetcher);
    // 3 initial fetches + refetches of hubs 7 and 9 only.
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('the post-import hook invalidates the raid scope next to the character', async () => {
    const cache = {
      invalidateForCharacter: jest.fn().mockResolvedValue(undefined),
      invalidateForPullScope: jest.fn().mockResolvedValue(undefined),
    };
    const scope = { gameId: 1, region: 'us', guildKey: 'g' };
    await invalidateRosterInsights(cache, 'c1', { warn: jest.fn() }, scope);
    expect(cache.invalidateForCharacter).toHaveBeenCalledWith('c1');
    expect(cache.invalidateForPullScope).toHaveBeenCalledWith(scope);
  });
});
