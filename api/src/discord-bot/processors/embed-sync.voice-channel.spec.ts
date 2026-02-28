/**
 * Tests that EmbedSyncProcessor resolves and passes voiceChannelId to embeds (ROK-507).
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EmbedSyncProcessor } from './embed-sync.processor';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot.constants';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { Job } from 'bullmq';
import type { EmbedSyncJobData } from '../queues/embed-sync.queue';

describe('EmbedSyncProcessor — voice channel resolution (ROK-507)', () => {
  let processor: EmbedSyncProcessor;
  let embedFactory: jest.Mocked<DiscordEmbedFactory>;
  let channelResolver: jest.Mocked<ChannelResolverService>;
  let mockDb: Record<string, jest.Mock>;

  const FUTURE = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const FUTURE_END = new Date(FUTURE.getTime() + 3 * 60 * 60 * 1000);

  const mockEvent = {
    id: 42,
    title: 'Raid Night',
    description: 'Epic night',
    duration: [FUTURE, FUTURE_END],
    maxAttendees: 25,
    cancelledAt: null,
    gameId: 7,
    slotConfig: null,
    isAdHoc: false,
    discordScheduledEventId: null,
  };

  const mockRecord = {
    id: 'record-uuid',
    eventId: 42,
    guildId: 'guild-123',
    channelId: 'channel-789',
    messageId: 'msg-456',
    embedState: EMBED_STATES.POSTED,
  };

  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = new ActionRowBuilder<ButtonBuilder>();

  const makeSelectChain = (rows: unknown[] = []) => {
    const chain: Record<string, jest.Mock> & { then?: unknown } = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    chain.leftJoin = jest.fn().mockReturnValue(chain);
    chain.innerJoin = jest.fn().mockReturnValue(chain);
    chain.groupBy = jest.fn().mockResolvedValue([]);
    chain.select = jest.fn().mockReturnValue(chain);
    chain.then = (
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  };

  const makeUpdateChain = () => {
    const chain: Record<string, jest.Mock> = {};
    chain.set = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockResolvedValue(undefined);
    return chain;
  };

  const setupDbForSuccessfulSync = () => {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([mockRecord])) // discordEventMessages
      .mockReturnValueOnce(makeSelectChain([mockEvent]))  // events
      .mockReturnValueOnce(makeSelectChain([]))            // eventSignups
      .mockReturnValueOnce(makeSelectChain([]))            // rosterAssignments
      .mockReturnValueOnce(makeSelectChain([{ name: 'WoW', coverUrl: null }])); // games
  };

  beforeEach(async () => {
    const selectChain = makeSelectChain();
    const updateChain = makeUpdateChain();

    mockDb = {
      select: jest.fn().mockReturnValue(selectChain),
      update: jest.fn().mockReturnValue(updateChain),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbedSyncProcessor,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            getGuildId: jest.fn().mockReturnValue('guild-123'),
            editEmbed: jest.fn().mockResolvedValue({ id: 'msg-456' }),
          },
        },
        {
          provide: DiscordEmbedFactory,
          useValue: {
            buildEventUpdate: jest
              .fn()
              .mockReturnValue({ embed: mockEmbed, row: mockRow }),
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
            updateDescription: jest.fn().mockResolvedValue(undefined),
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
      ],
    }).compile();

    processor = module.get(EmbedSyncProcessor);
    embedFactory = module.get(DiscordEmbedFactory);
    channelResolver = module.get(ChannelResolverService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const job = { data: { eventId: 42, reason: 'signup' } } as Job<EmbedSyncJobData>;

  it('calls resolveVoiceChannelForScheduledEvent with the event gameId', async () => {
    setupDbForSuccessfulSync();
    mockDb.update.mockReturnValue(makeUpdateChain());

    await processor.process(job);

    expect(
      channelResolver.resolveVoiceChannelForScheduledEvent,
    ).toHaveBeenCalledWith(7);
  });

  it('passes voiceChannelId to buildEventUpdate when resolver returns a channel', async () => {
    setupDbForSuccessfulSync();
    mockDb.update.mockReturnValue(makeUpdateChain());

    channelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
      'voice-ch-999',
    );

    await processor.process(job);

    expect(embedFactory.buildEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ voiceChannelId: 'voice-ch-999' }),
      expect.any(Object),
      expect.any(String),
    );
  });

  it('does NOT set voiceChannelId on event data when resolver returns null', async () => {
    setupDbForSuccessfulSync();
    mockDb.update.mockReturnValue(makeUpdateChain());

    channelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(null);

    await processor.process(job);

    // buildEventUpdate should be called with an object that does NOT have voiceChannelId set
    const eventDataArg = embedFactory.buildEventUpdate.mock.calls[0][0];
    expect(eventDataArg.voiceChannelId).toBeUndefined();
  });

  it('calls resolveVoiceChannelForScheduledEvent with null when event has no gameId', async () => {
    const eventWithNoGame = { ...mockEvent, gameId: null };
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([mockRecord]))
      .mockReturnValueOnce(makeSelectChain([eventWithNoGame]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]))
      // no games fetch since gameId is null
      ;
    mockDb.update.mockReturnValue(makeUpdateChain());

    await processor.process(job);

    expect(
      channelResolver.resolveVoiceChannelForScheduledEvent,
    ).toHaveBeenCalledWith(null);
  });

  it('does not call resolveVoiceChannelForScheduledEvent when bot is not connected', async () => {
    const clientService = processor['clientService'] as { isConnected: jest.Mock };
    clientService.isConnected.mockReturnValue(false);

    await expect(processor.process(job)).rejects.toThrow('Discord bot not connected');

    expect(
      channelResolver.resolveVoiceChannelForScheduledEvent,
    ).not.toHaveBeenCalled();
  });

  it('does not call resolveVoiceChannelForScheduledEvent when no Discord message record exists', async () => {
    mockDb.select.mockReturnValue(makeSelectChain([])); // no record

    await processor.process(job);

    expect(
      channelResolver.resolveVoiceChannelForScheduledEvent,
    ).not.toHaveBeenCalled();
  });
});
