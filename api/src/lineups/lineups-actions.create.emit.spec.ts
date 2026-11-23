/**
 * ROK-2272 S6: `runCreateLineup` emits `LINEUP_LIFECYCLE_EVENTS.CREATED`
 * exactly once, after the insert (and its activity log) committed, with the
 * row's visibility / guildId / standalone flag — and nothing when the insert
 * or the activity log throws.
 */
import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { CreateLineupDto } from '@raid-ledger/contract';
import { LINEUP_LIFECYCLE_EVENTS } from './lineup-events.constants';
import {
  runCreateLineup,
  type CreateLineupDeps,
} from './lineups-actions.helpers';

const mockInsertLineup = jest.fn();
jest.mock('./lineups-lifecycle.helpers', () => ({
  ...jest.requireActual('./lineups-lifecycle.helpers'),
  insertLineup: (...args: unknown[]): unknown => mockInsertLineup(...args),
}));
jest.mock('./lineups-carryover.helpers', () => ({
  ...jest.requireActual('./lineups-carryover.helpers'),
  carryOverFromLastDecided: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./quorum/nomination-target.helpers', () => ({
  ...jest.requireActual('./quorum/nomination-target.helpers'),
  armNominationTargetOnCreate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./queue/lineup-phase-schedule.helpers', () => ({
  ...jest.requireActual('./queue/lineup-phase-schedule.helpers'),
  scheduleTransitionBestEffort: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./lineups-notify-hooks.helpers', () => ({
  ...jest.requireActual('./lineups-notify-hooks.helpers'),
  fireLineupCreated: jest.fn(),
  fireCreatedEmbedRefresh: jest.fn(),
  fireNominationMilestone: jest.fn(),
  fireNominationRemoved: jest.fn(),
}));
jest.mock('./lineups-response.helpers', () => ({
  ...jest.requireActual('./lineups-response.helpers'),
  buildDetailResponse: jest.fn().mockResolvedValue({ id: 4 }),
}));

/** The inserted row as `insertLineup` returns it (fields the action reads). */
function lineupRow(overrides: Record<string, unknown> = {}): object {
  return {
    id: 4,
    title: 'Friday',
    description: null,
    visibility: 'private',
    guildId: 2,
    phaseDurationOverride: null,
    channelOverrideId: null,
    ...overrides,
  };
}

function makeDeps(): {
  deps: CreateLineupDeps;
  emit: jest.Mock;
  log: jest.Mock;
} {
  const emit = jest.fn();
  const log = jest.fn().mockResolvedValue(undefined);
  const deps = {
    db: {},
    activityLog: { log },
    phaseQueue: {},
    steamNudge: { nudgeUnlinkedMembers: jest.fn().mockResolvedValue(0) },
    lineupNotifications: {},
    logger: new Logger('spec'),
    resolveChannelName: (): null => null,
    eventEmitter: { emit } as unknown as EventEmitter2,
  } as unknown as CreateLineupDeps;
  return { deps, emit, log };
}

const DTO = { title: 'Friday' } as CreateLineupDto;

function createdCalls(emit: jest.Mock): unknown[][] {
  return emit.mock.calls.filter(
    (c: unknown[]) => c[0] === LINEUP_LIFECYCLE_EVENTS.CREATED,
  );
}

describe('runCreateLineup — CREATED emit (ROK-2272 S6)', () => {
  beforeEach(() => mockInsertLineup.mockReset());

  it('emits CREATED once with visibility, guildId and standalone:false', async () => {
    mockInsertLineup.mockResolvedValueOnce([lineupRow()]);
    const { deps, emit, log } = makeDeps();
    await runCreateLineup(deps, DTO, 9);
    expect(createdCalls(emit)).toEqual([
      [
        LINEUP_LIFECYCLE_EVENTS.CREATED,
        { lineupId: 4, visibility: 'private', guildId: 2, standalone: false },
      ],
    ]);
    // After the write and its activity log, never before.
    expect(log.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? -Infinity,
    );
  });

  it('carries standalone:true for a standalone carrier row', async () => {
    mockInsertLineup.mockResolvedValueOnce([
      lineupRow({
        visibility: 'public',
        guildId: null,
        phaseDurationOverride: { standalone: true },
      }),
    ]);
    const { deps, emit } = makeDeps();
    await runCreateLineup(deps, DTO, 9);
    expect(createdCalls(emit)).toEqual([
      [
        LINEUP_LIFECYCLE_EVENTS.CREATED,
        { lineupId: 4, visibility: 'public', guildId: null, standalone: true },
      ],
    ]);
  });

  it('emits nothing when the insert returns no row', async () => {
    mockInsertLineup.mockResolvedValueOnce([]);
    const { deps, emit } = makeDeps();
    await expect(runCreateLineup(deps, DTO, 9)).rejects.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits nothing when the insert throws', async () => {
    mockInsertLineup.mockRejectedValueOnce(new Error('db down'));
    const { deps, emit } = makeDeps();
    await expect(runCreateLineup(deps, DTO, 9)).rejects.toThrow('db down');
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits nothing when the activity log write throws', async () => {
    mockInsertLineup.mockResolvedValueOnce([lineupRow()]);
    const { deps, emit, log } = makeDeps();
    log.mockRejectedValueOnce(new Error('log down'));
    await expect(runCreateLineup(deps, DTO, 9)).rejects.toThrow('log down');
    expect(emit).not.toHaveBeenCalled();
  });
});
