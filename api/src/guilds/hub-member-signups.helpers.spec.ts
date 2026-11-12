/**
 * ROK-2185 item 2 — `countMemberSignups`: per event, how many live signups
 * belong to the hub's member set. One select, counted in JS.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { countMemberSignups } from './hub-member-signups.helpers';

type Db = Parameters<typeof countMemberSignups>[0];

let mock: MockDb;
let db: Db;

beforeEach(() => {
  mock = createDrizzleMock();
  db = mock as unknown as Db;
});

describe('countMemberSignups', () => {
  it('counts only signups whose user is in the member set, per event', async () => {
    mock.where.mockResolvedValueOnce([
      { eventId: 10, userId: 1 },
      { eventId: 10, userId: 2 },
      { eventId: 10, userId: 99 },
      { eventId: 11, userId: 2 },
      { eventId: 11, userId: null },
    ]);
    const counts = await countMemberSignups(db, [10, 11, 12], [1, 2]);
    expect(Object.fromEntries(counts)).toEqual({ 10: 2, 11: 1 });
    expect(mock.select).toHaveBeenCalledTimes(1);
  });

  it('answers an empty map without a query when there are no events', async () => {
    const counts = await countMemberSignups(db, [], [1, 2]);
    expect(counts.size).toBe(0);
    expect(mock.select).not.toHaveBeenCalled();
  });

  it('answers an empty map without a query when the hub has no members', async () => {
    const counts = await countMemberSignups(db, [10], []);
    expect(counts.size).toBe(0);
    expect(mock.select).not.toHaveBeenCalled();
  });
});
