/**
 * Unit tests for maybeAutoAdvance (ROK-1118 / ROK-1253).
 *
 * ROK-1253 reshaped the helper from "transition immediately" to
 * "schedule grace, transition only when graceMs=0 (escape hatch)".
 * The cases here exercise the branch points without spinning up a real DB.
 */
import type { Logger } from '@nestjs/common';

jest.mock('./lineups-query.helpers', () => ({
  findLineupById: jest.fn(),
}));

jest.mock('./lineups-transition.helpers', () => ({
  runStatusTransition: jest.fn(),
}));

jest.mock('./quorum/quorum-check.helpers', () => ({
  checkBuildingQuorum: jest.fn(),
  checkVotingQuorum: jest.fn(),
}));

jest.mock('./tiebreaker/tie-hold.helpers', () => ({
  openTieHold: jest.fn(),
}));
jest.mock('./tiebreaker/tie-notify.helpers', () => ({
  announceTieDetected: jest.fn(),
}));

import { findLineupById } from './lineups-query.helpers';
import { runStatusTransition } from './lineups-transition.helpers';
import {
  checkBuildingQuorum,
  checkVotingQuorum,
} from './quorum/quorum-check.helpers';
import { openTieHold } from './tiebreaker/tie-hold.helpers';
import { announceTieDetected } from './tiebreaker/tie-notify.helpers';
import { maybeAutoAdvance } from './lineups-auto-advance.helpers';

function makeLogger(): Logger {
  return {
    warn: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  } as unknown as Logger;
}

function makeSettings(graceMs: string | null = null): {
  get: jest.Mock;
} {
  return {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'lineup_auto_advance_grace_ms') return graceMs;
      return null;
    }),
  };
}

function makeDeps(
  opts: {
    logger?: Logger;
    graceMs?: string | null;
    updateReturning?: Array<{ id: number }>;
  } = {},
) {
  const logger = opts.logger ?? makeLogger();
  const settings = makeSettings(opts.graceMs ?? null);
  // Drizzle update chain: db.update().set().where().returning()
  const returning = jest
    .fn()
    .mockResolvedValue(opts.updateReturning ?? [{ id: 7 }]);
  const where = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue(undefined),
  });
  const update = jest.fn().mockReturnValue({ set });
  // For claimGraceWindow we need a different shape: set().where().returning()
  set.mockReturnValue({ where });
  const phaseQueue = {
    scheduleGraceAdvance: jest.fn().mockResolvedValue(undefined),
    cancelGraceAdvance: jest.fn().mockResolvedValue(undefined),
  };
  // ROK-1253 rework: `scheduleOrAdvance` now emits via the gateway on a
  // successful grace claim. Provide a stub so the unit cases that exercise
  // that path don't trip on `undefined.emitGraceScheduled`.
  const lineupsGateway = {
    emitGraceScheduled: jest.fn(),
    emitStatusChange: jest.fn(),
  };
  return {
    db: { update } as never,
    activityLog: {} as never,
    settings: settings as never,
    phaseQueue: phaseQueue as never,
    lineupNotifications: {} as never,
    lineupsGateway: lineupsGateway as never,
    // ROK-1473: entered-scheduling hook emitter (matching is mocked here).
    eventEmitter: { emit: jest.fn() } as never,
    logger,
    _phaseQueue: phaseQueue,
    _settings: settings,
    _lineupsGateway: lineupsGateway,
  };
}

function setLineup(
  status: string | null,
  overrides: Record<string, unknown> = {},
) {
  if (status === null) {
    (findLineupById as jest.Mock).mockResolvedValue([]);
  } else {
    (findLineupById as jest.Mock).mockResolvedValue([
      {
        id: 7,
        status,
        autoAdvancePausedAt: null,
        pendingAdvanceAt: null,
        ...overrides,
      },
    ]);
  }
}

describe('maybeAutoAdvance', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns silently when the lineup does not exist', async () => {
    setLineup(null);
    const deps = makeDeps();
    await maybeAutoAdvance(deps, 7);
    expect(runStatusTransition).not.toHaveBeenCalled();
    expect(deps._phaseQueue.scheduleGraceAdvance).not.toHaveBeenCalled();
  });

  it('no-ops on terminal status (decided)', async () => {
    setLineup('decided');
    const deps = makeDeps();
    await maybeAutoAdvance(deps, 7);
    expect(checkBuildingQuorum).not.toHaveBeenCalled();
    expect(checkVotingQuorum).not.toHaveBeenCalled();
    expect(runStatusTransition).not.toHaveBeenCalled();
    expect(deps._phaseQueue.scheduleGraceAdvance).not.toHaveBeenCalled();
  });

  it('does not schedule when building quorum is not ready', async () => {
    setLineup('building');
    (checkBuildingQuorum as jest.Mock).mockResolvedValue({
      ready: false,
      reason: 'floor',
    });
    const deps = makeDeps();
    await maybeAutoAdvance(deps, 7);
    expect(runStatusTransition).not.toHaveBeenCalled();
    expect(deps._phaseQueue.scheduleGraceAdvance).not.toHaveBeenCalled();
  });

  it('schedules grace job when building quorum is ready', async () => {
    setLineup('building');
    (checkBuildingQuorum as jest.Mock).mockResolvedValue({ ready: true });
    const deps = makeDeps();
    await maybeAutoAdvance(deps, 7);
    expect(runStatusTransition).not.toHaveBeenCalled();
    expect(deps._phaseQueue.scheduleGraceAdvance).toHaveBeenCalledWith(
      7,
      expect.any(Number),
    );
  });

  it('schedules grace job when voting quorum is ready', async () => {
    setLineup('voting');
    (checkVotingQuorum as jest.Mock).mockResolvedValue({ ready: true });
    const deps = makeDeps();
    await maybeAutoAdvance(deps, 7);
    expect(runStatusTransition).not.toHaveBeenCalled();
    expect(deps._phaseQueue.scheduleGraceAdvance).toHaveBeenCalledWith(
      7,
      expect.any(Number),
    );
  });

  it('escape hatch: graceMs=0 advances immediately', async () => {
    setLineup('building');
    (checkBuildingQuorum as jest.Mock).mockResolvedValue({ ready: true });
    (runStatusTransition as jest.Mock).mockResolvedValue(undefined);
    const deps = makeDeps({ graceMs: '0' });
    await maybeAutoAdvance(deps, 7);
    expect(runStatusTransition).toHaveBeenCalledWith(expect.any(Object), 7, {
      status: 'voting',
    });
    expect(deps._phaseQueue.scheduleGraceAdvance).not.toHaveBeenCalled();
  });

  // ROK-1374: a tie is a COMPLETED vote. The tie-aware quorum (D1) reports
  // `ready: false` for it, and reading only `ready` here would schedule
  // nothing at all — the dead-end one step earlier. Mutation: change the
  // guard back to `!quorum.ready` and the first case fails on the
  // scheduleGraceAdvance call count.
  it('ROK-1374: claims the grace window when voting quorum reports a tie', async () => {
    setLineup('voting');
    (checkVotingQuorum as jest.Mock).mockResolvedValue({
      ready: false,
      reason: 'tie awaiting a pick',
      tie: { tiedGameIds: [7, 9], voteCount: 1 },
    });
    const deps = makeDeps();
    await maybeAutoAdvance(deps, 7);
    expect(deps._phaseQueue.scheduleGraceAdvance).toHaveBeenCalledWith(
      7,
      expect.any(Number),
    );
    expect(runStatusTransition).not.toHaveBeenCalled();
    expect(openTieHold).not.toHaveBeenCalled();
  });

  it('ROK-1374: graceMs=0 with a tie opens the hold instead of the doomed transition', async () => {
    setLineup('voting');
    const tie = { tiedGameIds: [7, 9], voteCount: 1 };
    (checkVotingQuorum as jest.Mock).mockResolvedValue({
      ready: false,
      reason: 'tie awaiting a pick',
      tie,
    });
    (openTieHold as jest.Mock).mockResolvedValue({ opened: true });
    const deps = makeDeps({ graceMs: '0' });
    await maybeAutoAdvance(deps, 7);
    expect(openTieHold).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({ id: 7, status: 'voting' }),
      tie,
    );
    expect(runStatusTransition).not.toHaveBeenCalled();
    expect(deps._phaseQueue.scheduleGraceAdvance).not.toHaveBeenCalled();
    // Review 2026-09-05: this third detection path announces on the edge too.
    expect(announceTieDetected).toHaveBeenCalledTimes(1);
    expect(announceTieDetected).toHaveBeenCalledWith(
      undefined,
      deps.logger,
      expect.objectContaining({ id: 7 }),
      tie,
    );
  });

  it('ROK-1374: graceMs=0 re-entry on an armed hold announces NOTHING', async () => {
    setLineup('voting');
    const tie = { tiedGameIds: [7, 9], voteCount: 1 };
    (checkVotingQuorum as jest.Mock).mockResolvedValue({
      ready: false,
      reason: 'tie awaiting a pick',
      tie,
    });
    (openTieHold as jest.Mock).mockResolvedValue({ opened: false });
    await maybeAutoAdvance(makeDeps({ graceMs: '0' }), 7);
    expect(announceTieDetected).not.toHaveBeenCalled();
  });

  it('does not re-schedule when pendingAdvanceAt already set', async () => {
    setLineup('voting', { pendingAdvanceAt: new Date() });
    (checkVotingQuorum as jest.Mock).mockResolvedValue({ ready: true });
    const deps = makeDeps();
    await maybeAutoAdvance(deps, 7);
    expect(deps._phaseQueue.scheduleGraceAdvance).not.toHaveBeenCalled();
  });

  it('swallows arbitrary errors from the quorum check', async () => {
    setLineup('voting');
    (checkVotingQuorum as jest.Mock).mockRejectedValue(new Error('boom'));
    const logger = makeLogger();
    await expect(
      maybeAutoAdvance(makeDeps({ logger }), 7),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
