import { Test, TestingModule } from '@nestjs/testing';
import { RecruitmentReminderService } from './recruitment-reminder.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import { NotificationService } from './notification.service';
import { SettingsService } from '../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

// Mock discord.js — uses shared mock (includes Client + PermissionsBitField)
jest.mock(
  'discord.js',
  () =>
    jest.requireActual('../common/testing/discord-js-mock').discordJsFullMock,
);

/**
 * Helper to build a minimal EligibleEvent-shaped row returned from db.execute
 * for the findEligibleEvents query.
 */
function makeEventRow(
  overrides: Partial<{
    id: number;
    title: string;
    game_id: number;
    game_name: string;
    creator_id: number;
    start_time: string;
    max_attendees: number | null;
    signup_count: string;
    channel_id: string;
    guild_id: string;
    message_id: string;
    created_at: string;
  }> = {},
) {
  return {
    id: 42,
    title: 'Mythic Raid Night',
    game_id: 7,
    game_name: 'World of Warcraft',
    creator_id: 1,
    start_time: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
    max_attendees: 20,
    signup_count: '10',
    channel_id: 'channel-abc',
    guild_id: 'guild-xyz',
    message_id: 'msg-123',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe('RecruitmentReminderService', () => {
  let service: RecruitmentReminderService;
  let mockDb: {
    execute: jest.Mock;
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
  };
  let mockRedis: { get: jest.Mock; set: jest.Mock };
  let mockNotificationService: {
    create: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  let mockSettingsService: {
    getDefaultTimezone: jest.Mock;
    getClientUrl: jest.Mock;
  };
  let mockDiscordBotClient: { isConnected: jest.Mock; sendEmbed: jest.Mock };
  let mockCronJobService: { executeWithTracking: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      execute: jest.fn(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    mockNotificationService = {
      create: jest.fn().mockResolvedValue({ id: 'notif-uuid-1' }),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
    };

    mockSettingsService = {
      getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
      getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    };

    mockDiscordBotClient = {
      isConnected: jest.fn().mockReturnValue(true),
      sendEmbed: jest.fn().mockResolvedValue({ id: 'bump-msg-001' }),
    };

    mockCronJobService = {
      executeWithTracking: jest.fn((_name: string, fn: () => Promise<void>) =>
        fn(),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecruitmentReminderService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: DiscordBotClientService, useValue: mockDiscordBotClient },
        { provide: CronJobService, useValue: mockCronJobService },
      ],
    }).compile();

    service = module.get<RecruitmentReminderService>(
      RecruitmentReminderService,
    );
  });

  describe('handleCron', () => {
    it('should delegate to CronJobService.executeWithTracking', async () => {
      mockDb.execute.mockResolvedValue([]);

      await service.handleCron();

      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'RecruitmentReminderService_checkAndSendReminders',
        expect.any(Function),
      );
    });
  });

  describe('checkAndSendReminders — no eligible events', () => {
    it('should do nothing when no eligible events are found', async () => {
      mockDb.execute.mockResolvedValue([]);

      await service.checkAndSendReminders();

      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
    });
  });

  describe('checkAndSendReminders — deduplication', () => {
    it('should skip event when both Redis dedup keys already exist', async () => {
      const event = makeEventRow();
      mockDb.execute.mockResolvedValueOnce([event]);
      mockRedis.get.mockResolvedValue('1'); // both bump and dm keys exist

      await service.checkAndSendReminders();

      expect(mockRedis.get).toHaveBeenCalledWith('recruitment-bump:event:42');
      expect(mockRedis.get).toHaveBeenCalledWith('recruitment-dm:event:42');
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should set Redis DM dedup key with 48h TTL before dispatching DMs', async () => {
      const event = makeEventRow();
      mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([{ id: 10 }, { id: 11 }]) // findRecipients
        .mockResolvedValueOnce([]); // findAbsentUsers

      await service.checkAndSendReminders();

      expect(mockRedis.set).toHaveBeenCalledWith(
        'recruitment-dm:event:42',
        '1',
        'EX',
        48 * 60 * 60,
      );
    });

    it('should process multiple events independently', async () => {
      const event1 = makeEventRow({ id: 10, title: 'Event 1' });
      const event2 = makeEventRow({ id: 20, title: 'Event 2' });
      mockDb.execute
        .mockResolvedValueOnce([event1, event2]) // findEligibleEvents
        .mockResolvedValueOnce([]) // findRecipients for event1
        .mockResolvedValueOnce([]) // findRecipients for event2
        .mockResolvedValueOnce([]); // findAbsentUsers — may not be called when no recipients

      mockRedis.get.mockResolvedValue(null); // neither event deduplicated

      await service.checkAndSendReminders();

      expect(mockRedis.get).toHaveBeenCalledWith('recruitment-bump:event:10');
      expect(mockRedis.get).toHaveBeenCalledWith('recruitment-bump:event:20');
    });
  });

  describe('checkAndSendReminders — recipients', () => {
    it('should send DMs to all recipients when none are absent', async () => {
      const event = makeEventRow();
      mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([{ id: 5 }, { id: 6 }, { id: 7 }]) // findRecipients
        .mockResolvedValueOnce([]); // findAbsentUsers → no absent users

      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(3);
    });

    it('should exclude absent users from DM list', async () => {
      const event = makeEventRow();
      mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([{ id: 5 }, { id: 6 }, { id: 7 }]) // findRecipients
        .mockResolvedValueOnce([{ user_id: 6 }]); // findAbsentUsers → user 6 is absent

      await service.checkAndSendReminders();

      // Only 2 DMs: users 5 and 7 (not 6)
      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      const calls = mockNotificationService.create.mock.calls.map(
        (c: Array<{ userId: number }>) => c[0].userId,
      );
      expect(calls).toContain(5);
      expect(calls).toContain(7);
      expect(calls).not.toContain(6);
    });

    it('should exclude ALL users when all are absent', async () => {
      const event = makeEventRow();
      mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([{ id: 5 }, { id: 6 }]) // findRecipients
        .mockResolvedValueOnce([{ user_id: 5 }, { user_id: 6 }]); // both absent

      await service.checkAndSendReminders();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should skip absent user check when recipient list is empty', async () => {
      const event = makeEventRow();
      mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([]); // findRecipients → empty

      await service.checkAndSendReminders();

      // findAbsentUsers should not fire a DB query when there are no recipients
      // db.execute called: findEligibleEvents + findRecipients only = 2 times
      expect(mockDb.execute).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should still post channel bump even when there are no recipients', async () => {
      const event = makeEventRow();
      mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([]); // findRecipients → empty

      await service.checkAndSendReminders();

      // Channel bump should still fire
      expect(mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkAndSendReminders — DM notification payload', () => {
    beforeEach(() => {
      // Default: one event, two recipients, no absences
      const event = makeEventRow({
        id: 42,
        title: 'Mythic Raid Night',
        game_id: 7,
        game_name: 'World of Warcraft',
        creator_id: 1,
        start_time: '2026-03-04T20:00:00.000Z',
        max_attendees: 20,
        signup_count: '10',
        channel_id: 'channel-abc',
        guild_id: 'guild-xyz',
        message_id: 'msg-123',
      });
      mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);
    });

    it('should create notification with type recruitment_reminder', async () => {
      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'recruitment_reminder' }),
      );
    });

    it('should include eventId in notification payload', async () => {
      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ eventId: 42 }),
        }),
      );
    });

    it('should include gameName in notification payload', async () => {
      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ gameName: 'World of Warcraft' }),
        }),
      );
    });

    it('should include signupSummary with max_attendees when set', async () => {
      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            signupSummary: '10/20 spots filled',
          }),
        }),
      );
    });

    it('should include event URL in payload', async () => {
      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            url: 'http://localhost:5173/events/42',
          }),
        }),
      );
    });

    it('should include discordUrl in payload', async () => {
      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            discordUrl:
              'https://discord.com/channels/guild-xyz/channel-abc/msg-123',
          }),
        }),
      );
    });

    it('should include startTime in payload', async () => {
      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            startTime: '2026-03-04T20:00:00.000Z',
          }),
        }),
      );
    });

    it('should include voiceChannelId in payload when resolveVoiceChannelForEvent returns a value', async () => {
      mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(
        'vc-999',
      );

      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ voiceChannelId: 'vc-999' }),
        }),
      );
    });

    it('should NOT include voiceChannelId in payload when resolveVoiceChannelForEvent returns null', async () => {
      mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(
        null,
      );

      await service.checkAndSendReminders();

      const call = mockNotificationService.create.mock.calls[0][0];
      expect(call.payload).not.toHaveProperty('voiceChannelId');
    });

    it('should set title to "Spots Available — {eventTitle}"', async () => {
      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Spots Available — Mythic Raid Night',
        }),
      );
    });
  });

  describe('checkAndSendReminders — signupSummary formatting', () => {
    it('should format signupSummary as "X signed up" when max_attendees is null', async () => {
      const event = makeEventRow({ max_attendees: null, signup_count: '5' });
      mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ signupSummary: '5 signed up' }),
        }),
      );
    });

    it('should format signupSummary as "X/Y spots filled" when max_attendees is set', async () => {
      const event = makeEventRow({ max_attendees: 30, signup_count: '15' });
      mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            signupSummary: '15/30 spots filled',
          }),
        }),
      );
    });
  });

  describe('checkAndSendReminders — error handling in sendRecruitmentDMs', () => {
    it('should continue processing remaining recipients when one DM fails', async () => {
      const event = makeEventRow();
      mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }, { id: 6 }])
        .mockResolvedValueOnce([]);

      // First notification fails, second succeeds
      mockNotificationService.create
        .mockRejectedValueOnce(new Error('DM failed for user 5'))
        .mockResolvedValueOnce({ id: 'notif-uuid-2' });

      // Should not throw
      await expect(service.checkAndSendReminders()).resolves.not.toThrow();

      // Both were attempted
      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    });

    it('should still post channel bump when DM sending fails', async () => {
      const event = makeEventRow();
      mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      mockNotificationService.create.mockRejectedValue(new Error('DM failed'));

      await service.checkAndSendReminders();

      expect(mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkAndSendReminders — channel bump', () => {
    it('should post channel bump embed when bot is connected', async () => {
      const event = makeEventRow();
      mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockDiscordBotClient.isConnected.mockReturnValue(true);

      await service.checkAndSendReminders();

      expect(mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
      expect(mockDiscordBotClient.sendEmbed).toHaveBeenCalledWith(
        'channel-abc',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should skip channel bump when bot is not connected', async () => {
      const event = makeEventRow();
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      mockDiscordBotClient.isConnected.mockReturnValue(false);

      await service.checkAndSendReminders();

      expect(mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('should not throw when channel bump sendEmbed fails', async () => {
      const event = makeEventRow();
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      mockDiscordBotClient.sendEmbed.mockRejectedValue(
        new Error('Channel not found'),
      );

      await expect(service.checkAndSendReminders()).resolves.not.toThrow();
    });

    it('should use clientUrl from settings in the bump Sign Up button URL', async () => {
      const event = makeEventRow({ id: 99 });
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      mockSettingsService.getClientUrl.mockResolvedValue(
        'https://raidledger.example.com',
      );

      await service.checkAndSendReminders();

      // sendEmbed is called with (channelId, embed, row)
      const [, , row] = mockDiscordBotClient.sendEmbed.mock.calls[0] as [
        string,
        unknown,
        { toJSON: () => { components: Array<{ url: string; label: string }> } },
      ];
      const rowJson = row.toJSON();
      const signUpBtn = rowJson.components.find(
        (c: { label: string }) => c.label === 'View Event',
      );
      expect(signUpBtn).toBeDefined();
      expect(signUpBtn?.url).toContain(
        'https://raidledger.example.com/events/99',
      );
    });

    it('should fall back to http://localhost:5173 for clientUrl when settings returns null', async () => {
      const event = makeEventRow({ id: 55 });
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      mockSettingsService.getClientUrl.mockResolvedValue(null);

      await service.checkAndSendReminders();

      const [, , row] = mockDiscordBotClient.sendEmbed.mock.calls[0] as [
        string,
        unknown,
        { toJSON: () => { components: Array<{ url: string; label: string }> } },
      ];
      const rowJson = row.toJSON();
      const signUpBtn = rowJson.components.find(
        (c: { label: string }) => c.label === 'View Event',
      );
      expect(signUpBtn?.url).toContain('http://localhost:5173/events/55');
    });

    it('should skip channel bump when event is full (signupCount >= maxAttendees)', async () => {
      const event = makeEventRow({
        max_attendees: 10,
        signup_count: '10',
      });
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('should skip channel bump when event is over-full (signupCount > maxAttendees)', async () => {
      const event = makeEventRow({
        max_attendees: 10,
        signup_count: '12',
      });
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('should post channel bump when max_attendees is null (no cap)', async () => {
      const event = makeEventRow({
        max_attendees: null,
        signup_count: '50',
      });
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('should use "tomorrow" in embed title when event is <= 24h away', async () => {
      const event = makeEventRow({
        start_time: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
      });
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      const [, embed] = mockDiscordBotClient.sendEmbed.mock.calls[0] as [
        string,
        { toJSON: () => { title: string } },
      ];
      expect(embed.toJSON().title).toContain('tomorrow');
    });

    it('should use "in Xh" in embed title when event is > 24h away', async () => {
      const event = makeEventRow({
        start_time: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      });
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      const [, embed] = mockDiscordBotClient.sendEmbed.mock.calls[0] as [
        string,
        { toJSON: () => { title: string } },
      ];
      expect(embed.toJSON().title).toMatch(/in \d+h/);
      expect(embed.toJSON().title).not.toContain('tomorrow');
    });

    it('should embed description contain event title, gameName, and signupSummary', async () => {
      const event = makeEventRow({
        id: 42,
        title: 'Mythic Raid Night',
        game_name: 'World of Warcraft',
        max_attendees: 20,
        signup_count: '10',
      });
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      const [, embed] = mockDiscordBotClient.sendEmbed.mock.calls[0] as [
        string,
        { toJSON: () => { description: string; title: string } },
      ];
      const embedJson = embed.toJSON();
      expect(embedJson.description).toContain('Mythic Raid Night');
      expect(embedJson.description).toContain('World of Warcraft');
      expect(embedJson.description).toContain('10/20 spots filled');
    });
  });

  describe('checkAndSendReminders — settings fallbacks', () => {
    it('should fall back to UTC when getDefaultTimezone returns null', async () => {
      mockSettingsService.getDefaultTimezone.mockResolvedValue(null);

      const event = makeEventRow();
      mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      // Should not throw — UTC fallback is used
      await expect(service.checkAndSendReminders()).resolves.not.toThrow();
      expect(mockNotificationService.create).toHaveBeenCalled();
    });
  });

  describe('checkAndSendReminders — bump message ID persistence (ROK-728)', () => {
    it('should persist bump message ID after posting channel bump', async () => {
      const event = makeEventRow({ id: 42 });
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);
      mockDiscordBotClient.sendEmbed.mockResolvedValue({ id: 'bump-msg-999' });

      await service.checkAndSendReminders();

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ bumpMessageId: 'bump-msg-999' }),
      );
    });

    it('should not persist bump message ID when bot is disconnected', async () => {
      const event = makeEventRow();
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);
      mockDiscordBotClient.isConnected.mockReturnValue(false);

      await service.checkAndSendReminders();

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should not persist bump message ID when event is full', async () => {
      const event = makeEventRow({
        max_attendees: 10,
        signup_count: '10',
      });
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('checkAndSendReminders — grace period (ROK-826)', () => {
    beforeEach(() => {
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
      mockDb.execute.mockResolvedValueOnce([event]);

      const result = await service.checkAndSendReminders();

      expect(result).toBe(false);
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
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
      mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
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
      mockDb.execute.mockResolvedValueOnce([event]);

      const result = await service.checkAndSendReminders();

      expect(result).toBe(false);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
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
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]); // findRecipients (DMs deferred — >24h away)

      await service.checkAndSendReminders();

      // Event is >24h away so DMs are deferred, but bump proves it was processed
      expect(mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
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
      mockDb.execute.mockResolvedValueOnce([event]).mockResolvedValueOnce([]); // findRecipients (DMs deferred — >24h away)

      await service.checkAndSendReminders();

      // Event is >24h away so DMs are deferred, but bump proves it was processed
      expect(mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('should skip event created 10h before start when cron runs 30min after creation (needs 1h grace)', async () => {
      const createdAt = new Date('2026-03-15T10:00:00Z');
      const startTime = new Date('2026-03-15T20:00:00Z'); // 10h after creation
      const cronTime = new Date('2026-03-15T10:30:00Z'); // 30min after creation

      jest.setSystemTime(cronTime);

      const event = makeEventRow({
        created_at: createdAt.toISOString(),
        start_time: startTime.toISOString(),
      });
      mockDb.execute.mockResolvedValueOnce([event]);

      const result = await service.checkAndSendReminders();

      expect(result).toBe(false);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should process event created 10h before start when cron runs 2h after creation (1h grace elapsed)', async () => {
      const createdAt = new Date('2026-03-15T10:00:00Z');
      const startTime = new Date('2026-03-15T20:00:00Z'); // 10h after creation
      const cronTime = new Date('2026-03-15T12:00:00Z'); // 2h after creation

      jest.setSystemTime(cronTime);

      const event = makeEventRow({
        created_at: createdAt.toISOString(),
        start_time: startTime.toISOString(),
      });
      mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
    });

    // Adversarial: Redis dedup key must NOT be set for grace-period events

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
      mockDb.execute.mockResolvedValueOnce([event]);

      await service.checkAndSendReminders();

      expect(mockRedis.set).not.toHaveBeenCalledWith(
        'recruitment-bump:event:77',
        '1',
        'EX',
        expect.any(Number),
      );
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    // Adversarial: mixed batch — only non-grace events should be processed

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

      mockDb.execute
        .mockResolvedValueOnce([graceEvent, eligibleEvent])
        .mockResolvedValueOnce([{ id: 5 }]) // findRecipients for event 20 only
        .mockResolvedValueOnce([]); // findAbsentUsers for event 20

      await service.checkAndSendReminders();

      // Only the eligible event (id=20) triggers Redis and processing
      expect(mockRedis.get).toHaveBeenCalledWith('recruitment-bump:event:20');
      expect(mockRedis.get).not.toHaveBeenCalledWith(
        'recruitment-bump:event:10',
      );
      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
    });

    it('should return false when all events in batch are within grace period', async () => {
      const now = new Date('2026-03-15T10:30:00Z');
      jest.setSystemTime(now);

      const grace1 = makeEventRow({
        id: 1,
        created_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString(), // 30min ago
        start_time: new Date(now.getTime() + 30 * 60 * 60 * 1000).toISOString(), // 30h later → 6h grace
      });
      const grace2 = makeEventRow({
        id: 2,
        created_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString(), // 15min ago
        start_time: new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString(), // 20h later → 6h grace
      });

      mockDb.execute.mockResolvedValueOnce([grace1, grace2]);

      const result = await service.checkAndSendReminders();

      expect(result).toBe(false);
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    // Adversarial: grace period at the 72h boundary — events created exactly at 72h get no grace

    it('should NOT apply grace period to event created exactly 72h before start', () => {
      const createdAt = new Date('2026-03-10T10:00:00Z');
      const startTime = new Date(
        createdAt.getTime() + 72 * 60 * 60 * 1000,
      );
      // Grace = 0 at exactly 72h, so cron immediately after creation should process it
      const cronTime = new Date(createdAt.getTime() + 1000); // 1s after creation

      jest.setSystemTime(cronTime);
      // Cannot directly test isWithinGracePeriod via service here without a DB call stub,
      // but we verify the DB mock is hit (i.e., the event is processed through)
      // by confirming Redis.get IS called (bump check fires = event processed)
      const event = makeEventRow({
        id: 88,
        created_at: createdAt.toISOString(),
        start_time: startTime.toISOString(),
      });
      mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]); // findRecipients (>24h away, DMs deferred)

      return service.checkAndSendReminders().then(() => {
        expect(mockRedis.get).toHaveBeenCalledWith('recruitment-bump:event:88');
      });
    });

    it('should apply grace period to event created 1ms before 72h boundary (71h59m59.999s)', async () => {
      const createdAt = new Date('2026-03-10T10:00:00Z');
      const startTime = new Date(
        createdAt.getTime() + 72 * 60 * 60 * 1000 - 1,
      ); // 1ms below 72h
      // Grace = 12h; cron runs 1h after creation — within grace
      const cronTime = new Date(createdAt.getTime() + 60 * 60 * 1000);

      jest.setSystemTime(cronTime);

      const event = makeEventRow({
        id: 89,
        created_at: createdAt.toISOString(),
        start_time: startTime.toISOString(),
      });
      mockDb.execute.mockResolvedValueOnce([event]);

      const result = await service.checkAndSendReminders();

      expect(result).toBe(false);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });
});
