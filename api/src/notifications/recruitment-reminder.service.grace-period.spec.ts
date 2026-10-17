import { RecruitmentReminderService } from './recruitment-reminder.service';
import {
  makeEventRow,
  createRecruitmentReminderTestModule,
  type RecruitmentReminderTestMocks,
} from './recruitment-reminder.service.spec-helpers';

// Mock discord.js — uses shared mock (includes Client + PermissionsBitField)
jest.mock(
  'discord.js',
  () =>
    jest.requireActual('../common/testing/discord-js-mock').discordJsFullMock,
);

describe('RecruitmentReminderService — grace period (ROK-826)', () => {
  let service: RecruitmentReminderService;
  let mocks: RecruitmentReminderTestMocks;

  beforeEach(async () => {
    ({ service, mocks } = await createRecruitmentReminderTestModule());
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should skip event created 30h before start when cron runs 1h after creation (needs 6h grace)', async () => {
    const createdAt = new Date('2026-03-15T10:00:00Z');
    const startTime = new Date('2026-03-16T16:00:00Z'); // 30h after creation
    const cronTime = new Date('2026-03-15T11:00:00Z'); // 1h after creation

    jest.setSystemTime(cronTime);

    const event = makeEventRow({
      created_at: createdAt.toISOString(),
      start_time: startTime.toISOString(),
    });
    mocks.mockDb.execute.mockResolvedValueOnce([event]);

    const result = await service.checkAndSendReminders();

    expect(result).toBe(false);
    expect(mocks.mockDedupService.checkAndMarkSent).not.toHaveBeenCalled();
    expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
    expect(mocks.mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
  });

  it('should process event created 30h before start when cron runs 7h after creation (6h grace elapsed)', async () => {
    const createdAt = new Date('2026-03-15T10:00:00Z');
    const startTime = new Date('2026-03-16T16:00:00Z'); // 30h after creation
    const cronTime = new Date('2026-03-15T17:00:00Z'); // 7h after creation

    jest.setSystemTime(cronTime);

    const event = makeEventRow({
      created_at: createdAt.toISOString(),
      start_time: startTime.toISOString(),
    });
    mocks.mockDb.execute
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([{ id: 5 }])
      .mockResolvedValueOnce([]);

    await service.checkAndSendReminders();

    expect(mocks.mockNotificationService.create).toHaveBeenCalledTimes(1);
  });

  it('should skip event created 50h before start when cron runs 5h after creation (needs 12h grace)', async () => {
    const createdAt = new Date('2026-03-15T10:00:00Z');
    const startTime = new Date('2026-03-17T12:00:00Z'); // 50h after creation
    const cronTime = new Date('2026-03-15T15:00:00Z'); // 5h after creation

    jest.setSystemTime(cronTime);

    const event = makeEventRow({
      created_at: createdAt.toISOString(),
      start_time: startTime.toISOString(),
    });
    mocks.mockDb.execute.mockResolvedValueOnce([event]);

    const result = await service.checkAndSendReminders();

    expect(result).toBe(false);
    expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
  });

  it('should process event created 50h before start when cron runs 13h after creation (12h grace elapsed)', async () => {
    const createdAt = new Date('2026-03-15T10:00:00Z');
    const startTime = new Date('2026-03-17T12:00:00Z'); // 50h after creation
    const cronTime = new Date('2026-03-15T23:00:00Z'); // 13h after creation

    jest.setSystemTime(cronTime);

    const event = makeEventRow({
      created_at: createdAt.toISOString(),
      start_time: startTime.toISOString(),
    });
    mocks.mockDb.execute
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([]); // findRecipients (DMs deferred — >24h away)

    await service.checkAndSendReminders();

    // Event is >24h away so DMs are deferred, but bump proves it was processed
    expect(mocks.mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
  });

  it('should process event created 80h before start (no grace, >72h)', async () => {
    const createdAt = new Date('2026-03-12T10:00:00Z');
    const startTime = new Date('2026-03-15T18:00:00Z'); // 80h after creation
    const cronTime = new Date('2026-03-12T10:15:00Z'); // 15min after creation

    jest.setSystemTime(cronTime);

    const event = makeEventRow({
      created_at: createdAt.toISOString(),
      start_time: startTime.toISOString(),
    });
    mocks.mockDb.execute
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([]); // findRecipients (DMs deferred — >24h away)

    await service.checkAndSendReminders();

    // Event is >24h away so DMs are deferred, but bump proves it was processed
    expect(mocks.mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
  });

  it('should skip event created 10h before start when cron runs 30min after creation (short-notice ROK-1240)', async () => {
    const createdAt = new Date('2026-03-15T10:00:00Z');
    const startTime = new Date('2026-03-15T20:00:00Z'); // 10h after creation
    const cronTime = new Date('2026-03-15T10:30:00Z'); // 30min after creation

    jest.setSystemTime(cronTime);

    const event = makeEventRow({
      created_at: createdAt.toISOString(),
      start_time: startTime.toISOString(),
    });
    mocks.mockDb.execute.mockResolvedValueOnce([event]);

    const result = await service.checkAndSendReminders();

    expect(result).toBe(false);
    expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
  });

  it('should ALSO skip event created 10h before start even when cron runs 2h later (short-notice suppression is permanent ROK-1240)', async () => {
    // Pre-ROK-1240 this test used to expect the event to fire after the
    // 1h grace elapsed. The new policy: events with start - created < 12h
    // are suppressed entirely, regardless of how much time has passed.
    const createdAt = new Date('2026-03-15T10:00:00Z');
    const startTime = new Date('2026-03-15T20:00:00Z'); // 10h after creation
    const cronTime = new Date('2026-03-15T12:00:00Z'); // 2h after creation

    jest.setSystemTime(cronTime);

    const event = makeEventRow({
      created_at: createdAt.toISOString(),
      start_time: startTime.toISOString(),
    });
    mocks.mockDb.execute.mockResolvedValueOnce([event]);

    const result = await service.checkAndSendReminders();

    expect(result).toBe(false);
    expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
    expect(mocks.mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
    expect(mocks.mockDedupService.checkAndMarkSent).not.toHaveBeenCalled();
  });

  it('should NOT set Redis bump key for events still within grace period', async () => {
    const createdAt = new Date('2026-03-15T10:00:00Z');
    const startTime = new Date('2026-03-16T16:00:00Z'); // 30h → 6h grace
    const cronTime = new Date('2026-03-15T11:00:00Z'); // 1h after creation — within grace

    jest.setSystemTime(cronTime);

    const event = makeEventRow({
      id: 77,
      created_at: createdAt.toISOString(),
      start_time: startTime.toISOString(),
    });
    mocks.mockDb.execute.mockResolvedValueOnce([event]);

    await service.checkAndSendReminders();

    expect(mocks.mockDedupService.checkAndMarkSent).not.toHaveBeenCalled();
  });

  it('should only process the non-grace event when batch contains both grace and non-grace events', async () => {
    const now = new Date('2026-03-15T12:00:00Z');
    jest.setSystemTime(now);

    // Event in grace period: created 1h ago, starts in 30h → 6h grace active
    const graceEvent = makeEventRow({
      id: 10,
      created_at: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      start_time: new Date(now.getTime() + 30 * 60 * 60 * 1000).toISOString(),
    });
    // Event past grace: created 10h ago, starts in 20h → 6h grace (10h elapsed)
    const eligibleEvent = makeEventRow({
      id: 20,
      created_at: new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString(),
      start_time: new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString(),
    });

    mocks.mockDb.execute
      .mockResolvedValueOnce([graceEvent, eligibleEvent])
      .mockResolvedValueOnce([{ id: 5 }]) // findRecipients for event 20 only
      .mockResolvedValueOnce([]); // findAbsentUsers for event 20

    await service.checkAndSendReminders();

    expect(mocks.mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
      'recruitment-bump:event:20',
      172800,
    );
    expect(mocks.mockDedupService.checkAndMarkSent).not.toHaveBeenCalledWith(
      'recruitment-bump:event:10',
      172800,
    );
    expect(mocks.mockNotificationService.create).toHaveBeenCalledTimes(1);
  });

  it('should return false when all events in batch are within grace period', async () => {
    const now = new Date('2026-03-15T10:30:00Z');
    jest.setSystemTime(now);

    const grace1 = makeEventRow({
      id: 1,
      created_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      start_time: new Date(now.getTime() + 30 * 60 * 60 * 1000).toISOString(),
    });
    const grace2 = makeEventRow({
      id: 2,
      created_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      start_time: new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString(),
    });

    mocks.mockDb.execute.mockResolvedValueOnce([grace1, grace2]);

    const result = await service.checkAndSendReminders();

    expect(result).toBe(false);
    expect(mocks.mockDedupService.checkAndMarkSent).not.toHaveBeenCalled();
    expect(mocks.mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
    expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
  });

  it('should NOT apply grace period to event created exactly 72h before start', () => {
    const createdAt = new Date('2026-03-10T10:00:00Z');
    const startTime = new Date(createdAt.getTime() + 72 * 60 * 60 * 1000);
    const cronTime = new Date(createdAt.getTime() + 1000); // 1s after creation

    jest.setSystemTime(cronTime);

    const event = makeEventRow({
      id: 88,
      created_at: createdAt.toISOString(),
      start_time: startTime.toISOString(),
    });
    mocks.mockDb.execute
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([]); // findRecipients (>24h away, DMs deferred)

    return service.checkAndSendReminders().then(() => {
      expect(mocks.mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        'recruitment-bump:event:88',
        172800,
      );
    });
  });

  it('should apply grace period to event created 1ms before 72h boundary (71h59m59.999s)', async () => {
    const createdAt = new Date('2026-03-10T10:00:00Z');
    const startTime = new Date(createdAt.getTime() + 72 * 60 * 60 * 1000 - 1); // 1ms below 72h
    const cronTime = new Date(createdAt.getTime() + 60 * 60 * 1000);

    jest.setSystemTime(cronTime);

    const event = makeEventRow({
      id: 89,
      created_at: createdAt.toISOString(),
      start_time: startTime.toISOString(),
    });
    mocks.mockDb.execute.mockResolvedValueOnce([event]);

    const result = await service.checkAndSendReminders();

    expect(result).toBe(false);
    expect(mocks.mockDedupService.checkAndMarkSent).not.toHaveBeenCalled();
  });

  // ROK-1240 — short-notice cadence suppression
  describe('short-notice suppression (ROK-1240)', () => {
    it('should suppress an 8h-out event with same-day createdAt (no embed, no DM, no dedup write)', async () => {
      const now = new Date('2026-04-20T13:00:00Z');
      jest.setSystemTime(now);

      const createdAt = new Date('2026-04-20T10:00:00Z'); // 3h ago
      const startTime = new Date('2026-04-20T18:00:00Z'); // 5h from now → 8h gap
      const event = makeEventRow({
        id: 555,
        created_at: createdAt.toISOString(),
        start_time: startTime.toISOString(),
      });
      mocks.mockDb.execute.mockResolvedValueOnce([event]);

      const result = await service.checkAndSendReminders();

      expect(result).toBe(false);
      expect(mocks.mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
      expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
      expect(mocks.mockDedupService.checkAndMarkSent).not.toHaveBeenCalled();
    });

    it('should NOT suppress when start - created exceeds threshold (12h gap fires normally)', async () => {
      // 8h-out event scheduled 30h before start → not short-notice. Cron
      // runs 22h after creation, past any tier grace.
      const createdAt = new Date('2026-04-20T00:00:00Z');
      const startTime = new Date('2026-04-21T06:00:00Z'); // 30h gap
      const cronTime = new Date('2026-04-20T22:00:00Z'); // 22h after creation
      jest.setSystemTime(cronTime);

      const event = makeEventRow({
        id: 556,
        created_at: createdAt.toISOString(),
        start_time: startTime.toISOString(),
      });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mocks.mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
      expect(mocks.mockNotificationService.create).toHaveBeenCalledTimes(1);
    });

    it('should suppress at boundary minus 1ms (start - created = 12h - 1ms)', async () => {
      const createdAt = new Date('2026-04-20T10:00:00Z');
      const startTime = new Date(createdAt.getTime() + 12 * 60 * 60 * 1000 - 1);
      const cronTime = new Date(createdAt.getTime() + 11 * 60 * 60 * 1000);
      jest.setSystemTime(cronTime);

      const event = makeEventRow({
        id: 557,
        created_at: createdAt.toISOString(),
        start_time: startTime.toISOString(),
      });
      mocks.mockDb.execute.mockResolvedValueOnce([event]);

      const result = await service.checkAndSendReminders();

      expect(result).toBe(false);
      expect(mocks.mockDedupService.checkAndMarkSent).not.toHaveBeenCalled();
    });

    it('should NOT suppress at exactly threshold (start - created = 12h)', async () => {
      // start - created = exactly 12h → threshold means suppress when < 12h,
      // so this should NOT be suppressed (falls into 12-24h tier with 3h grace).
      // Cron runs 5h after creation (past 3h grace).
      const createdAt = new Date('2026-04-20T10:00:00Z');
      const startTime = new Date(createdAt.getTime() + 12 * 60 * 60 * 1000);
      const cronTime = new Date(createdAt.getTime() + 5 * 60 * 60 * 1000);
      jest.setSystemTime(cronTime);

      const event = makeEventRow({
        id: 558,
        created_at: createdAt.toISOString(),
        start_time: startTime.toISOString(),
      });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mocks.mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
      expect(mocks.mockNotificationService.create).toHaveBeenCalledTimes(1);
    });

    it('should suppress both channel bump AND DM dispatch in a single gating call', async () => {
      // Recurrence regression — Gamer Saloon 2026-05-10: event scheduled
      // same-day, created 6h before start. Both paths must stay silent.
      const createdAt = new Date('2026-05-10T15:00:00Z');
      const startTime = new Date('2026-05-10T21:00:00Z'); // 6h gap
      const cronTime = new Date('2026-05-10T17:00:00Z'); // 4h to start
      jest.setSystemTime(cronTime);

      const event = makeEventRow({
        id: 559,
        created_at: createdAt.toISOString(),
        start_time: startTime.toISOString(),
      });
      mocks.mockDb.execute.mockResolvedValueOnce([event]);

      await service.checkAndSendReminders();

      // Channel embed not posted
      expect(mocks.mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
      // DM not created
      expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
      // Dedup keys NOT marked — re-runs of the cron must remain idempotent
      // and not "burn" the key for an event we never actually notified on
      expect(mocks.mockDedupService.checkAndMarkSent).not.toHaveBeenCalled();
    });

    it('should honour RECRUITMENT_SHORT_NOTICE_HOURS env override (raise threshold to 24h)', async () => {
      const original = process.env.RECRUITMENT_SHORT_NOTICE_HOURS;
      process.env.RECRUITMENT_SHORT_NOTICE_HOURS = '24';
      try {
        // 18h-gap event would normally NOT be short-notice (< 12h default)
        // but with threshold raised to 24h it becomes one.
        const createdAt = new Date('2026-04-20T10:00:00Z');
        const startTime = new Date('2026-04-21T04:00:00Z'); // 18h gap
        const cronTime = new Date('2026-04-20T15:00:00Z'); // 5h after creation, past 3h grace
        jest.setSystemTime(cronTime);

        const event = makeEventRow({
          id: 560,
          created_at: createdAt.toISOString(),
          start_time: startTime.toISOString(),
        });
        mocks.mockDb.execute.mockResolvedValueOnce([event]);

        const result = await service.checkAndSendReminders();

        expect(result).toBe(false);
        expect(mocks.mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
      } finally {
        if (original === undefined) {
          delete process.env.RECRUITMENT_SHORT_NOTICE_HOURS;
        } else {
          process.env.RECRUITMENT_SHORT_NOTICE_HOURS = original;
        }
      }
    });
  });
});
