/**
 * ROK-1604 — `SchedulingPollExpiryService` orchestration (unit, mocked deps).
 *
 * Pins S3-AC1 (warning payload), S3-AC4 (one expired re-render per poll) and
 * S3-AC5 (permanent dedup key, release on dispatch failure, no mark/release
 * churn when there is no leading slot). Query behaviour is the integration
 * spec's job.
 */
import { SchedulingPollExpiryService } from './scheduling-poll-expiry.service';
import * as helpers from './scheduling-poll-expiry.helpers';

jest.mock('./scheduling-poll-expiry.helpers', () => {
  const actual = jest.requireActual<typeof helpers>(
    './scheduling-poll-expiry.helpers',
  );
  return {
    ...actual,
    findExpiryWarnCandidates: jest.fn(),
    findExpiredEmbedMatchIds: jest.fn(),
    findLeadingFutureSlot: jest.fn(),
  };
});

const mocked = helpers as jest.Mocked<typeof helpers>;
const HOUR_MS = 3_600_000;

function candidate(matchId: number, hours = 11): helpers.ExpiryWarnCandidate {
  return {
    lineupId: 100 + matchId,
    matchId,
    creatorId: 500 + matchId,
    gameName: 'Valheim',
    phaseDeadline: new Date(Date.now() + hours * HOUR_MS),
  };
}

const LEADER: helpers.LeadingSlot = {
  slotId: 77,
  proposedTime: new Date(Date.now() + 20 * HOUR_MS).toISOString(),
  voteCount: 2,
};

function setup() {
  const notificationService = { create: jest.fn().mockResolvedValue({}) };
  const dedupService = {
    checkAndMarkSent: jest.fn().mockResolvedValue(false),
    releaseKey: jest.fn().mockResolvedValue(undefined),
  };
  const cronJobService = { executeWithTracking: jest.fn() };
  const pollEmbed = { fireUpdateEmbed: jest.fn() };
  const settingsService = {
    getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
  };
  const service = new SchedulingPollExpiryService(
    {} as never,
    notificationService as never,
    dedupService as never,
    cronJobService as never,
    pollEmbed as never,
    settingsService as never,
  );
  return { service, notificationService, dedupService, pollEmbed };
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.findExpiryWarnCandidates.mockResolvedValue([]);
  mocked.findExpiredEmbedMatchIds.mockResolvedValue([]);
  mocked.findLeadingFutureSlot.mockResolvedValue(LEADER);
});

describe('warning DM (S3-AC1, S3-AC5)', () => {
  it('DMs the creator once with the lock payload under a permanent key', async () => {
    const { service, notificationService, dedupService } = setup();
    mocked.findExpiryWarnCandidates.mockResolvedValue([candidate(1)]);

    await service.runSweep();

    expect(dedupService.checkAndMarkSent).toHaveBeenCalledWith(
      'sched-poll-expiry-warn:1',
      null,
    );
    expect(notificationService.create).toHaveBeenCalledTimes(1);
    const arg = notificationService.create.mock.calls[0][0];
    expect(arg).toMatchObject({
      userId: 501,
      type: 'community_lineup',
      title: 'Your Valheim poll closes soon',
      payload: {
        subtype: 'scheduling_poll_expiry_warning',
        reminderWindow: 'expiry-1',
        lineupId: 101,
        matchId: 1,
        slotId: 77,
      },
    });
    expect(arg.payload.lockLabel).toMatch(
      /^Lock in \w{3} \d{1,2}:\d{2} [AP]M$/,
    );
  });
});

describe('warning DM — skips and failures (S3-AC5)', () => {
  it('skips a poll already warned (dedup hit)', async () => {
    const { service, notificationService, dedupService } = setup();
    mocked.findExpiryWarnCandidates.mockResolvedValue([candidate(1)]);
    dedupService.checkAndMarkSent.mockResolvedValue(true);

    await service.runSweep();

    expect(notificationService.create).not.toHaveBeenCalled();
  });

  it('with no voted future slot: no DM and the key is never marked', async () => {
    const { service, notificationService, dedupService } = setup();
    mocked.findExpiryWarnCandidates.mockResolvedValue([candidate(1)]);
    mocked.findLeadingFutureSlot.mockResolvedValue(null);

    const result = await service.runSweep();

    expect(dedupService.checkAndMarkSent).not.toHaveBeenCalled();
    expect(dedupService.releaseKey).not.toHaveBeenCalled();
    expect(notificationService.create).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('skips a candidate whose deadline drifted outside the window', async () => {
    const { service, notificationService } = setup();
    mocked.findExpiryWarnCandidates.mockResolvedValue([candidate(1, 13)]);

    await service.runSweep();

    expect(notificationService.create).not.toHaveBeenCalled();
  });

  it('releases the key when dispatch throws and reports degraded', async () => {
    const { service, notificationService, dedupService } = setup();
    mocked.findExpiryWarnCandidates.mockResolvedValue([
      candidate(1),
      candidate(2),
    ]);
    notificationService.create
      .mockRejectedValueOnce(new Error('dispatch exploded'))
      .mockResolvedValueOnce({});

    const result = await service.runSweep();

    expect(dedupService.releaseKey).toHaveBeenCalledWith(
      'sched-poll-expiry-warn:1',
    );
    // Per-poll isolation: poll 2 still warned.
    expect(notificationService.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ degraded: true });
  });
});

describe('expired re-render (S3-AC4)', () => {
  it('fires one embed update per newly-expired poll under a permanent key', async () => {
    const { service, pollEmbed, dedupService } = setup();
    mocked.findExpiredEmbedMatchIds.mockResolvedValue([5, 6]);
    dedupService.checkAndMarkSent.mockImplementation((key: string) =>
      Promise.resolve(key === 'sched-poll-expired-embed:6'),
    );

    const result = await service.runSweep();

    expect(dedupService.checkAndMarkSent).toHaveBeenCalledWith(
      'sched-poll-expired-embed:5',
      null,
    );
    expect(pollEmbed.fireUpdateEmbed).toHaveBeenCalledTimes(1);
    expect(pollEmbed.fireUpdateEmbed).toHaveBeenCalledWith(5);
    expect(result).toBeUndefined();
  });

  it('returns false on an idle tick', async () => {
    const { service } = setup();
    await expect(service.runSweep()).resolves.toBe(false);
  });

  it('a failing warn phase does not starve the re-render phase', async () => {
    const { service, pollEmbed } = setup();
    mocked.findExpiryWarnCandidates.mockRejectedValue(new Error('db down'));
    mocked.findExpiredEmbedMatchIds.mockResolvedValue([5]);

    const result = await service.runSweep();

    expect(pollEmbed.fireUpdateEmbed).toHaveBeenCalledWith(5);
    expect(result).toEqual({ degraded: true });
  });
});
