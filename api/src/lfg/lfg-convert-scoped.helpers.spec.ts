/**
 * ROK-2352 P2-8 — a convert takes the per-game group lock BEFORE it flips any
 * hand, inside one transaction.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { convertGroupLocked } from './lfg-convert-scoped.helpers';

describe('convertGroupLocked (ROK-2352 P2-8)', () => {
  let db: MockDb;
  const order: string[] = [];

  beforeEach(() => {
    order.length = 0;
    db = createDrizzleMock();
    db.transaction.mockImplementation((cb: (tx: MockDb) => unknown) =>
      Promise.resolve(cb(db)),
    );
    db.execute.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve([]);
    });
    db.update.mockImplementation(() => {
      order.push('update');
      return db;
    });
    db.returning.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  });

  it('locks the game group, then converts only the scoped group', async () => {
    const converted = await convertGroupLocked(
      db as never,
      42,
      { pollId: 7 },
      'raid:409',
    );

    expect(converted).toBe(2);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['lock', 'update']);
    const lock = JSON.stringify(db.execute.mock.calls[0]?.[0]);
    expect(lock).toContain('pg_advisory_xact_lock');
    expect(lock).toContain('lfg:42');
  });
});
