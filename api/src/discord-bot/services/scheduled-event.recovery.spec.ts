/**
 * Unit tests for recoverOrphanScheduledEvents (ROK-1347).
 *
 * dry-run returns the candidate set without deleting; dryRun=false deletes
 * RL-created duplicates (never operator orphans) and clears capacity backoff on
 * the affected events. findRLTrackedSEs / findLiveRLEventsForDedup /
 * clearReconcileBackoff / tryDeleteEvent are mocked; the db handle is bare for
 * the classification path and a small chainable mock for reconcileBoundIds.
 */
import { Logger } from '@nestjs/common';
import { recoverOrphanScheduledEvents } from './scheduled-event.recovery';
import * as dbHelpers from './scheduled-event.db-helpers';
import * as discordOps from './scheduled-event.discord-ops';

jest.mock('./scheduled-event.db-helpers', () => ({
  ...jest.requireActual('./scheduled-event.db-helpers'),
  findRLTrackedSEs: jest.fn().mockResolvedValue([]),
  findLiveRLEventsForDedup: jest.fn().mockResolvedValue([]),
  clearReconcileBackoff: jest.fn().mockResolvedValue(undefined),
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
const clearReconcileBackoff =
  dbHelpers.clearReconcileBackoff as jest.MockedFunction<
    typeof dbHelpers.clearReconcileBackoff
  >;
const tryDeleteEvent = discordOps.tryDeleteEvent as jest.MockedFunction<
  typeof discordOps.tryDeleteEvent
>;

const START = Date.parse('2026-07-01T20:00:00.000Z');
const logger = new Logger('test');

/** db mock: reconcileBoundIds selects then maybe updates. Return rows whose
 *  bound id != the deleted dup id so reconcileBoundIds nulls nothing. */
function makeDb(boundRows: Array<{ id: number; seId: string | null }> = []) {
  const updateChain = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
  };
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(boundRows),
      }),
    }),
    update: jest.fn().mockReturnValue(updateChain),
  } as unknown as Parameters<typeof recoverOrphanScheduledEvents>[1];
}

function makeGuild(
  ses: Array<{ id: string; name: string; ts: number; desc?: string }>,
) {
  return {
    scheduledEvents: {
      fetch: jest.fn().mockResolvedValue(
        new Map(
          ses.map((s) => [
            s.id,
            {
              id: s.id,
              name: s.name,
              scheduledStartTimestamp: s.ts,
              description: s.desc,
            },
          ]),
        ),
      ),
      delete: jest.fn(),
    },
  } as unknown as Parameters<typeof recoverOrphanScheduledEvents>[0];
}

/** RL fingerprint for mock SE descriptions (Codex P2 guard). */
function rlDesc(eventId: number): string {
  return `Event\n\nView event: https://rl.example/events/${eventId}`;
}

beforeEach(() => {
  findRLTrackedSEs.mockReset().mockResolvedValue([]);
  findLiveRLEventsForDedup.mockReset().mockResolvedValue([]);
  clearReconcileBackoff.mockReset().mockResolvedValue(undefined);
  tryDeleteEvent.mockReset().mockResolvedValue({ deleted: true });
});

describe('recoverOrphanScheduledEvents', () => {
  function withOneDuplicate() {
    const guild = makeGuild([
      { id: 'bound-se', name: 'Palworld Event', ts: START },
      { id: 'dup-se', name: 'Palworld Event', ts: START, desc: rlDesc(9) },
    ]);
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
    return guild;
  }

  describe('includeStale (ROK-1355)', () => {
    const CLIENT_URL = 'https://rl.example';

    it('classifies a fingerprinted SE with NO live match as staleReclaimable (dry-run)', async () => {
      // Event 77 has ended — no live row, no tracked binding. Its duplicate
      // outlived it but still carries the RL /events/77 fingerprint.
      const guild = makeGuild([
        { id: 'stale-se', name: 'Old Gamernight', ts: START, desc: rlDesc(77) },
        { id: 'op-se', name: 'Operator Party', ts: START, desc: 'hand-made' },
      ]);

      const result = await recoverOrphanScheduledEvents(
        guild,
        makeDb(),
        logger,
        { dryRun: true, staleClientUrl: CLIENT_URL },
      );

      expect(result.staleReclaimable).toEqual([
        {
          eventId: 77,
          seId: 'stale-se',
          title: 'Old Gamernight',
          start: new Date(START).toISOString(),
        },
      ]);
      // The hand-made SE stays an operator orphan; the stale one moved out.
      expect(result.operatorOrphans).toBe(1);
      expect(tryDeleteEvent).not.toHaveBeenCalled();
    });

    it('returns empty staleReclaimable and unchanged counts when staleClientUrl is not provided', async () => {
      const guild = makeGuild([
        { id: 'stale-se', name: 'Old Gamernight', ts: START, desc: rlDesc(77) },
      ]);

      const result = await recoverOrphanScheduledEvents(
        guild,
        makeDb(),
        logger,
        { dryRun: true },
      );

      expect(result.staleReclaimable).toEqual([]);
      expect(result.operatorOrphans).toBe(1);
    });

    it('requires the CONFIGURED client url — a foreign /events/ URL is never reclaimed', async () => {
      const guild = makeGuild([
        {
          id: 'foreign-se',
          name: 'Other Community Event',
          ts: START,
          desc: 'View event: https://other.example/events/123',
        },
      ]);

      const result = await recoverOrphanScheduledEvents(
        guild,
        makeDb(),
        logger,
        { dryRun: true, staleClientUrl: CLIENT_URL },
      );

      expect(result.staleReclaimable).toEqual([]);
      expect(result.operatorOrphans).toBe(1);
    });

    it('dryRun=false deletes stale SEs alongside live duplicates', async () => {
      const guild = makeGuild([
        { id: 'bound-se', name: 'Palworld Event', ts: START },
        { id: 'dup-se', name: 'Palworld Event', ts: START, desc: rlDesc(9) },
        { id: 'stale-se', name: 'Old Gamernight', ts: START, desc: rlDesc(77) },
      ]);
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

      const result = await recoverOrphanScheduledEvents(
        guild,
        makeDb(),
        logger,
        { dryRun: false, staleClientUrl: CLIENT_URL },
      );

      expect(result.deleted).toBe(2);
      expect(tryDeleteEvent).toHaveBeenCalledWith(guild, 9, 'dup-se');
      expect(tryDeleteEvent).toHaveBeenCalledWith(guild, 77, 'stale-se');
      expect(tryDeleteEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'bound-se',
      );
    });
  });

  it('dry-run returns reclaimable duplicates and deletes nothing', async () => {
    const guild = withOneDuplicate();

    const result = await recoverOrphanScheduledEvents(guild, makeDb(), logger, {
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.guildSeCount).toBe(2);
    expect(result.rlBound).toBe(1);
    expect(result.operatorOrphans).toBe(0);
    expect(result.reclaimableDuplicates).toEqual([
      {
        eventId: 9,
        seId: 'dup-se',
        title: 'Palworld Event',
        start: new Date(START).toISOString(),
      },
    ]);
    expect(result.deleted).toBe(0);
    expect(tryDeleteEvent).not.toHaveBeenCalled();
    expect(clearReconcileBackoff).not.toHaveBeenCalled();
  });

  it('dryRun=false deletes the duplicate and clears backoff for the event', async () => {
    const guild = withOneDuplicate();

    const result = await recoverOrphanScheduledEvents(guild, makeDb(), logger, {
      dryRun: false,
    });

    expect(tryDeleteEvent).toHaveBeenCalledWith(guild, 9, 'dup-se');
    expect(result.deleted).toBe(1);
    expect(result.failures).toEqual([]);
    expect(clearReconcileBackoff).toHaveBeenCalledWith(expect.anything(), [9]);
  });

  it('never deletes operator-owned orphans (no live RL match)', async () => {
    const guild = makeGuild([
      { id: 'op-se', name: 'Operator Meetup', ts: START },
    ]);
    findRLTrackedSEs.mockResolvedValue([]);
    findLiveRLEventsForDedup.mockResolvedValue([]);

    const result = await recoverOrphanScheduledEvents(guild, makeDb(), logger, {
      dryRun: false,
    });

    expect(result.operatorOrphans).toBe(1);
    expect(result.reclaimableDuplicates).toEqual([]);
    expect(result.deleted).toBe(0);
    expect(tryDeleteEvent).not.toHaveBeenCalled();
  });

  it('records a delete failure with its Discord code (does not throw)', async () => {
    const guild = withOneDuplicate();
    tryDeleteEvent.mockResolvedValue({
      deleted: false,
      code: 429,
      retryAfter: 5,
    });

    const result = await recoverOrphanScheduledEvents(guild, makeDb(), logger, {
      dryRun: false,
    });

    expect(result.deleted).toBe(0);
    expect(result.failures).toEqual([
      { seId: 'dup-se', code: 429, retryAfter: 5 },
    ]);
    // No event cleared since the delete failed.
    expect(clearReconcileBackoff).toHaveBeenCalledWith(expect.anything(), []);
  });

  it('does NOT clear a flipped binding when the delete FAILED (Codex P2)', async () => {
    // The event row became bound to the dup between classification and
    // delete, and the Discord delete failed — the SE is still live, so the
    // binding must survive (clearing it would mint another duplicate next
    // tick). reconcileBoundIds must only see successfully-deleted dups.
    const guild = withOneDuplicate();
    tryDeleteEvent.mockResolvedValue({ deleted: false, code: 50013 });
    const db = makeDb([{ id: 9, seId: 'dup-se' }]); // binding flipped to dup

    await recoverOrphanScheduledEvents(guild, db, logger, { dryRun: false });

    // select for reconcileBoundIds never runs (empty deleted set short-circuits)
    // and no update is issued either way.
    expect(
      (db as unknown as { update: jest.Mock }).update,
    ).not.toHaveBeenCalled();
  });
});
