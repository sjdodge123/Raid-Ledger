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
    findPollLeaderOutcome: jest.fn(),
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
  mocked.findPollLeaderOutcome.mockResolvedValue({
    leader: LEADER,
    answered: true,
  });
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

  it('on a poll nobody answered: no DM and the key is never marked', async () => {
    const { service, notificationService, dedupService } = setup();
    mocked.findExpiryWarnCandidates.mockResolvedValue([candidate(1)]);
    mocked.findPollLeaderOutcome.mockResolvedValue({
      leader: null,
      answered: false,
    });

    const result = await service.runSweep();

    expect(dedupService.checkAndMarkSent).not.toHaveBeenCalled();
    expect(dedupService.releaseKey).not.toHaveBeenCalled();
    expect(notificationService.create).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  // ROK-1617 item D (operator: "No time worked"): the poll WAS answered but
  // no time cleared the leader floor — the creator still gets told, and the
  // DM must not offer a Lock button for a time that is not leading.
  it('DMs "no time worked" with no slotId/lockLabel when answers exist', async () => {
    const { service, notificationService, dedupService } = setup();
    mocked.findExpiryWarnCandidates.mockResolvedValue([candidate(1)]);
    mocked.findPollLeaderOutcome.mockResolvedValue({
      leader: null,
      answered: true,
    });

    await service.runSweep();

    // Its OWN key, so a later leader still earns the leader DM.
    expect(dedupService.checkAndMarkSent).toHaveBeenCalledWith(
      'sched-poll-expiry-warn:1:no-leader',
      null,
    );
    expect(notificationService.create).toHaveBeenCalledTimes(1);
    const arg = notificationService.create.mock.calls[0][0];
    expect(arg.title).toBe('Your Valheim poll closes soon');
    expect(arg.message).toMatch(/^No time worked for the group yet/);
    expect(arg.message).not.toMatch(/leading time/i);
    expect(arg.payload).not.toHaveProperty('slotId');
    expect(arg.payload).not.toHaveProperty('lockLabel');
    expect(arg.payload).toMatchObject({
      subtype: 'scheduling_poll_expiry_warning',
      matchId: 1,
    });
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

/**
 * ROK-1617 follow-up: the "no time worked" DM and the leader DM are DIFFERENT
 * messages, so they need different dedup keys. Sharing one let the no-leader
 * DM at T-12h consume the claim, after which the leader DM — the only one
 * carrying the Lock button — could never fire however many yes votes landed.
 */
describe('warning DM — no-leader and leader keys are independent', () => {
  /** A dedup mock that remembers keys, like the DB-backed table does. */
  function rememberKeys(dedup: { checkAndMarkSent: jest.Mock }): void {
    const marked = new Set<string>();
    dedup.checkAndMarkSent.mockImplementation((key: string) => {
      const alreadySent = marked.has(key);
      marked.add(key);
      return Promise.resolve(alreadySent);
    });
  }

  /** `no-leader` / `leader`, read off the payload's Lock affordance. */
  function dmKinds(create: jest.Mock): string[] {
    return create.mock.calls.map((call) =>
      call[0].payload.slotId === undefined ? 'no-leader' : 'leader',
    );
  }

  it('still sends the leader DM when a later vote crowns a leader', async () => {
    const { service, notificationService, dedupService } = setup();
    rememberKeys(dedupService);
    mocked.findExpiryWarnCandidates.mockResolvedValue([candidate(1)]);

    // T-12h: the only slot is 2 yes / 2 no — nothing clears the floor.
    mocked.findPollLeaderOutcome.mockResolvedValue({
      leader: null,
      answered: true,
    });
    await service.runSweep();
    // T-10h: two more yes votes land, so a time now leads.
    mocked.findPollLeaderOutcome.mockResolvedValue({
      leader: LEADER,
      answered: true,
    });
    await service.runSweep();

    expect(dmKinds(notificationService.create)).toEqual([
      'no-leader',
      'leader',
    ]);
    expect(dedupService.checkAndMarkSent).toHaveBeenCalledWith(
      'sched-poll-expiry-warn:1:no-leader',
      null,
    );
    expect(dedupService.checkAndMarkSent).toHaveBeenCalledWith(
      'sched-poll-expiry-warn:1',
      null,
    );
  });

  /**
   * Codex P2 (follow-up review): separate dedup keys are not enough. The
   * Discord layer buckets its 5-minute DM rate limit on `payload.reminderWindow`
   * (`discord-notification.service.ts:186-197`), and the sweep runs every 5
   * minutes — so a shared `expiry-{matchId}` window lets the no-leader DM
   * swallow the leader DM at the Discord layer while its dedup key is already
   * marked sent (never retried). The two messages need two buckets.
   */
  it('gives the no-leader DM its own Discord rate-limit bucket', async () => {
    const { service, notificationService, dedupService } = setup();
    rememberKeys(dedupService);
    mocked.findExpiryWarnCandidates.mockResolvedValue([candidate(1)]);

    mocked.findPollLeaderOutcome.mockResolvedValue({
      leader: null,
      answered: true,
    });
    await service.runSweep();
    mocked.findPollLeaderOutcome.mockResolvedValue({
      leader: LEADER,
      answered: true,
    });
    await service.runSweep();

    const windows = notificationService.create.mock.calls.map(
      (call) => call[0].payload.reminderWindow,
    );
    expect(windows).toEqual(['expiry-noleader-1', 'expiry-1']);
  });

  it('sends the leader DM at most once across ticks', async () => {
    const { service, notificationService, dedupService } = setup();
    rememberKeys(dedupService);
    mocked.findExpiryWarnCandidates.mockResolvedValue([candidate(1)]);

    await service.runSweep();
    await service.runSweep();

    expect(dmKinds(notificationService.create)).toEqual(['leader']);
  });

  it('sends the "no time worked" DM at most once across ticks', async () => {
    const { service, notificationService, dedupService } = setup();
    rememberKeys(dedupService);
    mocked.findExpiryWarnCandidates.mockResolvedValue([candidate(1)]);
    mocked.findPollLeaderOutcome.mockResolvedValue({
      leader: null,
      answered: true,
    });

    await service.runSweep();
    await service.runSweep();

    expect(dmKinds(notificationService.create)).toEqual(['no-leader']);
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
