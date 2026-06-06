/**
 * Unit tests for gcStaleRLScheduledEvents (ROK-1332 AC2 + ROK-1347).
 *
 * Pure-mock layer: the helper takes a Guild + a Drizzle handle. We stub the
 * guild's `scheduledEvents.fetch/delete`, the db-helpers it calls
 * (`findRLTrackedSEs` + `clearScheduledEventId` + `findLiveRLEventsForDedup`)
 * and `tryDeleteEvent` via jest.mock so the spec stays at the unit level.
 *
 * ROK-1347 additions: GC now (a) reclassifies untracked guild SEs that match a
 * live RL event with a DIFFERENT bound id as RL-created duplicates and DELETES
 * them (counted in `freed`); (b) returns `deleteFailures` with per-orphan codes
 * and logs each failure so `freed=0 && orphanCount>0` always carries a reason.
 */
import { gcStaleRLScheduledEvents } from './scheduled-event.gc';
import * as dbHelpers from './scheduled-event.db-helpers';
import * as discordOps from './scheduled-event.discord-ops';

jest.mock('./scheduled-event.db-helpers', () => ({
  ...jest.requireActual('./scheduled-event.db-helpers'),
  findRLTrackedSEs: jest.fn(),
  findLiveRLEventsForDedup: jest.fn().mockResolvedValue([]),
  clearScheduledEventId: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./scheduled-event.discord-ops', () => ({
  ...jest.requireActual('./scheduled-event.discord-ops'),
  tryDeleteEvent: jest.fn().mockResolvedValue({ deleted: true }),
}));

const findRLTrackedSEs = dbHelpers.findRLTrackedSEs as jest.MockedFunction<
  typeof dbHelpers.findRLTrackedSEs
>;
const findLiveRLEventsForDedup =
  dbHelpers.findLiveRLEventsForDedup as jest.MockedFunction<
    typeof dbHelpers.findLiveRLEventsForDedup
  >;
const clearScheduledEventId =
  dbHelpers.clearScheduledEventId as jest.MockedFunction<
    typeof dbHelpers.clearScheduledEventId
  >;
const tryDeleteEvent = discordOps.tryDeleteEvent as jest.MockedFunction<
  typeof discordOps.tryDeleteEvent
>;

interface SE {
  id: string;
  name?: string;
  scheduledStartTimestamp?: number;
}

function makeGuild(ses: SE[]) {
  return {
    scheduledEvents: {
      fetch: jest.fn().mockResolvedValue(new Map(ses.map((s) => [s.id, s]))),
    },
  } as unknown as Parameters<typeof gcStaleRLScheduledEvents>[0];
}

const db = {} as Parameters<typeof gcStaleRLScheduledEvents>[1];

beforeEach(() => {
  findRLTrackedSEs.mockReset();
  findLiveRLEventsForDedup.mockReset().mockResolvedValue([]);
  clearScheduledEventId.mockReset().mockResolvedValue(undefined);
  tryDeleteEvent.mockReset().mockResolvedValue({ deleted: true });
});

describe('gcStaleRLScheduledEvents — stale RL-tracked path', () => {
  it('deletes stale RL-tracked SEs (isStale=true)', async () => {
    const guild = makeGuild([{ id: 'se-1' }]);
    findRLTrackedSEs.mockResolvedValue([
      { id: 101, discordScheduledEventId: 'se-1', isStale: true },
    ]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result).toEqual({ freed: 1, orphanCount: 0, deleteFailures: [] });
    expect(tryDeleteEvent).toHaveBeenCalledWith(guild, 101, 'se-1');
    expect(clearScheduledEventId).toHaveBeenCalledWith(db, 101);
  });

  it('skips non-stale RL-tracked SEs (isStale=false)', async () => {
    const guild = makeGuild([{ id: 'se-active' }]);
    findRLTrackedSEs.mockResolvedValue([
      { id: 303, discordScheduledEventId: 'se-active', isStale: false },
    ]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result).toEqual({ freed: 0, orphanCount: 0, deleteFailures: [] });
    expect(tryDeleteEvent).not.toHaveBeenCalled();
  });

  it('short-circuits when guild has zero SEs (no DB call)', async () => {
    const guild = makeGuild([]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result).toEqual({ freed: 0, orphanCount: 0, deleteFailures: [] });
    expect(findRLTrackedSEs).not.toHaveBeenCalled();
    expect(tryDeleteEvent).not.toHaveBeenCalled();
  });
});

describe('gcStaleRLScheduledEvents — duplicate reclassification (ROK-1347)', () => {
  const START = Date.parse('2026-07-01T20:00:00.000Z');

  it('deletes an untracked SE matching a live RL event with a different bound id (counts as freed, not orphan)', async () => {
    // Guild has the bound SE + a duplicate with the same name+start.
    const guild = makeGuild([
      {
        id: 'bound-se',
        name: 'Palworld Event',
        scheduledStartTimestamp: START,
      },
      { id: 'dup-se', name: 'Palworld Event', scheduledStartTimestamp: START },
    ]);
    // Only the bound copy is tracked in the DB.
    findRLTrackedSEs.mockResolvedValue([
      { id: 9, discordScheduledEventId: 'bound-se', isStale: false },
    ]);
    findLiveRLEventsForDedup.mockResolvedValue([
      {
        id: 9,
        discordScheduledEventId: 'bound-se',
        title: 'Palworld Event',
        startIso: new Date(START).toISOString(),
      },
    ]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result.freed).toBe(1);
    expect(result.orphanCount).toBe(0);
    expect(result.deleteFailures).toEqual([]);
    // The duplicate is deleted; the bound copy is never touched.
    expect(tryDeleteEvent).toHaveBeenCalledWith(guild, 9, 'dup-se');
    expect(tryDeleteEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'bound-se',
    );
  });

  it('keeps a genuine operator SE as an orphan and never deletes it', async () => {
    const guild = makeGuild([
      { id: 'op-se', name: 'Operator Meetup', scheduledStartTimestamp: START },
    ]);
    findRLTrackedSEs.mockResolvedValue([]);
    findLiveRLEventsForDedup.mockResolvedValue([]); // no live RL match

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result.freed).toBe(0);
    expect(result.orphanCount).toBe(1);
    expect(tryDeleteEvent).not.toHaveBeenCalled();
  });

  it('NEVER deletes a matching guild SE when the live RL event has no bound SE yet (boundSeId=null — review critical)', async () => {
    // An RL event whose SE creation is in-flight (discordScheduledEventId NULL)
    // title+start-matches an operator's guild SE. Pre-fix, `null !== se.id`
    // classified the operator SE as a reclaimable duplicate and DELETED it.
    const guild = makeGuild([
      { id: 'op-se', name: 'Game Night', scheduledStartTimestamp: START },
    ]);
    findRLTrackedSEs.mockResolvedValue([]);
    findLiveRLEventsForDedup.mockResolvedValue([
      {
        id: 12,
        discordScheduledEventId: null,
        title: 'Game Night',
        startIso: new Date(START).toISOString(),
      },
    ]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result.freed).toBe(0);
    expect(result.orphanCount).toBe(1);
    expect(tryDeleteEvent).not.toHaveBeenCalled();
  });

  it('treats title+start collisions between two live RL events as ambiguous and never deletes (review high)', async () => {
    // Two live events share the exact title+start; an untracked guild SE
    // matching that key cannot be safely attributed → operator orphan.
    const guild = makeGuild([
      { id: 'dup?', name: 'Same Slot', scheduledStartTimestamp: START },
    ]);
    findRLTrackedSEs.mockResolvedValue([]);
    findLiveRLEventsForDedup.mockResolvedValue([
      {
        id: 21,
        discordScheduledEventId: 'se-21',
        title: 'Same Slot',
        startIso: new Date(START).toISOString(),
      },
      {
        id: 22,
        discordScheduledEventId: 'se-22',
        title: 'Same Slot',
        startIso: new Date(START).toISOString(),
      },
    ]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result.freed).toBe(0);
    expect(result.orphanCount).toBe(1);
    expect(tryDeleteEvent).not.toHaveBeenCalled();
  });
});

describe('gcStaleRLScheduledEvents — per-orphan failure logging (ROK-1347 invariant)', () => {
  it('records a non-deletable stale SE in deleteFailures and does NOT abort the loop', async () => {
    const guild = makeGuild([{ id: 'se-a' }, { id: 'se-b' }]);
    findRLTrackedSEs.mockResolvedValue([
      { id: 1, discordScheduledEventId: 'se-a', isStale: true },
      { id: 2, discordScheduledEventId: 'se-b', isStale: true },
    ]);
    // First delete fails (50013 missing perms), second succeeds — loop continues.
    tryDeleteEvent
      .mockResolvedValueOnce({ deleted: false, code: 50013 })
      .mockResolvedValueOnce({ deleted: true });

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result.freed).toBe(1);
    expect(result.deleteFailures).toEqual([
      { eventId: 1, seId: 'se-a', code: 50013 },
    ]);
    expect(tryDeleteEvent).toHaveBeenCalledTimes(2);
    // Only the successfully-deleted row had its binding cleared.
    expect(clearScheduledEventId).toHaveBeenCalledWith(db, 2);
    expect(clearScheduledEventId).not.toHaveBeenCalledWith(db, 1);
  });

  it('invariant: freed=0 with orphanCount>0 only happens when ALL deletes were operator orphans (never attempted)', async () => {
    // Two operator SEs (no RL match) and zero stale RL rows: GC frees nothing,
    // orphanCount>0, and there are NO delete attempts/failures because operator
    // orphans are never deleted — the "logged reason" is that they're orphans.
    const guild = makeGuild([
      { id: 'op-1', name: 'X', scheduledStartTimestamp: 1 },
      { id: 'op-2', name: 'Y', scheduledStartTimestamp: 2 },
    ]);
    findRLTrackedSEs.mockResolvedValue([]);
    findLiveRLEventsForDedup.mockResolvedValue([]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result.freed).toBe(0);
    expect(result.orphanCount).toBe(2);
    expect(tryDeleteEvent).not.toHaveBeenCalled();
  });

  it('invariant: when ALL reclaimable duplicate deletes fail, freed=0 and every failure is recorded (review low)', async () => {
    const START = Date.parse('2026-07-01T20:00:00.000Z');
    const guild = makeGuild([
      { id: 'bound-se', name: 'Raid', scheduledStartTimestamp: START },
      { id: 'dup-1', name: 'Raid', scheduledStartTimestamp: START },
    ]);
    findRLTrackedSEs.mockResolvedValue([
      { id: 31, discordScheduledEventId: 'bound-se', isStale: false },
    ]);
    findLiveRLEventsForDedup.mockResolvedValue([
      {
        id: 31,
        discordScheduledEventId: 'bound-se',
        title: 'Raid',
        startIso: new Date(START).toISOString(),
      },
    ]);
    tryDeleteEvent.mockResolvedValue({ deleted: false, code: 429 });

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result.freed).toBe(0);
    expect(result.deleteFailures).toEqual([
      { eventId: 31, seId: 'dup-1', code: 429 },
    ]);
  });
});
