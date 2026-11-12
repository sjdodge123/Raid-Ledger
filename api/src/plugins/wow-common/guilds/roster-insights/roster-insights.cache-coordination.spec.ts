/**
 * ROK-2178 review — the insights cache bounds its background work: only keys
 * read within the TTL are re-warmed, at most two warms run process-wide, one
 * compute per key is ever in flight (SWR refresh, miss and warm share it), the
 * retry cap holds, and shutdown stops new warms and waits for running ones.
 */
import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import type * as schema from '../../../../drizzle/schema';
import {
  ROSTER_INSIGHTS_TTL_MS,
  RosterInsightsCache,
  insightsKey,
  type InsightsRecompute,
} from './roster-insights.cache';

/** Mirrors `MAX_CONCURRENT_WARMS` (literal, so the spec states the bound). */
const WARM_CAP = 2;
const K1 = insightsKey(1, 'member', false);

const dto = (tag: string): WowRosterInsightsDto =>
  ({ classes: [{ class: tag, count: 1 }] }) as unknown as WowRosterInsightsDto;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

const flush = (): Promise<void> =>
  new Promise<void>((r) => {
    setImmediate(r);
  });

type RecomputeMock = jest.Mock<
  ReturnType<InsightsRecompute>,
  Parameters<InsightsRecompute>
>;
const recomputeMock = (): RecomputeMock =>
  jest.fn<ReturnType<InsightsRecompute>, Parameters<InsightsRecompute>>();

function makeCache(recompute: RecomputeMock): RosterInsightsCache {
  const cache = new RosterInsightsCache(
    {} as unknown as PostgresJsDatabase<typeof schema>,
  );
  cache.registerRecompute(recompute);
  return cache;
}

async function seed(cache: RosterInsightsCache, keys: string[]): Promise<void> {
  for (const key of keys)
    await cache.get(key, () => Promise.resolve(dto('old')));
}

/** A recompute whose every call parks on a deferred the test settles. */
function parkedRecompute(): {
  recompute: RecomputeMock;
  pending: Deferred<WowRosterInsightsDto>[];
} {
  const pending: Deferred<WowRosterInsightsDto>[] = [];
  const recompute = recomputeMock().mockImplementation(() => {
    const d = deferred<WowRosterInsightsDto>();
    pending.push(d);
    return d.promise;
  });
  return { recompute, pending };
}

let now = 1_000_000;
beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

describe('RosterInsightsCache warms only keys still in demand', () => {
  it('does not re-warm a key nobody read since its last warm', async () => {
    const recompute = recomputeMock().mockResolvedValue(dto('warm'));
    const cache = makeCache(recompute);
    await seed(cache, [K1]);
    cache.invalidateGuild(1);
    await flush();
    expect(recompute).toHaveBeenCalledTimes(1);
    now += ROSTER_INSIGHTS_TTL_MS + 1;
    cache.invalidateGuild(1);
    await flush();
    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('re-warms a key read after its finished warm', async () => {
    const recompute = recomputeMock().mockResolvedValue(dto('warm'));
    const cache = makeCache(recompute);
    await seed(cache, [K1]);
    cache.invalidateGuild(1);
    await flush();
    const getFetcher = jest.fn().mockResolvedValue(dto('miss'));
    expect(await cache.get(K1, getFetcher)).toEqual(dto('warm'));
    cache.invalidateGuild(1);
    await flush();
    expect(recompute).toHaveBeenCalledTimes(2);
    expect(getFetcher).not.toHaveBeenCalled();
  });

  it('schedules a fresh warm after a failed one', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const recompute = recomputeMock()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(dto('warm'));
    const cache = makeCache(recompute);
    await seed(cache, [K1]);
    cache.invalidateGuild(1);
    await flush();
    cache.invalidateGuild(1);
    await flush();
    expect(recompute).toHaveBeenCalledTimes(2);
    const getFetcher = jest.fn().mockResolvedValue(dto('miss'));
    expect(await cache.get(K1, getFetcher)).toEqual(dto('warm'));
  });
});

describe('RosterInsightsCache bounds concurrent computes', () => {
  it(`never runs more than ${WARM_CAP} warms at once across a batch of guilds`, async () => {
    const { recompute, pending } = parkedRecompute();
    const cache = makeCache(recompute);
    const guilds = [1, 2, 3, 4, 5];
    await seed(
      cache,
      guilds.map((g) => insightsKey(g, 'member', false)),
    );
    for (const g of guilds) cache.invalidateGuild(g);
    expect(recompute).toHaveBeenCalledTimes(WARM_CAP);
    for (let i = 0; i < guilds.length; i++) {
      must(pending[i], `warm ${i}`).resolve(dto('w'));
      await flush();
      const running = recompute.mock.calls.length - (i + 1);
      expect(running).toBeLessThanOrEqual(WARM_CAP);
    }
    expect(recompute).toHaveBeenCalledTimes(guilds.length);
  });

  it('an invalidation during an in-flight SWR refresh adds one compute, not two', async () => {
    const refresh = deferred<WowRosterInsightsDto>();
    const compute = recomputeMock()
      .mockResolvedValueOnce(dto('old'))
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValue(dto('post'));
    const cache = makeCache(compute);
    const fetcher = (): Promise<WowRosterInsightsDto> =>
      compute(1, 'member', false);
    await cache.get(K1, fetcher);
    now += ROSTER_INSIGHTS_TTL_MS * 0.9;
    expect(await cache.get(K1, fetcher)).toEqual(dto('old'));
    cache.invalidateGuild(1);
    const after = cache.get(K1, fetcher);
    refresh.resolve(dto('pre'));
    expect(await after).toEqual(dto('post'));
    await flush();
    // seed + stale refresh (superseded) + ONE post-invalidation compute.
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('gives up after 3 superseded attempts; the next get computes', async () => {
    const holder: { cache?: RosterInsightsCache } = {};
    const recompute = recomputeMock().mockImplementation(async () => {
      await Promise.resolve();
      holder.cache?.invalidateGuild(1);
      return dto('superseded');
    });
    const cache = makeCache(recompute);
    holder.cache = cache;
    await seed(cache, [K1]);
    cache.invalidateGuild(1);
    await flush();
    expect(recompute).toHaveBeenCalledTimes(3);
    const getFetcher = jest.fn().mockResolvedValue(dto('miss'));
    expect(await cache.get(K1, getFetcher)).toEqual(dto('miss'));
    expect(getFetcher).toHaveBeenCalledTimes(1);
  });
});

describe('RosterInsightsCache.onModuleDestroy', () => {
  it('waits for running warms, drops queued ones, and logs nothing after', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { recompute, pending } = parkedRecompute();
    const cache = makeCache(recompute);
    await seed(
      cache,
      [1, 2, 3].map((g) => insightsKey(g, 'member', false)),
    );
    for (const g of [1, 2, 3]) cache.invalidateGuild(g);
    let closed = false;
    const closing = cache.onModuleDestroy().then(() => {
      closed = true;
    });
    await flush();
    expect(closed).toBe(false);
    must(pending[0], 'warm 0').resolve(dto('w'));
    must(pending[1], 'warm 1').reject(new Error('pool ended'));
    await closing;
    cache.invalidateGuild(1);
    await flush();
    expect(recompute).toHaveBeenCalledTimes(WARM_CAP);
    expect(warn).not.toHaveBeenCalled();
  });
});
