/**
 * ROK-599: Tests that EmbedPosterService threads notificationChannelOverride
 * through to ChannelResolverService.resolveChannelForEvent correctly.
 *
 * Verifies Priority 0 override flows all the way from postEmbed → resolveChannelForEvent
 * and that the fallback (editExistingEmbed) also uses the override when re-posting.
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EmbedPosterService } from './embed-poster.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
} from './discord-embed.factory';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

describe('EmbedPosterService — notification channel override (ROK-599)', () => {
  let service: EmbedPosterService;
  let channelResolver: jest.Mocked<ChannelResolverService>;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let mockDb: Record<string, jest.Mock>;

  const mockMessage = { id: 'msg-123' };
  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = new ActionRowBuilder<ButtonBuilder>();

  const baseEvent: EmbedEventData = {
    id: 42,
    title: 'Raid Night',
    startTime: '2026-04-01T20:00:00.000Z',
    endTime: '2026-04-01T23:00:00.000Z',
    signupCount: 0,
  };

  /** Build a chainable select mock */
  const makeSelectChain = (rows: unknown[] = []) => {
    const chain: Record<string, jest.Mock> & { then?: unknown } = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    chain.leftJoin = jest.fn().mockReturnValue(chain);
    chain.innerJoin = jest.fn().mockReturnValue(chain);
    chain.groupBy = jest.fn().mockResolvedValue([]);
    chain.then = (
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  };

  const makeInsertChain = () => {
    const chain: Record<string, jest.Mock> = {};
    chain.values = jest.fn().mockResolvedValue(undefined);
    return chain;
  };

  const makeUpdateChain = () => {
    const chain: Record<string, jest.Mock> = {};
    chain.set = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockResolvedValue(undefined);
    return chain;
  };

  /** Sets up the DB mock for a fresh embed (no existing embed record) */
  const setupEmptyRoster = () => {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([])) // idempotency check (no existing embed)
      .mockReturnValueOnce(makeSelectChain([])) // eventSignups
      .mockReturnValueOnce(makeSelectChain([])); // rosterAssignments (groupBy terminal)
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn().mockReturnValue(makeInsertChain()),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbedPosterService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            getGuildId: jest.fn().mockReturnValue('guild-123'),
            sendEmbed: jest.fn().mockResolvedValue(mockMessage),
            editEmbed: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DiscordEmbedFactory,
          useValue: {
            buildEventEmbed: jest
              .fn()
              .mockReturnValue({ embed: mockEmbed, row: mockRow }),
          },
        },
        {
          provide: ChannelResolverService,
          useValue: {
            resolveChannelForEvent: jest
              .fn()
              .mockResolvedValue('default-channel'),
            resolveVoiceChannelForScheduledEvent: jest
              .fn()
              .mockResolvedValue(null),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getBranding: jest
              .fn()
              .mockResolvedValue({ communityName: 'Test Guild' }),
            getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
            getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
          },
        },
      ],
    }).compile();

    service = module.get(EmbedPosterService);
    channelResolver = module.get(ChannelResolverService);
    clientService = module.get(DiscordBotClientService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // notificationChannelOverride pass-through to resolver
  // ============================================================
  describe('resolveChannelForEvent receives notificationChannelOverride', () => {
    it('passes notificationChannelOverride to resolveChannelForEvent when provided', async () => {
      setupEmptyRoster();

      await service.postEmbed(42, baseEvent, 5, null, 'override-channel-777');

      expect(channelResolver.resolveChannelForEvent).toHaveBeenCalledWith(
        5,
        null,
        'override-channel-777',
      );
    });

    it('passes null notificationChannelOverride when not provided', async () => {
      setupEmptyRoster();

      await service.postEmbed(42, baseEvent, 5, null, null);

      expect(channelResolver.resolveChannelForEvent).toHaveBeenCalledWith(
        5,
        null,
        null,
      );
    });

    it('passes undefined notificationChannelOverride when argument is omitted', async () => {
      setupEmptyRoster();

      await service.postEmbed(42, baseEvent, 5);

      expect(channelResolver.resolveChannelForEvent).toHaveBeenCalledWith(
        5,
        undefined,
        undefined,
      );
    });

    it('passes recurrenceGroupId alongside notificationChannelOverride', async () => {
      setupEmptyRoster();

      await service.postEmbed(
        42,
        baseEvent,
        5,
        'rec-uuid-123',
        'override-channel-777',
      );

      expect(channelResolver.resolveChannelForEvent).toHaveBeenCalledWith(
        5,
        'rec-uuid-123',
        'override-channel-777',
      );
    });

    it('posts to the override channel when resolver returns the override', async () => {
      setupEmptyRoster();

      channelResolver.resolveChannelForEvent.mockResolvedValue(
        'override-channel-777',
      );

      const result = await service.postEmbed(
        42,
        baseEvent,
        5,
        null,
        'override-channel-777',
      );

      expect(result).toBe(true);
      expect(clientService.sendEmbed).toHaveBeenCalledWith(
        'override-channel-777',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ============================================================
  // editExistingEmbed fallback also uses the override
  // ============================================================
  describe('editExistingEmbed fallback re-uses notificationChannelOverride', () => {
    const existingRecord = {
      id: 'record-uuid',
      channelId: 'original-channel-id',
      messageId: 'msg-old-456',
    };

    /** Setup where an existing embed record is found, then edit fails with Unknown Message */
    const setupExistingEmbedDeleted = () => {
      // First select call: idempotency check — returns existing record
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([existingRecord]))
        .mockReturnValueOnce(makeSelectChain([])) // eventSignups
        .mockReturnValueOnce(makeSelectChain([])); // rosterAssignments

      // Edit fails with Unknown Message (10008)
      const editError = Object.assign(new Error('Unknown Message'), { code: 10008 });
      clientService.editEmbed = jest.fn().mockRejectedValue(editError);
    };

    it('calls resolveChannelForEvent with override during fallback re-post', async () => {
      setupExistingEmbedDeleted();

      // After fallback re-post, the update chain is needed
      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
      clientService.sendEmbed.mockResolvedValue({ id: 'msg-new-789' });
      channelResolver.resolveChannelForEvent.mockResolvedValue(
        'override-channel-777',
      );

      await service.postEmbed(
        42,
        baseEvent,
        5,
        null,
        'override-channel-777',
      );

      // Should be called twice: once for initial check, once for fallback re-post
      expect(channelResolver.resolveChannelForEvent).toHaveBeenCalledTimes(2);

      // Both calls should carry the override
      expect(channelResolver.resolveChannelForEvent).toHaveBeenNthCalledWith(
        1,
        5,
        null,
        'override-channel-777',
      );
      expect(channelResolver.resolveChannelForEvent).toHaveBeenNthCalledWith(
        2,
        5,
        null,
        'override-channel-777',
      );
    });

    it('posts replacement to override channel after message deletion', async () => {
      setupExistingEmbedDeleted();

      mockDb.update = jest.fn().mockReturnValue(makeUpdateChain());
      clientService.sendEmbed.mockResolvedValue({ id: 'msg-new-789' });
      channelResolver.resolveChannelForEvent.mockResolvedValue(
        'override-channel-888',
      );

      const result = await service.postEmbed(
        42,
        baseEvent,
        5,
        null,
        'override-channel-888',
      );

      expect(result).toBe(true);
      expect(clientService.sendEmbed).toHaveBeenCalledWith(
        'override-channel-888',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ============================================================
  // Returns false when bot is not connected (regardless of override)
  // ============================================================
  describe('bot connection guard', () => {
    it('returns false immediately when bot is not connected, even with override', async () => {
      clientService.isConnected.mockReturnValue(false);

      const result = await service.postEmbed(
        42,
        baseEvent,
        5,
        null,
        'override-channel-777',
      );

      expect(result).toBe(false);
      expect(channelResolver.resolveChannelForEvent).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Returns false when resolver returns null (override was falsy)
  // ============================================================
  describe('null channel resolution', () => {
    it('returns false when resolver returns null even with recurrenceGroupId and gameId', async () => {
      channelResolver.resolveChannelForEvent.mockResolvedValue(null);

      const result = await service.postEmbed(
        42,
        baseEvent,
        5,
        'rec-uuid-123',
        null,
      );

      expect(result).toBe(false);
      expect(clientService.sendEmbed).not.toHaveBeenCalled();
    });
  });
});
