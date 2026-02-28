/**
 * Tests that EmbedPosterService resolves and injects voiceChannelId into embed data (ROK-507).
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

describe('EmbedPosterService — voice channel resolution (ROK-507)', () => {
  let service: EmbedPosterService;
  let embedFactory: jest.Mocked<DiscordEmbedFactory>;
  let channelResolver: jest.Mocked<ChannelResolverService>;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let mockDb: Record<string, jest.Mock>;

  const mockMessage = { id: 'msg-123' };
  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = new ActionRowBuilder<ButtonBuilder>();

  const baseEvent: EmbedEventData = {
    id: 42,
    title: 'Raid Night',
    startTime: '2026-02-20T20:00:00.000Z',
    endTime: '2026-02-20T23:00:00.000Z',
    signupCount: 0,
  };

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

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn().mockReturnValue(makeInsertChain()),
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
            resolveChannelForEvent: jest.fn().mockResolvedValue('channel-abc'),
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
    embedFactory = module.get(DiscordEmbedFactory);
    channelResolver = module.get(ChannelResolverService);
    clientService = module.get(DiscordBotClientService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const setupEmptyRoster = () => {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([])) // eventSignups
      .mockReturnValueOnce(makeSelectChain([])); // rosterAssignments
  };

  it('calls resolveVoiceChannelForScheduledEvent with the provided gameId', async () => {
    setupEmptyRoster();

    await service.postEmbed(42, baseEvent, 7);

    expect(
      channelResolver.resolveVoiceChannelForScheduledEvent,
    ).toHaveBeenCalledWith(7);
  });

  it('sets voiceChannelId on enriched event data when resolver returns a channel', async () => {
    setupEmptyRoster();

    channelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
      'vc-555',
    );

    await service.postEmbed(42, baseEvent, 3);

    expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ voiceChannelId: 'vc-555' }),
      expect.any(Object),
    );
  });

  it('does NOT set voiceChannelId when resolver returns null', async () => {
    setupEmptyRoster();

    channelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
      null,
    );

    await service.postEmbed(42, baseEvent, 3);

    const eventDataArg = embedFactory.buildEventEmbed.mock.calls[0][0];
    // voiceChannelId should not be present (undefined) since resolver returned null
    expect(eventDataArg.voiceChannelId).toBeUndefined();
  });

  it('calls resolveVoiceChannelForScheduledEvent with null when gameId is null', async () => {
    setupEmptyRoster();

    await service.postEmbed(42, baseEvent, null);

    expect(
      channelResolver.resolveVoiceChannelForScheduledEvent,
    ).toHaveBeenCalledWith(null);
  });

  it('calls resolveVoiceChannelForScheduledEvent with undefined when gameId is not provided', async () => {
    setupEmptyRoster();

    await service.postEmbed(42, baseEvent);

    expect(
      channelResolver.resolveVoiceChannelForScheduledEvent,
    ).toHaveBeenCalledWith(undefined);
  });

  it('does not call resolveVoiceChannelForScheduledEvent when bot is not connected', async () => {
    clientService.isConnected.mockReturnValue(false);

    const result = await service.postEmbed(42, baseEvent, 7);

    expect(result).toBe(false);
    expect(
      channelResolver.resolveVoiceChannelForScheduledEvent,
    ).not.toHaveBeenCalled();
  });

  it('does not call resolveVoiceChannelForScheduledEvent when channel resolution fails', async () => {
    channelResolver.resolveChannelForEvent.mockResolvedValue(null);

    const result = await service.postEmbed(42, baseEvent, 7);

    expect(result).toBe(false);
    expect(
      channelResolver.resolveVoiceChannelForScheduledEvent,
    ).not.toHaveBeenCalled();
  });

  it('returns true and sends embed with voice channel when configured', async () => {
    setupEmptyRoster();

    channelResolver.resolveVoiceChannelForScheduledEvent.mockResolvedValue(
      'vc-999',
    );

    const result = await service.postEmbed(42, baseEvent, 5);

    expect(result).toBe(true);
    expect(clientService.sendEmbed).toHaveBeenCalled();
    expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ voiceChannelId: 'vc-999' }),
      expect.any(Object),
    );
  });
});
