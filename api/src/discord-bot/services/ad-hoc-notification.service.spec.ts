import { Test, TestingModule } from '@nestjs/testing';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from './discord-embed.factory';
import { ChannelBindingsService } from './channel-bindings.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import * as schema from '../../drizzle/schema';

describe('AdHocNotificationService', () => {
  let service: AdHocNotificationService;
  let mockDb: MockDb;
  let mockClientService: {
    sendEmbed: jest.Mock;
    editEmbed: jest.Mock;
    getGuildId: jest.Mock;
  };
  let mockEmbedFactory: {
    buildEventEmbed: jest.Mock;
  };
  let mockChannelBindingsService: {
    getBindingById: jest.Mock;
  };
  let mockChannelResolver: {
    resolveVoiceChannelForScheduledEvent: jest.Mock;
  };
  let mockSettingsService: {
    getBranding: jest.Mock;
    getClientUrl: jest.Mock;
    getDefaultTimezone: jest.Mock;
    getDiscordBotDefaultChannel: jest.Mock;
  };

  const fakeEmbed = { toJSON: () => ({}) };

  /** Mock the DB calls that buildEmbedEventData makes (event + game lookup) */
  function mockBuildEmbedData(event?: Record<string, unknown>) {
    // 1st limit: event lookup
    mockDb.limit.mockResolvedValueOnce([
      {
        id: event?.id ?? 42,
        title: event?.title ?? 'WoW — Quick Play',
        gameId: event?.gameId ?? 1,
        duration: event?.duration ?? [new Date(), new Date()],
        maxAttendees: null,
        slotConfig: { type: 'generic' },
        ...event,
      },
    ]);
    // 2nd limit: game lookup
    mockDb.limit.mockResolvedValueOnce([
      { name: 'World of Warcraft', coverUrl: 'https://example.com/wow.jpg' },
    ]);
  }

  function buildProviders() {
    return [
      AdHocNotificationService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: DiscordBotClientService, useValue: mockClientService },
      { provide: DiscordEmbedFactory, useValue: mockEmbedFactory },
      {
        provide: ChannelBindingsService,
        useValue: mockChannelBindingsService,
      },
      {
        provide: ChannelResolverService,
        useValue: mockChannelResolver,
      },
      { provide: SettingsService, useValue: mockSettingsService },
    ];
  }
  async function setupBlock() {
    jest.useFakeTimers();

    mockDb = createDrizzleMock();

    mockClientService = {
      sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      editEmbed: jest.fn().mockResolvedValue(undefined),
      getGuildId: jest.fn().mockReturnValue('guild-123'),
    };

    mockEmbedFactory = {
      buildEventEmbed: jest.fn().mockReturnValue({
        embed: fakeEmbed,
        row: undefined,
      }),
    };

    mockChannelBindingsService = {
      getBindingById: jest.fn(),
    };

    mockChannelResolver = {
      resolveVoiceChannelForScheduledEvent: jest.fn().mockResolvedValue(null),
    };

    mockSettingsService = {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
      getClientUrl: jest.fn().mockResolvedValue('https://example.com'),
      getDefaultTimezone: jest.fn().mockResolvedValue('America/New_York'),
      getDiscordBotDefaultChannel: jest
        .fn()
        .mockResolvedValue('default-channel'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(),
    }).compile();

    service = module.get(AdHocNotificationService);
  }

  beforeEach(async () => {
    await setupBlock();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('notifySpawn', () => {
    it('sends embed to configured notification channel', async () => {
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-1',
        config: { notificationChannelId: 'notif-channel-1' },
      });
      mockBuildEmbedData();

      await service.notifySpawn(
        42,
        'binding-1',
        { id: 42, title: 'WoW — Quick Play', gameName: 'WoW' },
        [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
      );

      expect(mockEmbedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 42,
          title: 'WoW — Quick Play',
          game: expect.objectContaining({ name: 'World of Warcraft' }),
        }),
        expect.any(Object),
        expect.objectContaining({ state: 'live', buttons: 'view' }),
      );
      expect(mockClientService.sendEmbed).toHaveBeenCalledWith(
        'notif-channel-1',
        expect.any(Object),
        undefined,
      );
    });

    it('falls back to default channel when binding has no notification channel', async () => {
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-2',
        config: {},
      });
      mockBuildEmbedData({
        id: 43,
        title: 'Gaming — Quick Play',
        gameId: null,
      });
      // No game lookup needed since gameId is null — override the second limit
      // (won't be consumed since gameId is null)

      await service.notifySpawn(
        43,
        'binding-2',
        { id: 43, title: 'Gaming — Quick Play' },
        [],
      );

      expect(
        mockSettingsService.getDiscordBotDefaultChannel,
      ).toHaveBeenCalled();
      expect(mockClientService.sendEmbed).toHaveBeenCalledWith(
        'default-channel',
        expect.any(Object),
        undefined,
      );
    });

    it('does nothing when binding not found', async () => {
      mockChannelBindingsService.getBindingById.mockResolvedValue(null);

      await service.notifySpawn(
        44,
        'nonexistent',
        { id: 44, title: 'Test' },
        [],
      );

      expect(mockClientService.sendEmbed).not.toHaveBeenCalled();
    });

    it('handles sendEmbed errors gracefully', async () => {
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-3',
        config: { notificationChannelId: 'channel-err' },
      });
      mockBuildEmbedData({ id: 45 });
      mockClientService.sendEmbed.mockRejectedValue(
        new Error('Discord API error'),
      );

      await expect(
        service.notifySpawn(45, 'binding-3', { id: 45, title: 'Test' }, []),
      ).resolves.not.toThrow();
    });

    it('inserts discord_event_messages row after posting (ROK-593)', async () => {
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-1',
        config: { notificationChannelId: 'notif-channel-1' },
      });
      mockBuildEmbedData();

      await service.notifySpawn(
        42,
        'binding-1',
        { id: 42, title: 'WoW — Quick Play', gameName: 'WoW' },
        [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
      );

      expect(mockDb.insert).toHaveBeenCalledWith(schema.discordEventMessages);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 42,
          guildId: 'guild-123',
          channelId: 'notif-channel-1',
          messageId: 'msg-1',
          embedState: 'live',
        }),
      );
    });

    it('skips discord_event_messages insert when guildId is null (ROK-593)', async () => {
      mockClientService.getGuildId.mockReturnValue(null);
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-1',
        config: { notificationChannelId: 'notif-channel-1' },
      });
      mockBuildEmbedData();

      await service.notifySpawn(
        42,
        'binding-1',
        { id: 42, title: 'WoW — Quick Play', gameName: 'WoW' },
        [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
      );

      // sendEmbed should still be called
      expect(mockClientService.sendEmbed).toHaveBeenCalled();
      // But no DB insert since guildId is null
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('notifyCompleted', () => {
    /** Helper: spawn an event so a tracked message is registered for edit-in-place. */
    async function spawnEvent(eventId: number) {
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-complete',
        config: { notificationChannelId: 'complete-channel' },
      });
      mockBuildEmbedData({ id: eventId });

      await service.notifySpawn(
        eventId,
        'binding-complete',
        { id: eventId, title: 'WoW — Quick Play', gameName: 'WoW' },
        [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
      );

      // Reset mocks so completion assertions are clean
      mockClientService.sendEmbed.mockClear();
      mockClientService.editEmbed.mockClear();
      mockEmbedFactory.buildEventEmbed.mockClear();
      mockEmbedFactory.buildEventEmbed.mockReturnValue({
        embed: fakeEmbed,
        row: undefined,
      });
    }

    async function testEditstheexistingembedinplaceinsteadofposting() {
      await spawnEvent(60);
      mockBuildEmbedData({ id: 60 });

      await service.notifyCompleted(
        60,
        'binding-complete',
        {
          id: 60,
          title: 'WoW — Quick Play',
          gameName: 'WoW',
          startTime: '2026-02-10T18:00:00Z',
          endTime: '2026-02-10T20:00:00Z',
        },
        [
          {
            discordUserId: 'user-1',
            discordUsername: 'Player1',
            totalDurationSeconds: 7200,
          },
        ],
      );

      expect(mockEmbedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 60 }),
        expect.any(Object),
        expect.objectContaining({ state: 'completed', buttons: 'none' }),
      );
      // Should edit, NOT send a new message
      expect(mockClientService.editEmbed).toHaveBeenCalledWith(
        'complete-channel',
        'msg-1',
        expect.any(Object),
        undefined,
      );
      expect(mockClientService.sendEmbed).not.toHaveBeenCalled();
    }

    it('edits the existing embed in-place instead of posting a new message (ROK-612)', async () => {
      await testEditstheexistingembedinplaceinsteadofposting();
    });

    it('cleans up pending updates after completion', async () => {
      await spawnEvent(70);
      mockBuildEmbedData({ id: 70 });

      // Queue an update
      service.queueUpdate(70, 'binding-complete');

      // Complete the event — should clear pending updates
      await service.notifyCompleted(
        70,
        'binding-complete',
        {
          id: 70,
          title: 'Cleanup Test',
          startTime: '2026-02-10T18:00:00Z',
          endTime: '2026-02-10T20:00:00Z',
        },
        [],
      );

      // Should have edited the embed
      expect(mockClientService.editEmbed).toHaveBeenCalledTimes(1);
    });

    it('handles edit errors gracefully', async () => {
      await spawnEvent(80);
      mockBuildEmbedData({ id: 80 });
      mockClientService.editEmbed.mockRejectedValue(new Error('fail'));

      await expect(
        service.notifyCompleted(
          80,
          'binding-complete',
          {
            id: 80,
            title: 'Error Test',
            startTime: '2026-02-10T18:00:00Z',
            endTime: '2026-02-10T20:00:00Z',
          },
          [],
        ),
      ).resolves.not.toThrow();
    });

    it('skips when no tracked message exists for the event', async () => {
      // No spawnEvent call — no tracked message
      await service.notifyCompleted(
        90,
        'nonexistent',
        {
          id: 90,
          title: 'No Tracked Message',
          startTime: '2026-02-10T18:00:00Z',
          endTime: '2026-02-10T20:00:00Z',
        },
        [],
      );

      expect(mockClientService.sendEmbed).not.toHaveBeenCalled();
      expect(mockClientService.editEmbed).not.toHaveBeenCalled();
    });
  });
});
