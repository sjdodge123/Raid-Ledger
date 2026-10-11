/**
 * ROK-1766 — Quick Play Announcements posting (spec §3.3, D2/D6/D7/D8/D9).
 *
 * A `quick-play-announcements` binding for the event's effective game adds ONE
 * tracked per-event card in its text channel: alongside the unchanged room
 * card for a lobby spawn, INSTEAD of `resolveNotificationChannel` for a
 * monitor spawn. Channel ids are all distinct so a wrong route is visible.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from './discord-embed.factory';
import { ChannelBindingsService } from './channel-bindings.service';
import { ChannelResolverService } from './channel-resolver.service';
import { ChannelPresenceEmbedService } from './channel-presence-embed.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

const GUILD = 'guild-123';
const LOBBY_VOICE = 'voice-lobby-1';
const MONITOR_NOTIFY = 'text-monitor-notify-1';
const QP_TEXT = 'text-qp-valheim';
const VALHEIM = 10;

const LOBBY_BINDING = {
  id: 'binding-lobby',
  guildId: GUILD,
  bindingPurpose: 'general-lobby',
  channelId: LOBBY_VOICE,
  gameId: null,
  config: { notificationChannelId: 'text-lobby-room-1' },
};

const MONITOR_BINDING = {
  id: 'binding-monitor',
  guildId: GUILD,
  bindingPurpose: 'game-voice-monitor',
  channelId: 'voice-monitor-1',
  gameId: VALHEIM,
  config: { notificationChannelId: MONITOR_NOTIFY },
};

function buildMocks() {
  return {
    clientService: {
      sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      editEmbed: jest.fn().mockResolvedValue(undefined),
      getGuildId: jest.fn().mockReturnValue(GUILD),
    },
    embedFactory: {
      buildQuickPlayEmbed: jest
        .fn()
        .mockReturnValue({ embed: { toJSON: () => ({}) }, row: undefined }),
    },
    channelBindingsService: {
      getBindingById: jest.fn(),
      getQuickPlayChannelForGame: jest.fn().mockResolvedValue(QP_TEXT),
    },
    channelResolver: {
      resolveVoiceChannelHonoringOverride: jest.fn().mockResolvedValue(null),
    },
    channelPresence: { markDirty: jest.fn(), onEventEnded: jest.fn() },
    settingsService: {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
      getClientUrl: jest.fn().mockResolvedValue('https://example.com'),
      getDefaultTimezone: jest.fn().mockResolvedValue('America/New_York'),
      getDiscordBotDefaultChannel: jest.fn().mockResolvedValue('default-ch'),
    },
  };
}

async function buildModule() {
  const mockDb = createDrizzleMock();
  const findFirst = jest.fn().mockResolvedValue(undefined);
  mockDb.query.discordEventMessages = { findFirst };
  const eventFindFirst = jest.fn().mockResolvedValue(undefined);
  mockDb.query.events = { findFirst: eventFindFirst };
  const m = buildMocks();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdHocNotificationService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: DiscordBotClientService, useValue: m.clientService },
      { provide: DiscordEmbedFactory, useValue: m.embedFactory },
      { provide: ChannelBindingsService, useValue: m.channelBindingsService },
      { provide: ChannelResolverService, useValue: m.channelResolver },
      { provide: ChannelPresenceEmbedService, useValue: m.channelPresence },
      { provide: SettingsService, useValue: m.settingsService },
    ],
  }).compile();
  return {
    service: module.get(AdHocNotificationService),
    mockDb,
    findFirst,
    eventFindFirst,
    ...m,
  };
}

/** Queue the event row then the games row `buildEmbedEventData` reads. */
function mockBuildEmbedData(mockDb: MockDb, eventId: number): void {
  mockDb.limit.mockResolvedValueOnce([
    {
      id: eventId,
      title: 'Valheim — Quick Play',
      gameId: VALHEIM,
      duration: [new Date(), new Date()],
      maxAttendees: null,
      slotConfig: { type: 'generic' },
    },
  ]);
  mockDb.limit.mockResolvedValueOnce([
    { id: VALHEIM, name: 'Valheim', coverUrl: null },
  ]);
}

const sentChannels = (send: jest.Mock): unknown[] =>
  send.mock.calls.map((c: unknown[]) => c[0]);

describe('AdHocNotificationService — Quick Play Announcements (ROK-1766)', () => {
  let ctx: Awaited<ReturnType<typeof buildModule>>;

  const spawn = (eventId: number, bindingId: string, game?: number | null) =>
    ctx.service.notifySpawn(
      eventId,
      bindingId,
      { id: eventId, title: 'Valheim — Quick Play', gameName: 'Valheim' },
      [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
      game,
    );

  const flush = async (): Promise<void> => {
    jest.advanceTimersByTime(5000);
    await jest.advanceTimersByTimeAsync(0);
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    ctx = await buildModule();
  });

  afterEach(() => {
    ctx.service.onModuleDestroy();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('lobby spawn', () => {
    beforeEach(() => {
      ctx.channelBindingsService.getBindingById.mockResolvedValue(
        LOBBY_BINDING,
      );
      mockBuildEmbedData(ctx.mockDb, 42);
    });

    it('with a QP binding: room card marked dirty AND a QP card posted AND tracked', async () => {
      await spawn(42, 'binding-lobby', VALHEIM);
      expect(ctx.channelPresence.markDirty).toHaveBeenCalledWith(LOBBY_VOICE);
      expect(
        ctx.channelBindingsService.getQuickPlayChannelForGame,
      ).toHaveBeenCalledWith(GUILD, VALHEIM);
      expect(sentChannels(ctx.clientService.sendEmbed)).toEqual([QP_TEXT]);
      expect(ctx.mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 42,
          channelId: QP_TEXT,
          messageId: 'msg-1',
          embedState: 'live',
        }),
      );
    });

    it('without a QP binding: unchanged — room card only, no post, no row', async () => {
      ctx.channelBindingsService.getQuickPlayChannelForGame.mockResolvedValue(
        null,
      );
      await spawn(42, 'binding-lobby', VALHEIM);
      expect(ctx.channelPresence.markDirty).toHaveBeenCalledWith(LOBBY_VOICE);
      expect(ctx.clientService.sendEmbed).not.toHaveBeenCalled();
      expect(ctx.mockDb.insert).not.toHaveBeenCalled();
    });

    it('null game (Untitled / Just Chatting): no QP lookup, no post (D9)', async () => {
      await spawn(42, 'binding-lobby', null);
      expect(
        ctx.channelBindingsService.getQuickPlayChannelForGame,
      ).not.toHaveBeenCalled();
      expect(ctx.clientService.sendEmbed).not.toHaveBeenCalled();
    });

    it('QP send throws: logged, no fallback post — the room card carries it (D7)', async () => {
      ctx.clientService.sendEmbed.mockRejectedValueOnce(new Error('50013'));
      await spawn(42, 'binding-lobby', VALHEIM);
      expect(sentChannels(ctx.clientService.sendEmbed)).toEqual([QP_TEXT]);
      expect(ctx.mockDb.insert).not.toHaveBeenCalled();
      expect(ctx.channelPresence.markDirty).toHaveBeenCalledWith(LOBBY_VOICE);
    });

    it('binding deleted mid-session: the posted card keeps being edited (D8)', async () => {
      await spawn(42, 'binding-lobby', VALHEIM);
      ctx.channelBindingsService.getBindingById.mockResolvedValue(null);
      ctx.channelBindingsService.getQuickPlayChannelForGame.mockResolvedValue(
        null,
      );
      ctx.service.queueUpdate(42, 'binding-lobby');
      ctx.mockDb.where.mockResolvedValueOnce([]);
      mockBuildEmbedData(ctx.mockDb, 42);
      await flush();
      expect(ctx.clientService.editEmbed).toHaveBeenCalledWith(
        QP_TEXT,
        'msg-1',
        expect.any(Object),
        undefined,
        undefined,
      );
    });
  });

  describe('monitor spawn', () => {
    beforeEach(() => {
      ctx.channelBindingsService.getBindingById.mockResolvedValue(
        MONITOR_BINDING,
      );
      mockBuildEmbedData(ctx.mockDb, 43);
    });

    it('with a QP binding: posts ONCE to the QP channel, not its notification channel (D2)', async () => {
      await spawn(43, 'binding-monitor');
      expect(
        ctx.channelBindingsService.getQuickPlayChannelForGame,
      ).toHaveBeenCalledWith(GUILD, VALHEIM);
      expect(sentChannels(ctx.clientService.sendEmbed)).toEqual([QP_TEXT]);
      expect(ctx.channelPresence.markDirty).not.toHaveBeenCalled();
    });

    it('QP send throws: falls back to resolveNotificationChannel (D7)', async () => {
      ctx.clientService.sendEmbed.mockRejectedValueOnce(new Error('50013'));
      mockBuildEmbedData(ctx.mockDb, 43);
      await spawn(43, 'binding-monitor');
      expect(sentChannels(ctx.clientService.sendEmbed)).toEqual([
        QP_TEXT,
        MONITOR_NOTIFY,
      ]);
      expect(ctx.mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 43, channelId: MONITOR_NOTIFY }),
      );
    });

    it("null effective game: no QP lookup; today's routing (D9)", async () => {
      await spawn(43, 'binding-monitor', null);
      expect(
        ctx.channelBindingsService.getQuickPlayChannelForGame,
      ).not.toHaveBeenCalled();
      expect(sentChannels(ctx.clientService.sendEmbed)).toEqual([
        MONITOR_NOTIFY,
      ]);
    });
  });

  describe('restart rehydration (D6)', () => {
    beforeEach(() => {
      ctx.channelBindingsService.getBindingById.mockResolvedValue(
        LOBBY_BINDING,
      );
      ctx.eventFindFirst.mockResolvedValue({ gameId: VALHEIM });
    });

    it('Map miss + a LIVE discord_event_messages row: processUpdate edits that message', async () => {
      ctx.findFirst.mockResolvedValueOnce({
        channelId: QP_TEXT,
        messageId: 'msg-from-db',
      });
      ctx.service.queueUpdate(77, 'binding-lobby');
      ctx.mockDb.where.mockResolvedValueOnce([
        { discordUserId: 'user-1', discordUsername: 'Player1', leftAt: null },
      ]);
      mockBuildEmbedData(ctx.mockDb, 77);
      await flush();
      expect(ctx.findFirst).toHaveBeenCalledTimes(1);
      expect(ctx.clientService.editEmbed).toHaveBeenCalledWith(
        QP_TEXT,
        'msg-from-db',
        expect.any(Object),
        undefined,
        undefined,
      );
    });

    it('Map miss + no row: processUpdate edits nothing', async () => {
      ctx.service.queueUpdate(78, 'binding-lobby');
      await flush();
      expect(ctx.findFirst).toHaveBeenCalledTimes(1);
      expect(ctx.clientService.editEmbed).not.toHaveBeenCalled();
    });

    it('lobby event with NO QP binding: an unfurl/share row is never adopted, and repeated flushes do not re-query (AC8)', async () => {
      ctx.channelBindingsService.getQuickPlayChannelForGame.mockResolvedValue(
        null,
      );
      // Would be adopted pre-fix: the oldest LIVE row of the event is a share.
      ctx.findFirst.mockResolvedValue({
        channelId: 'text-share-1',
        messageId: 'share-msg',
      });
      for (let i = 0; i < 3; i++) {
        ctx.service.queueUpdate(81, 'binding-lobby');
        await flush();
      }
      expect(ctx.clientService.editEmbed).not.toHaveBeenCalled();
      expect(ctx.findFirst).not.toHaveBeenCalled();
      expect(ctx.eventFindFirst).toHaveBeenCalledTimes(1);
    });

    it('notifyCompleted rehydrates, edits to ended, then marks the rows completed', async () => {
      ctx.findFirst.mockResolvedValueOnce({
        channelId: QP_TEXT,
        messageId: 'msg-from-db',
      });
      ctx.mockDb.where.mockResolvedValueOnce([]);
      mockBuildEmbedData(ctx.mockDb, 79);
      await ctx.service.notifyCompleted(
        79,
        'binding-lobby',
        {
          id: 79,
          title: 'Valheim — Quick Play',
          startTime: '2026-10-11T18:00:00Z',
          endTime: '2026-10-11T19:00:00Z',
        },
        [],
      );
      expect(ctx.channelPresence.onEventEnded).toHaveBeenCalledWith(
        'binding-lobby',
      );
      expect(ctx.clientService.editEmbed).toHaveBeenCalledWith(
        QP_TEXT,
        'msg-from-db',
        expect.any(Object),
        undefined,
        undefined,
      );
      expect(ctx.mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ embedState: 'completed' }),
      );
    });
  });
});
