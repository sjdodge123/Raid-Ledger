/**
 * ROK-2024 follow-up F2 — the lock-in claim refuses a match that is already
 * locked in BEFORE the caller creates an event, and takes the lock first.
 */
import { ConflictException } from '@nestjs/common';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { withMatchLockInClaim } from './scheduling-lockin-claim.helpers';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

function setup(rows: unknown[]) {
  const db = createDrizzleMock();
  const order: string[] = [];
  db.execute.mockImplementation(() => {
    order.push('lock');
    return Promise.resolve(undefined);
  });
  db.limit.mockImplementation(() => {
    order.push('recheck');
    return Promise.resolve(rows);
  });
  return { db, order };
}

describe('withMatchLockInClaim (ROK-2024 F2)', () => {
  it('409s without running fn when the match is already claimed', async () => {
    const { db } = setup([]);
    const fn = jest.fn().mockResolvedValue(1);
    await expect(
      withMatchLockInClaim(db as unknown as Db, 3, fn),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fn).not.toHaveBeenCalled();
  });

  it('takes the lock, re-checks, then runs fn on the transaction handle', async () => {
    const { db, order } = setup([{ id: 3 }]);
    const fn = jest.fn().mockResolvedValue(77);
    await expect(
      withMatchLockInClaim(db as unknown as Db, 3, fn),
    ).resolves.toBe(77);
    expect(order).toEqual(['lock', 'recheck']);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(db);
  });
});
