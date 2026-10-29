/**
 * ROK-2033 — `SchedulingLockInRecoveryService` orchestration (unit, mocked
 * helpers). The cron isolates each match and reports idle/degraded ticks; the
 * admin path maps "nothing to reopen" and "lost the race" to 409. The SQL
 * predicate itself is the integration spec's job.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SchedulingLockInRecoveryService } from './scheduling-lockin-recovery.service';
import * as helpers from './scheduling-lockin-recovery.helpers';

jest.mock('./scheduling-lockin-recovery.helpers', () => {
  const actual = jest.requireActual<typeof helpers>(
    './scheduling-lockin-recovery.helpers',
  );
  return {
    ...actual,
    findStaleClaims: jest.fn(),
    findRecoverableClaim: jest.fn(),
    recoverClaim: jest.fn(),
  };
});

const mocked = helpers as jest.Mocked<typeof helpers>;

function claim(matchId: number): helpers.PendingLockInClaim {
  return { matchId, claimedAt: new Date('2026-10-29T10:00:00.000Z') };
}

/** A db whose match lookup returns `rows`. */
interface QueryChain {
  select: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  limit: jest.Mock;
}

function dbReturning(rows: { id: number }[]): QueryChain {
  const chain: QueryChain = {
    select: jest.fn(() => chain),
    from: jest.fn(() => chain),
    where: jest.fn(() => chain),
    limit: jest.fn().mockResolvedValue(rows),
  };
  return chain;
}

function setup(rows: { id: number }[] = [{ id: 1 }]) {
  const cronJobService = { executeWithTracking: jest.fn() };
  const service = new SchedulingLockInRecoveryService(
    dbReturning(rows) as never,
    cronJobService as never,
    { delete: jest.fn() } as never,
    { fireUpdateEmbed: jest.fn() } as never,
  );
  return { service, cronJobService };
}

beforeEach(() => jest.resetAllMocks());

describe('SchedulingLockInRecoveryService.runSweep', () => {
  it('returns false on an idle tick and recovers nothing', async () => {
    mocked.findStaleClaims.mockResolvedValue([]);
    const { service } = setup();
    expect(await service.runSweep()).toBe(false);
    expect(mocked.recoverClaim).not.toHaveBeenCalled();
  });

  it('recovers every stale claim as the cron actor', async () => {
    mocked.findStaleClaims.mockResolvedValue([claim(1), claim(2)]);
    mocked.recoverClaim.mockResolvedValue({
      recovered: true,
      discardedEventIds: [],
    });
    const { service } = setup();
    expect(await service.runSweep()).toBeUndefined();
    expect(mocked.recoverClaim).toHaveBeenCalledTimes(2);
    expect(mocked.recoverClaim).toHaveBeenCalledWith(
      expect.anything(),
      claim(2),
      { kind: 'cron' },
    );
  });

  it('keeps sweeping past a throwing match and reports degraded', async () => {
    mocked.findStaleClaims.mockResolvedValue([claim(1), claim(2), claim(3)]);
    mocked.recoverClaim
      .mockResolvedValueOnce({ recovered: true, discardedEventIds: [] })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ recovered: true, discardedEventIds: [7] });
    const { service } = setup();
    expect(await service.runSweep()).toEqual({ degraded: true });
    const recoveredIds = mocked.recoverClaim.mock.calls.map(
      ([, c]) => c.matchId,
    );
    expect(recoveredIds).toEqual([1, 2, 3]);
  });

  it('passes the tick time to the stale-claim query', async () => {
    mocked.findStaleClaims.mockResolvedValue([]);
    const now = new Date('2026-10-29T12:00:00.000Z');
    const { service } = setup();
    await service.runSweep(now);
    expect(mocked.findStaleClaims).toHaveBeenCalledWith(expect.anything(), now);
  });

  it('runs under executeWithTracking with the CORE_JOB_METADATA name', async () => {
    const { service, cronJobService } = setup();
    await service.handleCron();
    expect(cronJobService.executeWithTracking).toHaveBeenCalledWith(
      'SchedulingLockInRecoveryService_runSweep',
      expect.any(Function),
    );
  });
});

describe('SchedulingLockInRecoveryService.reopenByAdmin', () => {
  it('404s a missing match', async () => {
    const { service } = setup([]);
    await expect(service.reopenByAdmin(9, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mocked.findRecoverableClaim).not.toHaveBeenCalled();
  });

  it('409s when the poll has no unlinked claim', async () => {
    mocked.findRecoverableClaim.mockResolvedValue(null);
    const { service } = setup();
    await expect(service.reopenByAdmin(1, 1)).rejects.toThrow(
      new ConflictException('This poll has no unfinished lock-in to reopen'),
    );
    expect(mocked.recoverClaim).not.toHaveBeenCalled();
  });

  it('409s when the in-flight request linked first', async () => {
    mocked.findRecoverableClaim.mockResolvedValue(claim(1));
    mocked.recoverClaim.mockResolvedValue({
      recovered: false,
      discardedEventIds: [],
    });
    const { service } = setup();
    await expect(service.reopenByAdmin(1, 42)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('recovers as the admin and returns the discarded ids', async () => {
    mocked.findRecoverableClaim.mockResolvedValue(claim(1));
    mocked.recoverClaim.mockResolvedValue({
      recovered: true,
      discardedEventIds: [5, 6],
    });
    const { service } = setup();
    expect(await service.reopenByAdmin(1, 42)).toEqual({
      matchId: 1,
      status: 'scheduling',
      discardedEventIds: [5, 6],
    });
    expect(mocked.recoverClaim).toHaveBeenCalledWith(
      expect.anything(),
      claim(1),
      { kind: 'admin', userId: 42 },
    );
  });
});

describe('lockInRecoverableField', () => {
  const stalled = {
    status: 'scheduled',
    linkedEventId: null,
    lockInClaimedAt: new Date(),
  };

  it('is true only for an admin on a claimed, unlinked poll', () => {
    expect(helpers.lockInRecoverableField(stalled, 'admin')).toEqual({
      lockInRecoverable: true,
    });
  });

  it.each([
    ['operator viewer', stalled, 'operator'],
    ['anonymous viewer', stalled, null],
    [
      'unstamped (reschedule / pre-migration)',
      { ...stalled, lockInClaimedAt: null },
      'admin',
    ],
    ['linked poll', { ...stalled, linkedEventId: 3 }, 'admin'],
    ['open poll', { ...stalled, status: 'scheduling' }, 'admin'],
  ] as const)('omits the key for a %s', (_label, match, role) => {
    expect(helpers.lockInRecoverableField(match, role)).toEqual({});
  });
});
