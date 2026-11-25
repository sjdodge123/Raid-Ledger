import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { HUB_CROSSWALK_LOCK_CLASS, withCrosswalkLock } from './crosswalk-lock';

describe('withCrosswalkLock (L1)', () => {
  it('locks every key once, in sorted order, before running fn', async () => {
    const order: string[] = [];
    const dialect = new PgDialect();
    const tx = {
      execute: (q: SQL): Promise<void> => {
        const { params } = dialect.sqlToQuery(q);
        expect(params[0]).toBe(HUB_CROSSWALK_LOCK_CLASS);
        order.push(String(params[1]));
        return Promise.resolve();
      },
    };
    const db = {
      transaction: <T>(cb: (t: typeof tx) => Promise<T>): Promise<T> => cb(tx),
    };
    const result = await withCrosswalkLock(
      db,
      ['steam_app_id:9', 'igdb_id:2', 'resident evil', 'igdb_id:2'],
      () => {
        order.push('fn');
        return Promise.resolve('done');
      },
    );
    expect(result).toBe('done');
    expect(order).toEqual([
      'igdb_id:2',
      'resident evil',
      'steam_app_id:9',
      'fn',
    ]);
  });
});
