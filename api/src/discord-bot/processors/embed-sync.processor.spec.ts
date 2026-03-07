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

  function buildProvidersCore() {
    return [
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
    ];
  }

  function buildProvidersMocksA() {
    return [
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
    ];
  }

  function buildProvidersMocksB() {
    return [
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
    ];
  }

  function buildProvidersMocks() {
    return [...buildProvidersMocksA(), ...buildProvidersMocksB()];
  }

  function buildProviders() {
    return [...buildProvidersCore(), ...buildProvidersMocks()];
  }
  async function setupBlock() {
    const selectChain = makeSelectChain();
    const updateChain = makeUpdateChain();

    mockDb = {
      select: jest.fn().mockReturnValue(selectChain),
      update: jest.fn().mockReturnValue(updateChain),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(),
    }).compile();

    processor = module.get(EmbedSyncProcessor);
    clientService = module.get(DiscordBotClientService);
    scheduledEventService = module.get(ScheduledEventService);
  }

  beforeEach(async () => {
    await setupBlock();
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
      .mockReturnValueOnce(makeSelectChain([mockEvent])) // events
      .mockReturnValueOnce(makeSelectChain([])) // eventSignups
      .mockReturnValueOnce(makeSelectChain([])) // rosterAssignments
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

    await expect(processor.process(job)).rejects.toThrow(
      'Discord bot not connected',
    );

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
    const cancelledRecord = {
      ...mockRecord,
      embedState: EMBED_STATES.CANCELLED,
    };
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

describe('EmbedSyncProcessor — ROK-682 slot-config-based fullness', () => {
  let processor: EmbedSyncProcessor;
  let embedFactory: jest.Mocked<DiscordEmbedFactory>;
  let mockDb: Record<string, jest.Mock>;

  const FUTURE = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const FUTURE_END = new Date(FUTURE.getTime() + 3 * 60 * 60 * 1000);

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

  /** Build signup rows that simulate N active signups. */
  const makeSignupRows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      discordId: `user-${i}`,
      username: `User ${i}`,
      role: 'player',
      status: 'signed_up',
      preferredRoles: null,
      className: null,
    }));

  function buildProviders2Core() {
    return [
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
    ];
  }

  function buildProviders2MocksA() {
    return [
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
    ];
  }

  function buildProviders2MocksB() {
    return [
      {
        provide: ScheduledEventService,
        useValue: {
          updateDescription: jest.fn().mockResolvedValue(undefined),
          completeScheduledEvent: jest.fn().mockResolvedValue(undefined),
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
    ];
  }

  function buildProviders2Mocks() {
    return [...buildProviders2MocksA(), ...buildProviders2MocksB()];
  }

  function buildProviders2() {
    return [...buildProviders2Core(), ...buildProviders2Mocks()];
  }
  async function setupBlock2() {
    const selectChain = makeSelectChain();
    const updateChain = makeUpdateChain();

    mockDb = {
      select: jest.fn().mockReturnValue(selectChain),
      update: jest.fn().mockReturnValue(updateChain),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders2(),
    }).compile();

    processor = module.get(EmbedSyncProcessor);
    embedFactory = module.get(DiscordEmbedFactory);
  }

  beforeEach(async () => {
    await setupBlock2();
  });

  afterEach(() => jest.clearAllMocks());

  /**
   * Set up DB mocks for a sync run with a given event and signup count.
   */
  const setupDbForEvent = (
    event: Record<string, unknown>,
    signupCount: number,
  ) => {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([mockRecord])) // discordEventMessages
      .mockReturnValueOnce(makeSelectChain([event])) // events
      .mockReturnValueOnce(makeSelectChain(makeSignupRows(signupCount))) // eventSignups
      .mockReturnValueOnce(makeSelectChain([])) // rosterAssignments
      .mockReturnValueOnce(
        makeSelectChain([{ name: 'Phasmophobia', coverUrl: null }]),
      ); // games
    mockDb.update.mockReturnValue(makeUpdateChain());
  };

  it('marks event as FULL when generic slotConfig player count is reached (maxAttendees null)', async () => {
    const event = {
      id: 42,
      title: 'Ghost Raid',
      description: null,
      duration: [FUTURE, FUTURE_END],
      maxAttendees: null,
      cancelledAt: null,
      gameId: 1,
      slotConfig: { type: 'generic', player: 4, bench: 2 },
      isAdHoc: false,
      extendedUntil: null,
      notificationChannelOverride: null,
      recurrenceGroupId: null,
    };

    setupDbForEvent(event, 4); // 4 signups == 4 player slots → FULL

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(embedFactory.buildEventUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      EMBED_STATES.FULL,
    );
  });

  it('marks event as FULL when MMO slotConfig total is reached (maxAttendees null)', async () => {
    const event = {
      id: 42,
      title: 'Mythic Raid',
      description: null,
      duration: [FUTURE, FUTURE_END],
      maxAttendees: null,
      cancelledAt: null,
      gameId: 1,
      slotConfig: { type: 'mmo', tank: 2, healer: 3, dps: 5, flex: 0 },
      isAdHoc: false,
      extendedUntil: null,
      notificationChannelOverride: null,
      recurrenceGroupId: null,
    };

    setupDbForEvent(event, 10); // 10 signups == 2+3+5 = 10 slots → FULL

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(embedFactory.buildEventUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      EMBED_STATES.FULL,
    );
  });

  it('marks event as FILLING when signups are below slot capacity', async () => {
    const event = {
      id: 42,
      title: 'Ghost Raid',
      description: null,
      duration: [FUTURE, FUTURE_END],
      maxAttendees: null,
      cancelledAt: null,
      gameId: 1,
      slotConfig: { type: 'generic', player: 4, bench: 2 },
      isAdHoc: false,
      extendedUntil: null,
      notificationChannelOverride: null,
      recurrenceGroupId: null,
    };

    setupDbForEvent(event, 3); // 3 signups < 4 player slots → FILLING

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(embedFactory.buildEventUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      EMBED_STATES.FILLING,
    );
  });

  it('marks event as FULL when signups exceed slot capacity (benched players)', async () => {
    const event = {
      id: 42,
      title: 'Ghost Raid',
      description: null,
      duration: [FUTURE, FUTURE_END],
      maxAttendees: null,
      cancelledAt: null,
      gameId: 1,
      slotConfig: { type: 'generic', player: 4, bench: 2 },
      isAdHoc: false,
      extendedUntil: null,
      notificationChannelOverride: null,
      recurrenceGroupId: null,
    };

    setupDbForEvent(event, 5); // 5 signups > 4 player slots (1 benched) → FULL

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(embedFactory.buildEventUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      EMBED_STATES.FULL,
    );
  });
});
