/**
 * ROK-1447 — TDD pins for routing Quick Play onto its own builder.
 *
 * `AdHocNotificationService` currently borrows the scheduled-event layout
 * (`buildEventEmbed` with `{ state, buttons }`). This story gives Quick Play a
 * builder of its own — `buildQuickPlayEmbed(data, context, 'live' | 'ended')` —
 * and drops the button row in both states, replacing it with the title deep
 * link and the `[Open event ↗]` line inside the description (spec §Shape).
 *
 * These pins are about the CALL, not the embed: the embed's own shape lives in
 * `discord-embed-quickplay.helpers.spec.ts`. The factory is mocked, so the
 * assertion is that Quick Play stops going through the scheduled-event door.
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
      // Both doors are open on the mock; the pins below assert which one the
      // service actually walks through.
      buildEventEmbed: jest
        .fn()
        .mockReturnValue({ embed: fakeEmbed, row: undefined }),
      buildQuickPlayEmbed: jest
        .fn()
        .mockReturnValue({ embed: fakeEmbed, content: 'push line' }),
    },
    channelBindingsService: { getBindingById: jest.fn() },
    channelResolver: {
      resolveVoiceChannelHonoringOverride: jest.fn().mockResolvedValue(null),
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
      // ROK-1446 D9: AdHocNotificationService now takes the presence service as a
      // seventh dep. These fixtures carry no `bindingPurpose`, so the strict
      // positive gate never fires for them and every pin below is unchanged.
      {
        provide: ChannelPresenceEmbedService,
        useValue: { markDirty: jest.fn(), onEventEnded: jest.fn() },
      },
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
      title: 'World of Warcraft — Quick Play',
      gameId: 10,
      duration: [
        new Date('2026-09-02T18:00:00Z'),
        new Date('2026-09-02T20:00:00Z'),
      ],
      extendedUntil: null,
      maxAttendees: null,
      slotConfig: { type: 'generic' },
      notificationChannelOverride: null,
      recurrenceGroupId: null,
      ephemeralVoiceChannelId: null,
    },
  ]);
  mockDb.limit.mockResolvedValueOnce([
    { id: 10, name: 'World of Warcraft', coverUrl: null },
  ]);
}

describe('AdHocNotificationService — Quick Play builder routing (ROK-1447)', () => {
  let service: AdHocNotificationService;
  let mockDb: MockDb;
  let clientService: ReturnType<typeof buildMockServices>['clientService'];
  let embedFactory: ReturnType<typeof buildMockServices>['embedFactory'];
  let channelBindingsService: ReturnType<
    typeof buildMockServices
  >['channelBindingsService'];

  beforeEach(async () => {
    jest.useFakeTimers();
    const ctx = await buildNotificationModule();
    service = ctx.service;
    mockDb = ctx.mockDb;
    clientService = ctx.clientService;
    embedFactory = ctx.embedFactory;
    channelBindingsService = ctx.channelBindingsService;
    channelBindingsService.getBindingById.mockResolvedValue({
      id: 'binding-1',
      config: { notificationChannelId: 'notif-channel-1' },
    });
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  async function spawn(eventId = 42): Promise<void> {
    mockBuildEmbedData(mockDb, eventId);
    await service.notifySpawn(
      eventId,
      'binding-1',
      { id: eventId, title: 'World of Warcraft — Quick Play' },
      [{ discordUserId: 'user-1', discordUsername: 'Player1' }],
    );
  }

  async function complete(eventId = 42): Promise<void> {
    // `readReconciledParticipants` terminates at `.where()`.
    mockDb.where.mockResolvedValueOnce([
      {
        discordUserId: 'user-1',
        discordUsername: 'Player1',
        leftAt: new Date(),
      },
    ]);
    mockBuildEmbedData(mockDb, eventId);
    await service.notifyCompleted(
      eventId,
      'binding-1',
      {
        id: eventId,
        title: 'World of Warcraft — Quick Play',
        startTime: '2026-09-02T18:00:00Z',
        endTime: '2026-09-02T20:00:00Z',
      },
      [
        {
          discordUserId: 'user-1',
          discordUsername: 'Player1',
          totalDurationSeconds: 7200,
        },
      ],
    );
  }

  describe('spawn', () => {
    it('builds the spawn embed with the LIVE Quick Play builder', async () => {
      await spawn();
      expect(embedFactory.buildQuickPlayEmbed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42 }),
        expect.any(Object),
        'live',
      );
    });

    it('no longer routes Quick Play through the scheduled-event builder', async () => {
      await spawn();
      expect(embedFactory.buildEventEmbed).not.toHaveBeenCalled();
    });

    it('passes no button-mode options — Quick Play has no row', async () => {
      await spawn();
      const call = embedFactory.buildQuickPlayEmbed.mock.calls[0];
      expect(call).toHaveLength(3);
      expect(call[2]).toBe('live');
    });

    it('posts the embed with no action row attached', async () => {
      await spawn();
      expect(clientService.sendEmbed).toHaveBeenCalledWith(
        'notif-channel-1',
        expect.any(Object),
        undefined,
        'push line',
      );
    });
  });

  describe('completion', () => {
    it('re-renders the tracked embed with the ENDED Quick Play builder', async () => {
      await spawn(60);
      embedFactory.buildQuickPlayEmbed.mockClear();
      await complete(60);
      expect(embedFactory.buildQuickPlayEmbed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 60 }),
        expect.any(Object),
        'ended',
      );
    });

    it('never falls back to the scheduled-event builder on completion', async () => {
      await spawn(61);
      await complete(61);
      expect(embedFactory.buildEventEmbed).not.toHaveBeenCalled();
    });

    it('edits in place with no action row attached', async () => {
      await spawn(62);
      clientService.editEmbed.mockClear();
      await complete(62);
      expect(clientService.editEmbed).toHaveBeenCalledWith(
        'notif-channel-1',
        'msg-1',
        expect.any(Object),
        undefined,
        'push line',
      );
    });
  });
});
