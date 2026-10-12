/**
 * ROK-1595 G-1: `attachCalendarCopies` marks only the viewer's blocks that
 * a synced link backs. The DB is a chain mock; the link filter itself
 * (state, user, connection status) is pinned by the integration spec.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import * as schema from '../drizzle/schema';
import * as enabledQuery from '../calendar-sync/read/calendar-sync-enabled.query';
import { attachCalendarCopies } from './game-time-calendar-copy.helpers';
import type { EventBlockDescriptor } from './game-time.types';

let mockDb: MockDb;
let enabled: jest.SpyInstance;

function block(eventId: number): EventBlockDescriptor {
  return {
    eventId,
    title: `Event ${eventId}`,
    gameSlug: null,
    gameName: null,
    gameId: null,
    coverUrl: null,
    signupId: eventId * 10,
    confirmationStatus: 'confirmed',
    dayOfWeek: 4,
    startHour: 20,
    endHour: 23,
    description: null,
    creatorUsername: null,
    signupsPreview: [],
    signupCount: 1,
  };
}

function run(events: EventBlockDescriptor[]) {
  const db = mockDb as unknown as PostgresJsDatabase<typeof schema>;
  return attachCalendarCopies(db, 7, events);
}

beforeEach(() => {
  mockDb = createDrizzleMock();
  enabled = jest
    .spyOn(enabledQuery, 'readCalendarSyncEnabled')
    .mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

describe('attachCalendarCopies', () => {
  it('sets calendarCopy only on blocks a synced link backs', async () => {
    mockDb.orderBy.mockResolvedValueOnce([{ eventId: 2, provider: 'google' }]);
    const out = await run([block(1), block(2)]);
    expect(out.map((e) => [e.eventId, e.calendarCopy])).toEqual([
      [1, undefined],
      [2, 'google'],
    ]);
    expect(out[0]).not.toHaveProperty('calendarCopy');
  });

  it('keeps the first link when an event has copies on two connections', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      { eventId: 3, provider: 'microsoft' },
      { eventId: 3, provider: 'google' },
    ]);
    const [only] = await run([block(3)]);
    expect(only?.calendarCopy).toBe('microsoft');
  });

  it('ignores a provider outside the contract enum', async () => {
    mockDb.orderBy.mockResolvedValueOnce([{ eventId: 4, provider: 'yahoo' }]);
    const [only] = await run([block(4)]);
    expect(only).not.toHaveProperty('calendarCopy');
  });

  it('returns the blocks untouched without querying links when the kill switch is off', async () => {
    enabled.mockResolvedValue(false);
    const events = [block(5)];
    expect(await run(events)).toBe(events);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('makes no query at all for a week without events', async () => {
    expect(await run([])).toEqual([]);
    expect(enabled).not.toHaveBeenCalled();
  });
});
