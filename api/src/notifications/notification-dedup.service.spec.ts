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
