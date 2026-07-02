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
      // ROK-1389: resolveVoice routes through the shared override-honoring entry.
      resolveVoiceChannelHonoringOverride: jest
        .fn()
        .mockImplementation((_g, _r, _e, override) =>
          Promise.resolve(override ?? null),
        ),
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
      // ROK-1243: notifyCompleted now reads ad_hoc_participants first.
      mockDb.where.mockResolvedValueOnce([
        {
          discordUserId: 'user-1',
          discordUsername: 'Player1',
          leftAt: new Date(),
        },
      ]);
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
        undefined,
      );
      expect(clientService.sendEmbed).not.toHaveBeenCalled();
    });

    it('cleans up pending updates after completion', async () => {
      await spawnEvent(70);
      mockDb.where.mockResolvedValueOnce([]);
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
      mockDb.where.mockResolvedValueOnce([]);
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

    // ROK-1243: completion reconciliation rescues missed mid-session flushes.
    it('reads ad_hoc_participants and includes every participant (ROK-1243)', async () => {
      await spawnEvent(110);
      // Simulate a leaver who was queued for the final batch but the edit
      // never landed: DB has 2 rows with leftAt set; the caller passed 0.
      mockDb.where.mockResolvedValueOnce([
        {
          discordUserId: 'user-A',
          discordUsername: 'Aery',
          leftAt: new Date(),
        },
        {
          discordUserId: 'user-B',
          discordUsername: 'Belle',
          leftAt: new Date(),
        },
      ]);
      mockBuildEmbedData(mockDb, { id: 110 });
      await service.notifyCompleted(
        110,
        'binding-complete',
        {
          id: 110,
          title: 'Reconciliation Test',
          startTime: '2026-02-10T18:00:00Z',
          endTime: '2026-02-10T20:00:00Z',
        },
        // Caller-supplied participants are IGNORED in favor of the DB read.
        [],
      );
      expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          signupCount: 2,
          signupMentions: expect.arrayContaining([
            expect.objectContaining({
              discordId: null,
              username: 'Aery',
              status: 'left',
            }),
            expect.objectContaining({
              discordId: null,
              username: 'Belle',
              status: 'left',
            }),
          ]),
        }),
        expect.any(Object),
        expect.objectContaining({ state: 'completed', buttons: 'none' }),
      );
    });

    it('cleans up when reconciliation read finds no rows (ROK-1243)', async () => {
      await spawnEvent(120);
      mockDb.where.mockResolvedValueOnce([]);
      mockBuildEmbedData(mockDb, { id: 120 });
      await service.notifyCompleted(
        120,
        'binding-complete',
        {
          id: 120,
          title: 'Empty Reconciliation',
          startTime: '2026-02-10T18:00:00Z',
          endTime: '2026-02-10T20:00:00Z',
        },
        [],
      );
      expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.objectContaining({ signupCount: 0, signupMentions: [] }),
        expect.any(Object),
        expect.objectContaining({ state: 'completed' }),
      );
    });
  });

  describe('processUpdate — running participant list (ROK-680)', () => {
    async function spawnAndTrack(eventId: number) {
      channelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-flush',
        config: { notificationChannelId: 'flush-channel' },
      });
      mockBuildEmbedData(mockDb, { id: eventId });
      await service.notifySpawn(
        eventId,
        'binding-flush',
        { id: eventId, title: 'Quick Play' },
        [{ discordUserId: 'u1', discordUsername: 'P1' }],
      );
      embedFactory.buildEventEmbed.mockClear();
      embedFactory.buildEventEmbed.mockReturnValue({
        embed: fakeEmbed,
        row: undefined,
      });
      clientService.editEmbed.mockClear();
    }

    it('includes left participants in embed data during flush', async () => {
      await spawnAndTrack(100);
      service.queueUpdate(100, 'binding-flush');
      // Mock DB: participants query returns 1 active + 1 left
      mockDb.where.mockResolvedValueOnce([
        { discordUserId: 'u1', discordUsername: 'P1', leftAt: null },
        { discordUserId: 'u2', discordUsername: 'P2', leftAt: new Date() },
      ]);
      // Mock event + game for buildEmbedEventData
      mockBuildEmbedData(mockDb, { id: 100 });
      jest.advanceTimersByTime(5000);
      // Wait for async flush
      await jest.advanceTimersByTimeAsync(0);
      expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          signupMentions: expect.arrayContaining([
            expect.objectContaining({ username: 'P1', discordId: null }),
            expect.objectContaining({ username: 'P2', status: 'left' }),
          ]),
        }),
        expect.any(Object),
        expect.any(Object),
      );
    });

    // ROK-1243: a leaver appears with status:'left' after a single flush cycle.
    it('a leaver shows with status:left after a single flush (ROK-1243)', async () => {
      await spawnAndTrack(101);
      service.queueUpdate(101, 'binding-flush');
      mockDb.where.mockResolvedValueOnce([
        {
          discordUserId: 'u1',
          discordUsername: 'P1',
          leftAt: new Date(),
        },
      ]);
      mockBuildEmbedData(mockDb, { id: 101 });
      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(0);
      expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          signupCount: 1,
          signupMentions: [
            expect.objectContaining({
              username: 'P1',
              status: 'left',
            }),
          ],
        }),
        expect.any(Object),
        expect.any(Object),
      );
    });

    // ROK-1243: rejoin clears strikethrough.
    it('rejoin clears strikethrough after subsequent flush (ROK-1243)', async () => {
      await spawnAndTrack(102);
      // First flush: u1 has left.
      service.queueUpdate(102, 'binding-flush');
      mockDb.where.mockResolvedValueOnce([
        {
          discordUserId: 'u1',
          discordUsername: 'P1',
          leftAt: new Date(),
        },
      ]);
      mockBuildEmbedData(mockDb, { id: 102 });
      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(0);
      expect(embedFactory.buildEventEmbed).toHaveBeenLastCalledWith(
        expect.objectContaining({
          signupMentions: [
            expect.objectContaining({ username: 'P1', status: 'left' }),
          ],
        }),
        expect.any(Object),
        expect.any(Object),
      );

      // Second flush after rejoin: leftAt cleared.
      embedFactory.buildEventEmbed.mockClear();
      service.queueUpdate(102, 'binding-flush');
      mockDb.where.mockResolvedValueOnce([
        { discordUserId: 'u1', discordUsername: 'P1', leftAt: null },
      ]);
      mockBuildEmbedData(mockDb, { id: 102 });
      jest.advanceTimersByTime(5000);
      await jest.advanceTimersByTimeAsync(0);
      const lastCall = embedFactory.buildEventEmbed.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      const lastMentions = (
        lastCall![0] as {
          signupMentions: Array<{ username: string; status?: string }>;
        }
      ).signupMentions;
      expect(lastMentions).toHaveLength(1);
      expect(lastMentions[0].username).toBe('P1');
      expect(lastMentions[0].status).toBeUndefined();
    });

    // ROK-1243: edit-in-place failure does not throw or kill the flusher.
    it('processUpdate swallows editEmbed errors (ROK-1243)', async () => {
      await spawnAndTrack(103);
      service.queueUpdate(103, 'binding-flush');
      mockDb.where.mockResolvedValueOnce([
        { discordUserId: 'u1', discordUsername: 'P1', leftAt: null },
      ]);
      mockBuildEmbedData(mockDb, { id: 103 });
      clientService.editEmbed.mockRejectedValueOnce(new Error('rate limit'));
      jest.advanceTimersByTime(5000);
      // Should not throw — error is logged.
      await expect(jest.advanceTimersByTimeAsync(0)).resolves.not.toThrow();
    });
  });
});
