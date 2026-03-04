import { Test, TestingModule } from '@nestjs/testing';
import { RecruitmentReminderService } from './recruitment-reminder.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import { NotificationService } from './notification.service';
import { SettingsService } from '../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

// Mock discord.js to avoid requiring a real Discord connection.
// Includes PermissionsBitField because discord-bot-client.service.ts references
// PermissionsBitField.Flags.* at module load time (outside any constructor/method).
jest.mock('discord.js', () => {
  class MockClient {
    login = jest.fn().mockResolvedValue(undefined);
    destroy = jest.fn().mockResolvedValue(undefined);
    isReady = jest.fn().mockReturnValue(false);
  }

  class MockEmbedBuilder {
    private data: Record<string, unknown> = {};
    setTitle(title: string) {
      this.data.title = title;
      return this;
    }
    setDescription(desc: string) {
      this.data.description = desc;
      return this;
    }
    setColor(color: number) {
      this.data.color = color;
      return this;
    }
    setTimestamp(ts?: Date) {
      this.data.timestamp = ts ?? new Date();
      return this;
    }
    toJSON() {
      return this.data;
    }
  }

  class MockButtonBuilder {
    private data: Record<string, unknown> = {};
    setLabel(label: string) {
      this.data.label = label;
      return this;
    }
    setStyle(style: number) {
      this.data.style = style;
      return this;
    }
    setURL(url: string) {
      this.data.url = url;
      return this;
    }
    toJSON() {
      return this.data;
    }
  }

  class MockActionRowBuilder {
    private components: Array<{ toJSON: () => unknown }> = [];
    addComponents(
      ...args: Array<
        { toJSON: () => unknown } | Array<{ toJSON: () => unknown }>
      >
    ) {
      for (const arg of args) {
        if (Array.isArray(arg)) {
          this.components.push(...arg);
        } else {
          this.components.push(arg);
        }
      }
      return this;
    }
    toJSON() {
      return { components: this.components.map((c) => c.toJSON()) };
    }
  }

  return {
    Client: MockClient,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      GuildMembers: 4,
      DirectMessages: 64,
    },
    Events: { ClientReady: 'ready', Error: 'error' },
    PermissionsBitField: {
      Flags: {
        ManageRoles: BigInt(268435456),
        ManageChannels: BigInt(16),
        CreateInstantInvite: BigInt(1),
        ViewChannel: BigInt(1024),
        SendMessages: BigInt(2048),
        EmbedLinks: BigInt(16384),
        ReadMessageHistory: BigInt(65536),
        SendPolls: BigInt(0),
        AttachFiles: BigInt(32768),
        AddReactions: BigInt(64),
        UseExternalEmojis: BigInt(262144),
        MentionEveryone: BigInt(131072),
        ManageMessages: BigInt(8192),
      },
    },
    EmbedBuilder: MockEmbedBuilder,
    ButtonBuilder: MockButtonBuilder,
    ActionRowBuilder: MockActionRowBuilder,
    ButtonStyle: { Link: 5, Danger: 4, Secondary: 2, Success: 3 },
  };
});

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
    ...overrides,
  };
}

describe('RecruitmentReminderService', () => {
  let service: RecruitmentReminderService;
  let mockDb: { execute: jest.Mock };
  let mockRedis: { get: jest.Mock; set: jest.Mock };
  let mockNotificationService: {
    create: jest.Mock;
    resolveVoiceChannelId: jest.Mock;
  };
  let mockSettingsService: {
    getDefaultTimezone: jest.Mock;
    getClientUrl: jest.Mock;
  };
  let mockDiscordBotClient: { isConnected: jest.Mock; sendEmbed: jest.Mock };
  let mockCronJobService: { executeWithTracking: jest.Mock };

  beforeEach(async () => {
    mockDb = { execute: jest.fn() };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    mockNotificationService = {
      create: jest.fn().mockResolvedValue({ id: 'notif-uuid-1' }),
      resolveVoiceChannelId: jest.fn().mockResolvedValue(null),
    };

    mockSettingsService = {
      getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
      getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    };

    mockDiscordBotClient = {
      isConnected: jest.fn().mockReturnValue(true),
      sendEmbed: jest.fn().mockResolvedValue(undefined),
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

    it('should include voiceChannelId in payload when resolveVoiceChannelId returns a value', async () => {
      mockNotificationService.resolveVoiceChannelId.mockResolvedValue('vc-999');

      await service.checkAndSendReminders();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ voiceChannelId: 'vc-999' }),
        }),
      );
    });

    it('should NOT include voiceChannelId in payload when resolveVoiceChannelId returns null', async () => {
      mockNotificationService.resolveVoiceChannelId.mockResolvedValue(null);

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
});
