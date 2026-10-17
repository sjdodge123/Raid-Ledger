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
