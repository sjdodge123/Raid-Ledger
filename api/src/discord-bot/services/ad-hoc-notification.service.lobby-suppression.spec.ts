/**
 * ROK-1446 D9 — per-event announce embeds are SUPPRESSED for `general-lobby`
 * bindings.
 *
 * A lobby room gets ONE message (owned by `ChannelPresenceEmbedService`) that
 * is edited in place, so a spawn under a lobby binding must not post a second
 * card announcing the same session. The spawn instead marks the room dirty and
 * returns; completion folds into the same message via `onEventEnded`.
 *
 * **The gate is a strict positive equality — `bindingPurpose === 'general-lobby'`.**
 * Every fixture in the two sibling spec files (`ad-hoc-notification.service.spec.ts`,
 * `…quickplay.spec.ts`) is a partial `{ id, config }` with the purpose UNSET, and
 * an unset purpose is NOT a lobby. Under the tempting negation
 * (`!== 'game-voice-monitor'` → lobby) every one of those spawns would suppress,
 * `messageIds` would stay empty, and their `notifyCompleted` pins would then pass
 * for the wrong reason — and in production an unset purpose would silence a real
 * announce. `notifySpawn — the gate is a strict positive equality` below is the
 * regression guard for exactly that; do not weaken it.
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

/**
 * The bound VOICE channel and the resolved TEXT channel are deliberately
 * different ids: `markDirty` takes the room's voice channel, and passing the
 * announce channel by mistake has to be a visible failure, not a coincidence.
 */
const LOBBY_VOICE_CHANNEL = 'voice-lobby-1';
const ANNOUNCE_TEXT_CHANNEL = 'text-announce-1';

const LOBBY_BINDING = {
  id: 'binding-lobby',
  bindingPurpose: 'general-lobby',
  channelId: LOBBY_VOICE_CHANNEL,
  config: { notificationChannelId: ANNOUNCE_TEXT_CHANNEL },
};

const MONITOR_BINDING = {
  id: 'binding-monitor',
  bindingPurpose: 'game-voice-monitor',
  channelId: 'voice-monitor-1',
  config: { notificationChannelId: ANNOUNCE_TEXT_CHANNEL },
};

/** Shaped exactly like the sibling specs' fixtures: no `bindingPurpose` at all. */
const PURPOSE_UNSET_BINDING = {
  id: 'binding-unset',
  channelId: 'voice-unset-1',
  config: { notificationChannelId: ANNOUNCE_TEXT_CHANNEL },
};

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
      buildQuickPlayEmbed: jest
        .fn()
        .mockReturnValue({ embed: fakeEmbed, row: undefined }),
    },
    channelBindingsService: { getBindingById: jest.fn() },
    channelResolver: {
      resolveVoiceChannelHonoringOverride: jest.fn().mockResolvedValue(null),
    },
    channelPresence: { markDirty: jest.fn(), onEventEnded: jest.fn() },
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
      { provide: ChannelPresenceEmbedService, useValue: svc.channelPresence },
      { provide: SettingsService, useValue: svc.settingsService },
    ],
  }).compile();
  return { service: module.get(AdHocNotificationService), mockDb, ...svc };
}

/** Queue the event row then the games row `buildEmbedEventData` reads. */
function mockBuildEmbedData(mockDb: MockDb, eventId = 42): void {
  mockDb.limit.mockResolvedValueOnce([
    {
      id: eventId,
      title: 'Valheim — Quick Play',
      gameId: 10,
      duration: [new Date(), new Date()],
      maxAttendees: null,
      slotConfig: { type: 'generic' },
    },
  ]);
  mockDb.limit.mockResolvedValueOnce([
    { id: 10, name: 'Valheim', coverUrl: null },
  ]);
}

describe('AdHocNotificationService — general-lobby suppression (ROK-1446 D9)', () => {
  let ctx: Awaited<ReturnType<typeof buildNotificationModule>>;

  const spawn = (eventId: number, bindingId: string) =>
    ctx.service.notifySpawn(
      eventId,
      bindingId,
      { id: eventId, title: 'Valheim — Quick Play', gameName: 'Valheim' },
      [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
    );

  beforeEach(async () => {
    jest.useFakeTimers();
    ctx = await buildNotificationModule();
  });

  afterEach(() => {
    ctx.service.onModuleDestroy();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('notifySpawn — lobby binding', () => {
    beforeEach(() => {
      ctx.channelBindingsService.getBindingById.mockResolvedValue(
        LOBBY_BINDING,
      );
      mockBuildEmbedData(ctx.mockDb);
    });

    it('posts no announce embed', async () => {
      await spawn(42, 'binding-lobby');
      expect(ctx.clientService.sendEmbed).not.toHaveBeenCalled();
    });

    it('writes no discord_event_messages row', async () => {
      await spawn(42, 'binding-lobby');
      expect(ctx.mockDb.insert).not.toHaveBeenCalled();
    });

    it('marks the bound VOICE channel dirty, not the announce text channel', async () => {
      await spawn(42, 'binding-lobby');
      expect(ctx.channelPresence.markDirty).toHaveBeenCalledTimes(1);
      expect(ctx.channelPresence.markDirty).toHaveBeenCalledWith(
        LOBBY_VOICE_CHANNEL,
      );
    });
  });

  describe('notifySpawn — game-voice-monitor binding is untouched', () => {
    beforeEach(() => {
      ctx.channelBindingsService.getBindingById.mockResolvedValue(
        MONITOR_BINDING,
      );
      mockBuildEmbedData(ctx.mockDb);
    });

    it('still posts the per-event announce embed', async () => {
      await spawn(43, 'binding-monitor');
      expect(ctx.clientService.sendEmbed).toHaveBeenCalledWith(
        ANNOUNCE_TEXT_CHANNEL,
        expect.any(Object),
        undefined,
        undefined,
      );
    });

    it('never marks a channel dirty', async () => {
      await spawn(43, 'binding-monitor');
      expect(ctx.channelPresence.markDirty).not.toHaveBeenCalled();
    });
  });

  describe('notifySpawn — the gate is a strict positive equality', () => {
    beforeEach(() => {
      ctx.channelBindingsService.getBindingById.mockResolvedValue(
        PURPOSE_UNSET_BINDING,
      );
      mockBuildEmbedData(ctx.mockDb);
    });

    it('still announces when bindingPurpose is unset — an unset purpose is NOT a lobby', async () => {
      await spawn(44, 'binding-unset');
      expect(ctx.clientService.sendEmbed).toHaveBeenCalledWith(
        ANNOUNCE_TEXT_CHANNEL,
        expect.any(Object),
        undefined,
        undefined,
      );
      expect(ctx.channelPresence.markDirty).not.toHaveBeenCalled();
    });
  });

  describe('notifyCompleted', () => {
    const complete = (eventId: number, bindingId: string) =>
      ctx.service.notifyCompleted(
        eventId,
        bindingId,
        {
          id: eventId,
          title: 'Valheim — Quick Play',
          gameName: 'Valheim',
          startTime: '2026-09-04T18:00:00Z',
          endTime: '2026-09-04T20:00:00Z',
        },
        [],
      );

    beforeEach(() => {
      ctx.channelBindingsService.getBindingById.mockResolvedValue(
        LOBBY_BINDING,
      );
      mockBuildEmbedData(ctx.mockDb);
    });

    it('tells the presence service the event ended BEFORE the untracked early return', async () => {
      await spawn(42, 'binding-lobby');
      await complete(42, 'binding-lobby');
      expect(ctx.channelPresence.onEventEnded).toHaveBeenCalledTimes(1);
      expect(ctx.channelPresence.onEventEnded).toHaveBeenCalledWith(
        'binding-lobby',
      );
    });

    it('edits nothing — a suppressed spawn has no message to fold', async () => {
      await spawn(42, 'binding-lobby');
      await complete(42, 'binding-lobby');
      expect(ctx.clientService.editEmbed).not.toHaveBeenCalled();
      expect(ctx.clientService.sendEmbed).not.toHaveBeenCalled();
    });
  });
});
