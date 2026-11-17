import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type * as schema from '../drizzle/schema';
import { NotificationDedupService } from './notification-dedup.service';

/** A db + redis pair that records the order the two stores are written in. */
function buildOrderedStores() {
  const order: string[] = [];
  const db = {
    execute: jest.fn().mockImplementation(() => {
      order.push('db.delete');
      return Promise.resolve([]);
    }),
  };
  const redis = {
    del: jest.fn().mockImplementation(() => {
      order.push('redis.del');
      return Promise.resolve(1);
    }),
  };
  const service = new NotificationDedupService(
    db as unknown as PostgresJsDatabase<typeof schema>,
    redis as unknown as Redis,
  );
  return { order, db, redis, service };
}

describe('NotificationDedupService.releaseKey', () => {
  it('deletes the DB row BEFORE the Redis key, so a concurrent check cannot re-warm an orphan Redis key', async () => {
    const { order, redis, service } = buildOrderedStores();

    await service.releaseKey('digest:weekly:42');

    expect(order).toEqual(['db.delete', 'redis.del']);
    expect(redis.del).toHaveBeenCalledWith('digest:weekly:42');
  });
});

/** Redis misses then fails to SET; the DB finds no row and accepts the insert. */
function buildWarmFailingStores() {
  const db = {
    execute: jest
      .fn()
      .mockResolvedValueOnce([]) // findValidDbRecord → miss
      .mockResolvedValueOnce([]) // stale-row delete
      .mockResolvedValueOnce([{ id: 1 }]), // insert → won
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockRejectedValue(new Error('redis down')),
  };
  const service = new NotificationDedupService(
    db as unknown as PostgresJsDatabase<typeof schema>,
    redis as unknown as Redis,
  );
  return { db, redis, service };
}

describe('NotificationDedupService.checkAndMarkSent — cache warm failure (ROK-2100 Codex P2)', () => {
  it('a won PG claim whose Redis warm fails still reports "not yet sent"', async () => {
    const { db, redis, service } = buildWarmFailingStores();

    await expect(service.checkAndMarkSent('k:1', 60)).resolves.toBe(false);

    expect(db.execute).toHaveBeenCalledTimes(3);
    expect(redis.set).toHaveBeenCalledWith('k:1', '1', 'EX', 60);
  });
});

/**
 * ROK-2252: stores for `checkAndMarkSentMany`. `cached` keys hit Redis;
 * `execute` answers SELECT → `dbHits`, DELETE → [], INSERT → the rows of
 * `inserted` (a key missing from it lost the race to a concurrent claimer).
 */
function buildBatchStores(opts: {
  cached?: string[];
  dbHits?: string[];
  inserted?: string[];
  warmFails?: boolean;
}) {
  const execute = jest
    .fn()
    .mockResolvedValueOnce((opts.dbHits ?? []).map((k) => ({ dedup_key: k })))
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(
      (opts.inserted ?? []).map((k) => ({ dedup_key: k })),
    );
  const pipeline = {
    set: jest.fn().mockReturnThis(),
    exec: opts.warmFails
      ? jest.fn().mockRejectedValue(new Error('redis down'))
      : jest.fn().mockResolvedValue([]),
  };
  const cached = new Set(opts.cached ?? []);
  const redis = {
    mget: jest.fn((...keys: string[]) =>
      Promise.resolve(keys.map((k) => (cached.has(k) ? '1' : null))),
    ),
    pipeline: jest.fn(() => pipeline),
  };
  const service = new NotificationDedupService(
    { execute } as unknown as PostgresJsDatabase<typeof schema>,
    redis as unknown as Redis,
  );
  return { execute, redis, pipeline, service };
}

describe('NotificationDedupService.checkAndMarkSentMany (ROK-2252)', () => {
  it('an empty list touches neither store', async () => {
    const s = buildBatchStores({});
    expect(await s.service.checkAndMarkSentMany([], 60)).toEqual(new Set());
    expect(s.redis.mget).not.toHaveBeenCalled();
    expect(s.execute).not.toHaveBeenCalled();
  });

  it('keys all cached in Redis are not claimed and cost no DB query', async () => {
    const s = buildBatchStores({ cached: ['k:1', 'k:2'] });
    const won = await s.service.checkAndMarkSentMany(['k:1', 'k:2'], 60);
    expect(won).toEqual(new Set());
    expect(s.redis.mget).toHaveBeenCalledTimes(1);
    expect(s.execute).not.toHaveBeenCalled();
  });

  it('N fresh keys cost one MGET, three DB queries and are all claimed + warmed', async () => {
    const keys = ['k:1', 'k:2', 'k:3', 'k:4'];
    const s = buildBatchStores({ inserted: keys });
    const won = await s.service.checkAndMarkSentMany(keys, 60);
    expect(won).toEqual(new Set(keys));
    expect(s.redis.mget).toHaveBeenCalledTimes(1);
    expect(s.execute).toHaveBeenCalledTimes(3);
    expect(s.pipeline.set.mock.calls).toEqual(
      keys.map((k) => [k, '1', 'EX', 60]),
    );
  });

  it('a valid DB row is not claimed but re-warms Redis; only the rest is inserted', async () => {
    const s = buildBatchStores({
      cached: ['k:1'],
      dbHits: ['k:2'],
      inserted: ['k:3'],
    });
    const won = await s.service.checkAndMarkSentMany(['k:1', 'k:2', 'k:3'], 60);
    expect(won).toEqual(new Set(['k:3']));
    expect(s.execute).toHaveBeenCalledTimes(3);
    expect(s.pipeline.set.mock.calls).toEqual([
      ['k:2', '1', 'EX', 60],
      ['k:3', '1', 'EX', 60],
    ]);
  });

  it('every miss found in the DB skips the insert entirely', async () => {
    const s = buildBatchStores({ dbHits: ['k:1'] });
    expect(await s.service.checkAndMarkSentMany(['k:1'], 60)).toEqual(
      new Set(),
    );
    expect(s.execute).toHaveBeenCalledTimes(1);
  });

  it('a key a concurrent claimer inserted first is not returned nor warmed', async () => {
    const s = buildBatchStores({ inserted: ['k:2'] });
    const won = await s.service.checkAndMarkSentMany(['k:1', 'k:2'], null);
    expect(won).toEqual(new Set(['k:2']));
    expect(s.pipeline.set.mock.calls).toEqual([['k:2', '1']]);
  });

  it('duplicate keys are looked up and claimed once', async () => {
    const s = buildBatchStores({ inserted: ['k:1'] });
    const won = await s.service.checkAndMarkSentMany(['k:1', 'k:1'], 60);
    expect(won).toEqual(new Set(['k:1']));
    expect(s.redis.mget).toHaveBeenCalledWith('k:1');
    expect(s.pipeline.set).toHaveBeenCalledTimes(1);
  });

  it('locks keys in one sorted order whatever order they arrive in (Codex P2)', async () => {
    const s = buildBatchStores({ inserted: ['k:1', 'k:2', 'k:3'] });
    await s.service.checkAndMarkSentMany(['k:3', 'k:1', 'k:2'], 60);
    const dialect = new PgDialect();
    const keyParams = s.execute.mock.calls.map(([query]) =>
      dialect
        .sqlToQuery(query as SQL)
        .params.filter((p) => typeof p === 'string' && p.startsWith('k:')),
    );
    const sorted = ['k:1', 'k:2', 'k:3'];
    // SELECT, DELETE and INSERT all see the keys sorted.
    expect(keyParams).toEqual([sorted, sorted, sorted]);
    expect(s.redis.mget).toHaveBeenCalledWith(...sorted);
  });

  it('won claims whose Redis warm fails are still returned (ROK-2100 Codex P2)', async () => {
    const s = buildBatchStores({ inserted: ['k:1'], warmFails: true });
    await expect(s.service.checkAndMarkSentMany(['k:1'], 60)).resolves.toEqual(
      new Set(['k:1']),
    );
  });
});
