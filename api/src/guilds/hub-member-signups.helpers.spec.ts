/**
 * ROK-2185 item 2 — `countMemberSignups`: per event, how many live signups
 * belong to the hub's member set. One select, counted in JS.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  countMemberSignups,
  withMemberSignupCounts,
} from './hub-member-signups.helpers';

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

describe('withMemberSignupCounts', () => {
  it('stamps each card with its member count, 0 when none', async () => {
    mock.where.mockResolvedValueOnce([{ eventId: 10, userId: 1 }]);
    const base = {
      title: 't',
      startTime: '2026-11-13T20:00:00.000Z',
      endTime: '2026-11-13T23:00:00.000Z',
      signupCount: 2,
      needed: null,
      viewerStatus: null,
    };
    const cards = await withMemberSignupCounts(
      db,
      [
        { ...base, id: 10 },
        { ...base, id: 11 },
      ],
      [1],
    );
    expect(cards.map((c) => [c.id, c.memberSignupCount])).toEqual([
      [10, 1],
      [11, 0],
    ]);
  });
});
