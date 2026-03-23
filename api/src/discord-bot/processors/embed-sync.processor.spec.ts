import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EmbedSyncProcessor } from './embed-sync.processor';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot.constants';
import { EMBED_SYNC_QUEUE } from '../queues/embed-sync.queue';
import { QueueHealthService } from '../../queue/queue-health.service';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import type { Job } from 'bullmq';
import type { EmbedSyncJobData } from '../queues/embed-sync.queue';

const FUTURE = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const FUTURE_END = new Date(FUTURE.getTime() + 3 * 60 * 60 * 1000);

const mockEmbed = new EmbedBuilder().setTitle('Test');
const mockRow = new ActionRowBuilder<ButtonBuilder>();

/** Build a chainable Drizzle select that resolves via `.limit()` or is thenable. */
function makeSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  chain.leftJoin = jest.fn().mockReturnValue(chain);
  chain.innerJoin = jest.fn().mockReturnValue(chain);
  chain.groupBy = jest.fn().mockResolvedValue([]);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function makeUpdateChain() {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
}

/** Standard provider mocks for EmbedSyncProcessor. */
function buildProviders(mockDb: Record<string, jest.Mock>) {
  return [
    EmbedSyncProcessor,
    { provide: DrizzleAsyncProvider, useValue: mockDb },
    {
      provide: getQueueToken(EMBED_SYNC_QUEUE),
      useValue: {
        drain: jest.fn(),
        getJobCounts: jest.fn().mockResolvedValue({
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        }),
      },
    },
    { provide: QueueHealthService, useValue: { register: jest.fn() } },
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
        completeScheduledEvent: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: ChannelResolverService,
      useValue: {
        resolveVoiceChannelForScheduledEvent: jest.fn().mockResolvedValue(null),
      },
    },
  ];
}

// =========================================================================
// ROK-471 scheduled event description update
// =========================================================================

describe('EmbedSyncProcessor — description update: success', () => {
  let processor: EmbedSyncProcessor;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let scheduledEventService: jest.Mocked<ScheduledEventService>;
  let mockDb: Record<string, jest.Mock>;

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

  const mockRecord = {
    id: 'record-uuid',
    eventId: 42,
    guildId: 'guild-123',
    channelId: 'channel-789',
    messageId: 'msg-456',
    embedState: EMBED_STATES.POSTED,
  };

  function setupDbForSuccessfulSync() {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([mockRecord]))
      .mockReturnValueOnce(makeSelectChain([mockEvent]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([{ name: 'WoW', coverUrl: null }]));
  }

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain()),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(mockDb),
    }).compile();

    processor = module.get(EmbedSyncProcessor);
    clientService = module.get(DiscordBotClientService);
    scheduledEventService = module.get(ScheduledEventService);
  });

  afterEach(() => jest.clearAllMocks());

  it('calls scheduledEventService.updateDescription after a successful embed sync (AC-7)', async () => {
    setupDbForSuccessfulSync();
    mockDb.update.mockReturnValue(makeUpdateChain());

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(scheduledEventService.updateDescription).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ signupCount: expect.any(Number) }),
    );
  });

  it('does not block embed sync when updateDescription fails (fire-and-forget)', async () => {
    setupDbForSuccessfulSync();
    mockDb.update.mockReturnValue(makeUpdateChain());

    scheduledEventService.updateDescription.mockRejectedValue(
      new Error('Discord API error'),
    );

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await expect(processor.process(job)).resolves.not.toThrow();

    expect(clientService.editEmbed).toHaveBeenCalled();
  });
});

describe('EmbedSyncProcessor — description update: skip conditions', () => {
  let processor: EmbedSyncProcessor;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let scheduledEventService: jest.Mocked<ScheduledEventService>;
  let mockDb: Record<string, jest.Mock>;

  const mockRecord = {
    id: 'record-uuid',
    eventId: 42,
    guildId: 'guild-123',
    channelId: 'channel-789',
    messageId: 'msg-456',
    embedState: EMBED_STATES.POSTED,
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain()),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(mockDb),
    }).compile();

    processor = module.get(EmbedSyncProcessor);
    clientService = module.get(DiscordBotClientService);
    scheduledEventService = module.get(ScheduledEventService);
  });

  afterEach(() => jest.clearAllMocks());

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
    mockDb.select.mockReturnValue(makeSelectChain([]));

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
});

// =========================================================================
// ROK-682 slot-config-based fullness
// =========================================================================

/** Build signup rows that simulate N active signups. */
function makeSignupRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    discordId: `user-${i}`,
    username: `User ${i}`,
    role: 'player',
    status: 'signed_up',
    preferredRoles: null,
    className: null,
  }));
}

function makeSlotConfigEvent(slotConfig: Record<string, unknown>) {
  return {
    id: 42,
    title: 'Ghost Raid',
    description: null,
    duration: [FUTURE, FUTURE_END],
    maxAttendees: null,
    cancelledAt: null,
    gameId: 1,
    slotConfig,
    isAdHoc: false,
    extendedUntil: null,
    notificationChannelOverride: null,
    recurrenceGroupId: null,
  };
}

describe('EmbedSyncProcessor — slot-config fullness: FULL', () => {
  let processor: EmbedSyncProcessor;
  let embedFactory: jest.Mocked<DiscordEmbedFactory>;
  let mockDb: Record<string, jest.Mock>;

  const mockRecord = {
    id: 'record-uuid',
    eventId: 42,
    guildId: 'guild-123',
    channelId: 'channel-789',
    messageId: 'msg-456',
    embedState: EMBED_STATES.POSTED,
  };

  function setupDbForEvent(
    event: Record<string, unknown>,
    signupCount: number,
  ) {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([mockRecord]))
      .mockReturnValueOnce(makeSelectChain([event]))
      .mockReturnValueOnce(makeSelectChain(makeSignupRows(signupCount)))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(
        makeSelectChain([{ name: 'Phasmophobia', coverUrl: null }]),
      );
    mockDb.update.mockReturnValue(makeUpdateChain());
  }

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain()),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(mockDb),
    }).compile();

    processor = module.get(EmbedSyncProcessor);
    embedFactory = module.get(DiscordEmbedFactory);
  });

  afterEach(() => jest.clearAllMocks());

  it('marks event as FULL when generic slotConfig player count is reached', async () => {
    const event = makeSlotConfigEvent({ type: 'generic', player: 4, bench: 2 });
    setupDbForEvent(event, 4);

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

  it('marks event as FULL when MMO slotConfig total is reached', async () => {
    const event = makeSlotConfigEvent({
      type: 'mmo',
      tank: 2,
      healer: 3,
      dps: 5,
      flex: 0,
    });
    setupDbForEvent(event, 10);

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

  it('marks event as FULL when signups exceed slot capacity (benched players)', async () => {
    const event = makeSlotConfigEvent({ type: 'generic', player: 4, bench: 2 });
    setupDbForEvent(event, 5);

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

describe('EmbedSyncProcessor — slot-config fullness: FILLING', () => {
  let processor: EmbedSyncProcessor;
  let embedFactory: jest.Mocked<DiscordEmbedFactory>;
  let mockDb: Record<string, jest.Mock>;

  const mockRecord = {
    id: 'record-uuid',
    eventId: 42,
    guildId: 'guild-123',
    channelId: 'channel-789',
    messageId: 'msg-456',
    embedState: EMBED_STATES.POSTED,
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain()),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(mockDb),
    }).compile();

    processor = module.get(EmbedSyncProcessor);
    embedFactory = module.get(DiscordEmbedFactory);
  });

  afterEach(() => jest.clearAllMocks());

  it('marks event as FILLING when signups are below slot capacity', async () => {
    const event = makeSlotConfigEvent({ type: 'generic', player: 4, bench: 2 });
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([mockRecord]))
      .mockReturnValueOnce(makeSelectChain([event]))
      .mockReturnValueOnce(makeSelectChain(makeSignupRows(3)))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(
        makeSelectChain([{ name: 'Phasmophobia', coverUrl: null }]),
      );
    mockDb.update.mockReturnValue(makeUpdateChain());

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
});

// =========================================================================
// ROK-728 bump message cleanup on FULL transition
// =========================================================================

describe('EmbedSyncProcessor — bump message cleanup (ROK-728)', () => {
  let processor: EmbedSyncProcessor;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let mockDb: Record<string, jest.Mock>;

  const recordWithBump = {
    id: 'record-uuid',
    eventId: 42,
    guildId: 'guild-123',
    channelId: 'channel-789',
    messageId: 'msg-456',
    embedState: EMBED_STATES.FILLING,
    bumpMessageId: 'bump-msg-001',
  };

  const recordWithoutBump = {
    ...recordWithBump,
    bumpMessageId: null,
  };

  /** Event that will compute to FULL (signups >= maxAttendees). */
  const fullEvent = {
    id: 42,
    title: 'Raid Night',
    description: null,
    duration: [FUTURE, FUTURE_END],
    maxAttendees: 4,
    cancelledAt: null,
    gameId: 1,
    slotConfig: null,
    isAdHoc: false,
    extendedUntil: null,
    notificationChannelOverride: null,
    recurrenceGroupId: null,
  };

  function setupDbForFullSync(record: Record<string, unknown>) {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([record]))
      .mockReturnValueOnce(makeSelectChain([fullEvent]))
      .mockReturnValueOnce(makeSelectChain(makeSignupRows(4)))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([{ name: 'WoW', coverUrl: null }]));
    mockDb.update.mockReturnValue(makeUpdateChain());
  }

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain()),
      update: jest.fn().mockReturnValue(makeUpdateChain()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(mockDb),
    }).compile();

    processor = module.get(EmbedSyncProcessor);
    clientService = module.get(DiscordBotClientService);
    (clientService as unknown as Record<string, jest.Mock>).deleteMessage = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('deletes bump message from Discord when event transitions to FULL', async () => {
    setupDbForFullSync(recordWithBump);

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(clientService.deleteMessage).toHaveBeenCalledWith(
      'channel-789',
      'bump-msg-001',
    );
  });

  it('clears bumpMessageId in DB after deleting from Discord', async () => {
    setupDbForFullSync(recordWithBump);

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    // update() is called for state persist AND bump cleanup
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it('does not attempt deletion when no bump message exists', async () => {
    setupDbForFullSync(recordWithoutBump);

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(clientService.deleteMessage).not.toHaveBeenCalled();
  });

  it('does not delete bump message when state is not FULL', async () => {
    // Event with fewer signups -> FILLING state
    const fillingEvent = { ...fullEvent, maxAttendees: 10 };
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([recordWithBump]))
      .mockReturnValueOnce(makeSelectChain([fillingEvent]))
      .mockReturnValueOnce(makeSelectChain(makeSignupRows(3)))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([{ name: 'WoW', coverUrl: null }]));
    mockDb.update.mockReturnValue(makeUpdateChain());

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await processor.process(job);

    expect(clientService.deleteMessage).not.toHaveBeenCalled();
  });

  it('does not throw when bump message deletion fails (graceful)', async () => {
    setupDbForFullSync(recordWithBump);
    (clientService.deleteMessage as jest.Mock).mockRejectedValue(
      new Error('Unknown Message'),
    );

    const job = {
      data: { eventId: 42, reason: 'signup' },
    } as Job<EmbedSyncJobData>;
    await expect(processor.process(job)).resolves.not.toThrow();
  });
});
