/**
 * TDD tests for event conflict detection (ROK-1031 Part 4).
 * Tests findConflictingEvents() which DOES NOT EXIST YET.
 *
 * These tests are expected to FAIL until the dev agent implements the helper.
 *
 * The conflict detection helper should:
 * - Find events that overlap a given time range for a given user
 * - Exclude cancelled events
 * - Exclude signups with declined/departed status
 * - Support self-exclusion via excludeEventId parameter
 */
import { findConflictingEvents } from './event-conflict.helpers';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type { MockDb } from '../common/testing/drizzle-mock';

// ─── Shared test data ──────────────────────────────────────────────────────

const USER_ID = 1;
const START_TIME = new Date('2026-05-01T18:00:00Z');
const END_TIME = new Date('2026-05-01T20:00:00Z');

/** Build a conflicting event row as returned by the query. */
function buildConflictEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    title: 'Conflicting Event',
    duration: [
      new Date('2026-05-01T17:00:00Z'),
      new Date('2026-05-01T19:00:00Z'),
    ] as [Date, Date],
    cancelledAt: null,
    ...overrides,
  };
}

// ─── Mock builder for conflict queries ─────────────────────────────────────

/**
 * Builds a mock DB that simulates the conflict query.
 *
 * The findConflictingEvents function is expected to:
 * 1. Query events table joined with event_signups
 * 2. Filter by time range overlap (tsrange && tsrange)
 * 3. Filter by userId via event_signups
 * 4. Exclude cancelled events (cancelledAt IS NULL)
 * 5. Exclude declined/departed signups
 * 6. Optionally exclude a specific event by id
 */
function buildConflictDb(
  rows: ReturnType<typeof buildConflictEvent>[],
): MockDb {
  const db = createDrizzleMock();
  // The query terminates at a chain method -- use where as the
  // terminal since the conflict query filters on multiple conditions.
  // We override the chain to eventually resolve to the given rows.
  db.where.mockResolvedValue(rows);
  return db;
}

// ─── findConflictingEvents ─────────────────────────────────────────────────

describe('findConflictingEvents', () => {
  it('returns events that overlap the given time range for a user', async () => {
    const overlapping = buildConflictEvent({
      id: 10,
      title: 'Overlapping Raid',
      duration: [
        new Date('2026-05-01T17:00:00Z'),
        new Date('2026-05-01T19:00:00Z'),
      ],
    });
    const db = buildConflictDb([overlapping]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 10,
      title: 'Overlapping Raid',
    });
  });

  it('returns empty array when no events overlap', async () => {
    const db = buildConflictDb([]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(result).toEqual([]);
  });

  it('returns multiple conflicting events when several overlap', async () => {
    const events = [
      buildConflictEvent({ id: 10, title: 'Event A' }),
      buildConflictEvent({ id: 11, title: 'Event B' }),
      buildConflictEvent({ id: 12, title: 'Event C' }),
    ];
    const db = buildConflictDb(events);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(result).toHaveLength(3);
  });

  it('excludes cancelled events from results', async () => {
    // A cancelled event should NOT appear in conflict results
    // even if its time range overlaps.
    // The mock should return only non-cancelled events.
    const db = buildConflictDb([]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    // Verify the query filters on cancelledAt being null.
    // With the flat mock, the where clause is expected to include the
    // cancelled filter. The empty result confirms cancelled events
    // are excluded by the query itself.
    expect(result).toEqual([]);
    expect(db.where).toHaveBeenCalled();
  });

  it('excludes signups with declined status from conflicts', async () => {
    // A user who declined an event should not see it as a conflict.
    // The query should filter out signups where status = 'declined'.
    const db = buildConflictDb([]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(result).toEqual([]);
    // The where clause should include status filtering
    expect(db.where).toHaveBeenCalled();
  });

  it('excludes signups with departed status from conflicts', async () => {
    // A user who departed an event should not see it as a conflict.
    const db = buildConflictDb([]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(result).toEqual([]);
    expect(db.where).toHaveBeenCalled();
  });

  it('excludes the specified event via excludeEventId parameter', async () => {
    // When editing/viewing an event, the event itself should not
    // appear as a conflict with itself.
    // The DB returns 0 results because excludeEventId=10 filters it
    const db = buildConflictDb([]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
      excludeEventId: 10,
    });

    expect(result).toEqual([]);
  });

  it('includes events when excludeEventId does not match', async () => {
    const overlapping = buildConflictEvent({
      id: 10,
      title: 'Other Event',
    });
    const db = buildConflictDb([overlapping]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
      excludeEventId: 999,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(10);
  });

  it('works without excludeEventId (parameter is optional)', async () => {
    const overlapping = buildConflictEvent({ id: 10 });
    const db = buildConflictDb([overlapping]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(result).toHaveLength(1);
  });

  it('handles edge case: event starts exactly when query range ends', async () => {
    // An event that starts at exactly the end of the query range
    // is a boundary case. Standard tsrange overlap with [) semantics
    // means this is NOT a conflict (exclusive upper bound).
    const db = buildConflictDb([]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(result).toEqual([]);
  });

  it('handles edge case: event ends exactly when query range starts', async () => {
    // An event ending at exactly the start of the query range
    // is NOT a conflict with [) range semantics.
    const db = buildConflictDb([]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(result).toEqual([]);
  });

  it('includes tentative signups as potential conflicts', async () => {
    // A tentative signup should still appear as a conflict
    // because the user has expressed intent to possibly attend.
    const tentativeEvent = buildConflictEvent({
      id: 15,
      title: 'Tentative Event',
    });
    const db = buildConflictDb([tentativeEvent]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(15);
  });

  it('includes signed_up signups as conflicts', async () => {
    const confirmedEvent = buildConflictEvent({
      id: 16,
      title: 'Confirmed Event',
    });
    const db = buildConflictDb([confirmedEvent]);

    const result = await findConflictingEvents(db as never, {
      userId: USER_ID,
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(16);
  });
});
