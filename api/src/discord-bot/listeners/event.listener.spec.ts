/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordEventListener } from './event.listener';
import type { EventPayload } from './event.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { EmbedPosterService } from '../services/embed-poster.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot.constants';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

describe('DiscordEventListener', () => {
  let module: TestingModule;
  let listener: DiscordEventListener;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let embedFactory: jest.Mocked<DiscordEmbedFactory>;
  let embedPoster: jest.Mocked<EmbedPosterService>;
  let mockDb: {
    insert: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  const originalClientUrl = process.env.CLIENT_URL;

  // Use a future date so lead-time gating allows posting
  const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const futureEndDate = new Date(futureDate.getTime() + 3 * 60 * 60 * 1000);

  const mockPayload: EventPayload = {
    eventId: 42,
    event: {
      id: 42,
      title: 'Test Raid',
      startTime: futureDate.toISOString(),
      endTime: futureEndDate.toISOString(),
      signupCount: 5,
      maxAttendees: 20,
      game: { name: 'WoW', coverUrl: 'https://example.com/art.jpg' },
    },
    gameId: 101,
  };

  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = new ActionRowBuilder<ButtonBuilder>();

  beforeEach(async () => {
    delete process.env.CLIENT_URL;

    // Chain-able mock for Drizzle query builder.
    const createChainMock = (resolvedValue: unknown[] = []) => {
      const chain: Record<string, jest.Mock> & { then?: unknown } = {};
      chain.from = jest.fn().mockReturnValue(chain);
      chain.where = jest.fn().mockReturnValue(chain);
      chain.limit = jest.fn().mockResolvedValue(resolvedValue);
      chain.set = jest.fn().mockReturnValue(chain);
      chain.values = jest.fn().mockReturnValue(chain);
      chain.returning = jest.fn().mockResolvedValue(resolvedValue);
      // Make the chain itself awaitable (thenable)
      chain.then = (
        resolve: (v: unknown) => void,
        reject: (e: unknown) => void,
      ) => Promise.resolve(resolvedValue).then(resolve, reject);
      return chain;
    };

    mockDb = {
      insert: jest.fn().mockReturnValue(createChainMock()),
      select: jest.fn().mockReturnValue(createChainMock()),
      update: jest.fn().mockReturnValue(createChainMock()),
      delete: jest.fn().mockReturnValue(createChainMock()),
    };

    module = await Test.createTestingModule({
      providers: [
        DiscordEventListener,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            getGuildId: jest.fn().mockReturnValue('guild-123'),
            sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-456' }),
            editEmbed: jest.fn().mockResolvedValue({ id: 'msg-456' }),
            deleteMessage: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DiscordEmbedFactory,
          useValue: {
            buildEventEmbed: jest
              .fn()
              .mockReturnValue({ embed: mockEmbed, row: mockRow }),
            buildEventCancelled: jest
              .fn()
              .mockReturnValue({ embed: mockEmbed }),
          },
        },
        {
          provide: EmbedPosterService,
          useValue: {
            postEmbed: jest.fn().mockResolvedValue(true),
            enrichWithLiveRoster: jest
              .fn()
              .mockImplementation((_id: number, event: unknown) =>
                Promise.resolve(event),
              ),
          },
        },
        {
          provide: ChannelResolverService,
          useValue: {
            resolveVoiceChannelForScheduledEvent: jest
              .fn()
              .mockResolvedValue(null),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getBranding: jest.fn().mockResolvedValue({
              communityName: 'Test Guild',
              communityLogoPath: null,
              communityAccentColor: null,
            }),
            getClientUrl: jest.fn().mockResolvedValue(null),
            getDefaultTimezone: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: ScheduledEventService,
          useValue: {
            createScheduledEvent: jest.fn().mockResolvedValue(undefined),
            updateScheduledEvent: jest.fn().mockResolvedValue(undefined),
            deleteScheduledEvent: jest.fn().mockResolvedValue(undefined),
            updateDescription: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    listener = module.get(DiscordEventListener);
    clientService = module.get(DiscordBotClientService);
    embedFactory = module.get(DiscordEmbedFactory);
    embedPoster = module.get(EmbedPosterService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();

    // Restore CLIENT_URL to its original value
    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  describe('handleEventCreated', () => {
    it('should delegate to EmbedPosterService for events within lead-time window', async () => {
      await listener.handleEventCreated(mockPayload);

      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        42,
        mockPayload.event,
        101,
        undefined,
      );
    });

    it('should skip posting when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await listener.handleEventCreated(mockPayload);

      expect(embedPoster.postEmbed).not.toHaveBeenCalled();
    });

    it('should defer to scheduler when event is outside lead-time window', async () => {
      // Event is 30 days in the future — outside 6-day lead time
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const farPayload: EventPayload = {
        ...mockPayload,
        event: {
          ...mockPayload.event,
          startTime: farFuture.toISOString(),
          endTime: new Date(
            farFuture.getTime() + 3 * 60 * 60 * 1000,
          ).toISOString(),
        },
      };

      await listener.handleEventCreated(farPayload);

      expect(embedPoster.postEmbed).not.toHaveBeenCalled();
    });

    it('should defer recurring series events outside lead-time window', async () => {
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const recurringPayload: EventPayload = {
        ...mockPayload,
        event: {
          ...mockPayload.event,
          startTime: farFuture.toISOString(),
          endTime: new Date(
            farFuture.getTime() + 3 * 60 * 60 * 1000,
          ).toISOString(),
        },
        recurrenceRule: { frequency: 'weekly' },
      };

      await listener.handleEventCreated(recurringPayload);

      expect(embedPoster.postEmbed).not.toHaveBeenCalled();
    });
  });

  describe('handleEventUpdated', () => {
    it('should skip when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await listener.handleEventUpdated(mockPayload);

      expect(clientService.editEmbed).not.toHaveBeenCalled();
    });

    it('should skip when no message record exists and event is outside lead time', async () => {
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const farPayload: EventPayload = {
        ...mockPayload,
        event: {
          ...mockPayload.event,
          startTime: farFuture.toISOString(),
        },
      };

      await listener.handleEventUpdated(farPayload);

      expect(clientService.editEmbed).not.toHaveBeenCalled();
      expect(embedPoster.postEmbed).not.toHaveBeenCalled();
    });

    it('should post embed when no message exists but rescheduled into lead-time window', async () => {
      // Default mock returns empty array for select (no existing embed)
      await listener.handleEventUpdated(mockPayload);

      // Should post because event is within lead time and has no embed
      expect(embedPoster.postEmbed).toHaveBeenCalledWith(
        42,
        mockPayload.event,
        101,
        undefined,
      );
    });

    it('should edit the embed when a message record exists', async () => {
      const mockRecord = {
        id: 'record-uuid',
        eventId: 42,
        guildId: 'guild-123',
        channelId: 'channel-789',
        messageId: 'msg-456',
        embedState: EMBED_STATES.POSTED,
      };

      const selectChain: Record<string, unknown> = {};
      selectChain.from = jest.fn().mockReturnValue(selectChain);
      selectChain.where = jest.fn().mockReturnValue(selectChain);
      selectChain.then = (
        resolve: (v: unknown) => void,
        reject: (e: unknown) => void,
      ) => Promise.resolve([mockRecord]).then(resolve, reject);
      mockDb.select.mockReturnValue(selectChain);

      const updateChain: Record<string, jest.Mock> = {};
      updateChain.set = jest.fn().mockReturnValue(updateChain);
      updateChain.where = jest.fn().mockResolvedValue(undefined);
      mockDb.update.mockReturnValue(updateChain);

      await listener.handleEventUpdated(mockPayload);

      expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        mockPayload.event,
        { communityName: 'Test Guild', clientUrl: null, timezone: null },
        { state: EMBED_STATES.POSTED },
      );
      expect(clientService.editEmbed).toHaveBeenCalledWith(
        'channel-789',
        'msg-456',
        mockEmbed,
        mockRow,
      );
    });
  });

  describe('handleEventCancelled', () => {
    it('should edit embed to cancelled state', async () => {
      const mockRecord = {
        id: 'record-uuid',
        eventId: 42,
        guildId: 'guild-123',
        channelId: 'channel-789',
        messageId: 'msg-456',
        embedState: EMBED_STATES.POSTED,
      };

      const selectChain: Record<string, unknown> = {};
      selectChain.from = jest.fn().mockReturnValue(selectChain);
      selectChain.where = jest.fn().mockReturnValue(selectChain);
      selectChain.then = (
        resolve: (v: unknown) => void,
        reject: (e: unknown) => void,
      ) => Promise.resolve([mockRecord]).then(resolve, reject);
      mockDb.select.mockReturnValue(selectChain);

      const updateChain: Record<string, jest.Mock> = {};
      updateChain.set = jest.fn().mockReturnValue(updateChain);
      updateChain.where = jest.fn().mockResolvedValue(undefined);
      mockDb.update.mockReturnValue(updateChain);

      await listener.handleEventCancelled(mockPayload);

      expect(embedFactory.buildEventCancelled).toHaveBeenCalledWith(
        mockPayload.event,
        { communityName: 'Test Guild', clientUrl: null, timezone: null },
      );
      expect(clientService.editEmbed).toHaveBeenCalledWith(
        'channel-789',
        'msg-456',
        mockEmbed,
      );
    });
  });

  describe('handleEventDeleted', () => {
    it('should delete the Discord message', async () => {
      const mockRecord = {
        id: 'record-uuid',
        eventId: 42,
        guildId: 'guild-123',
        channelId: 'channel-789',
        messageId: 'msg-456',
        embedState: EMBED_STATES.POSTED,
      };

      const selectChain: Record<string, unknown> = {};
      selectChain.from = jest.fn().mockReturnValue(selectChain);
      selectChain.where = jest.fn().mockReturnValue(selectChain);
      selectChain.then = (
        resolve: (v: unknown) => void,
        reject: (e: unknown) => void,
      ) => Promise.resolve([mockRecord]).then(resolve, reject);
      mockDb.select.mockReturnValue(selectChain);

      const deleteChain: Record<string, jest.Mock> = {};
      deleteChain.where = jest.fn().mockResolvedValue(undefined);
      mockDb.delete.mockReturnValue(deleteChain);

      await listener.handleEventDeleted({ eventId: 42 });

      expect(clientService.deleteMessage).toHaveBeenCalledWith(
        'channel-789',
        'msg-456',
      );
    });

    it('should skip when no message record exists', async () => {
      await listener.handleEventDeleted({ eventId: 42 });

      expect(clientService.deleteMessage).not.toHaveBeenCalled();
    });

    it('should handle delete errors gracefully', async () => {
      const mockRecord = {
        id: 'record-uuid',
        eventId: 42,
        guildId: 'guild-123',
        channelId: 'channel-789',
        messageId: 'msg-456',
        embedState: EMBED_STATES.POSTED,
      };

      const selectChain: Record<string, unknown> = {};
      selectChain.from = jest.fn().mockReturnValue(selectChain);
      selectChain.where = jest.fn().mockReturnValue(selectChain);
      selectChain.then = (
        resolve: (v: unknown) => void,
        reject: (e: unknown) => void,
      ) => Promise.resolve([mockRecord]).then(resolve, reject);
      mockDb.select.mockReturnValue(selectChain);

      const deleteChain: Record<string, jest.Mock> = {};
      deleteChain.where = jest.fn().mockResolvedValue(undefined);
      mockDb.delete.mockReturnValue(deleteChain);

      clientService.deleteMessage.mockRejectedValue(
        new Error('Message not found'),
      );

      // Should not throw
      await expect(
        listener.handleEventDeleted({ eventId: 42 }),
      ).resolves.not.toThrow();
    });
  });

  describe('updateEmbedState', () => {
    it('should update embed state and re-render', async () => {
      const mockRecord = {
        id: 'record-uuid',
        eventId: 42,
        guildId: 'guild-123',
        channelId: 'channel-789',
        messageId: 'msg-456',
        embedState: EMBED_STATES.POSTED,
      };

      const selectChain: Record<string, unknown> = {};
      selectChain.from = jest.fn().mockReturnValue(selectChain);
      selectChain.where = jest.fn().mockReturnValue(selectChain);
      selectChain.then = (
        resolve: (v: unknown) => void,
        reject: (e: unknown) => void,
      ) => Promise.resolve([mockRecord]).then(resolve, reject);
      mockDb.select.mockReturnValue(selectChain);

      const updateChain: Record<string, jest.Mock> = {};
      updateChain.set = jest.fn().mockReturnValue(updateChain);
      updateChain.where = jest.fn().mockResolvedValue(undefined);
      mockDb.update.mockReturnValue(updateChain);

      await listener.updateEmbedState(
        42,
        EMBED_STATES.IMMINENT,
        mockPayload.event,
      );

      expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        mockPayload.event,
        { communityName: 'Test Guild', clientUrl: null, timezone: null },
        { state: EMBED_STATES.IMMINENT },
      );
      expect(clientService.editEmbed).toHaveBeenCalled();
    });
  });
});
