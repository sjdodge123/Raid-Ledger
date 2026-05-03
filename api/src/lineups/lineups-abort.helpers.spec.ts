/**
 * Unit tests for `runLineupAbort` (ROK-1062).
 *
 * The integration spec (`lineups-abort.integration.spec.ts`) covers the
 * happy path, role gates, and DB-level invariants. This file is the
 * fast-feedback loop for the orchestrator's call order, error mapping,
 * and embed-failure isolation.
 */
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { runLineupAbort, type AbortDeps } from './lineups-abort.helpers';

jest.mock('./lineups-query.helpers', () => ({
  findLineupById: jest.fn(),
  findUserDisplayName: jest.fn(),
}));
jest.mock('./lineups-lifecycle.helpers', () => ({
  applyStatusUpdate: jest.fn(),
}));
jest.mock('./lineups-response.helpers', () => ({
  buildDetailResponse: jest.fn(),
}));
jest.mock('./lineups-activity.helpers', () => ({
  logAborted: jest.fn(),
}));

import { findLineupById, findUserDisplayName } from './lineups-query.helpers';
import { applyStatusUpdate } from './lineups-lifecycle.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import { logAborted } from './lineups-activity.helpers';

const mockedFindLineupById = findLineupById as jest.MockedFunction<
  typeof findLineupById
>;
const mockedFindUserDisplayName = findUserDisplayName as jest.MockedFunction<
  typeof findUserDisplayName
>;
const mockedApplyStatusUpdate = applyStatusUpdate as jest.MockedFunction<
  typeof applyStatusUpdate
>;
const mockedBuildDetailResponse = buildDetailResponse as jest.MockedFunction<
  typeof buildDetailResponse
>;
const mockedLogAborted = logAborted as jest.MockedFunction<typeof logAborted>;

interface MockSetup {
  deps: AbortDeps;
  notifyAborted: jest.Mock;
  cancelAll: jest.Mock;
  emitStatusChange: jest.Mock;
  tiebreakerReset: jest.Mock;
}

function makeMocks(): MockSetup {
  const notifyAborted = jest.fn().mockResolvedValue(undefined);
  const cancelAll = jest.fn().mockResolvedValue(0);
  const emitStatusChange = jest.fn();
  const tiebreakerReset = jest.fn().mockResolvedValue(undefined);
  const deps = {
    db: {} as AbortDeps['db'],
    activityLog: {} as AbortDeps['activityLog'],
    phaseQueue: {
      cancelAllForLineup: cancelAll,
    } as unknown as AbortDeps['phaseQueue'],
    lineupNotifications: {
      notifyLineupAborted: notifyAborted,
    } as unknown as AbortDeps['lineupNotifications'],
    lineupsGateway: {
      emitStatusChange,
    } as unknown as AbortDeps['lineupsGateway'],
    tiebreaker: {
      reset: tiebreakerReset,
    } as unknown as AbortDeps['tiebreaker'],
    logger: new Logger('test'),
  };
  return { deps, notifyAborted, cancelAll, emitStatusChange, tiebreakerReset };
}

function buildingLineup(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    status: 'building',
    channelOverrideId: null,
    title: 'Test',
    description: null,
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof findLineupById>>[number];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedBuildDetailResponse.mockResolvedValue({} as never);
  mockedFindUserDisplayName.mockResolvedValue('Admin User');
  mockedLogAborted.mockResolvedValue(undefined);
  mockedApplyStatusUpdate.mockResolvedValue(undefined);
});

describe('runLineupAbort', () => {
  it('throws 404 when the lineup does not exist', async () => {
    const { deps } = makeMocks();
    mockedFindLineupById.mockResolvedValue([]);
    await expect(runLineupAbort(deps, 7, null, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws 409 when the lineup is already archived', async () => {
    const { deps, tiebreakerReset } = makeMocks();
    mockedFindLineupById.mockResolvedValue([
      buildingLineup({ status: 'archived' }),
    ]);
    await expect(runLineupAbort(deps, 7, null, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tiebreakerReset).not.toHaveBeenCalled();
    expect(mockedApplyStatusUpdate).not.toHaveBeenCalled();
  });

  it('runs side effects in the documented order on the happy path', async () => {
    const {
      deps,
      notifyAborted,
      cancelAll,
      emitStatusChange,
      tiebreakerReset,
    } = makeMocks();
    mockedFindLineupById.mockResolvedValue([buildingLineup()]);
    const calls: string[] = [];
    tiebreakerReset.mockImplementation(() => {
      calls.push('tiebreaker.reset');
      return Promise.resolve();
    });
    mockedApplyStatusUpdate.mockImplementation(() => {
      calls.push('applyStatusUpdate');
      return Promise.resolve();
    });
    cancelAll.mockImplementation(() => {
      calls.push('cancelAllForLineup');
      return Promise.resolve(0);
    });
    emitStatusChange.mockImplementation(() => {
      calls.push('emitStatusChange');
    });
    mockedLogAborted.mockImplementation(() => {
      calls.push('logAborted');
      return Promise.resolve();
    });
    notifyAborted.mockImplementation(() => {
      calls.push('notifyAborted');
      return Promise.resolve();
    });
    await runLineupAbort(deps, 7, ' Test reason ', 99);
    expect(calls).toEqual([
      'tiebreaker.reset',
      'applyStatusUpdate',
      'cancelAllForLineup',
      'emitStatusChange',
      'logAborted',
      'notifyAborted',
    ]);
    expect(mockedLogAborted).toHaveBeenCalledWith(
      deps.activityLog,
      7,
      99,
      'Test reason',
    );
    expect(emitStatusChange).toHaveBeenCalledWith(
      7,
      'archived',
      expect.any(Date),
    );
  });

  it('passes pre-abort status into the abort embed dispatch', async () => {
    const { deps, notifyAborted } = makeMocks();
    mockedFindLineupById.mockResolvedValue([
      buildingLineup({ status: 'voting' }),
    ]);
    await runLineupAbort(deps, 7, null, 99);
    expect(notifyAborted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, preAbortStatus: 'voting' }),
      null,
      'Admin User',
    );
  });

  it('normalises whitespace-only reason to null in the activity log', async () => {
    const { deps } = makeMocks();
    mockedFindLineupById.mockResolvedValue([buildingLineup()]);
    await runLineupAbort(deps, 7, '   ', 99);
    expect(mockedLogAborted).toHaveBeenCalledWith(
      deps.activityLog,
      7,
      99,
      null,
    );
  });

  it('propagates ConflictException from applyStatusUpdate (CAS race)', async () => {
    const { deps } = makeMocks();
    mockedFindLineupById.mockResolvedValue([buildingLineup()]);
    mockedApplyStatusUpdate.mockRejectedValueOnce(
      new ConflictException('Lineup 7 status changed concurrently'),
    );
    await expect(runLineupAbort(deps, 7, null, 99)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockedLogAborted).not.toHaveBeenCalled();
  });

  it('still writes the activity log when the abort embed throws', async () => {
    const { deps, notifyAborted } = makeMocks();
    mockedFindLineupById.mockResolvedValue([buildingLineup()]);
    notifyAborted.mockRejectedValueOnce(new Error('Discord 500'));
    const result = await runLineupAbort(deps, 7, null, 99);
    expect(result).toBeDefined();
    expect(mockedLogAborted).toHaveBeenCalled();
    expect(mockedBuildDetailResponse).toHaveBeenCalledWith(deps.db, 7);
  });
});
