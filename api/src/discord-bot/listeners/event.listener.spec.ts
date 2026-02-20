/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordEventListener, type EventPayload } from './event.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot.constants';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

describe('DiscordEventListener', () => {
  let module: TestingModule;
  let listener: DiscordEventListener;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let embedFactory: jest.Mocked<DiscordEmbedFactory>;
  let channelResolver: jest.Mocked<ChannelResolverService>;
  let mockDb: {
    insert: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  const originalClientUrl = process.env.CLIENT_URL;

  const mockPayload: EventPayload = {
    eventId: 42,
    event: {
      id: 42,
      title: 'Test Raid',
      startTime: '2026-02-20T20:00:00.000Z',
      endTime: '2026-02-20T23:00:00.000Z',
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
    // The chain is thenable so `await db.select().from(...).where(...)` resolves
    // to the result array, while `.limit()` also resolves for queries that use it.
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
          provide: ChannelResolverService,
          useValue: {
            resolveChannelForEvent: jest.fn().mockResolvedValue('channel-789'),
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
          },
        },
      ],
    }).compile();

    listener = module.get(DiscordEventListener);
    clientService = module.get(DiscordBotClientService);
    embedFactory = module.get(DiscordEmbedFactory);
    channelResolver = module.get(ChannelResolverService);
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
    it('should post an embed and store the message reference', async () => {
      await listener.handleEventCreated(mockPayload);

      expect(channelResolver.resolveChannelForEvent).toHaveBeenCalledWith(101);
      expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
        mockPayload.event,
        { communityName: 'Test Guild', clientUrl: null },
      );
      expect(clientService.sendEmbed).toHaveBeenCalledWith(
        'channel-789',
        mockEmbed,
        mockRow,
      );
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should skip posting when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await listener.handleEventCreated(mockPayload);

      expect(clientService.sendEmbed).not.toHaveBeenCalled();
    });

    it('should skip posting when no channel is resolved', async () => {
      channelResolver.resolveChannelForEvent.mockResolvedValue(null);

      await listener.handleEventCreated(mockPayload);

      expect(clientService.sendEmbed).not.toHaveBeenCalled();
    });

    it('should skip posting when bot is not in any guild', async () => {
      clientService.getGuildId.mockReturnValue(null);

      await listener.handleEventCreated(mockPayload);

      expect(clientService.sendEmbed).not.toHaveBeenCalled();
    });

    it('should handle send errors gracefully', async () => {
      clientService.sendEmbed.mockRejectedValue(new Error('Discord API error'));

      // Should not throw
      await expect(
        listener.handleEventCreated(mockPayload),
      ).resolves.not.toThrow();
    });
  });

  describe('handleEventUpdated', () => {
    it('should skip when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await listener.handleEventUpdated(mockPayload);

      expect(clientService.editEmbed).not.toHaveBeenCalled();
    });

    it('should skip when no message record exists', async () => {
      // Default mock returns empty array for select
      await listener.handleEventUpdated(mockPayload);

      expect(clientService.editEmbed).not.toHaveBeenCalled();
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
        { communityName: 'Test Guild', clientUrl: null },
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
        { communityName: 'Test Guild', clientUrl: null },
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
        { communityName: 'Test Guild', clientUrl: null },
        { state: EMBED_STATES.IMMINENT },
      );
      expect(clientService.editEmbed).toHaveBeenCalled();
    });
  });
});
