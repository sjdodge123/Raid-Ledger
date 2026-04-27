/**
 * Unit tests for maybeAutoAdvance (ROK-1118).
 */
import type { Logger } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';

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

import { findLineupById } from './lineups-query.helpers';
import { runStatusTransition } from './lineups-transition.helpers';
import {
  checkBuildingQuorum,
  checkVotingQuorum,
} from './quorum/quorum-check.helpers';
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

function makeDeps(logger: Logger = makeLogger()) {
  return {
    db: {} as never,
    activityLog: {} as never,
    settings: {} as never,
    phaseQueue: {} as never,
    lineupNotifications: {} as never,
    logger,
  };
}

function setLineup(status: string | null) {
  if (status === null) {
    (findLineupById as jest.Mock).mockResolvedValue([]);
  } else {
    (findLineupById as jest.Mock).mockResolvedValue([{ id: 7, status }]);
  }
}

describe('maybeAutoAdvance', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns silently when the lineup does not exist', async () => {
    setLineup(null);
    await maybeAutoAdvance(makeDeps(), 7);
    expect(runStatusTransition).not.toHaveBeenCalled();
  });

  it('no-ops on terminal status (decided)', async () => {
    setLineup('decided');
    await maybeAutoAdvance(makeDeps(), 7);
    expect(checkBuildingQuorum).not.toHaveBeenCalled();
    expect(checkVotingQuorum).not.toHaveBeenCalled();
    expect(runStatusTransition).not.toHaveBeenCalled();
  });

  it('does not transition when building quorum is not ready', async () => {
    setLineup('building');
    (checkBuildingQuorum as jest.Mock).mockResolvedValue({
      ready: false,
      reason: 'floor',
    });
    await maybeAutoAdvance(makeDeps(), 7);
    expect(runStatusTransition).not.toHaveBeenCalled();
  });

  it('transitions building → voting when quorum is ready', async () => {
    setLineup('building');
    (checkBuildingQuorum as jest.Mock).mockResolvedValue({ ready: true });
    (runStatusTransition as jest.Mock).mockResolvedValue(undefined);

    await maybeAutoAdvance(makeDeps(), 7);

    expect(runStatusTransition).toHaveBeenCalledWith(expect.any(Object), 7, {
      status: 'voting',
    });
  });

  it('transitions voting → decided when quorum is ready', async () => {
    setLineup('voting');
    (checkVotingQuorum as jest.Mock).mockResolvedValue({ ready: true });
    (runStatusTransition as jest.Mock).mockResolvedValue(undefined);

    await maybeAutoAdvance(makeDeps(), 7);

    expect(runStatusTransition).toHaveBeenCalledWith(expect.any(Object), 7, {
      status: 'decided',
    });
  });

  it('swallows ConflictException from a concurrent caller', async () => {
    setLineup('voting');
    (checkVotingQuorum as jest.Mock).mockResolvedValue({ ready: true });
    (runStatusTransition as jest.Mock).mockRejectedValue(
      new ConflictException('raced'),
    );
    const logger = makeLogger();

    await expect(
      maybeAutoAdvance(makeDeps(logger), 7),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('maybeAutoAdvance(7)'),
    );
  });

  it('swallows arbitrary errors from the quorum check', async () => {
    setLineup('voting');
    (checkVotingQuorum as jest.Mock).mockRejectedValue(new Error('boom'));
    const logger = makeLogger();

    await expect(
      maybeAutoAdvance(makeDeps(logger), 7),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
