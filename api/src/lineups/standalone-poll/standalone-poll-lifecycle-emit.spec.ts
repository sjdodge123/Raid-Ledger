/**
 * ROK-2272 S6: standalone-poll emit sites — `POLL_OPENED` from the create
 * fan-out, and the carrier-lineup archive that the legacy `complete()` flip
 * reports (`archivedLineupId`, emitted by `afterComplete`).
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { LINEUP_MATCH_EVENTS } from '../lineups-scheduling-hook.helpers';
import {
  fireCreateFanout,
  type CreateFanoutDeps,
} from './standalone-poll-create-fanout.helpers';
import { completeStandalonePoll } from './standalone-poll-query.helpers';
import { selectCompletionTarget } from './standalone-poll-complete.helpers';

jest.mock('./standalone-poll-complete.helpers', () => ({
  selectCompletionTarget: jest.fn(),
  flipLineupMatch: jest.fn().mockResolvedValue(true),
  assertLineupLockIn: jest.fn(() => ({})),
}));

const target = jest.mocked(selectCompletionTarget);
const GAME = { id: 7, name: 'Valheim', coverUrl: null };
const IDS = { lineupId: 3, matchId: 42, creatorId: 5 };

function fanoutDeps(): { deps: CreateFanoutDeps; emit: jest.Mock } {
  const emit = jest.fn();
  const resolved = jest.fn().mockResolvedValue(undefined);
  const deps: CreateFanoutDeps = {
    notifications: {
      notifyInterestedUsers: resolved,
      notifyPickedMembers: resolved,
      notifyRosterReschedule: resolved,
    },
    pollEmbed: { firePostInitialEmbed: jest.fn() },
    events: { emit } as unknown as EventEmitter2,
  };
  return { deps, emit };
}

describe('fireCreateFanout — POLL_OPENED', () => {
  it('emits once with match, lineup, hub and visibility', () => {
    const { deps, emit } = fanoutDeps();
    fireCreateFanout(deps, GAME, IDS, { gameId: 7 }, [], 'private', 11);
    const opened = emit.mock.calls.filter(
      (c) => c[0] === LINEUP_MATCH_EVENTS.POLL_OPENED,
    );
    expect(opened).toEqual([
      [
        LINEUP_MATCH_EVENTS.POLL_OPENED,
        { matchId: 42, lineupId: 3, guildId: 11, visibility: 'private' },
      ],
    ]);
  });

  it('carries guildId null for an untagged public poll', () => {
    const { deps, emit } = fanoutDeps();
    fireCreateFanout(deps, GAME, IDS, { gameId: 7 }, [], 'public');
    expect(emit).toHaveBeenCalledWith(LINEUP_MATCH_EVENTS.POLL_OPENED, {
      matchId: 42,
      lineupId: 3,
      guildId: null,
      visibility: 'public',
    });
  });
});

/** A tx whose match flip returns `flipRows`; the lineup archive resolves. */
function txDb(flipRows: { id: number }[]) {
  const where = jest.fn(() =>
    Object.assign(Promise.resolve(), {
      returning: jest.fn().mockResolvedValue(flipRows),
    }),
  );
  const tx = { update: jest.fn(() => ({ set: () => ({ where }) })) };
  return { transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
}

function standaloneTarget(standalone: boolean) {
  return {
    id: 42,
    lineupId: 3,
    linkedEventId: null,
    linkedEventCancelled: false,
    standalone,
  };
}

describe('completeStandalonePoll — archivedLineupId', () => {
  type CompleteDb = Parameters<typeof completeStandalonePoll>[0];
  const asDb = (d: ReturnType<typeof txDb>): CompleteDb =>
    d as unknown as CompleteDb;

  it('reports the archived carrier lineup for a standalone flip', async () => {
    target.mockResolvedValue(standaloneTarget(true));
    const result = await completeStandalonePoll(asDb(txDb([{ id: 42 }])), 42);
    expect(result).toMatchObject({ ok: true, archivedLineupId: 3 });
  });

  it('reports nothing archived when the flip lost (already completed)', async () => {
    target.mockResolvedValue(standaloneTarget(true));
    const result = await completeStandalonePoll(asDb(txDb([])), 42);
    expect(result).toEqual({ ok: false, conflict: true });
  });

  it('reports nothing archived for a regular lineup match', async () => {
    target.mockResolvedValue(standaloneTarget(false));
    const result = await completeStandalonePoll(
      asDb(txDb([])),
      42,
      900,
      '2099-01-01T20:00:00.000Z',
    );
    expect(result.archivedLineupId).toBeUndefined();
  });
});
