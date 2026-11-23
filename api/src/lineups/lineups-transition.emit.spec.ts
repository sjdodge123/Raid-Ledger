/**
 * ROK-2272 S6: `runStatusTransition` emits `STATUS_CHANGED { lineupId, from,
 * to, … }` exactly once, after the conditional status UPDATE landed — and
 * nothing for a missing lineup, a rejected transition or a lost CAS.
 */
import { Logger, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { LINEUP_LIFECYCLE_EVENTS } from './lineup-events.constants';
import {
  runStatusTransition,
  type TransitionDeps,
} from './lineups-transition.helpers';

const mockFindLineupById = jest.fn();
const mockValidateTransition = jest.fn();
const mockApplyStatusUpdate = jest.fn();
jest.mock('./lineups-query.helpers', () => ({
  ...jest.requireActual('./lineups-query.helpers'),
  findLineupById: (...a: unknown[]): unknown => mockFindLineupById(...a),
  validateDecidedGame: jest.fn().mockResolvedValue(undefined),
  countVotesPerGame: jest.fn().mockResolvedValue([]),
}));
jest.mock('./lineups-lifecycle.helpers', () => ({
  ...jest.requireActual('./lineups-lifecycle.helpers'),
  validateTransition: (...a: unknown[]): unknown =>
    mockValidateTransition(...a),
  applyStatusUpdate: (...a: unknown[]): unknown => mockApplyStatusUpdate(...a),
  runMatchingAlgorithm: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./tiebreaker/tiebreaker-detect.helpers', () => ({
  ...jest.requireActual('./tiebreaker/tiebreaker-detect.helpers'),
  guardTiebreakerOnTransition: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./tiebreaker/tie-hold.helpers', () => ({
  ...jest.requireActual('./tiebreaker/tie-hold.helpers'),
  clearTieHoldOnTransition: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./lineups-activity.helpers', () => ({
  ...jest.requireActual('./lineups-activity.helpers'),
  logTransition: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./lineups-revert.helpers', () => ({
  ...jest.requireActual('./lineups-revert.helpers'),
  applyRevertSideEffects: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./lineups-notify-hooks.helpers', () => ({
  ...jest.requireActual('./lineups-notify-hooks.helpers'),
  fireVotingOpen: jest.fn(),
  fireDecidedNotifications: jest.fn(),
}));
jest.mock('./lineups-embed-heal.helpers', () => ({
  ...jest.requireActual('./lineups-embed-heal.helpers'),
  healClearedEventEmbeds: jest.fn().mockReturnValue(undefined),
}));
jest.mock('./cohort-memory-write.helpers', () => ({
  ...jest.requireActual('./cohort-memory-write.helpers'),
  writeDecidedCohortMemory: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./lineups-response.helpers', () => ({
  ...jest.requireActual('./lineups-response.helpers'),
  buildDetailResponse: jest.fn().mockResolvedValue({ id: 7 }),
}));

const LINEUP = {
  id: 7,
  status: 'building',
  visibility: 'public',
  guildId: 3,
  phaseDurationOverride: null,
  createdBy: 1,
};

function makeDeps(): { deps: TransitionDeps; emit: jest.Mock } {
  const emit = jest.fn();
  const deps = {
    db: {},
    activityLog: {},
    phaseQueue: {},
    lineupNotifications: {},
    lineupsGateway: { emitStatusChange: jest.fn() },
    logger: new Logger('spec'),
    eventEmitter: { emit } as unknown as EventEmitter2,
  } as unknown as TransitionDeps;
  return { deps, emit };
}

function statusCalls(emit: jest.Mock): unknown[][] {
  return emit.mock.calls.filter(
    (c: unknown[]) => c[0] === LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED,
  );
}

describe('runStatusTransition — STATUS_CHANGED emit (ROK-2272 S6)', () => {
  beforeEach(() => {
    mockFindLineupById.mockReset().mockResolvedValue([LINEUP]);
    mockValidateTransition.mockReset();
    mockApplyStatusUpdate.mockReset().mockResolvedValue(new Date());
  });

  it('emits once with from/to and the row subject fields, after the UPDATE', async () => {
    const { deps, emit } = makeDeps();
    await runStatusTransition(deps, 7, { status: 'voting' });
    expect(statusCalls(emit)).toEqual([
      [
        LINEUP_LIFECYCLE_EVENTS.STATUS_CHANGED,
        {
          lineupId: 7,
          from: 'building',
          to: 'voting',
          visibility: 'public',
          guildId: 3,
          standalone: false,
        },
      ],
    ]);
    expect(
      mockApplyStatusUpdate.mock.invocationCallOrder[0] ?? Infinity,
    ).toBeLessThan(emit.mock.invocationCallOrder[0] ?? -Infinity);
  });

  it('emits nothing for a missing lineup', async () => {
    mockFindLineupById.mockResolvedValueOnce([]);
    const { deps, emit } = makeDeps();
    await expect(
      runStatusTransition(deps, 7, { status: 'voting' }),
    ).rejects.toThrow(NotFoundException);
    expect(statusCalls(emit)).toEqual([]);
  });

  it('emits nothing when the transition is rejected', async () => {
    mockValidateTransition.mockImplementationOnce(() => {
      throw new Error('invalid transition');
    });
    const { deps, emit } = makeDeps();
    await expect(
      runStatusTransition(deps, 7, { status: 'voting' }),
    ).rejects.toThrow('invalid transition');
    expect(statusCalls(emit)).toEqual([]);
  });

  it('emits nothing when the conditional UPDATE loses its CAS', async () => {
    mockApplyStatusUpdate.mockRejectedValueOnce(new Error('status changed'));
    const { deps, emit } = makeDeps();
    await expect(
      runStatusTransition(deps, 7, { status: 'voting' }),
    ).rejects.toThrow('status changed');
    expect(statusCalls(emit)).toEqual([]);
  });
});
