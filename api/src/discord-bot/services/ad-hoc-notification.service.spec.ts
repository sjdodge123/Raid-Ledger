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

// ─── Test module builder ─────────────────────────────────────────────────────

function buildMockServices() {
  const fakeEmbed = { toJSON: () => ({}) };
  return {
    fakeEmbed,
    clientService: {
      sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      editEmbed: jest.fn().mockResolvedValue(undefined),
      getGuildId: jest.fn().mockReturnValue('guild-123'),
    },
    embedFactory: {
      buildEventEmbed: jest
        .fn()
        .mockReturnValue({ embed: fakeEmbed, row: undefined }),
    },
    channelBindingsService: { getBindingById: jest.fn() },
    channelResolver: {
      resolveVoiceChannelForScheduledEvent: jest.fn().mockResolvedValue(null),
    },
    settingsService: {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
      getClientUrl: jest.fn().mockResolvedValue('https://example.com'),
      getDefaultTimezone: jest.fn().mockResolvedValue('America/New_York'),
      getDiscordBotDefaultChannel: jest
        .fn()
        .mockResolvedValue('default-channel'),
    },
  };
}

async function buildNotificationModule() {
  const mockDb = createDrizzleMock();
  const svc = buildMockServices();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdHocNotificationService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: DiscordBotClientService, useValue: svc.clientService },
      { provide: DiscordEmbedFactory, useValue: svc.embedFactory },
      { provide: ChannelBindingsService, useValue: svc.channelBindingsService },
      { provide: ChannelResolverService, useValue: svc.channelResolver },
      { provide: SettingsService, useValue: svc.settingsService },
    ],
  }).compile();

  return { service: module.get(AdHocNotificationService), mockDb, ...svc };
}

function mockBuildEmbedData(mockDb: MockDb, event?: Record<string, unknown>) {
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
  mockDb.limit.mockResolvedValueOnce([
    { name: 'World of Warcraft', coverUrl: 'https://example.com/wow.jpg' },
  ]);
}

describe('AdHocNotificationService', () => {
  let service: AdHocNotificationService;
  let mockDb: MockDb;
  let clientService: ReturnType<typeof buildMockServices>['clientService'];
  let embedFactory: ReturnType<typeof buildMockServices>['embedFactory'];
  let channelBindingsService: ReturnType<
    typeof buildMockServices
  >['channelBindingsService'];
  let settingsService: ReturnType<typeof buildMockServices>['settingsService'];
  let fakeEmbed: ReturnType<typeof buildMockServices>['fakeEmbed'];

  beforeEach(async () => {
    jest.useFakeTimers();
    const ctx = await buildNotificationModule();
    service = ctx.service;
    mockDb = ctx.mockDb;
    clientService = ctx.clientService;
    embedFactory = ctx.embedFactory;
    channelBindingsService = ctx.channelBindingsService;
    settingsService = ctx.settingsService;
    fakeEmbed = ctx.fakeEmbed;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('notifySpawn — channel resolution', () => {
    it('sends embed to configured notification channel', async () => {
      channelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-1',
        config: { notificationChannelId: 'notif-channel-1' },
      });
      mockBuildEmbedData(mockDb);
      await service.notifySpawn(
        42,
        'binding-1',
        { id: 42, title: 'WoW — Quick Play', gameName: 'WoW' },
        [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
      );
      expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42, title: 'WoW — Quick Play' }),
        expect.any(Object),
        expect.objectContaining({ state: 'live', buttons: 'view' }),
      );
      expect(clientService.sendEmbed).toHaveBeenCalledWith(
        'notif-channel-1',
        expect.any(Object),
        undefined,
      );
    });

    it('falls back to default channel when binding has no notification channel', async () => {
      channelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-2',
        config: {},
      });
      mockBuildEmbedData(mockDb, {
        id: 43,
        title: 'Gaming — Quick Play',
        gameId: null,
      });
      await service.notifySpawn(
        43,
        'binding-2',
        { id: 43, title: 'Gaming — Quick Play' },
        [],
      );
      expect(settingsService.getDiscordBotDefaultChannel).toHaveBeenCalled();
      expect(clientService.sendEmbed).toHaveBeenCalledWith(
        'default-channel',
        expect.any(Object),
        undefined,
      );
    });

    it('does nothing when binding not found', async () => {
      channelBindingsService.getBindingById.mockResolvedValue(null);
      await service.notifySpawn(
        44,
        'nonexistent',
        { id: 44, title: 'Test' },
        [],
      );
      expect(clientService.sendEmbed).not.toHaveBeenCalled();
    });

    it('handles sendEmbed errors gracefully', async () => {
      channelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-3',
        config: { notificationChannelId: 'channel-err' },
      });
      mockBuildEmbedData(mockDb, { id: 45 });
      clientService.sendEmbed.mockRejectedValue(new Error('Discord API error'));
      await expect(
        service.notifySpawn(45, 'binding-3', { id: 45, title: 'Test' }, []),
      ).resolves.not.toThrow();
    });
  });

  describe('notifySpawn — discord_event_messages (ROK-593)', () => {
    it('inserts discord_event_messages row after posting', async () => {
      channelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-1',
        config: { notificationChannelId: 'notif-channel-1' },
      });
      mockBuildEmbedData(mockDb);
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

    it('skips discord_event_messages insert when guildId is null', async () => {
      clientService.getGuildId.mockReturnValue(null);
      channelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-1',
        config: { notificationChannelId: 'notif-channel-1' },
      });
      mockBuildEmbedData(mockDb);
      await service.notifySpawn(
        42,
        'binding-1',
        { id: 42, title: 'WoW — Quick Play', gameName: 'WoW' },
        [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
      );
      expect(clientService.sendEmbed).toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('notifyCompleted', () => {
    async function spawnEvent(eventId: number) {
      channelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-complete',
        config: { notificationChannelId: 'complete-channel' },
      });
      mockBuildEmbedData(mockDb, { id: eventId });
      await service.notifySpawn(
        eventId,
        'binding-complete',
        { id: eventId, title: 'WoW — Quick Play', gameName: 'WoW' },
        [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
      );
      clientService.sendEmbed.mockClear();
      clientService.editEmbed.mockClear();
      embedFactory.buildEventEmbed.mockClear();
      embedFactory.buildEventEmbed.mockReturnValue({
        embed: fakeEmbed,
        row: undefined,
      });
    }

    it('edits the existing embed in-place (ROK-612)', async () => {
      await spawnEvent(60);
      mockBuildEmbedData(mockDb, { id: 60 });
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
      expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 60 }),
        expect.any(Object),
        expect.objectContaining({ state: 'completed', buttons: 'none' }),
      );
      expect(clientService.editEmbed).toHaveBeenCalledWith(
        'complete-channel',
        'msg-1',
        expect.any(Object),
        undefined,
      );
      expect(clientService.sendEmbed).not.toHaveBeenCalled();
    });

    it('cleans up pending updates after completion', async () => {
      await spawnEvent(70);
      mockBuildEmbedData(mockDb, { id: 70 });
      service.queueUpdate(70, 'binding-complete');
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
      expect(clientService.editEmbed).toHaveBeenCalledTimes(1);
    });

    it('handles edit errors gracefully', async () => {
      await spawnEvent(80);
      mockBuildEmbedData(mockDb, { id: 80 });
      clientService.editEmbed.mockRejectedValue(new Error('fail'));
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
      expect(clientService.sendEmbed).not.toHaveBeenCalled();
      expect(clientService.editEmbed).not.toHaveBeenCalled();
    });
  });
});
