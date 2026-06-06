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

function makeGuild(ses: Array<{ id: string; name: string; ts: number }>) {
  return {
    scheduledEvents: {
      fetch: jest
        .fn()
        .mockResolvedValue(
          new Map(
            ses.map((s) => [
              s.id,
              { id: s.id, name: s.name, scheduledStartTimestamp: s.ts },
            ]),
          ),
        ),
      delete: jest.fn(),
    },
  } as unknown as Parameters<typeof recoverOrphanScheduledEvents>[0];
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
      { id: 'dup-se', name: 'Palworld Event', ts: START },
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
});
