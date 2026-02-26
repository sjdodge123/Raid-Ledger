import { Test, TestingModule } from '@nestjs/testing';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from './discord-embed.factory';
import { ChannelBindingsService } from './channel-bindings.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../../common/testing/drizzle-mock';

describe('AdHocNotificationService', () => {
  let service: AdHocNotificationService;
  let mockDb: MockDb;
  let mockClientService: {
    sendEmbed: jest.Mock;
    editEmbed: jest.Mock;
  };
  let mockEmbedFactory: {
    buildAdHocSpawnEmbed: jest.Mock;
    buildAdHocUpdateEmbed: jest.Mock;
    buildAdHocCompletedEmbed: jest.Mock;
  };
  let mockChannelBindingsService: {
    getBindingById: jest.Mock;
  };
  let mockSettingsService: {
    getBranding: jest.Mock;
    getClientUrl: jest.Mock;
    getDefaultTimezone: jest.Mock;
    getDiscordBotDefaultChannel: jest.Mock;
  };

  beforeEach(async () => {
    jest.useFakeTimers();

    mockDb = createDrizzleMock();

    mockClientService = {
      sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      editEmbed: jest.fn().mockResolvedValue(undefined),
    };

    const fakeEmbed = { toJSON: () => ({}) };

    mockEmbedFactory = {
      buildAdHocSpawnEmbed: jest.fn().mockReturnValue({
        embed: fakeEmbed,
        row: undefined,
      }),
      buildAdHocUpdateEmbed: jest.fn().mockReturnValue({
        embed: fakeEmbed,
        row: undefined,
      }),
      buildAdHocCompletedEmbed: jest.fn().mockReturnValue({
        embed: fakeEmbed,
        row: undefined,
      }),
    };

    mockChannelBindingsService = {
      getBindingById: jest.fn(),
    };

    mockSettingsService = {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
      getClientUrl: jest.fn().mockResolvedValue('https://example.com'),
      getDefaultTimezone: jest.fn().mockResolvedValue('America/New_York'),
      getDiscordBotDefaultChannel: jest.fn().mockResolvedValue('default-channel'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdHocNotificationService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: DiscordEmbedFactory, useValue: mockEmbedFactory },
        { provide: ChannelBindingsService, useValue: mockChannelBindingsService },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    service = module.get(AdHocNotificationService);
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

      await service.notifySpawn(
        42,
        'binding-1',
        { id: 42, title: 'WoW — Ad-Hoc Session', gameName: 'WoW' },
        [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
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

      await service.notifySpawn(
        43,
        'binding-2',
        { id: 43, title: 'Gaming — Ad-Hoc Session' },
        [],
      );

      expect(mockSettingsService.getDiscordBotDefaultChannel).toHaveBeenCalled();
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
      mockClientService.sendEmbed.mockRejectedValue(new Error('Discord API error'));

      await expect(
        service.notifySpawn(45, 'binding-3', { id: 45, title: 'Test' }, []),
      ).resolves.not.toThrow();
    });
  });

  describe('notifyCompleted', () => {
    it('sends completion embed to notification channel', async () => {
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-complete',
        config: { notificationChannelId: 'complete-channel' },
      });

      await service.notifyCompleted(
        60,
        'binding-complete',
        {
          id: 60,
          title: 'WoW — Ad-Hoc Session',
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

      expect(mockEmbedFactory.buildAdHocCompletedEmbed).toHaveBeenCalled();
      expect(mockClientService.sendEmbed).toHaveBeenCalledWith(
        'complete-channel',
        expect.any(Object),
        undefined,
      );
    });

    it('cleans up pending updates after completion', async () => {
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-cleanup',
        config: { notificationChannelId: 'cleanup-channel' },
      });

      // Queue an update
      service.queueUpdate(70, 'binding-cleanup');

      // Complete the event — should clear pending updates
      await service.notifyCompleted(
        70,
        'binding-cleanup',
        {
          id: 70,
          title: 'Cleanup Test',
          startTime: '2026-02-10T18:00:00Z',
          endTime: '2026-02-10T20:00:00Z',
        },
        [],
      );

      // Verify sendEmbed was called for the completion
      expect(mockClientService.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('handles errors gracefully', async () => {
      mockChannelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-err',
        config: { notificationChannelId: 'err-channel' },
      });
      mockClientService.sendEmbed.mockRejectedValue(new Error('fail'));

      await expect(
        service.notifyCompleted(
          80,
          'binding-err',
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

    it('does nothing when binding not found', async () => {
      mockChannelBindingsService.getBindingById.mockResolvedValue(null);

      await service.notifyCompleted(
        90,
        'nonexistent',
        {
          id: 90,
          title: 'No Binding',
          startTime: '2026-02-10T18:00:00Z',
          endTime: '2026-02-10T20:00:00Z',
        },
        [],
      );

      expect(mockClientService.sendEmbed).not.toHaveBeenCalled();
    });
  });
});
