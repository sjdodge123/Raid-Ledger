/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EmbedSyncProcessor } from './embed-sync.processor';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot.constants';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { Job } from 'bullmq';
import type { EmbedSyncJobData } from '../queues/embed-sync.queue';

describe('EmbedSyncProcessor — ROK-471 scheduled event description update', () => {
  let processor: EmbedSyncProcessor;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let scheduledEventService: jest.Mocked<ScheduledEventService>;
  let mockDb: Record<string, jest.Mock>;

  const FUTURE = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const FUTURE_END = new Date(FUTURE.getTime() + 3 * 60 * 60 * 1000);

  /** A minimal event row returned from DB. */
  const mockEvent = {
    id: 42,
    title: 'Raid Night',
    description: 'Epic night',
    duration: [FUTURE, FUTURE_END],
    maxAttendees: 25,
    cancelledAt: null,
    gameId: 1,
    slotConfig: null,
    isAdHoc: false,
    discordScheduledEventId: null,
  };

  /** The Discord embed message record tracked for event 42. */
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

  /** Build a chainable Drizzle select that resolves via `.limit()` or is thenable. */
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
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
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
      ],
    }).compile();

    processor = module.get(EmbedSyncProcessor);
    clientService = module.get(DiscordBotClientService);
    scheduledEventService = module.get(ScheduledEventService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /** Build the DB select mock chain to return the right rows in order:
   *  1. discordEventMessages record
   *  2. events record
   *  3. eventSignups rows (empty)
   *  4. rosterAssignments rows (empty)
   *  5. games row (for game name)
   */
  const setupDbForSuccessfulSync = () => {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([mockRecord])) // discordEventMessages
      .mockReturnValueOnce(makeSelectChain([mockEvent]))  // events
      .mockReturnValueOnce(makeSelectChain([]))            // eventSignups
      .mockReturnValueOnce(makeSelectChain([]))            // rosterAssignments
      .mockReturnValueOnce(makeSelectChain([{ name: 'WoW', coverUrl: null }])); // games
  };

  it('calls scheduledEventService.updateDescription after a successful embed sync (AC-7)', async () => {
    setupDbForSuccessfulSync();
    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValue(updateChain);

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;

    await processor.process(job);

    expect(scheduledEventService.updateDescription).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ signupCount: expect.any(Number) }),
    );
  });

  it('does not call updateDescription when the bot is not connected', async () => {
    clientService.isConnected.mockReturnValue(false);

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;

    await expect(processor.process(job)).rejects.toThrow('Discord bot not connected');

    expect(scheduledEventService.updateDescription).not.toHaveBeenCalled();
  });

  it('does not call updateDescription when no Discord message record exists', async () => {
    mockDb.select.mockReturnValue(makeSelectChain([])); // no record

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;

    await processor.process(job);

    expect(scheduledEventService.updateDescription).not.toHaveBeenCalled();
  });

  it('does not call updateDescription when the embed is cancelled', async () => {
    const cancelledRecord = { ...mockRecord, embedState: EMBED_STATES.CANCELLED };
    mockDb.select.mockReturnValue(makeSelectChain([cancelledRecord]));

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;

    await processor.process(job);

    expect(scheduledEventService.updateDescription).not.toHaveBeenCalled();
  });

  it('does not block embed sync when updateDescription fails (fire-and-forget)', async () => {
    setupDbForSuccessfulSync();
    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValue(updateChain);

    scheduledEventService.updateDescription.mockRejectedValue(
      new Error('Discord API error'),
    );

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;

    // The embed sync should complete successfully even if updateDescription fails
    await expect(processor.process(job)).resolves.not.toThrow();

    // Verify the embed was still updated
    expect(clientService.editEmbed).toHaveBeenCalled();
  });
});
