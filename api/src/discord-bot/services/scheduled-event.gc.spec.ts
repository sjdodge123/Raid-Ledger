/**
 * Unit tests for gcStaleRLScheduledEvents (ROK-1332 AC2).
 *
 * Pure-mock layer: the helper takes a Guild + a Drizzle handle. We stub the
 * guild's `scheduledEvents.fetch/delete` and the two db-helpers it calls
 * (`findRLTrackedSEs` + `clearScheduledEventId`) via jest.mock so the spec
 * stays at the unit level. This layer asserts GC's delete/skip dispatch on the
 * `isStale` flag; the staleness SQL itself (cancelled / past-due ≥1h /
 * extendedUntil / active-future) is computed in `findRLTrackedSEs` and is
 * covered against a real DB by the capacity-recovery integration spec.
 */
import { gcStaleRLScheduledEvents } from './scheduled-event.gc';
import * as dbHelpers from './scheduled-event.db-helpers';
import * as discordOps from './scheduled-event.discord-ops';

jest.mock('./scheduled-event.db-helpers', () => ({
  ...jest.requireActual('./scheduled-event.db-helpers'),
  findRLTrackedSEs: jest.fn(),
  clearScheduledEventId: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./scheduled-event.discord-ops', () => ({
  ...jest.requireActual('./scheduled-event.discord-ops'),
  tryDeleteEvent: jest.fn().mockResolvedValue(undefined),
}));

const findRLTrackedSEs = dbHelpers.findRLTrackedSEs as jest.MockedFunction<
  typeof dbHelpers.findRLTrackedSEs
>;
const clearScheduledEventId =
  dbHelpers.clearScheduledEventId as jest.MockedFunction<
    typeof dbHelpers.clearScheduledEventId
  >;
const tryDeleteEvent = discordOps.tryDeleteEvent as jest.MockedFunction<
  typeof discordOps.tryDeleteEvent
>;

function makeGuild(seIds: string[]) {
  return {
    scheduledEvents: {
      fetch: jest
        .fn()
        .mockResolvedValue(new Map(seIds.map((id) => [id, { id }]))),
    },
  } as unknown as Parameters<typeof gcStaleRLScheduledEvents>[0];
}

const db = {} as Parameters<typeof gcStaleRLScheduledEvents>[1];

beforeEach(() => {
  findRLTrackedSEs.mockReset();
  clearScheduledEventId.mockReset().mockResolvedValue(undefined);
  tryDeleteEvent.mockReset().mockResolvedValue(undefined);
});

describe('gcStaleRLScheduledEvents (ROK-1332 AC2)', () => {
  it('deletes stale RL-tracked SEs (isStale=true)', async () => {
    const guild = makeGuild(['se-1']);
    findRLTrackedSEs.mockResolvedValue([
      { id: 101, discordScheduledEventId: 'se-1', isStale: true },
    ]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result).toEqual({ freed: 1, orphanCount: 0 });
    expect(tryDeleteEvent).toHaveBeenCalledTimes(1);
    expect(tryDeleteEvent).toHaveBeenCalledWith(guild, 101, 'se-1');
    expect(clearScheduledEventId).toHaveBeenCalledWith(db, 101);
  });

  it('deletes a second stale RL-tracked SE', async () => {
    const guild = makeGuild(['se-pastdue']);
    findRLTrackedSEs.mockResolvedValue([
      { id: 202, discordScheduledEventId: 'se-pastdue', isStale: true },
    ]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result).toEqual({ freed: 1, orphanCount: 0 });
    expect(tryDeleteEvent).toHaveBeenCalledWith(guild, 202, 'se-pastdue');
  });

  it('skips non-stale RL-tracked SEs (isStale=false)', async () => {
    const guild = makeGuild(['se-active']);
    findRLTrackedSEs.mockResolvedValue([
      { id: 303, discordScheduledEventId: 'se-active', isStale: false },
    ]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result).toEqual({ freed: 0, orphanCount: 0 });
    expect(tryDeleteEvent).not.toHaveBeenCalled();
    expect(clearScheduledEventId).not.toHaveBeenCalled();
  });

  it('counts operator-owned SEs (not in DB) as orphans and never deletes them', async () => {
    const guild = makeGuild(['se-rl', 'op-orphan-1', 'op-orphan-2']);
    findRLTrackedSEs.mockResolvedValue([
      { id: 404, discordScheduledEventId: 'se-rl', isStale: true },
    ]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result).toEqual({ freed: 1, orphanCount: 2 });
    expect(tryDeleteEvent).toHaveBeenCalledTimes(1);
    expect(tryDeleteEvent).toHaveBeenCalledWith(guild, 404, 'se-rl');
    // The orphans must NEVER be deleted.
    expect(tryDeleteEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'op-orphan-1',
    );
    expect(tryDeleteEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'op-orphan-2',
    );
  });

  it('short-circuits when guild has zero SEs (no DB call)', async () => {
    const guild = makeGuild([]);

    const result = await gcStaleRLScheduledEvents(guild, db);

    expect(result).toEqual({ freed: 0, orphanCount: 0 });
    expect(findRLTrackedSEs).not.toHaveBeenCalled();
    expect(tryDeleteEvent).not.toHaveBeenCalled();
  });
});
